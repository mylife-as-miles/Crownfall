#!/usr/bin/env node
// Captures the Korvenia landmark package (Banner Hall and the manor, Muster Grounds, War
// Record, Herald's Station and West Gate) in the environment harness: the authored landmark
// framings plus close-up development framings defined here (not shipped cameras).
// Usage (from "main game/"):
//   node scripts/capture-legacy-environment-landmarks.mjs [--out artifacts/legacy-environment]
//     [--prefix landmarks] [--url http://127.0.0.1:5175/] [--quality medium,high,low]
//     [--views establishing,banner-hall,lm:hall-front,...] [--fixture founded] [--post 1]
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

// Close-up development framings: [id, label, target, camera position, vertical fov].
const FRAMINGS = [
  ["lm:hall-front", "Banner Hall porch and south gable", [0, 15.5, -24], [3.2, 13.2, 3.5], 42],
  ["lm:hall-west", "Banner Hall west elevation", [-6.5, 15, -36], [-30, 30, -13], 44],
  ["lm:keep", "Keep crown and spire", [-11, 31, -47], [-2.5, 33, -23.5], 40],
  ["lm:honour-court", "Honour Court from above the south-east parapet", [6.5, 9.8, -17.4], [17.5, 25, -4.5], 42],
  ["lm:court-gate", "Court Gate from the Muster Stair", [-11, 13, -13.5], [-15.8, 9.6, 8.5], 46],
  ["lm:west-range", "West Range", [-21, 11.5, -31], [-11.5, 18.5, -9.5], 44],
  ["lm:west-range-done", "West Range court face (completed from hall tier 1)", [-20.5, 13.5, -31], [-6.5, 15.0, -20.5], 48],
  ["lm:muster-dais", "Muster dais, file stones and pawn stand", [-22, 1.4, -3.4], [-19.5, 5.2, 11.5], 40],
  ["lm:file-stones", "File stones a–h", [-22, 0.7, -2.2], [-20.2, 2.3, 4.2], 44],
  ["lm:training", "Training ground", [-13.5, 1.2, 6], [-26, 4.6, 14.5], 44],
  ["lm:armoury", "Armoury and weapon store under the court wall", [-42.5, 5.5, -3.0], [-30.0, 1.8, 6.5], 55],
  ["lm:archive", "War Record south gable and door", [32, 11.5, -27], [33.5, 13, -6.5], 44],
  ["lm:archive-tower", "Record tower and gallery bridge", [33, 15, -24.5], [55, 22, -6], 44],
  ["lm:record-gallery", "Record Gallery plot behind the archive (gallery from hall tier 2)", [32, 11.5, -50.5], [50, 21, -44], 46],
  ["lm:herald-door", "Post room door, notice board and lantern", [-50.8, 3.4, 6.4], [-53.8, 2.4, 13.2], 50],
  ["lm:herald-tower", "Herald tower and raven loft", [-51, 13.5, -2.5], [-36.5, 17.5, 12.5], 44],
  ["lm:west-gate", "West Gate from the road", [-60, 6.5, 17], [-86, 6, 21.5], 40],
];

const out = resolve(appRoot, args.out ?? "artifacts/legacy-environment");
const prefix = args.prefix ?? "landmarks";
const url = args.url ?? "http://127.0.0.1:5175/";
const qualities = (args.quality ?? "medium").split(",");
const views = (args.views ?? ["establishing", "banner-hall", "muster-grounds", "war-record", "heralds-station", "representative", "founding", ...FRAMINGS.map((f) => f[0])].join(",")).split(",");
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
  const port = new URL(url).port || "5175";
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
  return { id, label, position, target, fovDeg: fov, orbit: { yawDeg: [-20, 20], pitchDeg: [-30, 60], distance: [Math.max(2, d * 0.6), d * 1.6] }, transitionSeconds: 1, composition: "Development close-up of the landmark package (not a shipped camera)." };
}

async function main() {
  mkdirSync(out, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const metricsPath = join(out, `${prefix}-metrics.json`);
  let metrics = { generatedBy: "main game/scripts/capture-legacy-environment-landmarks.mjs", note: "Software-rendered (SwiftShader) in a container without a GPU: frame times are not representative of real hardware. Draw calls, triangles, programs, geometries and textures are hardware-independent.", fixture, tier, width, height, post: post !== "0", qualities: {} };
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
      }, FRAMINGS.map(framing));
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
