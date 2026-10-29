// Screenshots of the desktop My Legacy screen for review: founding steps, the
// Bannerhold overview, every landmark panel, aftermath, development previews
// and recovery, at 1280×720, 844×390 and 1920×1080.
//   node scripts/capture-legacy.mjs [--out artifacts/legacy/latest]
// Development previews are fixture data and are labelled as such on screen.
// WebGL here is software-rendered (SwiftShader); captures show layout and
// state, not GPU image quality or frame timing.
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";

const outIndex = process.argv.indexOf("--out");
const directory = outIndex !== -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : "artifacts/legacy/latest";
const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const captures = [];
const errors = [];
let environment = "unknown";
await mkdir(directory, { recursive: true });

function address(params) {
  const target = new URL(origin);
  target.searchParams.set("model", "none");
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.href;
}

async function open(viewport, params = {}, storage = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("__legacySeeded")) return;
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "high", motion: false, volume: 65 }));
    for (const [name, value] of Object.entries(seed)) localStorage.setItem(name, value);
    sessionStorage.setItem("__legacySeeded", "1");
  }, storage);
  await page.goto(address(params));
  await waitForBootReady(page);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.locator('.legacy-screen[data-environment-ready="true"]').waitFor({ timeout: 90000 });
  environment = await page.locator(".legacy-screen").getAttribute("data-environment");
  return { context, page };
}

async function shot(page, name, note) {
  // Two frames so labels and the scene settle after the last state change.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(250);
  const viewport = page.viewportSize();
  const path = `${directory}/${viewport.width}x${viewport.height}-${name}.png`;
  await page.screenshot({ path });
  captures.push({ path, viewport, note });
  console.log(path);
}

async function panel(page, id) {
  await page.locator(`.legacy-label[data-landmark="${id}"]`).click();
  await page.locator(`[data-landmark-panel="${id}"]`).waitFor();
}

async function closePanel(page) {
  await page.keyboard.press("Escape");
  await page.locator("[data-landmark-panel]").waitFor({ state: "detached" });
}

async function deferAftermath(page) {
  if (await page.locator(".legacy-aftermath").count()) {
    await page.keyboard.press("Escape");
    await page.locator(".legacy-aftermath").waitFor({ state: "detached" });
  }
}

try {
  // Founding ceremony (guest session, so nothing is saved by the capture).
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
    const { context, page } = await open(viewport, { legacy: "fresh" });
    const card = page.locator(".legacy-founding");
    await page.locator('[data-nation="aethelgard"]').click();
    await shot(page, "founding-1-nation", "Founding: nation choice with identity copy and availability; the holding behind previews the draft");
    await card.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator("#legacy-banner-name").fill("House Thornbury");
    await shot(page, "founding-2-name", "Founding: typed banner name with validation, Suggest and quick suggestions");
    await card.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator("#legacy-arms-ordinary").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await shot(page, "founding-3-arms", "Founding: heraldry rows with the live 2D preview, blazon and herald's advice; the 3D banner updates live");
    await card.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator("#legacy-banner-motto").fill("Root and stone endure");
    await shot(page, "founding-4-raise", "Founding: review with motto and the three sworn members");
    if (viewport.width === 1280) {
      await card.getByRole("button", { name: "Raise the banner", exact: true }).click();
      await page.locator("dialog.legacy-dialog[open]").waitFor();
      await shot(page, "founding-5-confirm", "Founding: confirmation (guest wording)");
      // The beat lasts 1.6 s with reduced motion, shorter than a software-rendered screenshot takes here,
      // so its timer is lengthened for this capture only; the beat is then dismissed with a click, as a player can.
      await page.evaluate(() => {
        const original = window.setTimeout;
        window.__restoreTimeout = () => { window.setTimeout = original; };
        window.setTimeout = (handler, delay, ...rest) => original(handler, delay === 1600 || delay === 2600 ? 60000 : delay, ...rest);
      });
      await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Raise the banner/ }).click();
      await page.locator(".legacy-beat").waitFor();
      await page.evaluate(() => window.__restoreTimeout());
      await shot(page, "founding-6-beat", "The banner-raising beat (reduced-motion still), held on screen for this capture; it lasts 1.6 s with reduced motion and 2.6 s otherwise");
      await page.locator(".legacy-beat").click();
      await page.locator(".legacy-beat").waitFor({ state: "detached" });
      await shot(page, "overview-fresh", "Bannerhold overview straight after founding: landmark labels as DOM buttons over the scene");
      for (const id of ["banner-hall", "muster-grounds", "war-record", "heralds-station"]) {
        await panel(page, id);
        await shot(page, `panel-${id}`, `Inspection panel: ${id}`);
        await closePanel(page);
      }
      await panel(page, "heralds-station");
      await page.locator("[data-accept]").click();
      await page.locator("dialog.legacy-dialog[open]").waitFor();
      await shot(page, "heralds-accept", "Accepting the formal challenge restates the wager");
      await page.locator("dialog.legacy-dialog[open]").getByRole("button", { name: /Accept the challenge/ }).click();
      await page.locator("[data-awaiting-board]").waitFor();
      await shot(page, "heralds-awaiting", "After acceptance: the truthful Awaiting the board state");
    }
    await context.close();
  }

  // Development previews (fixture data run through the real rules; labelled on screen).
  const previews = [
    { id: "captive", viewports: [{ width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }], panels: ["muster-grounds", "war-record"] },
    { id: "returned", viewports: [{ width: 1280, height: 720 }], panels: ["muster-grounds"] },
    { id: "injured", viewports: [{ width: 1280, height: 720 }], panels: ["muster-grounds"] },
    { id: "promoted", viewports: [{ width: 1280, height: 720 }], panels: ["muster-grounds"] },
    { id: "allied-loss", viewports: [{ width: 1280, height: 720 }], panels: ["heralds-station"] },
    { id: "rival-grievance", viewports: [{ width: 1280, height: 720 }], panels: ["heralds-station"] },
    { id: "classic-capture", viewports: [{ width: 1280, height: 720 }], panels: ["war-record"] },
    { id: "honoured", viewports: [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }], panels: ["banner-hall", "war-record"] },
    { id: "founded-kwind-09", viewports: [{ width: 1280, height: 720 }], panels: ["muster-grounds"] },
  ];
  for (const preview of previews) {
    for (const viewport of preview.viewports) {
      const { context, page } = await open(viewport, { legacyPreview: preview.id });
      if (await page.locator(".legacy-aftermath").count()) await shot(page, `preview-${preview.id}-aftermath`, `Development preview "${preview.id}": at most two aftermath messages`);
      await deferAftermath(page);
      await shot(page, `preview-${preview.id}-overview`, `Development preview "${preview.id}": overview`);
      for (const id of preview.panels) {
        await panel(page, id);
        await shot(page, `preview-${preview.id}-${id}`, `Development preview "${preview.id}": ${id}`);
        await closePanel(page);
      }
      await context.close();
    }
  }

  // Recovery and an unknown preview id.
  {
    const { context, page } = await open({ width: 1280, height: 720 }, {}, { "crownfall.legacy.save": "{\"schemaVersion\":1,\"banner\":" });
    await shot(page, "recovery-corrupt", "Unreadable save: recovery panel; the stored record is left untouched");
    await context.close();
  }
  {
    const { context, page } = await open({ width: 844, height: 390 }, {}, { "crownfall.legacy.save": JSON.stringify({ schemaVersion: 99 }) });
    await shot(page, "recovery-future", "Save from a newer schema: refused and left untouched");
    await context.close();
  }
  {
    const { context, page } = await open({ width: 1280, height: 720 }, { legacyPreview: "unknown-preview" });
    await shot(page, "preview-missing", "Unknown development preview id: the real previews are listed");
    await context.close();
  }
} finally {
  await writeFile(`${directory}/captures.json`, JSON.stringify({
    environment,
    rendering: "Chromium headless with software WebGL (SwiftShader), High quality preset, OS reduced motion. Captures show layout and state, not GPU image quality or frame timing.",
    disclosure: environment === "stand-in"
      ? "The 3D scene is the gameplay workflow's labelled environment stand-in, not the Bannerhold environment."
      : "The 3D scene is the environment workflow's Bannerhold renderer.",
    previews: "Development previews are fixture match records run through the real Legacy rules (mode preview) and are labelled on screen. Founding captures use ?legacy=fresh guest sessions; nothing was saved.",
    captures,
    errors,
  }, null, 2) + "\n");
  await browser.close();
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(`${captures.length} captures in ${directory} (environment: ${environment})`);
