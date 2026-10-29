import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { chromium } from "playwright";
import ts from "typescript";
import { waitForBootReady } from "./boot-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";

// The archive text is read from the shared module itself, so this check cannot
// drift from what both platforms render. It has only type imports to erase.
async function sharedModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const content = await sharedModule("../../shared/chronicles/content.ts");
const { CHRONICLES_TITLE, CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLES_MAP, CHRONICLE_RECORDS } = content;
const hotspots = content.getHotspotRecords();
const stops = content.getChronicleRecords("interregnum");
const articles = content.getChronicleRecords("laws");
// Existing footer chrome, already in the menu before Chronicles: prove it.
const chrome = ["Back", "Select", "A", "B", "Menu controls"];
const existingChrome = `${await readFile("src/Showcase.tsx", "utf8")}\n${await readFile("src/App.tsx", "utf8")}`;
for (const text of chrome) assert.ok(existingChrome.includes(`aria-label="${text}"`) || existingChrome.includes(`>${text}<`), `${text} is existing menu chrome`);
const approved = [
  CHRONICLES_TITLE, CHRONICLES_MAP.alt,
  ...CHRONICLE_EXHIBITS.map((exhibit) => exhibit.title),
  ...Object.values(CHRONICLE_LABELS).flatMap((label) => [label.name, label.meaning]),
  ...CHRONICLE_RECORDS.flatMap((record) => [record.title, record.body]),
];
const allowed = (text) => chrome.includes(text) || approved.some((source) => source === text || source.includes(text));

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
const directory = "artifacts/chronicles";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], layouts = [], captures = [], texts = new Set(), errors = [];
const metrics = { host: { cpus: "4, software rendering (SwiftShader): timings here are not headset or GPU evidence", loadAverage: loadavg().map((value) => Number(value.toFixed(1))) } };
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;

// Runs in each page before the menu: saved preferences, an optional WebGL
// outage, a standard controller whose taps last exactly one animation frame
// and whose holds last a count of frames (so the menu's polling and the
// Atlas's right-stick polling see each input however slowly frames arrive on
// a shared software renderer), long-task capture, and a per-canvas count of
// WebGL draw calls.
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
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !expected?.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(instrument, { saved: JSON.stringify({ quality, motion, volume: 65 }), webgl });
  const url = new URL(target);
  if (!model) url.searchParams.set("model", "none");
  await page.goto(url.href);
  if (model) await page.locator(".creature-model--loaded").waitFor({ timeout: 300000 });
  await waitForBootReady(page, { timeout: 300000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Helpers bound to one page.
function on(page) {
  const screen = () => page.getByRole("region", { name: CHRONICLES_TITLE, exact: true });
  const helpers = {
    screen,
    activeTab: async (name) => assert.equal(await page.locator(`.main-nav [role="tab"][aria-label="${name}"]`).getAttribute("aria-selected"), "true"),
    focusName: (name) => page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label || document.activeElement?.textContent === label, name),
    focusRecord: (id) => page.waitForFunction((value) => document.activeElement?.dataset.record === value || document.activeElement?.dataset.nation === value, id),
    homeTile: async (name) => {
      await page.getByRole("region", { name: "Home options", exact: true }).waitFor();
      await page.waitForFunction((label) => document.querySelector(`.home-tile[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true" && document.activeElement?.getAttribute("aria-label") === label, name);
    },
    exhibitShown: async (id) => {
      await page.waitForFunction((value) => document.querySelector(".chronicles-screen")?.dataset.chroniclesExhibit === value, id);
      const tab = CHRONICLE_EXHIBITS.find((exhibit) => exhibit.id === id).title;
      assert.equal(await screen().getByRole("tab", { name: tab, exact: true }).getAttribute("aria-selected"), "true");
      assert.equal(await page.locator(`#chronicles-panel-${id}`).isVisible(), true);
    },
    atlasReady: (state = "ready") => page.waitForFunction((value) => document.querySelector(".chronicles-screen")?.dataset.atlas === value, state, { timeout: 300000 }),
    // The camera has finished moving, on the overview or on a nation.
    settled: (framing) => page.waitForFunction((name) => {
      const stage = document.querySelector(".chronicles-stage");
      return stage?.dataset.cameraSettled === "true" && (!name || stage.dataset.camera === name);
    }, framing),
    // After input that moves a camera already marked free: let the change reach a frame first.
    moved: async (framing = "free") => {
      await helpers.frames(3);
      await helpers.settled(framing);
    },
    frames: (count = 2) => page.evaluate((total) => new Promise((resolve) => { let left = total; const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); }), count),
    openRecord: () => page.evaluate(() => document.querySelector("#chronicles-record")?.dataset.record ?? null),
    recordShown: async (expected) => {
      await page.waitForFunction((id) => document.querySelector("#chronicles-record")?.dataset.record === id, expected.id);
      const shown = await page.locator("#chronicles-record").evaluate((node) => ({
        title: node.querySelector("h2").textContent, body: node.querySelector(".chronicles-body").textContent,
        label: node.querySelector(".chronicles-label-name").textContent, meaning: node.querySelector(".chronicles-label-meaning").textContent,
        labelVisible: node.querySelector(".chronicles-label").getBoundingClientRect().height > 0,
      }));
      assert.deepEqual(shown, { title: expected.title, body: expected.body, label: CHRONICLE_LABELS[expected.label].name, meaning: CHRONICLE_LABELS[expected.label].meaning, labelVisible: true });
    },
    // Where the scene placed each ring this frame, in page pixels.
    markers: () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".chronicles-hotspots .chronicles-marker")].map((node) => {
      const box = node.getBoundingClientRect();
      return [node.dataset.nation, { x: box.left, y: box.top }];
    }))),
    // Every text node, accessible name and alt text in the screen must be archive
    // copy or existing chrome; generated pseudo-element text is not allowed at all.
    auditText: async (state) => {
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
      assert.deepEqual(rejected, [], `${state}: text outside shared/chronicles and existing chrome`);
      assert.deepEqual(found.pseudo, [], `${state}: generated pseudo-element text`);
      found.values.forEach((value) => texts.add(value));
    },
    // Draw calls a canvas issues across a number of animation frames: a running
    // loop draws in every frame it gets, a paused one in none.
    drawsOver: (selector, frames = 40) => page.evaluate(({ query, total }) => new Promise((resolve) => {
      const count = () => document.querySelector(query)?.__draws ?? 0;
      const start = count();
      let left = total;
      const step = () => (--left <= 0 ? resolve(count() - start) : requestAnimationFrame(step));
      requestAnimationFrame(step);
    }), { query: selector, total: frames }),
    longTasks: (from, to) => page.evaluate(({ start, end }) => window.__longTasks.filter((task) => task.start >= start && task.start <= end).map((task) => Math.round(task.duration)), { start: from, end: to }),
    now: () => page.evaluate(() => performance.now()),
    pad: async (input, after) => {
      // One-frame taps must start after the menu's 350ms A/B repeat guard.
      await page.waitForTimeout(400);
      await page.evaluate((value) => (Array.isArray(value) ? window.__pad.tapAxes(value) : window.__pad.tap(value)), input);
      await page.waitForFunction((value) => !window.__pad.pending(value), input);
      await waitForMenuIdle(page);
      try { await after(); }
      catch (error) {
        console.error("Chronicles controller diagnostic", await page.evaluate(() => ({ focused: document.activeElement?.getAttribute("aria-label") || document.activeElement?.dataset.record, exhibit: document.querySelector(".chronicles-screen")?.dataset.chroniclesExhibit, zone: document.querySelector(".chronicles-screen")?.dataset.chroniclesZone, record: document.querySelector("#chronicles-record")?.dataset.record, tab: document.querySelector('.main-nav [aria-selected="true"]')?.getAttribute("aria-label") })));
        throw error;
      }
    },
  };
  return helpers;
}

// Four rings fix where the painting's plane lands on screen; a homography from
// them finds empty ground anywhere on the painted map, the centre included.
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

try {
  const page = await openPage({ quality: "medium" });
  const ui = on(page);
  const { screen, activeTab, focusName, focusRecord, homeTile, exhibitShown, atlasReady, settled, openRecord, recordShown, markers, auditText } = ui;
  const enterChronicles = async () => {
    await page.keyboard.press("Enter");
    await waitForMenuIdle(page);
    await screen().waitFor();
  };

  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await homeTile("My Legacy");
  const tile = await page.locator('.home-tile[aria-label="Chronicles"] img').evaluate((image) => new URL(image.currentSrc).pathname);
  assert.equal(tile, CHRONICLES_MAP.src, "the Home tile and the Atlas share one map file");
  await page.keyboard.press("ArrowRight"); await homeTile("Chronicles");
  const motesBefore = await page.locator(".mote-field canvas").count();
  const openedAt = await ui.now();
  await enterChronicles();
  await atlasReady();
  const readyAt = await ui.now();
  await settled("overview");
  await activeTab("Home");
  assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
  assert.equal(await page.locator(".home-grid, .game-cards, .showcase-screen").count(), 0);
  assert.equal(await screen().getByRole("heading", { level: 1 }).textContent(), CHRONICLES_TITLE);
  assert.deepEqual(await screen().getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => tab.textContent)), CHRONICLE_EXHIBITS.map((exhibit) => exhibit.title));
  await exhibitShown("atlas");
  await focusName(hotspots[0].title);
  const stage = await page.locator(".chronicles-stage").evaluate((node) => ({ role: node.getAttribute("role"), label: node.getAttribute("aria-label"), canvases: node.querySelectorAll("canvas").length, hidden: node.querySelector("canvas")?.getAttribute("aria-hidden"), drawCalls: Number(node.dataset.drawCalls), triangles: Number(node.dataset.triangles) }));
  assert.deepEqual({ role: stage.role, label: stage.label, canvases: stage.canvases, hidden: stage.hidden }, { role: "img", label: CHRONICLES_MAP.alt, canvases: 1, hidden: "true" });
  assert.deepEqual(await page.locator(".chronicles-hotspot").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))), hotspots.map((item) => item.title));
  assert.ok(motesBefore === 1 && (await page.locator(".atmosphere.atmosphere--low").count()) === 1 && (await page.locator(".mote-field canvas").count()) === 0, "the menu's motes stand down while Chronicles is open");
  await auditText("Atlas overview");
  record("Home → Chronicles opens a full screen under the Home tab with no dialog: the title, three exhibit tabs from CHRONICLE_EXHIBITS, the real-time relief (one canvas named by the map's alt text) and one hidden button per nation named from its record title");

  // Renderer cost at medium: three's renderer.info for the last frame, and a
  // count of the draw calls actually issued for one redrawn frame.
  const atlasCanvas = ".chronicles-stage canvas";
  // Held still, the relief redraws once per change: moving the focus is one frame.
  const beforeFrame = await page.evaluate((query) => { const canvas = document.querySelector(query); return { draws: canvas.__draws, triangles: canvas.__triangles }; }, atlasCanvas);
  await page.keyboard.press("ArrowRight"); await focusName(hotspots[2].title); await ui.frames(3);
  const afterFrame = await page.evaluate((query) => { const canvas = document.querySelector(query); return { draws: canvas.__draws, triangles: canvas.__triangles }; }, atlasCanvas);
  await page.keyboard.press("ArrowLeft"); await focusName(hotspots[0].title); await ui.frames(3);
  metrics.renderer = {
    quality: "medium",
    info: { drawCalls: stage.drawCalls, triangles: stage.triangles },
    issuedForOneFrame: { drawCalls: afterFrame.draws - beforeFrame.draws, triangles: Math.round(afterFrame.triangles - beforeFrame.triangles) },
    budget: { drawCalls: 200, triangles: 800000 },
  };
  assert.ok(stage.drawCalls > 0 && stage.drawCalls <= 200 && stage.triangles > 0 && stage.triangles <= 800000, JSON.stringify(metrics.renderer));
  assert.ok(metrics.renderer.issuedForOneFrame.drawCalls > 0 && metrics.renderer.issuedForOneFrame.drawCalls <= 200 && metrics.renderer.issuedForOneFrame.triangles <= 800000, JSON.stringify(metrics.renderer));
  metrics.longTasks = { open: { durations: await ui.longTasks(openedAt, readyAt + 500), milliseconds: Math.round(readyAt - openedAt) } };
  record(`Medium quality draws ${stage.drawCalls} calls and ${stage.triangles} triangles per frame by renderer.info (issued for one redrawn frame: ${metrics.renderer.issuedForOneFrame.drawCalls} calls, ${metrics.renderer.issuedForOneFrame.triangles} triangles), within 200 calls and 800k triangles`);

  // Each nation's ring, clicked where the scene drew it, is raycast to its record.
  for (const item of hotspots) {
    await settled("overview");
    const place = (await markers())[item.nation];
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches(".chronicles-stage canvas"), place), true, `${item.nation}'s ring is drawn on the canvas, not a DOM button`);
    await page.mouse.click(place.x, place.y);
    await recordShown(item);
    await settled(item.nation);
    assert.equal(await page.locator(`.chronicles-hotspot[data-nation="${item.nation}"]`).getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("#chronicles-record .chronicles-account").count(), content.getNationAccounts(item.nation).length);
    await auditText(`${item.id} record`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#chronicles-record"));
  }
  record("Clicking each nation's ring on the relief raycasts to exactly that nation's record (title, body, label name and meaning, no added accounts while none are approved) and the camera settles on its focus view; Escape closes it and the camera returns to the overview");

  await settled("overview");
  const rings = await markers();
  const project = homography(hotspots.map((item) => [[item.hotspot.x, item.hotspot.y], [rings[item.nation].x, rings[item.nation].y]]));
  const before = await page.evaluate(() => ({ focused: document.activeElement?.getAttribute("aria-label"), selected: document.querySelector('.chronicles-hotspot[aria-pressed="true"]')?.dataset.nation }));
  for (const [x, y] of [[0.5, 0.5], [0.5, 0.2], [0.5, 0.8], [0.32, 0.4]]) {
    assert.equal(content.hotspotAt(x, y), null, `${x}, ${y} is empty ground in the shared hit test`);
    const point = project(x, y);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches(".chronicles-stage canvas"), point), true, `${x}, ${y} is bare relief`);
    await page.mouse.click(point.x, point.y);
    await ui.frames(3);
    assert.equal(await openRecord(), null, `${x}, ${y} opened a record`);
    assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
    assert.deepEqual(await page.evaluate(() => ({ focused: document.activeElement?.getAttribute("aria-label"), selected: document.querySelector('.chronicles-hotspot[aria-pressed="true"]')?.dataset.nation })), before);
    assert.equal(await page.locator(".chronicles-stage").getAttribute("data-camera"), "overview", "a click does not move the camera");
  }
  await exhibitShown("atlas");
  record("Clicks on empty ground of the relief, the painted map's centre included, open nothing and keep the selection, the focus and the camera");

  // Restrained camera control: a drag turns and tilts, the wheel zooms about
  // the pointer, and neither opens a record.
  const centre = project(0.5, 0.52);
  const spread = (points) => Math.hypot(points.korvenia.x - points.solforiz.x, points.korvenia.y - points.solforiz.y);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 90, centre.y + 40, { steps: 6 });
  await page.mouse.up();
  await settled("free");
  const turned = await markers();
  assert.ok(Math.hypot(turned.korvenia.x - rings.korvenia.x, turned.korvenia.y - rings.korvenia.y) > 8, "dragging turned the relief");
  assert.equal(await openRecord(), null, "a drag is not a click");
  await page.mouse.wheel(0, -300);
  await ui.moved();
  assert.ok(spread(await markers()) > spread(turned) * 1.05, "the wheel zoomed in");
  record("Mouse: dragging the relief turns and tilts it within its limits and the wheel zooms about the pointer; neither opens a record");

  // Layout and picking at every supported size, with the camera reset by reopening.
  await page.keyboard.press("Escape"); await homeTile("Chronicles");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.keyboard.press("Enter"); await waitForMenuIdle(page); await atlasReady(); await settled("overview");
    for (const item of hotspots) {
      const place = (await markers())[item.nation];
      await page.mouse.click(place.x, place.y);
      await recordShown(item);
      await settled(item.nation);
      await page.keyboard.press("Escape");
      await settled("overview");
    }
    for (const exhibit of CHRONICLE_EXHIBITS) {
      await screen().getByRole("tab", { name: exhibit.title, exact: true }).click();
      await exhibitShown(exhibit.id);
      if (exhibit.id === "atlas") {
        const place = (await markers())[hotspots[0].nation];
        await page.mouse.click(place.x, place.y);
        await recordShown(hotspots[0]);
        await settled(hotspots[0].nation);
      }
      const layout = await page.evaluate(({ id }) => {
        const root = document.querySelector(".chronicles-screen");
        const box = (node) => node.getBoundingClientRect();
        const visible = [...root.querySelectorAll("h1,h2,h3,p,button:not(.chronicles-hotspot),.chronicles-stop-label,.chronicles-stop-era,.chronicles-marker.is-selected .chronicles-marker-caption,.chronicles-label-name,.chronicles-label-meaning")].filter((node) => node.getClientRects().length && getComputedStyle(node).opacity !== "0");
        const nav = box(document.querySelector(".main-nav")), header = box(root.querySelector(".chronicles-header")), footer = box(root.querySelector(".chronicles-footer"));
        const content = id === "atlas" ? root.querySelector("#chronicles-record") : root.querySelector(`#chronicles-panel-${id}`);
        const scrollers = [...root.querySelectorAll(`#chronicles-panel-${id} .chronicles-record, #chronicles-panel-${id} .chronicles-articles`)].map((node) => ({ name: node.className, fits: node.scrollHeight <= node.clientHeight + 1 }));
        const panel = box(content);
        const rings = id !== "atlas" ? [] : [...root.querySelectorAll(".chronicles-hotspots .chronicles-marker")].map((node) => ({ nation: node.dataset.nation, x: box(node).left, y: box(node).top }));
        return {
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          clipped: visible.filter((node) => { const rect = box(node); return node.scrollWidth > node.clientWidth + 1 || rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1; }).map((node) => node.getAttribute("aria-label") || node.textContent.trim()),
          stacked: header.top >= nav.bottom - 0.5 && panel.top >= header.bottom - 0.5 && footer.top >= panel.bottom - 0.5,
          backReachable: [...root.querySelectorAll("button")].some((node) => { const rect = box(node); return node.getAttribute("aria-label") === "Back" && rect.top >= 0 && rect.bottom <= innerHeight; }),
          ringsOnScreen: rings.every((ring) => ring.x >= 0 && ring.x <= innerWidth && ring.y >= 0 && ring.y <= innerHeight) || id !== "atlas",
          scrollers, panel: { top: Math.round(panel.top), bottom: Math.round(panel.bottom), left: Math.round(panel.left), right: Math.round(panel.right) },
        };
      }, { id: exhibit.id });
      assert.equal(layout.overflow, false, `${exhibit.id} ${viewport.width}: page overflow`);
      assert.deepEqual(layout.clipped, [], `${exhibit.id} ${viewport.width}: clipped text`);
      assert.equal(layout.stacked, true, `${exhibit.id} ${viewport.width}: nav, header, exhibit and footer overlap`);
      assert.equal(layout.backReachable, true);
      for (const scroller of layout.scrollers) assert.equal(scroller.fits, true, `${exhibit.id} ${viewport.width}: ${scroller.name} needs scrolling`);
      await auditText(`${exhibit.id} ${viewport.width}×${viewport.height}`);
      layouts.push({ viewport, exhibit: exhibit.id, ...layout });
      if (exhibit.id === "atlas") { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#chronicles-record")); }
    }
    await page.keyboard.press("Escape"); await homeTile("Chronicles");
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  record("At 1280×720, 1920×1080 and 844×390 every ring is raycast to its own record, and every exhibit and open record stacks below the nav and above the footer, fits without clipping or scrolling and keeps Back reachable");

  await page.keyboard.press("Enter"); await waitForMenuIdle(page); await atlasReady();
  for (const item of stops) {
    await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[1].title, exact: true }).click();
    await page.locator(`.chronicles-stop[data-record="${item.id}"]`).click();
    const shown = await page.locator("#chronicles-stop-detail").evaluate((node) => ({ id: node.querySelector("article").dataset.record, title: node.querySelector("h2").textContent, body: node.querySelector(".chronicles-body").textContent, label: node.querySelector(".chronicles-label-name").textContent, meaning: node.querySelector(".chronicles-label-meaning").textContent }));
    assert.deepEqual(shown, { id: item.id, title: item.title, body: item.body, label: CHRONICLE_LABELS[item.label].name, meaning: CHRONICLE_LABELS[item.label].meaning });
    assert.equal(await page.locator(`.chronicles-stop[data-record="${item.id}"] .chronicles-stop-label`).textContent(), content.getChronicleShortTitle(item));
    await auditText(`${item.id} stop`);
  }
  assert.deepEqual(await page.locator(".chronicles-stop").evaluateAll((nodes) => nodes.map((node) => node.dataset.record)), stops.map((item) => item.id));
  await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[2].title, exact: true }).click();
  const laws = await page.locator(".chronicles-article").evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.record, title: node.querySelector("h2").textContent, body: node.querySelector(".chronicles-body").textContent, label: node.querySelector(".chronicles-label-name").textContent, meaning: node.querySelector(".chronicles-label-meaning").textContent, visible: node.querySelector(".chronicles-label").getBoundingClientRect().height > 0 })));
  assert.deepEqual(laws, articles.map((item) => ({ id: item.id, title: item.title, body: item.body, label: CHRONICLE_LABELS[item.label].name, meaning: CHRONICLE_LABELS[item.label].meaning, visible: true })));
  assert.equal(hotspots.length + stops.length + articles.length, CHRONICLE_RECORDS.length);
  record("All eleven records render verbatim with their label name and meaning: four nation records, four timeline stops in order and three articles");

  // Exhibit switches keep every task short; the relief stops drawing while hidden.
  const switchedAt = await ui.now();
  await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[0].title, exact: true }).click();
  await exhibitShown("atlas"); await settled();
  await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[1].title, exact: true }).click();
  await exhibitShown("interregnum");
  await page.waitForTimeout(600);
  const switchedBy = await ui.now();
  metrics.longTasks.switch = { durations: await ui.longTasks(switchedAt, switchedBy), milliseconds: Math.round(switchedBy - switchedAt) };
  assert.equal(await ui.drawsOver(atlasCanvas), 0, "the relief keeps drawing behind another exhibit");
  record("Behind the Interregnum and the Laws the relief rests on its last frame and issues no draw calls");

  // Keyboard: arrows follow the shared helpers; up from the top of an exhibit
  // reaches the tabs, left/right switch them and down returns.
  await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[0].title, exact: true }).click();
  await settled();
  await page.keyboard.press("ArrowDown"); await focusRecord(hotspots[0].nation);
  let current = 0;
  for (const direction of ["right", "down", "left", "up", "down", "right", "up", "left", "left", "down", "down"]) {
    const next = content.getNextHotspot(current, direction);
    await page.keyboard.press(`Arrow${direction[0].toUpperCase()}${direction.slice(1)}`);
    await focusName(hotspots[next].title);
    assert.equal(await page.locator(`.chronicles-hotspot[data-nation="${hotspots[next].nation}"]`).getAttribute("aria-pressed"), "true");
    current = next;
  }
  await page.keyboard.press("Home"); await focusName(hotspots[0].title);
  await page.keyboard.press("End"); await focusName(hotspots.at(-1).title);
  await page.keyboard.press("Enter"); await recordShown(hotspots.at(-1)); await settled(hotspots.at(-1).nation);
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#chronicles-record"));
  await focusName(hotspots.at(-1).title); await settled("overview");
  await screen().waitFor();
  await page.keyboard.press("ArrowUp"); await focusName(hotspots[0].title);
  await page.keyboard.press("Enter"); await recordShown(hotspots[0]);
  await page.keyboard.press("ArrowUp"); await focusName(CHRONICLE_EXHIBITS[0].title);
  assert.equal(await openRecord(), hotspots[0].id, "reaching the tabs keeps the open record");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#chronicles-record"));
  await focusName(CHRONICLE_EXHIBITS[0].title);
  await page.keyboard.press("ArrowLeft"); await exhibitShown("atlas");
  await page.keyboard.press("ArrowRight"); await exhibitShown("interregnum"); await focusName(CHRONICLE_EXHIBITS[1].title);
  // The timeline kept the last stop chosen above while its tab was away.
  await page.keyboard.press("ArrowDown"); await focusRecord(stops[3].id);
  for (const [key, index] of [["ArrowLeft", 2], ["ArrowLeft", 1], ["ArrowLeft", 0], ["ArrowLeft", 0], ["ArrowRight", 1], ["ArrowDown", 1], ["Home", 0], ["End", 3], ["ArrowRight", 3], ["ArrowLeft", 2]]) {
    await page.keyboard.press(key); await focusRecord(stops[index].id);
    assert.equal(await page.locator("#chronicles-stop-detail article").getAttribute("data-record"), stops[index].id);
  }
  await page.keyboard.press("ArrowUp"); await focusName(CHRONICLE_EXHIBITS[1].title);
  await page.keyboard.press("ArrowRight"); await exhibitShown("laws");
  await page.keyboard.press("ArrowDown"); await focusRecord(articles[0].id);
  for (const [key, index] of [["ArrowDown", 1], ["ArrowDown", 2], ["ArrowDown", 2], ["ArrowUp", 1], ["ArrowRight", 2], ["ArrowLeft", 1], ["Home", 0]]) {
    await page.keyboard.press(key); await focusRecord(articles[index].id);
    assert.equal(await page.locator(`.chronicles-article[data-record="${articles[index].id}"]`).getAttribute("aria-current"), "true");
  }
  await page.keyboard.press("ArrowUp"); await focusName(CHRONICLE_EXHIBITS[2].title);
  await page.keyboard.press("ArrowRight"); await exhibitShown("laws");
  await page.keyboard.press("Home"); await exhibitShown("atlas");
  await page.keyboard.press("End"); await exhibitShown("laws");
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await exhibitShown("atlas");
  await page.keyboard.press("Enter"); await focusRecord(hotspots[0].nation);
  assert.equal(await openRecord(), null, "Enter on a tab enters the exhibit without opening a record");
  // Shift turns and tilts, plus and minus zoom; the focus stays on its nation.
  await settled();
  const keyed = await markers();
  await page.keyboard.down("Shift"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp"); await page.keyboard.up("Shift");
  await ui.moved();
  const orbited = await markers();
  assert.ok(Math.hypot(orbited.korvenia.x - keyed.korvenia.x, orbited.korvenia.y - keyed.korvenia.y) > 4, "Shift+arrows turn the relief");
  await focusName(hotspots[0].title);
  await page.keyboard.press("Equal"); await page.keyboard.press("Equal"); await ui.moved();
  assert.ok(spread(await markers()) > spread(orbited) * 1.1, "plus zooms in");
  const zoomed = await markers();
  await page.keyboard.press("Minus"); await ui.moved();
  assert.ok(spread(await markers()) < spread(zoomed), "minus zooms out");
  await focusName(hotspots[0].title);
  const focusStyles = await page.evaluate(() => {
    const visible = (node) => getComputedStyle(node).outlineStyle !== "none" || getComputedStyle(node).boxShadow !== "none";
    const caption = document.activeElement.nextElementSibling?.querySelector(".chronicles-marker-caption");
    return { hotspot: document.activeElement.matches(":focus-visible"), caption: !!caption && visible(caption) && getComputedStyle(caption).opacity === "1" };
  });
  assert.deepEqual(focusStyles, { hotspot: true, caption: true });
  await page.keyboard.press("Escape"); await homeTile("Chronicles"); await activeTab("Home");
  record("Keyboard: arrows move spatially between the rings, along the timeline and through the articles with the shared helpers; Home/End reach the ends; up reaches the exhibit tabs, left/right switch them and down or Enter returns; Shift+arrows turn and tilt and plus/minus zoom; the focused ring shows a visible focus caption; Enter opens and Escape closes a record, then Escape returns Home with the Chronicles tile selected and focused");

  await page.keyboard.press("Enter"); await screen().waitFor(); await focusName(hotspots[0].title);
  await page.keyboard.press("e"); await waitForMenuIdle(page); await activeTab("Play");
  await page.keyboard.press("q"); await waitForMenuIdle(page); await activeTab("Home"); await homeTile("Chronicles");
  await page.keyboard.press("Enter"); await screen().waitFor();
  await page.keyboard.press("q"); await waitForMenuIdle(page); await activeTab("Settings");
  await page.keyboard.press("Escape"); await waitForMenuIdle(page); await activeTab("Home"); await homeTile("Chronicles");
  await page.keyboard.press("Enter"); await screen().waitFor();
  await page.getByRole("tab", { name: "Showcase", exact: true }).click(); await waitForMenuIdle(page);
  await page.getByRole("region", { name: "Showcase options", exact: true }).waitFor();
  await page.getByRole("region", { name: "Showcase", exact: true }).getByRole("button", { name: "Back", exact: true }).click(); await waitForMenuIdle(page);
  await activeTab("Home"); await homeTile("Chronicles");
  record("Q/E keep their top-level tab behaviour from Chronicles, and Settings and Showcase both return to Home with the Chronicles tile selected");

  // Pointer, on the Showcase pattern.
  await page.keyboard.press("Enter"); await screen().waitFor(); await atlasReady(); await settled("overview");
  const ringsNow = await markers();
  const nearby = (nation, dx, dy) => ({ x: ringsNow[nation].x + dx, y: ringsNow[nation].y + dy });
  await page.mouse.move(nearby("aethelgard", -40, 30).x, nearby("aethelgard", -40, 30).y); await page.mouse.move(ringsNow.aethelgard.x, ringsNow.aethelgard.y, { steps: 4 });
  await focusName(hotspots[2].title);
  assert.equal(await page.locator(".chronicles-stage canvas").getAttribute("data-over"), "marker");
  await page.keyboard.press("ArrowLeft"); await focusName(hotspots[0].title);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), hotspots[0].title, "a resting pointer does not take focus back");
  await page.mouse.click(ringsNow.korvenia.x, ringsNow.korvenia.y); await recordShown(hotspots[0]); await settled("korvenia");
  // A nation's close view leaves the other rings off screen, so step back first.
  await page.mouse.move(1, 1);
  for (let step = 0; step < 4; step++) await page.keyboard.press("Minus");
  await ui.moved();
  const opened = await markers();
  const otherNation = await page.evaluate(({ points, open }) => Object.entries(points).find(([nation, point]) => nation !== open
    && point.x > 0 && point.y > 0 && point.x < innerWidth && point.y < innerHeight
    && document.elementFromPoint(point.x, point.y)?.matches(".chronicles-stage canvas"))?.[0] ?? null, { points: opened, open: hotspots[0].nation });
  const other = hotspots.find((item) => item.nation === otherNation);
  assert.ok(other, `another ring is in view beside the open record ${JSON.stringify(opened)}`);
  await page.mouse.move(opened[other.nation].x + 30, opened[other.nation].y - 30); await page.mouse.move(opened[other.nation].x, opened[other.nation].y, { steps: 4 });
  await focusName(other.title);
  assert.equal(await openRecord(), hotspots[0].id, "hovering another nation does not replace the open record");
  await page.locator(".chronicles-record").hover();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), other.title);
  await screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[2].title, exact: true }).hover();
  await page.waitForTimeout(150);
  await exhibitShown("atlas");
  await screen().getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#chronicles-record"));
  await screen().getByRole("button", { name: "Back", exact: true }).click();
  await homeTile("Chronicles");
  record("Pointer follows the Showcase pattern: moving onto a ring selects and focuses its nation, a resting pointer never takes focus back from the keyboard, hovering never replaces an open record or switches an exhibit, and the Back button closes the record before returning Home");

  await page.mouse.move(1, 1);
  const { pad } = ui;
  await pad(0, () => focusName(hotspots[0].title));
  await screen().waitFor(); await atlasReady(); await settled("overview");
  await pad(15, () => focusName(hotspots[2].title));
  await pad(0, async () => { await recordShown(hotspots[2]); await settled("aethelgard"); });
  await pad(1, async () => { await page.waitForFunction(() => !document.querySelector("#chronicles-record")); await focusName(hotspots[2].title); });
  await pad([0, 0.9], () => focusName(hotspots[1].title));
  await pad([-0.9, 0], () => focusName(hotspots[3].title));
  await pad(12, () => focusName(hotspots[0].title));
  await settled("overview");
  // The right stick turns the relief and the right trigger zooms in.
  const padStart = await markers();
  await page.evaluate(() => window.__pad.hold([0, 0, 0.85, -0.6], {}, 24));
  await page.waitForFunction(() => !window.__pad.holding()); await ui.moved();
  const padTurned = await markers();
  assert.ok(Math.hypot(padTurned.korvenia.x - padStart.korvenia.x, padTurned.korvenia.y - padStart.korvenia.y) > 4, "the right stick turns the relief");
  await page.evaluate(() => window.__pad.hold([0, 0, 0, 0], { 7: 1 }, 24));
  await page.waitForFunction(() => !window.__pad.holding()); await ui.moved();
  assert.ok(spread(await markers()) > spread(padTurned) * 1.1, "the right trigger zooms in");
  await focusName(hotspots[0].title);
  await pad(12, () => focusName(CHRONICLE_EXHIBITS[0].title));
  await pad(15, () => exhibitShown("interregnum"));
  await pad(13, () => focusRecord(stops[0].id));
  await pad(15, () => focusRecord(stops[1].id));
  await pad(0, () => focusRecord(stops[1].id));
  await pad(12, () => focusName(CHRONICLE_EXHIBITS[1].title));
  await pad(15, () => exhibitShown("laws"));
  await pad(0, () => focusRecord(articles[0].id));
  await pad(13, () => focusRecord(articles[1].id));
  await pad(5, async () => { await activeTab("Play"); });
  await pad(4, async () => { await activeTab("Home"); await homeTile("Chronicles"); });
  await pad(0, () => screen().waitFor());
  await atlasReady();
  await pad(0, () => recordShown(hotspots[0]));
  await pad(1, () => page.waitForFunction(() => !document.querySelector("#chronicles-record")));
  await pad(1, async () => { await homeTile("Chronicles"); await activeTab("Home"); });
  record("Mocked standard controller: A enters Chronicles and opens records, the D-pad and left stick move between rings, tabs, timeline stops and articles, the right stick turns and the right trigger zooms the relief, B closes the record and then returns Home, and RB/LB keep their top-level tab behaviour");

  for (const name of ["My Legacy", "Herald Board"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.match(await page.locator("dialog").innerText(), /unavailable in this build/);
    assert.equal(await page.locator(".chronicles-screen").count(), 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await homeTile(name);
  }
  await pad(0, () => page.getByRole("heading", { name: "Herald Board", exact: true }).waitFor());
  await pad(1, async () => { await page.waitForFunction(() => !document.querySelector("dialog").open); await homeTile("Herald Board"); });
  await page.keyboard.press("ArrowLeft"); await homeTile("My Legacy");
  await page.keyboard.press("Enter"); await page.getByRole("heading", { name: "My Legacy", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("dialog").open); await homeTile("My Legacy");
  record("My Legacy and Herald Board still open their unavailable panels by pointer, keyboard and controller");

  // Held still: no transition runs and the relief draws only when something changes.
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowUp"); await homeTile("Chronicles");
  await page.keyboard.press("Enter"); await screen().waitFor(); await atlasReady(); await settled("overview");
  await page.keyboard.press("Enter"); await recordShown(hotspots[0]); await settled("korvenia");
  assert.equal(await page.locator(".chronicles-screen--still").count(), 1);
  assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".chronicles-screen")).length), 0);
  await ui.frames(4);
  assert.equal(await ui.drawsOver(atlasCanvas), 0, "a still relief keeps redrawing");
  record("Reduced motion (saved or OS) removes every Chronicles transition, jumps the camera instead of flying it, freezes the living details and redraws the relief only when something changes");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await homeTile("Chronicles");
  await page.close();

  // Motion on: the camera flies, the details live, the record eases in, and
  // no CSS animation runs forever.
  const motionPage = await openPage({ quality: "medium", motion: true });
  const live = on(motionPage);
  await motionPage.getByRole("tab", { name: "Home", exact: true }).click();
  await motionPage.getByRole("button", { name: "Chronicles", exact: true }).click();
  await live.atlasReady();
  assert.equal(await motionPage.locator(".chronicles-stage").getAttribute("data-camera-settled"), "false", "the overview settles in on first appearance");
  await live.settled("overview");
  assert.ok(await live.drawsOver(".chronicles-stage canvas") > 0, "the living details keep the relief drawing");
  const liveRings = await live.markers();
  // Record what starts, so a short animation or flight cannot finish unseen on a slow host.
  await motionPage.evaluate(() => {
    window.__started = [];
    document.addEventListener("animationstart", (event) => { if (event.target.closest?.("#chronicles-record")) window.__started.push(event.animationName); });
    window.__camera = [];
    new MutationObserver(() => window.__camera.push(document.querySelector(".chronicles-stage").dataset.cameraSettled)).observe(document.querySelector(".chronicles-stage"), { attributes: true, attributeFilter: ["data-camera-settled"] });
  });
  await motionPage.mouse.click(liveRings.solforiz.x, liveRings.solforiz.y);
  await live.recordShown(hotspots[1]);
  await live.settled("solforiz");
  const started = await motionPage.evaluate(() => ({ animations: window.__started, camera: window.__camera }));
  assert.ok(started.animations.includes("chronicles-record-enter"), JSON.stringify(started));
  assert.ok(started.camera.includes("false") && started.camera.at(-1) === "true", `the camera flies to the nation ${JSON.stringify(started)}`);
  // Wall time is unreliable on a starved software renderer, so wait for the
  // animations themselves: all must be finite and all must settle.
  const idle = await motionPage.evaluate(async () => {
    const inScreen = () => document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".chronicles-screen"));
    const infinite = inScreen().filter((animation) => animation.effect.getTiming().iterations === Infinity).length;
    await Promise.race([Promise.all(inScreen().map((animation) => animation.finished.catch(() => null))), new Promise((resolve) => setTimeout(resolve, 20000))]);
    return { infinite, running: inScreen().filter((animation) => animation.playState === "running").length };
  });
  assert.deepEqual(idle, { infinite: 0, running: 0 }, "Chronicles leaves no running CSS animation while idle");
  await motionPage.close();
  record("With motion on, the overview settles in, the camera flies to the chosen nation, the record eases in, the living details keep the relief drawing, and no CSS animation runs forever");

  // The real sorcerer: its loop and the motes pause while Chronicles is open,
  // the relief draws only while shown and visible, and exit disposes it.
  const stagePage = await openPage({ quality: "high", motion: true, model: true });
  const host = on(stagePage);
  const creature = ".creature-model canvas", motes = ".mote-field canvas";
  await stagePage.getByRole("tab", { name: "Home", exact: true }).click();
  await waitForMenuIdle(stagePage);
  const homeLoops = { creature: await host.drawsOver(creature), motes: await host.drawsOver(motes) };
  assert.ok(homeLoops.creature > 0 && homeLoops.motes > 0, `the menu loops run on Home ${JSON.stringify(homeLoops)}`);
  await stagePage.keyboard.press("ArrowRight"); await host.homeTile("Chronicles");
  const stageOpened = await host.now();
  await stagePage.keyboard.press("Enter"); await waitForMenuIdle(stagePage);
  await host.atlasReady();
  const stageReady = await host.now();
  await host.settled("overview");
  const openLoops = { creature: await host.drawsOver(creature), motes: await stagePage.locator(motes).count(), atlas: await host.drawsOver(atlasCanvas) };
  assert.ok(openLoops.creature === 0 && openLoops.motes === 0 && openLoops.atlas > 0, `only the relief draws while Chronicles is open ${JSON.stringify(openLoops)}`);
  await host.screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[1].title, exact: true }).click();
  await host.exhibitShown("interregnum");
  await host.frames(3);
  const hiddenExhibit = await host.drawsOver(atlasCanvas);
  await host.screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[0].title, exact: true }).click();
  await host.settled();
  await stagePage.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenTab = await host.drawsOver(atlasCanvas);
  await stagePage.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const shownAgain = await host.drawsOver(atlasCanvas);
  assert.ok(hiddenExhibit === 0 && hiddenTab === 0 && shownAgain > 0, `the relief draws only while shown and visible ${JSON.stringify({ hiddenExhibit, hiddenTab, shownAgain })}`);
  await stagePage.evaluate((query) => { window.__atlasCanvas = document.querySelector(query); }, atlasCanvas);
  await stagePage.keyboard.press("Escape"); await host.homeTile("Chronicles");
  await stagePage.waitForTimeout(400);
  const exitLoops = { creature: await host.drawsOver(creature), motes: await host.drawsOver(motes) };
  const disposed = await stagePage.evaluate(() => ({ attached: window.__atlasCanvas.isConnected, lost: (window.__atlasCanvas.getContext("webgl2") || window.__atlasCanvas.getContext("webgl"))?.isContextLost() ?? true, canvases: document.querySelectorAll(".chronicles-stage canvas").length }));
  assert.ok(exitLoops.creature > 0 && exitLoops.motes > 0, `the menu loops resume on exit ${JSON.stringify(exitLoops)}`);
  assert.deepEqual(disposed, { attached: false, lost: true, canvases: 0 }, "the relief's canvas and WebGL context are released on exit");
  metrics.loops = { home: homeLoops, chroniclesOpen: openLoops, behindAnotherExhibit: hiddenExhibit, tabHidden: hiddenTab, tabShownAgain: shownAgain, afterExit: exitLoops, disposed, windowFrames: 40 };
  metrics.longTasks.openAtHigh = { durations: await host.longTasks(stageOpened, stageReady + 500), milliseconds: Math.round(stageReady - stageOpened) };
  await stagePage.close();
  record(`Exactly one render loop at a time with the real sorcerer: on Home the sorcerer drew ${homeLoops.creature} and the motes ${homeLoops.motes} calls in 40 frames; with Chronicles open the sorcerer drew ${openLoops.creature}, the motes' canvas was gone and only the relief drew; the relief drew nothing behind another exhibit or in a hidden tab, and on exit the sorcerer and motes resumed while the relief's canvas was removed and its WebGL context released`);

  // Without WebGL the Atlas falls back to the flat painting with the same rings.
  const flatPage = await openPage({ quality: "medium", webgl: false, expected: /WebGL/i });
  const flat = on(flatPage);
  await flatPage.getByRole("tab", { name: "Home", exact: true }).click();
  await flatPage.getByRole("button", { name: "Chronicles", exact: true }).click();
  await flat.atlasReady("flat");
  const mapBox = () => flatPage.locator(".chronicles-flat-image").evaluate((image) => {
    const box = image.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, complete: image.complete, alt: image.alt };
  });
  const painted = await mapBox();
  assert.deepEqual([painted.naturalWidth, painted.naturalHeight, painted.complete, painted.alt], [CHRONICLES_MAP.width, CHRONICLES_MAP.height, true, CHRONICLES_MAP.alt]);
  for (const item of hotspots) {
    const ring = await flatPage.locator(`.chronicles-hotspot[data-nation="${item.nation}"]`).boundingBox();
    assert.ok(Math.abs(ring.x + ring.width / 2 - (painted.left + item.hotspot.x * painted.width)) < 1 && Math.abs(ring.y + ring.height / 2 - (painted.top + item.hotspot.y * painted.height)) < 1, `${item.nation} ring sits on its painted place`);
    assert.ok(ring.width >= painted.width * 0.06 - 0.5, `${item.nation} ring is at least 6% of the image width`);
    await flatPage.mouse.click(painted.left + item.hotspot.x * painted.width, painted.top + item.hotspot.y * painted.height);
    await flat.recordShown(item);
    await flat.auditText(`flat ${item.id}`);
  }
  await flatPage.keyboard.press("Escape"); await flatPage.waitForFunction(() => !document.querySelector("#chronicles-record"));
  await flatPage.mouse.click(painted.left + painted.width / 2, painted.top + painted.height / 2);
  await flatPage.waitForTimeout(150);
  assert.equal(await flat.openRecord(), null, "the flat map's centre opens nothing");
  await flatPage.keyboard.press("Home"); await flat.focusName(hotspots[0].title);
  await flatPage.keyboard.press("ArrowRight"); await flat.focusName(hotspots[2].title);
  await flatPage.keyboard.press("Enter"); await flat.recordShown(hotspots[2]);
  await flatPage.mouse.move(1, 1);
  const flatPath = `${directory}/atlas-flat-1280x720.png`;
  await flatPage.screenshot({ path: flatPath }); captures.push({ path: flatPath, viewport: { width: 1280, height: 720 } });
  await flatPage.close();
  record("Without WebGL the Atlas shows the flat painting with the same four rings on their painted places (each at least 6% of the image width), opening the same records by pointer and keyboard; the centre opens nothing");

  // Captures: the default high quality with motion on, as the menu ships.
  const capturePage = await openPage({ quality: "high", motion: true });
  const shots = on(capturePage);
  const keys = async (...names) => { for (const name of names) await capturePage.keyboard.press(name); };
  const shot = async (name, settle = true) => {
    if (settle) await shots.settled();
    await capturePage.waitForTimeout(700);
    await shots.frames(2);
    const viewport = capturePage.viewportSize();
    const path = `${directory}/${name}-${viewport.width}x${viewport.height}.png`;
    await capturePage.screenshot({ path });
    captures.push({ path, viewport });
    console.log(path);
  };
  await capturePage.getByRole("tab", { name: "Home", exact: true }).click();
  await keys("ArrowRight", "Enter");
  await shots.atlasReady();
  await capturePage.mouse.move(1, 1);
  await shot("atlas");
  await keys("ArrowRight"); await shot("focus-hotspot");
  await keys("ArrowLeft", "Enter"); await shot("record-korvenia");
  await keys("Escape", "ArrowRight", "Enter"); await shot("record-aethelgard");
  await keys("Escape", "ArrowDown", "Enter"); await shot("record-solforiz");
  await keys("Escape", "ArrowLeft", "Enter"); await shot("record-kwind-09");
  await keys("Escape"); await shots.settled("overview");
  const captureRings = await shots.markers();
  await capturePage.mouse.move(captureRings.aethelgard.x + 30, captureRings.aethelgard.y + 30);
  await capturePage.mouse.move(captureRings.aethelgard.x, captureRings.aethelgard.y, { steps: 3 });
  await capturePage.waitForTimeout(500);
  const hoverPath = `${directory}/hover-hotspot-1280x720.png`;
  await capturePage.screenshot({ path: hoverPath }); captures.push({ path: hoverPath, viewport: { width: 1280, height: 720 } }); console.log(hoverPath);
  await capturePage.mouse.move(1, 1);
  await keys("ArrowLeft", "ArrowUp", "ArrowUp"); await shot("focus-tabs");
  await keys("ArrowRight", "ArrowDown", "ArrowRight", "ArrowRight"); await shot("interregnum", false);
  await keys("ArrowUp", "ArrowRight", "ArrowDown"); await shot("laws", false);
  await keys("ArrowDown", "ArrowDown"); await shot("focus-article", false);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await capturePage.setViewportSize(viewport);
    await shots.screen().getByRole("tab", { name: CHRONICLE_EXHIBITS[0].title, exact: true }).click();
    await keys("ArrowDown", "Home");
    await capturePage.mouse.move(1, 1);
    await shots.settled("overview");
    await shot("atlas");
    await keys("Enter"); await shot("record-korvenia");
    await keys("Escape", "ArrowUp", "ArrowRight"); await shot("interregnum", false);
    await keys("ArrowRight"); await shot("laws", false);
  }
  await capturePage.close();
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors; captures saved for the Atlas, every nation record, hover and focus states, the Interregnum, the Laws and the flat fallback");
} catch (error) { failure = error; }
finally {
  await writeFile(`${directory}/verification.json`, JSON.stringify({
    passed: !failure,
    scope: "Chronicles screen with the real-time relief Atlas: DOM and raycast checks at medium quality with model=none and reduced motion, a mocked standard controller, a motion-enabled pass, a loop pass with the real sorcerer GLB at high quality, a WebGL outage pass, and captures at the default high quality with motion on.",
    checks, metrics, layouts, captures, visibleText: [...texts].sort(), errors,
    ...(failure ? { failure: String(failure.stack || failure) } : {}),
  }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
console.log(`PASS ${checks.length} Chronicles verification groups`);
