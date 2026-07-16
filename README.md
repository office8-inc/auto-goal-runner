# Auto Goal Runner

`Auto Goal Runner` is a local orchestration prototype for a goal-driven `Codex <-> Claude` improvement loop.

The intended workflow is:

1. Write `GOAL.md`.
2. Run the orchestrator.
3. Let Codex-style builder passes create or modify artifacts.
4. Let Claude-style reviewer passes critique the output.
5. Run deterministic evaluators.
6. Repeat until acceptance criteria pass or a stop condition is reached.

The default `simulate` mode is a safe deterministic demo that calls no external APIs. The `external` mode runs the real loop: Claude CLI (`claude -p --output-format json`) plans and reviews, Codex CLI (`codex exec --json --output-schema`) builds and repairs, and deterministic evaluators gate every iteration.

## Quick Start

```bash
npm install
npm run build
npm test
npm run demo
```

Or run directly:

```bash
npm run start -- run --goal GOAL.md --mode simulate --max-iterations 2
```

The runner writes artifacts under `runs/`.

## Demo Site And GitHub Pages

The demo page lives in `examples/ai-loop-site/`.

```bash
npm run site:check
```

`site:check` bundles the local Three.js page, starts a temporary static server, captures desktop and mobile screenshots with Playwright, and verifies the WebGL scene reports frames, four topology nodes, and four packet curves.

GitHub Pages is deployed by `.github/workflows/pages.yml`. The workflow publishes only the static demo directory, not local run artifacts, environment files, `node_modules`, or screenshots.

## Repository Shape

```text
docs/
  architecture.md
  loop-patterns.md
  goal-format.md
src/
  cli.ts
  goal-parser.ts
  orchestrator.ts
  adapters/
  evaluators/
  types.ts
tests/
GOAL.md
```

## Modes

- `simulate`: deterministic local demo mode. No external agent calls.
- `external`: the real loop. Claude CLI plans and reviews, Codex CLI builds and repairs. Requires both CLIs installed and authenticated. This is intentionally not the default.

```bash
npm run start -- run --goal GOAL.md --mode external --max-iterations 2 --run-verification-commands
```

### External mode environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTO_GOAL_CLAUDE_COMMAND` | auto-detected | Claude executable path |
| `AUTO_GOAL_CLAUDE_MODEL` | `sonnet` | Claude model alias |
| `AUTO_GOAL_CLAUDE_EFFORT` | `high` | Claude effort level |
| `AUTO_GOAL_CLAUDE_MAX_BUDGET_USD` | `2.50` | Budget cap per Claude call |
| `AUTO_GOAL_CLAUDE_TIMEOUT_MS` | `180000` | Timeout per Claude call |
| `AUTO_GOAL_CODEX_COMMAND` | auto-detected | Codex executable path |
| `AUTO_GOAL_CODEX_MODEL` | Codex config default | Codex model override |
| `AUTO_GOAL_CODEX_SANDBOX` | `workspace-write` | `workspace-write` \| `danger-full-access` \| `bypass` |
| `AUTO_GOAL_CODEX_TIMEOUT_MS` | `1200000` | Timeout per Codex build pass |
| `AUTO_GOAL_COMMAND_TIMEOUT_MS` | `600000` | Timeout per verification command |

Sandbox note: on Windows the Codex CLI sandbox denies workspace writes without UAC elevation, so unattended Windows runs need the explicit `bypass` opt-in (`--codex-sandbox bypass` or `AUTO_GOAL_CODEX_SANDBOX=bypass`). The effective sandbox is always recorded in the run artifacts. See `docs/architecture.md` for what `bypass` does and does not protect.

### Workspace

The builder edits one resolved workspace directory: `--workspace <dir>` > `## Workspace` in `GOAL.md` > the goal file's directory. All evaluators, diffs, and reviews use the same directory.

## Current Scope

This project is not a promise of full autonomy. It is a controlled automation framework. "Anything" should be added through deliverable-specific templates, evaluators, and policy rules. Verification commands pass through a default-deny policy gate before execution (`docs/architecture.md`, Policy Engine).
