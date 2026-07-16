import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentAdapter, AgentContext } from "./agent-adapter.js";
import { runProcess } from "./process-utils.js";
import { runCodexBuild } from "./codex-exec.js";
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
  is_error?: boolean;
  errors?: unknown[];
};

/** Raw review finding as returned by Claude, before an ID is assigned. */
type RawReviewFinding = Omit<ReviewFinding, "id">;

const TEXT_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".md", ".txt", ".svg", ".yml", ".yaml", ".toml", ".xml"
]);
const SECRET_NAME_PATTERN = /\.env|secret|credential|token|id_rsa|\.pem$|\.key$/i;
const EXCERPT_BYTES_PER_FILE = 6000;
const EXCERPT_TOTAL_BYTES = 48000;

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

  async build(goal: Goal, plan: PlanResult, context: AgentContext): Promise<BuilderResult> {
    return runCodexBuild(goal, plan, context);
  }

  async review(
    goal: Goal,
    plan: PlanResult,
    builder: BuilderResult,
    evaluations: EvaluationResult[],
    context: AgentContext
  ): Promise<ReviewResult> {
    const response = await runClaudeJson<{ summary: string; findings: RawReviewFinding[] }>(
      "review",
      context,
      renderReviewPrompt(goal, plan, builder, evaluations, context),
      REVIEW_SCHEMA,
      { tools: ["Read", "Glob"] }
    );

    if (!Array.isArray(response.findings)) {
      throw new Error("Claude review returned malformed JSON: findings must be an array.");
    }

    return {
      summary: response.summary,
      findings: response.findings.map((finding, index) =>
        normalizeFinding(finding, `f${context.iteration}-${index + 1}`)
      )
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
    "--no-session-persistence",
    "--tools",
    options.tools.join(","),
    "--max-budget-usd",
    process.env.AUTO_GOAL_CLAUDE_MAX_BUDGET_USD ?? "2.50"
  ];

  const { command, args } = createClaudeCommand(claudeArgs);

  let result;
  try {
    result = await runProcess(command, args, {
      cwd: context.workspaceRoot,
      timeoutMs: Number(process.env.AUTO_GOAL_CLAUDE_TIMEOUT_MS ?? "180000"),
      input: prompt
    });
  } catch (error) {
    throw new Error(
      `Claude CLI could not be started (${command}): ${(error as Error).message}. ` +
        "Set AUTO_GOAL_CLAUDE_COMMAND to the claude executable path."
    );
  }

  await writeFile(stdoutPath, result.stdout, "utf8");
  await writeFile(stderrPath, result.stderr, "utf8");

  if (result.timedOut) {
    throw new Error(`Claude ${stage} call timed out. See ${stdoutPath} and ${stderrPath}.`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Claude ${stage} call failed with exit code ${result.exitCode}. See ${stdoutPath} and ${stderrPath}.`
    );
  }

  const parsed = parseClaudeJson(result.stdout, stage);
  await writeFile(parsedPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed as T;
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

function parseClaudeJson(stdout: string, stage: string): unknown {
  let printResult: ClaudePrintResult;
  try {
    printResult = JSON.parse(stdout) as ClaudePrintResult;
  } catch {
    throw new Error("Claude CLI returned non-JSON output.");
  }

  if (printResult.is_error) {
    const details = Array.isArray(printResult.errors) ? printResult.errors.join("; ") : "unknown";
    throw new Error(`Claude ${stage} call reported an error: ${details}`);
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
    "If the builder reported changes that were not observed, or vice versa (see DISCREPANCIES), treat unexplained mismatches as at least a warning.",
    `You may use the read-only file tools, but only inside the workspace root (${context.workspaceRoot}) and the run directory (${context.runDir}).`,
    "Do not read files larger than about 50 KB, credential files, or anything outside those directories.",
    "If screenshots are referenced but missing or unreadable, return a blocking finding.",
    "",
    "GOAL:",
    JSON.stringify(summarizeGoal(goal), null, 2),
    "",
    "PLAN:",
    JSON.stringify(plan, null, 2),
    "",
    "BUILDER:",
    JSON.stringify(
      {
        summary: builder.summary,
        notes: builder.notes,
        reportedFiles: builder.reportedFiles ?? builder.files,
        findingResponses: builder.findingResponses ?? []
      },
      null,
      2
    ),
    "",
    "OBSERVED CHANGES:",
    JSON.stringify(builder.observedChanges ?? [], null, 2),
    "",
    "DISCREPANCIES:",
    JSON.stringify(builder.discrepancies ?? [], null, 2),
    "",
    "EVALUATIONS:",
    JSON.stringify(evaluations, null, 2),
    "",
    "WORKSPACE EXCERPTS:",
    renderWorkspaceExcerpts(builder, context)
  ].join("\n");
}

/**
 * Bounded, generic review context: heads of the changed text files plus the
 * workspace top-level listing. Secret-like files are excluded, and the total
 * size is capped so the review prompt cannot blow past the Claude budget.
 */
function renderWorkspaceExcerpts(builder: BuilderResult, context: AgentContext): string {
  const sections: string[] = [];
  let remaining = EXCERPT_TOTAL_BYTES;

  for (const file of builder.files) {
    if (remaining <= 0) {
      sections.push("--- (excerpt budget exhausted; inspect remaining files with Read) ---");
      break;
    }
    if (!isExcerptCandidate(file)) {
      continue;
    }

    const head = readFileHead(file, Math.min(EXCERPT_BYTES_PER_FILE, remaining));
    if (head === undefined) {
      continue;
    }
    remaining -= Buffer.byteLength(head, "utf8");
    sections.push(`--- ${file} ---\n${head}`);
  }

  const siteCheckSummary = join(context.runDir, "site-check", "site-check-summary.json");
  if (existsSync(siteCheckSummary)) {
    const head = readFileHead(siteCheckSummary, EXCERPT_BYTES_PER_FILE);
    if (head !== undefined) {
      sections.push(`--- ${siteCheckSummary} ---\n${head}`);
    }
  }

  sections.push(`--- workspace root listing (${context.workspaceRoot}) ---\n${listTopLevel(context.workspaceRoot)}`);

  return sections.join("\n\n");
}

function isExcerptCandidate(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/.git/") || normalized.includes("/node_modules/")) {
    return false;
  }
  if (SECRET_NAME_PATTERN.test(basename(file))) {
    return false;
  }
  const extension = normalized.slice(normalized.lastIndexOf("."));
  return TEXT_EXTENSIONS.has(extension.toLowerCase());
}

function readFileHead(path: string, maxBytes: number): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function listTopLevel(workspaceRoot: string): string {
  try {
    return readdirSync(workspaceRoot)
      .map((name) => {
        try {
          return statSync(join(workspaceRoot, name)).isDirectory() ? `${name}/` : name;
        } catch {
          return name;
        }
      })
      .join("\n");
  } catch {
    return "(workspace root is not readable)";
  }
}

function summarizeGoal(goal: Goal): Omit<Goal, "rawSections"> & { loopMode?: string } {
  return {
    objective: goal.objective,
    deliverableType: goal.deliverableType,
    targetUser: goal.targetUser,
    workspace: goal.workspace,
    acceptanceCriteria: goal.acceptanceCriteria,
    constraints: goal.constraints,
    verificationCommands: goal.verificationCommands,
    stopConditions: goal.stopConditions,
    manualApprovalCategories: goal.manualApprovalCategories,
    loopMode: goal.rawSections["loop mode"]
  };
}

function assertStringArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Claude returned malformed JSON: ${name} must be a string array.`);
  }
}

function normalizeFinding(finding: RawReviewFinding, id: string): ReviewFinding {
  if (!["blocking", "warning", "suggestion"].includes(finding.severity)) {
    return {
      ...finding,
      id,
      severity: "blocking",
      title: finding.title || "Malformed finding severity",
      suggestedAction: finding.suggestedAction || "Return a valid severity."
    };
  }
  return { ...finding, id };
}
