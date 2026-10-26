import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { setMotion, leaveSettings } from "./settings-helpers.mjs";
import { waitForMenuIdle, waitForDialogClosed } from "./motion-helpers.mjs";

const directory = "artifacts/creature-motion";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const checks = [],
  errors = [],
  continuity = [];
let modelRequests = 0;
const injection = String.raw`
              const action = mixer.existingAction(idle);
              const observedCanvas = renderer.domElement;
              const samples = [];
              let renderDelay = 0;
              const draw = renderer.render.bind(renderer);
              renderer.render = (...args) => {
                const began = performance.now();
                while (performance.now() - began < renderDelay) { /* test-only slow renderer */ }
                draw(...args);
                samples.push({ now: performance.now(), mixerTime: mixer.time, actionTime: action.time });
                if (samples.length > 500) samples.shift();
              };
              window.__creatureMotionProbe = {
                delay(value) { renderDelay = value; },
                read() {
                  const bones = [];
                  model.traverse((object) => { if (object.isBone && /Head$|UpperArm|ForeArm|Forearm|LeftArm|RightArm|Hair_Rear/.test(object.name)) bones.push({ name: object.name, quaternion: object.quaternion.toArray() }); });
                  return { now: performance.now(), mixerTime: mixer.time, actionTime: action.time, duration: idle.duration, loop: action.loop, repeat: String(action.repetitions), timeScale: action.getEffectiveTimeScale(), activeSeconds, paused: motionDisabledRef.current, hidden: document.hidden, sameCanvas: observedCanvas === document.querySelector('.creature-model canvas'), samples: samples.slice(), bones };
                }
              };
`;
const snapshot = (page) =>
  page.evaluate(() => window.__creatureMotionProbe.read());
const record = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};

try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 0.5,
    reducedMotion: "no-preference",
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/crownfall-sorcerer.glb"))
      modelRequests++;
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "crownfall.main-game.preferences",
      JSON.stringify({
        quality: "low",
        motion: true,
        volume: 65,
        renderScale: 50,
        frameLimit: 30,
      }),
    ),
  );
  await page.route(
    (url) => url.pathname.endsWith("/src/CreatureStage.tsx"),
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = "setActiveAnimation(idle.name);";
      assert.ok(
        source.includes(marker),
        "test instrumentation targets the existing Idle selection",
      );
      await route.fulfill({
        response,
        body: source.replace(marker, `${marker}\n${injection}`),
      });
    },
  );
  await page.goto(process.env.CROWNFALL_MOTION_URL || "http://localhost:5173");
  await waitForBootReady(page);
  const initial = await snapshot(page);
  assert.equal(initial.timeScale, 1);
  assert.equal(initial.repeat, "Infinity");
  assert.equal(initial.paused, false);
  assert.equal(modelRequests, 1);
  record(
    "The actual uploaded Idle clip runs at 1× with infinite repetition and one model request",
  );

  await page.evaluate(() => window.__creatureMotionProbe.delay(120));
  const start = await snapshot(page);
  await page.waitForTimeout(6800);
  const end = await snapshot(page);
  await page.evaluate(() => window.__creatureMotionProbe.delay(0));
  const elapsedSeconds = (end.now - start.now) / 1000;
  const mixerSeconds = end.mixerTime - start.mixerTime;
  const ratio = mixerSeconds / elapsedSeconds;
  assert.ok(
    ratio > 0.8 && ratio < 1.2,
    `slow-render animation must retain wall-clock speed: ${ratio}`,
  );
  assert.ok(
    mixerSeconds > end.duration * 2,
    `two complete clip durations advance: ${mixerSeconds}`,
  );
  const samples = end.samples.filter((sample) => sample.now >= start.now);
  const wraps = samples
    .slice(1)
    .filter(
      (sample, index) => sample.actionTime < samples[index].actionTime,
    ).length;
  assert.ok(
    wraps >= 2,
    `actual action time wraps across the clip boundary twice: ${wraps}`,
  );
  assert.notDeepEqual(
    start.bones,
    end.bones,
    "the actual rig's bone poses change",
  );
  record(
    `Slow rendering retains ${ratio.toFixed(3)}× elapsed animation speed and ${wraps} actual loop wraps`,
  );

  const advanceAcross = async (label, action) => {
    const before = await snapshot(page);
    await action();
    await page.waitForFunction(
      (time) => window.__creatureMotionProbe.read().mixerTime > time + 0.12,
      before.mixerTime,
    );
    const after = await snapshot(page);
    assert.equal(after.sameCanvas, true, label);
    assert.equal(modelRequests, 1, label);
    continuity.push({
      label,
      before: before.mixerTime,
      after: after.mixerTime,
    });
  };
  for (const tab of ["Home", "Play", "Showcase", "Settings", "Play"])
    await advanceAcross(tab, async () => {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await waitForMenuIdle(page);
    });
  await advanceAcross("Chapters", async () => {
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
    await waitForMenuIdle(page);
  });
  await page.keyboard.press("Escape");
  await waitForMenuIdle(page);
  await advanceAcross("Classic preview dialog", async () => {
    await page.getByRole("button", { name: "Classic", exact: true }).click();
    await page.locator("dialog[open]").waitFor();
  });
  await page.keyboard.press("Escape");
  await waitForDialogClosed(page);
  record(
    "Home, Play, Showcase, Settings, Chapters and a dialog preserve the canvas, model request count and advancing mixer",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => window.__creatureMotionProbe.read().paused);
  const osPaused = await snapshot(page);
  await page.waitForTimeout(450);
  assert.equal((await snapshot(page)).mixerTime, osPaused.mixerTime);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(
    (time) => window.__creatureMotionProbe.read().mixerTime > time + 0.12,
    osPaused.mixerTime,
  );
  record(
    "OS reduced motion freezes the actual mixer and resumes without a model reload",
  );

  await setMotion(page, false);
  await page.waitForFunction(() => window.__creatureMotionProbe.read().paused);
  const userPaused = await snapshot(page);
  await page.waitForTimeout(450);
  assert.equal((await snapshot(page)).mixerTime, userPaused.mixerTime);
  await setMotion(page, true);
  await page.waitForFunction(
    (time) => window.__creatureMotionProbe.read().mixerTime > time + 0.12,
    userPaused.mixerTime,
  );
  await leaveSettings(page);
  record(
    "The Ambient Motion preference freezes and resumes the actual rig without replacing its canvas",
  );

  const backgroundPage = await browser.newPage();
  await backgroundPage.bringToFront();
  const hiddenSupported = await page.evaluate(() => document.hidden);
  let visibilityCheck =
    "Skipped: this headless browser keeps background tabs visible";
  if (hiddenSupported) {
    const hidden = await snapshot(page);
    await page.waitForTimeout(600);
    assert.equal((await snapshot(page)).mixerTime, hidden.mixerTime);
    await page.bringToFront();
    await page.waitForFunction(
      (time) => window.__creatureMotionProbe.read().mixerTime > time,
      hidden.mixerTime,
    );
    const resumed = await snapshot(page);
    assert.ok(
      resumed.mixerTime - hidden.mixerTime < 0.5,
      "hidden time is excluded on resume",
    );
    visibilityCheck =
      "Passed: background tab freezes and resumes without advancing hidden time";
  }
  await backgroundPage.close();
  await page.bringToFront();
  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  assert.ok(
    landscape.scrollWidth <= landscape.width + 1 &&
      landscape.scrollHeight <= landscape.height + 1,
  );
  assert.equal((await snapshot(page)).sameCanvas, true);
  assert.equal(modelRequests, 1);
  assert.deepEqual(errors, []);
  record(
    "Landscape layout has no page overflow; the original canvas and single model request remain intact",
  );
  await writeFile(
    `${directory}/verification.json`,
    `${JSON.stringify({ passed: true, checks, clip: { duration: initial.duration, effectiveTimeScale: initial.timeScale, repetitions: initial.repeat }, slowRender: { addedDelayMs: 120, elapsedSeconds, mixerSeconds, ratio, wraps, renderSamples: samples.length }, continuity, visibilityCheck, landscape, modelRequests, browserErrors: errors, instrumentation: "Playwright interception of the development module only; no shipped debug globals or product edits. Actual uploaded GLB at 50% render scale and 30 FPS limit; software WebGL frame pacing is not benchmarked." }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
