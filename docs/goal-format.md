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
- `Workspace`
- `Inputs`
- `Reference URLs`
- `Out of Scope`
- `Preferred Stack`
- `Manual Approval Required For`

### Workspace

The directory the deliverable lives in, relative to the goal file's directory (absolute paths also work):

```md
## Workspace
./site
```

If omitted, the goal file's directory is the workspace. The CLI flag `--workspace <dir>` (relative to the invocation directory) overrides both. The builder, evaluators, observed-diff collection, and reviewer all operate on this one resolved directory.

### Manual Approval Required For

Goal-specific policy gates as fixed categories, one per line:

```md
## Manual Approval Required For
- publish
- deploy
- network-write
- destructive-filesystem
```

When a verification command matches a listed category, the run stops with `A policy-gated action is required.` instead of executing it. Unknown commands and commands containing shell operators are gated by default whenever verification commands are executed, in every mode (see `docs/architecture.md`, Policy Engine). Unknown category names are an error, so a typo cannot silently disable a gate.

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

