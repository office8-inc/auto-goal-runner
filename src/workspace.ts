import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BuilderResult, FindingResponse, Goal, ObservedChange, RunOptions } from "./types.js";

const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", "runs"]);
const MAX_SNAPSHOT_ENTRIES = 20000;

export type WorkspaceSnapshot = {
  entries: Map<string, { mtimeMs: number; size: number }>;
  truncated: boolean;
  /** Directories the walk could not read; observation is incomplete there. */
  unreadableDirs: string[];
};

/**
 * Resolution order: --workspace flag (invocation cwd) > `## Workspace` in the
 * goal file (goal directory) > the goal file's directory. See docs/architecture.md.
 */
export function resolveWorkspaceRoot(goal: Goal, options: RunOptions): string {
  const goalDir = dirname(resolve(options.cwd, options.goalPath));

  let candidate: string;
  if (options.workspaceOverride) {
    candidate = resolve(options.cwd, options.workspaceOverride);
  } else if (goal.workspace) {
    candidate = isAbsolute(goal.workspace) ? goal.workspace : resolve(goalDir, goal.workspace);
  } else {
    candidate = goalDir;
  }

  let stats;
  try {
    stats = statSync(candidate);
  } catch {
    throw new Error(`Workspace directory does not exist: ${candidate}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${candidate}`);
  }

  return candidate;
}

export function captureWorkspaceSnapshot(workspaceRoot: string): WorkspaceSnapshot {
  const entries = new Map<string, { mtimeMs: number; size: number }>();
  const unreadableDirs: string[] = [];
  let truncated = false;

  const walk = (dir: string) => {
    if (truncated) {
      return;
    }

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      unreadableDirs.push(toWorkspaceRelative(workspaceRoot, dir) || ".");
      return;
    }

    for (const name of names) {
      if (entries.size >= MAX_SNAPSHOT_ENTRIES) {
        truncated = true;
        return;
      }

      const fullPath = join(dir, name);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(name)) {
          walk(fullPath);
        }
        continue;
      }

      if (stats.isFile()) {
        const relativePath = toWorkspaceRelative(workspaceRoot, fullPath);
        entries.set(relativePath, { mtimeMs: stats.mtimeMs, size: stats.size });
      }
    }
  };

  walk(workspaceRoot);
  return { entries, truncated, unreadableDirs };
}

export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot
): ObservedChange[] {
  const changes: ObservedChange[] = [];

  for (const [path, afterEntry] of after.entries) {
    const beforeEntry = before.entries.get(path);
    if (!beforeEntry) {
      changes.push({ path, kind: "added" });
    } else if (beforeEntry.mtimeMs !== afterEntry.mtimeMs || beforeEntry.size !== afterEntry.size) {
      changes.push({ path, kind: "modified" });
    }
  }

  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) {
      changes.push({ path, kind: "deleted" });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export type ObservationInput = {
  workspaceRoot: string;
  runDir: string;
  reportedFiles: string[];
  observedChanges: ObservedChange[];
  snapshotTruncated: boolean;
  snapshotUnreadableDirs?: string[];
};

export type ObservationOutcome = {
  files: string[];
  reportedFiles: string[];
  observedChanges: ObservedChange[];
  discrepancies: string[];
};

/**
 * Merges builder self-reports with the snapshot observation into the honest-ledger
 * shape: `files` is the union view used by evaluators (existing artifacts only),
 * while discrepancies record where report and observation disagree.
 */
export function reconcileChanges(input: ObservationInput): ObservationOutcome {
  const discrepancies: string[] = [];
  const reportedRelative: string[] = [];
  const runDirFiles: string[] = [];

  for (const reported of input.reportedFiles) {
    const absolute = isAbsolute(reported)
      ? reported
      : resolve(input.workspaceRoot, reported);

    if (isInside(input.runDir, absolute)) {
      // 実行成果物（simulate のアーティファクト等）は観測対象外だが、成果物としては有効
      runDirFiles.push(absolute);
      continue;
    }
    if (!isInside(input.workspaceRoot, absolute)) {
      discrepancies.push(`reported outside workspace: ${reported}`);
      continue;
    }
    reportedRelative.push(toWorkspaceRelative(input.workspaceRoot, absolute));
  }

  const observedPaths = new Set(input.observedChanges.map((change) => change.path));
  for (const path of reportedRelative) {
    if (!observedPaths.has(path)) {
      discrepancies.push(`reported but not observed: ${path}`);
    }
  }

  const reportedSet = new Set(reportedRelative);
  for (const change of input.observedChanges) {
    if (!reportedSet.has(change.path)) {
      discrepancies.push(`observed but not reported (${change.kind}): ${change.path}`);
    }
  }

  if (input.snapshotTruncated) {
    discrepancies.push(
      `workspace snapshot truncated at ${MAX_SNAPSHOT_ENTRIES} entries; observation is incomplete`
    );
  }
  for (const dir of input.snapshotUnreadableDirs ?? []) {
    discrepancies.push(`workspace directory could not be observed: ${dir}`);
  }

  const existingPaths = new Set<string>();
  for (const path of reportedRelative) {
    existingPaths.add(path);
  }
  for (const change of input.observedChanges) {
    if (change.kind === "deleted") {
      existingPaths.delete(change.path);
    } else {
      existingPaths.add(change.path);
    }
  }

  return {
    files: [
      ...runDirFiles,
      ...[...existingPaths].sort().map((path) => resolve(input.workspaceRoot, path))
    ],
    reportedFiles: reportedRelative,
    observedChanges: input.observedChanges,
    discrepancies
  };
}

export function applyObservation(
  builder: BuilderResult,
  outcome: ObservationOutcome
): BuilderResult {
  return {
    ...builder,
    files: outcome.files,
    reportedFiles: outcome.reportedFiles,
    observedChanges: outcome.observedChanges,
    discrepancies: outcome.discrepancies
  };
}

export function normalizeFindingResponses(value: unknown): FindingResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const responses: FindingResponse[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.findingId !== "string") {
      continue;
    }
    const status = candidate.status;
    if (status !== "fixed" && status !== "rejected" && status !== "unable") {
      continue;
    }
    responses.push({
      findingId: candidate.findingId,
      status,
      note: typeof candidate.note === "string" && candidate.note !== "" ? candidate.note : undefined
    });
  }
  return responses;
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return relative(workspaceRoot, absolutePath).split(sep).join("/");
}

function isInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  // ".." そのものか "../" 始まりのみを外側と判定する。startsWith("..") だけでは
  // "..foo" のような正当なディレクトリ名まで外側扱いしてしまう。
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
