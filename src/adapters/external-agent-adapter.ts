import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAdapter, AgentContext } from "./agent-adapter.js";
import type {
  BuilderResult,
  EvaluationResult,
  Goal,
  PlanResult,
  ReviewFinding,
  ReviewResult
} from "../types.js";

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "steps", "risks"],
  properties: {
    summary: { type: "string" },
    steps: { type: "array", items: { type: "string" }, minItems: 1 },
    risks: { type: "array", items: { type: "string" } }
  }
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "detail", "suggestedAction"],
        properties: {
          severity: { type: "string", enum: ["blocking", "warning", "suggestion"] },
          title: { type: "string" },
          detail: { type: "string" },
          suggestedAction: { type: "string" }
        }
      }
    }
  }
};

type ClaudePrintResult = {
  result?: unknown;
  structured_output?: unknown;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
};

export class ExternalAgentAdapter implements AgentAdapter {
  async plan(goal: Goal, context: AgentContext): Promise<PlanResult> {
    const response = await runClaudeJson<PlanResult>(
      "plan",
      context,
      renderPlanPrompt(goal),
      PLAN_SCHEMA,
      { tools: [] }
    );
    assertStringArray(response.steps, "plan.steps");
    assertStringArray(response.risks, "plan.risks");
    return response;
  }

  async build(goal: Goal, _plan: PlanResult, context: AgentContext): Promise<BuilderResult> {
    const reportPath = join(context.runDir, `codex-build-handoff-${context.iteration}.md`);
    const workspaceArtifacts = collectWorkspaceArtifacts();
    await writeFile(
      reportPath,
      [
        `# Codex Build Handoff ${context.iteration}`,
        "",
        "External mode does not call the Codex executable from inside this runner yet.",
        "The current Codex session or user edits the workspace, then this runner records the evaluation and Claude review gate.",
        "",
        "## Objective",
        "",
        goal.objective,
        "",
        "## Evidence",
        "",
        "- Claude CLI planning and review artifacts are written in this run directory.",
        "- Deterministic verification commands run before the Claude review result is accepted.",
        "",
        "## Workspace Artifacts",
        "",
        ...workspaceArtifacts.map((file) => `- ${file}`)
      ].join("\n"),
      "utf8"
    );

    return {
      summary: "External Codex build handoff recorded. Workspace edits are performed by the active Codex session.",
      files: [reportPath, ...workspaceArtifacts],
      notes: [
        "This is an honest handoff, not a simulated build.",
        "A future Codex CLI adapter should replace this handoff once the executable is callable from the runner."
      ]
    };
  }

  async review(
    goal: Goal,
    plan: PlanResult,
    builder: BuilderResult,
    evaluations: EvaluationResult[],
    context: AgentContext
  ): Promise<ReviewResult> {
    const response = await runClaudeJson<ReviewResult>(
      "review",
      context,
      renderReviewPrompt(goal, plan, builder, evaluations, context),
      REVIEW_SCHEMA,
      { tools: ["Read", "LS"] }
    );

    if (!Array.isArray(response.findings)) {
      throw new Error("Claude review returned malformed JSON: findings must be an array.");
    }

    return {
      summary: response.summary,
      findings: response.findings.map(normalizeFinding)
    };
  }
}

async function runClaudeJson<T>(
  stage: "plan" | "review",
  context: AgentContext,
  prompt: string,
  schema: object,
  options: { tools: string[] }
): Promise<T> {
  const artifactPrefix = `claude-${stage}-${context.iteration}`;
  const promptPath = join(context.runDir, `${artifactPrefix}-prompt.md`);
  const stdoutPath = join(context.runDir, `${artifactPrefix}-stdout.json`);
  const stderrPath = join(context.runDir, `${artifactPrefix}-stderr.txt`);
  const parsedPath = join(context.runDir, `${artifactPrefix}-parsed.json`);

  await writeFile(promptPath, prompt, "utf8");

  const claudeArgs = [
    "-p",
    "--model",
    process.env.AUTO_GOAL_CLAUDE_MODEL ?? "sonnet",
    "--effort",
    process.env.AUTO_GOAL_CLAUDE_EFFORT ?? "high",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--no-session-persistence"
  ];

  claudeArgs.push("--tools", options.tools.join(","));

  const maxBudgetUsd = process.env.AUTO_GOAL_CLAUDE_MAX_BUDGET_USD ?? "1.25";
  if (maxBudgetUsd) {
    claudeArgs.push("--max-budget-usd", maxBudgetUsd);
  }

  let stdout = "";
  let stderr = "";

  try {
    const { command, args } = createClaudeCommand(claudeArgs);
    const result = await runProcess(command, args, prompt, {
      cwd: process.cwd(),
      timeout: Number(process.env.AUTO_GOAL_CLAUDE_TIMEOUT_MS ?? "180000")
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string };
    stdout = failed.stdout ?? "";
    stderr = failed.stderr ?? failed.message;
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    throw new Error(`Claude ${stage} call failed. See ${stdoutPath} and ${stderrPath}. ${failed.message}`);
  }

  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(stderrPath, stderr, "utf8");

  const parsed = parseClaudeJson(stdout);
  await writeFile(parsedPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed as T;
}

function runProcess(
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      const error = new Error(`Claude process timed out after ${options.timeout}ms`) as Error & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = Buffer.concat(stdoutChunks).toString("utf8");
      error.stderr = Buffer.concat(stderrChunks).toString("utf8");
      rejectProcess(error);
    }, options.timeout);

    child.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
    child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectProcess(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolveProcess({ stdout, stderr });
        return;
      }

      const error = new Error(`Claude process exited with code ${code}`) as Error & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = stdout;
      error.stderr = stderr;
      rejectProcess(error);
    });

    child.stdin.end(input);
  });
}

function createClaudeCommand(claudeArgs: string[]): { command: string; args: string[] } {
  const configuredCommand = process.env.AUTO_GOAL_CLAUDE_COMMAND;
  if (configuredCommand) {
    return { command: configuredCommand, args: claudeArgs };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const npmClaudeExe = appData
      ? join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
      : undefined;
    if (npmClaudeExe && existsSync(npmClaudeExe)) {
      return { command: npmClaudeExe, args: claudeArgs };
    }

    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "claude.cmd", ...claudeArgs]
    };
  }

  return { command: "claude", args: claudeArgs };
}

function parseClaudeJson(stdout: string): unknown {
  let printResult: ClaudePrintResult;
  try {
    printResult = JSON.parse(stdout) as ClaudePrintResult;
  } catch {
    throw new Error("Claude CLI returned non-JSON output.");
  }

  if (typeof printResult.structured_output === "object" && printResult.structured_output !== null) {
    return printResult.structured_output;
  }

  const result = printResult.result;
  if (typeof result === "object" && result !== null) {
    return result;
  }

  if (typeof result !== "string") {
    throw new Error("Claude CLI JSON output did not include a result object or string.");
  }

  try {
    return JSON.parse(result) as unknown;
  } catch {
    const match = /\{[\s\S]*\}/.exec(result);
    if (!match) {
      throw new Error("Claude result did not contain a JSON object.");
    }
    return JSON.parse(match[0]) as unknown;
  }
}

function renderPlanPrompt(goal: Goal): string {
  return [
    "You are Claude acting as the planning and quality agent in a Codex <-> Claude goal loop.",
    "Return JSON only. Do not include markdown.",
    "The JSON must match this TypeScript shape:",
    "{ summary: string; steps: string[]; risks: string[] }",
    "",
    "Create a strict implementation plan. Do not praise the work. Include risks that could make the goal look low-quality.",
    "",
    "GOAL:",
    JSON.stringify(summarizeGoal(goal), null, 2)
  ].join("\n");
}

function renderReviewPrompt(
  goal: Goal,
  plan: PlanResult,
  builder: BuilderResult,
  evaluations: EvaluationResult[],
  context: AgentContext
): string {
  return [
    "You are Claude acting as a strict creative director and QA reviewer in a Codex <-> Claude goal loop.",
    "Return JSON only. Do not include markdown.",
    "The JSON must match this TypeScript shape:",
    "{ summary: string; findings: { severity: 'blocking' | 'warning' | 'suggestion'; title: string; detail: string; suggestedAction: string }[] }",
    "",
    "Use blocking severity when the result should not be claimed as passed.",
    "For visual or product goals, be harsh about generic layouts, weak interaction, unclear story, missing proof, unreadable mobile, or simulated evidence.",
    "If deterministic evaluations failed, include blocking findings.",
    "Use the read-only file tools to inspect the referenced source files and screenshot paths before making visual claims.",
    "If screenshots are missing or unreadable, return a blocking finding.",
    "",
    "GOAL:",
    JSON.stringify(summarizeGoal(goal), null, 2),
    "",
    "PLAN:",
    JSON.stringify(plan, null, 2),
    "",
    "BUILDER:",
    JSON.stringify(builder, null, 2),
    "",
      "EVALUATIONS:",
      JSON.stringify(evaluations, null, 2),
      "",
      "WORKSPACE EXCERPTS:",
      renderWorkspaceExcerpts(context)
  ].join("\n");
}

function summarizeGoal(goal: Goal): Omit<Goal, "rawSections"> & { loopMode?: string } {
  return {
    objective: goal.objective,
    deliverableType: goal.deliverableType,
    targetUser: goal.targetUser,
    acceptanceCriteria: goal.acceptanceCriteria,
    constraints: goal.constraints,
    verificationCommands: goal.verificationCommands,
    stopConditions: goal.stopConditions,
    loopMode: goal.rawSections["loop mode"]
  };
}

function assertStringArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Claude returned malformed JSON: ${name} must be a string array.`);
  }
}

function normalizeFinding(finding: ReviewFinding): ReviewFinding {
  if (!["blocking", "warning", "suggestion"].includes(finding.severity)) {
    return {
      ...finding,
      severity: "blocking",
      title: finding.title || "Malformed finding severity",
      suggestedAction: finding.suggestedAction || "Return a valid severity."
    };
  }
  return finding;
}

function collectWorkspaceArtifacts(): string[] {
  const candidateFiles = [
    join(process.cwd(), "examples", "ai-loop-site", "index.html"),
    join(process.cwd(), "examples", "ai-loop-site", "styles.css"),
    join(process.cwd(), "examples", "ai-loop-site", "script.js"),
    join(process.cwd(), "examples", "ai-loop-site", "dist", "site-bundle.js"),
    join(process.cwd(), "examples", "ai-loop-site", "DESIGN_RESEARCH.md"),
    join(process.cwd(), "examples", "ai-loop-site", "assets", "hero-ai-loop-abstract.png"),
    join(process.cwd(), "examples", "ai-loop-site", "assets", "fonts", "syne-latin-wght-normal.woff2")
  ];

  return candidateFiles.filter((file) => existsSync(file));
}

function renderWorkspaceExcerpts(context: AgentContext): string {
  const excerptFiles = [
    join(process.cwd(), "examples", "ai-loop-site", "index.html"),
    join(process.cwd(), "examples", "ai-loop-site", "styles.css"),
    join(process.cwd(), "examples", "ai-loop-site", "script.js"),
    join(process.cwd(), "examples", "ai-loop-site", "GOAL.md"),
    join(process.cwd(), "examples", "ai-loop-site", "DESIGN_RESEARCH.md"),
    join(context.runDir, "site-check", "site-check-summary.json")
  ].filter((file) => existsSync(file));

  const assetManifest = collectWorkspaceArtifacts()
    .map((file) => `- ${file}`)
    .join("\n");

  return excerptFiles
    .map((file) => {
      const content = readFileSync(file, "utf8").slice(0, 9000);
      return `--- ${file} ---\n${content}`;
    })
    .join("\n\n")
    .concat(`\n\n--- Artifact manifest ---\n${assetManifest}`);
}
