import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { grid, openCategory, leaveSettings } from "./settings-helpers.mjs";
import { waitForBootReady } from "./boot-helpers.mjs";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const target = new URL(origin);
target.searchParams.set("model", "none");
const directory = "artifacts/home";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const checks = [];
const record = (check) => { checks.push(check); console.log(`PASS ${check}`); };
const layouts = [];
const dialogs = [];
const errors = [];
let failure;

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: false, volume: 65 }));
    window.__homePadButtons = [];
    window.__homePadReads = 0;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        window.__homePadReads++;
        const pressed = [...window.__homePadButtons];
        window.__homePadButtons = [];
        return [{
          connected: true, index: 0, mapping: "standard", axes: [0, 0],
          buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: pressed.includes(index),
            touched: pressed.includes(index),
            value: pressed.includes(index) ? 1 : 0,
          })),
        }];
      },
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.8, `${message}: ${actual} vs ${expected}`);
  const selected = async (name, focus = true) => {
    await page.waitForFunction((label) => document.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true", name);
    const button = page.getByRole("button", { name, exact: true });
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    if (focus) await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, name);
  };
  const activeTab = async (name) => assert.equal(await page.locator(`.main-nav [role="tab"][aria-label="${name}"]`).getAttribute("aria-selected"), "true");
  const closed = async () => page.waitForFunction(() => !document.querySelector("dialog").open);
  const inspectPlay = async () => {
    const play = await page.locator(".game-cards").evaluate((row) => ({
      width: row.getBoundingClientRect().width,
      cards: [...row.querySelectorAll(".game-card")].map((card) => {
        const { x, y, width, height } = card.getBoundingClientRect();
        return { label: card.getAttribute("aria-label"), x, y, width, height };
      }),
      controls: document.querySelectorAll(".card-carousel, .carousel-controls").length,
    }));
    assert.equal(play.cards.length, 4);
    assert.deepEqual(play.cards.map((card) => card.label), ["Classic", "Local Duel", "Chapters", "Online Duel"]);
    near(play.width, 800, "fixed Play row width");
    play.cards.forEach((card) => { near(card.width, 197, "Play card width"); near(card.height, 298, "Play card height"); });
    assert.equal(play.controls, 0);
    return play;
  };

  await page.goto(target.href);
  await waitForBootReady(page);
  await page.evaluate(() => document.fonts.ready);
  await activeTab("Play");
  const initialPlay = await inspectPlay();
  await page.keyboard.press("ArrowRight");
  await selected("Chapters");
  record("Default Play retains its four original-size cards, current wording and no carousel");
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await activeTab("Home");
  await selected("My Legacy");
  assert.equal(await page.locator(".game-cards").count(), 0);
  assert.equal(await page.locator(".home-tile-eyebrow, .home-tile-description").count(), 0);
  const manifest = JSON.parse(await readFile("artifacts/home-artwork.json", "utf8"));
  const artwork = await page.locator(".home-tile").evaluateAll(async (tiles) => Promise.all(tiles.map(async (tile) => {
    const image = tile.querySelector("img");
    await image.decode();
    return { label: tile.getAttribute("aria-label"), disabled: tile.getAttribute("aria-disabled"), pending: tile.dataset.contentPending, source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit, position: getComputedStyle(image).objectPosition };
  })));
  assert.deepEqual(artwork.map((image) => image.label), ["My Legacy", "Chronicles", "Herald Board"]);
  for (const [index, image] of artwork.entries()) {
    const expected = manifest.images[index];
    assert.equal(image.disabled, "false");
    assert.equal(image.pending, "false");
    assert.equal(image.width, expected.deliveryDimensions.width);
    assert.equal(image.height, expected.deliveryDimensions.height);
    assert.equal(new URL(image.source).pathname, `/${expected.deliveryPath.replace(/^public\//, "")}`);
    const response = await page.request.get(image.source);
    assert.ok(response.ok());
    assert.equal(createHash("sha256").update(await response.body()).digest("hex"), expected.deliverySha256);
  }
  assert.deepEqual(artwork.map((image) => image.fit), ["cover", "contain", "cover"]);
  assert.ok(artwork.every((image) => image.position === "50% 50%"));
  record("All three final Home titles and exact supplied-image delivery hashes load; Chronicles preserves its map with contain");

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.locator(".home-grid").evaluate((grid) => {
      const box = (element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height, right: x + width, bottom: y + height }; };
      return { navigation: [...document.querySelectorAll(".main-nav button")].map((button) => ({ label: button.getAttribute("aria-label"), ...box(button) })), grid: box(grid), gap: parseFloat(getComputedStyle(grid).gap), scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth, tiles: [...grid.querySelectorAll(".home-tile")].map((tile) => {
        const title = tile.querySelector(".home-tile-title"), heading = tile.querySelector(".home-tile-heading");
        const rect = box(tile), headingRect = box(heading);
        return { label: tile.getAttribute("aria-label"), ...rect, titleFits: title.scrollWidth <= title.clientWidth + 1 && headingRect.right <= rect.right && headingRect.bottom <= rect.bottom, visible: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight };
      }) };
    });
    const [feature, upper, lower] = layout.tiles;
    assert.equal(layout.tiles.length, 3);
    assert.ok(layout.tiles.every((tile) => tile.titleFits && tile.visible));
    assert.equal(layout.pageOverflow, false);
    assert.equal(layout.navigation.length, 6);
    assert.deepEqual(layout.navigation.slice(1, -1).map((button) => button.label), ["Home", "Play", "Showcase", "Settings"]);
    for (let a = 0; a < layout.navigation.length; a++) for (let b = a + 1; b < layout.navigation.length; b++) {
      const first = layout.navigation[a], second = layout.navigation[b];
      assert.ok(first.right <= second.x + 0.5 || second.right <= first.x + 0.5 || first.bottom <= second.y + 0.5 || second.bottom <= first.y + 0.5, `Home nav hit boxes overlap: ${first.label}/${second.label}`);
    }
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1);
    near(feature.y, upper.y, "shared top edge");
    near(feature.bottom, lower.bottom, "shared bottom edge");
    near(feature.height, upper.height + lower.height + layout.gap, "stacked right tiles equal left outer height");
    near(upper.x, lower.x, "right-column alignment");
    near(upper.width, lower.width, "right widths");
    near(feature.right + layout.gap, upper.x, "column gap");
    near(upper.bottom + layout.gap, lower.y, "row gap");
    if (viewport.width === 1280) {
      near(layout.grid.width, 600, "Home grid width"); near(layout.grid.height, 434, "Home grid height"); near(layout.gap, 4, "Home grid gap");
      near(feature.width, 298, "feature width"); near(feature.height, 434, "feature height");
      near(upper.width, 298, "upper width"); near(upper.height, 215, "upper height");
      near(lower.width, 298, "lower width"); near(lower.height, 215, "lower height");
    }
    layouts.push({ viewport, ...layout });
  }
  record("Restored 600×434 Home grid matches 298×434 + stacked 298×215 tiles with 4px gaps; equal outer heights, fitting titles and no overflow across three viewports");
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const [key, name] of [["ArrowRight", "Chronicles"], ["ArrowDown", "Herald Board"], ["ArrowLeft", "My Legacy"], ["ArrowRight", "Herald Board"], ["ArrowUp", "Chronicles"], ["ArrowUp", "Chronicles"], ["ArrowRight", "Chronicles"], ["ArrowLeft", "My Legacy"], ["ArrowUp", "My Legacy"], ["ArrowDown", "My Legacy"], ["End", "Herald Board"], ["ArrowDown", "Herald Board"], ["Home", "My Legacy"]]) {
    await page.keyboard.press(key);
    await selected(name);
    assert.equal(await page.locator('.home-tile[tabindex="0"]').count(), 1);
  }
  record("Keyboard spatial movement, remembered right row, clamped outer edges and Home/End retain one selected tab stop and actual focus");

  const limitedDialog = async (name) => {
    await page.getByRole("heading", { name, exact: true }).waitFor();
    const text = await page.locator("dialog").innerText();
    assert.match(text, /unavailable in this build/);
    assert.equal(await page.locator("dialog button").count(), 2, "Home dialog offers close/back only, with no unsupported launch");
    dialogs.push({ title: name, text });
  };
  const showcaseScreen = async () => {
    const options = page.getByRole("region", { name: "Showcase options", exact: true });
    await options.waitFor();
    assert.deepEqual(await options.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["AI Battles", "Arenas", "Match Replays"]);
    assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await page.getByRole("region", { name: "Showcase", exact: true }).locator("video,audio,iframe,form").count(), 0);
  };
  await page.getByRole("button", { name: "Chronicles", exact: true }).hover();
  await selected("Chronicles");
  await page.keyboard.press("Enter");
  await limitedDialog("Chronicles");
  await page.keyboard.press("Escape");
  await closed();
  await selected("Chronicles");
  for (const name of ["Chronicles", "My Legacy", "Herald Board"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await limitedDialog(name);
    await page.getByRole("button", { name: /Back to Home/ }).click();
    await closed();
    await selected(name);
  }
  await page.mouse.move(0, 0);
  record("Pointer hover→Enter and clicks open each truthful limited-state dialog; close/back restore the selected Home tile without fabricated launch, stats or news");

  await page.getByRole("tab", { name: "Showcase", exact: true }).click();
  await showcaseScreen();
  assert.equal(await page.locator(".home-grid").count(), 0);
  assert.equal(await page.locator(".game-cards").count(), 0);
  await page.getByRole("region", { name: "Showcase", exact: true }).getByRole("button", { name: "Back", exact: true }).click();
  await closed();
  await activeTab("Home");
  await selected("Herald Board", false);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY");
  record("Showcase is a dedicated three-destination screen and Back returns to its originating Home selection");

  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await grid(page).waitFor();
  await page.keyboard.press("Escape");
  await activeTab("Home");
  await selected("Herald Board", false);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY", "Settings closes without losing focus to the document body");
  await page.keyboard.press("ArrowUp");
  await selected("Chronicles");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await activeTab("Play");
  await selected("Chapters");
  const returnedPlay = await inspectPlay();
  assert.deepEqual(returnedPlay, initialPlay);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("heading", { name: "Return to Home?", exact: true }).waitFor();
  await page.getByRole("button", { name: /Go to Home/ }).click();
  await closed();
  await activeTab("Home");
  await selected("Chronicles");
  record("Home→Settings returns to Home selection; Home Back returns to preserved Play selection/geometry; Play confirmation returns to Home with focus");

  const pad = async (button, after) => {
    await page.waitForTimeout(400);
    const previousReads = await page.evaluate((index) => { window.__homePadButtons = [index]; return window.__homePadReads; }, button);
    try {
      await page.waitForFunction((reads) => window.__homePadReads > reads, previousReads);
      await page.evaluate(() => { window.__homePadButtons = []; });
      await after();
    } catch (error) {
      console.error("Home controller diagnostic", await page.evaluate(() => ({ activeTab: document.querySelector('.main-nav [aria-selected="true"]')?.getAttribute("aria-label"), dialogOpen: document.querySelector("dialog").open, heading: document.querySelector("dialog h1")?.textContent, focused: document.activeElement?.outerHTML, grid: !!document.querySelector(".settings-grid"), detail: !!document.querySelector(".settings-detail") })));
      throw error;
    } finally {
      await page.evaluate(() => { window.__homePadButtons = []; });
    }
  };
  await page.keyboard.press("Home");
  await selected("My Legacy");
  for (const [button, name] of [[15, "Chronicles"], [13, "Herald Board"], [14, "My Legacy"], [15, "Herald Board"], [12, "Chronicles"], [15, "Chronicles"], [13, "Herald Board"]]) await pad(button, () => selected(name));
  await pad(0, () => limitedDialog("Herald Board"));
  await pad(1, async () => { await closed(); await selected("Herald Board"); });
  await pad(1, async () => { await activeTab("Play"); await selected("Chapters"); });
  await pad(4, async () => { await activeTab("Home"); await selected("Herald Board"); });
  await pad(4, () => grid(page).waitFor());
  await pad(4, showcaseScreen);
  await pad(1, async () => { await closed(); await activeTab("Settings"); await grid(page).waitFor(); });
  await pad(1, async () => { await activeTab("Home"); await selected("Herald Board"); });
  await pad(5, async () => { await activeTab("Play"); await selected("Chapters"); });
  await pad(5, showcaseScreen);
  await pad(1, async () => { await closed(); await activeTab("Play"); await selected("Chapters"); });
  await pad(4, async () => { await activeTab("Home"); await selected("Herald Board"); });
  record("Simulated standard controller supports all four D-pad directions, remembered-row/clamp behavior, A/B dialogs, Home Back and four-tab bumper transitions through Showcase with preserved Home/Play selections");
  await page.keyboard.press("e");
  await activeTab("Play");
  await selected("Chapters");
  await page.keyboard.press("e");
  await showcaseScreen();
  await activeTab("Showcase");
  await page.keyboard.press("e");
  await grid(page).waitFor();
  await openCategory(page, "Video");
  await activeTab("Settings");
  await page.getByRole("combobox", { name: /^Particle Quality$/i }).focus();
  await page.keyboard.press("q");
  await activeTab("Settings");
  await page.keyboard.press("e");
  await activeTab("Settings");
  await leaveSettings(page);
  await activeTab("Play");
  await selected("Chapters");
  await page.keyboard.press("q");
  await activeTab("Home");
  await selected("Herald Board");
  await page.keyboard.press("q");
  await grid(page).waitFor();
  await page.keyboard.press("q");
  await showcaseScreen();
  await activeTab("Showcase");
  await page.getByRole("region", { name: "Showcase", exact: true }).getByRole("button", { name: "Back", exact: true }).click();
  await closed();
  await grid(page).waitFor();
  await page.keyboard.press("Escape");
  await activeTab("Home");
  await selected("Herald Board");
  record("Q/E cycles all four screens, ignores focused selects and preserves originating Home/Play/Settings context");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors");
} catch (error) {
  failure = error;
} finally {
  await writeFile(`${directory}/verification.json`, JSON.stringify({ passed: !failure, scope: "DOM-focused Home verification with model=none, Low quality and reduced motion; actual-GLB visual captures are separate. Controller input is simulated standard Gamepad API input.", checks, layouts, dialogs, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
console.log(`PASS ${checks.length} Home verification groups`);
