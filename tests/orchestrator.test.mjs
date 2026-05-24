import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGoal } from "../dist/orchestrator.js";

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

