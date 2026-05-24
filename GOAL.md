# Goal

## Objective

Build a tiny browser game landing page prototype that demonstrates the Codex and Claude self-improvement loop architecture.

## Deliverable Type

web-app

## Target User

An individual developer evaluating whether Codex and Claude can cooperate on goal-driven project generation.

## Acceptance Criteria

- A plan is produced from this goal.
- A builder pass creates a visible artifact.
- A reviewer pass produces actionable findings.
- Evaluators run and report pass/fail status.
- The final report explains whether the run stopped because it passed, failed, or hit a stop condition.

## Constraints

- Start in simulate mode.
- Do not call external paid APIs by default.
- Do not publish, deploy, delete, or transmit sensitive data without explicit approval.
- Keep generated artifacts inside the run directory.

## Verification Commands

- npm run build
- npm test

## Stop Conditions

- All acceptance criteria pass.
- 2 iterations complete.
- The same failing evaluator appears twice.
- A policy-gated action is required.

