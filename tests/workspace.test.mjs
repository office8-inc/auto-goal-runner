import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  captureWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  reconcileChanges,
  resolveWorkspaceRoot
} from "../dist/workspace.js";

const baseGoal = {
  objective: "Test goal",
  deliverableType: "web-app",
  acceptanceCriteria: [],
  constraints: [],
  verificationCommands: [],
  stopConditions: [],
  manualApprovalCategories: [],
  rawSections: {}
};

test("resolveWorkspaceRoot prefers the CLI override, then the goal section, then the goal directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "agr-ws-"));
  const goalDir = join(root, "goals");
  const fromGoal = join(root, "from-goal");
  const fromFlag = join(root, "from-flag");
  await mkdir(goalDir, { recursive: true });
  await mkdir(fromGoal, { recursive: true });
  await mkdir(fromFlag, { recursive: true });
  const goalPath = join(goalDir, "GOAL.md");
  await writeFile(goalPath, "# Goal", "utf8");

  const options = { goalPath, cwd: root, mode: "simulate", maxIterations: 1, runVerificationCommands: false };

  assert.equal(
    resolveWorkspaceRoot({ ...baseGoal, workspace: "../from-goal" }, options),
    resolve(fromGoal)
  );
  assert.equal(
    resolveWorkspaceRoot(
      { ...baseGoal, workspace: "../from-goal" },
      { ...options, workspaceOverride: "from-flag" }
    ),
    resolve(fromFlag)
  );
  assert.equal(resolveWorkspaceRoot(baseGoal, options), resolve(goalDir));

  await rm(root, { recursive: true, force: true });
});

test("resolveWorkspaceRoot rejects a missing directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "agr-ws-"));
  const goalPath = join(root, "GOAL.md");
  await writeFile(goalPath, "# Goal", "utf8");

  assert.throws(
    () =>
      resolveWorkspaceRoot(
        { ...baseGoal, workspace: "./does-not-exist" },
        { goalPath, cwd: root, mode: "simulate", maxIterations: 1, runVerificationCommands: false }
      ),
    /does not exist/
  );

  await rm(root, { recursive: true, force: true });
});

test("snapshot diff detects added, modified, and deleted files and skips excluded dirs", async () => {
  const root = await mkdtemp(join(tmpdir(), "agr-snap-"));
  await writeFile(join(root, "keep.txt"), "same", "utf8");
  await writeFile(join(root, "change.txt"), "before", "utf8");
  await writeFile(join(root, "remove.txt"), "bye", "utf8");
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored", "utf8");

  const before = captureWorkspaceSnapshot(root);

  await writeFile(join(root, "added.txt"), "new", "utf8");
  await writeFile(join(root, "change.txt"), "after-with-different-size", "utf8");
  await rm(join(root, "remove.txt"));
  // 除外ディレクトリ内の変更は観測されないことも確認する
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "changed but ignored", "utf8");

  const after = captureWorkspaceSnapshot(root);
  const changes = diffWorkspaceSnapshots(before, after);

  assert.deepEqual(
    changes.map((change) => `${change.kind}:${change.path}`),
    ["added:added.txt", "modified:change.txt", "deleted:remove.txt"]
  );

  await rm(root, { recursive: true, force: true });
});

test("snapshot diff detects same-size mtime-only changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "agr-snap-"));
  const file = join(root, "same-size.txt");
  await writeFile(file, "aaaa", "utf8");
  const before = captureWorkspaceSnapshot(root);

  await writeFile(file, "bbbb", "utf8");
  await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));

  const after = captureWorkspaceSnapshot(root);
  const changes = diffWorkspaceSnapshots(before, after);
  assert.deepEqual(changes, [{ path: "same-size.txt", kind: "modified" }]);

  await rm(root, { recursive: true, force: true });
});

test("reconcileChanges records discrepancies in both directions", () => {
  const workspaceRoot = resolve("/ws");
  const runDir = resolve("/runner/runs/x");
  const outcome = reconcileChanges({
    workspaceRoot,
    runDir,
    reportedFiles: ["index.html", "ghost.txt", "../outside.txt", join(runDir, "report.md")],
    observedChanges: [
      { path: "index.html", kind: "modified" },
      { path: "unreported.css", kind: "added" }
    ],
    snapshotTruncated: false
  });

  assert.ok(outcome.discrepancies.some((item) => item.includes("reported but not observed: ghost.txt")));
  assert.ok(outcome.discrepancies.some((item) => item.includes("observed but not reported (added): unreported.css")));
  assert.ok(outcome.discrepancies.some((item) => item.includes("reported outside workspace")));
  // runDir 配下の報告は不一致として数えない
  assert.ok(!outcome.discrepancies.some((item) => item.includes("report.md")));
  // files は存在するはずの成果物の絶対パス
  assert.ok(outcome.files.includes(resolve(workspaceRoot, "index.html")));
  assert.ok(outcome.files.includes(resolve(workspaceRoot, "unreported.css")));
});

test("reconcileChanges drops deleted files from the evaluator view", () => {
  const workspaceRoot = resolve("/ws");
  const outcome = reconcileChanges({
    workspaceRoot,
    runDir: resolve("/runner/runs/x"),
    reportedFiles: ["gone.txt"],
    observedChanges: [{ path: "gone.txt", kind: "deleted" }],
    snapshotTruncated: false
  });

  assert.deepEqual(outcome.files, []);
});

test("reconcileChanges keeps runDir artifacts in files and never falls back to raw relative paths", () => {
  const workspaceRoot = resolve("/ws");
  const runDir = resolve("/runner/runs/x");

  // 削除のみのビルドパス: files は空のままでなければならない（生の相対パスへ戻さない）
  const deletionOnly = reconcileChanges({
    workspaceRoot,
    runDir,
    reportedFiles: ["gone.txt"],
    observedChanges: [{ path: "gone.txt", kind: "deleted" }],
    snapshotTruncated: false
  });
  assert.deepEqual(deletionOnly.files, []);

  // runDir 配下の成果物（simulate 等）は絶対パスのまま files に残る
  const runDirArtifact = reconcileChanges({
    workspaceRoot,
    runDir,
    reportedFiles: [join(runDir, "artifact", "index.html")],
    observedChanges: [],
    snapshotTruncated: false
  });
  assert.deepEqual(runDirArtifact.files, [join(runDir, "artifact", "index.html")]);
  assert.deepEqual(runDirArtifact.discrepancies, []);
});

test("reconcileChanges does not misclassify dot-dot-prefixed directory names as outside", () => {
  const workspaceRoot = resolve("/ws");
  const outcome = reconcileChanges({
    workspaceRoot,
    runDir: resolve("/runner/runs/x"),
    reportedFiles: ["..config/settings.json"],
    observedChanges: [{ path: "..config/settings.json", kind: "added" }],
    snapshotTruncated: false
  });
  assert.ok(!outcome.discrepancies.some((item) => item.includes("outside workspace")));
  assert.ok(outcome.files.includes(resolve(workspaceRoot, "..config/settings.json")));
});

test("unreadable snapshot directories surface as discrepancies", () => {
  const outcome = reconcileChanges({
    workspaceRoot: resolve("/ws"),
    runDir: resolve("/runner/runs/x"),
    reportedFiles: [],
    observedChanges: [],
    snapshotTruncated: false,
    snapshotUnreadableDirs: ["locked-dir"]
  });
  assert.ok(outcome.discrepancies.some((item) => item.includes("locked-dir")));
});
