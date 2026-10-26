import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { openCategory } from "./settings-helpers.mjs";
import { loadingFixtureServer } from "./loading-fixtures.mjs";

const origin = process.env.CROWNFALL_TEST_URL || "http://localhost:5173";
const fixture = await loadingFixtureServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const checks = [], states = [], layouts = [], errors = [], expectedNetworkErrors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
const url = (model) => { const target = new URL(origin); target.searchParams.set("model", model); return target.href; };
const bounded = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not start`)), 20000); })]); }
  finally { clearTimeout(timer); }
};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let failure;
try {
  const createPage = async ({ reducedMotion = "reduce", userMotion = true, expectedFailure = false } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion });
    page.setDefaultTimeout(20000);
    await page.addInitScript((motion) => {
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", motion, volume: 65, renderScale: 50, frameLimit: 60 }));
      window.__loadingPadButtons = [];
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
        const pressed = [...window.__loadingPadButtons]; window.__loadingPadButtons = [];
        return [{ index: 0, mapping: "standard", connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
      } });
    }, userMotion);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") (expectedFailure && /Failed to load resource|ERR_FAILED|404|font|OTS parsing/i.test(message.text()) ? expectedNetworkErrors : errors).push(message.text());
    });
    return page;
  };
  const snapshot = async (page, label) => {
    const state = await page.locator(".loading-screen").evaluate((loader) => ({
      state: loader.dataset.loadingState,
      status: loader.querySelector('[role="status"]')?.textContent,
      value: loader.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
      busy: loader.getAttribute("aria-busy"),
      modelReady: !!document.querySelector(".creature-model--loaded"),
      selectedTab: document.querySelector('.main-nav [aria-selected="true"]')?.getAttribute("aria-label"),
      selectedCard: document.querySelector('.game-card[aria-pressed="true"]')?.getAttribute("aria-label"),
      dialogOpen: document.querySelector("dialog")?.open,
    }));
    states.push({ label, ...state }); return state;
  };
  const stillLoading = async (page, label) => {
    const state = await snapshot(page, label);
    assert.equal(state.state, "loading"); assert.equal(state.busy, "true");
    assert.ok(state.value === null || Number(state.value) < 100, "unfinished work must not be reported as complete");
    assert.ok(state.status?.trim());
    assert.equal(await page.getByRole("tab", { name: "Play", exact: true }).count(), 0, "underlying menu must be hidden from accessibility while loading");
    return state;
  };

  // Hold a Home image that is not on the initial Play screen, plus every font.
  // The gate must preload the full first-use menu, rather than only visible art.
  {
    const page = await createPage({ reducedMotion: "no-preference" });
    const imageGate = deferred(), fontGate = deferred(), imageStarted = deferred(), fontStarted = deferred();
    const images = new Set();
    page.on("response", (response) => { const path = new URL(response.url()).pathname; if (/\/assets\/(home|environments)\//.test(path) && response.ok()) images.add(path); });
    await page.route((address) => address.pathname === "/assets/home/my-legacy.webp", async (route) => { imageStarted.resolve(); await imageGate.promise; await route.continue(); });
    await page.route((address) => /\/fonts\/.*\.ttf$/.test(address.pathname), async (route) => { fontStarted.resolve(); await fontGate.promise; await route.continue(); });
    await page.goto(url("none"), { waitUntil: "domcontentloaded" });
    await bounded(Promise.all([imageStarted.promise, fontStarted.promise]), "initial image/font requests");
    await stillLoading(page, "delayed Home artwork and fonts");
    for (const key of ["q", "ArrowRight", "Enter", "e"]) await page.keyboard.press(key);
    await page.evaluate(() => { window.__loadingPadButtons = [5]; });
    await page.waitForTimeout(400);
    const blocked = await stillLoading(page, "blocked keyboard and controller during boot");
    assert.equal(blocked.selectedTab, "Play"); assert.equal(blocked.selectedCard, "Local Duel"); assert.equal(blocked.dialogOpen, false);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator(".loading-screen").evaluate((element) => {
        const box = element.getBoundingClientRect(), stage = document.querySelector(".menu-stage").getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, overflow: document.documentElement.scrollWidth > innerWidth, clipped: [...element.querySelectorAll("h1,p,button")].filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && (node.scrollWidth > node.clientWidth + 1 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1); }).map((node) => node.textContent.trim()) };
      });
      assert.equal(layout.overflow, false); assert.deepEqual(layout.clipped, []);
      assert.ok(["x", "y", "width", "height"].every((key) => Math.abs(layout[key] - layout.stage[key]) < 1), "loading overlay covers the established landscape menu stage");
      assert.ok(layout.x >= -1 && layout.y >= -1 && layout.x + layout.width <= viewport.width + 1 && layout.y + layout.height <= viewport.height + 1);
      layouts.push({ viewport, ...layout });
    }
    imageGate.resolve();
    await page.waitForResponse((response) => new URL(response.url()).pathname === "/assets/home/my-legacy.webp");
    await stillLoading(page, "artwork ready, fonts still pending");
    await page.evaluate(() => {
      window.__loadingExitStates = [];
      new MutationObserver(() => {
        const loader = document.querySelector(".loading-screen");
        if (loader) window.__loadingExitStates.push({ state: loader.dataset.loadingState, menuInert: !!document.querySelector(".main-nav")?.closest("[inert]") });
      }).observe(document.querySelector(".loading-screen"), { attributes: true, attributeFilter: ["data-loading-state"] });
    });
    fontGate.resolve();
    await waitForBootReady(page, { timeout: 30000 });
    const exits = await page.evaluate(() => window.__loadingExitStates);
    assert.ok(exits.some((state) => state.state === "leaving" && state.menuInert), "normal completion must coordinate its visual exit while retaining the interaction gate");
    states.push({ label: "normal coordinated loading exit", exits });
    assert.deepEqual([...images].filter((path) => !path.includes("card-host")).sort(), ["/assets/environments/card-new.webp", "/assets/environments/card-resume.webp", "/assets/environments/card-load.webp", "/assets/environments/card-browse.webp", "/assets/home/my-legacy.webp", "/assets/home/chronicles.webp", "/assets/home/herald-board.webp"].sort());
    assert.equal(await page.getByRole("tab", { name: "Play", exact: true }).getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("button", { name: "Chapters", exact: true }).getAttribute("aria-pressed"), "true");
    await page.close();
    record("Initial seven images and fonts gate the full menu; loading blocks keyboard/gamepad actions, fits desktop/landscape and enables navigation only after readiness");
  }

  {
    const plan = fixture.plan("known", { texture: true });
    const page = await createPage({ reducedMotion: "no-preference" });
    await page.goto(url(plan.url), { waitUntil: "domcontentloaded" });
    await bounded(plan.started.promise, "known-length model download");
    await page.waitForFunction(() => Number(document.querySelector('.loading-screen [role="progressbar"]')?.getAttribute("aria-valuenow")) > 0);
    const first = await stillLoading(page, "known-length partial model download");
    assert.equal(first.modelReady, false);
    plan.releaseMiddle();
    await page.waitForFunction((value) => Number(document.querySelector('.loading-screen [role="progressbar"]')?.getAttribute("aria-valuenow")) > value, Number(first.value));
    await stillLoading(page, "known-length additional real bytes");
    plan.releaseEnd();
    await bounded(plan.textureStarted.promise, "model texture decode dependency");
    const decoding = await stillLoading(page, "model bytes complete, texture still pending");
    assert.equal(decoding.modelReady, false);
    plan.releaseTexture();
    await waitForBootReady(page, { timeout: 30000 });
    assert.equal(await page.locator(".creature-model--loaded").count(), 1);
    const firstVisiblePose = await page.locator(".creature-stage").evaluate((stage) => ({ model: Number(getComputedStyle(stage.querySelector(".creature-model")).opacity), illustration: Number(getComputedStyle(stage.querySelector(".creature-illustration")).opacity) }));
    assert.equal(firstVisiblePose.model, 1, "normal-mode boot must expose a fully visible first model frame");
    assert.equal(firstVisiblePose.illustration, 0, "illustration must be hidden when the first real model frame is exposed");
    states.push({ label: "normal first-frame handoff opacity", ...firstVisiblePose });
    const canvas = await page.locator(".creature-model canvas").elementHandle();
    const requests = plan.requests;
    await openCategory(page, "Video");
    await page.getByRole("combobox", { name: /^Particle Quality$/i }).selectOption("medium");
    await page.getByRole("combobox", { name: /^Frame Rate Limit$/i }).selectOption("30");
    const scale = page.getByRole("slider", { name: /^Resolution Scale$/i });
    await scale.focus(); await scale.press("End");
    await openCategory(page, "General");
    await page.getByRole("switch", { name: /^Ambient Motion$/i }).click();
    assert.equal(plan.requests, requests, "preferences must not start another model download");
    assert.equal(await canvas.evaluate((node) => node.isConnected && node === document.querySelector(".creature-model canvas")), true);
    assert.equal(await page.locator(".loading-screen").count(), 0, "preferences must not restart boot");
    await page.close();
    record("Known-length progress follows real streamed bytes; complete download waits for texture decode and first rendered mesh; preferences retain the same renderer without model reload or boot restart");
  }

  {
    const plan = fixture.plan("unknown", { knownLength: false });
    const page = await createPage();
    await page.goto(url(plan.url), { waitUntil: "domcontentloaded" });
    await bounded(plan.started.promise, "unknown-length model download");
    await page.waitForFunction(() => document.querySelector('.loading-screen [role="progressbar"]') && !document.querySelector('.loading-screen [role="progressbar"]').hasAttribute("aria-valuenow"));
    const state = await stillLoading(page, "chunked response without Content-Length");
    assert.equal(state.value, null);
    plan.releaseMiddle(); plan.releaseEnd();
    await waitForBootReady(page, { timeout: 30000 });
    assert.equal(await page.locator(".creature-model--loaded").count(), 1);
    await page.close();
    record("A chunked response with no Content-Length stays indeterminate and reaches the real rendered ready state without a fabricated byte percentage");
  }

  {
    const plan = fixture.plan("retry", { hold: false, failed: true });
    const page = await createPage({ expectedFailure: true });
    await page.goto(url(plan.url), { waitUntil: "domcontentloaded" });
    await page.locator('.loading-screen[data-loading-state="degraded"]').waitFor();
    await page.getByRole("button", { name: "Continue to menu", exact: true }).waitFor();
    const degraded = await snapshot(page, "unavailable character file");
    assert.match(degraded.status, /character|model|sorcerer|illustrat/i);
    assert.equal(degraded.busy, "false"); assert.equal(degraded.modelReady, false);
    assert.equal(await page.getByRole("button", { name: "Retry loading", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Continue to menu", exact: true }).count(), 1);
    const attempts = plan.requests;
    plan.failed = false;
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await waitForBootReady(page, { timeout: 30000 });
    assert.equal(plan.requests, attempts + 1, "an explicit retry makes one new model attempt");
    assert.equal(await page.locator(".creature-model--loaded").count(), 1);
    await page.close();
    record("A missing GLB settles into an explained illustrated fallback with Retry/Continue; explicit Retry makes one fresh successful attempt and releases the gate");
  }

  {
    const plan = fixture.plan("continue", { failed: true });
    const page = await createPage({ expectedFailure: true });
    await page.goto(url(plan.url), { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue to menu", exact: true }).waitFor();
    const attempts = plan.requests;
    await page.getByRole("button", { name: "Continue to menu", exact: true }).focus();
    await page.keyboard.press("Enter");
    await waitForBootReady(page, { timeout: 30000 });
    assert.equal(plan.requests, attempts); assert.equal(await page.locator(".creature-illustration--hidden").count(), 0);
    assert.equal(await page.getByRole("tab", { name: "Play", exact: true }).getAttribute("aria-selected"), "true");
    await page.close();
    record("Keyboard activation of Continue uses the illustration and enters the menu without silently retrying or hanging");
  }

  {
    const plan = fixture.plan("slow");
    const page = await createPage();
    await page.clock.install();
    await page.goto(url(plan.url), { waitUntil: "domcontentloaded" });
    await bounded(plan.started.promise, "slow character download");
    await page.clock.fastForward(12050);
    await page.getByRole("button", { name: "Continue to menu", exact: true }).waitFor();
    const slow = await stillLoading(page, "slow transfer with optional Continue");
    assert.match(slow.status, /still preparing|continue/i);
    await page.getByRole("button", { name: "Continue to menu", exact: true }).click();
    await waitForBootReady(page, { timeout: 30000 });
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("button", { name: "Chapters", exact: true }).getAttribute("aria-pressed"), "true");
    plan.releaseMiddle(); plan.releaseEnd();
    await page.locator(".creature-model--loaded").waitFor();
    assert.equal(await page.locator(".loading-screen").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Chapters", exact: true }).getAttribute("aria-pressed"), "true");
    await page.close();
    record("A pending transfer offers optional Continue after its slow-load notice without claiming completion; later background readiness keeps the menu and selection intact (timeout advanced with browser clock)");
  }

  for (const kind of ["image", "font"]) {
    const page = await createPage({ expectedFailure: true });
    const attempted = deferred();
    await page.route((address) => kind === "image" ? address.pathname === "/assets/home/chronicles.webp" : /\/fonts\/.*\.ttf$/.test(address.pathname), async (route) => { attempted.resolve(); await route.abort("failed"); });
    await page.goto(url("none"), { waitUntil: "domcontentloaded" });
    await bounded(attempted.promise, `failed ${kind}`);
    await waitForBootReady(page, { continueOnFailure: true, timeout: 30000 });
    const button = page.getByRole("button", { name: "Local Duel", exact: true });
    assert.equal(await button.isVisible(), true);
    assert.equal(await button.locator(".card-title").evaluate((title) => title.scrollWidth <= title.clientWidth + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
    record(`A failed ${kind} request settles through an explicit fallback path and leaves readable reachable menu controls without an unhandled error`);
  }

  for (const [label, options] of [["OS", { reducedMotion: "reduce" }], ["saved preference", { reducedMotion: "no-preference", userMotion: false }]]) {
    const page = await createPage(options);
    await page.goto(url("none")); await waitForBootReady(page, { timeout: 30000 });
    const start = Date.now();
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator(".loading-screen").count(), 0, "cached reduced-motion boot must not add an artificial minimum wait or exit timer");
    states.push({ label: `cached ${label} reduced-motion reload`, elapsedMs: Date.now() - start });
    await page.close();
  }
  record("Cached intentional model=none boot completes without an artificial minimum wait; both OS and saved reduced motion skip the loading exit delay");
  assert.deepEqual(errors, []);
  record("No unexpected JavaScript or console errors; heavy supplied character model and visual recording are intentionally outside this fixture suite");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/loading", { recursive: true });
  await writeFile("artifacts/loading/verification.json", JSON.stringify({ passed: !failure, scope: "Real HTTP-streamed lightweight valid GLB fixture, controlled image/font failures and model=none menu boot. The supplied heavy GLB is verified separately by the coordinating agent.", target: origin, fixtureBytes: fixture.bodyBytes, checks, states, layouts, errors, expectedNetworkErrors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close(); await fixture.close();
}
if (failure) throw failure;
