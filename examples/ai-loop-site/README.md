# AI Loop Site Demo

This is a static demo website generated from `GOAL.md`.

It demonstrates the intended product story for Auto Goal Runner:

```text
GOAL.md -> Codex workspace repair -> evaluators -> real Claude CLI review -> Codex repair loop
```

The current runner can call Claude through `claude -p` in `external` mode for planning and review. It does not yet call a Codex CLI build adapter from inside the runner; Codex repairs are performed by the active Codex session, then the runner records deterministic checks and Claude findings.

The page uses a bundled local Three.js build at `dist/site-bundle.js`. Serve it over HTTP; do not open `index.html` directly from the filesystem.

## Run

From the repository root:

```bash
npm install
npm run site:serve
```

Then open:

```text
http://127.0.0.1:4173/examples/ai-loop-site/
```

## GitHub Pages

After pushing to `main`, GitHub Actions publishes the static demo at:

```text
https://office8-inc.github.io/auto-goal-runner/
```

The Pages artifact contains only `index.html`, `styles.css`, `assets/`, and `dist/site-bundle.js`.

## Evidence Loop

From the repository root:

```bash
npm run start -- run --goal examples/ai-loop-site/GOAL.md --mode external --max-iterations 1 --run-verification-commands
```

The run directory should contain `claude-plan-0-*` and `claude-review-1-*` artifacts. A `simulate` run is not enough evidence for this demo goal.

## Asset

`assets/hero-ai-loop-abstract.png` is the Codex-generated abstract raster hero image for this demo. The earlier robot workspace image is kept under `assets/hero-ai-loop.png` as source history, but the current design uses the abstract image.
