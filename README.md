# Auto Goal Runner

`Auto Goal Runner` is a local orchestration prototype for a goal-driven `Codex <-> Claude` improvement loop.

The intended workflow is:

1. Write `GOAL.md`.
2. Run the orchestrator.
3. Let Codex-style builder passes create or modify artifacts.
4. Let Claude-style reviewer passes critique the output.
5. Run deterministic evaluators.
6. Repeat until acceptance criteria pass or a stop condition is reached.

The current MVP ships with a safe `simulate` mode. It does not call Codex or Claude APIs by default. The code is structured so real adapters can later call `codex exec --json`, Claude Agent SDK, `claude -p --output-format json`, Playwright MCP, and other tools.

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
- `external`: reserved for real Codex/Claude adapters. This is intentionally not the default.

## Current Scope

This project is not a promise of full autonomy. It is a controlled automation framework. "Anything" should be added through deliverable-specific templates, evaluators, and policy rules.
