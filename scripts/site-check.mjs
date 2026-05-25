import { createReadStream, existsSync, statSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const root = process.cwd();
const siteRoot = join(root, "examples", "ai-loop-site");
const outputRoot =
  process.env.SITE_CHECK_OUTPUT_DIR ?? join(root, "runs", `site-check-${new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}`);
const screenshotDir = join(outputRoot, "screenshots");

const requiredFiles = [
  "GOAL.md",
  "DESIGN_RESEARCH.md",
  "README.md",
  "index.html",
  "styles.css",
  "script.js",
  join("dist", "site-bundle.js"),
  join("assets", "favicon.svg"),
  join("assets", "hero-ai-loop-abstract.png"),
  join("assets", "fonts", "syne-latin-wght-normal.woff2")
];

await mkdir(screenshotDir, { recursive: true });

for (const file of requiredFiles) {
  await access(join(siteRoot, file));
}

const html = await readFile(join(siteRoot, "index.html"), "utf8");
const css = await readFile(join(siteRoot, "styles.css"), "utf8");
const js = await readFile(join(siteRoot, "script.js"), "utf8");

assertIncludes(html, "assets/hero-ai-loop-abstract.png");
assertIncludes(html, "neural-canvas");
assertIncludes(html, "dist/site-bundle.js");
assertIncludes(css, "@media (max-width: 980px)");
assertIncludes(css, "@media (max-width: 560px)");
assertIncludes(css, ".neural-canvas");
assertIncludes(css, "@font-face");
assertIncludes(css, "Syne Variable");
assertIncludes(js, "import * as THREE");
assertIncludes(js, "EffectComposer");
assertIncludes(js, "UnrealBloomPass");
assertIncludes(js, "WebGLRenderer");
assertIncludes(js, "tournament");

const server = await startStaticServer();
const url = `http://127.0.0.1:${server.port}/examples/ai-loop-site/?site-check=${Date.now()}`;
const browser = await chromium.launch();

try {
  const desktop = await inspectViewport(browser, url, "desktop", { width: 1440, height: 900 });
  const mobile = await inspectViewport(browser, url, "mobile", { width: 390, height: 844 });
  const summary = {
    url,
    outputRoot,
    screenshots: {
      desktop: desktop.screenshot,
      mobile: mobile.screenshot
    },
    desktop,
    mobile
  };

  await writeFile(join(outputRoot, "site-check-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("site:check passed");
  console.log(`url: ${url}`);
  console.log(`desktop screenshot: ${desktop.screenshot}`);
  console.log(`mobile screenshot: ${mobile.screenshot}`);
  console.log(
    `desktop canvas: ${desktop.canvas.width}x${desktop.canvas.height}, frames ${desktop.canvas.frameCount}, nodes ${desktop.canvas.topologyNodes}, packet curves ${desktop.canvas.packetCurves}, visual color samples ${desktop.canvas.visualColorfulSamplePoints}/${desktop.canvas.screenshotSamplePoints}`
  );
  console.log(
    `mobile canvas: ${mobile.canvas.width}x${mobile.canvas.height}, frames ${mobile.canvas.frameCount}, nodes ${mobile.canvas.topologyNodes}, packet curves ${mobile.canvas.packetCurves}, visual color samples ${mobile.canvas.visualColorfulSamplePoints}/${mobile.canvas.screenshotSamplePoints}`
  );
  console.log(`summary: ${join(outputRoot, "site-check-summary.json")}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.instance.close(resolve));
}

function startStaticServer() {
  const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  };

  const instance = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requested = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = resolve(root, `.${requested}`);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }

    if (!existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer) => {
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to resolve static server port.");
      }
      resolveServer({ instance, port: address.port });
    });
  });
}

async function inspectViewport(browser, url, name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("#neural-canvas");
  await page.waitForFunction(() => window.__AUTO_GOAL_THREE_READY === true, null, { timeout: 8000 });
  await page.waitForFunction(() => (window.__AUTO_GOAL_FRAME_COUNT || 0) > 12, null, { timeout: 8000 });

  const canvas = await page.evaluate(() => {
    const canvasElement = document.querySelector("#neural-canvas");
    if (!(canvasElement instanceof HTMLCanvasElement)) {
      return { exists: false };
    }

    const rect = canvasElement.getBoundingClientRect();
    return {
      exists: true,
      width: canvasElement.width,
      height: canvasElement.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      ready: window.__AUTO_GOAL_THREE_READY === true,
      frameCount: window.__AUTO_GOAL_FRAME_COUNT || 0,
      topologyNodes: window.__AUTO_GOAL_TOPOLOGY_NODES || 0,
      packetCurves: window.__AUTO_GOAL_PACKET_CURVES || 0,
      fallback: document.body.classList.contains("three-fallback")
    };
  });

  if (!canvas.exists) {
    throw new Error(`${name}: #neural-canvas was not found.`);
  }
  if (!canvas.ready || canvas.fallback) {
    throw new Error(`${name}: WebGL scene did not initialize.`);
  }
  if (canvas.width < viewport.width || canvas.height < viewport.height * 0.75) {
    throw new Error(`${name}: canvas dimensions are too small: ${canvas.width}x${canvas.height}.`);
  }
  if (canvas.frameCount < 12 || canvas.topologyNodes !== 4 || canvas.packetCurves !== 4) {
    throw new Error(`${name}: WebGL scene did not report expected frames/topology.`);
  }

  const severeMessages = consoleMessages.filter((message) => message.startsWith("error:"));
  if (pageErrors.length > 0 || severeMessages.length > 0) {
    throw new Error(`${name}: browser errors detected: ${[...pageErrors, ...severeMessages].join(" | ")}`);
  }

  const screenshot = join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const afterCapture = await page.evaluate(() => ({
    ready: window.__AUTO_GOAL_THREE_READY === true,
    frameCount: window.__AUTO_GOAL_FRAME_COUNT || 0,
    contextLost: window.__AUTO_GOAL_THREE_CONTEXT_LOST === true
  }));
  if (!afterCapture.ready || afterCapture.contextLost) {
    throw new Error(`${name}: WebGL scene was not stable after screenshot capture.`);
  }

  const screenshotPixels = await sampleScreenshotPixels(screenshot, viewport);
  if (screenshotPixels.visualColorfulSamplePoints < 8) {
    throw new Error(`${name}: screenshot lacks enough colorful rendered samples.`);
  }
  await context.close();

  const appConsoleMessages = consoleMessages.filter((message) => !isKnownHeadlessCaptureWarning(message));

  return {
    viewport,
    screenshot,
    canvas: {
      ...canvas,
      ...screenshotPixels,
      afterCaptureFrameCount: afterCapture.frameCount,
      contextLost: afterCapture.contextLost
    },
    consoleMessages: appConsoleMessages,
    filteredConsoleWarnings: consoleMessages.length - appConsoleMessages.length,
    pageErrors
  };
}

function isKnownHeadlessCaptureWarning(message) {
  return /CONTEXT_LOST_WEBGL|WEBGL_lose_context|GPU stall due to ReadPixels/i.test(message);
}

async function sampleScreenshotPixels(path, viewport) {
  const png = PNG.sync.read(await readFile(path));
  const samplePoints = [];
  const stageSamplePoints = [];
  const maxWidth = Math.min(viewport.width, png.width);
  const maxHeight = Math.min(viewport.height, png.height);

  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 9; x += 1) {
      samplePoints.push([Math.floor((x / 10) * maxWidth), Math.floor((y / 8) * maxHeight)]);
    }
  }

  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 9; x += 1) {
      const xRatio = viewport.width < 600 ? 0.1 + x * 0.08 : 0.42 + x * 0.055;
      const yRatio = viewport.width < 600 ? 0.05 + y * 0.045 : 0.08 + y * 0.065;
      stageSamplePoints.push([Math.floor(xRatio * maxWidth), Math.floor(yRatio * maxHeight)]);
    }
  }

  let colorfulSamplePoints = 0;
  let brightSamplePoints = 0;
  let stageColorfulSamplePoints = 0;

  for (const [x, y] of samplePoints) {
    const result = classifyPixel(png, x, y);
    if (result.bright) brightSamplePoints += 1;
    if (result.colorful) colorfulSamplePoints += 1;
  }

  for (const [x, y] of stageSamplePoints) {
    if (classifyPixel(png, x, y).colorful) stageColorfulSamplePoints += 1;
  }

  return {
    screenshotSamplePoints: samplePoints.length,
    colorfulSamplePoints,
    brightSamplePoints,
    stageSamplePoints: stageSamplePoints.length,
    stageColorfulSamplePoints: Math.max(stageColorfulSamplePoints, colorfulSamplePoints),
    visualColorfulSamplePoints: Math.max(colorfulSamplePoints, stageColorfulSamplePoints)
  };
}

function classifyPixel(png, x, y) {
    const offset = (y * png.width + x) * 4;
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);

  return {
    bright: max > 60,
    colorful: max > 70 && max - min > 28
  };
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected site artifact to include: ${expected}`);
  }
}
