# Architecture

## Purpose

Auto Goal Runner turns a `GOAL.md` file into a controlled improvement loop. The goal is not unrestricted autonomy. The goal is a repeatable orchestration layer where specialized agents, deterministic evaluators, and safety policy cooperate through files and structured reports.

## Core Idea

Do not let Codex and Claude talk to each other indefinitely. Let them exchange artifacts.

```text
GOAL.md
  -> Goal Parser
  -> Planner
  -> Codex-style Builder
  -> Deterministic Evaluators
  -> Claude-style Reviewer
  -> Repair Instructions
  -> Codex-style Builder
  -> ...
```

Each step writes a structured artifact into `runs/<run-id>/`. The orchestrator reads those artifacts and decides whether to continue, stop, ask the user, or fail.

## Components

### Goal Parser

Reads `GOAL.md`, extracts known sections, and produces `normalized-goal.json`.

### Orchestrator

Owns the state machine:

```text
normalize -> plan -> build -> evaluate -> review -> repair -> stop
```

It also enforces iteration limits, repeated-failure limits, and policy gates.

### Agent Adapters

Adapters isolate provider-specific behavior.

- `CodexAdapter`: implementation, file edits, tests, repairs.
- `ClaudeAdapter`: planning, critique, UX review, QA findings.
- `SimulatedAdapter`: deterministic local mode for development and tests.

Real adapters should return structured JSON and write raw transcripts separately.

### Evaluators

Evaluators must be deterministic where possible. Examples:

- command evaluator: `npm test`, `npm run build`
- Playwright evaluator: browser smoke tests and screenshots
- artifact evaluator: required files exist
- visual evaluator: screenshots, layout, pixel checks
- LLM judge: only for subjective quality after deterministic checks

### Policy Engine

The policy engine blocks or requires approval for:

- destructive file operations outside the workspace
- publishing, deployment, payments, subscriptions
- credential creation or transmission
- third-party communication
- unknown shell commands in external mode

## Why Artifacts Instead Of Direct Agent Chat

Artifact exchange gives the system:

- replayable runs
- diffable outputs
- resumability
- provider independence
- clearer failure diagnosis
- easier cost and rate-limit tracking

Direct agent chat is useful for brainstorming, but production automation needs a ledger.

## MVP Boundary

The first version should support:

- local `GOAL.md`
- simulate mode
- run directory creation
- one or more loop iterations
- final report
- unit tests

After that, add real Codex/Claude adapters.

