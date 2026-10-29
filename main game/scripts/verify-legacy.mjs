// My Legacy desktop verification. Drives the real app in Chromium against the
// environment contract only (landmarks through their DOM labels), so it passes
// with the gameplay stand-in or with the environment workflow's renderer.
// Controller input is simulated through a mocked standard Gamepad API; it is
// not physical controller validation. WebGL here is software-rendered.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const directory = process.env.CROWNFALL_LEGACY_ARTIFACTS || "artifacts/legacy/latest";
const SAVE_KEY = "crownfall.legacy.save";
const PREVIEW_LABEL = "Development preview · fixture data · not saved";
const GUEST_LABEL = "Guest session — not saved";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const checks = [];
const errors = [];
const layouts = [];
let environmentSource = "unknown";
let failure;
const record = (check) => { checks.push(check); console.log(`PASS ${check}`); };
// CROWNFALL_LEGACY_ONLY=entry,founding,... runs a subset while iterating; the full suite is the default.
const only = new Set((process.env.CROWNFALL_LEGACY_ONLY || "").split(",").filter(Boolean));
const section = (name) => only.size === 0 || only.has(name);
// The performance protocol (docs/legacy/PERFORMANCE.md) is long and wants a production preview server, so it runs only when named.
const perfRequested = only.has("perf");
// A perf-only run leaves the suite's verification.json alone and writes performance.json.
const suiteRequested = only.size === 0 || [...only].some((name) => name !== "perf");

function address(params = {}, model = "none") {
  const target = new URL(origin);
  if (model) target.searchParams.set("model", model);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.href;
}

async function createPage({ viewport = { width: 1280, height: 720 }, params = {}, storage = {}, gamepad = false, model = "none", reducedMotion = "reduce", preferences = {}, observeLongTasks = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.addInitScript(({ storage, gamepad, key, preferences, observeLongTasks }) => {
    if (observeLongTasks) {
      // The standard's long-task signal: every main-thread task over 50 ms, as the page itself sees it.
      window.__longTasks = [];
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(entry.duration); }).observe({ type: "longtask", buffered: true });
    }
    // Seed once per tab so reloads keep whatever the app saved.
    if (!sessionStorage.getItem("__legacySeeded")) {
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: false, volume: 65, ...preferences }));
      for (const [name, value] of Object.entries(storage)) localStorage.setItem(name, value);
      sessionStorage.setItem("__legacySeeded", "1");
    }
    window.__legacyWrites = [];
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) window.__legacyWrites.push("set"); return setItem.call(this, name, value); };
    Storage.prototype.removeItem = function (name) { if (name === key) window.__legacyWrites.push("remove"); return removeItem.call(this, name); };
    if (!gamepad) return;
    window.__padPress = [];
    window.__padAxes = [0, 0, 0, 0];
    window.__padReads = 0;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        window.__padReads++;
        const pressed = window.__padPress;
        window.__padPress = [];
        if (pressed.length) (window.__padTrace ||= []).push([Math.round(performance.now()), pressed.join("+")]);
        return [{
          connected: true, index: 0, id: "Simulated standard gamepad", mapping: "standard", axes: [...window.__padAxes],
          buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), touched: pressed.includes(index), value: pressed.includes(index) ? 1 : 0 })),
        }];
      },
    });
  }, { storage, gamepad, key: SAVE_KEY, preferences, observeLongTasks });
  await page.goto(address(params, model));
  await waitForBootReady(page);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, requests };
}

const legacyMode = (page) => page.locator(".legacy-screen").getAttribute("data-legacy-mode");
const activeLabel = (page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || "");
const storedSave = (page) => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
const writes = (page) => page.evaluate(() => window.__legacyWrites.slice());
const waitMode = (page, mode) => page.locator(`.legacy-screen[data-legacy-mode="${mode}"]`).waitFor();
const focusIs = (page, predicate, argument) => page.waitForFunction(predicate, argument);

async function waitForLegacy(page) {
  await page.locator('.legacy-layer[data-legacy-layer="active"]').waitFor();
  await page.locator('.legacy-screen[data-environment-ready="true"]').waitFor({ timeout: 60000 });
  environmentSource = await page.locator(".legacy-screen").getAttribute("data-environment");
}

async function openLegacyByKeyboard(page) {
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await page.keyboard.press("Home");
  await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
  await page.keyboard.press("Enter");
  await waitForLegacy(page);
}

async function openLegacyByMouse(page) {
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await waitForLegacy(page);
}

/** Escape until Home is back, asserting each unwinding step left Legacy only at the end. */
async function escapeToHome(page, maxSteps = 4) {
  for (let step = 0; step < maxSteps; step++) {
    if (await page.locator('.legacy-layer[data-legacy-layer="active"]').count() === 0) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
  await page.locator(".home-grid").waitFor();
  await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy" && document.activeElement?.getAttribute("aria-pressed") === "true");
}

async function pad(page, buttons, after) {
  await page.waitForTimeout(380);
  const reads = await page.evaluate((pressed) => { window.__padPress = pressed; return window.__padReads; }, buttons);
  await page.waitForFunction((previous) => window.__padReads > previous + 1, reads);
  if (!after) return;
  try {
    await after();
  } catch (error) {
    console.error("Controller diagnostic", buttons, await page.evaluate(() => ({
      mode: document.querySelector(".legacy-screen")?.getAttribute("data-legacy-mode"),
      focused: document.activeElement?.outerHTML.slice(0, 160),
      hasFocus: document.hasFocus(),
      trace: (window.__padTrace || []).slice(-6),
      now: Math.round(performance.now()),
      visibility: document.visibilityState,
      labels: [...document.querySelectorAll(".legacy-label")].map((label) => [label.getAttribute("data-landmark"), label.getAttribute("data-visible"), label.style.transform]),
    })));
    if (process.env.CROWNFALL_LEGACY_DEBUG) {
      const reads = await page.evaluate((pressed) => { window.__padPress = pressed; return window.__padReads; }, buttons);
      await page.waitForTimeout(600);
      console.error("Retry", await page.evaluate((previous) => ({ reads: window.__padReads - previous, pending: window.__padPress.length, focused: document.activeElement?.getAttribute("data-landmark"), now: performance.now() }), reads));
    }
    throw error;
  }
}

async function padUntilFocus(page, button, label, limit = 8) {
  for (let attempt = 0; attempt < limit; attempt++) {
    if ((await activeLabel(page)) === label) return;
    await pad(page, [button]);
  }
  assert.equal(await activeLabel(page), label, `controller focus should reach ${label}`);
}

async function keyUntilFocus(page, key, label, limit = 12) {
  for (let attempt = 0; attempt < limit; attempt++) {
    if ((await activeLabel(page)) === label) return;
    await page.keyboard.press(key);
  }
  assert.equal(await activeLabel(page), label, `keyboard focus should reach ${label}`);
}

async function finishBeat(page) {
  await page.locator(".legacy-beat").waitFor({ state: "detached", timeout: 10000 });
  await waitMode(page, "bannerhold");
  await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
}

/** Quick pointer founding with the default nation, a suggested name and the default arms. */
async function foundByPointer(page) {
  await waitMode(page, "founding");
  const card = page.locator(".legacy-founding");
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await card.getByRole("button", { name: "Suggest", exact: true }).click();
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await card.getByRole("button", { name: "Raise the banner", exact: true }).click();
  await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Raise the banner/ }).click();
  await finishBeat(page);
}

// ---------------------------------------------------------------- performance protocol

// The Low preset as Video settings define it: shader particles off and 75 % internal resolution.
const LOW_PRESET = { quality: "low", renderScale: 75 };
const SCRIPT_EVENTS = new Set(["FunctionCall", "FireAnimationFrame", "TimerFire", "EventDispatch", "RunMicrotasks", "EvaluateScript", "v8.callFunction", "ParseHTML"]);

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const WEBGL_CALL = /^(draw[A-Z]|uniform|bind[A-Z]|clear(Color|Depth|Stencil|Buffer)?$|useProgram|buffer(Sub)?Data|tex[A-Z]|vertexAttrib|(enable|disable)(VertexAttribArray)?$|blend[A-Z]|depth(Func|Mask|Range)|cullFace|frontFace|viewport|scissor|colorMask|pixelStorei|activeTexture|framebuffer[A-Z]|renderbuffer[A-Z]|invalidateFramebuffer|stencil[A-Z]|polygonOffset|lineWidth|readPixels|get(Uniform|Attrib|Program|Shader|Parameter|Error|Extension)|compileShader|linkProgram|create(Buffer|Texture|Program|Shader|VertexArray|Framebuffer|Renderbuffer)|delete(Buffer|Texture|Program|Shader|VertexArray|Framebuffer|Renderbuffer)|attachShader|shaderSource|flush|finish|generateMipmap)/;

/**
 * Sums CPU-profile self time by owner: Legacy code (UI and stand-in), other bundles (React, three.js,
 * menu), WebGL calls, other native APIs, the test harness's own injected scripts, and browser work.
 */
function attribute(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const buckets = { legacyCode: 0, otherBundles: 0, webglCalls: 0, gamepadPolling: 0, otherNative: 0, garbageCollector: 0, testHarness: 0, browserNative: 0, idle: 0 };
  for (let index = 0; index < profile.samples.length; index++) {
    const frame = nodes.get(profile.samples[index]);
    // Sample deltas can be slightly negative when samples arrive out of order; they carry no time.
    const ms = Math.max(0, profile.timeDeltas[index] ?? 0) / 1000;
    const name = frame?.functionName ?? "";
    const url = frame?.url ?? "";
    if (name === "(idle)") buckets.idle += ms;
    else if (name === "(program)") buckets.browserNative += ms;
    else if (name === "(garbage collector)") buckets.garbageCollector += ms;
    else if (/\/legacy\/|LegacyScreen-|createStandInEnvironment-/.test(url)) buckets.legacyCode += ms;
    else if (url) buckets.otherBundles += ms;
    // Script without a URL is Playwright's injected evaluation code; native APIs have no source position.
    else if ((frame?.lineNumber ?? -1) >= 0) buckets.testHarness += ms;
    else if (name === "getGamepads") buckets.gamepadPolling += ms;
    else if (WEBGL_CALL.test(name)) buckets.webglCalls += ms;
    else buckets.otherNative += ms;
  }
  for (const key of Object.keys(buckets)) buckets[key] = round(buckets[key]);
  return buckets;
}

/**
 * Records a Chromium trace and a CPU profile around `action`: frame count and intervals,
 * script events bucketed per frame, and JavaScript self time by owner.
 */
async function traceFrames(cdp, action) {
  const events = [];
  const collect = ({ value }) => { for (const event of value) events.push(event); };
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline.frame", "cc", "blink"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
  await cdp.send("Profiler.start");
  await action();
  const { profile } = await cdp.send("Profiler.stop");
  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await complete;
  cdp.off("Tracing.dataCollected", collect);
  const selfTimeMs = attribute(profile);
  const main = events.find((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain");
  if (!main) return { frames: 0, selfTimeMs };
  const onMain = (event) => event.pid === main.pid && event.tid === main.tid;
  const frameStarts = events.filter((event) => onMain(event) && event.name === "BeginMainThreadFrame").map((event) => event.ts).sort((a, b) => a - b);
  const scripts = events.filter((event) => onMain(event) && event.ph === "X" && SCRIPT_EVENTS.has(event.name)).sort((a, b) => a.ts - b.ts);
  const topLevel = [];
  let end = -1;
  for (const event of scripts) if (event.ts >= end) { topLevel.push(event); end = event.ts + (event.dur ?? 0); }
  const perFrame = new Array(Math.max(0, frameStarts.length)).fill(0);
  let index = 0;
  for (const event of topLevel) {
    if (frameStarts.length === 0 || event.ts < frameStarts[0]) continue;
    while (index + 1 < frameStarts.length && frameStarts[index + 1] <= event.ts) index++;
    perFrame[index] += (event.dur ?? 0) / 1000;
  }
  const scriptSorted = perFrame.slice().sort((a, b) => a - b);
  const intervals = [];
  for (let frame = 1; frame < frameStarts.length; frame++) intervals.push((frameStarts[frame] - frameStarts[frame - 1]) / 1000);
  intervals.sort((a, b) => a - b);
  const isTask = (event) => onMain(event) && event.ph === "X" && (event.name === "ThreadControllerImpl::RunTask" || event.name === "RunTask");
  const contains = (outer, inner) => inner.ts >= outer.ts && inner.ts + (inner.dur ?? 0) <= outer.ts + (outer.dur ?? 0);
  // Outermost tasks only, longest first: a RunTask nested in another is the same task.
  const outerTasks = [];
  for (const task of events.filter((event) => isTask(event) && (event.dur ?? 0) > 50000).sort((a, b) => b.dur - a.dur)) {
    if (!outerTasks.some((kept) => contains(kept, task))) outerTasks.push(task);
  }
  const longTasks = outerTasks.map((event) => round(event.dur / 1000));
  // What the longest tasks spent their time on: inclusive durations by event name, and the time inside script events (JavaScript plus any native work it waits on).
  const longTaskAnatomy = outerTasks.slice(0, 4).map((task) => {
    const inside = events.filter((event) => onMain(event) && event.ph === "X" && !isTask(event) && contains(task, event));
    const byName = new Map();
    for (const event of inside) byName.set(event.name, (byName.get(event.name) ?? 0) + (event.dur ?? 0) / 1000);
    const scriptEventMs = topLevel.filter((event) => contains(task, event)).reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0);
    return { ms: round(task.dur / 1000), scriptEventMs: round(scriptEventMs), top: [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, ms]) => `${name} ${round(ms)}`) };
  });
  // The page's own main-thread JavaScript (bundles, the native APIs they call and GC); the harness's scripts are excluded.
  const javascript = selfTimeMs.legacyCode + selfTimeMs.otherBundles + selfTimeMs.webglCalls + selfTimeMs.gamepadPolling + selfTimeMs.otherNative + selfTimeMs.garbageCollector;
  return {
    frames: frameStarts.length,
    selfTimeMs,
    javascriptPerFrameMs: round(javascript / Math.max(1, frameStarts.length)),
    legacyCodePerFrameMs: round(selfTimeMs.legacyCode / Math.max(1, frameStarts.length)),
    scriptPerFrameMs: { mean: round(perFrame.reduce((sum, value) => sum + value, 0) / Math.max(1, perFrame.length)), p50: round(percentile(scriptSorted, 0.5)), p95: round(percentile(scriptSorted, 0.95)), p99: round(percentile(scriptSorted, 0.99)), max: round(scriptSorted[scriptSorted.length - 1] ?? 0) },
    frameIntervalMs: { p50: round(percentile(intervals, 0.5)), p95: round(percentile(intervals, 0.95)), p99: round(percentile(intervals, 0.99)) },
    traceTasksOver50Ms: { count: longTasks.length, maxMs: longTasks.length ? Math.max(...longTasks) : 0 },
    longTaskAnatomy,
  };
}

/** Render-submission cost of the most recent rendered frames (up to 120), from the contract's frame times. */
function submission(stats) {
  const times = (stats?.frameTimesMs ?? []).slice().sort((a, b) => a - b);
  return { samples: times.length, p50: round(percentile(times, 0.5)), p95: round(percentile(times, 0.95)), max: round(times[times.length - 1] ?? 0) };
}

async function heapAndStats(page, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const heap = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
  const stats = await page.evaluate(() => window.__legacyStats?.() ?? null);
  // programs is not in the contract's stats; the stand-in adds it, so it reads null for a renderer that does not.
  return { jsHeapMB: round(heap / 1048576), stats: stats ? { source: stats.source, drawCalls: stats.drawCalls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures, programs: stats.programs ?? null } : null };
}

async function orbitDrag(page, milliseconds) {
  const canvas = page.locator(".legacy-stage canvas").first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width * 0.42;
  const cy = box.y + box.height * 0.55;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < milliseconds) {
    step++;
    await page.mouse.move(cx + Math.sin(step / 6) * box.width * 0.18, cy + Math.cos(step / 9) * box.height * 0.1);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function cycleLandmarks(page) {
  await page.locator('.legacy-label[data-landmark="banner-hall"]').click();
  await page.locator('[data-landmark-panel="banner-hall"]').waitFor();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("e");
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await page.locator("[data-landmark-panel]").waitFor({ state: "detached" });
  await page.waitForTimeout(400);
}

async function measurePerformance() {
  // The dev server answers /@vite/client with JavaScript; a preview server falls back to HTML.
  const development = await fetch(new URL("/@vite/client", origin)).then((response) => response.ok && /javascript/.test(response.headers.get("content-type") ?? "")).catch(() => false);
  const report = { measuredAt: new Date().toISOString(), target: origin, build: development ? "development (Vite dev server)" : "production build (vite preview)", scenarioPreset: "Low (75 % render scale), 1280×720, reduced motion", scenarios: {}, presets: {}, roundTrips: null, throttled4x: {} };
  const scenario = async (bucket, name, page, cdp, action) => {
    await page.evaluate(() => { window.__longTasks.length = 0; });
    const started = Date.now();
    const traced = await traceFrames(cdp, action);
    const wallMs = Date.now() - started;
    const tasks = await page.evaluate(() => window.__longTasks.slice());
    const stats = await page.evaluate(() => window.__legacyStats?.() ?? null);
    bucket[name] = { wallMs, longTasks: { count: tasks.length, maxMs: round(tasks.length ? Math.max(...tasks) : 0), totalMs: round(tasks.reduce((sum, value) => sum + value, 0)) }, ...traced, renderSubmissionMs: submission(stats) };
    console.log(`PERF ${name}: ${JSON.stringify(bucket[name])}`);
  };
  {
    const { context, page } = await createPage({ params: { legacyPreview: "founded", legacyStats: "1" }, preferences: LOW_PRESET, observeLongTasks: true });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await scenario(report.scenarios, "entry", page, cdp, async () => { await openLegacyByKeyboard(page); await page.waitForTimeout(1000); });
    report.scenarios.entry.afterEntry = await heapAndStats(page, cdp);
    await scenario(report.scenarios, "idle10s", page, cdp, () => page.waitForTimeout(10000));
    await scenario(report.scenarios, "orbitDrag5s", page, cdp, () => orbitDrag(page, 5000));
    await scenario(report.scenarios, "landmarkCycling", page, cdp, () => cycleLandmarks(page));
    const before = await heapAndStats(page, cdp);
    for (let trip = 0; trip < 5; trip++) {
      await escapeToHome(page);
      await openLegacyByKeyboard(page);
      await page.waitForTimeout(300);
    }
    const after = await heapAndStats(page, cdp);
    report.roundTrips = { trips: 5, before, after };
    console.log(`PERF roundTrips: ${JSON.stringify(report.roundTrips)}`);
    await context.close();
  }
  {
    const { context, page } = await createPage({ params: { legacy: "fresh", legacyStats: "1" }, preferences: LOW_PRESET, observeLongTasks: true });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await openLegacyByKeyboard(page);
    await scenario(report.scenarios, "nationSwitch", page, cdp, async () => {
      for (const id of ["solforiz", "aethelgard", "kwind-09", "korvenia"]) {
        await page.locator(`[data-nation="${id}"]`).click();
        await page.waitForTimeout(600);
      }
    });
    await page.locator(".legacy-founding").getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator("#legacy-banner-name").focus();
    await scenario(report.scenarios, "foundingTyping", page, cdp, () => page.keyboard.type("House Larkspur of the Long Vigil", { delay: 90 }));
    await context.close();
  }
  for (const preset of ["low", "medium", "high"]) {
    const scale = { low: 75, medium: 90, high: 100 }[preset];
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript(({ preset, scale }) => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: preset, renderScale: scale, motion: false, volume: 65 })), { preset, scale });
    await page.goto(address({ legacyPreview: "honoured", legacyStats: "1" }));
    await waitForBootReady(page);
    await openLegacyByKeyboard(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    report.presets[preset] = { ...(await heapAndStats(page, cdp)), effectivePreset: await page.locator(".legacy-screen").getAttribute("data-quality") };
    console.log(`PERF preset ${preset}: ${JSON.stringify(report.presets[preset])}`);
    await context.close();
  }
  {
    const { context, page } = await createPage({ params: { legacyPreview: "founded", legacyStats: "1" }, preferences: LOW_PRESET, observeLongTasks: true });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await scenario(report.throttled4x, "entry", page, cdp, async () => { await openLegacyByKeyboard(page); await page.waitForTimeout(1000); });
    await scenario(report.throttled4x, "orbitDrag5s", page, cdp, () => orbitDrag(page, 5000));
    await scenario(report.throttled4x, "landmarkCycling", page, cdp, () => cycleLandmarks(page));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await context.close();
  }
  report.caveat = "Software-rendered WebGL (SwiftShader) on a shared 4-CPU container with no GPU, under heavy load from other jobs. Frame intervals and absolute times understate real hardware and never prove smoothness. JavaScript self time by owner (CPU profile), render submission per frame, renderer counts and heap are the closest hardware-independent signals. Long tasks come from the page's longtask observer; selfTimeMs.browserNative is native browser work outside JavaScript (with software WebGL this includes waiting on the rasterizing GPU process), so a long task without matching JavaScript self time is not script work. scriptPerFrameMs buckets top-level script events between frame starts and overstates the tail when frames are sparse. Real-GPU and device smoothness must be confirmed by a person on that hardware.";
  report.notes = { programs: "Linked shader programs come from the stand-in's extra programs field; the contract's stats do not include programs yet.", renderSubmissionMs: "The environment's own frame times: the duration of each renderer.render call over the most recent rendered frames (up to 120)." };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/performance.json`, JSON.stringify(report, null, 2) + "\n");
  record(`Performance protocol measured (${environmentSource}); numbers in ${directory}/performance.json with the software-rendering caveat`);
}

try {
  // 1. Entry by keyboard and mouse, lazy loading, menu suspension and Back to Home.
  if (section("entry")) {
    const { context, page, requests } = await createPage();
    assert.equal(requests.some((path) => /LegacyScreen|createStandInEnvironment|createLegacyEnvironment/.test(path)), false, "Legacy screen and environment load only on entry");
    await openLegacyByKeyboard(page);
    assert.ok(requests.some((path) => /LegacyScreen/.test(path)), "the Legacy screen chunk loads on entry");
    assert.ok(["stand-in", "environment"].includes(environmentSource), `the ready screen names its renderer (got ${environmentSource})`);
    assert.equal(await legacyMode(page), "founding");
    assert.equal(await page.locator("dialog.menu-dialog").evaluate((dialog) => dialog.open), false, "no modal dialog opens");
    const nav = await page.locator(".main-nav").evaluate((element) => ({ visibility: getComputedStyle(element).visibility, inert: element.inert }));
    assert.deepEqual(nav, { visibility: "hidden", inert: true }, "top navigation is hidden and inert in Legacy");
    await page.waitForFunction(() => document.querySelector(".creature-stage")?.classList.contains("is-suspended") && document.querySelector(".atmosphere")?.classList.contains("is-suspended"));
    assert.equal(await page.locator(".creature-stage").evaluate((element) => getComputedStyle(element).visibility), "hidden");
    await focusIs(page, () => document.activeElement?.closest(".legacy-founding") !== null && document.activeElement?.getAttribute("aria-checked") === "true");
    const back = page.locator("[data-legacy-back]");
    assert.equal(await back.isVisible(), true, "Back to Home control is visible");
    assert.equal(await back.getAttribute("aria-label"), "Return to Home");
    await escapeToHome(page);
    assert.equal(await page.locator(".creature-stage").evaluate((element) => element.classList.contains("is-suspended") || getComputedStyle(element).visibility !== "visible"), false, "sorcerer stage restored on Home");
    assert.equal(await page.locator(".main-nav").evaluate((element) => getComputedStyle(element).visibility), "visible");
    // Once faded out, the mounted screen goes dormant so the menu does no style or layout work for it.
    await page.waitForFunction(() => { const layer = document.querySelector(".legacy-layer"); return layer?.classList.contains("is-dormant") && getComputedStyle(layer).contentVisibility === "hidden"; });
    record(`Home → My Legacy by keyboard opens the 3D Legacy screen (no modal, environment: ${environmentSource}); Legacy code loads lazily on entry; top nav hidden; sorcerer and particles suspend; Escape returns Home with the My Legacy tile focused and the hidden screen goes dormant (content-visibility: hidden)`);

    await openLegacyByMouse(page);
    assert.equal(await legacyMode(page), "founding");
    await page.locator("[data-legacy-back]").click();
    await page.locator(".home-grid").waitFor();
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    record("Home → My Legacy by mouse; the always-visible Return to Home control goes back with Home focus restored");
    await context.close();
  }

  // 2. Keyboard-only founding with a typed name, persisted and restored after reload.
  let validSave = "";
  if (section("founding")) {
    const { context, page } = await createPage();
    await openLegacyByKeyboard(page);
    await page.keyboard.press("ArrowRight");
    await focusIs(page, () => document.activeElement?.getAttribute("data-nation") === "solforiz");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator('[data-nation="solforiz"]').getAttribute("aria-checked"), "true");
    await keyUntilFocus(page, "ArrowDown", "Continue");
    await page.keyboard.press("Enter");
    await page.locator('[data-founding-step="name"]').waitFor();
    await focusIs(page, () => document.activeElement?.id === "legacy-banner-name");
    await page.keyboard.type("7 Wells");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".legacy-founding").getAttribute("data-founding-step"), "name", "an invalid name blocks Continue");
    assert.match(await page.locator("#legacy-name-error").innerText(), /letter/i);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("House Amberwell");
    assert.equal(await page.locator("#legacy-name-error").innerText(), "");
    await page.keyboard.press("Enter");
    await page.locator('[data-founding-step="heraldry"]').waitFor();
    await focusIs(page, () => document.activeElement?.id === "legacy-arms-preset");
    await page.keyboard.press("ArrowDown");
    await focusIs(page, () => document.activeElement?.id === "legacy-arms-division");
    const division = await page.locator("#legacy-arms-division").getAttribute("aria-valuetext");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((previous) => document.querySelector("#legacy-arms-division")?.getAttribute("aria-valuetext") !== previous, division);
    assert.ok(await page.locator(".legacy-arms-preview svg path").count() > 1, "live 2D heraldry preview renders");
    await keyUntilFocus(page, "ArrowDown", "Continue");
    await page.keyboard.press("Enter");
    await page.locator('[data-founding-step="confirm"]').waitFor();
    await focusIs(page, () => document.activeElement?.textContent?.trim() === "Raise the banner");
    await page.keyboard.press("ArrowUp");
    await focusIs(page, () => document.activeElement?.id === "legacy-banner-motto");
    await page.keyboard.type("We keep the wells");
    await page.keyboard.press("ArrowDown");
    await focusIs(page, () => document.activeElement?.textContent?.trim() === "Raise the banner");
    await page.keyboard.press("Enter");
    await page.locator("dialog.legacy-dialog[open]").waitFor();
    assert.match(await page.locator("dialog.legacy-dialog").innerText(), /saved on this device/);
    await page.keyboard.press("Enter");
    await page.locator(".legacy-beat").waitFor({ timeout: 5000 });
    await finishBeat(page);
    validSave = await storedSave(page);
    const saved = JSON.parse(validSave);
    assert.equal(saved.banner.name, "House Amberwell");
    assert.equal(saved.banner.nationId, "solforiz");
    assert.equal(saved.banner.motto, "We keep the wells");
    assert.equal(saved.banner.heraldry.division === "plain", false, "edited division is saved");
    assert.equal(saved.members.length, 3);
    assert.equal(await page.locator(".legacy-crest-name").innerText(), "HOUSE AMBERWELL");
    record("Keyboard-only founding: arrows choose Solforiz, the typed name is validated (invalid name blocked), heraldry cycles live in 2D and 3D, the motto is typed, Raise asks for confirmation, the banner-raising beat plays and the found-banner event is saved");

    await page.reload();
    await waitForBootReady(page);
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "bannerhold");
    assert.equal(await page.locator(".legacy-crest-name").innerText(), "HOUSE AMBERWELL");
    assert.equal(JSON.parse(await storedSave(page)).banner.id, saved.banner.id);
    assert.equal(await page.locator(".legacy-label").count(), 4);
    record("The banner, nation, heraldry and motto persist across a reload; re-entry opens the Bannerhold overview with four landmark labels");

    // Landmark selection by keyboard: directions, Q/E and Home/End move between the DOM labels.
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
    await page.keyboard.press("e");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "muster-grounds");
    await page.keyboard.press("End");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    await page.keyboard.press("Home");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
    await page.keyboard.press("ArrowLeft");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "muster-grounds");
    assert.equal(await page.locator('.legacy-label[data-landmark="muster-grounds"]').getAttribute("class").then((value) => value.includes("is-selected")), true);
    record("Overview: arrow keys select landmarks spatially, Q/E cycle them and Home/End jump to the first/last, with the selection and focus visible");

    // Every landmark inspection, cycled with E, with Back unwinding to the overview.
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    const titles = { "banner-hall": "Banner Hall", "muster-grounds": "Muster Grounds", "war-record": "War Record", "heralds-station": "Herald's Station" };
    for (const id of ["banner-hall", "muster-grounds", "war-record", "heralds-station"]) {
      await page.locator(`[data-landmark-panel="${id}"]`).waitFor();
      assert.equal(await page.locator("#legacy-panel-title").innerText(), titles[id].toUpperCase());
      await focusIs(page, () => document.activeElement?.closest(".legacy-panel") !== null);
      if (id !== "heralds-station") await page.keyboard.press("e");
    }
    const hall = page.locator(".legacy-label").first();
    assert.equal(await hall.evaluate((element) => getComputedStyle(element.parentElement).visibility), "hidden", "labels step aside while a panel is open");
    await page.keyboard.press("Escape");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    record("Each landmark opens a contextual inspection panel (Banner Hall, Muster Grounds, War Record, Herald's Station); E cycles panels and Back returns focus to the landmark label");

    // Banner Hall details.
    await page.locator('.legacy-label[data-landmark="banner-hall"]').click();
    const hallText = await page.locator(".legacy-panel").innerText();
    for (const fragment of ["HOUSE AMBERWELL", "The Scorched Caliphate of Solforiz", "Minor Banner", "Recognition 0", "Founding hall", "No honours yet. Honours come only from recorded results.", "Abandon banner and found anew", "We keep the wells"]) assert.ok(hallText.includes(fragment), `Banner Hall shows ${fragment}`);
    record("Banner Hall shows identity, heraldry and blazon, nation, Minor Banner rank, recognition, hall development and the honest empty honours state");

    // Muster Grounds nomination with claimed files and the formation.
    await page.locator(".legacy-panel-cycle--next").click();
    await page.locator('[data-landmark-panel="muster-grounds"]').waitFor();
    const panel = page.locator(".legacy-panel");
    assert.match(await panel.innerText(), /No representative nominated/);
    const claimed = panel.locator(".legacy-file.is-claimed").first();
    assert.match(await claimed.getAttribute("aria-label"), /Claimed by /);
    // aria-disabled keeps the file focusable and clickable: activating it explains the claim.
    await claimed.click({ force: true });
    await page.locator(".legacy-feedback span", { hasText: "Claimed by" }).waitFor();
    await panel.locator('[data-member="member-2"]').click();
    const openFile = await panel.locator(".legacy-file:not(.is-claimed)").nth(1);
    const fileLetter = await openFile.getAttribute("data-file");
    await openFile.click();
    await panel.getByRole("button", { name: "Nominate", exact: true }).click();
    await page.locator(".legacy-representative .legacy-rep-name").waitFor();
    const nominated = JSON.parse(await storedSave(page)).nomination;
    assert.deepEqual(nominated, { memberId: "member-2", file: fileLetter });
    const muster = await panel.innerText();
    for (const fragment of ["Banner", "HOUSE AMBERWELL", `${fileLetter}-file`, "Available", "You command the entire formation, but not everyone on the board belongs to you.", "The national formation follows standard chess. Your file decides who stands there, not how many pieces you move."]) assert.ok(muster.toUpperCase().includes(fragment.toUpperCase()), `Muster Grounds shows ${fragment}`);
    assert.equal(await panel.locator(".legacy-formation-cell.is-player").count(), 1, "exactly one formation piece belongs to the banner");
    assert.equal(await panel.locator(".legacy-formation-cell").count(), 16);
    const before = await page.locator(".legacy-panel").getAttribute("data-landmark-panel");
    await panel.getByRole("button", { name: /^Inspect / }).click();
    assert.equal(await panel.getByRole("button", { name: "Show the grounds", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".legacy-panel").getAttribute("data-landmark-panel"), before, "Back first leaves the representative close-up");
    record("Muster Grounds: claimed files carry their houses and refuse nomination, an available member and open file are nominated and saved, the representative card shows banner allegiance, file and status, Inspect frames the representative, and the 16-piece formation shows one piece of your banner");

    // War Record: honest empty conflict state plus the real ledger.
    await page.locator(".legacy-panel-cycle--next").click();
    await page.locator('[data-landmark-panel="war-record"]').waitFor();
    assert.equal(await page.locator('[data-empty="matches"]').innerText(), "No conflicts recorded yet.");
    const ledger = await page.locator(".legacy-chronicle").innerText();
    assert.match(ledger, /House Amberwell is raised/);
    assert.match(ledger, /is named to the Muster/);
    assert.ok(await page.locator(".legacy-matter--challenge").count() >= 1, "the open challenge is an unresolved matter");
    record("War Record: no fabricated conflicts (honest empty state), unresolved matters and the ledger come from saved data (founding and nomination entries)");

    // Herald's Station: the formal challenge states its wager; accepting shows Awaiting the board.
    await page.locator(".legacy-panel-cycle--next").click();
    await page.locator('[data-landmark-panel="heralds-station"]').waitFor();
    const challenge = page.locator('[data-notice-kind="rival-challenge"]');
    assert.match(await challenge.innerText(), /THE WAGER[\s\S]*terms of this Muster conflict/i);
    assert.match(await page.locator('[data-readiness]').innerText(), /Accept the challenge and its wager first/);
    await page.locator('[data-notice-kind="muster-summons"]').locator("xpath=..").getByRole("button", { name: "Mark as read", exact: true }).click();
    await page.locator('[data-notice-kind="muster-summons"].is-read').waitFor();
    await page.locator("[data-accept]").click();
    const dialog = page.locator("dialog.legacy-dialog[open]");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Accept this challenge\?[\s\S]*THE WAGER[\s\S]*terms of this Muster conflict/i);
    await page.keyboard.press("Escape");
    await page.locator("dialog.legacy-dialog[open]").waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-landmark-panel="heralds-station"]').count(), 1, "Back closes only the dialog");
    await page.locator("[data-accept]").click();
    await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Accept the challenge/ }).click();
    await page.locator("[data-awaiting-board]").waitFor();
    assert.match(await page.locator("[data-awaiting-board]").innerText(), /Awaiting the board[\s\S]*not connected to My Legacy in this build/i);
    assert.match(await challenge.innerText(), /Accepted · awaiting the board/i);
    assert.equal(JSON.parse(await storedSave(page)).notices.find((notice) => notice.kind === "rival-challenge").status, "accepted");
    assert.equal(await page.locator('[data-readiness="ready"]').count(), 1);
    record("Herald's Station: summons and the formal challenge with its national wager stated prominently; read marks are saved; accepting confirms the wager again and shows the truthful Awaiting the board state");

    // Back unwinds dialog → inspection → overview → Home.
    await page.locator('[data-notice-kind="muster-summons"]').focus();
    await page.keyboard.press("Escape");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    assert.equal(await legacyMode(page), "bannerhold");
    await page.keyboard.press("Escape");
    await page.locator(".home-grid").waitFor();
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    record("Back unwinds dialog → inspection → overview → Home and restores Home focus");

    // Abandon with confirmation: Keep first, then dissolve; the save is removed.
    await openLegacyByKeyboard(page);
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.locator('[data-landmark-panel="banner-hall"]').waitFor();
    await page.getByRole("button", { name: "Abandon banner and found anew", exact: true }).click();
    await page.locator("dialog.legacy-dialog[open]").waitFor();
    await focusIs(page, () => document.activeElement?.textContent?.includes("Keep the current banner"));
    await page.keyboard.press("Enter");
    await page.locator("dialog.legacy-dialog[open]").waitFor({ state: "detached" });
    assert.ok(await storedSave(page), "keeping the banner leaves the save");
    await page.getByRole("button", { name: "Abandon banner and found anew", exact: true }).click();
    await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Dissolve and begin anew/ }).click();
    await waitMode(page, "founding");
    assert.equal(await storedSave(page), null);
    record("Abandon banner and found anew asks for confirmation (defaulting to Keep), then dissolves the saved banner and restarts the founding ceremony");
    await context.close();
  }

  // 3. Development preview: labelled everywhere, aftermath limited to two, and never written.
  if (section("preview")) {
    const { context, page } = await createPage({ params: { legacyPreview: "captive" } });
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "bannerhold");
    assert.equal(await page.locator("[data-session-label]").innerText(), PREVIEW_LABEL);
    assert.equal(await page.locator(".legacy-badge-note").first().innerText(), "Representative held captive");
    const aftermath = page.locator(".legacy-aftermath");
    await aftermath.waitFor();
    const entries = await aftermath.locator("[data-aftermath]").count();
    assert.ok(entries >= 1 && entries <= 2, "at most two prominent aftermath messages");
    assert.match(await aftermath.innerText(), /Every fact is kept in the War Record\./);
    await focusIs(page, () => document.activeElement?.textContent?.trim() === "Acknowledge");
    await page.keyboard.press("Escape");
    await aftermath.waitFor({ state: "detached" });
    assert.equal(await legacyMode(page), "bannerhold", "Back sets the aftermath aside without leaving");
    await focusIs(page, () => document.activeElement?.hasAttribute("data-landmark"));
    await page.locator('.legacy-label[data-landmark="muster-grounds"]').click();
    const muster = await page.locator(".legacy-panel").innerText();
    assert.match(muster, /Captive/);
    assert.match(muster, /Held by/i);
    assert.match(muster, /Their place stands empty/);
    await page.keyboard.press("Escape");
    await page.locator('.legacy-label[data-landmark="war-record"]').click();
    assert.ok(await page.locator(".legacy-match--defeat").count() === 1, "the fixture defeat is listed");
    await page.keyboard.press("Escape");
    await page.locator('.legacy-label[data-landmark="banner-hall"]').click();
    assert.match(await page.locator(".legacy-panel").innerText(), /Development previews are fixture data/);
    assert.deepEqual(await writes(page), [], "preview sessions never write the Legacy save");
    assert.equal(await storedSave(page), null);
    record("?legacyPreview=captive shows the persistent preview label and title, at most two aftermath messages with the War Record note (Back sets them aside), the captive state, and makes no storage writes even after interaction");
    await context.close();
  }
  if (section("preview")) {
    const { context, page } = await createPage({ params: { legacyPreview: "allied-loss" } });
    await openLegacyByKeyboard(page);
    const aftermath = page.locator(".legacy-aftermath");
    await aftermath.waitFor();
    assert.ok(await aftermath.locator("[data-aftermath]").count() <= 2);
    await page.keyboard.press("Enter");
    await aftermath.waitFor({ state: "detached" });
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
    await page.keyboard.press("Escape");
    await page.locator(".home-grid").waitFor();
    await openLegacyByKeyboard(page);
    assert.equal(await page.locator(".legacy-aftermath").count(), 0, "acknowledged aftermath stays dismissed");
    assert.deepEqual(await writes(page), []);
    record("Acknowledge (Enter/A) dismisses the aftermath in the session state; preview acknowledgements are still never written");
    await context.close();
  }
  if (section("preview")) {
    const { context, page } = await createPage({ params: { legacyPreview: "no-such-preview" } });
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "preview-missing");
    assert.match(await page.locator("[data-preview-missing]").innerText(), /There is no development preview named "no-such-preview"/);
    assert.ok(await page.locator(".legacy-preview-list a").count() >= 10, "the real previews are listed");
    assert.deepEqual(await writes(page), []);
    record("An unknown preview id explains itself, lists the real development previews and touches no storage");
    await context.close();
  }

  // 4. Guest session: a stored banner is neither read nor changed.
  if (section("guest")) {
    const stored = validSave || JSON.stringify({ seeded: "an existing record" });
    const { context, page } = await createPage({ params: { legacy: "fresh" }, storage: { [SAVE_KEY]: stored } });
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "founding", "the guest does not inherit the stored banner");
    assert.equal(await page.locator("[data-session-label]").innerText(), GUEST_LABEL);
    await foundByPointer(page);
    assert.equal(await page.locator("[data-session-label]").innerText(), GUEST_LABEL);
    assert.equal(await storedSave(page), stored, "the stored banner is untouched");
    assert.deepEqual(await writes(page), []);
    record("?legacy=fresh starts a labelled guest founding that ignores and never writes the stored banner");
    await context.close();
  }

  // 5. Invalid and future saves: recovery leaves the record untouched until a new banner is raised.
  if (section("recovery")) {
    const corrupt = "{\"schemaVersion\":1,\"banner\":";
    const { context, page } = await createPage({ storage: { [SAVE_KEY]: corrupt } });
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "recovery");
    assert.match(await page.locator("[data-recovery]").innerText(), /The banner rolls cannot be read[\s\S]*left untouched/i);
    await focusIs(page, () => document.activeElement?.textContent?.trim() === "Raise a new banner");
    assert.equal(await storedSave(page), corrupt);
    await page.getByRole("button", { name: "Continue as a guest", exact: true }).click();
    await waitMode(page, "founding");
    assert.equal(await page.locator("[data-session-label]").innerText(), GUEST_LABEL);
    assert.equal(await storedSave(page), corrupt);
    await page.reload();
    await waitForBootReady(page);
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "recovery");
    await page.getByRole("button", { name: "Raise a new banner", exact: true }).click();
    await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Raise a new banner/ }).click();
    await waitMode(page, "founding");
    assert.equal(await page.locator("[data-session-label]").count(), 0, "a replacement founding is persistent, not a guest");
    assert.equal(await storedSave(page), corrupt, "nothing is replaced before the new banner is raised");
    await foundByPointer(page);
    const replaced = JSON.parse(await storedSave(page));
    assert.ok(replaced.banner && replaced.schemaVersion === 1);
    record("A corrupt save opens the recovery panel and stays untouched (guest or abandoned founding); Raise a new banner asks for confirmation and only the new banner's first save replaces it");
    await context.close();
  }
  if (section("recovery")) {
    const future = JSON.stringify({ schemaVersion: 99, banner: null });
    const { context, page } = await createPage({ storage: { [SAVE_KEY]: future } });
    await openLegacyByKeyboard(page);
    assert.equal(await page.locator("[data-recovery]").getAttribute("data-recovery"), "future-version");
    assert.match(await page.locator("[data-recovery]").innerText(), /Saved by a newer version/i);
    assert.equal(await storedSave(page), future);
    record("A save from a newer schema is refused with its own explanation and left untouched");
    await context.close();
  }

  // 6. Standard gamepad (simulated): founding, landmarks, bumpers, right-stick orbit and B back to Home.
  if (section("gamepad")) {
    const { context, page } = await createPage({ params: { legacy: "fresh" }, gamepad: true });
    await pad(page, [4], () => page.locator(".home-grid").waitFor());
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    await pad(page, [0]);
    await waitForLegacy(page);
    await pad(page, [15], () => focusIs(page, () => document.activeElement?.getAttribute("data-nation") === "solforiz"));
    await pad(page, [0], () => page.locator('[data-nation="solforiz"][aria-checked="true"]').waitFor());
    await padUntilFocus(page, 13, "Continue");
    await pad(page, [0], () => page.locator('[data-founding-step="name"]').waitFor());
    await pad(page, [15], () => focusIs(page, () => document.activeElement?.textContent?.trim() === "Suggest"));
    await pad(page, [0], () => page.waitForFunction(() => (document.querySelector("#legacy-banner-name")?.value.length ?? 0) >= 2));
    await padUntilFocus(page, 13, "Continue");
    await pad(page, [0], () => page.locator('[data-founding-step="heraldry"]').waitFor());
    const preset = await page.locator("#legacy-arms-preset").getAttribute("aria-valuetext");
    await pad(page, [15], () => page.waitForFunction((previous) => document.querySelector("#legacy-arms-preset")?.getAttribute("aria-valuetext") !== previous, preset));
    await padUntilFocus(page, 13, "Continue");
    await pad(page, [0], () => page.locator('[data-founding-step="confirm"]').waitFor());
    await pad(page, [0], () => page.locator("dialog.legacy-dialog[open]").waitFor());
    await pad(page, [0]);
    await finishBeat(page);
    record("Controller-only founding: D-pad and A choose a nation, Suggest supplies the name, D-pad cycles the arms and A raises the banner");

    await pad(page, [15], () => focusIs(page, () => document.activeElement?.getAttribute("data-landmark") !== "banner-hall"));
    await pad(page, [5]);
    const chosen = await page.evaluate(() => document.activeElement?.getAttribute("data-landmark"));
    assert.ok(chosen, "RB keeps focus on a landmark label");
    await pad(page, [0], () => page.locator(`[data-landmark-panel="${chosen}"]`).waitFor());
    await pad(page, [5], () => page.waitForFunction((id) => document.querySelector("[data-landmark-panel]")?.getAttribute("data-landmark-panel") !== id, chosen));
    await pad(page, [1], () => page.locator("[data-landmark-panel]").waitFor({ state: "detached" }));
    await focusIs(page, () => document.activeElement?.hasAttribute("data-landmark"));
    const label = page.locator('.legacy-label[data-landmark="war-record"]');
    const before = await label.evaluate((element) => element.style.transform);
    // Hold the stick until the label re-projects: the orbit is time-scaled, and software rendering delivers few frames.
    await page.evaluate(() => { window.__padAxes = [0, 0, 1, 0]; });
    await page.waitForFunction((previous) => document.querySelector('.legacy-label[data-landmark="war-record"]')?.style.transform !== previous, before, { timeout: 15000 });
    await page.evaluate(() => { window.__padAxes = [0, 0, 0, 0]; });
    await pad(page, [1], () => page.locator(".home-grid").waitFor());
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    record("Controller in the Bannerhold: D-pad selects landmarks, RB cycles, A opens and RB switches panels, B closes, the right stick nudges the orbit (labels re-project), B returns Home with focus");
    await context.close();
  }

  // 7. Layout at 844×390, 1280×720 and 1920×1080: nothing outside the stage, no horizontal overflow, no clipped text.
  const inspectLayout = async (page, state, viewport) => {
    const result = await page.evaluate(() => {
      const stage = document.querySelector(".menu-stage").getBoundingClientRect();
      const box = (element) => { const rect = element.getBoundingClientRect(); return { name: element.className.toString().split(" ")[0], left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }; };
      const boxes = [...document.querySelectorAll(".legacy-panel, .legacy-card, .legacy-header, .legacy-footer, .legacy-aftermath, .legacy-label[data-visible='true']")].filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden").map(box);
      const outside = boxes.filter((rect) => rect.left < stage.left - 1 || rect.right > stage.right + 1 || rect.top < stage.top - 1 || rect.bottom > stage.bottom + 1);
      const clipped = [...document.querySelectorAll(".legacy-screen h1, .legacy-screen h2, .legacy-screen h3, .legacy-screen button, .legacy-screen .legacy-entry-title, .legacy-screen .legacy-label-title")]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden" && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).textOverflow !== "ellipsis")
        .map((element) => element.textContent.trim().slice(0, 48));
      // The guest/preview label must stay visible on every surface: nothing may cover it.
      const badge = document.querySelector("[data-session-label]");
      let badgeCovered = false;
      if (badge) {
        const rect = badge.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        badgeCovered = !top || !badge.contains(top);
      }
      return { overflow: document.documentElement.scrollWidth > innerWidth, outside, clipped, badgeCovered, stage: { width: Math.round(stage.width), height: Math.round(stage.height) } };
    });
    assert.equal(result.badgeCovered, false, `${state} @${viewport.width}: the session label is covered`);
    assert.equal(result.overflow, false, `${state} @${viewport.width}: horizontal page overflow`);
    assert.deepEqual(result.outside, [], `${state} @${viewport.width}: elements outside the stage`);
    assert.deepEqual(result.clipped, [], `${state} @${viewport.width}: clipped text`);
    layouts.push({ viewport, state, ...result });
  };
  for (const viewport of section("layout") ? [{ width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }] : []) {
    {
      const { context, page } = await createPage({ viewport, params: { legacy: "fresh" } });
      await openLegacyByKeyboard(page);
      for (const step of ["nation", "name", "heraldry", "confirm"]) {
        await page.locator(`[data-founding-step="${step}"]`).waitFor();
        if (step === "name") await page.locator("#legacy-banner-name").fill("House Larkspur");
        await inspectLayout(page, `founding:${step}`, viewport);
        if (step !== "confirm") await page.locator(".legacy-founding").getByRole("button", { name: "Continue", exact: true }).click();
      }
      await context.close();
    }
    {
      const { context, page } = await createPage({ viewport, params: { legacyPreview: "returned" } });
      await openLegacyByKeyboard(page);
      await page.locator(".legacy-aftermath").waitFor();
      await inspectLayout(page, "aftermath", viewport);
      await page.keyboard.press("Escape");
      await page.locator(".legacy-aftermath").waitFor({ state: "detached" });
      await page.waitForTimeout(300);
      await inspectLayout(page, "overview", viewport);
      for (const id of ["banner-hall", "muster-grounds", "war-record", "heralds-station"]) {
        await page.locator(`.legacy-label[data-landmark="${id}"]`).click();
        await page.locator(`[data-landmark-panel="${id}"]`).waitFor();
        await inspectLayout(page, `panel:${id}`, viewport);
        await page.keyboard.press("Escape");
        await page.locator("[data-landmark-panel]").waitFor({ state: "detached" });
      }
      await context.close();
    }
  }
  if (section("layout")) record("Founding steps, overview and all four panels fit the stage at 844×390, 1280×720 and 1920×1080 with no horizontal overflow or clipped text");

  // 8. The decoded sorcerer survives a Legacy round trip: same canvas, no second download.
  if (section("sorcerer")) {
    const { context, page, requests } = await createPage({ model: null });
    await page.locator(".creature-model--loaded").waitFor({ timeout: 120000 });
    await page.evaluate(() => { window.__creatureCanvas = document.querySelector(".creature-model canvas"); });
    const downloads = () => requests.filter((path) => path.endsWith(".glb")).length;
    const initialDownloads = downloads();
    await openLegacyByKeyboard(page);
    await page.waitForFunction(() => document.querySelector(".creature-stage")?.classList.contains("is-suspended"));
    await escapeToHome(page);
    const preserved = await page.evaluate(() => ({ same: document.querySelector(".creature-model canvas") === window.__creatureCanvas, loaded: !!document.querySelector(".creature-model--loaded"), suspended: document.querySelector(".creature-stage").classList.contains("is-suspended") }));
    assert.deepEqual(preserved, { same: true, loaded: true, suspended: false });
    assert.equal(downloads(), initialDownloads, "the sorcerer is not downloaded again");
    record("With the supplied sorcerer GLB, a Home ↔ Legacy round trip keeps the same decoded model and canvas (paused and hidden while covered) and never downloads it again");
    await context.close();
  }

  // 9. Configurable bindings: a remapped keyboard drives Home → Legacy, landmarks, panels and Back.
  if (section("bindings")) {
    const bindings = { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", select: "KeyF", back: "Backspace", previousTab: "KeyZ", nextTab: "KeyC", first: "PageUp", last: "PageDown" };
    const { context, page } = await createPage({ params: { legacyPreview: "founded" }, preferences: { bindings } });
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await page.locator(".home-grid").waitFor();
    await page.keyboard.press("PageUp");
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    await page.keyboard.press("f");
    await waitForLegacy(page);
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
    await page.keyboard.press("c");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "muster-grounds");
    await page.keyboard.press("PageDown");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    await page.keyboard.press("PageUp");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "banner-hall");
    await page.keyboard.press("a");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "muster-grounds");
    await page.keyboard.press("f");
    await page.locator('[data-landmark-panel="muster-grounds"]').waitFor();
    await page.keyboard.press("c");
    await page.locator('[data-landmark-panel="war-record"]').waitFor();
    await page.keyboard.press("z");
    await page.locator('[data-landmark-panel="muster-grounds"]').waitFor();
    await page.keyboard.press("Backspace");
    await page.locator("[data-landmark-panel]").waitFor({ state: "detached" });
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "muster-grounds");
    await page.keyboard.press("Backspace");
    await page.locator(".home-grid").waitFor();
    await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
    record("Remapped keyboard bindings (WASD, F, Backspace, Z/C, PageUp/PageDown) open My Legacy, move and cycle landmarks, open and cycle panels and unwind Back to Home");
    await context.close();
  }

  // 10. Adaptive quality: sustained slow frames step the preset down once and say so once; the saved preset is untouched.
  if (section("adaptive")) {
    const { context, page } = await createPage({ params: { legacyPreview: "founded", legacyStandIn: "1" }, preferences: { quality: "high" } });
    // Every draw call costs 1.5 ms of main-thread time, so frames are genuinely slow (a CPU-bound low-end proxy).
    await page.evaluate(() => {
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
          const original = prototype[name];
          if (typeof original !== "function") continue;
          prototype[name] = function (...args) {
            const end = performance.now() + 1.5;
            while (performance.now() < end) { /* simulated cost */ }
            return original.apply(this, args);
          };
        }
      }
    });
    await openLegacyByKeyboard(page);
    const quality = () => page.locator(".legacy-screen").getAttribute("data-quality");
    assert.equal(await quality(), "high");
    const box = await page.locator(".legacy-stage canvas").first().boundingBox();
    const cx = box.x + box.width * 0.4;
    const cy = box.y + box.height * 0.55;
    const drag = async (until) => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let step = 1; !(await until()); step++) {
        await page.mouse.move(cx + Math.sin(step / 5) * box.width * 0.2, cy + Math.cos(step / 7) * box.height * 0.1);
        await page.waitForTimeout(30);
      }
      await page.mouse.up();
    };
    const started = Date.now();
    await drag(async () => {
      assert.ok(Date.now() - started < 90000, "sustained slow frames step the preset down within 90 s");
      return (await quality()) !== "high";
    });
    assert.equal(await quality(), "medium", "one step: High to Medium");
    await page.locator(".legacy-feedback span", { hasText: "Graphics stepped down to Medium to hold a smooth frame rate." }).waitFor();
    const held = Date.now();
    await drag(async () => Date.now() - held > 14000);
    assert.equal(await quality(), "medium", "the automatic step happens once per visit");
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("crownfall.main-game.preferences"))).quality, "high", "the player's own preset is not rewritten");
    record(`Adaptive quality (stand-in frame times, simulated 1.5 ms per draw call): sustained slow frames step High down to Medium once after the grace period, the player is told once, and the saved preset is untouched`);
    await context.close();
  }

  // 11. Performance protocol (opt-in): traces, long tasks, heap and renderer statistics.
  if (perfRequested) await measurePerformance();

  assert.deepEqual(errors, [], "no JavaScript or console errors");
  record("No JavaScript or console errors");
} catch (error) {
  failure = error;
} finally {
  await mkdir(directory, { recursive: true });
  if (suiteRequested) await writeFile(`${directory}/verification.json`, JSON.stringify({
    passed: !failure,
    environment: environmentSource,
    scope: "Playwright against the dev or preview server with model=none except the sorcerer round-trip check. Landmarks are driven through their DOM labels, so the suite runs against the stand-in or the environment workflow's renderer. Controller input is a mocked standard Gamepad API, not physical controller validation. WebGL is software-rendered (SwiftShader); no frame timing is implied.",
    checks,
    layouts,
    errors,
    ...(failure ? { failure: String(failure.stack || failure) } : {}),
  }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
console.log(`PASS ${checks.length} My Legacy verification groups (environment: ${environmentSource})`);
