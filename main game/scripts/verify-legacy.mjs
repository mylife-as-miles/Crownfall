// My Legacy desktop verification. Drives the real app in Chromium against the
// environment contract only (landmarks through their DOM labels), so it passes
// with the gameplay stand-in or with the environment workflow's renderer.
// Controller input is simulated through a mocked standard Gamepad API; it is
// not physical controller validation. WebGL here is software-rendered.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
      window.__longTaskStarts = [];
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) { window.__longTasks.push(entry.duration); window.__longTaskStarts.push(entry.startTime); } }).observe({ type: "longtask", buffered: true });
      // Entry feedback: when a loading indicator first enters the DOM, and when a frame including it has been produced.
      window.__loading = {};
      new MutationObserver(() => {
        if (window.__loading.inserted !== undefined || !document.querySelector(".legacy-layer-loading, .legacy-loading")) return;
        window.__loading.inserted = performance.now();
        requestAnimationFrame(() => setTimeout(() => { window.__loading.framed = performance.now(); }, 0));
      }).observe(document, { subtree: true, childList: true });
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
    window.addEventListener("load", () => window.dispatchEvent(new Event("gamepadconnected")));
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
  // gpu and gpu.service add the renderer's command-buffer waits and the GPU process's own tasks, so a long task can be attributed.
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline.frame", "cc", "blink", "gpu", "disabled-by-default-gpu.service"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
  await cdp.send("Profiler.start");
  await action();
  const { profile } = await cdp.send("Profiler.stop");
  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await complete;
  cdp.off("Tracing.dataCollected", collect);
  const selfTimeMs = attribute(profile);
  // The page's renderer main thread is the one with the most events; the GPU process main thread does SwiftShader's compositing and GL work.
  const mains = events.filter((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain");
  const eventCount = (thread) => events.reduce((count, event) => count + (event.pid === thread.pid && event.tid === thread.tid ? 1 : 0), 0);
  const main = mains.sort((a, b) => eventCount(b) - eventCount(a))[0];
  if (!main) return { frames: 0, selfTimeMs };
  const gpuMain = events.find((event) => event.name === "thread_name" && event.args?.name === "CrGpuMain");
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
  // What the long tasks spent their time on: inclusive durations by event name, the time inside script events, the renderer
  // thread's own CPU time, its waits on the GPU process (command-buffer round trips), and what the GPU process was doing meanwhile.
  const gpuTasks = [];
  if (gpuMain) {
    for (const task of events.filter((event) => event.pid === gpuMain.pid && event.tid === gpuMain.tid && isTask(event)).sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))) {
      if (!gpuTasks.some((kept) => contains(kept, task))) gpuTasks.push(task);
    }
  }
  const overlap = (event, task) => Math.max(0, Math.min(event.ts + (event.dur ?? 0), task.ts + task.dur) - Math.max(event.ts, task.ts)) / 1000;
  const longTaskAnatomy = outerTasks.slice(0, 6).map((task) => {
    const inside = events.filter((event) => onMain(event) && event.ph === "X" && !isTask(event) && contains(task, event));
    const byName = new Map();
    for (const event of inside) byName.set(event.name, (byName.get(event.name) ?? 0) + (event.dur ?? 0) / 1000);
    const scriptEventMs = topLevel.filter((event) => contains(task, event)).reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0);
    const gpuWaitMs = inside.filter((event) => /^CommandBufferProxyImpl::WaitFor/.test(event.name)).reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0);
    const gpuBusyMs = gpuTasks.reduce((sum, gpuTask) => sum + overlap(gpuTask, task), 0);
    const gpuByName = new Map();
    if (gpuMain) for (const event of events) if (event.pid === gpuMain.pid && event.tid === gpuMain.tid && event.ph === "X" && !isTask(event)) { const ms = overlap(event, task); if (ms > 0) gpuByName.set(event.name, (gpuByName.get(event.name) ?? 0) + ms); }
    const wallMs = task.dur / 1000;
    const threadMs = typeof task.tdur === "number" ? task.tdur / 1000 : null;
    const harness = byName.has("CpuProfiler::StartProfiling");
    const cause = harness ? "harness (CPU profiler start)"
      : gpuWaitMs >= 0.5 * wallMs ? "waiting on the GPU process"
        : threadMs !== null && threadMs < 0.5 * wallMs ? "renderer thread off-CPU (host contention)"
          : "renderer main-thread work";
    return {
      ms: round(wallMs),
      threadMs: threadMs === null ? null : round(threadMs),
      scriptEventMs: round(scriptEventMs),
      gpuWaitMs: round(gpuWaitMs),
      gpuProcessBusyMs: round(gpuBusyMs),
      cause,
      top: [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, ms]) => `${name} ${round(ms)}`),
      gpuProcessTop: [...gpuByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, ms]) => `${name} ${round(ms)}`),
    };
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

function distribution(values) {
  const times = (values ?? []).slice().sort((a, b) => a - b);
  return { samples: times.length, p50: round(percentile(times, 0.5)), p95: round(percentile(times, 0.95)), max: round(times[times.length - 1] ?? 0) };
}

/** Render-submission cost (main-thread time inside renderer.render) of the most recent rendered frames, up to 120. */
function submission(stats) {
  return distribution(stats?.submissionTimesMs);
}

/** Frame pacing: intervals between rendered frames during continuous rendering (the contract's frameTimesMs, as the stand-in fills it). */
function pacing(stats) {
  return distribution(stats?.frameTimesMs);
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
    await page.evaluate(() => { window.__longTasks.length = 0; window.__longTaskStarts.length = 0; });
    const started = Date.now();
    const traced = await traceFrames(cdp, action);
    const wallMs = Date.now() - started;
    const tasks = await page.evaluate(() => window.__longTasks.slice());
    const stats = await page.evaluate(() => window.__legacyStats?.() ?? null);
    const attributed = (traced.longTaskAnatomy ?? []).filter((task) => !task.cause.startsWith("harness"));
    bucket[name] = {
      wallMs,
      longTasks: { count: tasks.length, maxMs: round(tasks.length ? Math.max(...tasks) : 0), totalMs: round(tasks.reduce((sum, value) => sum + value, 0)) },
      // Long tasks by cause, from the trace (the CPU profiler's own start-up task is excluded).
      longTaskCauses: attributed.reduce((causes, task) => ({ ...causes, [task.cause]: (causes[task.cause] ?? 0) + 1 }), {}),
      ...traced,
      renderSubmissionMs: submission(stats),
      framePacingMs: pacing(stats),
    };
    console.log(`PERF ${name}: ${JSON.stringify(bucket[name])}`);
  };
  {
    const { context, page } = await createPage({ params: { legacyPreview: "founded", legacyStats: "1" }, preferences: LOW_PRESET, observeLongTasks: true });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await scenario(report.scenarios, "entry", page, cdp, async () => { await openLegacyByKeyboard(page); await page.waitForTimeout(1000); });
    report.scenarios.entry.afterEntry = await heapAndStats(page, cdp);
    // Every entry long task should start after the loading state was on screen (inserted and a frame produced).
    const feedback = await page.evaluate(() => ({ ...window.__loading, starts: window.__longTaskStarts.slice() }));
    report.scenarios.entry.loadingFeedback = {
      loadingFramedAtMs: feedback.framed === undefined ? null : round(feedback.framed),
      longTasksBeforeFeedback: feedback.framed === undefined ? feedback.starts.length : feedback.starts.filter((start) => start < feedback.framed).length,
    };
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
  report.caveat = "Software-rendered WebGL (SwiftShader) on a shared 4-CPU container with no GPU, under heavy load from other jobs. Long tasks are attributed from the trace (longTaskAnatomy and longTaskCauses): with SwiftShader the GPU process composites and rasterizes on the CPU, so synchronous WebGL calls (context creation, the first use of a shader program) can wait behind a slow SwapBuffers. Frame intervals and absolute times understate real hardware and never prove smoothness. JavaScript self time by owner (CPU profile), render submission per frame, renderer counts and heap are the closest hardware-independent signals. Long tasks come from the page's longtask observer; selfTimeMs.browserNative is native browser work outside JavaScript (with software WebGL this includes waiting on the rasterizing GPU process), so a long task without matching JavaScript self time is not script work. scriptPerFrameMs buckets top-level script events between frame starts and overstates the tail when frames are sparse. Real-GPU and device smoothness must be confirmed by a person on that hardware.";
  report.notes = {
    programs: "Linked shader programs come from the stand-in's extra programs field; the contract's stats do not include programs yet.",
    renderSubmissionMs: "Main-thread time inside each renderer.render call over the most recent rendered frames (up to 120), from the stand-in's extra submissionTimesMs field.",
    framePacingMs: "The contract's frameTimesMs as the stand-in fills it: intervals between rendered frames during continuous rendering (a definition requested for the contract), so GPU-bound frames count. Adaptive quality reads it.",
    longTaskAnatomy: "Per long task: wall time, the renderer main thread's own CPU time (threadMs), time inside script events, time blocked on GPU-process round trips (gpuWaitMs: CommandBufferProxyImpl::WaitFor* slices), how long the GPU process main thread was busy meanwhile and with what (gpuProcessTop). cause classifies the task: waiting on the GPU process, renderer thread off-CPU (host contention: wall time far above thread time without GPU waits), or renderer main-thread work.",
  };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/performance.json`, JSON.stringify(report, null, 2) + "\n");
  record(`Performance protocol measured (${environmentSource}); numbers in ${directory}/performance.json with the software-rendering caveat`);
}

// ---------------------------------------------------------------- chess comes first

/**
 * One launch of the menu: navigation start to the menu accepting input on the Play tab, to the first key
 * press selecting the Classic card, and to the Classic card opening (it opens a preview: no board is connected).
 * Records every Legacy request and every read of the Legacy save before My Legacy is opened.
 */
async function measureLaunch({ save, model, run }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.addInitScript(({ save, key }) => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: false, volume: 65 }));
    if (save) localStorage.setItem(key, save);
    else localStorage.removeItem(key);
    window.__saveReads = 0;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) { if (name === key) window.__saveReads++; return getItem.call(this, name); };
    window.__launch = {};
    const mark = (name) => { if (window.__launch[name] === undefined) window.__launch[name] = performance.now(); };
    new MutationObserver(() => {
      if (document.querySelector('.menu-shell[data-boot-state="ready"]')) mark("menuReady");
      if (document.querySelector('.game-card[aria-label="Classic"][aria-pressed="true"]')) mark("classicSelected");
      if (document.querySelector("dialog.menu-dialog[open]")) mark("classicOpened");
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-boot-state", "aria-pressed", "open"] });
  }, { save, key: SAVE_KEY });
  await page.goto(address({}, model));
  await waitForBootReady(page);
  await page.waitForFunction(() => window.__launch.menuReady !== undefined);
  // The menu opens on the Play tab with Local Duel selected; one key selects Classic, Enter opens it.
  const keyAt = await page.evaluate(() => performance.now());
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => window.__launch.classicSelected !== undefined);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__launch.classicOpened !== undefined);
  assert.match(await page.locator("dialog.menu-dialog").innerText(), /Classic[\s\S]*not connected to this menu/);
  const marks = await page.evaluate(() => ({ ...window.__launch, saveReads: window.__saveReads }));
  await context.close();
  const legacyRequests = requests.filter((path) => /LegacyScreen|createStandInEnvironment|createLegacyEnvironment|\/legacy\//.test(path));
  return {
    model: model ?? "default",
    save: save !== null,
    run,
    menuReadyMs: round(marks.menuReady),
    firstKeySentMs: round(keyAt),
    firstInputAcceptedMs: round(marks.classicSelected),
    classicOpenedMs: round(marks.classicOpened),
    saveReads: marks.saveReads,
    legacyRequests,
  };
}

/** Starting states for the actions-back-to-Play count, each with how to reach it from a freshly opened My Legacy. */
const ACTION_STARTS = [
  { start: "founding (nation step)", params: { legacy: "fresh" }, setup: async () => {} },
  {
    start: "founding (review step)",
    params: { legacy: "fresh" },
    setup: async (page) => {
      const card = page.locator(".legacy-founding");
      await card.getByRole("button", { name: "Continue", exact: true }).click();
      await card.getByRole("button", { name: "Suggest", exact: true }).click();
      await card.getByRole("button", { name: "Continue", exact: true }).click();
      await card.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator('[data-founding-step="confirm"]').waitFor();
    },
  },
  { start: "overview", params: { legacyPreview: "founded" }, setup: async () => {} },
  ...["banner-hall", "muster-grounds", "war-record", "heralds-station"].map((id) => ({
    start: `inspector: ${id}`,
    params: { legacyPreview: "founded" },
    setup: async (page) => {
      await page.locator(`.legacy-label[data-landmark="${id}"]`).click();
      await page.locator(`[data-landmark-panel="${id}"]`).waitFor();
    },
  })),
  {
    start: "dialog (accept the challenge)",
    params: { legacyPreview: "founded" },
    setup: async (page) => {
      await page.locator('.legacy-label[data-landmark="heralds-station"]').click();
      await page.locator("[data-accept]").first().click();
      await page.locator("dialog.legacy-dialog[open]").waitFor();
    },
  },
  { start: "aftermath", params: { legacyPreview: "captive" }, setup: async (page) => { await page.locator(".legacy-aftermath").waitFor(); } },
];

/**
 * Counts the inputs from a Legacy screen to the Play tab, and on to opening the Classic card: by pointer
 * (the footer Play route; an open dialog is closed with its Back button first) or by keyboard (Escape, the
 * configured Back key, until Play shows; then Left to Classic if needed and Enter).
 */
async function measureActionsToPlay({ start, params, setup }, method) {
  const { context, page } = await createPage({ params });
  await openLegacyByKeyboard(page);
  await setup(page);
  const onPlay = async () => (await page.locator(".game-cards").count()) > 0 && (await page.locator('.main-nav [role="tab"][aria-label="Play"]').getAttribute("aria-selected")) === "true";
  let toPlay = 0;
  if (method === "pointer") {
    const dialog = page.locator("dialog.legacy-dialog[open]");
    if (await dialog.count()) {
      await dialog.locator(".legacy-dialog-actions button").last().click();
      toPlay++;
      await dialog.waitFor({ state: "detached" });
    }
    await page.locator("[data-legacy-play]").click();
    toPlay++;
  } else {
    for (let attempt = 0; attempt < 10 && !(await onPlay()); attempt++) {
      await page.keyboard.press("Escape");
      toPlay++;
      await page.waitForTimeout(180);
    }
  }
  await page.locator(".game-cards").waitFor({ timeout: 10000 }).catch(() => {});
  const reachedPlay = await onPlay();
  let toClassic = toPlay;
  if (reachedPlay) {
    const classic = page.getByRole("button", { name: "Classic", exact: true });
    if (method === "pointer") {
      await classic.click();
      toClassic++;
    } else {
      for (let attempt = 0; attempt < 4 && (await classic.getAttribute("aria-pressed")) !== "true"; attempt++) {
        await page.keyboard.press("ArrowLeft");
        toClassic++;
      }
      await page.keyboard.press("Enter");
      toClassic++;
    }
    await page.locator("dialog.menu-dialog[open]").waitFor();
  }
  await context.close();
  return { start, method, toPlay, toClassicOpened: toClassic, reachedPlay };
}

/** Walks the web chess app's import graph from its entry (static and dynamic imports, the @ alias) without bundling it. */
async function webEntryGraph() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const webRoot = resolve(scriptDirectory, "../../web");
  const entry = join(webRoot, "src/main.tsx");
  const seen = new Set();
  const packages = new Set();
  const queue = [entry];
  const specifiers = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  const exists = (file) => access(file).then(() => true, () => false);
  const resolveFile = async (base) => {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")]) {
      if (/\.(ts|tsx|js|jsx|mjs)$/.test(candidate) && await exists(candidate)) return candidate;
    }
    return null;
  };
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(specifiers)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      let base = null;
      if (specifier.startsWith("./") || specifier.startsWith("../")) base = resolve(dirname(file), specifier);
      else if (specifier.startsWith("@/")) base = join(webRoot, "src", specifier.slice(2));
      else { packages.add(specifier); continue; }
      const target = await resolveFile(base);
      if (target) queue.push(target);
    }
  }
  const files = [...seen].map((file) => file.slice(webRoot.length + 1));
  const legacyFiles = files.filter((file) => /(^|\/)legacy(\/|$)/i.test(file) || /shared\/legacy/.test(file));
  const legacyPackages = [...packages].filter((name) => /legacy/i.test(name));
  return { entry: "web/src/main.tsx", files: files.length, legacyFiles: [...legacyFiles, ...legacyPackages], packages: [...packages].sort() };
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
    assert.match(await page.locator(".legacy-raise-note").innerText(), /saved on this device/, "the review step states that the banner is saved");
    await page.keyboard.press("Enter");
    await page.locator(".legacy-beat").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("dialog.legacy-dialog[open]").count(), 0, "raising asks no second confirmation");
    await finishBeat(page);
    validSave = await storedSave(page);
    const saved = JSON.parse(validSave);
    assert.equal(saved.banner.name, "House Amberwell");
    assert.equal(saved.banner.nationId, "solforiz");
    assert.equal(saved.banner.motto, "We keep the wells");
    assert.equal(saved.banner.heraldry.division === "plain", false, "edited division is saved");
    assert.equal(saved.members.length, 3);
    assert.equal(await page.locator(".legacy-crest-name").innerText(), "HOUSE AMBERWELL");
    record("Keyboard-only founding: arrows choose Solforiz, the typed name is validated (invalid name blocked), heraldry cycles live in 2D and 3D, the motto is typed, the review step states what is saved and Raise founds directly (no repeated confirmation), the banner-raising beat plays and the found-banner event is saved");

    await page.reload();
    await waitForBootReady(page);
    await openLegacyByKeyboard(page);
    assert.equal(await legacyMode(page), "bannerhold");
    assert.equal(await page.locator(".legacy-crest-name").innerText(), "HOUSE AMBERWELL");
    assert.equal(JSON.parse(await storedSave(page)).banner.id, saved.banner.id);
    assert.equal(await page.locator(".legacy-label").count(), 4);
    const strip = page.locator(".legacy-next-strip [data-next-step]");
    assert.equal(await strip.getAttribute("data-next-step"), "nominate");
    assert.match(await strip.innerText(), /NEXT STEP[\s\S]*Name your Pawn at the Muster Grounds[\s\S]*Nominate a member and an open file for the Muster\./i);
    record("The banner, nation, heraldry and motto persist across a reload; re-entry opens the Bannerhold overview with four landmark labels and a Next step strip (Name your Pawn at the Muster Grounds) with a direct jump");

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

    // Banner Hall details: its primary action is the next step toward a match; dissolving waits behind Manage banner.
    await page.locator('.legacy-label[data-landmark="banner-hall"]').click();
    const hallText = await page.locator(".legacy-panel").innerText();
    for (const fragment of ["HOUSE AMBERWELL", "The Scorched Caliphate of Solforiz", "Minor Banner", "Founding hall", "No honours yet. Honours come only from recorded results.", "We keep the wells", "MANAGE BANNER"]) assert.ok(hallText.includes(fragment), `Banner Hall shows ${fragment}`);
    assert.equal(await page.locator(".legacy-ledger-row", { hasText: "Recognition" }).locator("dd").innerText(), "0", "recognition is a number under its label, not repeated");
    assert.equal(await page.locator(".legacy-panel").getByRole("button", { name: "Dissolve banner", exact: true }).isVisible(), false, "dissolving is not a primary control");
    await focusIs(page, () => document.activeElement?.getAttribute("data-next-step") === "nominate");
    record("Banner Hall shows identity, heraldry and blazon, nation, Minor Banner rank, recognition (a plain number), hall development and the honest empty honours state; its focused primary action is the next step toward a match, and the dissolve control sits behind a closed Manage banner disclosure");

    // Muster Grounds nomination with claimed files and the formation, reached through the Banner Hall's next step.
    await page.keyboard.press("Enter");
    await page.locator('[data-landmark-panel="muster-grounds"]').waitFor();
    const panel = page.locator(".legacy-panel");
    assert.equal(await panel.locator("[data-seat]").count(), 0, "no representative is shown before a nomination");
    await focusIs(page, () => document.activeElement?.hasAttribute("data-nominate"));
    assert.equal(await panel.locator('.legacy-formation-section .legacy-formation').count(), 1, "the formation leads the panel");
    const claimed = panel.locator(".legacy-file.is-claimed").first();
    assert.match(await claimed.getAttribute("aria-label"), /Claimed by /);
    // aria-disabled keeps the file focusable and clickable: activating it explains the claim.
    await claimed.click({ force: true });
    await page.locator(".legacy-feedback span", { hasText: "Claimed by" }).waitFor();
    await panel.locator('[data-member="member-2"]').click();
    const openFile = await panel.locator(".legacy-file:not(.is-claimed)").nth(1);
    const fileLetter = await openFile.getAttribute("data-file");
    await openFile.click();
    assert.equal(await panel.locator(".legacy-member-origin").count(), 3, "every member row shows the person's origin");
    await panel.getByRole("button", { name: "Nominate", exact: true }).click();
    await page.locator(".legacy-representative .legacy-rep-name").waitFor();
    const savedAfterNomination = JSON.parse(await storedSave(page));
    assert.deepEqual(savedAfterNomination.nomination, { memberId: "member-2", file: fileLetter });
    const nominee = savedAfterNomination.members.find((member) => member.id === "member-2");
    assert.equal(await panel.locator(".legacy-rep-origin").innerText(), nominee.origin, "the representative card shows the person's origin");
    assert.equal(await panel.locator('[data-seat="available"]').count(), 1, "the formation names the representative and their condition");
    // The nomination stands, so the panel's primary action moves on to the next step and focus follows it.
    await focusIs(page, () => document.activeElement?.getAttribute("data-next-step") === "answer");
    assert.match(await page.evaluate(() => document.activeElement?.innerText ?? ""), /Answer House \S+.*'s challenge/);
    const muster = await panel.innerText();
    for (const fragment of ["Banner", "HOUSE AMBERWELL", `${fileLetter}-file`, "Available", "You move the entire formation, but not everyone on the board belongs to your house.", "The national formation follows standard chess. Your file decides who stands there, not how many pieces you move."]) assert.ok(muster.toUpperCase().includes(fragment.toUpperCase()), `Muster Grounds shows ${fragment}`);
    assert.equal(await panel.locator(".legacy-formation-cell.is-player").count(), 1, "exactly one formation piece belongs to the banner");
    assert.equal(await panel.locator(".legacy-formation-cell").count(), 16);
    assert.equal(await panel.locator(".legacy-file.is-claimed .legacy-formation-mark").count(), await panel.locator(".legacy-file.is-claimed").count(), "every claimed file carries its holder's mark");
    const before = await page.locator(".legacy-panel").getAttribute("data-landmark-panel");
    await panel.getByRole("button", { name: /^Inspect / }).click();
    assert.equal(await panel.getByRole("button", { name: "Show the grounds", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".legacy-panel").getAttribute("data-landmark-panel"), before, "Back first leaves the representative close-up");
    record("Muster Grounds: the 16-piece formation leads the panel and its pawn row is the file choice (claimed files carry the holder's mark and refuse nomination); member rows and the representative card show each person's origin; Nominate is the focused primary action, the nomination is saved, the formation shows one piece of your banner, and focus then moves to the next step (answer the challenge); Inspect frames the representative");

    // War Record: honest empty conflict state plus the real ledger.
    await page.locator(".legacy-panel-cycle--next").click();
    await page.locator('[data-landmark-panel="war-record"]').waitFor();
    assert.equal(await page.locator('[data-empty="matches"]').innerText(), "No conflicts recorded yet.");
    const ledger = await page.locator(".legacy-chronicle").innerText();
    assert.match(ledger, /House Amberwell is raised/);
    assert.match(ledger, /is named to the Muster/);
    assert.ok(await page.locator(".legacy-matter--challenge").count() >= 1, "the open challenge is an unresolved matter");
    assert.equal(await page.locator(".legacy-matter-kind").count(), 0, "matters do not repeat their kind above a title that names it");
    assert.equal(await page.locator('.legacy-panel [data-next-step="answer"]').count(), 1, "the War Record points to the next step");
    record("War Record: no fabricated conflicts (honest empty state), unresolved matters (without a repeated kind label) and the ledger come from saved data (founding and nomination entries); it opens on the next step toward the match");

    // Herald's Station: the formal challenge states its wager; accepting shows Awaiting the board.
    await page.locator(".legacy-panel-cycle--next").click();
    await page.locator('[data-landmark-panel="heralds-station"]').waitFor();
    const challenge = page.locator('[data-notice-kind="rival-challenge"]');
    assert.match(await challenge.innerText(), /THE WAGER[\s\S]*terms of this Muster conflict/i);
    assert.equal(await challenge.locator("[data-stance]").innerText(), "WARY", "the rival's stance sits beside its seal");
    assert.equal(await page.locator(".legacy-notice-from").count(), 0, "no separate From line repeats the sender");
    assert.equal(await challenge.locator("[data-wager-term]").count(), 4, "the wager lists its stated terms from the shared builder");
    const wagerSize = await challenge.locator("[data-wager-term] dd").first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const bodySize = await page.locator(".legacy-screen").evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    assert.ok(wagerSize >= bodySize && wagerSize >= 12, `the wager is set at body size or larger (${wagerSize}px, body ${bodySize}px)`);
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
    record("Herald's Station: summons and the formal challenge with stance chips beside the seals, no repeated sender line, and the wager as its four stated terms at body size; read marks are saved; accepting confirms the wager again and shows the truthful Awaiting the board state");

    // Back unwinds dialog → inspection → overview → Home.
    await page.locator('[data-notice-kind="muster-summons"]').focus();
    await page.keyboard.press("Escape");
    await focusIs(page, () => document.activeElement?.getAttribute("data-landmark") === "heralds-station");
    assert.equal(await legacyMode(page), "bannerhold");
    assert.match(await page.locator(".legacy-next-strip [data-next-step]").innerText(), /Ready for the Muster[\s\S]*Accepted · awaiting the board/i);
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
    await page.locator("[data-manage-banner] summary").click();
    await page.getByRole("button", { name: "Dissolve banner", exact: true }).click();
    await page.locator("dialog.legacy-dialog[open]").waitFor();
    assert.match(await page.locator("dialog.legacy-dialog").innerText(), /Dissolve this banner\?/i);
    await focusIs(page, () => document.activeElement?.textContent?.includes("Keep the banner"));
    await page.keyboard.press("Enter");
    await page.locator("dialog.legacy-dialog[open]").waitFor({ state: "detached" });
    assert.ok(await storedSave(page), "keeping the banner leaves the save");
    await page.getByRole("button", { name: "Dissolve banner", exact: true }).click();
    await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Dissolve the banner/ }).click();
    await waitMode(page, "founding");
    assert.equal(await storedSave(page), null);
    record("Dissolve banner (inside Manage banner, the shared label on both platforms) asks for confirmation with the shared wording (defaulting to Keep), then dissolves the saved banner and restarts the founding ceremony");
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
    await page.locator("[data-manage-banner] summary").click();
    assert.match(await page.locator(".legacy-panel").innerText(), /Development previews are fixture data and cannot be dissolved or saved\./);
    assert.equal(await page.locator(".legacy-panel").getByRole("button", { name: "Dissolve banner", exact: true }).count(), 0, "a preview cannot be dissolved");
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
    // Accepting before a Pawn is named: the dialog says so and offers the Muster Grounds instead.
    await page.locator('.legacy-label[data-landmark="heralds-station"]').click();
    await page.locator("[data-accept]").click();
    const acceptDialog = page.locator("dialog.legacy-dialog[open]");
    await acceptDialog.waitFor();
    assert.equal(await acceptDialog.locator("[data-dialog-warning]").innerText(), "Nominate a member and an open file for the Muster.");
    const alternate = acceptDialog.locator("[data-dialog-alternate]");
    assert.equal(await alternate.innerText(), "Name your Pawn at the Muster Grounds");
    await page.keyboard.press("ArrowRight");
    await focusIs(page, () => document.activeElement?.hasAttribute("data-dialog-alternate"));
    await page.keyboard.press("Enter");
    await page.locator('[data-landmark-panel="muster-grounds"]').waitFor();
    assert.equal(await page.locator("dialog.legacy-dialog[open]").count(), 0, "the dialog closes on the way to the Muster Grounds");
    await focusIs(page, () => document.activeElement?.hasAttribute("data-nominate"));
    assert.equal(await storedSave(page), stored, "the stored banner is untouched");
    assert.deepEqual(await writes(page), []);
    record("?legacy=fresh starts a labelled guest founding that ignores and never writes the stored banner; accepting the challenge before a Pawn is named states the readiness gap and offers Name your Pawn at the Muster Grounds, which opens the Muster Grounds on Nominate");
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
    await pad(page, [0], () => page.locator(".legacy-beat").waitFor({ timeout: 10000 }));
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
      const shown = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
      const boxes = [...document.querySelectorAll(".legacy-panel, .legacy-card, .legacy-header, .legacy-footer, .legacy-aftermath, .legacy-next-strip, .legacy-label[data-visible='true']")].filter(shown).map(box);
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
      // The next-step strip must leave every landmark label clickable in the establishing framing.
      const strip = document.querySelector(".legacy-next-strip");
      const stripCovers = [];
      if (strip && shown(strip)) {
        const area = strip.getBoundingClientRect();
        for (const label of document.querySelectorAll(".legacy-label[data-visible='true']")) {
          if (!shown(label)) continue;
          const rect = label.getBoundingClientRect();
          if (rect.left < area.right && rect.right > area.left && rect.top < area.bottom && rect.bottom > area.top) stripCovers.push(label.getAttribute("data-landmark"));
        }
      }
      // Type floor: no Legacy text below 11 px (controller key glyphs and the stand-in's development caption excepted).
      let smallest = Infinity;
      let smallestText = "";
      const walker = document.createTreeWalker(document.querySelector(".legacy-screen"), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent.trim() || parent.closest(".controller-key, .legacy-key, .legacy-standin-caption, dialog:not([open])")) continue;
        if (!shown(parent)) continue;
        const size = parseFloat(getComputedStyle(parent).fontSize);
        if (size < smallest) { smallest = size; smallestText = node.textContent.trim().slice(0, 40); }
      }
      const actions = document.querySelector(".legacy-card-actions");
      const actionsBackground = actions && shown(actions) ? getComputedStyle(actions).backgroundColor : null;
      return { overflow: document.documentElement.scrollWidth > innerWidth, outside, clipped, badgeCovered, stripCovers, smallestFontPx: Number.isFinite(smallest) ? smallest : null, smallestText, actionsBackground, stage: { width: Math.round(stage.width), height: Math.round(stage.height) } };
    });
    assert.deepEqual(result.stripCovers, [], `${state} @${viewport.width}: the next-step strip covers a landmark label`);
    assert.ok(result.smallestFontPx === null || result.smallestFontPx >= 11, `${state} @${viewport.width}: text below the 11 px floor (${result.smallestFontPx}px: "${result.smallestText}")`);
    if (result.actionsBackground) assert.match(result.actionsBackground, /^rgb\(/, `${state} @${viewport.width}: the founding actions bar is opaque (${result.actionsBackground})`);
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
  if (section("layout")) record("Founding steps, overview (with the next-step strip clear of every landmark label) and all four panels fit the stage at 844×390, 1280×720 and 1920×1080 with no horizontal overflow or clipped text, no Legacy text below 11 px, and an opaque founding actions bar");

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


  // 11. A failed Legacy chunk stays inside the Legacy layer: Home and Play keep working, Back returns Home, re-entry and Retry re-import it.
  if (section("boundary")) {
    const legacyChunk = /\/LegacyScreen(?:-[\w-]+)?\.(?:js|tsx)$/;
    const blockingPage = async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      // This group provokes the failure on purpose, so its console output is checked here rather than failing the suite.
      const provoked = [];
      page.on("pageerror", (error) => provoked.push(`pageerror: ${error.message}`));
      page.on("console", (message) => { if (message.type() === "error") provoked.push(`console: ${message.text()}`); });
      const network = { blocked: true, blockedRequests: 0 };
      await page.route((url) => legacyChunk.test(url.pathname), (route) => {
        if (!network.blocked) return route.continue();
        network.blockedRequests++;
        return route.abort("failed");
      });
      await page.addInitScript(() => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: false, volume: 65 })));
      await page.goto(address({ legacy: "fresh" }));
      await waitForBootReady(page);
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      await page.locator(".home-grid").waitFor();
      // Each attempt to load the screen is numbered on the layer, so a check never reads the previous attempt's failure.
      const enter = async (attempt) => {
        await page.getByRole("button", { name: "My Legacy", exact: true }).click();
        await page.locator(`[data-legacy-layer="active"][data-legacy-attempt="${attempt}"] [data-legacy-failure]`).waitFor();
      };
      const unexpected = () => provoked.filter((message) => !/Failed to load resource|ERR_FAILED|Failed to fetch dynamically imported module|My Legacy could not open/i.test(message));
      return { context, page, network, enter, unexpected };
    };
    {
      const { context, page, network, enter, unexpected } = await blockingPage();
      await enter(0);
      const failure = page.locator("[data-legacy-failure]");
      assert.ok(network.blockedRequests >= 1, "the Legacy screen chunk request was blocked");
      assert.equal(await failure.getAttribute("data-legacy-failure"), "chunk");
      assert.match(await failure.innerText(), /My Legacy could not open[\s\S]*Home and Play are unaffected/i);
      await focusIs(page, () => document.activeElement?.hasAttribute("data-failure-retry"));
      await page.locator("[data-failure-home]").click();
      await page.locator(".home-grid").waitFor();
      await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
      await page.getByRole("tab", { name: "Play", exact: true }).click();
      await page.locator(".game-cards").waitFor();
      await page.getByRole("button", { name: "Classic", exact: true }).click();
      await page.locator("dialog.menu-dialog[open]").waitFor();
      assert.match(await page.locator("dialog.menu-dialog").innerText(), /Classic/);
      await page.keyboard.press("Escape");
      await page.locator("dialog.menu-dialog[open]").waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      await page.locator(".home-grid").waitFor();
      const attempts = network.blockedRequests;
      await enter(1);
      assert.ok(network.blockedRequests > attempts, "re-entering retried the download");
      await page.keyboard.press("Escape");
      await page.locator(".home-grid").waitFor();
      await focusIs(page, () => document.activeElement?.getAttribute("aria-label") === "My Legacy");
      network.blocked = false;
      await page.getByRole("button", { name: "My Legacy", exact: true }).click();
      await waitForLegacy(page);
      assert.equal(await legacyMode(page), "founding", "re-entering after recovery opens My Legacy");
      assert.deepEqual(unexpected(), [], "only the provoked chunk failure was reported");
      record("A blocked Legacy screen chunk shows the honest My Legacy could not open state inside the Legacy layer (Retry focused); Return to Home restores Home with focus, the Play tab and its Classic card still work, re-entering retries the download, Escape leaves the failure for Home, and re-entering after recovery opens the founding ceremony");
      await context.close();
    }
    {
      const { context, page, network, enter, unexpected } = await blockingPage();
      await enter(0);
      const failureHome = await page.locator("[data-failure-home]").innerText();
      network.blocked = false;
      await focusIs(page, () => document.activeElement?.hasAttribute("data-failure-retry"));
      await page.keyboard.press("Enter");
      await waitForLegacy(page);
      assert.equal(await legacyMode(page), "founding", "Retry re-imported the screen");
      assert.equal(await page.locator("[data-legacy-failure]").count(), 0);
      assert.equal(failureHome, await page.locator("[data-legacy-back]").getAttribute("aria-label"), "the failure state's Return to Home matches the shared label");
      await page.locator("[data-legacy-back]").click();
      await page.locator(".home-grid").waitFor();
      assert.deepEqual(unexpected(), [], "only the provoked chunk failure was reported");
      record("Retry (Enter on the focused button) re-imports the Legacy chunk under a fresh URL once the network recovers (browsers keep failed module fetches) and opens the founding ceremony; its Return to Home label matches the shared one");
      await context.close();
    }
  }

  // 12. Chess comes first (docs/legacy/BRIEF.md): launch timings with and without a saved banner,
  // actions from every Legacy screen back to Play, and the web chess app's entry graph.
  if (section("chessfirst")) {
    const development = await fetch(new URL("/@vite/client", origin)).then((response) => response.ok && /javascript/.test(response.headers.get("content-type") ?? "")).catch(() => false);
    const report = {
      measuredAt: new Date().toISOString(),
      target: origin,
      build: development ? "development (Vite dev server)" : "production build (vite preview)",
      launchToFirstMove: "Not measurable in this build: the menu's Play cards are previews and no chess board is connected to this menu, so there is no first move to time. The numbers below time launch to the menu accepting input on the Play tab, to the Classic card being selected by the first key press, and to the Classic card opening.",
      caveat: "Measured in headless Chromium with software WebGL on a shared, heavily loaded 4-CPU container. Absolute times overstate real hardware; the comparison with and without a saved banner and the Legacy requests and save reads during launch are the meaningful signals.",
      launch: [],
      actionsToPlay: [],
      webEntry: null,
    };
    // A real saved banner, founded through the UI (the founding group's, or a quick one when this group runs alone).
    let savedBanner = validSave || null;
    if (!savedBanner) {
      const { context, page } = await createPage();
      await openLegacyByKeyboard(page);
      await foundByPointer(page);
      savedBanner = await storedSave(page);
      await context.close();
    }
    assert.ok(savedBanner && JSON.parse(savedBanner).banner, "a saved banner is available for the launch comparison");
    for (const config of [{ model: "none", runs: 3 }, { model: null, runs: 1 }]) {
      for (const withSave of [false, true]) {
        for (let run = 0; run < config.runs; run++) {
          report.launch.push(await measureLaunch({ save: withSave ? savedBanner : null, model: config.model, run }));
        }
      }
    }
    for (const entry of report.launch) {
      assert.equal(entry.legacyRequests.length, 0, `launch (${entry.save ? "with" : "without"} a save) requested Legacy code: ${entry.legacyRequests.join(", ")}`);
      assert.equal(entry.saveReads, 0, "launch never reads the Legacy save");
    }
    const median = (values) => { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : null; };
    report.launchSummary = {};
    for (const model of ["none", "default"]) {
      for (const save of [false, true]) {
        const runs = report.launch.filter((entry) => entry.model === model && entry.save === save);
        if (!runs.length) continue;
        report.launchSummary[`${model === "none" ? "menuOnly" : "fullBoot"}${save ? "WithSave" : "WithoutSave"}`] = {
          runs: runs.length,
          menuReadyMs: median(runs.map((entry) => entry.menuReadyMs)),
          firstInputAcceptedMs: median(runs.map((entry) => entry.firstInputAcceptedMs)),
          classicOpenedMs: median(runs.map((entry) => entry.classicOpenedMs)),
        };
      }
    }
    record(`Launch timing recorded with and without a saved banner (${report.launch.length} launches, menu only and full boot): no Legacy code is requested and the Legacy save is never read before My Legacy opens; launch to first move is reported as not measurable while the Play cards are previews`);

    for (const start of ACTION_STARTS) {
      for (const method of ["pointer", "keys"]) report.actionsToPlay.push(await measureActionsToPlay(start, method));
    }
    for (const entry of report.actionsToPlay) assert.ok(entry.reachedPlay, `${entry.start} (${entry.method}) reaches Play`);
    const pointerWorst = Math.max(...report.actionsToPlay.filter((entry) => entry.method === "pointer").map((entry) => entry.toPlay));
    const keysWorst = Math.max(...report.actionsToPlay.filter((entry) => entry.method === "keys").map((entry) => entry.toPlay));
    assert.ok(pointerWorst <= 2, `pointer: at most two actions from any Legacy screen to Play (worst ${pointerWorst})`);
    report.actionsSummary = { pointerWorstToPlay: pointerWorst, keysWorstToPlay: keysWorst, controller: "Controller B is the same Back action as Escape (App maps both to back()); the gamepad group verifies B from the Bannerhold to Home." };
    record(`Actions back to Play counted from founding, the overview, each inspector, a dialog and the aftermath: pointer worst ${pointerWorst} (the footer Play route; a dialog is closed first), keyboard worst ${keysWorst} (Escape chain)`);

    report.webEntry = await webEntryGraph();
    assert.ok(report.webEntry.files > 10, "the web entry graph was walked");
    assert.deepEqual(report.webEntry.legacyFiles, [], "the web app's entry imports no Legacy code");
    record(`The web chess app's entry graph (web/src/main.tsx, ${report.webEntry.files} modules, static and dynamic imports) contains no Legacy module`);
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/chess-first.json`, JSON.stringify(report, null, 2) + "\n");
  }

  // 13. Performance protocol (opt-in): traces, long tasks, heap and renderer statistics.
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
