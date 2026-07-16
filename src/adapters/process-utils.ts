import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

export type ProcessResult = {
  exitCode: number;
  timedOut: boolean;
  /** Tail of stdout, bounded by maxBufferBytes. Full stream is in stdoutFile when set. */
  stdout: string;
  stderr: string;
};

export type ProcessOptions = {
  cwd: string;
  timeoutMs: number;
  input?: string;
  /** When set, full stdout is streamed to this file instead of growing in memory. */
  stdoutFile?: string;
  maxBufferBytes?: number;
};

/**
 * Bounded tail buffer: agent CLIs can emit very large event streams, so memory
 * only ever holds the last maxBytes of output.
 */
class TailBuffer {
  private chunks: Buffer[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.total -= removed.length;
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions
): Promise<ProcessResult> {
  const maxBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutTail = new TailBuffer(maxBytes);
    const stderrTail = new TailBuffer(maxBytes);
    const stdoutStream = options.stdoutFile ? createWriteStream(options.stdoutFile) : undefined;

    let settled = false;
    let timedOut = false;
    let streamError: Error | undefined;

    // 監査ログが書けない状態を成功として返してはいけない（honest ledger）。
    // クラッシュもさせず、close 時に失敗として報告する。
    stdoutStream?.on("error", (error) => {
      streamError = error;
      killProcessTree(child.pid);
    });

    const finish = (result: Omit<ProcessResult, "stdout" | "stderr">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const complete = () => {
        if (streamError) {
          rejectProcess(
            new Error(`Failed to write process output to ${options.stdoutFile}: ${streamError.message}`)
          );
          return;
        }
        resolveProcess({
          ...result,
          stdout: stdoutTail.toString(),
          stderr: stderrTail.toString()
        });
      };
      if (stdoutStream) {
        stdoutStream.end(complete);
      } else {
        complete();
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, options.timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      stdoutTail.push(data);
      stdoutStream?.write(data);
    });
    child.stderr.on("data", (data: Buffer) => stderrTail.push(data));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutStream?.end();
      rejectProcess(error);
    });

    child.on("close", (code) => {
      finish({ exitCode: code ?? -1, timedOut });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Windows needs taskkill /T to reach grandchildren; SIGTERM only hits the direct child. */
export function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {
      /* the child may already be gone */
    });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* the child may already be gone */
    }
  }
}
