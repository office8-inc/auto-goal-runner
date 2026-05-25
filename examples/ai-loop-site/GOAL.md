# Goal

## Objective

Redesign this web page into a premium, modern, ultra-high-tech showcase for the Codex and Claude self-improvement loop. The page should feel closer to an award-site interactive technology experience than a normal SaaS landing page.

## Loop Mode

External Claude Creative Director + Visual QA + Codex Repair.

The implementation loop for this goal is:

1. Codex implements a repair pass in the workspace.
2. Playwright verifies desktop, mobile, console, and WebGL rendering.
3. The runner is executed in `external` mode so `claude -p` acts as a strict creative director.
4. Claude reviews the source files and Playwright screenshots through read-only access, then returns structured review JSON.
5. If Claude is not actually called, times out, cannot inspect evidence, or returns malformed JSON, the run fails.
6. Codex repairs blocking Claude findings and repeats the loop.

`simulate` mode is not acceptable evidence for this goal. It can be used only for runner tests, not for claiming the design loop passed.

## Deliverable Type

web-app

## Target User

Developers, AI automation consultants, and technical buyers who want to understand a goal-driven multi-agent build system within the first few seconds.

## Acceptance Criteria

- The first viewport communicates "GOAL.md driven Codex and Claude loop" immediately.
- The Codex-generated abstract hero image at `assets/hero-ai-loop-abstract.png` is used as the cinematic base visual.
- A full-bleed persistent Three.js scene renders across the experience, is animated, reacts to pointer movement, and changes with scroll position.
- The Three.js scene includes custom shader materials, bloom-like postprocessing, animated packet flow, and a visible Codex -> evaluator -> Claude -> repair topology.
- The page includes a high-tech interaction model for loop patterns, evaluator gates, and execution telemetry.
- The design references current award-site patterns: immersive WebGL, strong editorial typography, visible interaction, dense but readable system information, and performance-conscious animation.
- The interface includes choreographed reveal, active step telemetry, hover/magnetic microinteractions, and no generic white SaaS section.
- Claude external review reports no blocking creative/design findings.
- Any final claim that "Claude participated" must point to a run directory containing raw Claude prompt, raw Claude response, and Playwright screenshot artifacts.
- The layout works at desktop and mobile widths without text overlap.
- The page can run locally with a simple static HTTP server.

## Constraints

- Keep the site static: HTML, CSS, JavaScript, generated image, and npm-installed Three.js only.
- Do not use external CDNs.
- Do not add third-party trackers, analytics, or remote assets.
- Keep the generated image under `assets/`.
- Use Three.js via a local npm dependency.
- If additional images are needed, Codex must generate them during the run and copy them into the project.

## Research Inputs

- Awwwards Three.js and WebGL collections.
- Web Design Awards Three.js technology index.
- mesh3d gallery for curated 3D web references.
- Three.js official documentation for renderer, camera, animation loop, and resize handling.

## Verification Commands

- npm run site:check

## Evidence Commands

- npm run start -- run --goal examples/ai-loop-site/GOAL.md --mode external --max-iterations 1 --run-verification-commands

## Stop Conditions

- The page renders locally.
- Playwright can inspect the local page without blocking errors.
- Desktop and mobile screenshots show the Three.js layer and readable content.
- The external Claude review has no blocking findings.
