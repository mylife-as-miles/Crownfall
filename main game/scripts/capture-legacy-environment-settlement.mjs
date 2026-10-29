#!/usr/bin/env node
// Captures the production nation's settlement fabric, terrain and outer territory (Korvenia) in
// the environment harness: the establishing framing plus development close-ups defined here
// (district streets, the artisan yards, fortifications, the gate road looking out, the valley,
// fields and the distant skyline). The close-ups are development framings, not shipped cameras.
// Usage (from "main game/"):
//   node scripts/capture-legacy-environment-settlement.mjs [--out artifacts/legacy-environment]
//     [--prefix settlement] [--url http://127.0.0.1:5176/] [--quality medium,high,low]
//     [--views establishing,st:lantern-west,...] [--fixture founded] [--post 1]
//     [--width 1600] [--height 900] [--tier 0..3]
// Writes <prefix>-<quality>-<view>.png and <prefix>-metrics.json. Starts Vite on the URL's
// port when nothing answers there. Rendering here is software (SwiftShader): frame timings
// are NOT representative of real hardware; draw calls and triangles are.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Development framings: [id, label, target, camera position, vertical fov].
export const SETTLEMENT_FRAMINGS = [
  ["st:lantern-west", "Lantern Street from Gate Street, looking east", [26, 0.2, 22.5], [-10, 3.6, 18.2], 52],
  ["st:lantern-east", "Lantern Street from the bend, looking west", [18, 0.2, 21.5], [57.5, 1.6, 29.2], 52],
  ["st:well-square", "Well Square: the well, the shrine and the bench", [16, -1.6, 25.4], [5.5, 1.2, 20.0], 54],
  ["st:rock-lane", "Rock Lane under the court's retaining wall", [6, 2.6, -8.5], [37, 2.4, -4.2], 50],
  ["st:wall-lane", "Wall Lane cottages by the south wall", [4, -2.8, 37.5], [44, 0.2, 41.5], 50],
  ["st:yards", "Back yards behind Lantern Street", [20, -1.2, 5.6], [36, 9, -6], 50],
  ["st:forge-yards", "Forge and granary yards", [-30, -1.5, 31], [-12, 13, 13], 50],
  ["st:smithy", "The smithy's forge front", [-35.5, 0.2, 26.2], [-26.5, 2.2, 21.6], 52],
  ["st:granary", "Tithe granary on its staddle stones and the barn", [-33, 0.5, 37], [-20, 5, 44], 52],
  ["st:gate-road-out", "The gate road looking out over the valley", [-150, -8, 120], [-57, 12, 20.5], 46],
  ["st:capital-view", "From the West Gate toward the capital", [-1400, 120, -1300], [-60, 16, 16.5], 34],
  ["st:valley-approach", "The valley road below the holding", [-28, 12, -14], [-146, 0.8, 131], 42],
  ["st:watchtower", "The repaired watchtower over the ravine", [46, 5, 44], [76, 2.5, 76], 44],
  ["st:breach", "The old breach above the ravine", [50.5, 1, -13.5], [80, 0.5, -24], 46],
  ["st:north-curtain", "The north curtain and burnt tower under the crags", [-6, 10, -61], [8, 34, -104], 46],
  ["st:bridge-mill", "The brook bridge and the mill", [-138, -8, 131], [-112, -2.5, 110], 50],
  ["st:fields", "Strip fields, hedge and the moved boundary stone", [-150, 1, 34], [-98, 12, 12], 46],
  ["st:panorama-nw", "Layered distance to the north-west", [-900, 40, -700], [-64, 46, 64], 40],
  ["st:ravine", "The ravine stream and the washing path", [76, -12, 14], [96, -3, 66], 50],
];

const out = resolve(appRoot, args.out ?? "artifacts/legacy-environment");
const prefix = args.prefix ?? "settlement";
const url = args.url ?? "http://127.0.0.1:5176/";
const qualities = (args.quality ?? "medium").split(",");
const views = (args.views ?? ["establishing", ...SETTLEMENT_FRAMINGS.map((f) => f[0]), "district:road"].join(",")).split(",");
const fixture = args.fixture ?? "founded";
const width = Number(args.width ?? 1600);
const height = Number(args.height ?? 900);
const post = args.post ?? "1";
const tier = args.tier != null ? Number(args.tier) : null;

async function reachable(u) {
  try {
    const r = await fetch(u);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(url)) return null;
  const port = new URL(url).port || "5176";
  const child = spawn(join(appRoot, "node_modules", ".bin", "vite"), ["--port", port, "--strictPort", "--host", "127.0.0.1"], { cwd: appRoot, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(url)) return child;
  }
  child.kill();
  throw new Error(`Vite did not start on ${url}`);
}

const fileName = (q, v) => `${prefix}-${q}-${v.replace(/[:]/g, "-")}.png`;

function framing([id, label, target, position, fov]) {
  const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
  const d = Math.hypot(dx, dy, dz);
  return { id, label, position, target, fovDeg: fov, orbit: { yawDeg: [-20, 20], pitchDeg: [-30, 60], distance: [Math.max(2, d * 0.6), d * 1.6] }, transitionSeconds: 1, composition: "Development close-up of the settlement fabric (not a shipped camera)." };
}

async function main() {
  mkdirSync(out, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const metricsPath = join(out, `${prefix}-metrics.json`);
  const metrics = { generatedBy: "main game/scripts/capture-legacy-environment-settlement.mjs", note: "Software-rendered (SwiftShader) in a container without a GPU: frame times are not representative of real hardware. Draw calls, triangles, programs, geometries and textures are hardware-independent. st:* views are development framings, not shipped cameras.", fixture, tier, width, height, post: post !== "0", qualities: {} };
  if (existsSync(metricsPath)) {
    try {
      const prev = JSON.parse(readFileSync(metricsPath, "utf8"));
      if (prev.fixture === fixture && prev.width === width && prev.height === height && prev.post === metrics.post && prev.tier === tier) metrics.qualities = prev.qualities ?? {};
    } catch {
      // Replaced when malformed.
    }
  }
  try {
    for (const quality of qualities) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const t0 = Date.now();
      await page.goto(`${url}?legacyEnvironment&nation=korvenia&fixture=${fixture}&quality=${quality}&post=${post}&view=establishing&labels=0`, { waitUntil: "load" });
      await page.addStyleTag({ content: "button, select { display: none !important; }" });
      await page.waitForFunction(() => window.__bannerhold && window.__bannerhold.env && !window.__bannerhold.env.busy, null, { timeout: 600000, polling: 500 });
      await page.evaluate(() => window.__bannerhold.ready);
      const loadMs = Date.now() - t0;
      await page.evaluate(() => window.__bannerhold.env.setPaused(true));
      if (tier != null) {
        // Development only: preview a hall tier on top of the chosen fixture (never saved); the
        // on-screen caption says so.
        await page.evaluate((t) => {
          const env = window.__bannerhold.env;
          env.setState({ ...env.state, hallTier: t });
          for (const el of document.querySelectorAll("div")) {
            if (el.children.length === 0 && /^Development fixture/.test(el.textContent || "")) el.textContent += ` · hall tier ${t} (development preview)`;
          }
        }, tier);
      }
      await page.evaluate((fs) => {
        for (const f of fs) window.__bannerhold.env.defineFraming(f);
      }, SETTLEMENT_FRAMINGS.map(framing));
      const qm = { loadMs, views: {}, errors };
      for (const view of views) {
        const ok = await page.evaluate((v) => window.__bannerhold.setView(v, true), view);
        if (!ok) {
          qm.views[view] = { skipped: true };
          continue;
        }
        await page.evaluate(async () => {
          const env = window.__bannerhold.env;
          for (let i = 0; i < 3; i++) {
            env.renderNow(1 / 30);
            await new Promise((r) => setTimeout(r, 30));
          }
        });
        const file = fileName(quality, view);
        await page.screenshot({ path: join(out, file), timeout: 180000 });
        const stats = await page.evaluate(() => {
          const env = window.__bannerhold.env;
          return { ...env.getStats(), programs: env.programs, debug: env.debugInfo() };
        });
        qm.views[view] = { file, drawCalls: stats.drawCalls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures, programs: stats.programs };
        qm.build = { buildMs: stats.debug.buildMs, budget: stats.debug.budget, materials: stats.debug.materials, trianglesByPart: stats.debug.build ? stats.debug.build.trianglesByPart : null };
        process.stdout.write(`${quality} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris\n`);
      }
      const prevQ = metrics.qualities[quality];
      if (prevQ && prevQ.views) qm.views = { ...prevQ.views, ...qm.views };
      metrics.qualities[quality] = qm;
      writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
      await page.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  process.stdout.write(`Wrote ${out}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
