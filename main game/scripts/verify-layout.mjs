import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const domOnly = process.env.CROWNFALL_DOM_ONLY === "1";
const target = new URL(origin);
if (domOnly) target.searchParams.set("model", "none");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const checks = [];
const results = [];
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    window.__pressedButtons = [];
    window.__padReads = 0;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        window.__padReads++;
        const pressed = [...window.__pressedButtons];
        window.__pressedButtons = [];
        return [{
        connected: true, mapping: "standard", index: 0,
        axes: [0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({
          pressed: pressed.includes(index),
        })),
      }];
      },
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(target.href);
  await page.evaluate(() => document.fonts.ready);
  if (!domOnly) {
    await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".creature-model")).opacity === "1");
  }

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ));
    const state = await page.locator(".game-cards").evaluate(async (row) => {
      const rect = row.getBoundingClientRect();
      const cards = await Promise.all([...row.querySelectorAll(".game-card")].map(async (card) => {
        const box = card.getBoundingClientRect();
        const art = new Image();
        art.src = getComputedStyle(card.querySelector(".card-art")).backgroundImage.slice(5, -2);
        await art.decode();
        const text = card.querySelector(".card-description");
        const heading = card.querySelector(".card-heading");
        const title = card.querySelector(".card-title");
        const subtitle = card.querySelector(".card-subtitle");
        const headingBox = heading.getBoundingClientRect();
        const textBox = text?.getBoundingClientRect();
        return {
          label: card.getAttribute("aria-label"),
          x: box.x, y: box.y, width: box.width, height: box.height,
          visible: box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= 0 && box.bottom <= innerHeight,
          textFits: !text || (text.scrollHeight <= text.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1),
          headingFits: [title, subtitle].filter(Boolean).every((element) => element.scrollWidth <= element.clientWidth + 1) && headingBox.bottom < (textBox?.top ?? box.bottom) && headingBox.left >= box.left && headingBox.right <= box.right,
          title: title.innerText,
          fontWeight: getComputedStyle(title).fontWeight,
          image: { width: art.naturalWidth, height: art.naturalHeight },
        };
      }));
      return {
        navigation: [...document.querySelectorAll(".main-nav button")].map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { label: button.getAttribute("aria-label"), x, y, right: x + width, bottom: y + height };
        }),
        rowWidth: rect.width,
        scrollableWidth: row.scrollWidth - row.clientWidth,
        scrollSnapType: getComputedStyle(row).scrollSnapType,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        carouselControls: document.querySelectorAll(".card-carousel, .carousel-controls").length,
        actualModelLoaded: !!document.querySelector(".creature-model--loaded"),
        activeAnimation: document.querySelector(".creature-stage").dataset.activeAnimation,
        cards,
      };
    });
    assert.equal(state.cards.length, 4);
    assert.equal(state.navigation.length, 6);
    assert.deepEqual(state.navigation.slice(1, -1).map((button) => button.label), ["Home", "Play", "Showcase", "Settings"]);
    for (let a = 0; a < state.navigation.length; a++) for (let b = a + 1; b < state.navigation.length; b++) {
      const first = state.navigation[a], second = state.navigation[b];
      assert.ok(first.right <= second.x + 0.5 || second.right <= first.x + 0.5 || first.bottom <= second.y + 0.5 || second.bottom <= first.y + 0.5, `Play nav hit boxes overlap: ${first.label}/${second.label}`);
    }
    assert.ok(state.cards.every((card) => card.visible && card.textFits && card.headingFits));
    assert.ok(state.cards.every((card) => card.image.width === 2048 && card.image.height === 1143));
    assert.ok(state.scrollableWidth <= 1);
    assert.equal(state.scrollSnapType, "none");
    assert.equal(state.pageOverflow, false);
    assert.equal(state.carouselControls, 0);
    assert.deepEqual(state.cards.map((card) => card.label), ["Classic", "Local Duel", "Chapters", "Online Duel"]);
    assert.deepEqual(state.cards.map((card) => card.title), ["CLASSIC", "LOCAL DUEL", "CHAPTERS", "ONLINE DUEL"]);
    assert.ok(state.cards.every((card) => card.fontWeight === "600"));
    if (!domOnly) {
      assert.equal(state.actualModelLoaded, true);
      assert.equal(state.activeAnimation, "Idle");
    }
    const screenshot = `artifacts/final-${viewport.width === 844 ? "landscape-" : ""}${viewport.width}x${viewport.height}.png`;
    if (!domOnly) await page.screenshot({ path: screenshot });
    results.push({ viewport, ...(domOnly ? {} : { screenshot }), ...state });
  }
  checks.push("All four supplied images and text fit together at desktop and landscape sizes; no scrolling, carousel controls or page overflow");

  const selected = async (name) => {
    const card = page.getByRole("button", { name, exact: true });
    try {
      await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, name);
    } catch (error) {
      console.error("Focus diagnostic", await page.evaluate(() => ({ focus: document.activeElement?.outerHTML, dialogOpen: document.querySelector("dialog").open, selected: [...document.querySelectorAll('.game-card[aria-pressed="true"]')].map((card) => card.getAttribute("aria-label")) })));
      throw error;
    }
    assert.equal(await card.getAttribute("aria-pressed"), "true");
  };
  await page.keyboard.press("Home");
  await selected("Classic");
  await page.keyboard.press("ArrowLeft");
  await selected("Online Duel");
  await page.keyboard.press("ArrowRight");
  await selected("Classic");
  await page.keyboard.press("End");
  await selected("Online Duel");
  checks.push("Keyboard wraps both ends, Home/End work, and selected card retains actual focus after resize");

  const pad = async (button, name) => {
    await page.waitForTimeout(400);
    const priorReads = await page.evaluate((index) => { window.__pressedButtons = [index]; return window.__padReads; }, button);
    try {
      await page.waitForFunction((reads) => window.__padReads > reads, priorReads);
      await page.evaluate(() => { window.__pressedButtons = []; });
      if (name) await selected(name);
      else if (button === 0) await page.getByRole("heading", { name: "Online Duel" }).waitFor();
      else await page.waitForFunction(() => !document.querySelector("dialog").open);
    } finally {
      await page.evaluate(() => { window.__pressedButtons = []; });
    }
  };
  await pad(15, "Classic");
  await pad(14, "Online Duel");
  await pad(14, "Chapters");
  await pad(15, "Online Duel");
  await pad(0);
  await pad(1);
  await selected("Online Duel");
  checks.push("Simulated standard gamepad D-pad wraps and focuses cards; A/B open and close Online Duel with focus restored");
  assert.deepEqual(errors, []);
  checks.push("No JavaScript or console errors");
  await writeFile("artifacts/layout-verification.json", JSON.stringify({ passed: true, mode: "Four Play modes visible together at original size", domOnly, results, checks, errors }, null, 2) + "\n");
  await writeFile("artifacts/landscape-verification.json", JSON.stringify({ passed: true, mode: "Four Play modes visible together at original size", domOnly, results: results.filter((result) => result.viewport.width === 844), errors }, null, 2) + "\n");
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await browser.close();
}
