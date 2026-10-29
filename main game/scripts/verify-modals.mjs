import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { waitForMenuIdle, waitForDialogClosed } from "./motion-helpers.mjs";
import { chapterGrid, chaptersRegion, chapterName, openChapters } from "./chapters-helpers.mjs";
import { openCategory, leaveSettings, setMotion } from "./settings-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], layouts = [], errors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
const defaults = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", select: "Enter", back: "Escape", previousTab: "KeyQ", nextTab: "KeyE", first: "Home", last: "End" };
const states = [
  ...["Classic", "Local Duel", "Online Duel"].map((title) => ({ kind: "mode", title })),
  // My Legacy opens its destination screen, not a dialog (checked below and in verify-legacy.mjs).
  ...["Chronicles", "Herald Board"].map((title) => ({ kind: "home", title })),
  ...[1, 2].map((number) => ({ kind: "chapter", number, title: chapterName(number) })),
  { kind: "quit", title: "Return to Home?" },
];
const quitState = states.find((state) => state.kind === "quit");
let failure;
try {
  const createPage = async ({ motion = false, reducedMotion = "reduce", bindings = {} } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion });
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(({ motion, bindings }) => {
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", volume: 65, motion, bindings }));
      localStorage.setItem("crownfall.main-game.save", "existing-modal-verification-record");
      window.__modalPadButtons = []; window.__modalPadHeld = []; window.__modalPadAxes = [0, 0]; window.__modalPadReads = 0;
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
        const pressed = [...window.__modalPadButtons, ...window.__modalPadHeld], axes = [...window.__modalPadAxes];
        window.__modalPadButtons = []; window.__modalPadAxes = [0, 0]; window.__modalPadReads++;
        return [{ index: 0, mapping: "standard", connected: true, axes, buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
      } });
    }, { motion, bindings: { ...defaults, ...bindings } });
    await page.goto(target.href); await waitForBootReady(page); return page;
  };
  const dialog = (page) => page.locator("dialog");
  const button = (page, name) => dialog(page).getByRole("button", { name, exact: true });
  const focus = async (page, name) => page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label && document.querySelector("dialog")?.contains(document.activeElement), name);
  const toPlay = async (page) => {
    if (await chapterGrid(page).count()) { await page.keyboard.press("Escape"); await waitForMenuIdle(page); }
    if (await page.locator(".settings-grid,.settings-detail").count()) await leaveSettings(page);
    await page.getByRole("tab", { name: "Play", exact: true }).click(); await waitForMenuIdle(page);
  };
  const open = async (page, state = states[0]) => {
    await toPlay(page);
    let restore = state.title;
    if (state.kind === "home") {
      await page.getByRole("tab", { name: "Home", exact: true }).click(); await waitForMenuIdle(page);
      await page.getByRole("button", { name: state.title, exact: true }).click();
    } else if (state.kind === "chapter") {
      await openChapters(page); await chapterGrid(page).getByRole("button", { name: state.title, exact: true }).click();
    } else if (state.kind === "quit") {
      restore = await page.locator('.game-card[aria-pressed="true"]').getAttribute("aria-label");
      await page.getByRole("button", { name: "Back", exact: true }).click();
    } else await page.getByRole("button", { name: state.title, exact: true }).click();
    await page.getByRole("dialog", { name: state.title, exact: true }).waitFor(); await focus(page, "Confirm");
    return restore;
  };
  const restored = async (page, name) => {
    await waitForDialogClosed(page);
    await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label && !document.querySelector("dialog").contains(document.activeElement), name);
  };
  const pad = async (page, pressed, after, axes = [0, 0]) => {
    await page.waitForTimeout(400);
    const reads = await page.evaluate(({ pressed, axes }) => { window.__modalPadButtons = pressed; window.__modalPadAxes = axes; return window.__modalPadReads; }, { pressed, axes });
    await page.waitForFunction((prior) => window.__modalPadReads > prior, reads); await after();
  };
  const page = await createPage();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const state of states) {
      const restore = await open(page, state);
      const layout = await dialog(page).evaluate((element) => {
        const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const inner = element.querySelector(".dialog-inner"), heading = element.querySelector("h1"), style = getComputedStyle(element), ink = getComputedStyle(heading);
        const text = [...element.querySelectorAll("h1,p,button")];
        return { dialog: rect(element), stage: rect(document.querySelector(".menu-stage")), heading: rect(heading), inner: rect(inner), color: ink.color, alignment: ink.textAlign, bodyCentered: [...element.querySelectorAll("p")].every((node) => getComputedStyle(node).textAlign === "center"), background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, innerBackground: getComputedStyle(inner).backgroundColor, innerBorder: getComputedStyle(inner).borderTopWidth, overflow: element.scrollWidth > element.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth, clipped: text.filter((node) => { const r = node.getBoundingClientRect(); return node.scrollWidth > node.clientWidth + 1 || r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1; }).map((node) => node.textContent.trim()), described: element.getAttribute("aria-describedby").split(/\s+/).every((id) => !!document.getElementById(id)?.textContent.trim()), text: element.innerText, buttons: [...element.querySelectorAll("button")].map((node) => ({ name: node.getAttribute("aria-label"), ...rect(node) })) };
      });
      assert.deepEqual(layout.buttons.map((item) => item.name), ["Confirm", "Cancel"]);
      assert.equal(await dialog(page).locator(".dialog-close,.dialog-eyebrow,.dialog-footer,input,form").count(), 0);
      assert.equal(layout.background, "rgba(0, 0, 0, 0)"); assert.equal(layout.innerBackground, "rgba(0, 0, 0, 0)");
      assert.equal(layout.border, "0px"); assert.equal(layout.innerBorder, "0px"); assert.equal(layout.shadow, "none");
      assert.equal(layout.overflow, false); assert.deepEqual(layout.clipped, []); assert.equal(layout.described, true);
      assert.equal(layout.alignment, "center"); assert.equal(layout.bodyCentered, true);
      const [r, g, b] = layout.color.match(/\d+/g).map(Number); assert.ok(r > g && g > b && r >= 160 && b < 130);
      assert.ok(Math.abs(layout.heading.x + layout.heading.width / 2 - (layout.stage.x + layout.stage.width / 2)) < 2);
      assert.ok(layout.heading.y >= layout.stage.y + layout.stage.height * .15 && layout.heading.bottom < layout.stage.y + layout.stage.height * .45);
      assert.ok(layout.buttons[0].right < layout.buttons[1].x && layout.buttons.every((item) => item.height >= 30));
      if (state.kind !== "quit") assert.match(layout.text, /not connected|unavailable/i);
      layouts.push({ viewport, state: state.title, ...layout });
      await button(page, "Cancel").click(); await restored(page, restore);
      if (viewport.width === 1280) {
        await open(page, state); await button(page, "Confirm").click(); await waitForDialogClosed(page); await waitForMenuIdle(page);
        if (state.kind === "quit") {
          assert.equal(await page.getByRole("tab", { name: "Home", exact: true }).getAttribute("aria-selected"), "true");
          assert.equal(await page.locator('.home-tile[aria-pressed="true"]').evaluate((node) => node === document.activeElement), true);
        } else await restored(page, restore);
      }
      assert.equal(await page.evaluate(() => localStorage.getItem("crownfall.main-game.save")), "existing-modal-verification-record"); assert.equal(page.url(), target.href);
    }
  }
  record(`All ${states.length} content states fit the same transparent borderless centered amber-heading shell across 3 viewports; only Confirm/Cancel appear, descriptions resolve and both actions preserve honest destination/focus semantics`);

  await page.setViewportSize({ width: 1280, height: 720 });
  await toPlay(page);
  await page.getByRole("tab", { name: "Home", exact: true }).click(); await waitForMenuIdle(page);
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await page.locator('.legacy-layer[data-legacy-layer="active"]').waitFor();
  assert.equal(await dialog(page).evaluate((node) => node.open), false, "My Legacy opens its screen, not the shared modal");
  await page.keyboard.press("Escape");
  await page.locator(".home-grid").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "My Legacy");
  record("My Legacy no longer opens a limited-state modal: it opens its destination screen and Back restores the Home tile");

  await page.setViewportSize({ width: 1280, height: 720 }); await open(page);
  for (const [key, name] of [["ArrowRight", "Cancel"], ["ArrowDown", "Cancel"], ["ArrowLeft", "Confirm"], ["ArrowUp", "Confirm"], ["End", "Cancel"], ["Home", "Confirm"], ["Tab", "Cancel"], ["Tab", "Confirm"], ["Shift+Tab", "Cancel"]]) { await page.keyboard.press(key); await focus(page, name); }
  await page.keyboard.press("q"); await page.keyboard.press("e");
  for (const bumper of [4, 5]) await pad(page, [bumper], async () => assert.equal(await dialog(page).evaluate((node) => node.open), true));
  assert.equal(await page.locator('.main-nav [aria-selected="true"]').getAttribute("aria-label"), "Play");
  assert.equal(await page.locator(".menu-transition").getAttribute("data-view-key"), "play");
  await page.keyboard.press("Enter"); await restored(page, "Classic");
  record("Native modal focus traps Tab/Shift-Tab; arrow/Home/End navigation works, Enter activates the focused action and Q/E/LB/RB do not reach the menu");

  await open(page);
  for (const [code, name] of [[15, "Cancel"], [13, "Cancel"], [14, "Confirm"], [12, "Confirm"]]) await pad(page, [code], () => focus(page, name));
  await pad(page, [], () => focus(page, "Cancel"), [1, 0]); await pad(page, [], () => focus(page, "Confirm"), [-1, 0]);
  await pad(page, [1], () => restored(page, "Classic"));
  await open(page, quitState); await pad(page, [15], () => focus(page, "Cancel"));
  await pad(page, [0], async () => { await waitForDialogClosed(page); assert.equal(await page.getByRole("tab", { name: "Play", exact: true }).getAttribute("aria-selected"), "true"); });
  await open(page, quitState); await pad(page, [0], async () => { await waitForDialogClosed(page); await waitForMenuIdle(page); assert.equal(await page.getByRole("tab", { name: "Home", exact: true }).getAttribute("aria-selected"), "true"); });
  record("Controller D-pad/axes move between actions; B cancels and A activates current focus, including distinct Quit Cancel/Confirm destinations");

  await toPlay(page); await page.getByRole("button", { name: "Classic", exact: true }).focus();
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__modalPadHeld = [0]; });
  await page.getByRole("dialog", { name: "Classic", exact: true }).waitFor(); await page.waitForTimeout(700);
  assert.equal(await dialog(page).evaluate((node) => node.open), true, "holding opener A must not confirm the newly opened modal");
  await page.evaluate(() => { window.__modalPadHeld = []; });
  await pad(page, [0], () => restored(page, "Classic"));
  await open(page); await page.waitForTimeout(400); await page.evaluate(() => { window.__modalPadHeld = [1]; }); await restored(page, "Classic"); await page.waitForTimeout(700);
  assert.equal(await dialog(page).evaluate((node) => node.open), false, "holding cancel B must not open the underlying Quit dialog");
  await page.evaluate(() => { window.__modalPadHeld = []; });
  await page.getByRole("button", { name: "Classic", exact: true }).focus(); await page.keyboard.down("Enter");
  await page.getByRole("dialog", { name: "Classic", exact: true }).waitFor(); await page.keyboard.down("Enter");
  assert.equal(await dialog(page).evaluate((node) => node.open), true); await page.keyboard.up("Enter");
  await page.keyboard.down("Escape"); await restored(page, "Classic"); await page.keyboard.down("Escape");
  assert.equal(await dialog(page).evaluate((node) => node.open), false); await page.keyboard.up("Escape");
  record("Held controller A/B and repeated Select/Back keydowns cannot auto-confirm, double-close or activate the menu behind the modal");

  await open(page);
  const inner = await dialog(page).locator(".dialog-inner").boundingBox(), outer = await dialog(page).boundingBox();
  await page.mouse.click(inner.x + inner.width / 2, inner.y + 4);
  assert.equal(await dialog(page).evaluate((node) => node.open), true);
  await page.mouse.move(inner.x + inner.width / 2, inner.y + 4); await page.mouse.down(); await page.mouse.move(outer.x + 5, outer.y + 5); await page.mouse.up();
  assert.equal(await dialog(page).evaluate((node) => node.open), true, "dragging from content to backdrop must not dismiss");
  await page.mouse.click(outer.x + 5, outer.y + 5); await restored(page, "Classic");
  await openCategory(page, "Audio");
  const volume = page.getByRole("slider", { name: /^Master Volume$/i }); await volume.focus(); await volume.press("ArrowRight");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("crownfall.main-game.preferences")).volume), 66);
  assert.equal(await dialog(page).evaluate((node) => node.open), false); await leaveSettings(page);
  record("Content clicks/drags stay open while a real backdrop click cancels; Settings still save their immediate preference changes without an invented Apply modal");
  await page.close();

  const custom = await createPage({ bindings: { right: "KeyD", select: "KeyF", back: "KeyX" } });
  await open(custom); await custom.keyboard.press("ArrowRight"); await focus(custom, "Confirm");
  await custom.keyboard.press("d"); await focus(custom, "Cancel"); await custom.keyboard.press("f"); await restored(custom, "Classic");
  await open(custom); await custom.keyboard.press("f"); await restored(custom, "Classic");
  await open(custom); await custom.keyboard.press("x"); await restored(custom, "Classic");
  await open(custom, quitState); await custom.keyboard.press("d"); await custom.keyboard.press("Space"); await waitForDialogClosed(custom);
  assert.equal(await custom.getByRole("tab", { name: "Play", exact: true }).getAttribute("aria-selected"), "true");
  await open(custom, quitState); await custom.keyboard.press("Enter"); await waitForDialogClosed(custom); await waitForMenuIdle(custom);
  assert.equal(await custom.getByRole("tab", { name: "Home", exact: true }).getAttribute("aria-selected"), "true"); await custom.close();
  record("Configured direction/Select/Back bindings drive the modal, while native Enter and Space still activate focused buttons");

  const motion = await createPage({ motion: true, reducedMotion: "no-preference" });
  for (let index = 0; index < 3; index++) {
    await open(motion); await button(motion, "Cancel").click();
    await motion.evaluate(() => document.querySelector('.game-card[aria-label="Classic"]').click());
    await motion.getByRole("dialog", { name: "Classic", exact: true }).waitFor(); await focus(motion, "Confirm");
    assert.deepEqual(await dialog(motion).getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))), ["Confirm", "Cancel"]);
    await motion.keyboard.press("Escape"); await restored(motion, "Classic");
  }
  await motion.emulateMedia({ reducedMotion: "reduce" }); await open(motion); await button(motion, "Cancel").click();
  await motion.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await dialog(motion).evaluate((node) => getComputedStyle(node).display), "none");
  await motion.emulateMedia({ reducedMotion: "no-preference" }); await setMotion(motion, false); await leaveSettings(motion);
  await open(motion); await button(motion, "Cancel").click(); await motion.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await dialog(motion).evaluate((node) => getComputedStyle(node).display), "none"); await motion.close();
  record("Rapid close/reopen retains one complete focused modal; OS and saved reduced motion remove its exit delay");
  assert.deepEqual(errors, []); record("No JavaScript or console errors; no gameplay, save, unlock or URL side effects");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/modals", { recursive: true });
  await writeFile("artifacts/modals/verification.json", JSON.stringify({ passed: !failure, scope: `DOM-only model=none shared Confirm/Cancel modal across ${states.length} states and 3 viewports (My Legacy opens its own screen, verified by verify-legacy.mjs); native focus/keyboard, configured bindings, simulated standard controller, backdrop behavior and reduced motion. Actual GLB captures are separate.`, checks, layouts, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
