import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGoal, resolveIterationOutcome } from "../dist/orchestrator.js";

test("runGoal completes a simulated run and writes reports", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-goal-runner-"));
  const goalPath = join(cwd, "GOAL.md");
  await writeFile(
    goalPath,
    `# Goal

## Objective
Build a local artifact.

## Deliverable Type
web-app

## Acceptance Criteria
- A plan is produced.
- A builder pass creates files.

## Verification Commands
- npm test

## Stop Conditions
- All acceptance criteria pass.
`,
    "utf8"
  );

  const result = await runGoal({
    goalPath,
    mode: "simulate",
    maxIterations: 2,
    runVerificationCommands: false,
    cwd
  });

  assert.equal(result.status, "passed");
  assert.equal(result.iterations.length, 1);
  assert.ok(existsSync(join(result.runDir, "final-report.md")));
  assert.ok(existsSync(join(result.runDir, "artifact", "index.html")));

  await rm(cwd, { recursive: true, force: true });
});


test("runGoal stops before planning when a verification command is policy-gated", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-goal-runner-"));
  const goalPath = join(cwd, "GOAL.md");
  await writeFile(
    goalPath,
    `# Goal

## Objective
Build a local artifact.

## Acceptance Criteria
- A plan is produced.

## Verification Commands
- npm publish
`,
    "utf8"
  );

  const result = await runGoal({
    goalPath,
    mode: "simulate",
    maxIterations: 1,
    runVerificationCommands: true,
    cwd
  });

  assert.equal(result.status, "stopped");
  assert.match(result.stopReason, /policy-gated/);
  assert.equal(result.iterations.length, 0);
  assert.equal(result.policyChecks[0].decision, "deny");
  assert.ok(existsSync(join(result.runDir, "policy-checks.json")));

  await rm(cwd, { recursive: true, force: true });
});

test("resolveIterationOutcome refuses to pass an unverified external run", () => {
  const cleanReview = { summary: "ok", findings: [] };
  const skipped = [
    { name: "command:npm test", status: "skip", summary: "skipped" }
  ];

  const externalOutcome = resolveIterationOutcome(skipped, cleanReview, "external");
  assert.equal(externalOutcome.status, "stopped");
  assert.match(externalOutcome.stopReason, /skipped/);

  const simulateOutcome = resolveIterationOutcome(skipped, cleanReview, "simulate");
  assert.equal(simulateOutcome.status, "passed");

  const failing = [{ name: "command:npm test", status: "fail", summary: "boom" }];
  assert.equal(resolveIterationOutcome(failing, cleanReview, "external"), undefined);
});

test("runGoal records observed changes for workspace edits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "auto-goal-runner-"));
  const goalPath = join(cwd, "GOAL.md");
  await writeFile(
    goalPath,
    `# Goal

## Objective
Build a local artifact.

## Acceptance Criteria
- A builder pass creates files.
`,
    "utf8"
  );

  const result = await runGoal({
    goalPath,
    mode: "simulate",
    maxIterations: 1,
    runVerificationCommands: false,
    cwd
  });

  const builder = result.iterations[0].builder;
  // simulate は runDir 内にのみ書くので、workspace の観測差分と不一致はゼロのはず
  assert.deepEqual(builder.observedChanges, []);
  assert.deepEqual(builder.discrepancies, []);
  assert.equal(result.workspaceRoot, cwd);

  await rm(cwd, { recursive: true, force: true });
});
