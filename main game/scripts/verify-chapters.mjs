import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { waitForMenuIdle, waitForDialogClosed } from "./motion-helpers.mjs";
import { chapterName, chapterGrid, chaptersRegion, openChapters } from "./chapters-helpers.mjs";
import { leaveSettings, setMotion } from "./settings-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], layouts = [], artwork = [], errors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: true, volume: 65 }));
    window.__chaptersPadButtons = []; window.__chaptersPadReads = 0; window.__chaptersDialogOpens = 0;
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) { window.__chaptersDialogOpens++; return showModal.apply(this, args); };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      const pressed = [...window.__chaptersPadButtons]; window.__chaptersPadButtons = []; window.__chaptersPadReads++;
      return [{ index: 0, mapping: "standard", connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
    } });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const selected = async (number) => {
    const name = chapterName(number);
    await page.waitForFunction((label) => document.querySelector(`.menu-transition-live .chapter-tile[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true" && document.activeElement?.getAttribute("aria-label") === label, name);
    assert.equal(await chapterGrid(page).locator('[tabindex="0"]').count(), 1);
  };
  const backToPlay = async () => {
    await chaptersRegion(page).getByRole("button", { name: "Back", exact: true }).click();
    await waitForMenuIdle(page);
    const card = page.getByRole("button", { name: "Chapters", exact: true });
    assert.equal(await card.getAttribute("aria-pressed"), "true");
    assert.equal(await card.evaluate((button) => button === document.activeElement), true);
  };
  const preview = async (number) => {
    await page.getByRole("heading", { name: chapterName(number), exact: true }).waitFor();
    const text = await page.locator("dialog").innerText();
    assert.match(text, /Chapter gameplay is not connected/i);
    assert.match(text, /chapter-selection preview.*progress and unlocks are not recorded/is);
    assert.equal(await page.locator("dialog button").count(), 2);
    assert.equal(await page.locator("dialog input,dialog form,dialog .save-slot").count(), 0);
    assert.equal(await page.locator("dialog").getByRole("button", { name: /^(play|start|launch|unlock|save)$/i }).count(), 0);
  };
  const closePreview = async (number) => { await page.keyboard.press("Escape"); await waitForDialogClosed(page); await selected(number); };
  const pad = async (button, after) => {
    await page.waitForTimeout(400);
    const reads = await page.evaluate((index) => { window.__chaptersPadButtons = [index]; return window.__chaptersPadReads; }, button);
    await page.waitForFunction((prior) => window.__chaptersPadReads > prior, reads);
    await waitForMenuIdle(page); await after();
  };
  await page.goto(target.href); await waitForBootReady(page);
  assert.equal(await page.locator(".menu-shell").getAttribute("data-boot-state"), "ready");
  const legacy = JSON.stringify({ chapter: "Existing legacy record", updatedAt: "2026-01-01" });
  await page.evaluate((save) => { localStorage.setItem("crownfall.main-game.save", save); window.__chaptersScene = document.querySelector(".creature-stage"); }, legacy);
  await openChapters(page); await selected(1);
  assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
  const controls = await chapterGrid(page).getByRole("button").evaluateAll((buttons) => buttons.map((button) => ({ name: button.getAttribute("aria-label"), disabled: button.getAttribute("aria-disabled"), locked: button.dataset.locked, nativeDisabled: button.disabled })));
  assert.deepEqual(controls.map((button) => button.name), Array.from({ length: 14 }, (_, index) => chapterName(index + 1)));
  assert.deepEqual(controls.map((button) => button.disabled), Array.from({ length: 14 }, (_, index) => String(index >= 2)));
  assert.ok(controls.every((button) => button.locked === button.disabled && !button.nativeDisabled));
  assert.equal(await page.getByRole("tab").count(), 0, "nav is hidden/inert on the chapter screen");
  assert.equal(await chaptersRegion(page).getByRole("button", { name: "Back", exact: true }).count(), 1);
  assert.equal(await page.locator(".controller-hints").count(), 0);
  record("Chapters opens a separate fourteen-tile screen; only01/02 are previewable, twelve locked tiles remain focusable, and hidden nav has one reachable Back action");

  const manifest = JSON.parse(await readFile("artifacts/card-artwork.json", "utf8"));
  const images = await chapterGrid(page).locator(".chapter-art").evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => { await image.decode(); return { source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit, position: getComputedStyle(image).objectPosition }; })));
  assert.equal(images.length, 14);
  const checked = new Set();
  for (const [index, image] of images.entries()) {
    const expected = manifest.cards[index % 4];
    assert.equal(new URL(image.source).pathname, `/${expected.deliveryFile.replace(/^public\//, "")}`);
    assert.equal(image.width, expected.deliveryWidth); assert.equal(image.height, expected.deliveryHeight); assert.equal(image.fit, "cover");
    if (!checked.has(image.source)) {
      const response = await page.request.get(image.source); assert.ok(response.ok());
      assert.equal(createHash("sha256").update(await response.body()).digest("hex"), expected.deliverySha256); checked.add(image.source);
    }
    artwork.push({ chapter: chapterName(index + 1), ...image });
  }
  record("All fourteen thumbnail images decode and retain the exact four approved environment-artwork hashes with deliberate cover crops");

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const layout = await chaptersRegion(page).evaluate((screen) => {
      const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const grid = screen.querySelector(".chapters-grid");
      return { overflow: document.documentElement.scrollWidth > innerWidth, grid: rect(grid), scrollable: grid.scrollWidth > grid.clientWidth + 1, back: rect(screen.querySelector(".chapters-back")), tiles: [...grid.querySelectorAll("button")].map((tile) => {
        const title = tile.querySelector(".chapter-title"), box = rect(tile), text = rect(title);
        return { name: tile.getAttribute("aria-label"), ...box, textFits: title.scrollWidth <= title.clientWidth + 1 && text.x >= box.x && text.right <= box.right + 1 && text.bottom <= box.bottom + 1 };
      }) };
    });
    assert.equal(layout.overflow, false); assert.equal(layout.scrollable, false);
    assert.ok(layout.tiles.every((tile) => tile.textFits && tile.x >= 0 && tile.right <= viewport.width && tile.y >= 0 && tile.bottom <= viewport.height));
    assert.ok(layout.back.x >= 0 && layout.back.right <= viewport.width && layout.back.bottom <= viewport.height);
    const near = (a, b) => assert.ok(Math.abs(a - b) < 1);
    for (const [index, tile] of layout.tiles.entries()) {
      near(tile.y, layout.tiles[Math.floor(index / 5) * 5].y); near(tile.x, layout.tiles[index % 5].x);
      near(tile.width, layout.tiles[0].width); near(tile.height, layout.tiles[0].height);
    }
    assert.ok(layout.tiles[5].y > layout.tiles[0].y && layout.tiles[10].y > layout.tiles[5].y);
    assert.equal(layout.tiles.filter((tile) => Math.abs(tile.y - layout.tiles[0].y) < 1).length, 5);
    assert.equal(layout.tiles.filter((tile) => Math.abs(tile.y - layout.tiles[5].y) < 1).length, 5);
    assert.equal(layout.tiles.filter((tile) => Math.abs(tile.y - layout.tiles[10].y) < 1).length, 4);
    layouts.push({ viewport, ...layout });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  record("The grid keeps five/five/four equal tiles, fitting titles, reachable Back and no scrolling or overflow at desktop and landscape sizes");

  for (const [key, number] of [["Home", 1], ["ArrowLeft", 1], ["ArrowUp", 1], ["ArrowRight", 2], ["ArrowRight", 3], ["ArrowRight", 4], ["ArrowRight", 5], ["ArrowRight", 5], ["ArrowDown", 10], ["ArrowDown", 14], ["ArrowDown", 14], ["ArrowUp", 10], ["ArrowUp", 5], ["ArrowDown", 10], ["ArrowLeft", 9], ["ArrowDown", 14], ["ArrowUp", 9], ["Home", 1], ["End", 14]]) {
    await page.keyboard.press(key); await selected(number);
  }
  record("Keyboard movement clamps all edges, preserves the fifth preferred column across the short final row, supports Home/End and retains one focused tab stop");

  for (const number of [1, 2]) {
    const before = await page.evaluate(() => window.__chaptersDialogOpens);
    await chapterGrid(page).getByRole("button", { name: chapterName(number), exact: true }).click(); await preview(number);
    assert.equal(await page.evaluate(() => window.__chaptersDialogOpens), before + 1);
    await closePreview(number);
  }
  await page.keyboard.press("ArrowRight"); await selected(3);
  for (let index = 0; index < 5; index++) await page.keyboard.press("Enter");
  assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
  assert.match(await chaptersRegion(page).getByRole("status").innerText(), /Chapter 03 is locked.*progression is not connected/i);
  const locked = chapterGrid(page).getByRole("button", { name: chapterName(14), exact: true });
  const box = await locked.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await selected(14);
  assert.match(await chaptersRegion(page).getByRole("status").innerText(), /Chapter 14 is locked/i);
  assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
  await page.mouse.move(0, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("crownfall.main-game.save")), legacy);
  assert.equal(page.url(), target.href);
  record("Only01/02 open one honest preview per click; repeated locked Enter and physical locked-tile clicks announce unavailable progression without launch, unlock or save changes");

  await backToPlay(); await openChapters(page); await selected(14);
  await page.keyboard.press("Home"); await selected(1);
  await pad(15, () => selected(2)); await pad(13, () => selected(7)); await pad(14, () => selected(6)); await pad(12, () => selected(1));
  await pad(0, () => preview(1)); await pad(1, () => selected(1));
  await pad(1, async () => { await page.getByRole("region", { name: "Play options", exact: true }).waitFor(); });
  assert.equal(await page.getByRole("button", { name: "Chapters", exact: true }).evaluate((button) => button === document.activeElement), true);
  await openChapters(page); await selected(1);
  await pad(5, () => page.getByRole("region", { name: "Showcase options", exact: true }).waitFor());
  await pad(1, () => selected(1));
  await pad(4, () => page.getByRole("region", { name: "Home options", exact: true }).waitFor());
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  await openChapters(page); await selected(1);
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  await page.getByRole("region", { name: "Showcase options", exact: true }).waitFor();
  await page.keyboard.press("e"); await waitForMenuIdle(page);
  await page.getByRole("region", { name: "Settings categories", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await waitForMenuIdle(page);
  await page.getByRole("region", { name: "Play options", exact: true }).waitFor();
  record("Controller four-way/A/B and LB/RB plus Q/E keep Chapters tied to Play, restore its selection from Showcase and avoid Settings Back loops");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (let index = 0; index < 3; index++) {
    await openChapters(page); await page.keyboard.press("Escape"); await waitForMenuIdle(page);
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await openChapters(page);
  assert.equal(await page.locator(".menu-transition").getAttribute("data-transition-state"), "idle");
  assert.equal(await page.locator(".menu-transition-ghost").evaluate((ghost) => ghost.childElementCount), 0);
  await backToPlay(); await page.emulateMedia({ reducedMotion: "no-preference" });
  await setMotion(page, false); await leaveSettings(page); await openChapters(page);
  assert.equal(await page.locator(".menu-transition").getAttribute("data-transition-state"), "idle");
  assert.equal(await chapterGrid(page).evaluate((grid) => grid.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length), 0);
  assert.equal(await page.locator(".loading-screen").count(), 0);
  assert.equal(await page.evaluate(() => window.__chaptersScene === document.querySelector(".creature-stage") && window.__chaptersScene.isConnected), true);
  await backToPlay();
  const play = await page.locator(".game-cards").evaluate((row) => ({ width: row.getBoundingClientRect().width, cards: [...row.querySelectorAll("button")].map((button) => { const box = button.getBoundingClientRect(); return { label: button.getAttribute("aria-label"), width: box.width, height: box.height }; }), carousel: !!document.querySelector(".card-carousel,.carousel-controls") }));
  assert.equal(play.cards.length, 4); assert.deepEqual(play.cards.map((card) => card.label), ["Classic", "Local Duel", "Chapters", "Online Duel"]);
  assert.ok(Math.abs(play.width - 800) < 1 && play.cards.every((card) => Math.abs(card.width - 197) < 1 && Math.abs(card.height - 298) < 1)); assert.equal(play.carousel, false);
  record("Rapid screen entry/back and both reduced-motion controls retain focus, the persistent creature and completed boot; Play keeps its original four197×298 cards and no carousel");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors; no gameplay, campaign save, unlock or URL side effects");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/chapters", { recursive: true });
  await writeFile("artifacts/chapters/verification.json", JSON.stringify({ passed: !failure, scope: "DOM-only model=none fourteen-chapter screen, supplied-artwork thumbnails, honest preview/lock states, spatial focus, simulated standard controller, layouts and reduced motion. Actual GLB visuals are captured separately.", checks, layouts, artwork, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
