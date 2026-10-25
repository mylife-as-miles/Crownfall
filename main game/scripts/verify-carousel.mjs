import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const artifactDirectory = "artifacts/carousel";
await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const checks = [];
const traces = {};
const failures = [];
const names = ["New", "Resume", "Load game", "Browse"];

function observeErrors(page) {
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
}

async function inspect(page) {
  return page.locator(".game-cards").evaluate((viewport) => {
    const box = viewport.getBoundingClientRect();
    const cards = [...viewport.querySelectorAll(".game-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        name: card.getAttribute("aria-label"),
        selected: card.getAttribute("aria-pressed") === "true",
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        fullyVisible:
          rect.left >= box.left - 1.5 && rect.right <= box.right + 1.5,
        intersects: rect.right > box.left + 1 && rect.left < box.right - 1,
      };
    });
    return {
      x: viewport.scrollLeft,
      max: viewport.scrollWidth - viewport.clientWidth,
      width: box.width,
      cards,
    };
  });
}

async function settle(page) {
  await page.locator(".game-cards").evaluate(
    (viewport) =>
      new Promise((resolve, reject) => {
        let previous = viewport.scrollLeft;
        let stableFrames = 0;
        const start = performance.now();
        const frame = () => {
          const next = viewport.scrollLeft;
          stableFrames =
            Math.abs(next - previous) < 0.15 ? stableFrames + 1 : 0;
          previous = next;
          if (stableFrames >= 8) return resolve(next);
          if (performance.now() - start > 15000)
            return reject(new Error("Carousel did not settle"));
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

async function endpoint(page, end) {
  const button = page.getByRole("button", {
    name: end ? "Next cards" : "Previous cards",
    exact: true,
  });
  await button.click({ force: true });
  await settle(page);
  const state = await inspect(page);
  assert.ok(
    Math.abs(state.x - (end ? state.max : 0)) < 1.5,
    `expected ${end ? "last" : "first"} window: ${JSON.stringify(state)}`,
  );
  return state;
}

async function recordScroll(page, name, action) {
  await page.evaluate(() => {
    window.__carouselTrace = [];
    const viewport = document.querySelector(".game-cards");
    const start = performance.now();
    const frame = () => {
      window.__carouselTrace.push({
        ms: performance.now() - start,
        x: viewport.scrollLeft,
      });
      window.__carouselTraceFrame = requestAnimationFrame(frame);
    };
    frame();
  });
  await action();
  await settle(page);
  traces[name] = await page.evaluate(() => {
    cancelAnimationFrame(window.__carouselTraceFrame);
    return window.__carouselTrace;
  });
  await writeFile(
    `${artifactDirectory}/scroll-traces.json`,
    `${JSON.stringify(traces, null, 2)}\n`,
  );
  return traces[name];
}

async function assertVisible(page, expected) {
  const state = await inspect(page);
  assert.deepEqual(
    state.cards.filter((card) => card.fullyVisible).map((card) => card.name),
    expected,
  );
  assert.equal(
    state.cards.length,
    4,
    "four semantic cards without cloned slides",
  );
  assert.equal(
    state.cards.filter((card) => card.intersects).length,
    3,
    "exactly three cards intersect the viewport",
  );
  return state;
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  assert.ok(
    dimensions.width <= dimensions.viewportWidth + 1,
    JSON.stringify(dimensions),
  );
  assert.ok(
    dimensions.height <= dimensions.viewportHeight + 1,
    JSON.stringify(dimensions),
  );
}

async function selected(page, name) {
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('.game-card[aria-pressed="true"]')
        ?.getAttribute("aria-label") === label,
    name,
  );
  const card = page.getByRole("button", { name, exact: true });
  assert.equal(
    await card.evaluate((element) => element === document.activeElement),
    true,
    "selected card keeps keyboard/gamepad focus",
  );
  await settle(page);
  const state = await inspect(page);
  assert.equal(
    state.cards.find((item) => item.name === name)?.fullyVisible,
    true,
    "selected card is fully revealed",
  );
}

async function pad(page, button, expected, holdAtEndpoint = false) {
  await page.evaluate((index) => {
    window.__padButtons = [index];
    window.__padFirstRead = 0;
  }, button);
  if (holdAtEndpoint) {
    await page.waitForFunction(
      () =>
        window.__padFirstRead > 0 &&
        performance.now() - window.__padFirstRead >= 320,
      undefined,
      { polling: "raf" },
    );
  } else if (expected) {
    await page.waitForFunction(
      (label) =>
        document
          .querySelector('.game-card[aria-pressed="true"]')
          ?.getAttribute("aria-label") === label,
      expected,
      { polling: "raf" },
    );
  } else if (button === 0 || button === 1) {
    await page.waitForFunction(
      (shouldBeOpen) => document.querySelector("dialog")?.open === shouldBeOpen,
      button === 0,
      { polling: "raf" },
    );
  } else {
    await page.waitForFunction(() => window.__padFirstRead > 0, undefined, {
      polling: "raf",
    });
  }
  await page.evaluate(() => {
    window.__padButtons = [];
  });
  if (expected) await selected(page, expected);
}

async function recordDemonstration() {
  const recordingStartedAt = Date.now();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 0.35,
    recordVideo: { dir: artifactDirectory, size: { width: 640, height: 360 } },
  });
  await context.addInitScript(() =>
    localStorage.setItem(
      "crownfall.main-game.preferences",
      JSON.stringify({ quality: "low", volume: 65, motion: true }),
    ),
  );
  const page = await context.newPage();
  observeErrors(page);
  const video = page.video();
  await page.goto(origin);
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const fallback = document.querySelector(".creature-illustration");
    const model = document.querySelector(".creature-model");
    return (
      fallback &&
      model &&
      Number(getComputedStyle(fallback).opacity) < 0.01 &&
      Number(getComputedStyle(model).opacity) > 0.99
    );
  });
  assert.equal(
    await page.locator(".creature-stage").getAttribute("data-active-animation"),
    "Idle",
  );
  await assertVisible(page, names.slice(0, 3));
  const milestones = [];
  await page.screenshot({
    path: `${artifactDirectory}/recording-first.png`,
    scale: "css",
  });
  // On software GL the screencast can lag CSS opacity. Starting after this
  // completed real-model screenshot excludes queued fallback frames as well.
  const sequenceStartedAt = Date.now();
  milestones.push({ window: "New / Resume / Load game", elapsedMs: 0 });
  await page.waitForTimeout(1500);
  await page
    .getByRole("button", { name: "Next cards", exact: true })
    .click({ force: true });
  await page.waitForFunction(() => {
    const viewport = document.querySelector(".game-cards");
    return (
      Math.abs(
        viewport.scrollLeft - (viewport.scrollWidth - viewport.clientWidth),
      ) < 1.5
    );
  });
  await assertVisible(page, names.slice(1));
  await page.screenshot({
    path: `${artifactDirectory}/recording-last.png`,
    scale: "css",
  });
  milestones.push({
    window: "Resume / Load game / Browse",
    elapsedMs: Date.now() - sequenceStartedAt,
  });
  await page.waitForTimeout(1500);
  await page
    .getByRole("button", { name: "Previous cards", exact: true })
    .click({ force: true });
  await page.waitForFunction(
    () => document.querySelector(".game-cards").scrollLeft < 1.5,
  );
  await assertVisible(page, names.slice(0, 3));
  await page.screenshot({
    path: `${artifactDirectory}/recording-return.png`,
    scale: "css",
  });
  milestones.push({
    window: "New / Resume / Load game",
    elapsedMs: Date.now() - sequenceStartedAt,
  });
  await page.waitForTimeout(1500);
  const sequenceEndedAt = Date.now();
  await context.close();
  const generatedVideo = await video.path();
  const rawPath = `${artifactDirectory}/carousel-demo-raw.webm`;
  await rename(generatedVideo, rawPath);
  const rawMetadata = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        rawPath,
      ],
      { encoding: "utf8" },
    ),
  );
  const rawDuration = Number(rawMetadata.format.duration);
  const sequenceDuration = (sequenceEndedAt - sequenceStartedAt) / 1000;
  const trimmedPrefixSeconds = Math.max(0, rawDuration - sequenceDuration);
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    rawPath,
    "-vf",
    `trim=start=${trimmedPrefixSeconds.toFixed(3)},setpts=PTS-STARTPTS`,
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-an",
    `${artifactDirectory}/carousel-demo.webm`,
  ]);
  await writeFile(
    `${artifactDirectory}/recording.json`,
    `${JSON.stringify(
      {
        mode: "actual uploaded GLB; Idle clip; low particle quality; ambient motion enabled",
        deviceScaleFactor: 0.35,
        videoSize: { width: 640, height: 360 },
        recordingStartedAt,
        sequenceStartedAt,
        sequenceEndedAt,
        rawDurationSeconds: rawDuration,
        trimmedPrefixSeconds,
        sequenceDurationSeconds: sequenceDuration,
        milestones,
        limitations:
          "Software WebGL and reduced device pixel ratio. Clip demonstrates both real-model windows; frame pacing is not a GPU performance benchmark. FFmpeg removes only the loading prefix; no interpolation is applied.",
      },
      null,
      2,
    )}\n`,
  );
  return { rawDuration, trimmedPrefixSeconds, sequenceDuration, milestones };
}

if (process.argv.includes("--record-only")) {
  try {
    const recording = await recordDemonstration();
    assert.deepEqual(failures, []);
    console.log(
      `PASS actual GLB first → last → first recording: ${JSON.stringify(recording)}`,
    );
  } finally {
    await browser.close();
  }
  process.exit(0);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    window.__padButtons = [];
    window.__padFirstRead = 0;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        if (window.__padButtons.length && !window.__padFirstRead)
          window.__padFirstRead = performance.now();
        return [
          {
            index: 0,
            connected: true,
            mapping: "standard",
            axes: [0, 0],
            buttons: Array.from({ length: 17 }, (_, index) => ({
              pressed: window.__padButtons.includes(index),
              touched: false,
              value: window.__padButtons.includes(index) ? 1 : 0,
            })),
          },
        ];
      },
    });
    window.addEventListener(
      "wheel",
      (event) =>
        queueMicrotask(() => {
          window.__lastWheel = {
            prevented: event.defaultPrevented,
            trusted: event.isTrusted,
            x: event.deltaX,
            y: event.deltaY,
            shift: event.shiftKey,
          };
        }),
      { passive: true },
    );
  });
  const page = await context.newPage();
  observeErrors(page);
  await page.goto(origin);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".card-carousel").waitFor();
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  await settle(page);
  const first = await assertVisible(page, names.slice(0, 3));
  assert.equal(first.cards.filter((card) => card.selected).length, 1);
  assert.equal(first.cards[1].selected, true, "Resume is selected initially");
  for (const card of first.cards) {
    assert.ok(
      Math.abs(card.width - 247) < 1,
      `card width remains 247px: ${JSON.stringify(card)}`,
    );
    assert.ok(
      Math.abs(card.height - 373) < 1,
      `card height remains 373px: ${JSON.stringify(card)}`,
    );
  }
  assert.ok(
    Math.abs(first.max - 252) < 2,
    `one-card native scroll range: ${first.max}`,
  );
  await assertNoOverflow(page);
  await page.screenshot({ path: `${artifactDirectory}/desktop-first.png` });
  checks.push(
    "Initial window has exactly New/Resume/Load game; all four real cards remain 247×373 with no clones or page overflow",
  );

  for (let repeat = 0; repeat < 3; repeat++) {
    const end = await endpoint(page, true);
    assert.deepEqual(
      end.cards.filter((card) => card.fullyVisible).map((card) => card.name),
      names.slice(1),
    );
    assert.ok(
      end.cards.every(
        (card, index) => Math.abs(card.width - first.cards[index].width) < 0.1,
      ),
      "scrolling never shrinks the four card widths",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Next cards", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await endpoint(page, true);
    assert.equal(
      await page
        .getByRole("button", { name: "Next cards", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await endpoint(page, false);
    assert.equal(
      await page
        .getByRole("button", { name: "Previous cards", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await endpoint(page, false);
    assert.equal(
      await page
        .getByRole("button", { name: "Previous cards", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
  }
  assert.equal(
    await page
      .getByRole("button", { name: "Resume", exact: true })
      .getAttribute("aria-pressed"),
    "true",
    "arrow controls move the window without altering card selection",
  );
  checks.push(
    "Repeated next/back and endpoint activation clamp correctly, keep control focus, and preserve selection",
  );

  const reducedTrace = await recordScroll(page, "os-reduced-next", () =>
    endpoint(page, true),
  );
  assert.ok(
    reducedTrace.every(
      (sample) => sample.x < 1 || Math.abs(sample.x - first.max) < 1.5,
    ),
    "OS reduced motion jumps directly between windows",
  );
  await page.screenshot({ path: `${artifactDirectory}/desktop-last.png` });
  await endpoint(page, false);
  const scrollBox = await page.locator(".game-cards").boundingBox();
  assert.ok(scrollBox);
  await page.mouse.move(
    scrollBox.x + scrollBox.width * 0.5,
    scrollBox.y + scrollBox.height * 0.5,
  );
  await recordScroll(page, "native-horizontal-wheel", async () => {
    await page.mouse.wheel(500, 0);
    await page.waitForFunction(
      () => document.querySelector(".game-cards").scrollLeft > 200,
    );
  });
  await assertVisible(page, names.slice(1));
  assert.equal(
    await page.evaluate(() => window.__lastWheel.trusted),
    true,
    "wheel was a trusted browser input",
  );
  assert.equal(
    await page.evaluate(() => window.__lastWheel.prevented),
    false,
    "horizontal wheel uses native scrolling",
  );
  await endpoint(page, false);
  await page.mouse.move(
    scrollBox.x + scrollBox.width * 0.5,
    scrollBox.y + scrollBox.height * 0.5,
  );
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 500);
  await page.keyboard.up("Shift");
  await page.waitForFunction(
    () => document.querySelector(".game-cards").scrollLeft > 200,
  );
  await settle(page);
  await assertVisible(page, names.slice(1));
  await endpoint(page, false);
  await page.mouse.move(
    scrollBox.x + scrollBox.width * 0.5,
    scrollBox.y + scrollBox.height * 0.5,
  );
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(
    () => window.__lastWheel?.y === 400 && !window.__lastWheel.shift,
  );
  assert.equal(
    await page.evaluate(() => window.__lastWheel.prevented),
    false,
    "ordinary vertical wheel is not intercepted",
  );
  await settle(page);
  assert.ok(
    (await inspect(page)).x < 1.5,
    "ordinary vertical wheel does not shift card windows",
  );
  checks.push(
    "Trusted native horizontal wheel and Shift+wheel reach Browse; ordinary vertical wheel remains unprevented",
  );

  const cdp = await context.newCDPSession(page);
  const touchY = scrollBox.y + scrollBox.height * 0.5;
  const touchX = scrollBox.x + scrollBox.width * 0.76;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: touchX, y: touchY, id: 1, radiusX: 3, radiusY: 3, force: 1 },
    ],
  });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: touchX - step * 36,
          y: touchY + Math.sin(step) * 2,
          id: 1,
          radiusX: 3,
          radiusY: 3,
          force: 1,
        },
      ],
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForFunction(
    () => document.querySelector(".game-cards").scrollLeft > 200,
  );
  await settle(page);
  await assertVisible(page, names.slice(1));
  assert.equal(
    await page.locator("dialog").evaluate((element) => element.open),
    false,
    "swiping a card does not activate it",
  );
  await cdp.detach();
  checks.push(
    "Actual Chromium touch input pans the native viewport to Browse without opening a card",
  );

  await endpoint(page, false);
  await page.getByRole("button", { name: "New", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await selected(page, "New");
  for (const name of names.slice(1)) {
    await page.keyboard.press("ArrowRight");
    await selected(page, name);
  }
  await page.keyboard.press("ArrowRight");
  await selected(page, "Browse");
  for (const name of [...names].reverse().slice(1)) {
    await page.keyboard.press("ArrowLeft");
    await selected(page, name);
  }
  await page.keyboard.press("ArrowLeft");
  await selected(page, "New");
  checks.push(
    "Keyboard navigation clamps 0…3, preserves focus, and reveals the focused first/last card",
  );

  await pad(page, 15, "Resume");
  await pad(page, 15, "Load game");
  await pad(page, 15, "Browse");
  await pad(page, 15, "Browse", true);
  await pad(page, 0);
  await page.getByRole("heading", { name: "Beyond the veil." }).waitFor();
  await pad(page, 1);
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  await selected(page, "Browse");
  await pad(page, 14, "Load game");
  await pad(page, 14, "Resume");
  await pad(page, 14, "New");
  await pad(page, 14, "New", true);
  checks.push(
    "Gamepad D-pad clamps both ends, reveals focused cards, and A/B open and close Browse",
  );

  for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
  await selected(page, "Browse");
  await page.setViewportSize({ width: 932, height: 430 });
  await settle(page);
  await assertVisible(page, names.slice(1));
  await selected(page, "Browse");
  await assertNoOverflow(page);
  await page.screenshot({
    path: `${artifactDirectory}/landscape-last-932x430.png`,
  });
  await endpoint(page, false);
  await assertVisible(page, names.slice(0, 3));
  await page.screenshot({
    path: `${artifactDirectory}/landscape-first-932x430.png`,
  });
  const text = await page
    .locator(".card-title, .card-subtitle, .card-description")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const card = element.closest(".game-card").getBoundingClientRect();
        return {
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          fits:
            box.width > 0 &&
            box.height > 0 &&
            box.left >= card.left &&
            box.right <= card.right + 1 &&
            box.top >= card.top &&
            box.bottom <= card.bottom + 1,
        };
      }),
    );
  assert.ok(
    text.every((element) => element.fits && element.fontSize >= 7),
    `text stays inside cards with the reference minimum sizing: ${JSON.stringify(text)}`,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle(page);
  await assertVisible(page, names.slice(0, 3));
  checks.push(
    "Landscape resize preserves the end window and Browse focus; both landscape windows fit without page or text overflow",
  );

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Ambient motion", { exact: false }).uncheck();
  await page.getByRole("button", { name: /Save & return/ }).click();
  await endpoint(page, false);
  const appReducedTrace = await recordScroll(page, "app-reduced-next", () =>
    endpoint(page, true),
  );
  const appMax = (await inspect(page)).max;
  assert.ok(
    appReducedTrace.every(
      (sample) => sample.x < 1 || Math.abs(sample.x - appMax) < 1.5,
    ),
    "app reduced motion jumps directly between windows",
  );
  checks.push(
    "Both OS preference and app motion setting disable animated scrolling",
  );
  await context.close();

  // Isolate native scroll timing from software-rendered 3D. The full interaction
  // suite and screenshots above use the actual GLB; this probe measures the DOM.
  const probeContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  await probeContext.addInitScript(() =>
    localStorage.setItem(
      "crownfall.main-game.preferences",
      JSON.stringify({ quality: "low", volume: 65, motion: true }),
    ),
  );
  const probe = await probeContext.newPage();
  observeErrors(probe);
  await probe.goto(`${origin}/?model=none`);
  await probe.evaluate(() => document.fonts.ready);
  const smoothTrace = await recordScroll(
    probe,
    "smooth-next-isolated-native",
    () => endpoint(probe, true),
  );
  const maximum = (await inspect(probe)).max;
  assert.ok(
    smoothTrace.some((sample) => sample.x > 2 && sample.x < maximum - 2),
    "normal mode renders intermediate native scroll positions",
  );
  await recordScroll(probe, "smooth-previous-isolated-native", () =>
    endpoint(probe, false),
  );
  await probeContext.close();
  checks.push(
    "Isolated native scroll trace contains smooth intermediate positions without software-3D scheduling interference",
  );

  await recordDemonstration();
  checks.push(
    "Recorded actual-GLB first/last/first windows with settled holds and loading prefix removed",
  );
  assert.deepEqual(failures, [], `Browser errors: ${JSON.stringify(failures)}`);
  await writeFile(
    `${artifactDirectory}/verification.json`,
    `${JSON.stringify({ passed: true, checks, traces }, null, 2)}\n`,
  );
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await browser.close();
}
