import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
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
  await page.addInitScript(() => {
    window.__pressedButtons = [];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [{
        connected: true,
        axes: [0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({
          pressed: window.__pressedButtons.includes(index),
        })),
      }],
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector(".creature-model")).opacity === "1",
  );

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
        return {
          label: card.getAttribute("aria-label"),
          x: box.x, y: box.y, width: box.width, height: box.height,
          visible: box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= 0 && box.bottom <= innerHeight,
          textFits: text.scrollHeight <= text.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1,
          image: { width: art.naturalWidth, height: art.naturalHeight },
        };
      }));
      return {
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
    assert.ok(state.cards.every((card) => card.visible && card.textFits));
    assert.ok(state.cards.every((card) => card.image.width === 2048 && card.image.height === 1143));
    assert.ok(state.scrollableWidth <= 1);
    assert.equal(state.scrollSnapType, "none");
    assert.equal(state.pageOverflow, false);
    assert.equal(state.carouselControls, 0);
    assert.equal(state.actualModelLoaded, true);
    assert.equal(state.activeAnimation, "Idle");
    const screenshot = `artifacts/final-${viewport.width === 844 ? "landscape-" : ""}${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: screenshot });
    results.push({ viewport, screenshot, ...state });
  }
  checks.push("All four supplied images and text fit together at desktop and landscape sizes; no scrolling, carousel controls or page overflow");

  const selected = async (name) => {
    const card = page.getByRole("button", { name, exact: true });
    await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, name);
    assert.equal(await card.getAttribute("aria-pressed"), "true");
  };
  await page.keyboard.press("Home");
  await selected("New");
  await page.keyboard.press("ArrowLeft");
  await selected("Browse");
  await page.keyboard.press("ArrowRight");
  await selected("New");
  await page.keyboard.press("End");
  await selected("Browse");
  checks.push("Keyboard wraps both ends, Home/End work, and selected card retains actual focus after resize");

  const pad = async (button, name) => {
    await page.waitForTimeout(400);
    await page.evaluate((index) => { window.__pressedButtons = [index]; }, button);
    try {
      if (name) await selected(name);
      else if (button === 0) await page.getByRole("heading", { name: "Beyond the veil." }).waitFor();
      else await page.waitForFunction(() => !document.querySelector("dialog").open);
    } finally {
      await page.evaluate(() => { window.__pressedButtons = []; });
    }
  };
  await pad(15, "New");
  await pad(14, "Browse");
  await pad(14, "Load game");
  await pad(15, "Browse");
  await pad(0);
  await pad(1);
  await selected("Browse");
  checks.push("Simulated standard gamepad D-pad wraps and focuses cards; A/B open and close Browse with focus restored");
  assert.deepEqual(errors, []);
  checks.push("No JavaScript or console errors");
  await writeFile("artifacts/layout-verification.json", JSON.stringify({ passed: true, mode: "Four cards visible together at original size", results, checks, errors }, null, 2) + "\n");
  await writeFile("artifacts/landscape-verification.json", JSON.stringify({ passed: true, mode: "Four cards visible together at original size", results: results.filter((result) => result.viewport.width === 844), errors }, null, 2) + "\n");
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await browser.close();
}
