#!/usr/bin/env node
// Exercises the DesktopLegacyEnvironment contract on the development harness and writes a
// pass/fail report. Usage (from "main game/"):
//   node scripts/verify-legacy-environment.mjs [--url http://127.0.0.1:5174/] [--quality low]
//     [--out artifacts/legacy-environment/latest/verify.json]
// Checks: contract surface, landmark descriptors and anchors, focus/reset/representative
// framings, orbit nudges, hover and click picking, highlight uniform, state changes (captive
// marker flag, rebuild-free), quality switch (shadow map on medium), reduced motion, pause,
// stats, and that dispose() releases every geometry and texture it created. Rendering here is
// software (SwiftShader): frame timings are NOT representative of real hardware and are not
// checked.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
    return acc;
  }, []),
);
const url = args.url ?? "http://127.0.0.1:5174/";
const quality = args.quality ?? "low";
const outFile = resolve(appRoot, args.out ?? "artifacts/legacy-environment/latest/verify.json");

async function reachable(u) {
  try {
    return (await fetch(u)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(url)) return null;
  const port = new URL(url).port || "5174";
  // Run the local Vite binary directly (not through npx) so kill() stops the server itself.
  const child = spawn(join(appRoot, "node_modules", ".bin", "vite"), ["--port", port, "--strictPort", "--host", "127.0.0.1"], { cwd: appRoot, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(url)) return child;
  }
  child.kill();
  throw new Error(`Vite did not start on ${url}`);
}

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}\n`);
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.setDefaultTimeout(600000);
    await page.goto(`${url}?legacyEnvironment&quality=${quality}&fixture=founded&view=establishing&labels=0`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__bannerhold && window.__bannerhold.env && !window.__bannerhold.env.busy, null, { polling: 500 });
    await page.evaluate(() => window.__bannerhold.ready);
    // Software rendering under load can run at well under one frame per second, so the live
    // loop is paused and frames are stepped explicitly: transitions advance by a fixed dt.
    await page.evaluate(() => window.__bannerhold.env.setPaused(true));
    const step = (dt = 0.4, n = 1) => page.evaluate(({ dt, n }) => { for (let i = 0; i < n; i++) window.__bannerhold.env.renderNow(dt); }, { dt, n });
    const idle = async () => {
      await page.waitForFunction(() => !window.__bannerhold.env.busy || window.__bannerhold.env.rig.transitioning, null, { polling: 250 });
      for (let i = 0; i < 40; i++) {
        const busy = await page.evaluate(() => window.__bannerhold.env.busy);
        if (!busy) break;
        await step(0.4);
      }
      await step(0.05);
    };
    const anchor = (id) => page.evaluate((i) => window.__bannerhold.env.projectLandmark(i), id);

    // 1. Contract surface.
    const methods = ["setState", "focusLandmark", "highlightLandmark", "getLandmarks", "setPaused", "getStats", "dispose", "setQuality", "setReducedMotion", "nudgeOrbit", "resetView", "inspectRepresentative", "projectLandmark", "resize"];
    const missing = await page.evaluate((ms) => ms.filter((m) => typeof window.__bannerhold.env[m] !== "function"), methods);
    record("contract methods present", missing.length === 0, missing.length ? { missing } : `${methods.length} methods`);

    // 2. Landmarks.
    const landmarks = await page.evaluate(() => window.__bannerhold.env.getLandmarks().map((l) => ({ id: l.id, label: l.label })));
    const ids = landmarks.map((l) => l.id).sort();
    record("four landmarks published", ids.join(",") === ["banner-hall", "heralds-station", "muster-grounds", "war-record"].join(","), ids);
    const anchors = {};
    for (const l of landmarks) anchors[l.id] = await anchor(l.id);
    const finite = Object.values(anchors).every((a) => a && Number.isFinite(a.x) && Number.isFinite(a.y));
    const visible = Object.values(anchors).filter((a) => a && a.visible).length;
    record("landmark anchors project at the establishing view", finite && visible >= 3, { visible, anchors });

    // 3. Focus a landmark: it ends up near the middle of the frame.
    await page.evaluate(() => window.__bannerhold.env.focusLandmark("war-record"));
    await idle();
    const focusId = await page.evaluate(() => window.__bannerhold.env.rig.activeId);
    const wr = await anchor("war-record");
    // The anchor is the label point above the landmark, so a close framing puts it high in the
    // frame: require it on screen and horizontally centred, and the camera to have moved.
    const centred = wr && wr.visible && Math.abs(wr.x - 640) < 1280 * 0.25 && wr.y >= 0 && wr.y <= 720 && Math.hypot(wr.x - anchors["war-record"].x, wr.y - anchors["war-record"].y) > 40;
    record("focusLandmark moves to the landmark framing", focusId === "landmark:war-record" && centred, { focusId, anchor: wr });

    // 4. Hover and click picking at the focused landmark's anchor.
    const box = await page.evaluate(() => {
      const r = window.__bannerhold.env.renderer.domElement.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    await page.mouse.move(box.x + wr.x, box.y + wr.y + 30, { steps: 2 });
    await page.mouse.move(box.x + wr.x, box.y + wr.y + 40, { steps: 2 });
    await step(0.016, 2);
    const hovered = await page.evaluate(() => window.__bannerhold.env.hovered);
    const hoverUniform = await page.evaluate(() => window.__bannerhold.env.U.uHighlight.value);
    record("pointer hover picks the landmark and lights it", hovered === "war-record" && hoverUniform === 3, { hovered, uHighlight: hoverUniform });
    // Click selects: the harness answers onLandmarkSelect by focusing that landmark.
    await page.evaluate(() => window.__bannerhold.env.resetView());
    await idle();
    const hall = await anchor("banner-hall");
    await page.mouse.move(box.x + hall.x, box.y + hall.y + 40, { steps: 2 });
    await step(0.016, 2);
    await page.mouse.down();
    await page.mouse.up();
    await step(0.016, 1);
    const selected = await page.evaluate(() => window.__bannerhold.env.rig.activeId);
    record("pointer click selects a landmark (onLandmarkSelect)", selected === "landmark:banner-hall", selected);
    await page.mouse.move(box.x + 6, box.y + 6, { steps: 2 });
    await step(0.016, 2);

    // 5. Highlight driven by UI navigation.
    await page.evaluate(() => window.__bannerhold.env.highlightLandmark("muster-grounds"));
    const hl = await page.evaluate(() => window.__bannerhold.env.U.uHighlight.value);
    await page.evaluate(() => window.__bannerhold.env.highlightLandmark(null));
    const hl0 = await page.evaluate(() => window.__bannerhold.env.U.uHighlight.value);
    record("highlightLandmark sets and clears the shared highlight uniform", hl === 2 && hl0 === 0, { set: hl, cleared: hl0 });

    // 6. Reset view and representative framing.
    await page.evaluate(() => window.__bannerhold.env.resetView());
    await idle();
    const resetId = await page.evaluate(() => window.__bannerhold.env.rig.activeId);
    record("resetView returns to the establishing composition", resetId === "establishing", resetId);
    await page.evaluate(() => window.__bannerhold.env.inspectRepresentative());
    await idle();
    const repId = await page.evaluate(() => window.__bannerhold.env.rig.activeId);
    record("inspectRepresentative moves to the representative framing", repId === "representative", repId);
    await page.evaluate(() => window.__bannerhold.env.resetView());
    await idle();

    // 7. Orbit nudge moves the camera and stays clamped.
    const before = await page.evaluate(() => window.__bannerhold.env.rig.camera.position.toArray());
    await page.evaluate(() => {
      const env = window.__bannerhold.env;
      for (let i = 0; i < 40; i++) env.nudgeOrbit(1, 1, 1);
    });
    await step(0.2, 12);
    const after = await page.evaluate(() => window.__bannerhold.env.rig.camera.position.toArray());
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    const finiteCam = after.every((v) => Number.isFinite(v));
    record("nudgeOrbit moves the camera within limits", moved > 0.5 && finiteCam, { moved: Math.round(moved * 100) / 100 });
    await page.evaluate(() => window.__bannerhold.env.resetView());
    await idle();

    // 8. State changes: the captive fixture raises the captive flag without rebuilding.
    const buildBefore = await page.evaluate(() => window.__bannerhold.env.currentBuild);
    const buildRef = await page.evaluate(() => {
      window.__verifyBuild = window.__bannerhold.env.currentBuild;
      return true;
    });
    void buildBefore;
    void buildRef;
    await page.evaluate(() => window.__bannerhold.setFixture("captive"));
    await idle();
    const captive = await page.evaluate(() => {
      const env = window.__bannerhold.env;
      return { flags: Array.from(env.slots.flags), pawn: env.slots.pawn, sameBuild: env.currentBuild === window.__verifyBuild };
    });
    record("setState applies a captive state without a rebuild", captive.flags.includes("representative-captive") && captive.pawn === 0 && captive.sameBuild, captive);
    await page.evaluate(() => window.__bannerhold.setFixture("founded"));
    await idle();
    const founded = await page.evaluate(() => {
      const env = window.__bannerhold.env;
      return { flags: Array.from(env.slots.flags), pawn: env.slots.pawn };
    });
    record("setState back to founded clears the captive flag", !founded.flags.includes("representative-captive") && founded.pawn === 1, founded);

    // 9. Quality switch: medium turns the shadow map on, low turns it off.
    const qualityState = () => page.evaluate(() => {
      const env = window.__bannerhold.env;
      return { shadows: env.renderer.shadowMap.enabled, shadowType: env.renderer.shadowMap.type, post: !!env.post, quality: env.currentBuild?.quality?.id ?? null, toneMapping: env.renderer.toneMapping };
    });
    await page.evaluate(() => window.__bannerhold.setQuality("medium"));
    await idle();
    const med = await qualityState();
    await page.evaluate(() => window.__bannerhold.setQuality("low"));
    await idle();
    const low = await qualityState();
    // three.js constants: PCFShadowMap = 1, ACESFilmicToneMapping = 4.
    record("setQuality rebuilds per profile (PCF shadows and post on medium, neither on low; ACES)", med.shadows && med.shadowType === 1 && med.post && med.quality === "desktop-medium" && !low.shadows && !low.post && low.quality === "desktop-low" && low.toneMapping === 4, { medium: med, low });

    // 10. Reduced motion and pause.
    await page.evaluate(() => window.__bannerhold.env.setReducedMotion(true));
    const reduced = await page.evaluate(() => window.__bannerhold.env.reduced);
    await page.evaluate(() => window.__bannerhold.env.setReducedMotion(false));
    record("setReducedMotion toggles reduced motion", reduced === true);
    // The loop has been paused since load: time must not advance on its own.
    const t0 = await page.evaluate(() => window.__bannerhold.env.time);
    await page.waitForTimeout(1500);
    const t1 = await page.evaluate(() => window.__bannerhold.env.time);
    record("setPaused stops the loop", t0 === t1, { t0, t1 });

    // 11. Stats.
    const stats = await page.evaluate(() => window.__bannerhold.env.getStats());
    record("getStats reports renderer counts", stats.drawCalls > 0 && stats.triangles > 0 && stats.geometries > 0 && Array.isArray(stats.frameTimesMs), { drawCalls: stats.drawCalls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures });

    // 12. Dispose releases every geometry and texture and removes the canvas.
    const disposed = await page.evaluate(() => {
      const env = window.__bannerhold.env;
      const renderer = env.renderer;
      const canvas = renderer.domElement;
      env.dispose();
      return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, canvasAttached: canvas.isConnected };
    });
    // three.js keeps one module-level 16x16 DFG lookup texture for physically based materials
    // (never disposed by three, shared by every renderer); everything else must be released.
    record("dispose releases GPU resources and the canvas", disposed.geometries === 0 && disposed.textures <= 1 && !disposed.canvasAttached, { ...disposed, note: "one texture may remain: three's shared DFG LUT" });

    record("no page errors", errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  const report = {
    generatedBy: "main game/scripts/verify-legacy-environment.mjs",
    quality,
    note: "Software-rendered (SwiftShader): behaviour checks only; frame timings are not representative and are not checked.",
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    checks,
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  process.stdout.write(`${report.passed}/${checks.length} checks passed — ${outFile}\n`);
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
