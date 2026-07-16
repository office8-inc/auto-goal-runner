#!/usr/bin/env node
import { resolve } from "node:path";
import { runGoal } from "./orchestrator.js";
import type { AgentMode, CodexSandboxMode, RunOptions } from "./types.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command !== "run") {
    throw new Error(`Unknown command: ${command}`);
  }

  const flags = parseFlags(rest);
  const mode = parseMode(flags.mode ?? "simulate");
  const maxIterations = Number(flags["max-iterations"] ?? "2");

  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error("--max-iterations must be a positive integer.");
  }

  const options: RunOptions = {
    goalPath: resolve(process.cwd(), stringFlag(flags.goal, "GOAL.md")),
    mode,
    maxIterations,
    runVerificationCommands: Boolean(flags["run-verification-commands"]),
    cwd: process.cwd(),
    workspaceOverride: typeof flags.workspace === "string" ? flags.workspace : undefined,
    codexSandbox: parseCodexSandbox(
      flags["codex-sandbox"] ?? process.env.AUTO_GOAL_CODEX_SANDBOX ?? "workspace-write"
    )
  };

  const result = await runGoal(options);
  console.log(`Run ${result.status}: ${result.stopReason}`);
  console.log(`Run directory: ${result.runDir}`);
  console.log(`Final report: ${resolve(result.runDir, "final-report.md")}`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return flags;
}

function stringFlag(value: string | boolean | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function parseMode(value: string | boolean): AgentMode {
  if (value === "simulate" || value === "external") {
    return value;
  }
  throw new Error(`Unsupported mode: ${String(value)}`);
}

function parseCodexSandbox(value: string | boolean): CodexSandboxMode {
  if (value === "workspace-write" || value === "danger-full-access" || value === "bypass") {
    return value;
  }
  throw new Error(
    `Unsupported codex sandbox mode: ${String(value)}. Use workspace-write, danger-full-access, or bypass.`
  );
}

function printHelp(): void {
  console.log(`Auto Goal Runner

Usage:
  auto-goal-runner run --goal GOAL.md --mode simulate --max-iterations 2
  auto-goal-runner run --goal GOAL.md --mode external --max-iterations 2 --run-verification-commands

Options:
  --goal <path>                    Path to GOAL.md. Defaults to GOAL.md.
  --mode <simulate|external>        simulate uses deterministic local agents; external calls Claude CLI for plan/review and Codex CLI for build/repair. Defaults to simulate.
  --max-iterations <n>              Maximum loop iterations. Defaults to 2.
  --run-verification-commands       Execute commands from GOAL.md (policy-gated).
  --workspace <dir>                 Workspace the builder edits. Defaults to the Workspace section in GOAL.md, then the goal file's directory.
  --codex-sandbox <mode>            workspace-write | danger-full-access | bypass. Defaults to workspace-write.
                                    Note: on Windows the Codex sandbox denies writes without UAC elevation; unattended runs need the explicit bypass opt-in.

External mode environment:
  AUTO_GOAL_CLAUDE_MODEL            Claude model alias. Defaults to sonnet.
  AUTO_GOAL_CLAUDE_EFFORT           Claude effort. Defaults to high.
  AUTO_GOAL_CLAUDE_MAX_BUDGET_USD   Claude CLI budget cap. Defaults to 2.50.
  AUTO_GOAL_CLAUDE_TIMEOUT_MS       Claude CLI timeout. Defaults to 180000.
  AUTO_GOAL_CLAUDE_COMMAND          Optional Claude executable path.
  AUTO_GOAL_CODEX_MODEL             Codex model override. Defaults to the Codex CLI config.
  AUTO_GOAL_CODEX_SANDBOX           Default for --codex-sandbox.
  AUTO_GOAL_CODEX_TIMEOUT_MS        Codex build timeout. Defaults to 1200000.
  AUTO_GOAL_CODEX_COMMAND           Optional Codex executable path.
  AUTO_GOAL_COMMAND_TIMEOUT_MS      Verification command timeout. Defaults to 600000.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
