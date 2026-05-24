# GOAL.md Format

`GOAL.md` is the contract for a run. It should be concrete enough that the system can decide what to build, how to evaluate it, and when to stop.

## Required Sections

```md
# Goal

## Objective
What should exist when the run finishes?

## Deliverable Type
web-app | game | api-system | document | video | research | custom

## Acceptance Criteria
- Observable condition 1
- Observable condition 2

## Verification Commands
- npm run build
- npm test

## Stop Conditions
- All acceptance criteria pass.
- 3 iterations complete.
- A policy-gated action is required.
```

## Optional Sections

- `Target User`
- `Constraints`
- `Inputs`
- `Reference URLs`
- `Out of Scope`
- `Preferred Stack`
- `Manual Approval Required For`

## Good Goal

```md
## Objective
Create a browser-playable typing game for Japanese learners.

## Acceptance Criteria
- The game has start, playing, game-over states.
- Score and timer are visible.
- It works at 390px and 1280px widths.
- Playwright can start one round and finish it.
```

## Weak Goal

```md
Make something cool.
```

The runner can attempt to clarify weak goals, but autonomy improves when acceptance criteria are explicit.

