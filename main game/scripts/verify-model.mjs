import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// A small fixture verifies alternate assets alongside the actual supplied GLB.
const vertices = new Float32Array([-0.6, -1, 0, 0.6, -1, 0, 0, 1, 0]);
const gltf = {
  asset: { version: "2.0", generator: "Crownfall model integration check" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.6, 0.45, 0.15, 1],
        metallicFactor: 0.5,
        roughnessFactor: 0.4,
      },
      doubleSided: true,
    },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [-0.6, -1, 0],
      max: [0.6, 1, 0],
    },
  ],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.byteLength }],
  buffers: [
    {
      byteLength: vertices.byteLength,
      uri: `data:application/octet-stream;base64,${Buffer.from(vertices.buffer).toString("base64")}`,
    },
  ],
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 714 } });
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(message.text());
});
const origin =
  process.env.CROWNFALL_TEST_URL ||
  process.env.TEST_URL ||
  "http://localhost:5173";

try {
  await page.route(
    (url) => url.pathname === "/models/test.gltf",
    (route) =>
      route.fulfill({
        contentType: "model/gltf+json",
        body: JSON.stringify(gltf),
      }),
  );
  await page.goto(`${origin}/?model=/models/test.gltf`, {
    waitUntil: "networkidle",
  });
  await page.locator(".creature-model--loaded").waitFor();
  assert.equal(
    await page.locator(".creature-illustration--hidden").count(),
    1,
    "successful loading replaces the illustration",
  );
  const rendering = await page.locator(".creature-model canvas").evaluate(
    (canvas) =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const context = canvas.getContext("webgl2");
          if (!context)
            return resolve({ error: "No WebGL2 context", coloredPixels: 0 });
          const pixels = new Uint8Array(
            context.drawingBufferWidth * context.drawingBufferHeight * 4,
          );
          context.readPixels(
            0,
            0,
            context.drawingBufferWidth,
            context.drawingBufferHeight,
            context.RGBA,
            context.UNSIGNED_BYTE,
            pixels,
          );
          let coloredPixels = 0;
          for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i] > 0) coloredPixels++;
          resolve({ error: context.getError(), coloredPixels });
        });
      }),
  );
  assert.equal(rendering.error, 0, "the model renderer reports no WebGL error");
  assert.ok(
    rendering.coloredPixels > 1000,
    `a visible character mesh is rendered (${rendering.coloredPixels} pixels)`,
  );
  assert.deepEqual(
    failures,
    [],
    "valid model produces no runtime or console errors",
  );
  console.log(
    `PASS: glTF URL loads, replaces fallback, and renders ${rendering.coloredPixels} pixels`,
  );

  // An unreadable model must not remove the user's illustrated character.
  await page.route(
    (url) => url.pathname === "/models/invalid.gltf",
    (route) => route.fulfill({ contentType: "model/gltf+json", body: "{}" }),
  );
  await page.goto(`${origin}/?model=/models/invalid.gltf`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await page.locator(".creature-model--loaded").count(),
    0,
    "invalid model is not presented as loaded",
  );
  assert.equal(
    await page.locator(".creature-illustration--hidden").count(),
    0,
    "fallback stays visible on parse failure",
  );
  console.log("PASS: invalid glTF keeps the illustrated fallback visible");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator(".atmosphere--still").waitFor({ state: "attached" });
  await page.locator(".creature-model--loaded").waitFor();
  assert.equal(
    await page.locator(".creature-stage").getAttribute("data-active-animation"),
    "Idle",
    "the supplied model selects Idle rather than Attack",
  );
  assert.equal(await page.locator(".creature-illustration--hidden").count(), 1);
  const canvas = page.locator(".creature-model canvas");
  await canvas.evaluate((element) => {
    element.dataset.testIdentity = "loaded-real-model";
  });
  const originalCanvas = await canvas.elementHandle();
  console.log(
    "PASS: actual compressed GLB loads with Idle selected under reduced motion",
  );

  // Hide the independent particles so a moving screenshot can only come from the model.
  await page.addStyleTag({
    content: ".atmosphere { visibility: hidden !important; }",
  });
  const frameDigest = async () =>
    createHash("sha256")
      .update(await canvas.screenshot())
      .digest("hex");
  await page.waitForTimeout(800);
  const pausedFrame = await frameDigest();
  await page.waitForTimeout(350);
  assert.equal(
    await frameDigest(),
    pausedFrame,
    "OS reduced motion freezes the actual model",
  );

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(200);
  const movingFrame = await frameDigest();
  await page.waitForTimeout(550);
  assert.notEqual(
    await frameDigest(),
    movingFrame,
    "the actual Idle pose visibly animates",
  );
  console.log(
    "PASS: actual Idle animates and OS reduced motion freezes its rendered pose",
  );
  // The actual asset should remain decoded when changing the motion setting.
  const modelRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("crownfall-sorcerer.glb"))
      modelRequests.push(request.url());
  });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Ambient motion", { exact: false }).uncheck();
  await page.locator(".atmosphere--still").waitFor({ state: "attached" });
  await page
    .getByLabel("Particle quality", { exact: false })
    .selectOption("low");
  assert.equal(
    await page.locator(".mote-field canvas").count(),
    0,
    "Low quality releases the particle renderer",
  );
  await page
    .getByLabel("Particle quality", { exact: false })
    .selectOption("high");
  assert.equal(
    await page.locator(".mote-field canvas").count(),
    1,
    "High quality restores particles",
  );
  assert.equal(
    await page.locator(".atmosphere--still").count(),
    1,
    "the app motion setting remains effective independently of OS preference",
  );
  assert.equal(
    await canvas.getAttribute("data-test-identity"),
    "loaded-real-model",
    "motion changes retain the renderer and decoded model",
  );
  assert.equal(
    await originalCanvas.evaluate((element) => element.isConnected),
    true,
  );
  assert.equal(
    modelRequests.length,
    0,
    "motion and quality controls do not reload the GLB",
  );
  assert.deepEqual(
    failures,
    [],
    "all fallback and settings paths finish without runtime errors",
  );
  console.log(
    "PASS: motion/quality changes retain the decoded GLB and Low releases particle WebGL",
  );

  await page.goto(`${origin}/?model=none`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".creature-model canvas").count(), 0);
  assert.equal(await page.locator(".creature-illustration--hidden").count(), 0);
  console.log(
    "PASS: explicit illustration preview needs no character WebGL context",
  );
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/model-verification.json",
    JSON.stringify(
      {
        passed: true,
        asset: "public/models/crownfall-sorcerer.glb",
        checks: [
          "Alternate glTF fixture renders visible pixels without WebGL errors",
          "Invalid glTF retains the illustration fallback",
          "Actual compressed GLB loads and selects the named Idle clip",
          "Actual Idle visibly animates; OS reduced motion freezes its rendered pose",
          "Motion/quality controls retain the renderer and decoded model without another GLB request",
          "Low releases the independent particle renderer",
          "Explicit illustration preview uses no character WebGL context",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
