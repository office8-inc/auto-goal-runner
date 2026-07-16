import { spawn } from "node:child_process";
import { killProcessTree, trackChild, untrackChild } from "../adapters/process-utils.js";
import type { EvaluationResult } from "../types.js";

const MAX_CAPTURED_OUTPUT = 200 * 1024;

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
  return new Promise((resolveCommand) => {
    const env = { ...process.env };
    if (runDir && /\bsite:check\b/.test(command)) {
      env.SITE_CHECK_OUTPUT_DIR = `${runDir}/site-check`;
    }

    const timeoutMs = Number(process.env.AUTO_GOAL_COMMAND_TIMEOUT_MS ?? "600000");
    const child = spawn(command, {
      cwd,
      shell: true,
      env,
      detached: process.platform !== "win32"
    });
    trackChild(child.pid);

    let output = "";
    let settled = false;
    let timedOut = false;

    const record = (data: Buffer) => {
      output += data.toString();
      if (output.length > MAX_CAPTURED_OUTPUT) {
        output = output.slice(-MAX_CAPTURED_OUTPUT);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);

    const finish = (result: EvaluationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrackChild(child.pid);
      resolveCommand(result);
    };

    child.stdout.on("data", record);
    child.stderr.on("data", record);

    child.on("error", (error) => {
      finish({
        name: `command:${command}`,
        status: "fail",
        summary: `Command could not be started: ${command} (${error.message})`,
        details: output.slice(-4000)
      });
    });

    child.on("close", (code) => {
      if (timedOut) {
        finish({
          name: `command:${command}`,
          status: "fail",
          summary: `Command timed out after ${timeoutMs}ms: ${command}`,
          details: output.slice(-4000)
        });
        return;
      }
      finish({
        name: `command:${command}`,
        status: code === 0 ? "pass" : "fail",
        summary: code === 0 ? `Command passed: ${command}` : `Command failed with exit code ${code}: ${command}`,
        details: output.slice(-4000)
      });
    });
  });
}
