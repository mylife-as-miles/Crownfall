import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { chapterGrid, chaptersRegion, chapterName } from "./chapters-helpers.mjs";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const domOnly = process.env.CROWNFALL_DOM_ONLY === "1";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await mkdir("artifacts/copy", { recursive: true });
  const inspect = async (state, viewport) => {
    const result = await page.locator("dialog").evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      const offenders = [...dialog.querySelectorAll("h1, p, label, button, .empty-state")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (element.scrollWidth > element.clientWidth + 1 || rect.left < box.left || rect.right > box.right);
        })
        .map((element) => element.textContent.trim());
      return {
        text: dialog.innerText,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
        verticalScrollAvailable: dialog.scrollHeight > dialog.clientHeight + 1,
        offenders,
      };
    });
    assert.equal(result.horizontalOverflow, false, `${state}: dialog overflow`);
    assert.deepEqual(result.offenders, [], `${state}: clipped text`);
    assert.doesNotMatch(result.text, /EXAMPLE|Fallen Crown|journey|other worlds/i);
    if (["classic", "local", "online", "chapter-01", "chapter-02"].includes(state)) {
      assert.match(result.text, /not(?: yet)? (?:connected|available)|unavailable/i);
      if (state.startsWith("chapter-")) assert.match(result.text, /chapter-selection preview.*progress and unlocks are not recorded/is);
      else assert.match(result.text, /no gameplay will start here/i);
      assert.equal(await page.locator("dialog input, dialog form, dialog .save-slot").count(), 0);
      assert.equal(await page.locator("dialog button").count(), 2);
    }
    results.push({ viewport, state, ...result });
    if (!domOnly && ((viewport.width === 1280 && ["chronicles", "online"].includes(state)) || (viewport.width === 844 && state === "settings"))) {
      await page.locator("dialog").screenshot({ path: `artifacts/copy/${state}-${viewport.width}.png` });
    }
  };
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    // Isolate DOM copy checks from the 3D renderer. Actual-model captures are in verify-layout.
    await page.goto(`${origin}/?model=none`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitForBootReady(page);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    // My Legacy opens its own screen rather than a dialog; its copy is checked by verify-legacy.mjs.
    for (const [state, name] of [["chronicles", "Chronicles"], ["herald", "Herald Board"]]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForFunction(() => document.querySelector("dialog").open);
      await inspect(state, viewport);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("tab", { name: "Play", exact: true }).click();
    for (const [state, role, name] of [
      ["classic", "button", "Classic"],
      ["local", "button", "Local Duel"],
      ["online", "button", "Online Duel"],
      ["back", "button", "Back"],
    ]) {
      await page.getByRole(role, { name, exact: true }).click();
      await page.waitForFunction(() => document.querySelector("dialog").open);
      await inspect(state, viewport);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
    await chapterGrid(page).waitFor();
    for (const number of [1, 2]) {
      await chapterGrid(page).getByRole("button", { name: chapterName(number), exact: true }).click();
      await page.getByRole("heading", { name: chapterName(number), exact: true }).waitFor();
      await inspect(`chapter-0${number}`, viewport);
      await page.keyboard.press("Escape");
    }
    await chaptersRegion(page).getByRole("button", { name: "Back", exact: true }).click();
  }
  await writeFile("artifacts/copy-fit-verification.json", JSON.stringify({ passed: true, domOnly, scope: "Three mode previews, two chapter previews, the Chronicles and Herald Board panels and Back at desktop and landscape. My Legacy is a destination screen verified by verify-legacy.mjs. Settings, Showcase and Chapters have dedicated screen verification. DOM-only model=none probe; actual GLB menu renders verified separately.", results }, null, 2) + "\n");
  console.log(`PASS ${results.length} modal copy states: no horizontal overflow or clipped text; truthful Home panel and mode-preview copy; desktop and landscape.`);
} finally {
  await browser.close();
}
