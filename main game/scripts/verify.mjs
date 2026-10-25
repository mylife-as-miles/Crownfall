import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
await mkdir("artifacts", { recursive: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  assert.equal(
    await page.locator(".creature-stage").getAttribute("data-active-animation"),
    "Idle",
  );
  await page.locator(".creature-illustration").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".creature-illustration");
    return (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0
    );
  });
  assert.equal(
    await page
      .getByRole("tab", { name: "Play", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Resume", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  const bounds = await page
    .getByRole("button", { name: "Resume", exact: true })
    .boundingBox();
  assert.ok(
    bounds && Math.abs(bounds.x - 340) < 2 && Math.abs(bounds.y - 211) < 2,
    JSON.stringify(bounds),
  );
  results.push("Default Play/Resume selection and reference card positioning");

  const cardBounds = await page.locator(".game-card").evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  assert.equal(
    cardBounds.length,
    4,
    "four cards: New, Resume, Load Game, Browse",
  );
  for (const [index, rect] of cardBounds.entries()) {
    assert.ok(Math.abs(rect.x - (139 + index * 201)) < 1, JSON.stringify(rect));
    assert.ok(
      Math.abs(rect.y - 211) < 1 &&
        Math.abs(rect.width - 197) < 1 &&
        Math.abs(rect.height - 298) < 1,
      JSON.stringify(rect),
    );
  }
  const rowBounds = await page.locator(".game-cards").boundingBox();
  assert.ok(rowBounds && Math.abs(rowBounds.width - 800) < 1);
  assert.equal(await page.locator(".card-carousel, .carousel-controls").count(), 0);
  const fixedRow = await page.locator(".game-cards").evaluate((element) => ({
    overflow: getComputedStyle(element).overflowX,
    scrollableWidth: element.scrollWidth - element.clientWidth,
  }));
  assert.equal(fixedRow.overflow, "visible");
  assert.ok(fixedRow.scrollableWidth <= 1);
  const artworks = await page
    .locator(".card-art")
    .evaluateAll(async (elements) =>
      Promise.all(
        elements.map(async (element) => {
          const source = getComputedStyle(element).backgroundImage.slice(5, -2);
          const image = new Image();
          image.src = source;
          await image.decode();
          return {
            source,
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        }),
      ),
    );
  assert.equal(new Set(artworks.map((art) => art.source)).size, 4);
  assert.ok(artworks.every((art) => art.width === 2048 && art.height === 1143));
  const artworkManifest = JSON.parse(
    await readFile("artifacts/card-artwork.json", "utf8"),
  );
  assert.deepEqual(
    artworkManifest.cards.map((card) => card.sourceFile),
    ["288933.jpg", "288939.jpg", "288943.jpg", "289365.jpg"],
  );
  for (const [index, art] of artworks.entries()) {
    const response = await page.request.get(art.source);
    assert.equal(response.ok(), true);
    assert.equal(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
      artworkManifest.cards[index].deliverySha256,
      "each card loads its assigned supplied-image delivery copy",
    );
  }
  results.push("Four supplied images load in order in the fixed four-card row");

  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("button", { name: "Load game", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Load a journey." }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("dialog").evaluate((element) => element.open),
    false,
  );
  results.push(
    "Arrow navigation, focused Enter activation, Escape and modal closure",
  );

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Visual Tester");
  await page.getByRole("button", { name: /Begin journey/ }).click();
  await page.getByRole("heading", { name: "Your journey awaits." }).waitFor();
  assert.match(await page.locator("dialog").innerText(), /Visual Tester/);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Load game", exact: true }).click();
  assert.match(await page.locator("dialog").innerText(), /Visual Tester/);
  await page.keyboard.press("Escape");
  results.push("Create local demo save and load it after a reload");

  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Particle quality", { exact: false })
    .selectOption("low");
  await page.getByLabel("Ambient motion", { exact: false }).uncheck();
  await page.getByRole("button", { name: /Save & return/ }).click();
  await page.waitForFunction(
    () => !document.querySelector(".mote-field canvas"),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator("#effect-quality").inputValue(), "low");
  assert.equal(await page.locator("#motion-toggle").isChecked(), false);
  await page.keyboard.press("Escape");
  results.push(
    "Quality and motion preferences persist; Low removes WebGL particles",
  );

  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("heading", { name: "Beyond the veil." }).waitFor();
  assert.match(await page.locator("dialog").innerText(), /not available yet/);
  await page.keyboard.press("Escape");
  results.push("Browse opens an honest unavailable state");

  assert.equal(
    await page.getByRole("button", { name: "Host", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Browse", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("button", { name: "New", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page
      .getByRole("button", { name: "Browse", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("End");
  assert.equal(
    await page
      .getByRole("button", { name: "Browse", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  results.push(
    "Host is absent; card navigation wraps at endpoints and Home/End select the first/last option",
  );

  await page.evaluate(() => localStorage.clear());
  await page.mouse.move(0, 0);
  await page.reload();
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "artifacts/final-1280x720.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: "artifacts/final-1920x1080.png" });
  results.push("Reference desktop and 1920px browser renders");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.waitForFunction(
    () => !!document.querySelector(".atmosphere--still"),
  );
  results.push("OS reduced motion honored");

  assert.deepEqual(errors, [], `Browser errors: ${JSON.stringify(errors)}`);
  results.push("No JavaScript or console errors during the menu flow");
  await writeFile(
    "artifacts/verification.json",
    JSON.stringify({ passed: true, checks: results }, null, 2) + "\n",
  );
  console.log(results.map((result) => `PASS ${result}`).join("\n"));
} finally {
  await browser.close();
}
