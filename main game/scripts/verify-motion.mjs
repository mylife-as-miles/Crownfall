import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { grid, openCategory, leaveSettings, setMotion } from "./settings-helpers.mjs";
import { waitForMenuIdle, waitForDialogClosed } from "./motion-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const checks = [], samples = [], errors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "no-preference" });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: true, volume: 65 }));
    window.__motionPadButtons = [];
    window.__motionPadReads = 0;
    window.__motionDialogOpens = 0;
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) { window.__motionDialogOpens++; return showModal.apply(this, args); };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      window.__motionPadReads++;
      const pressed = [...window.__motionPadButtons];
      window.__motionPadButtons = [];
      return [{ connected: true, index: 0, mapping: "standard", axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
    } });
  });
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const current = (selector) => page.locator(`.menu-transition-live ${selector}`);
  const clickTab = async (name, settle = true) => {
    await tab(name).click();
    if (settle) await waitForMenuIdle(page);
  };
  const inspect = async (label) => {
    const result = await page.locator(".menu-transition").evaluate((host) => {
      const live = host.querySelector(".menu-transition-live"), ghost = host.querySelector(".menu-transition-ghost");
      const focus = document.activeElement;
      const idCounts = new Map();
      document.querySelectorAll("[id]").forEach((node) => idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1));
      return {
        key: host.dataset.viewKey,
        state: host.dataset.transitionState,
        focus: focus?.getAttribute("aria-label") || focus?.getAttribute("data-setting") || focus?.tagName,
        focusInGhost: ghost.contains(focus),
        focusInLive: live.contains(focus),
        ghostChildren: ghost.childElementCount,
        ghostHidden: ghost.getAttribute("aria-hidden") === "true" && ghost.hasAttribute("inert"),
        duplicateIds: [...idCounts].filter(([, count]) => count > 1).map(([id]) => id),
        overflow: document.documentElement.scrollWidth > innerWidth,
        livePoses: [...live.children].map((node) => ({ opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform })),
        activeAnimations: host.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
      };
    });
    assert.equal(result.focusInGhost, false, `${label}: focus moved into outgoing content`);
    assert.equal(result.ghostHidden, true, `${label}: outgoing layer is not hidden and inert`);
    assert.deepEqual(result.duplicateIds, [], `${label}: cloned content duplicated live IDs`);
    assert.equal(result.overflow, false, `${label}: page overflow`);
    samples.push({ label, ...result });
    return result;
  };
  const assertFocus = async () => {
    await page.waitForFunction(() => document.querySelector(".menu-transition-live")?.contains(document.activeElement));
    assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY");
  };
  const pad = async (button) => {
    await page.waitForTimeout(400);
    const reads = await page.evaluate((index) => { window.__motionPadButtons = [index]; return window.__motionPadReads; }, button);
    await page.waitForFunction((prior) => window.__motionPadReads > prior, reads);
    await waitForMenuIdle(page);
  };
  await page.goto(target.href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { window.__motionSceneNodes = [document.querySelector(".creature-stage"), document.querySelector(".atmosphere")]; });
  assert.equal(await page.locator(".menu-transition").count(), 1);
  await waitForMenuIdle(page);
  await page.keyboard.press("ArrowRight");
  // Sample in the same browser callback as the user action, avoiding an RPC
  // round-trip consuming the short entry animation on a loaded test runner.
  const moving = await page.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Normal screen transition never entered running state")), 2000);
    document.querySelector('.main-nav [role="tab"][aria-label="Home"]').click();
    const sample = () => {
      const host = document.querySelector(".menu-transition"), live = host.querySelector(".menu-transition-live"), ghost = host.querySelector(".menu-transition-ghost");
      if (host.dataset.transitionState !== "running") { requestAnimationFrame(sample); return; }
      clearTimeout(timeout);
      resolve({ state: host.dataset.transitionState, ghostChildren: ghost.childElementCount, activeAnimations: host.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length, livePoses: [...live.children].map((node) => ({ opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform })) });
    };
    requestAnimationFrame(sample);
  }));
  samples.push({ label: "first normal Home animation frame", ...moving });
  await inspect("normal Home entry focus/accessibility");
  assert.ok(moving.ghostChildren > 0 && moving.activeAnimations > 0, "normal motion must retain an animated outgoing layer");
  assert.ok(moving.livePoses.some((pose) => pose.opacity < 1 || !["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(pose.transform)), "normal screen entry must have an intermediate visual pose");
  await assertFocus();
  await waitForMenuIdle(page);
  assert.equal((await inspect("settled Home")).ghostChildren, 0);
  record("Normal screen entry has real intermediate motion, one inert aria-hidden exit layer, live incoming focus, unique IDs and complete cleanup");

  for (const name of ["Play", "Settings", "Home", "Settings", "Play", "Home", "Play"]) {
    await page.evaluate((label) => document.querySelector(`.main-nav [role="tab"][aria-label="${label}"]`).click(), name);
    await frame();
    await inspect(`interrupted ${name}`);
    await assertFocus();
  }
  await waitForMenuIdle(page);
  assert.equal(await tab("Play").getAttribute("aria-selected"), "true");
  assert.equal(await current(".game-card").count(), 4);
  assert.equal(await current('.game-card[aria-pressed="true"]').getAttribute("aria-label"), "Chapters");
  assert.equal((await inspect("rapid navigation settled")).ghostChildren, 0);
  assert.equal(await page.evaluate(() => window.__motionSceneNodes.every((node) => node?.isConnected) && window.__motionSceneNodes[0] === document.querySelector(".creature-stage") && window.__motionSceneNodes[1] === document.querySelector(".atmosphere")), true, "screen transitions must retain the persistent creature and atmosphere elements");
  await page.waitForFunction(() => document.querySelector(".nav-active-indicator").getAnimations().every((animation) => animation.playState !== "running"));
  const navIndicator = await page.locator(".nav-active-indicator").evaluate((indicator) => {
    const rect = indicator.getBoundingClientRect(), active = document.querySelector('.main-nav [aria-selected="true"]').getBoundingClientRect();
    return { pointerEvents: getComputedStyle(indicator).pointerEvents, hidden: indicator.getAttribute("aria-hidden"), x: rect.x, width: rect.width, activeX: active.x, activeWidth: active.width };
  });
  samples.push({ label: "settled nav indicator", ...navIndicator });
  assert.equal(navIndicator.pointerEvents, "none"); assert.equal(navIndicator.hidden, "true");
  assert.ok(Math.abs(navIndicator.x - navIndicator.activeX) < 1 && Math.abs(navIndicator.width - navIndicator.activeWidth) < 1, `moving tab indicator must settle on the active tab without intercepting clicks: ${JSON.stringify(navIndicator)}`);
  record("Rapid interrupted Home/Play/Settings navigation settles on the last requested screen without stale exits, duplicate live controls or lost selection");

  await clickTab("Settings");
  for (const category of ["General", "Video", "Controls", "Audio"]) {
    await grid(page).getByRole("button", { name: category, exact: true }).click();
    await frame();
    await assertFocus();
    await inspect(`${category} detail entry`);
    await page.keyboard.press("Escape");
    await frame();
    await assertFocus();
    await waitForMenuIdle(page);
    assert.equal(await current(".settings-detail").count(), 0);
    assert.equal(await current(".settings-tile.is-selected").getAttribute("aria-label"), category);
  }
  await leaveSettings(page);
  record("Rapid category entry and Back retain incoming row/grid focus and selected category through animation interruptions");

  await page.keyboard.press("q"); await waitForMenuIdle(page);
  assert.equal(await tab("Home").getAttribute("aria-selected"), "true");
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  assert.equal(await tab("Play").getAttribute("aria-selected"), "true");
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  assert.equal(await tab("Showcase").getAttribute("aria-selected"), "true");
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  assert.equal(await tab("Settings").getAttribute("aria-selected"), "true");
  await pad(4); assert.equal(await tab("Showcase").getAttribute("aria-selected"), "true");
  await pad(5); assert.equal(await tab("Settings").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Escape"); await waitForMenuIdle(page);
  await assertFocus();
  record("Q/E and standard-controller LB/RB keep the four-tab order and restore reachable incoming content after Settings Back");

  await clickTab("Play");
  for (const name of ["Classic", "Chapters", "Local Duel"]) {
    const before = await page.evaluate(() => window.__motionDialogOpens);
    await current(`button[aria-label="${name}"]`).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__motionDialogOpens), before + 1, "one click must open exactly one modal");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.keyboard.press("Escape");
    await waitForDialogClosed(page);
    await assertFocus();
    assert.equal(await current('.game-card[aria-pressed="true"]').getAttribute("aria-label"), name);
  }
  await current('button[aria-label="Classic"]').click();
  await page.getByRole("heading", { name: "Classic", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  // Reopening during an exit may either reopen the same mode or complete the
  // close first; both paths must remain usable and never leave an empty modal.
  if (await page.locator("dialog").evaluate((dialog) => dialog.open)) {
    assert.match(await page.locator("dialog h1").innerText(), /Classic/);
    await page.keyboard.press("Escape");
  }
  await waitForDialogClosed(page);
  await current('button[aria-label="Online Duel"]').click();
  await page.getByRole("heading", { name: "Online Duel", exact: true }).waitFor();
  assert.match(await page.locator("dialog").innerText(), /unavailable/);
  await page.keyboard.press("Escape"); await waitForDialogClosed(page);
  record("Mode dialogs open once per click, close/reopen cleanly during interruptions and restore selection/focus without empty or duplicate modals");

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const name of ["Home", "Play", "Showcase", "Settings"]) {
      await clickTab(name, false);
      await frame(); await inspect(`${viewport.width}px ${name} in motion`);
      await waitForMenuIdle(page); await inspect(`${viewport.width}px ${name} settled`);
    }
  }
  record("All four screens remain within desktop and landscape page bounds during motion, interruption and settled layouts");

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const name of ["Home", "Play", "Showcase", "Settings"]) {
    await clickTab(name, false); await frame();
    const result = await inspect(`OS reduced ${name}`);
    assert.equal(result.state, "idle"); assert.equal(result.ghostChildren, 0); assert.equal(result.activeAnimations, 0);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setMotion(page, false);
  await leaveSettings(page);
  for (const name of ["Home", "Settings", "Play"]) {
    await clickTab(name, false); await frame();
    const result = await inspect(`saved reduced ${name}`);
    assert.equal(result.state, "idle"); assert.equal(result.ghostChildren, 0); assert.equal(result.activeAnimations, 0);
  }
  await current('button[aria-label="Classic"]').click();
  await page.getByRole("heading", { name: "Classic", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await frame();
  assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
  record("OS reduced motion and saved Ambient Motion off skip transitions immediately, clean outgoing layers and close dialogs without an exit delay");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors; test intentionally uses model=none and preserves actual-renderer captures");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/motion", { recursive: true });
  await writeFile("artifacts/motion/verification.json", JSON.stringify({ passed: !failure, scope: "DOM-only model=none menu transitions, interruptions, focus, reduced motion and simulated standard-controller behavior. Actual visual recording is captured separately by the coordinating agent.", checks, samples, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
