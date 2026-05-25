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

- `CodexAdapter`: implementation, file edits, tests, repairs. This is still a future adapter because the local Windows app executable is not callable from this runner in the current environment.
- `ClaudeAdapter`: planning, critique, UX review, QA findings through `claude -p`.
- `SimulatedAdapter`: deterministic local mode for development and tests.

Real adapters should return structured JSON and write raw transcripts separately.

`external` mode must not silently fall back to simulated Claude behavior. If the Claude CLI is unavailable, times out, exceeds the configured budget, or returns malformed JSON, the run fails. This keeps the run ledger honest: a report that says `Mode: external` means Claude actually participated in the planning and review steps.

Until a callable Codex CLI adapter is available, the external loop is:

```text
Codex app/user edits workspace
  -> auto-goal-runner external mode
  -> Claude CLI plan/review gate
  -> deterministic evaluators
  -> final report with blocking findings
  -> Codex app/user repairs
  -> repeat
```

That is a real Claude quality gate, but not yet a fully autonomous Codex CLI build loop.

### Evaluators

Evaluators must be deterministic where possible. Examples:

- command evaluator: `npm test`, `npm run build`
- Playwright evaluator: browser smoke tests, screenshots, console checks, and WebGL pixel checks
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

## Current Boundary

The current version supports:

- local `GOAL.md`
- simulate mode
- external Claude CLI plan/review mode
- run directory creation
- one or more loop iterations
- final report
- unit tests

Next adapter work:

- add a callable Codex build/repair adapter once the local Codex executable can be invoked safely from this runner
- add visual-score thresholds so subjective design goals do not pass on command checks alone

For static web goals, `npm run site:check` writes browser evidence into the current run directory when `SITE_CHECK_OUTPUT_DIR` is set:

- `site-check/screenshots/desktop.png`
- `site-check/screenshots/mobile.png`
- `site-check/site-check-summary.json`

The external Claude review step may use read-only file access to inspect source files and these screenshots. It must not edit files or run shell commands.
