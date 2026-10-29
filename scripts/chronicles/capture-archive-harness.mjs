// Captures the archive harness sheets (development only) with Playwright on
// SwiftShader: it starts the desktop dev server on a port in 5190-5199, renders
// each requested sheet at 1920 x 1080, writes PNGs and a manifest, and always
// stops the server and the browser it started.
//
//   node scripts/chronicles/capture-archive-harness.mjs                        # the default M1 set
//   node scripts/chronicles/capture-archive-harness.mjs kernel:medium materials:low
//
// Each argument is sheet:quality[:tess], e.g. kernel:medium:quest for Quest tessellation, or
// q:<query>:<name> for any harness query, e.g. "q:sheet=form&id=arcade&az=200:arcade-detail".

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = join(root, "main game");
const { chromium } = createRequire(join(desktop, "package.json"))("playwright");
const PORT = Number(process.env.ARCHIVE_HARNESS_PORT || 5193);
if (PORT < 5190 || PORT > 5199) throw new Error("dev servers use ports 5190-5199 only");
const OUT = join(desktop, "artifacts/chronicles", process.env.ARCHIVE_MILESTONE || "m1");
const requests = (process.argv.slice(2).length ? process.argv.slice(2) : ["kernel:medium", "kernel:medium:quest", "materials:medium", "materials:low"]).map((item) => {
  if (item.startsWith("q:")) {
    const [, query, name] = item.split(":");
    const parsed = new URLSearchParams(query);
    return { sheet: parsed.get("sheet") || "kernel", quality: parsed.get("quality") || "medium", tess: parsed.get("tess") || undefined, query, name: `env-${name}.png` };
  }
  const [sheet, quality = "medium", tess] = item.split(":");
  return { sheet, quality, tess, query: new URLSearchParams({ sheet, quality, ...(tess ? { tess } : {}) }).toString(), name: `env-${sheet}-sheet-${quality}${tess ? `-${tess}-tessellation` : ""}.png` };
});

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: desktop, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stopServer);

async function waitForServer(url, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev server did not start:\n${serverLog}`);
}

const base = `http://127.0.0.1:${PORT}/src/chronicles/scene/harness.html`;
let browser;
const manifest = {
  generated: new Date().toISOString(),
  renderer: "Chromium headless with SwiftShader (software WebGL), 4 CPUs shared with other workflows: images show content and composition, not GPU timing or headset results",
  host: { cpus: cpus().length, loadAverage: loadavg().map((value) => Number(value.toFixed(1))) },
  page: "main game/src/chronicles/scene/harness.html (development only, absent from main game/dist)",
  captures: [],
};
try {
  await waitForServer(base);
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const request of requests) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const started = Date.now();
    await page.goto(`${base}?${request.query}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => window.__archiveHarness && (window.__archiveHarness.ready || window.__archiveHarness.error), null, { timeout: 900000, polling: 500 });
    const state = await page.evaluate(() => window.__archiveHarness);
    if (state.error) throw new Error(`${request.sheet}:${request.quality} failed: ${state.error}`);
    const name = request.name;
    await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    manifest.captures.push({ file: name, query: request.query, sheet: request.sheet, quality: request.quality, tessellation: request.tess || request.quality, seconds: Math.round((Date.now() - started) / 1000), cells: state.cells, textures: state.textures ?? null, programs: state.programs ?? null, errors });
    console.log(`captured ${name} (${state.cells.length} cells, ${Math.round((Date.now() - started) / 1000)} s)${errors.length ? ` with ${errors.length} console errors` : ""}`);
    await page.close();
  }
  // Keep earlier captures listed; a capture of the same file replaces its entry.
  const manifestName = `env-harness-sheets.json`;
  let previous = [];
  try { previous = JSON.parse(await readFile(join(OUT, manifestName), "utf8")).captures ?? []; } catch { /* first run */ }
  manifest.captures = [...previous.filter((entry) => !manifest.captures.some((item) => item.file === entry.file)), ...manifest.captures];
  await writeFile(join(OUT, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifestName}`);
} finally {
  await browser?.close();
  stopServer();
}
