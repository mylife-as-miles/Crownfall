// Chronicles desktop verification (docs/chronicles/WORK_STATUS.md, tasks C1 and C2).
//
//   node scripts/verify-chronicles.mjs [milestone]       (default m1)
//   CROWNFALL_TEST_URL  the served build, normally a production build on vite preview
//   CHROMIUM_PATH       the Chromium binary (run with SwiftShader)
//
// Writes artifacts/chronicles/<milestone>/: verification.json (checks, metrics,
// layouts, the text inventory and the parity replay) and the captures (PNG hero
// frames, JPEG for the rest). Phases run one after another in one browser, and
// each records its own failure, so a slow host still yields every other piece of
// evidence; the run passes only when every phase passes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";
import { waitForBootReady } from "./boot-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";
import { attributeLongTasks, distSourceMaps, frameScriptTimes, percentiles, startTrace, stopTrace } from "./chronicles-trace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const milestone = (process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "m1");
assert.match(milestone, /^[a-z0-9][a-z0-9-]*$/, "the milestone names a folder such as m1");
const directory = `artifacts/chronicles/${milestone}`;
await mkdir(directory, { recursive: true });

// Shared modules are read from shared/chronicles itself, so this check cannot
// drift from what both platforms render. Each module is transpiled and its
// relative imports are rewritten to the transpiled dependencies.
const moduleUrls = new Map();
async function sharedUrl(path) {
  const file = resolve(path);
  if (moduleUrls.has(file)) return moduleUrls.get(file);
  const source = await readFile(file, "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const specifiers = [...outputText.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map((match) => match[1]);
  for (const specifier of new Set(specifiers)) {
    const target = resolve(dirname(file), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    outputText = outputText.split(`"${specifier}"`).join(`"${await sharedUrl(target)}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  moduleUrls.set(file, url);
  return url;
}
const shared = async (path) => import(await sharedUrl(resolve(here, path)));
const content = await shared("../../shared/chronicles/content.ts");
const registry = await shared("../../shared/chronicles/registry.ts");
const status = await shared("../../shared/chronicles/status.ts");
const fixtureModule = await shared("../../shared/chronicles/scene-state.fixture.ts");
const { CHRONICLES_TITLE, CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLES_MAP } = content;
const POLICY = status.CHRONICLES_CONTENT_POLICY;
const hotspots = content.getHotspotRecords();
const collections = registry.getChronicleCollections(POLICY);
const entriesOf = (collection) => registry.getCollectionEntries(collection, POLICY);
const FIXTURE = fixtureModule.CHRONICLES_SCENE_FIXTURE;
const titleOf = (collection) => CHRONICLE_EXHIBITS.find((exhibit) => exhibit.id === collection)?.title;

// Every on-screen string must be shared Chronicles text or existing menu chrome.
const chrome = ["Back", "Select", "A", "B", "Menu controls", "LB", "RB"];
const existingChrome = `${await readFile("src/Showcase.tsx", "utf8")}\n${await readFile("src/App.tsx", "utf8")}`;
for (const text of chrome) assert.ok(existingChrome.includes(`aria-label="${text}"`) || existingChrome.includes(`>${text}<`), `${text} is existing menu chrome`);
const approvedText = [
  CHRONICLES_TITLE, CHRONICLES_MAP.alt,
  ...CHRONICLE_EXHIBITS.map((exhibit) => exhibit.title),
  ...Object.values(CHRONICLE_LABELS).flatMap((label) => [label.name, label.meaning]),
  ...registry.getChronicleEntries(POLICY).flatMap((entry) => [entry.title, entry.body]),
  ...["working-proposal", "placeholder"].map((value) => status.getCanonMarker(value, POLICY)).filter(Boolean),
];
const allowed = (text) => chrome.includes(text) || approvedText.some((source) => source === text || source.includes(text));

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
const distDirectory = resolve(here, "../dist");
const resolveSourceMap = existsSync(distDirectory) ? distSourceMaps(distDirectory) : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], failures = [], layouts = [], captures = [], replay = [], texts = new Set(), errors = [];
const metrics = {
  host: {
    cpus: cpus().length,
    rendering: "SwiftShader (software WebGL) in headless Chromium: absolute timings are not GPU, desktop-hardware or headset evidence",
    loadAverageAtStart: loadavg().map((value) => Number(value.toFixed(1))),
    note: "Two other workflows share this host. Times are reported for comparison within this run only.",
  },
  stage: "The relief renderer (scene/AtlasScene) behind the stage adapter: the archive renderer (scene/ArchiveScene, task B4) has not landed, so archive-specific framings and stats are not measured here.",
};
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };

// Runs in each page before the menu: saved preferences, an optional WebGL
// outage, a standard controller whose taps last exactly one animation frame and
// whose holds last a count of frames (so the menu's polling and the stage's
// right-stick polling see each input however slowly frames arrive), long-task
// capture, and a per-canvas count of WebGL draw calls and triangles.
function instrument({ saved, webgl }) {
  localStorage.setItem("crownfall.main-game.preferences", saved);
  if (!webgl) {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest); };
  }
  let frame = 0;
  const tick = () => { frame++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const taps = new Map();
  let tapAxes = null;
  const held = { axes: [0, 0, 0, 0], buttons: {}, until: 0 };
  const claim = (key) => {
    const at = taps.get(key);
    if (at === undefined) return false;
    if (at === -1) { taps.set(key, frame); return true; }
    if (at === frame) return true;
    taps.delete(key);
    return false;
  };
  window.__pad = {
    reads: 0,
    tap(button) { taps.set(String(button), -1); },
    tapAxes(values) { tapAxes = { values, at: -1 }; },
    pending(input) { return Array.isArray(input) ? tapAxes?.at === -1 : taps.get(String(input)) === -1; },
    hold(axes, buttons, frames) { Object.assign(held, { axes, buttons, until: frame + frames }); },
    holding() { return frame < held.until; },
  };
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
    window.__pad.reads++;
    const now = performance.now(), holding = frame < held.until;
    const axes = holding ? [...held.axes] : [0, 0, 0, 0];
    if (tapAxes) {
      if (tapAxes.at === -1) tapAxes.at = frame;
      if (tapAxes.at === frame) [axes[0], axes[1]] = tapAxes.values;
      else tapAxes = null;
    }
    const buttons = Array.from({ length: 17 }, (_, index) => {
      const value = claim(String(index)) ? 1 : holding ? held.buttons[index] ?? 0 : 0;
      return { pressed: value > 0, touched: value > 0, value };
    });
    return [{ index: 0, id: "Mock standard controller", mapping: "standard", connected: true, timestamp: now, axes, buttons }];
  } });
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
  } catch { /* Long tasks are reported only where the browser supports them. */ }
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (...args) {
        const canvas = this.canvas;
        canvas.__draws = (canvas.__draws || 0) + 1;
        if (args[0] === this.TRIANGLES) canvas.__triangles = (canvas.__triangles || 0) + (name.startsWith("drawArrays") ? args[2] : name === "drawRangeElements" ? args[3] : args[1]) / 3 * (name.endsWith("Instanced") ? args[name === "drawArraysInstanced" ? 3 : 4] : 1);
        return original.apply(this, args);
      };
    }
  }
}

async function openPage({ viewport = { width: 1280, height: 720 }, quality = "medium", motion = false, model = false, webgl = true, expected } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: motion ? "no-preference" : "reduce" });
  // Generous: this suite shares a busy software-rendering host.
  page.setDefaultTimeout(180000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !expected?.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(instrument, { saved: JSON.stringify({ quality, motion, volume: 65 }), webgl });
  const url = new URL(target);
  if (!model) url.searchParams.set("model", "none");
  await page.goto(url.href);
  if (model) await page.locator(".creature-model--loaded").waitFor({ timeout: 400000 });
  await waitForBootReady(page, { timeout: 400000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Helpers bound to one page.
function on(page) {
  const screen = () => page.getByRole("region", { name: CHRONICLES_TITLE, exact: true });
  const helpers = {
    screen,
    // The scene state as the screen reports it, in the reducer's own terms.
    state: () => page.evaluate(() => {
      const node = document.querySelector(".menu-transition-live .chronicles-screen");
      return node ? { collection: node.dataset.collection, focus: node.dataset.focus, entryId: node.dataset.entry || null, load: node.dataset.load } : null;
    }),
    waitState: (partial) => page.waitForFunction((want) => {
      const node = document.querySelector(".menu-transition-live .chronicles-screen");
      if (!node) return false;
      const state = { collection: node.dataset.collection, focus: node.dataset.focus, entryId: node.dataset.entry || null, load: node.dataset.load };
      return Object.entries(want).every(([key, value]) => state[key] === value);
    }, partial),
    homeTile: async (name) => {
      await page.getByRole("region", { name: "Home options", exact: true }).waitFor();
      await page.waitForFunction((label) => document.querySelector(`.home-tile[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true" && document.activeElement?.getAttribute("aria-label") === label, name);
    },
    focusName: (name) => page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label || document.activeElement?.textContent === label, name),
    ready: (load = "ready") => page.waitForFunction((value) => document.querySelector(".menu-transition-live .chronicles-screen")?.dataset.load === value, load, { timeout: 400000 }),
    // The stage camera has finished moving, on the overview, a nation or a free framing.
    settled: (framing) => page.waitForFunction((name) => {
      const stage = document.querySelector(".menu-transition-live .chronicles-stage");
      return stage?.dataset.cameraSettled === "true" && (!name || stage.dataset.camera === name);
    }, framing),
    frames: (count = 2) => page.evaluate((total) => new Promise((done) => { let left = total; const step = () => (--left <= 0 ? done() : requestAnimationFrame(step)); requestAnimationFrame(step); }), count),
    moved: async (framing = "free") => { await helpers.frames(3); await helpers.settled(framing); },
    openRecord: () => page.evaluate(() => document.querySelector("#chronicles-record")?.dataset.record ?? null),
    recordShown: async (entry) => {
      await page.waitForFunction((id) => document.querySelector("#chronicles-record")?.dataset.record === id, entry.id);
      const shown = await page.locator("#chronicles-record").evaluate((node) => ({
        title: node.querySelector("h2").textContent, body: node.querySelector(".chronicles-body").textContent,
        label: node.querySelector(".chronicles-label-name")?.textContent ?? null, meaning: node.querySelector(".chronicles-label-meaning")?.textContent ?? null,
        marker: node.querySelector(".chronicles-canon-marker")?.textContent ?? null,
      }));
      assert.deepEqual(shown, {
        title: entry.title, body: entry.body,
        label: entry.label ? CHRONICLE_LABELS[entry.label].name : null, meaning: entry.label ? CHRONICLE_LABELS[entry.label].meaning : null,
        marker: status.getCanonMarker(entry.canonStatus, POLICY),
      });
    },
    // Where the stage placed each marker this frame, in page pixels.
    markers: () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".menu-transition-live .chronicles-hotspots .chronicles-marker")].map((node) => {
      const box = node.getBoundingClientRect();
      return [node.dataset.nation, { x: box.left, y: box.top }];
    }))),
    // Every text node, accessible name and alt text in the screen must be shared
    // Chronicles text or existing chrome; generated pseudo-element text is not allowed.
    auditText: async (label) => {
      const found = await screen().evaluate((root) => {
        const values = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) values.push(walker.currentNode.data.trim());
        for (const element of [root, ...root.querySelectorAll("*")]) {
          for (const name of ["aria-label", "alt", "title", "placeholder", "aria-description", "aria-valuetext", "aria-roledescription"]) if (element.hasAttribute(name)) values.push(element.getAttribute(name).trim());
        }
        const pseudo = [...root.querySelectorAll("*")].flatMap((element) => ["::before", "::after"].map((part) => getComputedStyle(element, part).content)).filter((value) => value && !["none", "normal", '""'].includes(value));
        return { values: values.filter(Boolean), pseudo };
      });
      const rejected = found.values.filter((value) => !allowed(value));
      assert.deepEqual(rejected, [], `${label}: text outside shared/chronicles and existing chrome`);
      assert.deepEqual(found.pseudo, [], `${label}: generated pseudo-element text`);
      found.values.forEach((value) => texts.add(value));
    },
    // Draw calls a canvas issues across a number of animation frames.
    drawsOver: (selector, frames = 40) => page.evaluate(({ query, total }) => new Promise((done) => {
      const count = () => document.querySelector(query)?.__draws ?? 0;
      const start = count();
      let left = total;
      const step = () => (--left <= 0 ? done(count() - start) : requestAnimationFrame(step));
      requestAnimationFrame(step);
    }), { query: selector, total: frames }),
    longTasks: (from, to) => page.evaluate(({ start, end }) => window.__longTasks.filter((task) => task.start >= start && task.start <= end).map((task) => Math.round(task.duration)), { start: from, end: to }),
    now: () => page.evaluate(() => performance.now()),
    pad: async (input, after) => {
      // One-frame taps start after the menu's 350 ms A/B repeat guard.
      await page.waitForTimeout(400);
      await page.evaluate((value) => (Array.isArray(value) ? window.__pad.tapAxes(value) : window.__pad.tap(value)), input);
      await page.waitForFunction((value) => !window.__pad.pending(value), input);
      await waitForMenuIdle(page);
      try { await after(); }
      catch (error) {
        console.error("Chronicles controller diagnostic", JSON.stringify(await page.evaluate(() => ({ focused: document.activeElement?.getAttribute("aria-label"), screen: document.querySelector(".chronicles-screen")?.dataset, record: document.querySelector("#chronicles-record")?.dataset.record }))));
        throw error;
      }
    },
    shot: async (name, { png = false } = {}) => {
      await helpers.frames(2);
      const viewport = page.viewportSize();
      const path = `${directory}/${name}-${viewport.width}x${viewport.height}.${png ? "png" : "jpg"}`;
      await page.screenshot(png ? { path } : { path, type: "jpeg", quality: 82 });
      captures.push({ path, viewport, state: await helpers.state() });
      console.log(`capture ${path}`);
    },
    enter: async () => {
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      await helpers.homeTile("My Legacy");
      await page.keyboard.press("ArrowRight");
      await helpers.homeTile("Chronicles");
      await page.keyboard.press("Enter");
      await screen().waitFor();
    },
  };
  return helpers;
}

// Four markers fix where the painting's plane lands on screen; a homography
// from them finds empty ground anywhere on the painted map, the centre included.
function homography(pairs) {
  const rows = [], values = [];
  for (const [[x, y], [u, v]] of pairs) {
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    [values[column], values[pivot]] = [values[pivot], values[column]];
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k < 8; k++) rows[row][k] -= factor * rows[column][k];
      values[row] -= factor * values[column];
    }
  }
  const h = values.map((value, index) => value / rows[index][index]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

const focusOf = (state) => (state.focus.kind === "nation" ? `nation:${state.focus.nation}` : state.focus.kind);
const asScreenState = (state) => ({ collection: state.collection, focus: focusOf(state), entryId: state.entryId, load: state.load });
const spread = (points) => Math.hypot(points.korvenia.x - points.solforiz.x, points.korvenia.y - points.solforiz.y);
// Arrow presses that carry the Atlas highlight from one nation to another, by the shared spatial rule.
function arrowPath(from, to) {
  const queue = [[from, []]], seen = new Set([from]);
  while (queue.length) {
    const [index, path] = queue.shift();
    if (index === to) return path;
    for (const direction of ["up", "down", "left", "right"]) {
      const next = content.getNextHotspot(index, direction);
      if (!seen.has(next)) { seen.add(next); queue.push([next, [...path, direction]]); }
    }
  }
  return null;
}
const arrowKey = (direction) => `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`;

async function phase(name, run) {
  console.log(`\n== ${name}`);
  const started = Date.now();
  try {
    await run();
    metrics.phases = { ...(metrics.phases || {}), [name]: { seconds: Math.round((Date.now() - started) / 1000), passed: true } };
  } catch (error) {
    failures.push({ phase: name, failure: String(error?.stack || error).slice(0, 4000) });
    metrics.phases = { ...(metrics.phases || {}), [name]: { seconds: Math.round((Date.now() - started) / 1000), passed: false } };
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Entry, loading, the overview, nation records by mouse and keyboard,
//    collections by every input, the controller, Back to Home, and captures.
await phase("entry, navigation and Back (medium, reduced motion)", async () => {
  const page = await openPage({ quality: "medium" });
  const ui = on(page);
  try {
    const { screen, state, waitState, homeTile, focusName, ready, settled, recordShown, markers, auditText } = ui;
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await homeTile("My Legacy");
    const tile = await page.locator('.home-tile[aria-label="Chronicles"] img').evaluate((image) => new URL(image.currentSrc).pathname);
    assert.equal(tile, CHRONICLES_MAP.src, "the Home tile and the Atlas share one map file");
    await page.keyboard.press("ArrowRight"); await homeTile("Chronicles");
    const openedAt = await ui.now();
    await page.keyboard.press("Enter");
    await screen().waitFor();
    // The loading state, captured before the stage reports ready.
    const loading = await page.evaluate(() => {
      const node = document.querySelector(".chronicles-loading");
      const screen = document.querySelector(".chronicles-screen");
      return { load: screen.dataset.load, role: node?.getAttribute("role"), label: node?.getAttribute("aria-label"), visible: !!node && getComputedStyle(node).visibility === "visible" && Number(getComputedStyle(node).opacity) > 0.5, busy: screen.getAttribute("aria-busy") };
    });
    assert.deepEqual(loading, { load: "loading", role: "progressbar", label: CHRONICLES_TITLE, visible: true, busy: "true" }, "a visual loading state named by the approved title shows from the click");
    await ui.shot("loading");
    await auditText("loading");
    await ready();
    const readyAt = await ui.now();
    await settled("overview");
    metrics.entry = { quality: "medium", readyMs: Math.round(readyAt - openedAt) };
    const shell = await page.evaluate(() => ({
      dialog: document.querySelector("dialog").open,
      home: document.querySelectorAll(".home-grid, .game-cards").length,
      nav: { visibility: getComputedStyle(document.querySelector(".main-nav")).visibility, inert: document.querySelector(".main-nav").inert },
      canvases: document.querySelectorAll(".chronicles-stage canvas").length,
      loader: getComputedStyle(document.querySelector(".chronicles-loading")).visibility,
    }));
    assert.deepEqual(shell, { dialog: false, home: 0, nav: { visibility: "hidden", inert: true }, canvases: 1, loader: "hidden" }, "a full-stage layer: no dialog, the main navigation hidden and inert, one stage canvas, the loader gone");
    assert.equal(await screen().getByRole("heading", { level: 1 }).textContent(), CHRONICLES_TITLE);
    assert.deepEqual(await screen().getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => tab.textContent)), collections.map(titleOf));
    assert.ok(!collections.includes("contested") && (await page.locator("#chronicles-tab-contested").count()) === 0, "the Contested Record is absent from navigation");
    assert.deepEqual(await state(), { collection: "atlas", focus: "overview", entryId: null, load: "ready" });
    await focusName(entriesOf("atlas")[0].title);
    assert.deepEqual(await page.locator(".chronicles-hotspot").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))), hotspots.map((record) => registry.getChronicleEntry(record.id, POLICY).title));
    await page.mouse.move(1, 1);
    await ui.shot("overview");
    await auditText("overview");
    record(`Home → Chronicles shows the loading state named by the approved title from the click, then the stage (ready in ${metrics.entry.readyMs} ms at medium on this host): a full-stage layer with the main navigation hidden and inert, the approved collection tabs only (no Contested Record) and one hidden button per nation`);

    // Mouse: each nation's marker, clicked where the stage drew it, opens its entry and focus.
    for (const item of hotspots) {
      await settled("overview");
      const place = (await markers())[item.nation];
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches(".chronicles-stage canvas"), place), true, `${item.nation}'s marker is drawn on the canvas`);
      await page.mouse.click(place.x, place.y);
      const entry = registry.getChronicleEntry(item.id, POLICY);
      await recordShown(entry);
      await waitState({ focus: `nation:${item.nation}`, entryId: item.id });
      await settled(item.nation);
      await auditText(`${item.id} record`);
      await page.mouse.move(1, 1);
      await ui.shot(`record-${item.nation}`);
      await page.keyboard.press("Escape");
      await waitState({ focus: `nation:${item.nation}`, entryId: null });
      if (item.nation === "korvenia") await ui.shot("focus-korvenia");
      await page.keyboard.press("Escape");
      await waitState({ focus: "overview", entryId: null });
    }
    record("Mouse: clicking each nation's marker on the stage opens exactly that nation's entry (title, body, label name and meaning) with its focus; Back closes the entry and keeps the nation, and Back again returns to the overview");

    await settled("overview");
    const rings = await markers();
    const project = homography(hotspots.map((item) => [[item.hotspot.x, item.hotspot.y], [rings[item.nation].x, rings[item.nation].y]]));
    for (const [x, y] of [[0.5, 0.5], [0.5, 0.2], [0.5, 0.8], [0.32, 0.4]]) {
      assert.equal(content.hotspotAt(x, y), null);
      const point = project(x, y);
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches(".chronicles-stage canvas"), point), true, `${x}, ${y} is bare relief`);
      await page.mouse.click(point.x, point.y);
      await ui.frames(3);
      assert.deepEqual(await state(), { collection: "atlas", focus: "overview", entryId: null, load: "ready" }, `${x}, ${y} changed the scene`);
    }
    record("Clicks on bare ground, the painted map's centre included, change nothing");

    // Restrained camera: a drag orbits within limits and the wheel zooms; neither opens an entry.
    const centre = project(0.5, 0.52);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 90, centre.y + 40, { steps: 6 });
    await page.mouse.up();
    await settled("free");
    const turned = await markers();
    assert.ok(Math.hypot(turned.korvenia.x - rings.korvenia.x, turned.korvenia.y - rings.korvenia.y) > 8, "dragging orbited the view");
    assert.equal(await ui.openRecord(), null);
    await page.mouse.wheel(0, -300);
    await ui.moved();
    assert.ok(spread(await markers()) > spread(turned) * 1.05, "the wheel zoomed in");
    record("Mouse: a drag orbits the view within its limits and the wheel zooms; neither opens an entry");

    // Hover follows the Showcase rule; a resting pointer never takes focus back.
    await page.keyboard.press("Escape"); await homeTile("Chronicles");
    await page.keyboard.press("Enter"); await ready(); await settled("overview");
    const now = await markers();
    await page.mouse.move(now.aethelgard.x - 40, now.aethelgard.y + 30); await page.mouse.move(now.aethelgard.x, now.aethelgard.y, { steps: 4 });
    await focusName(entriesOf("atlas")[2].title);
    assert.equal(await page.locator(".chronicles-stage canvas").getAttribute("data-over"), "marker");
    await ui.shot("hover-aethelgard");
    await page.keyboard.press("ArrowLeft"); await focusName(entriesOf("atlas")[0].title);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), entriesOf("atlas")[0].title, "a resting pointer does not take focus back");
    assert.deepEqual(await state(), { collection: "atlas", focus: "overview", entryId: null, load: "ready" }, "hover moves only the highlight");
    await page.mouse.move(1, 1);
    record("Pointer: moving onto a marker highlights and focuses its nation without changing the scene; a resting pointer never takes focus back from the keyboard");

    // Keyboard on the Atlas: the highlight over the overview, browsing while open, focus moves in focus.
    let current = 0;
    for (const direction of ["right", "down", "left", "up"]) {
      const next = content.getNextHotspot(current, direction);
      await page.keyboard.press(arrowKey(direction));
      await focusName(entriesOf("atlas")[next].title);
      assert.deepEqual(await state(), { collection: "atlas", focus: "overview", entryId: null, load: "ready" });
      current = next;
    }
    await page.keyboard.press("Enter");
    await recordShown(entriesOf("atlas")[current]);
    const browseTo = content.getNextHotspot(current, "right");
    await page.keyboard.press("ArrowRight");
    await waitState({ entryId: hotspots[browseTo].id, focus: `nation:${hotspots[browseTo].nation}` });
    await page.keyboard.press("Escape");
    await waitState({ entryId: null, focus: `nation:${hotspots[browseTo].nation}` });
    const focusTo = content.getNextHotspot(browseTo, "down");
    await page.keyboard.press("ArrowDown");
    await waitState({ entryId: null, focus: `nation:${hotspots[focusTo].nation}` });
    await settled(hotspots[focusTo].nation);
    await page.keyboard.press("Escape"); await waitState({ focus: "overview" });
    await page.keyboard.press("Home"); await focusName(entriesOf("atlas")[0].title);
    await page.keyboard.press("End"); await focusName(entriesOf("atlas")[hotspots.length - 1].title);
    // Shift turns and tilts, plus and minus zoom, and the focus stays on its nation.
    await settled();
    const keyed = await markers();
    await page.keyboard.down("Shift"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp"); await page.keyboard.up("Shift");
    await ui.moved();
    const orbited = await markers();
    assert.ok(Math.hypot(orbited.korvenia.x - keyed.korvenia.x, orbited.korvenia.y - keyed.korvenia.y) > 4, "Shift+arrows orbit");
    await page.keyboard.press("Equal"); await page.keyboard.press("Equal"); await ui.moved();
    assert.ok(spread(await markers()) > spread(orbited) * 1.1, "plus zooms in");
    await focusName(entriesOf("atlas")[hotspots.length - 1].title);
    const focusStyles = await page.evaluate(() => {
      const caption = document.activeElement.nextElementSibling?.querySelector(".chronicles-marker-caption");
      return { focusVisible: document.activeElement.matches(":focus-visible"), caption: !!caption && getComputedStyle(caption).opacity === "1" };
    });
    assert.deepEqual(focusStyles, { focusVisible: true, caption: true });
    await ui.shot("focus-keyboard");
    record("Keyboard on the Atlas: arrows move the highlight spatially over the overview, browse to the neighbour's entry while one is open and carry the focus while a nation is focused; Enter opens, Escape unwinds, Home/End reach the ends, Shift+arrows orbit and plus/minus zoom, with a visible focus caption");

    // Collections by every input: tabs (keyboard and mouse), Q/E, LB/RB, the shoulder glyphs.
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
    await focusName(titleOf("atlas"));
    await page.keyboard.press("ArrowRight"); await waitState({ collection: "interregnum" }); await focusName(titleOf("interregnum"));
    await page.keyboard.press("ArrowRight"); await waitState({ collection: "laws" });
    await page.keyboard.press("ArrowRight"); await waitState({ collection: "laws" });
    await page.keyboard.press("Home"); await waitState({ collection: "atlas" });
    await page.keyboard.press("End"); await waitState({ collection: "laws" });
    await page.keyboard.press("ArrowDown"); await focusName(entriesOf("laws")[0].title);
    await page.keyboard.press("q"); await waitState({ collection: "interregnum" });
    await page.keyboard.press("q"); await waitState({ collection: "atlas" });
    await page.keyboard.press("q"); await waitState({ collection: "laws" });
    await page.keyboard.press("e"); await waitState({ collection: "atlas" });
    await page.keyboard.press("e"); await waitState({ collection: "interregnum" });
    assert.equal(await page.locator(".main-nav [aria-selected='true']").getAttribute("aria-label"), "Home", "Q/E never left Chronicles for the menu tabs");
    await ui.pad(5, () => waitState({ collection: "laws" }));
    await ui.pad(4, () => waitState({ collection: "interregnum" }));
    await ui.pad(4, () => waitState({ collection: "atlas" }));
    await screen().getByRole("tab", { name: titleOf("laws"), exact: true }).click(); await waitState({ collection: "laws" });
    await page.locator(".chronicles-shoulder").nth(0).click(); await waitState({ collection: "interregnum" });
    await page.locator(".chronicles-shoulder").nth(1).click(); await waitState({ collection: "laws" });
    await screen().getByRole("tab", { name: titleOf("atlas"), exact: true }).click(); await waitState({ collection: "atlas" });
    record("Collections switch by keyboard on the tabs (arrows, Home/End), by Q/E, by mocked LB/RB, by clicking the tabs and by clicking the LB/RB glyphs; Q/E and LB/RB cycle inside Chronicles and never reach the menu tabs");

    // The Interregnum and the Laws: approved entries over their framing, by keyboard and mouse.
    await page.keyboard.press("e"); await waitState({ collection: "interregnum", entryId: null });
    await ui.shot("interregnum");
    const stops = entriesOf("interregnum");
    assert.deepEqual(await page.locator(".chronicles-item--interregnum").evaluateAll((nodes) => nodes.map((node) => node.dataset.record)), stops.map((entry) => entry.id));
    for (const [index, entry] of stops.entries()) {
      await page.locator(`.chronicles-item[data-record="${entry.id}"]`).click();
      await recordShown(entry);
      await waitState({ collection: "interregnum", entryId: entry.id });
      assert.equal(await page.locator(`.chronicles-item[data-record="${entry.id}"] .chronicles-stop-label`).textContent(), content.getChronicleShortTitle(content.getChronicleRecord(entry.id)));
      await auditText(`${entry.id} entry`);
      if (index === 2) { await page.mouse.move(1, 1); await ui.shot("interregnum-year-19"); }
    }
    await page.keyboard.press("ArrowLeft"); await waitState({ entryId: stops[2].id });
    await page.keyboard.press("Escape"); await waitState({ entryId: null, collection: "interregnum" });
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Enter"); await waitState({ entryId: stops[1].id });
    await page.keyboard.press("Home"); await waitState({ entryId: stops[0].id });
    await page.keyboard.press("End"); await waitState({ entryId: stops[stops.length - 1].id });
    await page.keyboard.press("Escape"); await waitState({ entryId: null });
    await page.keyboard.press("e"); await waitState({ collection: "laws", entryId: null });
    await ui.shot("laws");
    const articles = entriesOf("laws");
    for (const entry of articles) {
      await page.locator(`.chronicles-item[data-record="${entry.id}"]`).click();
      await recordShown(entry);
      await auditText(`${entry.id} entry`);
    }
    await page.mouse.move(1, 1);
    await ui.shot("laws-entry");
    await page.keyboard.press("ArrowUp"); await waitState({ entryId: articles[1].id });
    await page.keyboard.press("Escape"); await waitState({ entryId: null });
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await focusName(titleOf("laws"));
    await ui.shot("focus-tabs");
    assert.equal(entriesOf("atlas").length + stops.length + articles.length, registry.getChronicleEntries(POLICY).length);
    record("The Interregnum and the Laws show every approved entry verbatim with its label over their framing; mouse and keyboard open them, arrows browse while one is open, Home/End reach the ends and Back closes the entry");

    // The stage rests behind the collections it does not draw.
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("e"); await waitState({ collection: "atlas" });
    await settled();
    await page.keyboard.press("e"); await waitState({ collection: "interregnum" });
    await page.waitForFunction(() => document.querySelector(".chronicles-stage")?.dataset.stageResting === "true");
    await ui.frames(4);
    assert.equal(await ui.drawsOver(".menu-transition-live .chronicles-stage canvas"), 0, "the stage keeps drawing behind the Interregnum");
    record("Behind the Interregnum and the Laws the relief settles, then rests receded on its last frame and issues no draw calls; no filter is applied to the stage");

    // Controller: D-pad and left stick move, A selects, B goes back, the right stick orbits and the triggers zoom.
    await ui.pad(4, () => waitState({ collection: "atlas" }));
    await settled();
    await page.keyboard.press("Home");
    await focusName(entriesOf("atlas")[0].title);
    await ui.pad(15, () => focusName(entriesOf("atlas")[content.getNextHotspot(0, "right")].title));
    const padIndex = content.getNextHotspot(0, "right");
    await ui.pad(0, async () => { await recordShown(entriesOf("atlas")[padIndex]); await settled(hotspots[padIndex].nation); });
    await ui.pad(1, () => waitState({ entryId: null, focus: `nation:${hotspots[padIndex].nation}` }));
    await ui.pad(1, () => waitState({ focus: "overview" }));
    await ui.pad([0, 0.9], () => focusName(entriesOf("atlas")[content.getNextHotspot(padIndex, "down")].title));
    await ui.pad([-0.9, 0], () => focusName(entriesOf("atlas")[content.getNextHotspot(content.getNextHotspot(padIndex, "down"), "left")].title));
    await settled();
    const padStart = await markers();
    await page.evaluate(() => window.__pad.hold([0, 0, 0.85, -0.6], {}, 24));
    await page.waitForFunction(() => !window.__pad.holding()); await ui.moved();
    const padTurned = await markers();
    assert.ok(Math.hypot(padTurned.korvenia.x - padStart.korvenia.x, padTurned.korvenia.y - padStart.korvenia.y) > 4, "the right stick orbits");
    await page.evaluate(() => window.__pad.hold([0, 0, 0, 0], { 7: 1 }, 24));
    await page.waitForFunction(() => !window.__pad.holding()); await ui.moved();
    assert.ok(spread(await markers()) > spread(padTurned) * 1.1, "the right trigger zooms in");
    await ui.pad(5, () => waitState({ collection: "interregnum" }));
    await page.keyboard.press("Home"); await focusName(entriesOf("interregnum")[0].title);
    await ui.pad(13, async () => { /* down on the timeline does nothing */ await waitState({ collection: "interregnum", entryId: null }); });
    await ui.pad(15, () => focusName(entriesOf("interregnum")[1].title));
    await ui.pad(0, () => waitState({ entryId: entriesOf("interregnum")[1].id }));
    await ui.pad(1, () => waitState({ entryId: null }));
    record("Mocked standard controller: the D-pad and left stick move between nations and stops, A opens, B unwinds, the right stick orbits and the right trigger zooms the view, LB/RB cycle the collections");

    // Back unwinds through the reducer, then returns Home with the tile selected and focused.
    await ui.pad(4, () => waitState({ collection: "atlas" }));
    await page.keyboard.press("Enter"); await waitState({ entryId: hotspots[content.getNextHotspot(content.getNextHotspot(padIndex, "down"), "left")].id });
    await page.keyboard.press("Escape"); await waitState({ entryId: null });
    assert.notEqual((await state()).focus, "overview");
    await page.keyboard.press("Backspace"); await waitState({ focus: "overview" });
    await screen().getByRole("button", { name: "Back", exact: true }).click();
    await homeTile("Chronicles");
    assert.equal(await page.locator(".chronicles-screen").count(), 0);
    assert.equal(await page.locator(".main-nav [aria-selected='true']").getAttribute("aria-label"), "Home");
    record("Back (Escape, Backspace, B and the Back button) closes the entry, then the nation focus, then returns Home with the Chronicles tile selected and focused");
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// 2. The parity fixture, replayed through the screen's own inputs.
await phase("parity fixture replayed through the UI", async () => {
  const page = await openPage({ quality: "medium" });
  const ui = on(page);
  try {
    const { state, ready, settled, markers, waitState } = ui;
    await ui.enter();
    assert.deepEqual(await state(), asScreenState(FIXTURE.start), "the Home tile opens the fixture's start state");
    let overviewProjection = null;
    const used = { collection: 0, back: 0 };
    const clickMap = async (x, y) => {
      const hit = content.hotspotAt(x, y);
      if (hit) {
        const place = (await markers())[hit.nation];
        await page.mouse.click(place.x, place.y);
        return `click ${hit.nation}'s marker`;
      }
      const point = overviewProjection(x, y);
      await page.mouse.click(point.x, point.y);
      return `click bare ground at ${x}, ${y}`;
    };
    for (const [index, step] of FIXTURE.steps.entries()) {
      const before = await state();
      const event = step.event;
      let how = "no UI path: verified unchanged";
      if (event.type === "loaded") {
        if (before.load === "loading") { await ready(); await settled("overview"); how = "the stage reports ready"; }
        const rings = await markers();
        overviewProjection = homography(hotspots.map((item) => [[item.hotspot.x, item.hotspot.y], [rings[item.nation].x, rings[item.nation].y]]));
      } else if (event.type === "map") {
        if (before.collection === "atlas") how = await clickMap(event.x, event.y);
        else {
          await page.mouse.click(640, 400);
          how = "click on the stage behind the collection (the stage takes no pointer outside the Atlas)";
        }
      } else if (event.type === "entry") {
        const entry = registry.getChronicleEntry(event.id, POLICY);
        const visible = await page.locator(`#chronicles-panel-${before.collection} [data-record="${event.id}"], #chronicles-panel-${before.collection} .chronicles-hotspot[aria-label="${entry?.title}"]`).count();
        if (entry && entry.collection === before.collection && visible) {
          if (before.collection === "atlas") {
            const target = hotspots.findIndex((record) => record.id === event.id);
            const fromNation = before.focus.startsWith("nation:") ? before.focus.slice(7) : null;
            const from = fromNation ? hotspots.findIndex((record) => record.nation === fromNation) : target;
            if (before.entryId !== null) {
              // Browsing: arrows open the neighbour's entry while one is open.
              const path = arrowPath(from, target);
              for (const direction of path) await page.keyboard.press(arrowKey(direction));
              how = `arrows ${path.join(", ")} while an entry is open`;
            } else {
              await page.keyboard.press("Enter");
              how = "Enter on the focused nation";
            }
          } else {
            await page.locator(`.chronicles-item[data-record="${event.id}"]`).click();
            how = `click the ${event.id} item`;
          }
        } else {
          assert.equal(await page.locator(`#chronicles-panel-${before.collection}:not([hidden]) [data-record="${event.id}"]`).count(), 0, `${event.id} has no control in ${before.collection}`);
        }
      } else if (event.type === "focus") {
        if (before.collection === "atlas" && event.focus.kind === "nation" && before.focus.startsWith("nation:") && before.entryId === null) {
          const from = hotspots.findIndex((record) => record.nation === before.focus.slice(7));
          const to = hotspots.findIndex((record) => record.nation === event.focus.nation);
          const path = arrowPath(from, to);
          for (const direction of path) await page.keyboard.press(arrowKey(direction));
          how = `arrows ${path.join(", ")} while a nation is focused`;
        } else {
          await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowLeft");
          how = `arrows in ${before.collection} move only its highlight`;
        }
      } else if (event.type === "collection") {
        if (collections.includes(event.collection)) {
          const forward = collections.indexOf(event.collection) > collections.indexOf(before.collection);
          const kind = used.collection++ % 3;
          if (kind === 0) { await page.keyboard.press(forward ? "e" : "q"); how = forward ? "E" : "Q"; }
          else if (kind === 1) { await ui.pad(forward ? 5 : 4, async () => {}); how = forward ? "RB" : "LB"; }
          else { await ui.screen().getByRole("tab", { name: titleOf(event.collection), exact: true }).click(); how = "click the tab"; }
          // Cycling wraps, so a two-step jump is reached by repeating the cycle.
          for (let guard = 0; guard < 3 && (await state()).collection !== event.collection; guard++) await page.keyboard.press("e");
        } else {
          assert.equal(await page.locator(`#chronicles-tab-${event.collection}`).count(), 0, `${event.collection} has no tab`);
        }
      } else if (event.type === "back") {
        const inputs = ["Escape", "Backspace", "pad", "button"];
        const input = inputs[used.back++ % inputs.length];
        if (input === "pad") await ui.pad(1, async () => {});
        else if (input === "button") await ui.screen().getByRole("button", { name: "Back", exact: true }).click();
        else await page.keyboard.press(input);
        how = input === "pad" ? "B" : input === "button" ? "the Back button" : input;
      }
      await ui.frames(3);
      if (event.type === "back" && !step.canUnwind && step.unchanged && before.focus === "overview" && before.entryId === null) {
        await ui.homeTile("Chronicles");
        replay.push({ step: index + 1, note: step.note, event, how, result: "returned Home with the Chronicles tile selected and focused" });
        continue;
      }
      const expected = asScreenState(step.expect);
      await waitState(expected).catch(() => {});
      const after = await state();
      assert.deepEqual(after, expected, `step ${index + 1}: ${step.note} (${how})`);
      if (step.unchanged) assert.deepEqual(after, before, `step ${index + 1} changed the state`);
      replay.push({ step: index + 1, note: step.note, event, how, state: after });
    }
    record(`The shared parity fixture's ${FIXTURE.steps.length} steps replay through the screen's own inputs (marker and ground clicks, arrows, Enter, Q/E, LB/RB, tab clicks, Escape, Backspace, B and the Back button) and every resulting state matches; the last Back returns Home`);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Motion on: the loading animation runs on the compositor, the entrance
//    settles, the camera flies, the record eases in, and nothing runs forever.
await phase("motion: loading animation, entrance settle and flights", async () => {
  const page = await openPage({ quality: "medium", motion: true });
  const ui = on(page);
  try {
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await ui.homeTile("My Legacy");
    await page.keyboard.press("ArrowRight"); await ui.homeTile("Chronicles");
    await page.evaluate(() => {
      window.__camera = [];
      new MutationObserver(() => {
        const stage = document.querySelector(".chronicles-stage");
        if (stage) window.__camera.push({ at: performance.now(), settled: stage.dataset.cameraSettled, camera: stage.dataset.camera });
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-camera-settled"] });
    });
    await page.keyboard.press("Enter");
    await ui.screen().waitFor();
    const spinning = await page.evaluate(() => [...document.querySelectorAll(".chronicles-loading-ring")].map((ring) => ring.getAnimations().map((animation) => ({ name: animation.animationName, state: animation.playState, property: Object.keys(animation.effect.getKeyframes()[0] || {}).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)) }))));
    assert.ok(spinning.every((list) => list.some((animation) => animation.state === "running" && animation.property.every((name) => name === "transform"))), `the loading rings turn with transform-only CSS animations ${JSON.stringify(spinning)}`);
    await ui.shot("entrance-motion");
    await ui.ready();
    const readyAt = await ui.now();
    await ui.settled("overview");
    const settledAt = await ui.now();
    const camera = await page.evaluate(() => window.__camera);
    assert.ok(camera.some((entry) => entry.settled === "false"), "the overview settles in on first appearance");
    metrics.entrance = { quality: "medium", readyToSettledMs: Math.round(settledAt - readyAt), note: "The relief renderer's entrance is a time-based 2.2 s flight; frames here are GPU-bound (SwiftShader), so few frames fall inside it and this number is not its duration. The archive renderer's blueprint settle is at most 1.5 s (task B4)." };
    const stopped = await page.evaluate(() => [...document.querySelectorAll(".chronicles-loading-ring")].flatMap((ring) => ring.getAnimations()).filter((animation) => animation.playState === "running").length);
    assert.equal(stopped, 0, "the loading animations stop once the stage is ready");
    assert.ok(await ui.drawsOver(".menu-transition-live .chronicles-stage canvas") > 0, "the living details keep the relief drawing with motion on");
    const rings = await ui.markers();
    await page.evaluate(() => { window.__camera = []; });
    await page.mouse.click(rings.solforiz.x, rings.solforiz.y);
    await ui.recordShown(registry.getChronicleEntry("solforiz", POLICY));
    const easing = await page.evaluate(() => document.querySelector("#chronicles-record").getAnimations().map((animation) => ({ name: animation.animationName, duration: animation.effect.getTiming().duration, iterations: animation.effect.getTiming().iterations })));
    assert.deepEqual(easing, [{ name: "chronicles-record-enter", duration: 360, iterations: 1 }], "the record eases in with one finite CSS animation");
    await ui.settled("solforiz");
    // The flight is time-based (1.3 s). On this GPU-bound host frames can arrive
    // further apart than that, so the flight may complete within one frame: the
    // moving states are recorded, and the check is that the camera reached the nation.
    const flight = await page.evaluate(() => window.__camera);
    metrics.motionFlight = { framesObservedMoving: flight.filter((entry) => entry.settled === "false").length, transitions: flight };
    assert.equal(await page.locator(".menu-transition-live .chronicles-stage").getAttribute("data-camera"), "solforiz", "the camera reached the chosen nation");
    const idle = await page.evaluate(async () => {
      const inScreen = () => document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".chronicles-screen"));
      const infinite = inScreen().filter((animation) => animation.effect.getTiming().iterations === Infinity && animation.playState === "running").length;
      await Promise.race([Promise.all(inScreen().map((animation) => animation.finished.catch(() => null))), new Promise((done) => setTimeout(done, 20000))]);
      return { infinite, unfinished: inScreen().filter((animation) => animation.playState === "running").map((animation) => ({ name: animation.animationName, currentTime: animation.currentTime })) };
    });
    // A finite composited animation can wait for the compositor to start it on this
    // starved software renderer; only an animation that never ends would cost frames forever.
    metrics.motionIdle = idle;
    assert.equal(idle.infinite, 0, "Chronicles leaves no infinite CSS animation running once ready");
    record(`With motion on, the loading rings turn with transform-only CSS animations (compositor-driven) from the click until ready and then stop; the overview settles in (${metrics.entrance.readyToSettledMs} ms from ready on this host), the camera reaches the chosen nation (${metrics.motionFlight.framesObservedMoving} moving frame(s) observed on this host), the record eases in with one finite 360 ms animation, and no infinite animation is left running`);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Without WebGL: the flat painting with the same entries, and Back always works.
await phase("flat fallback (WebGL disabled)", async () => {
  const page = await openPage({ quality: "medium", webgl: false, expected: /WebGL/i });
  const ui = on(page);
  try {
    await ui.enter();
    await ui.ready("flat");
    const box = await page.locator(".chronicles-flat-image").evaluate((image) => {
      const rect = image.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, complete: image.complete, alt: image.alt };
    });
    assert.deepEqual([box.naturalWidth, box.naturalHeight, box.complete, box.alt], [CHRONICLES_MAP.width, CHRONICLES_MAP.height, true, CHRONICLES_MAP.alt]);
    assert.equal(await page.locator(".chronicles-stage canvas").count(), 0);
    for (const item of hotspots) {
      const ring = await page.locator(`.chronicles-hotspot[data-nation="${item.nation}"]`).boundingBox();
      assert.ok(Math.abs(ring.x + ring.width / 2 - (box.left + item.hotspot.x * box.width)) < 1 && Math.abs(ring.y + ring.height / 2 - (box.top + item.hotspot.y * box.height)) < 1, `${item.nation} ring sits on its painted place`);
      assert.ok(ring.width >= box.width * 0.06 - 0.5);
      await page.mouse.click(box.left + item.hotspot.x * box.width, box.top + item.hotspot.y * box.height);
      await ui.recordShown(registry.getChronicleEntry(item.id, POLICY));
      await ui.auditText(`flat ${item.id}`);
      if (item.nation === "korvenia") { await page.mouse.move(1, 1); await ui.shot("flat-record-korvenia"); }
    }
    await page.keyboard.press("Escape"); await ui.waitState({ entryId: null });
    await page.keyboard.press("Escape"); await ui.waitState({ focus: "overview" });
    await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
    await page.waitForTimeout(150);
    assert.equal(await ui.openRecord(), null, "the flat map's centre opens nothing");
    await page.mouse.move(1, 1);
    await ui.shot("flat-atlas");
    await page.keyboard.press("e"); await ui.waitState({ collection: "interregnum" });
    await page.locator("#chronicles-panel-interregnum .chronicles-item").nth(3).click(); await ui.recordShown(entriesOf("interregnum")[3]);
    await ui.shot("flat-interregnum");
    await page.keyboard.press("e"); await ui.waitState({ collection: "laws" });
    await page.locator("#chronicles-panel-laws .chronicles-item").nth(0).click(); await ui.recordShown(entriesOf("laws")[0]);
    await page.keyboard.press("Escape"); await ui.waitState({ entryId: null });
    await page.keyboard.press("Escape");
    await ui.homeTile("Chronicles");
    record("Without WebGL the flat painting offers the same entries: four rings on their painted places (each at least 6% of the image width), the same records by pointer and keyboard, the Interregnum and the Laws, and Back returns Home");
  } finally {
    await page.close();
  }
  // A context lost after ready falls back to the flat painting with the same entries.
  const lostPage = await openPage({ quality: "low", expected: /WebGL|context/i });
  const lost = on(lostPage);
  try {
    await lost.enter(); await lost.ready(); await lost.settled("overview");
    await lostPage.evaluate(() => {
      const element = document.querySelector(".menu-transition-live .chronicles-stage canvas");
      window.__lostCanvas = element;
      const gl = element.getContext("webgl2") || element.getContext("webgl");
      gl.getExtension("WEBGL_lose_context").loseContext();
    });
    await lost.ready("flat");
    assert.deepEqual(await lostPage.evaluate(() => ({ attached: window.__lostCanvas.isConnected, stage: document.querySelectorAll(".chronicles-stage canvas").length, flat: !!document.querySelector(".chronicles-flat-image") })), { attached: false, stage: 0, flat: true });
    const box = await lostPage.locator(".chronicles-flat-image").boundingBox();
    const item = hotspots[3];
    await lostPage.mouse.click(box.x + item.hotspot.x * box.width, box.y + item.hotspot.y * box.height);
    await lost.recordShown(registry.getChronicleEntry(item.id, POLICY));
    await lostPage.mouse.move(1, 1);
    await lost.shot("context-lost-flat-record");
    await lostPage.keyboard.press("Escape"); await lost.waitState({ entryId: null });
    await lostPage.keyboard.press("Escape"); await lost.waitState({ focus: "overview" });
    await lostPage.keyboard.press("Escape");
    await lost.homeTile("Chronicles");
    record("A WebGL context lost after the stage is ready falls back to the flat painting with the same entries; the stage canvas is removed and Back still returns Home");
  } finally {
    await lostPage.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Layouts at 1280×720, 1920×1080 and 844×390, with hero frames.
await phase("layouts and hero frames", async () => {
  const page = await openPage({ quality: "high", motion: true });
  const ui = on(page);
  try {
    const measure = (label) => page.evaluate((name) => {
      const root = document.querySelector(".chronicles-screen");
      const box = (node) => node.getBoundingClientRect();
      const visible = [...root.querySelectorAll("h1,h2,p,button:not(.chronicles-hotspot),.chronicles-stop-label,.chronicles-stop-era,.chronicles-article-title,.chronicles-marker.is-selected .chronicles-marker-caption,.chronicles-label-name,.chronicles-label-meaning")]
        .filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).opacity !== "0");
      const header = box(root.querySelector(".chronicles-header")), footer = box(root.querySelector(".chronicles-footer"));
      const record = root.querySelector("#chronicles-record");
      const lists = [...root.querySelectorAll(".chronicles-collection:not([hidden]) .chronicles-timeline, .chronicles-collection:not([hidden]) .chronicles-articles")].map(box);
      const blocks = [record && box(record), ...lists].filter(Boolean);
      const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      return {
        name,
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        clipped: visible.filter((node) => { const rect = box(node); return node.scrollWidth > node.clientWidth + 1 || rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1; }).map((node) => node.getAttribute("aria-label") || node.textContent.trim()),
        stacked: blocks.every((block) => block.top >= header.bottom - 0.5 && block.bottom <= footer.top + 0.5),
        overlapping: blocks.length > 1 && blocks.some((a, i) => blocks.some((b, j) => i < j && overlaps(a, b))),
        recordFits: !record || record.scrollHeight <= record.clientHeight + 1,
        backReachable: [...root.querySelectorAll("button")].some((node) => { const rect = box(node); return node.getAttribute("aria-label") === "Back" && rect.top >= 0 && rect.bottom <= innerHeight; }),
        tabsFit: [...root.querySelectorAll(".chronicles-tab")].every((node) => { const rect = box(node); return rect.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1; }),
      };
    }, label);
    const checkLayout = async (label) => {
      const layout = await measure(label);
      layouts.push({ viewport: page.viewportSize(), ...layout });
      assert.equal(layout.overflow, false, `${label}: page overflow`);
      assert.deepEqual(layout.clipped, [], `${label}: clipped text`);
      assert.equal(layout.stacked, true, `${label}: panels outside the header and footer`);
      assert.equal(layout.overlapping, false, `${label}: panels overlap`);
      assert.equal(layout.recordFits, true, `${label}: the record needs scrolling`);
      assert.equal(layout.backReachable, true, `${label}: Back unreachable`);
      assert.equal(layout.tabsFit, true, `${label}: tabs clipped`);
    };
    await ui.enter();
    await ui.ready(); await ui.settled("overview");
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.mouse.move(1, 1);
      await page.keyboard.press("Home");
      await ui.settled("overview");
      await page.waitForTimeout(600);
      const hero = viewport.width === 1920;
      const label = `${viewport.width}x${viewport.height}`;
      await checkLayout(`atlas ${label}`);
      if (hero) await ui.shot("hero-first-impression", { png: true });
      else if (viewport.width === 844) await ui.shot("overview");
      await page.keyboard.press("Enter");
      await ui.recordShown(entriesOf("atlas")[0]);
      await ui.settled("korvenia");
      await page.waitForTimeout(600);
      await checkLayout(`record ${label}`);
      if (hero) await ui.shot("hero-nation-korvenia", { png: true });
      else if (viewport.width === 844) await ui.shot("record-korvenia");
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await ui.waitState({ focus: "overview" });
      await page.keyboard.press("e"); await ui.waitState({ collection: "interregnum" });
      await page.keyboard.press("End"); await page.keyboard.press("Enter"); await ui.waitState({ entryId: entriesOf("interregnum")[3].id });
      await checkLayout(`interregnum ${label}`);
      if (viewport.width === 844) await ui.shot("interregnum-year-33");
      await page.keyboard.press("e"); await ui.waitState({ collection: "laws" });
      await page.keyboard.press("Home"); await page.keyboard.press("Enter"); await ui.waitState({ entryId: entriesOf("laws")[0].id });
      await checkLayout(`laws ${label}`);
      if (viewport.width === 844) await ui.shot("laws-entry");
      await page.keyboard.press("Escape"); await page.keyboard.press("e"); await ui.waitState({ collection: "atlas" });
    }
    record("At 1920×1080, 1280×720 and 844×390 the Atlas, an open record, the Interregnum and the Laws fit without page overflow, clipped text, scrolling or overlapping panels, between the header and the footer, with Back reachable; hero frames at 1920×1080 (PNG)");
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Performance: one render loop, long tasks after interactive with
//    attribution, script time per frame, round trips, the atmosphere rebuild.
const CHRONICLES_CODE = /^(src\/Chronicles\.tsx|src\/chronicles\/|shared\/chronicles\/|three$|react-dom$|react$|scheduler$)/;
function classify(task) {
  const groups = task.groupsMs, total = Object.values(groups).reduce((sum, value) => sum + value, 0) || 1;
  const files = Object.keys(task.scriptInclusiveByFilePercent);
  const nativeOnly = files.every((file) => file.startsWith("(native") || file === "(unknown)");
  if ((groups.gc || 0) / total >= 0.7) return { attributable: false, reason: "garbage collection of the page heap" };
  if ((groups.other || 0) / total >= 0.7 && Object.keys(task.eventsMs).some((name) => /concurrent marking|GC/i.test(name))) return { attributable: false, reason: "garbage collection scheduling" };
  if ((groups.script || 0) / total >= 0.5 && files.some((file) => file === "src/App.tsx") && !files.some((file) => CHRONICLES_CODE.test(file))) return { attributable: false, reason: "the menu's own script (App.tsx)" };
  if ((groups.script || 0) / total >= 0.5 && nativeOnly && task.samples > 0 && (task.scriptSelfByFilePercent?.["(native (program))"] ?? 0) >= 90) return { attributable: false, reason: "the page thread was not running script (descheduled or blocked on another process)" };
  return { attributable: true, reason: "work while Chronicles is open (counted against it)" };
}

await phase("performance (medium): loops, long tasks, frame script time, round trips, atmosphere rebuild", async () => {
  const page = await openPage({ quality: "medium", motion: true, model: true });
  const ui = on(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    const creature = ".creature-model canvas", motes = ".mote-field canvas", stage = ".menu-transition-live .chronicles-stage canvas";
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await waitForMenuIdle(page);
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const { usedSize } = await cdp.send("Runtime.getHeapUsage");
      return Number((usedSize / 1048576).toFixed(2));
    };
    const canvases = () => page.evaluate(() => ({ total: document.querySelectorAll("canvas").length, stage: document.querySelectorAll(".chronicles-stage canvas").length }));
    const homeLoops = { creature: await ui.drawsOver(creature), motes: await ui.drawsOver(motes) };
    assert.ok(homeLoops.creature > 0 && homeLoops.motes > 0, `the menu loops run on Home ${JSON.stringify(homeLoops)}`);
    const baseline = { heapMB: await heap(), canvases: await canvases() };

    // Interactive: open, settle, then trace a scripted interaction window with no screenshots.
    await page.keyboard.press("ArrowRight"); await ui.homeTile("Chronicles");
    await page.keyboard.press("Enter");
    await ui.ready();
    await ui.settled("overview");
    const openLoops = { creature: await ui.drawsOver(creature), motes: await page.locator(motes).count(), stage: await ui.drawsOver(stage) };
    assert.ok(openLoops.creature === 0 && openLoops.motes === 0 && openLoops.stage > 0, `only the stage draws while Chronicles is open ${JSON.stringify(openLoops)}`);
    const hiddenLayers = await page.evaluate(() => ["scene-wash", "creature-stage", "atmosphere", "film-grain"].map((name) => getComputedStyle(document.querySelector(`.${name}`)).visibility));
    assert.deepEqual(hiddenLayers, ["hidden", "hidden", "hidden", "hidden"], "the menu's stage layers stop compositing under the opaque layer");
    await startTrace(browser, page);
    const sync = await page.evaluate(() => { performance.mark("chronicles:sync"); return performance.getEntriesByName("chronicles:sync").pop().startTime; });
    const from = await ui.now();
    const rings = await ui.markers();
    await page.mouse.move(rings.aethelgard.x - 30, rings.aethelgard.y + 20); await page.mouse.move(rings.aethelgard.x, rings.aethelgard.y, { steps: 4 });
    await page.mouse.click(rings.aethelgard.x, rings.aethelgard.y); await ui.waitState({ entryId: "aethelgard" }); await ui.settled("aethelgard");
    await page.keyboard.press("ArrowDown"); await ui.waitState({ entryId: hotspots[content.getNextHotspot(2, "down")].id }); await ui.settled();
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await ui.waitState({ focus: "overview" }); await ui.settled("overview");
    await page.keyboard.press("e"); await ui.waitState({ collection: "interregnum" });
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter"); await ui.waitState({ entryId: entriesOf("interregnum")[1].id });
    await page.keyboard.press("e"); await ui.waitState({ collection: "laws" });
    await page.keyboard.press("Enter"); await ui.waitState({ entryId: entriesOf("laws")[0].id });
    await page.keyboard.press("e"); await ui.waitState({ collection: "atlas" }); await ui.settled();
    await page.waitForTimeout(1500);
    const to = await ui.now();
    const events = await stopTrace(browser);
    const attribution = await attributeLongTasks(events, { threshold: 50, from, to, sync: { name: "chronicles:sync", at: sync }, resolveSourceMap });
    const classified = attribution.longTasks.map((task) => ({ ...task, ...classify(task) }));
    const perFrame = frameScriptTimes(events, { from, to, sync: { name: "chronicles:sync", at: sync } });
    const observed = await ui.longTasks(from, to);
    metrics.afterInteractive = {
      quality: "medium", windowMs: Math.round(to - from), frames: perFrame.length,
      scriptPerFrameMs: percentiles(perFrame), longTasksObservedByPage: observed,
      longTasks: classified, chroniclesAttributableOver50ms: classified.filter((task) => task.attributable).map((task) => task.durationMs),
      sourceMaps: !!resolveSourceMap,
    };

    // Five round trips Home ↔ Chronicles, each waiting for ready, then exit.
    await page.keyboard.press("Escape"); await ui.homeTile("Chronicles");
    const warm = { heapMB: await heap(), canvases: await canvases() };
    for (let trip = 0; trip < 5; trip++) {
      await page.keyboard.press("Enter"); await ui.ready(); await ui.settled();
      await page.keyboard.press("Escape"); await ui.homeTile("Chronicles");
    }
    await page.waitForTimeout(500);
    const after = { heapMB: await heap(), canvases: await canvases() };
    metrics.roundTrips = { count: 5, baseline, afterFirstVisit: warm, afterFive: after, heapGrowthMB: Number((after.heapMB - baseline.heapMB).toFixed(2)), heapGrowthSinceFirstVisitMB: Number((after.heapMB - warm.heapMB).toFixed(2)), note: "The relief renderer keeps the last built relief mesh (typed arrays) for the session by design; the growth since the first visit isolates leaks." };
    assert.deepEqual(after.canvases, baseline.canvases, `canvases return to baseline ${JSON.stringify(metrics.roundTrips)}`);
    assert.ok(metrics.roundTrips.heapGrowthMB < 5, `heap growth after GC is under 5 MB ${JSON.stringify(metrics.roundTrips)}`);

    // Exit (D7): Chronicles holds the atmosphere at low, so leaving rebuilds its WebGL
    // motes, and the stage disposes everything, its WebGL context included.
    await page.keyboard.press("Enter"); await ui.ready(); await ui.settled();
    await page.evaluate(() => { window.__exitCanvas = document.querySelector(".menu-transition-live .chronicles-stage canvas"); });
    await startTrace(browser, page);
    const exitSync = await page.evaluate(() => { performance.mark("chronicles:sync-exit"); return performance.getEntriesByName("chronicles:sync-exit").pop().startTime; });
    const exitAt = await ui.now();
    await page.keyboard.press("Escape");
    await ui.homeTile("Chronicles");
    const homeAt = await ui.now();
    await page.waitForFunction(() => (document.querySelector(".mote-field canvas")?.__draws ?? 0) > 0);
    const motesAt = await ui.now();
    await page.waitForFunction(() => { const canvas = window.__exitCanvas; const gl = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl")); return !canvas?.isConnected && (!gl || gl.isContextLost()); }, undefined, { timeout: 30000 });
    const releasedAt = await ui.now();
    await page.waitForTimeout(500);
    const exitEvents = await stopTrace(browser);
    const exitTasks = await attributeLongTasks(exitEvents, { threshold: 50, from: exitAt, to: releasedAt + 500, sync: { name: "chronicles:sync-exit", at: exitSync }, resolveSourceMap });
    const exitLoops = { creature: await ui.drawsOver(creature), motes: await ui.drawsOver(motes) };
    assert.ok(exitLoops.creature > 0 && exitLoops.motes > 0, `the menu loops resume on exit ${JSON.stringify(exitLoops)}`);
    const exitOwner = (task) => {
      const files = task.scriptInclusiveByFilePercent;
      const share = (pattern) => Object.entries(files).filter(([file]) => pattern.test(file)).reduce((most, [, value]) => Math.max(most, value), 0);
      const owners = [["the stage's disposal (Chronicles)", share(/^src\/chronicles\/|^src\/Chronicles\.tsx$/)], ["the atmosphere rebuild (Atmosphere.tsx, D7)", share(/^src\/Atmosphere\.tsx$/)], ["the menu transition (MenuTransition.tsx)", share(/^src\/MenuTransition\.tsx$/)], ["the sorcerer (CreatureStage.tsx)", share(/^src\/CreatureStage\.tsx$/)]];
      const [name, value] = owners.sort((a, b) => b[1] - a[1])[0];
      if (value >= 25) return name;
      return (task.groupsMs.gc || 0) >= task.durationMs * 0.7 ? "garbage collection" : "other page work";
    };
    metrics.exit = {
      quality: "medium", backToHomeTileMs: Math.round(homeAt - exitAt), backToFirstMoteFrameMs: Math.round(motesAt - exitAt), backToStageContextReleasedMs: Math.round(releasedAt - exitAt),
      longTasks: exitTasks.longTasks.map((task) => ({ durationMs: task.durationMs, owner: exitOwner(task), groupsMs: task.groupsMs, scriptInclusiveByFilePercent: task.scriptInclusiveByFilePercent, topSelfFunctionsPercent: task.topSelfFunctionsPercent })),
      note: "D7 keeps App.tsx's overrides: the atmosphere drops to low while Chronicles is open and is rebuilt on exit (a new WebGL context), and the sorcerer pauses through reduced motion. The stage disposes everything on exit; the relief renderer ends its disposal by forcing a WebGL context loss, which waits for the GPU process. Both waits are synchronous GPU calls, measured here on SwiftShader with a saturated GPU process.",
    };
    metrics.exit.atmosphereRebuildMs = metrics.exit.longTasks.filter((task) => task.owner.startsWith("the atmosphere")).reduce((sum, task) => sum + task.durationMs, 0);
    metrics.exit.stageDisposalMs = metrics.exit.longTasks.filter((task) => task.owner.startsWith("the stage")).reduce((sum, task) => sum + task.durationMs, 0);
    metrics.loops = { home: homeLoops, chroniclesOpen: openLoops, afterExit: exitLoops, windowFrames: 40 };
    assert.deepEqual(metrics.afterInteractive.chroniclesAttributableOver50ms, [], `no Chronicles-attributable long task over 50 ms after interactive ${JSON.stringify(classified.map((task) => ({ ms: task.durationMs, reason: task.reason, groups: task.groupsMs })))}`);
    record(`One render loop at a time with the real sorcerer: on Home the sorcerer drew ${homeLoops.creature} and the motes ${homeLoops.motes} calls in 40 frames; with Chronicles open only the stage drew and the menu's stage layers stopped compositing; on exit Home showed ${metrics.exit.backToHomeTileMs} ms after Back, both menu loops resumed (first mote frame after ${metrics.exit.backToFirstMoteFrameMs} ms) and the stage's canvas and context were released (${metrics.exit.backToStageContextReleasedMs} ms); exit long tasks, attributed: ${metrics.exit.longTasks.map((task) => `${task.durationMs} ms ${task.owner}`).join("; ") || "none"}`);
    record(`After interactive at medium: ${classified.length} long task(s) over 50 ms in a ${metrics.afterInteractive.windowMs} ms traced window, none attributable to Chronicles (${classified.map((task) => `${task.durationMs} ms: ${task.reason}`).join("; ") || "none"}); script per frame p50/p95/p99 ${Object.values(metrics.afterInteractive.scriptPerFrameMs).join("/")} ms`);
    record(`Five Home ↔ Chronicles round trips: canvases back to ${after.canvases.total} (stage ${after.canvases.stage}); heap after GC ${baseline.heapMB} → ${after.heapMB} MB (${metrics.roundTrips.heapGrowthMB} MB; ${metrics.roundTrips.heapGrowthSinceFirstVisitMB} MB since the first visit)`);
  } finally {
    await cdp.detach().catch(() => {});
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Stage cost per preset at the overview and the heaviest framing.
await phase("stage cost per preset", async () => {
  const budgets = { low: { drawCalls: 120, triangles: 300000 }, medium: { drawCalls: 250, triangles: 1000000 }, high: { drawCalls: 400, triangles: 1500000 } };
  metrics.presets = {};
  for (const quality of ["low", "medium", "high"]) {
    const page = await openPage({ quality });
    const ui = on(page);
    try {
      await ui.enter(); await ui.ready(); await ui.settled("overview");
      const framings = [];
      const info = () => page.evaluate(() => { const host = document.querySelector(".menu-transition-live .chronicles-stage"); return { drawCalls: Number(host.dataset.drawCalls), triangles: Number(host.dataset.triangles) }; });
      const issued = () => page.evaluate(() => { const canvas = document.querySelector(".menu-transition-live .chronicles-stage canvas"); return { draws: canvas.__draws || 0, triangles: canvas.__triangles || 0 }; });
      // At the overview, a highlight change redraws exactly one frame each way under reduced motion: count what was actually issued.
      await ui.frames(3);
      const before = await issued();
      await page.keyboard.press("ArrowRight"); await ui.frames(3); await page.keyboard.press("ArrowLeft"); await ui.frames(3);
      const afterRedraws = await issued();
      framings.push({ framing: "overview", ...(await info()), issuedForTwoRedraws: { drawCalls: afterRedraws.draws - before.draws, triangles: Math.round(afterRedraws.triangles - before.triangles) } });
      for (const item of hotspots) {
        const place = (await ui.markers())[item.nation];
        await page.mouse.click(place.x, place.y); await ui.settled(item.nation);
        await ui.frames(3);
        framings.push({ framing: `nation:${item.nation} with its entry open`, ...(await info()) });
        await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await ui.settled("overview");
      }
      const heaviest = framings.reduce((a, b) => (b.triangles > a.triangles || (b.triangles === a.triangles && b.drawCalls > a.drawCalls) ? b : a));
      metrics.presets[quality] = { budget: budgets[quality], overview: framings[0], heaviest, framings };
      for (const framing of framings) {
        assert.ok(framing.drawCalls > 0 && framing.drawCalls <= budgets[quality].drawCalls && framing.triangles <= budgets[quality].triangles, `${quality} ${framing.framing}: ${JSON.stringify(framing)} within ${JSON.stringify(budgets[quality])}`);
      }
    } finally {
      await page.close();
    }
  }
  record(`Stage cost per preset (renderer.info) within budget at the overview and every nation framing: ${Object.entries(metrics.presets).map(([quality, value]) => `${quality} overview ${value.overview.drawCalls} calls/${value.overview.triangles} tris, heaviest ${value.heaviest.framing} ${value.heaviest.drawCalls}/${value.heaviest.triangles}`).join("; ")}`);
});

// ---------------------------------------------------------------------------
// 8. One 4× CPU-throttled run: entry and one collection switch.
await phase("4x CPU throttle: entry and one collection switch", async () => {
  const page = await openPage({ quality: "medium" });
  const ui = on(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await ui.homeTile("My Legacy");
    await page.keyboard.press("ArrowRight"); await ui.homeTile("Chronicles");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await startTrace(browser, page);
    const throttleSync = await page.evaluate(() => { performance.mark("chronicles:sync-throttle"); return performance.getEntriesByName("chronicles:sync-throttle").pop().startTime; });
    const openedAt = await ui.now();
    await page.keyboard.press("Enter");
    await ui.screen().waitFor();
    const shownAt = await ui.now();
    await ui.ready();
    const readyAt = await ui.now();
    await ui.settled("overview");
    const interactiveAt = await ui.now();
    await page.keyboard.press("e");
    await ui.waitState({ collection: "interregnum" });
    const switchedAt = await ui.now();
    await page.waitForTimeout(1500);
    const doneAt = await ui.now();
    const throttleEvents = await stopTrace(browser);
    const loadingTasks = await attributeLongTasks(throttleEvents, { threshold: 50, from: openedAt, to: readyAt, sync: { name: "chronicles:sync-throttle", at: throttleSync }, resolveSourceMap });
    const summary = (task) => ({ durationMs: task.durationMs, groupsMs: task.groupsMs, topSelfFunctionsPercent: Object.fromEntries(Object.entries(task.topSelfFunctionsPercent).slice(0, 5)), scriptInclusiveByFilePercent: Object.fromEntries(Object.entries(task.scriptInclusiveByFilePercent).slice(0, 8)) });
    metrics.throttled = {
      loadingLongTasksAttributed: loadingTasks.longTasks.filter((task) => task.durationMs >= 1000).map(summary),
      rate: 4, quality: "medium",
      clickToScreenMs: Math.round(shownAt - openedAt), clickToReadyMs: Math.round(readyAt - openedAt), readyToSettledMs: Math.round(interactiveAt - readyAt),
      collectionSwitchMs: Math.round(switchedAt - interactiveAt),
      longTasksDuringLoadingMs: await ui.longTasks(openedAt, readyAt),
      longTasksAfterInteractiveMs: await ui.longTasks(interactiveAt, doneAt),
      note: "Loading-phase tasks are the stage build behind the visible loading state; the 50 ms rule applies once the screen is interactive.",
    };
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.keyboard.press("Escape"); await ui.homeTile("Chronicles");
    record(`Under 4× CPU throttling the screen appeared ${metrics.throttled.clickToScreenMs} ms after the click, the stage was ready after ${metrics.throttled.clickToReadyMs} ms, and the collection switch took ${metrics.throttled.collectionSwitchMs} ms; long tasks after interactive: ${JSON.stringify(metrics.throttled.longTasksAfterInteractiveMs)}`);
  } finally {
    await cdp.detach().catch(() => {});
    await page.close();
  }
});

// ---------------------------------------------------------------------------
await phase("no page errors", async () => {
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors in any phase");
});

metrics.host.loadAverageAtEnd = loadavg().map((value) => Number(value.toFixed(1)));
const passed = failures.length === 0;
const manifest = {
  milestone, passed,
  scope: "Desktop Chronicles on a production build: entry and loading, navigation by mouse, keyboard and a mocked standard controller, Back, the parity fixture replayed through the UI, motion and reduced motion, the flat fallback (WebGL disabled), layouts at 1280×720, 1920×1080 and 844×390, CDP measurements (long tasks with attribution, script time per frame, heap and canvases over round trips, the atmosphere rebuild, stage cost per preset) and one 4× CPU-throttled run.",
  emulation: "Headless Chromium with SwiftShader software WebGL; controller input is a mocked standard Gamepad API device. Nothing here is GPU, desktop-hardware or headset evidence.",
  checks, failures, metrics, layouts, captures, replay, visibleText: [...texts].sort(), errors,
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(`${directory}/verification.json`, text);
await browser.close();
console.log(`\n${passed ? "PASS" : "FAIL"} ${checks.length} Chronicles verification groups, ${failures.length} failing phase(s); manifest ${pathToFileURL(resolve(directory, "verification.json")).pathname}`);
if (!passed) process.exitCode = 1;
