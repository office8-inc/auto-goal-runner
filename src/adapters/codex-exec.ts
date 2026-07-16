import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./process-utils.js";
import type { AgentContext } from "./agent-adapter.js";
import type {
  BuilderResult,
  CodexSandboxMode,
  EvaluationResult,
  Goal,
  PlanResult,
  ReviewFinding
} from "../types.js";
import { normalizeFindingResponses } from "../workspace.js";

const BUILD_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "files", "notes", "findingResponses"],
  properties: {
    summary: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
    findingResponses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // strict output schemas require every property to be listed in `required`;
        // "no note" is expressed as an empty string.
        required: ["findingId", "status", "note"],
        properties: {
          findingId: { type: "string" },
          status: { type: "string", enum: ["fixed", "rejected", "unable"] },
          note: { type: "string" }
        }
      }
    }
  }
};

export async function runCodexBuild(
  goal: Goal,
  plan: PlanResult,
  context: AgentContext
): Promise<BuilderResult> {
  const artifactPrefix = `codex-build-${context.iteration}`;
  const promptPath = join(context.runDir, `${artifactPrefix}-prompt.md`);
  const schemaPath = join(context.runDir, `${artifactPrefix}-schema.json`);
  const lastMessagePath = join(context.runDir, `${artifactPrefix}-last-message.json`);
  const eventsPath = join(context.runDir, `${artifactPrefix}-events.jsonl`);
  const stderrPath = join(context.runDir, `${artifactPrefix}-stderr.txt`);
  const metaPath = join(context.runDir, `${artifactPrefix}-meta.json`);

  const prompt = renderBuildPrompt(goal, plan, context);
  await writeFile(promptPath, prompt, "utf8");
  await writeFile(schemaPath, `${JSON.stringify(BUILD_OUTPUT_SCHEMA, null, 2)}\n`, "utf8");

  const { command, baseArgs, viaCmdShim } = resolveCodexCommand();
  const codexArgs = buildCodexArgs({
    workspaceRoot: context.workspaceRoot,
    sandbox: context.codexSandbox,
    schemaPath,
    lastMessagePath,
    model: process.env.AUTO_GOAL_CODEX_MODEL
  });
  if (viaCmdShim) {
    assertCmdShimSafeArgs(codexArgs);
  }
  const args = [...baseArgs, ...codexArgs];

  const timeoutMs = Number(process.env.AUTO_GOAL_CODEX_TIMEOUT_MS ?? "1200000");
  const startedAt = Date.now();

  let result;
  try {
    // プロンプトは stdin で渡す（"-"）。引数渡しは Windows のコマンドライン長
    // 制限に当たるため、大きな repair プロンプトで失敗する。
    result = await runProcess(command, [...args, "-"], {
      cwd: context.workspaceRoot,
      timeoutMs,
      input: prompt,
      stdoutFile: eventsPath
    });
  } catch (error) {
    throw new Error(
      `Codex CLI could not be started (${command}): ${(error as Error).message}. ` +
        "Set AUTO_GOAL_CODEX_COMMAND to the codex executable path."
    );
  }

  await writeFile(stderrPath, result.stderr, "utf8");
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        command,
        sandbox: context.codexSandbox,
        args,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (result.timedOut) {
    throw new Error(`Codex build timed out after ${timeoutMs}ms. See ${eventsPath}.`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Codex build exited with code ${result.exitCode}. See ${eventsPath} and ${stderrPath}.`
    );
  }

  return parseCodexLastMessage(await readLastMessage(lastMessagePath));
}

export function buildCodexArgs(options: {
  workspaceRoot: string;
  sandbox: CodexSandboxMode;
  schemaPath: string;
  lastMessagePath: string;
  model?: string;
}): string[] {
  const args = [
    "exec",
    "-C",
    options.workspaceRoot,
    ...sandboxArgs(options.sandbox),
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--output-schema",
    options.schemaPath,
    "-o",
    options.lastMessagePath,
    "--json"
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  return args;
}

function sandboxArgs(mode: CodexSandboxMode): string[] {
  switch (mode) {
    case "workspace-write":
      return ["--sandbox", "workspace-write"];
    case "danger-full-access":
      return ["--sandbox", "danger-full-access"];
    case "bypass":
      return ["--dangerously-bypass-approvals-and-sandbox"];
  }
}

export function resolveCodexCommand(): { command: string; baseArgs: string[]; viaCmdShim: boolean } {
  const configured = process.env.AUTO_GOAL_CODEX_COMMAND;
  if (configured) {
    return { command: configured, baseArgs: [], viaCmdShim: false };
  }

  if (process.platform === "win32") {
    const found = findWindowsCodexExe();
    if (found) {
      return { command: found, baseArgs: [], viaCmdShim: false };
    }

    // PATH 上の実行ファイルを直接探す（shell:false では PATHEXT 解決が働かないため自前で）
    const onPath = findOnWindowsPath("codex.exe");
    if (onPath) {
      return { command: onPath, baseArgs: [], viaCmdShim: false };
    }

    // npm グローバルインストールは codex.cmd シムなので shell:false では直接
    // 起動できない。cmd.exe 経由で起動する（引数は呼び出し側で検証する）。
    if (findOnWindowsPath("codex.cmd")) {
      return {
        command: process.env.ComSpec ?? "cmd.exe",
        baseArgs: ["/d", "/s", "/c", "codex.cmd"],
        viaCmdShim: true
      };
    }

    return { command: "codex", baseArgs: [], viaCmdShim: false };
  }

  return { command: "codex", baseArgs: [], viaCmdShim: false };
}

function findOnWindowsPath(fileName: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * cmd.exe はシム経由の引数を再パースするため、メタ文字を含むパスは安全に渡せない。
 * エスケープ仕様が複雑で完全対応は現実的でないので、検出したら正直に失敗させる。
 */
export function assertCmdShimSafeArgs(args: string[]): void {
  const cmdMetacharacters = /[&|<>^%!"]/;
  for (const arg of args) {
    if (cmdMetacharacters.test(arg)) {
      throw new Error(
        `Cannot pass "${arg}" through the codex.cmd shim: it contains cmd.exe metacharacters. ` +
          "Set AUTO_GOAL_CODEX_COMMAND to the codex executable's full path, or move the workspace to a plain path."
      );
    }
  }
}

/**
 * Known install locations on Windows: the Codex desktop app and the VS Code
 * extension both ship codex.exe. Newest binary wins.
 */
function findWindowsCodexExe(): string | undefined {
  const candidates: string[] = [];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    collectVersionedBinaries(join(localAppData, "OpenAI", "Codex", "bin"), "codex.exe", candidates);
  }

  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const extensionsDir = join(userProfile, ".vscode", "extensions");
    if (existsSync(extensionsDir)) {
      for (const entry of safeReaddir(extensionsDir)) {
        if (entry.startsWith("openai.chatgpt-")) {
          const exe = join(extensionsDir, entry, "bin", "windows-x86_64", "codex.exe");
          if (existsSync(exe)) {
            candidates.push(exe);
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort((a, b) => mtimeOf(b) - mtimeOf(a))[0];
}

function collectVersionedBinaries(binDir: string, exeName: string, sink: string[]): void {
  if (!existsSync(binDir)) {
    return;
  }
  for (const entry of safeReaddir(binDir)) {
    const exe = join(binDir, entry, exeName);
    if (existsSync(exe)) {
      sink.push(exe);
    }
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

async function readLastMessage(lastMessagePath: string): Promise<string> {
  try {
    return await readFile(lastMessagePath, "utf8");
  } catch {
    throw new Error(
      `Codex build finished but did not write the structured result file: ${lastMessagePath}`
    );
  }
}

export function parseCodexLastMessage(raw: string): BuilderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex build result was not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Codex build result was not a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.summary !== "string") {
    throw new Error("Codex build result is missing a string summary.");
  }
  if (!isStringArray(candidate.files)) {
    throw new Error("Codex build result is missing a files string array.");
  }
  if (!isStringArray(candidate.notes)) {
    throw new Error("Codex build result is missing a notes string array.");
  }

  return {
    summary: candidate.summary,
    files: candidate.files,
    notes: candidate.notes,
    reportedFiles: candidate.files,
    findingResponses: normalizeFindingResponses(candidate.findingResponses)
  };
}

export function renderBuildPrompt(goal: Goal, plan: PlanResult, context: AgentContext): string {
  const lines = [
    "You are Codex acting as the builder in a Codex <-> Claude goal loop.",
    "",
    `Workspace root: ${context.workspaceRoot}`,
    "Rules:",
    "- Only create, modify, or delete files inside the workspace root.",
    "- Do not run publishing, deployment, git push, package publishing, payment, or credential commands.",
    "- Do not print secrets or read credential files.",
    "- Local builds and tests are allowed.",
    "",
    "GOAL:",
    JSON.stringify(
      {
        objective: goal.objective,
        deliverableType: goal.deliverableType,
        targetUser: goal.targetUser,
        acceptanceCriteria: goal.acceptanceCriteria,
        constraints: goal.constraints
      },
      null,
      2
    ),
    "",
    "PLAN:",
    JSON.stringify(plan, null, 2)
  ];

  if (context.previousReview && context.previousReview.findings.length > 0) {
    lines.push(
      "",
      "PREVIOUS REVIEW FINDINGS (address every finding; answer each one in findingResponses):",
      JSON.stringify(context.previousReview.findings.map(compactFinding), null, 2)
    );
  }

  const failedEvaluations = context.previousEvaluations.filter((item) => item.status === "fail");
  if (failedEvaluations.length > 0) {
    lines.push(
      "",
      "PREVIOUS FAILED EVALUATIONS:",
      JSON.stringify(failedEvaluations.map(compactEvaluation), null, 2)
    );
  }

  if (context.previousBuilder?.observedChanges?.length) {
    lines.push(
      "",
      "PREVIOUS OBSERVED CHANGES:",
      JSON.stringify(context.previousBuilder.observedChanges, null, 2)
    );
  }

  lines.push(
    "",
    "This is iteration " + context.iteration + ".",
    context.iteration === 1
      ? "This is the first build pass; findingResponses must be an empty array."
      : "Repair the workspace so the previous findings and failed evaluations are resolved.",
    "",
    "Your final message must match the provided output schema:",
    "- summary: what you did.",
    "- files: workspace-relative paths of every file you created, modified, or deleted.",
    "- notes: anything the reviewer should know.",
    "- findingResponses: one entry per previous finding with status fixed, rejected, or unable."
  );

  return lines.join("\n");
}

function compactFinding(finding: ReviewFinding): Record<string, string> {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    suggestedAction: finding.suggestedAction
  };
}

function compactEvaluation(evaluation: EvaluationResult): Record<string, string> {
  return {
    name: evaluation.name,
    summary: evaluation.summary,
    logTail: (evaluation.details ?? "").slice(-2000)
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
