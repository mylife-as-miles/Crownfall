import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { grid, openCategory, leaveSettings, setMotion } from "./settings-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], layouts = [], errors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;
let fullscreenResult;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    if (!localStorage.getItem("crownfall.main-game.preferences")) localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", volume: 65, motion: false }));
    window.__settingsPadConnected = false;
    window.__settingsPadButtons = [];
    window.__settingsPadReads = 0;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      window.__settingsPadReads++;
      const pressed = [...window.__settingsPadButtons]; window.__settingsPadButtons = [];
      return window.__settingsPadConnected ? [{ index: 0, id: "Test standard controller", mapping: "standard", connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), touched: false, value: pressed.includes(index) ? 1 : 0 })) }] : [];
    } });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem("crownfall.main-game.preferences")));
  const focusName = (name) => page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, name);
  const row = (id) => page.locator(`.settings-detail [data-setting="${id}"]`);
  const focusRow = async (id) => { await row(id).focus(); await page.waitForFunction((setting) => document.activeElement?.dataset.setting === setting, id); };
  const backToGrid = async () => { await page.keyboard.press("Escape"); await grid(page).waitFor(); };
  const setRange = async (name, value) => {
    const input = page.getByRole("slider", { name: new RegExp(`^${name}$`, "i") });
    const step = Number(await input.getAttribute("step") || 1);
    const current = Number(await input.inputValue());
    await input.focus();
    for (let count = 0; count < Math.abs(value - current) / step; count++) await input.press(value > current ? "ArrowRight" : "ArrowLeft");
    assert.equal(Number(await input.inputValue()), value);
  };
  const pad = async (button, after) => {
    await page.waitForTimeout(400);
    const prior = await page.evaluate((index) => { window.__settingsPadConnected = true; window.__settingsPadButtons = [index]; return window.__settingsPadReads; }, button);
    try {
      await page.waitForFunction((reads) => window.__settingsPadReads > reads, prior);
      await page.evaluate(() => { window.__settingsPadButtons = []; });
      await after();
    } finally { await page.evaluate(() => { window.__settingsPadButtons = []; }); }
  };
  await page.goto(target.href);
  await page.evaluate(() => document.fonts.ready);
  const migrated = await prefs();
  assert.equal(migrated.showHints, true); assert.equal(migrated.renderScale, 100); assert.equal(migrated.frameLimit, 0);
  assert.equal(migrated.bindings.right, "ArrowRight");
  await page.keyboard.press("ArrowRight"); await focusName("Chapters");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await grid(page).waitFor();
  assert.deepEqual(await grid(page).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["General", "Controls", "Input", "Video", "Audio", "Credits"]);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const state = await grid(page).evaluate((element) => ({ overflow: document.documentElement.scrollWidth > innerWidth, buttons: [...element.querySelectorAll("button")].map((button) => { const r = button.getBoundingClientRect(); const title = button.querySelector(".settings-tile-title"); return { label: button.getAttribute("aria-label"), x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, titleFits: title.scrollWidth <= title.clientWidth + 1 }; }) }));
    assert.equal(state.overflow, false); assert.ok(state.buttons.every((b) => b.titleFits && b.x >= 0 && b.right <= viewport.width && b.y >= 0 && b.bottom <= viewport.height));
    const b = state.buttons;
    assert.ok(b[0].x < b[1].x && b[1].x < b[2].x && Math.abs(b[0].y - b[2].y) < 1);
    assert.ok(Math.abs(b[0].x - b[3].x) < 1 && Math.abs(b[2].x - b[5].x) < 1 && b[3].y > b[0].y);
    layouts.push({ type: "grid", viewport, ...state });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const [key, name] of [["ArrowRight", "Controls"], ["ArrowRight", "Input"], ["ArrowDown", "Credits"], ["ArrowLeft", "Audio"], ["ArrowLeft", "Video"], ["ArrowUp", "General"], ["ArrowUp", "General"], ["End", "Credits"], ["Home", "General"]]) { await page.keyboard.press(key); await focusName(name); }
  assert.equal(await grid(page).locator('button[tabindex="0"]').count(), 1);
  record("Legacy preference migration and six-tile keyboard/spatial grid pass at desktop and landscape sizes");

  await pad(15, () => focusName("Controls"));
  await pad(13, () => focusName("Audio"));
  await pad(14, () => focusName("Video"));
  await pad(12, () => focusName("General"));
  await pad(0, () => page.getByRole("region", { name: "General settings", exact: true }).waitFor());
  await pad(1, () => grid(page).waitFor()); await focusName("General");
  await page.keyboard.press("Escape"); await focusName("Chapters");
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.keyboard.press("End"); await focusName("Herald Board");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await grid(page).waitFor(); await page.keyboard.press("Escape"); await focusName("Herald Board");
  await page.getByRole("tab", { name: "Play", exact: true }).click();
  record("Controller four-way grid/A/B and Settings back preserve the originating Home or Play selection and actual focus");

  await openCategory(page, "General");
  assert.match(await row("language").getAttribute("aria-label"), /English.*read only/i);
  assert.equal(await row("language").locator("input,select,button").count(), 0);
  await focusRow("language"); await page.keyboard.press("ArrowRight");
  assert.match(await row("language").innerText(), /English/);
  await page.keyboard.press("ArrowDown"); await page.waitForFunction(() => document.activeElement?.dataset.setting === "ambient-motion");
  await page.keyboard.press("ArrowRight"); assert.equal((await prefs()).motion, true);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowLeft"); assert.equal((await prefs()).showHints, false);
  assert.ok(await page.getByRole("button", { name: /Reset Defaults/ }).isVisible());
  assert.ok(await page.locator(".settings-detail-footer").getByRole("button", { name: /Back/ }).isVisible());
  await page.getByRole("button", { name: /Reset Defaults/ }).click();
  assert.equal((await prefs()).motion, true); assert.equal((await prefs()).showHints, true);
  await page.getByRole("switch", { name: /^Control Hints$/i }).click();
  assert.equal((await prefs()).showHints, false);
  record("General keeps English read only, supports U/D row navigation and L/R toggles, and hides hints without removing pointer Back/Reset");

  await openCategory(page, "Video");
  await focusRow("screen-resolution"); await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.dataset.setting === "global-illumination");
  await page.keyboard.press("Home"); await page.waitForFunction(() => document.activeElement?.dataset.setting === "screen-resolution");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.dataset.setting === "resolution-scale");
  await page.keyboard.press("ArrowLeft"); assert.equal((await prefs()).renderScale, 95);
  await page.keyboard.press("ArrowRight"); assert.equal((await prefs()).renderScale, 100);
  await page.getByRole("combobox", { name: /^Overall Quality$/i }).selectOption("low");
  assert.equal((await prefs()).quality, "low"); assert.equal((await prefs()).renderScale, 75);
  await page.getByRole("combobox", { name: /^Particle Quality$/i }).selectOption("medium");
  await setRange("Resolution Scale", 85);
  await page.getByRole("combobox", { name: /^Frame Rate Limit$/i }).selectOption("60");
  await page.getByRole("button", { name: "Change window mode", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement || /unavailable|not allow/i.test(document.querySelector("#settings-description")?.textContent || ""));
  fullscreenResult = await page.evaluate(() => ({ entered: !!document.fullscreenElement, description: document.querySelector("#settings-description").textContent }));
  if (fullscreenResult.entered) await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 1280, height: 720 });
  record("Video supports first/last rows, keyboard resolution adjustment, presets, particle quality, frame limit and honest fullscreen success/fallback");

  await openCategory(page, "Audio");
  await focusRow("master-volume");
  assert.match(await page.locator("#settings-description").innerText(), /audio playback is not connected.*no audible effect/i);
  await page.keyboard.press("ArrowRight"); assert.equal((await prefs()).volume, 70);
  await page.keyboard.press("ArrowLeft"); assert.equal((await prefs()).volume, 65);
  await setRange("Master Volume", 40);
  for (const id of ["audio-device", "sfx-volume", "music-volume", "dialogue-volume", "music"]) assert.equal(await row(id).locator("input,select,button").count(), 0);
  await leaveSettings(page);
  await page.reload();
  const stored = await prefs();
  assert.equal(stored.quality, "medium"); assert.equal(stored.renderScale, 85); assert.equal(stored.frameLimit, 60); assert.equal(stored.volume, 40); assert.equal(stored.showHints, false);
  await openCategory(page, "Video");
  assert.equal(await page.getByRole("slider", { name: /^Resolution Scale$/i }).inputValue(), "85");
  assert.equal(await page.getByRole("combobox", { name: /^Frame Rate Limit$/i }).inputValue(), "60");
  await pad(3, async () => { assert.equal((await prefs()).quality, "high"); assert.equal((await prefs()).renderScale, 100); assert.equal((await prefs()).frameLimit, 0); });
  await openCategory(page, "Audio"); await page.getByRole("button", { name: /Reset Defaults/ }).click(); assert.equal((await prefs()).volume, 65);
  record("Quality/scale/frame limit/volume/hints persist through reload; audio is explicit about no playback; category resets and controller Y restore actual defaults");

  await openCategory(page, "Controls");
  await page.keyboard.press("End"); await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Last option:"));
  await page.keyboard.press("Home"); await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Move left:"));
  const rightBinding = () => page.getByRole("button", { name: /^Move right:.*Change binding$/i });
  await rightBinding().click(); await page.keyboard.press("q");
  assert.match(await page.getByRole("status").innerText(), /already assigned to previous tab/i);
  assert.equal(await page.locator(".controls-detail").count(), 1);
  await page.keyboard.press("Tab"); assert.match(await page.getByRole("status").innerText(), /Tab is reserved/i);
  await page.keyboard.press("Escape"); assert.match(await page.getByRole("status").innerText(), /Binding unchanged/);
  assert.equal((await prefs()).bindings.right, "ArrowRight");
  await rightBinding().click(); await page.keyboard.press("d"); assert.equal((await prefs()).bindings.right, "KeyD");
  await leaveSettings(page); await page.keyboard.press("Home"); await focusName("Classic");
  await page.keyboard.press("d"); await focusName("Local Duel");
  await page.keyboard.press("ArrowRight"); await focusName("Local Duel");
  await page.keyboard.press("d"); await focusName("Chapters");
  await page.reload(); assert.equal((await prefs()).bindings.right, "KeyD");
  await page.keyboard.press("Home"); await page.keyboard.press("d"); await focusName("Local Duel");
  await openCategory(page, "Controls"); await rightBinding().click();
  await pad(1, () => page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes("Binding unchanged")));
  assert.equal(await page.locator(".controls-detail").count(), 1);
  await page.getByRole("button", { name: /Reset Defaults/ }).click(); assert.equal((await prefs()).bindings.right, "ArrowRight");
  await leaveSettings(page); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight"); await focusName("Local Duel");
  record("Controls capture blocks conflicts/reserved Tab, cancels with Escape or B, persists a real D binding, drives actual navigation and resets bindings");

  await page.evaluate(() => { window.__settingsPadConnected = false; window.dispatchEvent(new Event("gamepaddisconnected")); });
  await openCategory(page, "Input");
  assert.equal(await page.getByRole("img", { name: "Crownfall menu controller controls", exact: true }).count(), 1);
  assert.match(await page.getByRole("status").innerText(), /No controller detected/);
  await page.evaluate(() => { window.__settingsPadConnected = true; window.dispatchEvent(new Event("gamepadconnected")); });
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes("Controller connected"));
  assert.equal(await page.getByRole("button", { name: /Reset Defaults/ }).count(), 0);
  await page.keyboard.press("End"); assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent), /Back/);
  record("Input diagram has an accessible name and truthful disconnected/connected standard-controller status without fake remapping controls");

  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const category of ["General", "Controls", "Input", "Video", "Audio", "Credits"]) {
      await openCategory(page, category);
      const layout = await page.locator(".settings-detail").evaluate((detail) => {
        const rect = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, list: rect(detail.querySelector(".settings-detail-list")), info: rect(detail.querySelector(".settings-detail-info")), footer: rect(detail.querySelector(".settings-detail-footer")), navHidden: ["hidden", "collapse"].includes(getComputedStyle(document.querySelector(".main-nav")).visibility) || getComputedStyle(document.querySelector(".main-nav")).display === "none", rowOverflow: [...detail.querySelectorAll(".settings-row")].some((row) => row.scrollWidth > row.clientWidth + 1) };
      });
      assert.equal(layout.horizontalOverflow, false); assert.equal(layout.navHidden, true); assert.equal(layout.rowOverflow, false);
      if (layout.list && layout.info) assert.ok(layout.list.right < layout.info.x);
      assert.ok(layout.footer.x >= 0 && layout.footer.right <= viewport.width && layout.footer.bottom <= viewport.height);
      if (category === "Credits") { assert.equal(await page.getByRole("button", { name: /Reset Defaults/ }).count(), 0); assert.equal(await page.locator('.settings-row input,.settings-row select,.settings-row button').count(), 0); }
      layouts.push({ type: "detail", category, viewport, ...layout });
    }
  }
  record("All six details keep their list/description or controller layout, reachable Back footer and honest readonly Credits without overflow on desktop/landscape");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors; renderer retention is verified separately with the actual GLB model test");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/settings", { recursive: true });
  await writeFile("artifacts/settings/verification.json", JSON.stringify({ passed: !failure, scope: "DOM-only model=none settings behavior, geometry, persistence and simulated controller checks. Actual GLB retention/render scale is covered separately by verify-model.mjs.", checks, layouts, fullscreenResult, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
