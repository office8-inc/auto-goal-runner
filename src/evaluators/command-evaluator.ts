import { spawn } from "node:child_process";
import type { EvaluationResult } from "../types.js";

export async function evaluateCommands(
  commands: string[],
  cwd: string,
  enabled: boolean,
  runDir?: string
): Promise<EvaluationResult[]> {
  if (!enabled) {
    return commands.map((command) => ({
      name: `command:${command}`,
      status: "skip",
      summary: "Command evaluator skipped. Re-run with --run-verification-commands to execute.",
      details: command
    }));
  }

  const results: EvaluationResult[] = [];
  for (const command of commands) {
    results.push(await runCommand(command, cwd, runDir));
  }
  return results;
}

function runCommand(command: string, cwd: string, runDir?: string): Promise<EvaluationResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (runDir && /\bsite:check\b/.test(command)) {
      env.SITE_CHECK_OUTPUT_DIR = `${runDir}/site-check`;
    }

    const child = spawn(command, { cwd, shell: true, env });
    const chunks: string[] = [];

    child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
    child.stderr.on("data", (data: Buffer) => chunks.push(data.toString()));
    child.on("close", (code) => {
      resolve({
        name: `command:${command}`,
        status: code === 0 ? "pass" : "fail",
        summary: code === 0 ? `Command passed: ${command}` : `Command failed with exit code ${code}: ${command}`,
        details: chunks.join("").slice(-4000)
      });
    });
  });
}
