import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { waitForBootReady } from "./boot-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";

const directory = "artifacts/creature-motion";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 960, height: 540 },
    reducedMotion: "no-preference",
    recordVideo: { dir: "/tmp/crownfall-creature-motion", size: { width: 960, height: 540 } },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: true, renderScale: 50, frameLimit: 30 })));
  await page.goto(process.env.CROWNFALL_TEST_URL || "http://localhost:4173");
  await waitForBootReady(page);
  await page.locator('.creature-stage[data-active-animation="Idle"]').waitFor();
  // Leave the menu untouched through more than two complete authored loops.
  await page.waitForTimeout(6800);
  for (const label of ["Home", "Showcase", "Settings", "Play"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await waitForMenuIdle(page);
    await page.waitForTimeout(1000);
  }
  await page.getByRole("button", { name: "Chapters", exact: true }).click();
  await waitForMenuIdle(page);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await waitForMenuIdle(page);
  await page.waitForTimeout(1800);
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const encoded = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "32", "-b:v", "0", "-an", `${directory}/menu-idle.webm`], { encoding: "utf8" });
  if (encoded.status !== 0) throw new Error(encoded.stderr);

  const stills = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "no-preference" });
  stills.on("pageerror", (error) => errors.push(error.message));
  await stills.addInitScript(() => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "high", motion: true, renderScale: 100, frameLimit: 30 })));
  await stills.goto(process.env.CROWNFALL_TEST_URL || "http://localhost:4173");
  await waitForBootReady(stills);
  const captures = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await stills.setViewportSize(viewport);
    await stills.waitForFunction(() => {
      const indicator = document.querySelector(".nav-active-indicator").getBoundingClientRect();
      const selected = document.querySelector('.nav-item[aria-selected="true"]').getBoundingClientRect();
      return Math.abs(indicator.x - selected.x) < 0.5 && Math.abs(indicator.width - selected.width) < 0.5;
    });
    for (const pose of ["a", "b"]) {
      await stills.waitForTimeout(800);
      const path = `${directory}/idle-${pose}-${viewport.width}x${viewport.height}.png`;
      await stills.screenshot({ path });
      captures.push({ path, viewport });
      console.log(path);
    }
  }
  await stills.close();
  await writeFile(`${directory}/captures.json`, `${JSON.stringify({ recording: `${directory}/menu-idle.webm`, captures, errors, rendering: "Actual supplied GLB, authored Idle at 1x and approved parent sway. Full untrimmed recording at 960x540 uses Low particles, 50% scene resolution and a 30fps scene cap for software capture. Static pairs use High particles, 100% scene resolution, motion enabled. No target-device frame-rate claim." }, null, 2)}\n`);
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
