#!/usr/bin/env node
// Captures a named screenshot set of the Bannerhold environment harness and a metrics
// JSON. Usage (from "main game/"):
//   node scripts/capture-legacy-environment.mjs [--out artifacts/legacy-environment/latest]
//     [--url http://127.0.0.1:5174/] [--quality medium,high] [--views establishing,banner-hall,...]
//     [--fixture founded] [--nation korvenia] [--width 1600] [--height 900] [--post 1] [--copy-to <dir>]
// Starts Vite on the URL's port when nothing answers there. Rendering here is software
// (SwiftShader): frame timings are NOT representative of real hardware.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const out = resolve(appRoot, args.out ?? "artifacts/legacy-environment/latest");
const url = args.url ?? "http://127.0.0.1:5174/";
const qualities = (args.quality ?? "medium").split(",");
const views = (args.views ?? "establishing,banner-hall,muster-grounds,war-record,heralds-station,representative,founding,district:court,district:lower-town,district:west-gate,district:forge,district:road,district:eclipse").split(",");
const fixture = args.fixture ?? "founded";
const nation = args.nation ?? "korvenia";
const width = Number(args.width ?? 1600);
const height = Number(args.height ?? 900);
const post = args.post ?? "1";

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

const fileName = (q, v) => `${q}-${v.replace(/[:]/g, "-")}.png`;

async function main() {
  mkdirSync(out, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const metrics = { generatedBy: "main game/scripts/capture-legacy-environment.mjs", note: "Software-rendered (SwiftShader) in a container without a GPU: frame times are not representative of real hardware. Draw calls, triangles, programs, geometries and textures are hardware-independent.", nation, fixture, width, height, post: post !== "0", qualities: {} };
  // Keep earlier qualities captured into the same folder with the same settings, and write
  // after every quality so a long software-rendered run never loses finished work.
  const metricsPath = join(out, "metrics.json");
  if (existsSync(metricsPath)) {
    try {
      const prev = JSON.parse(readFileSync(metricsPath, "utf8"));
      if (prev.nation === nation && prev.fixture === fixture && prev.width === width && prev.height === height && prev.post === metrics.post) metrics.qualities = prev.qualities ?? {};
    } catch {
      // A malformed file is replaced.
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
      await page.goto(`${url}?legacyEnvironment&nation=${nation}&fixture=${fixture}&quality=${quality}&post=${post}&view=establishing&labels=${args.labels ?? "0"}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__bannerhold && window.__bannerhold.env && !window.__bannerhold.env.busy, null, { timeout: 600000, polling: 500 });
      await page.evaluate(() => window.__bannerhold.ready);
      const loadMs = Date.now() - t0;
      // Capture deterministically: stop the live loop and render frames on demand.
      await page.evaluate(() => window.__bannerhold.env.setPaused(true));
      const qm = { loadMs, views: {}, errors };
      for (const view of views) {
        const ok = await page.evaluate((v) => window.__bannerhold.setView(v, true), view);
        if (!ok) {
          qm.views[view] = { skipped: true };
          continue;
        }
        // Render a few frames so instancing, smoke and shadows settle.
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
        qm.build = stats.debug;
        process.stdout.write(`${quality} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris\n`);
      }
      // A partial re-capture (--views) keeps the other views already recorded for this quality.
      const prevQ = metrics.qualities[quality];
      if (prevQ && prevQ.views) qm.views = { ...prevQ.views, ...qm.views };
      // Per-quality summary: renderer.info ranges over the captured views (all passes), the
      // shared in-view budget estimate, material count and estimated texture memory.
      const shot = Object.values(qm.views).filter((v) => !v.skipped);
      const range = (k) => (shot.length ? [Math.min(...shot.map((v) => v[k])), Math.max(...shot.map((v) => v[k]))] : null);
      const d = qm.build ?? {};
      qm.summary = {
        rendererDrawCalls: range("drawCalls"),
        rendererTriangles: range("triangles"),
        programs: range("programs"),
        budgetEstimate: d.budget ?? null,
        materials: d.materials ?? null,
        textureMemoryMB: d.textureBytes != null ? Math.round(d.textureBytes / 10485.76) / 100 : null,
        shadowMapMB: d.shadowBytes != null ? Math.round(d.shadowBytes / 10485.76) / 100 : null,
        buildMs: d.buildMs ?? null,
      };
      metrics.qualities[quality] = qm;
      writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
      await page.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  if (args["copy-to"]) {
    mkdirSync(args["copy-to"], { recursive: true });
    cpSync(out, resolve(args["copy-to"]), { recursive: true });
  }
  process.stdout.write(`Wrote ${out}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
