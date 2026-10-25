import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
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
      const offenders = [...dialog.querySelectorAll("h1, p, label, button, .empty-state, .save-slot")]
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
    results.push({ viewport, state, ...result });
    if ((viewport.width === 1280 && ["home", "browse"].includes(state)) || (viewport.width === 844 && state === "settings")) {
      await page.locator("dialog").screenshot({ path: `artifacts/copy/${state}-${viewport.width}.png` });
    }
  };
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    // Isolate DOM copy checks from the 3D renderer. Actual-model captures are in verify-layout.
    await page.goto(`${origin}/?model=none`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    for (const [state, role, name] of [
      ["home", "tab", "Home"],
      ["new", "button", "New Gambit"],
      ["resume-empty", "button", "Resume Gambit"],
      ["load-empty", "button", "Load Gambit"],
      ["browse", "button", "Browse Gambits"],
      ["settings", "tab", "Settings"],
      ["back", "button", "Back"],
    ]) {
      await page.getByRole(role, { name, exact: true }).click();
      await page.waitForFunction(() => document.querySelector("dialog").open);
      await inspect(state, viewport);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "New Gambit", exact: true }).click();
    await page.getByLabel("Your name", { exact: true }).fill("Copy Check");
    await page.getByRole("button", { name: /Create demo save/ }).click();
    await page.getByRole("heading", { name: "Resume Gambit", exact: true }).waitFor();
    await inspect("resume-saved", viewport);
    await page.keyboard.press("Escape");
    for (const [state, name] of [["load-saved", "Load Gambit"], ["new-replace", "New Gambit"]]) {
      await page.getByRole("button", { name, exact: true }).click();
      await inspect(state, viewport);
      await page.keyboard.press("Escape");
    }
  }
  await writeFile("artifacts/copy-fit-verification.json", JSON.stringify({ passed: true, scope: "All modal copy in empty/saved/replacement states at desktop and landscape; DOM-only model=none probe. Actual GLB menu renders verified separately.", results }, null, 2) + "\n");
  console.log(`PASS ${results.length} modal copy states: no horizontal overflow or clipped text; honest Crownfall copy; desktop and landscape.`);
} finally {
  await browser.close();
}
