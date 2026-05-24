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

