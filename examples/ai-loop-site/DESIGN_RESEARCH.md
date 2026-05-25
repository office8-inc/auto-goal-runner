# Design Research

## Sources Checked

- Awwwards has dedicated Three.js and WebGL collections that emphasize animated 3D graphics, WebGL transitions, scroll interactions, sliders, and immersive digital spaces.
- Web Design Awards indexes award-nominated Three.js sites and describes the category as cutting-edge web graphics spanning interactive product showcases and generative art experiences.
- mesh3d is a curated gallery focused on interactive, real-time Three.js and WebGL websites.
- Three.js official documentation confirms the core implementation pattern used here: `WebGLRenderer`, `PerspectiveCamera`, scene lighting, animation loops, and responsive resize handling.

## Design Decisions

- Use the generated abstract raster image as the cinematic environment, not as a small card or stock-style scene.
- Use a persistent full-bleed Three.js canvas as the primary design object rather than a decorative hero overlay.
- Move the page through scene acts with scroll progress: Goal, Spec, Build, Evaluate, Review, Repair.
- Keep content dense and operational: loop patterns, gates, telemetry, and commands are visible instead of generic marketing copy.
- Use multiple accent colors rather than a one-note palette: amber for Codex/build, cyan for Claude/review, green for evaluator pass states, rose for policy stops.
- Avoid external CDNs; Three.js is loaded from the local npm dependency.
- Remove the generic light SaaS break. Keep the experience immersive and coherent.

## Practical Guardrails

- Animation must remain lightweight: particles, torus loops, lines, and instanced packets rather than heavy 3D models.
- Mobile should keep the 3D layer visible but lower visual density through CSS and renderer pixel-ratio limits.
- Browser console must stay free of blocking errors.
- The render loop should pause when the tab is hidden and respect `prefers-reduced-motion`.
