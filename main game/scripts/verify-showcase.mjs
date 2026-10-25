import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { grid, openCategory, leaveSettings } from "./settings-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], layouts = [], errors = [], artwork = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion: false, volume: 65 }));
    window.__showcasePadButtons = [];
    window.__showcasePadReads = 0;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      window.__showcasePadReads++;
      const pressed = [...window.__showcasePadButtons]; window.__showcasePadButtons = [];
      return [{ index: 0, mapping: "standard", connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
    } });
  });
  const region = () => page.getByRole("region", { name: "Showcase", exact: true });
  const overview = () => page.getByRole("region", { name: "Showcase options", exact: true });
  const gallery = () => page.getByRole("region", { name: "Arena gallery", exact: true });
  const activeTab = async (name) => assert.equal(await page.locator(`.main-nav [role="tab"][aria-label="${name}"]`).getAttribute("aria-selected"), "true");
  const focusName = (name) => page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, name);
  const open = async () => { await page.getByRole("tab", { name: "Showcase", exact: true }).click(); await waitForMenuIdle(page); await overview().waitFor(); };
  const back = async () => { await region().getByRole("button", { name: "Back", exact: true }).click(); await waitForMenuIdle(page); };
  const pad = async (button, after) => {
    // One-frame taps must start after the menu's 350ms A/B repeat guard.
    await page.waitForTimeout(400);
    const reads = await page.evaluate((index) => { window.__showcasePadButtons = [index]; return window.__showcasePadReads; }, button);
    await page.waitForFunction((prior) => window.__showcasePadReads > prior, reads);
    await waitForMenuIdle(page);
    try { await after(); }
    catch (error) {
      console.error("Showcase controller diagnostic", await page.evaluate(() => ({ button: document.activeElement?.getAttribute("aria-label"), tab: document.querySelector('.main-nav [aria-selected="true"]')?.getAttribute("aria-label"), view: document.querySelector(".showcase-screen")?.dataset.showcaseView, reads: window.__showcasePadReads, pending: window.__showcasePadButtons, key: document.querySelector(".menu-transition")?.dataset.viewKey })));
      throw error;
    }
  };
  const noPlayback = async () => {
    assert.equal(await region().locator("video,audio,iframe,form").count(), 0);
    assert.equal(await region().getByRole("button", { name: /^(play|watch|launch|download|load replay)$/i }).count(), 0);
    assert.equal(await page.locator("dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(page.url(), target.href);
  };
  await page.goto(target.href);
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press("ArrowRight"); await focusName("Chapters");
  await open(); await activeTab("Showcase");
  assert.deepEqual(await overview().getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["AI Battles", "Arenas", "Match Replays"]);
  assert.equal(await page.locator(".game-cards,.home-grid,.settings-grid").count(), 0);
  await noPlayback();
  record("Showcase is its own selected screen with three honest overview destinations and no modal or gameplay launch");

  await overview().getByRole("button", { name: "AI Battles", exact: true }).click(); await waitForMenuIdle(page);
  await region().getByRole("heading", { name: "AI Battles", exact: true }).waitFor();
  assert.match(await region().innerText(), /Cinematic AI battle playback is not connected in this build\./);
  await noPlayback();
  await region().getByRole("button", { name: "Explore Arenas", exact: true }).click(); await waitForMenuIdle(page);
  await gallery().waitFor();
  assert.match(await region().innerText(), /Environment artwork preview/);
  await back(); await overview().waitFor();
  await overview().getByRole("button", { name: "Match Replays", exact: true }).click(); await waitForMenuIdle(page);
  await region().getByRole("heading", { name: "Match Replays", exact: true }).waitFor();
  assert.match(await region().innerText(), /Match replays are planned for a future update\./);
  await noPlayback();
  assert.equal(await region().locator("table,video,audio").count(), 0);
  await region().getByRole("button", { name: "Explore Arenas", exact: true }).click(); await waitForMenuIdle(page);
  await gallery().waitFor();
  record("AI Battles and Match Replays disclose their unavailable playback/library states; both genuine Explore Arenas shortcuts open the artwork gallery");

  const manifest = JSON.parse(await readFile("artifacts/card-artwork.json", "utf8"));
  assert.deepEqual(await gallery().getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Arena 01", "Arena 02", "Arena 03", "Arena 04"]);
  for (const [index, name] of ["Arena 01", "Arena 02", "Arena 03", "Arena 04"].entries()) {
    await gallery().getByRole("button", { name, exact: true }).click();
    const images = await region().locator(".showcase-arena-image.is-current").evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => {
      await image.decode();
      return { source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit };
    })));
    const expected = manifest.cards[index];
    const path = `/${expected.deliveryFile.replace(/^public\//, "")}`;
    assert.equal(images.length, 1, `${name}: exactly one full artwork is current`);
    const image = images.find((candidate) => new URL(candidate.source).pathname === path && candidate.fit === "contain");
    assert.ok(image, `${name}: selected full artwork is contained without cropping`);
    const response = await page.request.get(image.source); assert.ok(response.ok());
    assert.equal(createHash("sha256").update(await response.body()).digest("hex"), expected.deliverySha256);
    assert.equal(image.width, 2048); assert.equal(image.height, 1143);
    assert.equal(await gallery().getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
    artwork.push({ name, ...image, sha256: expected.deliverySha256 });
  }
  for (const [key, name] of [["Home", "Arena 01"], ["ArrowUp", "Arena 01"], ["ArrowDown", "Arena 02"], ["ArrowLeft", "Arena 01"], ["End", "Arena 04"], ["ArrowRight", "Arena 04"]]) {
    await page.keyboard.press(key); await focusName(name);
    assert.equal(await gallery().getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal((await region().locator(".showcase-arena-caption h1").innerText()).toLowerCase(), name.toLowerCase());
  }
  await noPlayback();
  record("All four arena selections load the exact supplied environment-artwork hashes at original dimensions and contain the full image without invented arenas or playback");

  await back(); await overview().waitFor();
  await page.keyboard.press("Home"); await focusName("AI Battles");
  await pad(0, () => region().getByRole("heading", { name: "AI Battles", exact: true }).waitFor());
  assert.equal(await region().getByRole("button", { name: "Explore Arenas", exact: true }).evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press("End"); await focusName("Back");
  await pad(1, () => overview().waitFor());
  await pad(0, () => region().getByRole("heading", { name: "AI Battles", exact: true }).waitFor());
  assert.equal(await region().getByRole("button", { name: "Explore Arenas", exact: true }).evaluate((button) => button === document.activeElement), true, "controller reentry resets a previous Back selection to the actual Explore Arenas action");
  await pad(1, () => overview().waitFor());
  await page.keyboard.press("ArrowLeft"); await focusName("AI Battles");
  await page.keyboard.press("ArrowRight"); await focusName("Arenas");
  await page.keyboard.press("End"); await focusName("Match Replays");
  await page.keyboard.press("ArrowDown"); await focusName("Match Replays");
  await page.keyboard.press("Home"); await focusName("AI Battles");
  await pad(15, () => focusName("Arenas"));
  await pad(0, () => gallery().waitFor());
  await pad(1, () => overview().waitFor());
  await focusName("Arenas");
  await pad(1, async () => { await activeTab("Play"); await focusName("Chapters"); });
  record("Keyboard first/last and arrow navigation plus controller D-pad/A/B move between overview, gallery and preserved Play focus");

  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.keyboard.press("End"); await focusName("Herald Board");
  await open(); await back(); await activeTab("Home"); await focusName("Herald Board");
  await openCategory(page, "Video");
  await page.keyboard.press("e"); // Select-focused guards are covered elsewhere; this row is the detail's focused div.
  await waitForMenuIdle(page);
  await activeTab("Home");
  await openCategory(page, "Video");
  await page.keyboard.press("q"); await waitForMenuIdle(page); await overview().waitFor();
  await back(); await activeTab("Settings");
  await page.locator(".settings-detail--video").waitFor();
  await leaveSettings(page); await activeTab("Home"); await focusName("Herald Board");
  record("Showcase Back remembers Home/Play and Settings detail origins without creating a Settings/Showcase back loop");

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await open();
    for (const view of ["overview", "AI Battles", "Arenas", "Match Replays"]) {
      if (view !== "overview") { await overview().getByRole("button", { name: view, exact: true }).click(); await waitForMenuIdle(page); }
      const layout = await region().evaluate((element) => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...element.querySelectorAll("h1,h2,p,button")].filter((node) => {
          const box = node.getBoundingClientRect(); return box.width && (node.scrollWidth > node.clientWidth + 1 || box.left < -1 || box.right > innerWidth + 1);
        }).map((node) => node.getAttribute("aria-label") || node.textContent.trim()),
        backReachable: [...element.querySelectorAll("button")].some((node) => { const box = node.getBoundingClientRect(); return node.getAttribute("aria-label") === "Back" && box.top >= 0 && box.bottom <= innerHeight; }),
      }));
      assert.equal(layout.overflow, false); assert.deepEqual(layout.clipped, []); assert.equal(layout.backReachable, true);
      layouts.push({ viewport, view, ...layout });
      if (view !== "overview") { await back(); await overview().waitFor(); }
    }
    await back();
  }
  record("Overview, both library empty states and arena gallery keep readable text, reachable Back controls and no horizontal overflow on desktop and landscape");
  assert.deepEqual(errors, []);
  record("No JavaScript or console errors; Showcase never starts a game, fabricates a replay or changes the current URL");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/showcase", { recursive: true });
  await writeFile("artifacts/showcase/verification.json", JSON.stringify({ passed: !failure, scope: "DOM-only model=none Showcase screen, supplied-artwork gallery, honest unavailable playback states, origin/focus navigation and simulated standard controller.", checks, artwork, layouts, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
