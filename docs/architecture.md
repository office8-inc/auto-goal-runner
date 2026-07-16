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

### Workspace Root

Every run has one canonical `workspaceRoot` — the directory the deliverable lives in. It is resolved in this order:

1. `--workspace <dir>` on the CLI (relative to the invocation directory).
2. `## Workspace` in `GOAL.md` (relative to the goal file's directory).
3. The goal file's directory.

The same resolved absolute path is passed everywhere it matters: `codex exec -C`, the filesystem snapshot observation, the verification command cwd, the Claude review context, and relative-path resolution of builder results. The path must exist and is canonicalized before the run starts. Run artifacts stay under the runner's `runs/` directory and are excluded from workspace observation.

### Orchestrator

Owns the state machine:

```text
normalize -> plan -> build -> evaluate -> review -> repair -> stop
```

It also enforces iteration limits, repeated-failure limits, and policy gates.

### Agent Adapters

Adapters isolate provider-specific behavior.

- `CodexAdapter`: implementation, file edits, tests, repairs through `codex exec` (non-interactive Codex CLI).
- `ClaudeAdapter`: planning, critique, UX review, QA findings through `claude -p`.
- `SimulatedAdapter`: deterministic local mode for development and tests.

Real adapters return structured JSON and write raw transcripts separately.

`external` mode must not silently fall back to simulated behavior. If the Claude CLI or Codex CLI is unavailable, times out, exceeds the configured budget, exits non-zero, or returns malformed JSON, the run fails hard. This keeps the run ledger honest: a report that says `Mode: external` means Claude actually planned and reviewed, and Codex actually built.

The external loop is:

```text
GOAL.md
  -> Claude CLI plan
  -> Codex CLI build (codex exec, structured output)
  -> observed workspace diff (git status or filesystem snapshot)
  -> deterministic evaluators (policy-gated)
  -> Claude CLI review gate
  -> repair instructions (findings with stable IDs)
  -> Codex CLI repair pass
  -> repeat until pass / stop condition
```

#### Codex build adapter

The builder pass invokes `codex exec` with:

- `-C <workspaceRoot>` so Codex works inside the resolved workspace only.
- `--output-schema` so the final message is a machine-readable `{ summary, files, notes, findingResponses }` object.
- `-o <runDir>/codex-build-<i>-last-message.json` for the structured result.
- `--json` events streamed to `<runDir>/codex-build-<i>-events.jsonl` for the audit trail.
- `--ephemeral --skip-git-repo-check` so each iteration is reproducible from run artifacts alone.

Sandbox selection is explicit and recorded in the run ledger (`codex-build-<i>-meta.json`):

- Default: `workspace-write`.
- `danger-full-access` and `bypass` (`--dangerously-bypass-approvals-and-sandbox`) must be opted into via `--codex-sandbox` or `AUTO_GOAL_CODEX_SANDBOX`. The runner never falls back to a weaker sandbox on failure.
- Known limitation: on Windows, the Codex CLI sandbox denies workspace writes unless the elevated sandbox (UAC prompt) is available. Unattended Windows runs therefore require the explicit `bypass` opt-in. The build meta artifact records the effective sandbox so the ledger shows what actually ran.

#### Reported vs observed changes

Builder self-reports are not trusted as the only evidence. The runner records:

- `reportedFiles`: what the builder claims it changed (from the structured output).
- `observedChanges`: what actually changed, from a bounded filesystem snapshot diff (mtime + size) taken immediately before and after the build pass. Snapshots work identically for git and non-git workspaces and are unaffected by pre-existing dirty files, because only files that changed *during* the build appear in the diff.
- `discrepancies`: reported-but-not-observed and observed-but-not-reported paths, plus out-of-workspace reports.

Discrepancies do not silently fail the run; they are recorded in the iteration artifact and surfaced to the reviewer. The run directory, `.git`, and `node_modules` are always excluded from observation. The snapshot diff is a bounded prototype (entry-count limit, no content hashing — a same-size same-mtime rewrite is not detected) and is documented as such.

#### Repair loop

Review findings carry stable IDs (`f<iteration>-<n>`). The next build prompt includes:

- the previous findings with IDs,
- the failed evaluations with log tails,
- the previous observed diff.

Codex must answer each finding in `findingResponses` with `fixed`, `rejected`, or `unable`, which is stored in the iteration artifact.

### Evaluators

Evaluators must be deterministic where possible. Examples:

- command evaluator: `npm test`, `npm run build`
- Playwright evaluator: browser smoke tests, screenshots, console checks, and WebGL pixel checks
- artifact evaluator: required files exist
- visual evaluator: screenshots, layout, pixel checks
- LLM judge: only for subjective quality after deterministic checks

### Policy Engine

`src/policy.ts` gates every verification command before it is executed. Each command gets a three-way decision:

- `allow`: matches a known-safe profile (`npm test`, `npm run <script>`, `npx tsc`, `node <script>`, `tsc`, `vitest`, `jest`, `playwright test`, and similar local build/test invocations).
- `deny`: matches a destructive or outward-facing pattern (publishing, deployment, pushes, package publishing, payments, credential access, recursive deletes, piping remote scripts into a shell).
- `requiresApproval`: everything else. Unknown commands are not executed (default-deny).

`deny` and `requiresApproval` stop the run with `A policy-gated action is required.` and the decision, rule, and command are recorded in the run ledger. `## Manual Approval Required For` entries in `GOAL.md` add goal-specific gate categories.

Scope honesty: this policy gates what the *runner* executes (verification commands). It cannot constrain what Codex itself runs inside its own build session; that is what the Codex sandbox setting is for. In `bypass` mode the build prompt still instructs Codex to stay inside the workspace and avoid outward-facing commands, but this is an instruction, not a boundary — which is why `bypass` is opt-in and recorded.

In external mode a run whose required verification commands were skipped (run without `--run-verification-commands`) is reported as `stopped` (unverified), never `passed`.

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

- local `GOAL.md` with workspace resolution
- simulate mode
- external mode: Claude CLI plan/review + Codex CLI build/repair
- reported vs observed change tracking with discrepancy recording
- default-deny command policy with goal-specific gates
- run directory creation, per-iteration artifacts, final report
- unit tests

Known limitations (accepted for the prototype, recorded here so they are not mistaken for guarantees):

- The filesystem snapshot diff uses mtime + size with bounded file counts, not content hashes. Symlinks and junctions are neither followed nor recorded.
- Child processes (Claude CLI, Codex CLI) inherit the runner's environment. Do not run goals in an environment holding credentials you would not hand to those tools.
- The Claude review step has `Read`/`Glob` tools without a path allowlist; excerpts are curated and secret-like paths are excluded, but the reviewer could read other local files if prompted to. Treat review prompts as trusted input.
- The repeated-failure stop condition compares evaluator names only, not failure fingerprints; a run that is improving can still be stopped. Tune `--max-iterations` for longer repair loops.
- When the run directory sits inside the builder-writable workspace (the default single-directory layout), the builder could tamper with run artifacts. The runner warns and records this in the final report; separate `--workspace` from the runner directory when the ledger must be trustworthy.

Next work:

- add visual-score thresholds so subjective design goals do not pass on command checks alone
- failure fingerprints for the repeated-failure stop condition

For static web goals, `npm run site:check` writes browser evidence into the current run directory when `SITE_CHECK_OUTPUT_DIR` is set:

- `site-check/screenshots/desktop.png`
- `site-check/screenshots/mobile.png`
- `site-check/site-check-summary.json`

The external Claude review step may use read-only file access to inspect source files and these screenshots. It must not edit files or run shell commands.
