import test from "node:test";
import assert from "node:assert/strict";
import { parseGoalMarkdown } from "../dist/goal-parser.js";

test("parseGoalMarkdown extracts core sections", () => {
  const goal = parseGoalMarkdown(`# Goal

## Objective
Build a tool.

## Deliverable Type
web-app

## Acceptance Criteria
- It builds.
- It runs.

## Constraints
- No deploy.

## Verification Commands
- npm test

## Stop Conditions
- All acceptance criteria pass.
`);

  assert.equal(goal.objective, "Build a tool.");
  assert.equal(goal.deliverableType, "web-app");
  assert.deepEqual(goal.acceptanceCriteria, ["It builds.", "It runs."]);
  assert.deepEqual(goal.constraints, ["No deploy."]);
  assert.deepEqual(goal.verificationCommands, ["npm test"]);
  assert.deepEqual(goal.stopConditions, ["All acceptance criteria pass."]);
});

test("parseGoalMarkdown rejects missing objective", () => {
  assert.throws(() => parseGoalMarkdown("# Goal\n\n## Deliverable Type\ncustom"), /Objective/);
});

test("parseGoalMarkdown extracts workspace and manual approval sections", () => {
  const goal = parseGoalMarkdown(`# Goal

## Objective
Build a tool.

## Workspace
./site

## Manual Approval Required For
- Publish
- network-write
`);

  assert.equal(goal.workspace, "./site");
  assert.deepEqual(goal.manualApprovalCategories, ["publish", "network-write"]);
});

test("parseGoalMarkdown leaves workspace undefined when absent", () => {
  const goal = parseGoalMarkdown("# Goal\n\n## Objective\nBuild a tool.\n");
  assert.equal(goal.workspace, undefined);
  assert.deepEqual(goal.manualApprovalCategories, []);
});

