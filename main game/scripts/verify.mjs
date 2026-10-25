import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const domOnly = process.env.CROWNFALL_DOM_ONLY === "1";
const target = new URL(origin);
if (domOnly) target.searchParams.set("model", "none");
const modes = ["Classic", "Local Duel", "Chapters", "Online Duel"];
const saveKey = "crownfall.main-game.save";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
await mkdir("artifacts", { recursive: true });
const results = [];
const previews = [];
const record = (check) => { results.push(check); console.log(`PASS ${check}`); };
const errors = [];
let failure;
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    ...(domOnly ? { reducedMotion: "reduce" } : {}),
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(target.href);
  await page.evaluate(() => document.fonts.ready);
  if (!domOnly) {
    await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
    assert.equal(await page.locator(".creature-stage").getAttribute("data-active-animation"), "Idle");
  }
  await page.waitForFunction(() => {
    const image = document.querySelector(".creature-illustration");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  assert.equal(await page.getByRole("tab", { name: "Play", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("button", { name: "Local Duel", exact: true }).getAttribute("aria-pressed"), "true");
  const bounds = await page.getByRole("button", { name: "Local Duel", exact: true }).boundingBox();
  assert.ok(bounds && Math.abs(bounds.x - 340) < 2 && Math.abs(bounds.y - 211) < 2, JSON.stringify(bounds));
  record("Default Play/Local Duel selection and reference card positioning");

  assert.deepEqual(await page.getByRole("tab").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))), ["Home", "Play", "Settings"]);
  assert.equal(await page.locator(".nav-notification").count(), 0);
  await page.keyboard.press("q");
  await page.getByRole("region", { name: "Home options", exact: true }).waitFor();
  assert.equal(await page.locator("dialog").evaluate((element) => element.open), false);
  await page.getByRole("tab", { name: "Play", exact: true }).click();
  await page.keyboard.press("e");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.match(await page.locator("dialog").innerText(), /audio is not connected/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("heading", { name: "Return to Home?", exact: true }).waitFor();
  await page.getByRole("button", { name: /Go to Home/ }).click();
  await page.getByRole("region", { name: "Home options", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Play options", exact: true }).waitFor();
  record("Home/Play/Settings navigation, tab shortcuts and Back return to the correct screen");

  const cardBounds = await page.locator(".game-card").evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const title = element.querySelector(".card-title");
    return { label: element.getAttribute("aria-label"), title: title.innerText, weight: getComputedStyle(title).fontWeight, color: getComputedStyle(title).color, x, y, width, height };
  }));
  assert.deepEqual(cardBounds.map((card) => card.label), modes);
  assert.deepEqual(cardBounds.map((card) => card.title), ["CLASSIC", "LOCAL DUEL", "CHAPTERS", "ONLINE DUEL"]);
  assert.ok(cardBounds.every((card) => card.weight === "600" && !/story|gambit/i.test(card.title)));
  assert.equal(cardBounds[1].color, "rgb(191, 121, 26)");
  cardBounds.forEach((card, index) => {
    assert.ok(Math.abs(card.x - (139 + index * 201)) < 1, JSON.stringify(card));
    assert.ok(Math.abs(card.y - 211) < 1 && Math.abs(card.width - 197) < 1 && Math.abs(card.height - 298) < 1, JSON.stringify(card));
  });
  const rowBounds = await page.locator(".game-cards").boundingBox();
  assert.ok(rowBounds && Math.abs(rowBounds.width - 800) < 1);
  assert.equal(await page.locator(".card-carousel, .carousel-controls").count(), 0);
  const fixedRow = await page.locator(".game-cards").evaluate((element) => ({ overflow: getComputedStyle(element).overflowX, scrollableWidth: element.scrollWidth - element.clientWidth }));
  assert.equal(fixedRow.overflow, "visible");
  assert.ok(fixedRow.scrollableWidth <= 1);
  const artworks = await page.locator(".card-art").evaluateAll(async (elements) => Promise.all(elements.map(async (element) => {
    const source = getComputedStyle(element).backgroundImage.slice(5, -2);
    const image = new Image(); image.src = source; await image.decode();
    return { source, width: image.naturalWidth, height: image.naturalHeight };
  })));
  assert.equal(new Set(artworks.map((art) => art.source)).size, 4);
  assert.ok(artworks.every((art) => art.width === 2048 && art.height === 1143));
  const manifest = JSON.parse(await readFile("artifacts/card-artwork.json", "utf8"));
  assert.deepEqual(manifest.cards.map((card) => card.sourceFile), ["288933.jpg", "288939.jpg", "288943.jpg", "289365.jpg"]);
  for (const [index, art] of artworks.entries()) {
    const response = await page.request.get(art.source);
    assert.ok(response.ok());
    assert.equal(createHash("sha256").update(await response.body()).digest("hex"), manifest.cards[index].deliverySha256);
  }
  record("Four mode labels, bold amber/gray typography, original geometry and supplied-artwork fingerprints are correct");

  await page.keyboard.press("ArrowRight");
  const chapters = page.getByRole("button", { name: "Chapters", exact: true });
  assert.equal(await chapters.getAttribute("aria-pressed"), "true");
  assert.equal(await chapters.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Chapters", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").evaluate((element) => element.open), false);
  record("Arrow navigation, focused Enter activation, Escape and modal closure work for the new modes");

  const initialSave = await page.evaluate((key) => localStorage.getItem(key), saveKey);
  assert.equal(initialSave, null, "fresh context has no legacy demo save");
  for (const name of modes) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    const text = await page.locator("dialog").innerText();
    assert.match(text, /not(?: yet)? (?:connected|available)|unavailable/i);
    assert.match(text, /no gameplay will start here/i);
    assert.equal(await page.locator("dialog button").count(), 2, "mode previews offer only close and back");
    assert.equal(await page.locator("dialog input, dialog form, dialog .save-slot").count(), 0);
    assert.equal(page.url(), target.href, "a preview does not navigate into a game");
    previews.push({ mode: name, text });
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), saveKey), initialSave);
  }
  assert.equal(await page.getByRole("button", { name: "New Gambit", exact: true }).count(), 0);
  record("All four mode previews truthfully disclose unavailable gameplay and offer no launch or demo-save form");

  const legacySave = JSON.stringify({ name: "Existing record", chapter: "Legacy demo", updatedAt: "2026-01-01T00:00:00.000Z" });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: saveKey, value: legacySave });
  await page.reload();
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await page.getByRole("heading", { name: "Classic", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), saveKey), legacySave, "mode previews neither create nor overwrite legacy save data");
  record("Mode activation and reload have no local-demo-save creation, restoration or overwrite side effects");

  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Particle quality", { exact: false }).selectOption("low");
  await page.getByLabel("Ambient motion", { exact: false }).uncheck();
  await page.getByRole("button", { name: /Back to Play/ }).click();
  await page.waitForFunction(() => !document.querySelector(".mote-field canvas"));
  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator("#effect-quality").inputValue(), "low");
  assert.equal(await page.locator("#motion-toggle").isChecked(), false);
  await page.keyboard.press("Escape");
  record("Quality and motion preferences persist; Low releases the particle renderer");

  assert.equal(await page.getByRole("button", { name: "Host", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Online Duel", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("button", { name: "Classic", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getByRole("button", { name: "Online Duel", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("button", { name: "Online Duel", exact: true }).getAttribute("aria-pressed"), "true");
  record("Mode navigation wraps correctly; Home/End select the endpoints without an added Host or Story card");

  await page.evaluate(() => localStorage.clear());
  await page.mouse.move(0, 0);
  await page.reload();
  if (!domOnly) {
    await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "artifacts/final-1280x720.png" });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: "artifacts/final-1920x1080.png" });
    record("Actual-model reference desktop and 1920px browser renders");
  }
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Ambient motion", { exact: false }).check();
  assert.equal(await page.locator("#motion-toggle").isChecked(), true);
  await page.getByRole("button", { name: /Back to Play/ }).click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => !document.querySelector(".atmosphere--still"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !!document.querySelector(".atmosphere--still"));
  record("OS reduced motion is honored independently of saved preferences");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors during the menu flow");
} catch (error) {
  failure = error;
} finally {
  await writeFile("artifacts/verification.json", JSON.stringify({ passed: !failure, domOnly, checks: results, previews, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
