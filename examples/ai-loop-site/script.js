import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const patterns = {
  reviewer: {
    kicker: "Fast build loop",
    name: "Codex build -> Claude review -> Codex repair",
    summary:
      "実装速度を優先する標準ループ。Webサイトの初期案を出すには速いが、今回のような見た目勝負では批評が弱いと平凡になりやすい。",
    speed: "High",
    cost: "Low",
    risk: "Basic"
  },
  "test-first": {
    kicker: "Deterministic behavior loop",
    name: "Claude spec -> tests -> Codex implementation",
    summary:
      "正誤を機械判定できるAPIやCLI向け。ド派手なビジュアル品質はテストだけでは測りにくい。",
    speed: "Medium",
    cost: "Medium",
    risk: "Narrow"
  },
  visual: {
    kicker: "Browser evidence loop",
    name: "Codex UI -> Playwright capture -> Claude creative review",
    summary:
      "今回の要件に合わせたモード。見た目、動き、Canvas、レスポンシブを証拠化し、Claudeを厳しめのクリエイティブディレクターとして回す。",
    speed: "High",
    cost: "Medium",
    risk: "Best"
  },
  tournament: {
    kicker: "Parallel exploration loop",
    name: "Multiple branches -> evaluator score -> winner merge",
    summary:
      "もっと攻めるなら次はこれ。複数のビジュアル案を並列生成し、PlaywrightとClaudeで勝ち案を選ぶ。",
    speed: "Low",
    cost: "High",
    risk: "Bold"
  }
};

const fields = {
  kicker: document.querySelector("#pattern-kicker"),
  name: document.querySelector("#pattern-name"),
  summary: document.querySelector("#pattern-summary"),
  speed: document.querySelector("#metric-speed"),
  cost: document.querySelector("#metric-cost"),
  risk: document.querySelector("#metric-risk"),
  loop: document.querySelector("#telemetry-loop")
};

document.querySelectorAll(".pattern-button").forEach((button) => {
  button.addEventListener("click", () => {
    const pattern = patterns[button.dataset.pattern];
    if (!pattern) return;

    document.querySelectorAll(".pattern-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");

    fields.kicker.textContent = pattern.kicker;
    fields.name.textContent = pattern.name;
    fields.summary.textContent = pattern.summary;
    fields.speed.textContent = pattern.speed;
    fields.cost.textContent = pattern.cost;
    fields.risk.textContent = pattern.risk;
    fields.loop.textContent = button.dataset.pattern === "visual" ? "Visual QA" : pattern.name.split(" -> ")[0];
    window.dispatchEvent(new CustomEvent("patternchange", { detail: { pattern: button.dataset.pattern } }));
  });
});

const cursor = document.querySelector("#cursor-orb");
if (cursor) {
  window.addEventListener("pointermove", (event) => {
    cursor.style.transform = `translate3d(${event.clientX - 13}px, ${event.clientY - 13}px, 0)`;
  });

  document.querySelectorAll("a, button").forEach((item) => {
    item.addEventListener("pointerenter", () => cursor.classList.add("active"));
    item.addEventListener("pointerleave", () => cursor.classList.remove("active"));
  });
}

document.querySelectorAll(".magnetic").forEach((element) => {
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  element.addEventListener("pointermove", (event) => {
    const rect = element.getBoundingClientRect();
    targetX = clamp((event.clientX - rect.left - rect.width / 2) * 0.28, -8, 8);
    targetY = clamp((event.clientY - rect.top - rect.height / 2) * 0.28, -8, 8);
  });

  element.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0;
  });

  function tickMagnetic() {
    currentX += (targetX - currentX) * 0.18;
    currentY += (targetY - currentY) * 0.18;
    element.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    requestAnimationFrame(tickMagnetic);
  }

  tickMagnetic();
});

document.querySelectorAll("[data-tilt]").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 7}deg) translateY(-3px)`;
  });
  card.addEventListener("pointerleave", () => {
    card.style.transform = "";
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("in-view");
    });
  },
  { threshold: 0.18 }
);
document.querySelectorAll(".reveal").forEach((item) => revealObserver.observe(item));

const canvas = document.querySelector("#neural-canvas");
if (canvas) {
  try {
    bootThreeScene(canvas);
  } catch (error) {
    document.body.classList.add("three-fallback");
    console.error(error);
    completeLoader();
  }
}

function completeLoader() {
  const loader = document.querySelector("#loader");
  document.querySelector("#loader-count").textContent = "100";
  document.body.classList.add("ready");
  window.setTimeout(() => loader?.classList.add("hidden"), 480);
}

function bootThreeScene(canvasElement) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 0.5, 9.6);

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasElement,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setClearColor(0x000000, 0);

  canvasElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    window.__AUTO_GOAL_THREE_CONTEXT_LOST = true;
    window.__AUTO_GOAL_THREE_READY = false;
  });
  canvasElement.addEventListener("webglcontextrestored", () => {
    window.__AUTO_GOAL_THREE_CONTEXT_LOST = false;
    resize();
    window.__AUTO_GOAL_THREE_READY = true;
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.48, 0.58, 0.15);
  composer.addPass(bloomPass);
  composer.addPass(makePostPass());

  const root = new THREE.Group();
  scene.add(root);
  const coreMaterials = [];

  scene.add(new THREE.AmbientLight(0xa7efff, 1.0));
  const cyanLight = new THREE.PointLight(0x2de9ff, 70, 30);
  cyanLight.position.set(4.6, 2.4, 4);
  scene.add(cyanLight);
  const amberLight = new THREE.PointLight(0xffb43d, 58, 28);
  amberLight.position.set(-4.6, -0.8, 3.6);
  scene.add(amberLight);

  const loopGroup = new THREE.Group();
  loopGroup.scale.setScalar(2);
  root.add(loopGroup);

  const shaderMaterials = [
    makeIridescentMaterial(0x2de9ff, 0.72),
    makeIridescentMaterial(0xffb43d, 0.56),
    makeIridescentMaterial(0x45df89, 0.42)
  ];

  [
    [2.2, 0.026, 0.0, 0.0, 0.0],
    [3.15, 0.018, 0.38, 0.2, 0.18],
    [4.15, 0.014, -0.3, -0.2, -0.12]
  ].forEach(([radius, tube, rx, ry, rz], index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 24, 220), shaderMaterials[index]);
    ring.rotation.set(rx, ry, rz);
    loopGroup.add(ring);
  });

  const topology = {
    codex: new THREE.Vector3(-2.35, -0.22, 0.28),
    eval: new THREE.Vector3(0, -1.08, 0.24),
    claude: new THREE.Vector3(2.35, -0.22, 0.28),
    repair: new THREE.Vector3(0, 1.28, 0.34)
  };
  const topologyCurves = makeTopologyCurves(topology);
  window.__AUTO_GOAL_TOPOLOGY_NODES = 4;
  window.__AUTO_GOAL_PACKET_CURVES = topologyCurves.length;
  const coreGeometry = new THREE.IcosahedronGeometry(0.62, 4);
  const codexCore = makeCore(coreGeometry, 0xffb43d, topology.codex, 0);
  const evalCore = makeCore(coreGeometry, 0x45df89, topology.eval, 0.6);
  const claudeCore = makeCore(coreGeometry, 0x2de9ff, topology.claude, 1.2);
  const repairCore = makeCore(coreGeometry, 0xff4f80, topology.repair, 1.8);
  coreMaterials.push(codexCore.material, evalCore.material, claudeCore.material, repairCore.material);
  loopGroup.add(codexCore, evalCore, claudeCore, repairCore);
  loopGroup.add(
    makeNodeLabel("CODEX", 0xffb43d, topology.codex),
    makeNodeLabel("EVALUATOR", 0x45df89, topology.eval),
    makeNodeLabel("CLAUDE", 0x2de9ff, topology.claude),
    makeNodeLabel("REPAIR", 0xff4f80, topology.repair)
  );

  loopGroup.add(makeBridgeTubes(topologyCurves));

  const packets = makePackets(96, topologyCurves);
  loopGroup.add(packets.mesh);

  const startsCompact = window.matchMedia("(max-width: 768px)").matches || renderer.capabilities.maxTextureSize < 8192;
  const particles = makeParticles(startsCompact ? 360 : 1200);
  root.add(particles);

  const pointer = { x: 0, y: 0 };
  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  });

  const state = {
    scroll: 0,
    targetScroll: 0,
    running: true,
    patternBoost: 1
  };

  const updateScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    state.targetScroll = window.scrollY / max;
    updateStepTelemetry(state.targetScroll);
  };
  window.addEventListener("scroll", updateScroll, { passive: true });
  updateScroll();

  window.addEventListener("patternchange", (event) => {
    state.patternBoost = event.detail.pattern === "tournament" ? 1.55 : event.detail.pattern === "visual" ? 1.22 : 1;
  });

  document.addEventListener("visibilitychange", () => {
    state.running = document.visibilityState === "visible";
  });

  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const compact = width < 720 || renderer.capabilities.maxTextureSize < 8192;
    renderer.setPixelRatio(compact ? 1 : Math.min(window.devicePixelRatio || 1, 1.55));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloomPass.enabled = true;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    root.scale.setScalar(compact ? 0.62 : 1);
  }
  window.addEventListener("resize", resize);
  resize();

  let loaderProgress = 0;
  const loaderTimer = window.setInterval(() => {
    loaderProgress = Math.min(99, loaderProgress + 9);
    document.querySelector("#loader-count").textContent = String(loaderProgress).padStart(2, "0");
  }, 42);

  const startTime = performance.now();
  let firstFrameRendered = false;
  renderer.setAnimationLoop(() => {
    const elapsed = (performance.now() - startTime) * 0.001;
    if (!state.running) return;

    state.scroll += (state.targetScroll - state.scroll) * 0.06;
    const phase = state.scroll;

    const cameraTargets = [
      new THREE.Vector3(0.2, 0.45, 9.4),
      new THREE.Vector3(1.0, 0.0, 8.2),
      new THREE.Vector3(-1.8, 0.8, 7.2),
      new THREE.Vector3(0.0, -0.2, 6.8),
      new THREE.Vector3(1.8, 0.35, 7.4)
    ];
    const segment = Math.min(cameraTargets.length - 2, Math.floor(phase * (cameraTargets.length - 1)));
    const local = phase * (cameraTargets.length - 1) - segment;
    camera.position.lerpVectors(cameraTargets[segment], cameraTargets[segment + 1], local);
    camera.position.x += pointer.x * 0.26;
    camera.position.y += -pointer.y * 0.16;
    camera.lookAt(0, 0, 0);

    const compactScene = window.innerWidth < 720;
    root.position.set(
      compactScene ? phase * -1.2 + 1.35 : phase * -2.8 + 2.2,
      compactScene ? -0.28 + Math.sin(phase * Math.PI * 2) * 0.12 : Math.sin(phase * Math.PI * 2) * 0.18,
      0
    );
    if (reducedMotion) {
      loopGroup.rotation.set(0.05, 0.24 + phase * 0.5, 0);
    } else {
      loopGroup.rotation.x = Math.sin(elapsed * 0.32) * 0.11 + pointer.y * 0.08;
      loopGroup.rotation.y = elapsed * 0.12 * state.patternBoost + pointer.x * 0.16 + phase * 1.6;
      loopGroup.rotation.z = Math.sin(elapsed * 0.2) * 0.06;
      particles.rotation.y = -elapsed * 0.026;
      particles.rotation.x = phase * 0.22;
    }

    codexCore.rotation.x = elapsed * 0.7;
    codexCore.rotation.y = elapsed * 0.46;
    evalCore.rotation.y = -elapsed * 0.68;
    claudeCore.rotation.x = -elapsed * 0.56;
    claudeCore.rotation.z = elapsed * 0.5;
    repairCore.rotation.x = elapsed * 0.52;
    repairCore.rotation.y = -elapsed * 0.74;

    shaderMaterials.forEach((material, index) => {
      material.uniforms.uTime.value = elapsed + index * 0.7;
      material.uniforms.uScroll.value = phase;
    });
    coreMaterials.forEach((material) => {
      material.uniforms.uTime.value = elapsed;
    });

    packets.update(elapsed, state.patternBoost);
    const compactFrame = window.innerWidth < 720;
    bloomPass.strength = compactFrame ? 0.3 : Math.min(0.5, 0.42 + Math.sin(elapsed * 0.8) * 0.04 + phase * 0.08);
    composer.render();
    window.__AUTO_GOAL_FRAME_COUNT = (window.__AUTO_GOAL_FRAME_COUNT || 0) + 1;
    if (!firstFrameRendered) {
      window.__AUTO_GOAL_THREE_READY = true;
      firstFrameRendered = true;
    }

    if (loaderProgress < 100) {
      window.clearInterval(loaderTimer);
      completeLoader();
      loaderProgress = 100;
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeIridescentMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uScroll;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float fresnel = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
        float pulse = 0.55 + 0.45 * sin(uTime * 2.0 + uScroll * 8.0);
        vec3 color = mix(uColor * 0.55, vec3(1.0), fresnel * 0.9) * (0.55 + pulse * 0.45);
        gl_FragColor = vec4(color, uOpacity * (0.38 + fresnel * 0.72));
      }
    `
  });
}

function makeCore(geometry, color, position, offset) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOffset: { value: offset }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOffset;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float fresnel = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.6);
        float pulse = 0.62 + 0.38 * sin(uTime * 3.2 + uOffset * 6.28318);
        vec3 core = uColor * (1.25 + pulse * 1.15);
        vec3 rim = mix(core, vec3(1.0), fresnel * 0.82);
        gl_FragColor = vec4(rim, 0.86 + fresnel * 0.14);
      }
    `
  });
  const core = new THREE.Mesh(geometry, material);
  core.position.copy(position);
  core.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42 })));
  return core;
}

function makeNodeLabel(text, color, position) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 160;
  const context = labelCanvas.getContext("2d");
  const colorStyle = `#${color.toString(16).padStart(6, "0")}`;

  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = "rgba(2, 8, 12, 0.72)";
  context.strokeStyle = colorStyle;
  context.lineWidth = 4;
  roundRect(context, 20, 28, 472, 84, 18);
  context.fill();
  context.stroke();
  context.shadowColor = colorStyle;
  context.shadowBlur = 24;
  context.fillStyle = "#f4feff";
  context.font = "900 42px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 72);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position).add(new THREE.Vector3(0, 0.92, 0.24));
  sprite.scale.set(3.2, 1, 1);
  return sprite;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function makeTopologyCurves(nodes) {
  return [
    {
      color: new THREE.Color(0xffb43d),
      curve: new THREE.CubicBezierCurve3(nodes.codex, new THREE.Vector3(-1.85, -1.25, 0.72), new THREE.Vector3(-0.65, -1.38, 0.68), nodes.eval)
    },
    {
      color: new THREE.Color(0x45df89),
      curve: new THREE.CubicBezierCurve3(nodes.eval, new THREE.Vector3(0.65, -1.38, 0.68), new THREE.Vector3(1.85, -1.25, 0.72), nodes.claude)
    },
    {
      color: new THREE.Color(0x2de9ff),
      curve: new THREE.CubicBezierCurve3(nodes.claude, new THREE.Vector3(2.0, 0.76, 0.82), new THREE.Vector3(0.8, 1.48, 0.76), nodes.repair)
    },
    {
      color: new THREE.Color(0xff4f80),
      curve: new THREE.CubicBezierCurve3(nodes.repair, new THREE.Vector3(-0.8, 1.48, 0.76), new THREE.Vector3(-2.0, 0.76, 0.82), nodes.codex)
    }
  ];
}

function makeBridgeGeometry(segments) {
  const points = [];
  segments.forEach(({ curve }) => {
    for (let step = 0; step < 36; step += 1) {
      const a = curve.getPoint(step / 36);
      const b = curve.getPoint((step + 1) / 36);
      points.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function makeBridgeTubes(segments) {
  const group = new THREE.Group();
  segments.forEach(({ curve, color }) => {
    const geometry = new THREE.TubeGeometry(curve, 72, 0.04, 8, false);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    group.add(new THREE.Mesh(geometry, material));
  });
  return group;
}

function makePackets(count, segments) {
  const geometry = new THREE.SphereGeometry(0.07, 12, 12);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const temp = new THREE.Object3D();
  const colors = segments.map((segment) => segment.color);
  for (let index = 0; index < count; index += 1) {
    mesh.setColorAt(index, colors[index % colors.length]);
  }

  return {
    mesh,
    update(time, boost) {
      for (let index = 0; index < count; index += 1) {
        const segment = segments[index % segments.length];
        const progress = (index / count + time * 0.13 * boost + (index % 6) * 0.025) % 1;
        temp.position.copy(segment.curve.getPoint(progress));
        temp.scale.setScalar(0.7 + Math.sin(time * 3.1 + index) * 0.18);
        temp.updateMatrix();
        mesh.setMatrixAt(index, temp.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      document.querySelector("#telemetry-packets").textContent = String(count).padStart(3, "0");
    }
  };
}

function makeParticles(count) {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 5 + Math.random() * 14;
    const angle = Math.random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (Math.random() - 0.5) * 8;
    positions[index * 3 + 2] = Math.sin(angle) * radius - 4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xb9fbff,
      size: 0.024,
      transparent: true,
      opacity: 0.62,
      depthWrite: false
    })
  );
}

function makePostPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: 0.0014 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float amount;
      varying vec2 vUv;
      float random(vec2 p) {
        return fract(sin(dot(p.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }
      void main() {
        vec2 offset = amount * vec2(1.0, 0.5);
        vec4 base = texture2D(tDiffuse, vUv);
        float r = texture2D(tDiffuse, vUv + offset).r;
        float g = base.g;
        float b = texture2D(tDiffuse, vUv - offset).b;
        float grain = (random(vUv + gl_FragCoord.xy) - 0.5) * 0.035;
        gl_FragColor = vec4(vec3(r, g, b) + grain, base.a);
      }
    `
  });
}

function updateStepTelemetry(progress) {
  const step = Math.min(5, Math.max(0, Math.floor(progress * 6)));
  document.querySelector("#telemetry-iteration").textContent = String(step + 1).padStart(2, "0");
  document.querySelectorAll("#loop-rail li").forEach((item, index) => {
    item.classList.toggle("active", index <= step);
  });
}
