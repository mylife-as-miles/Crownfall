// Bounded retained-heap diagnostic after navigation warmup. Uses real app
// input and the public preview, with no save writes or focus instrumentation.
// Heap snapshots remain local; only constructor/type totals are report data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";

const directory = process.env.CROWNFALL_LEGACY_ARTIFACTS || "artifacts/legacy/retention";
const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
target.searchParams.set("legacyPreview", "founded");
target.searchParams.set("legacyStats", "1");
const rawDirectory = await mkdtemp(join(tmpdir(), "crownfall-legacy-heap-"));
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
const report = { measuredAt: new Date().toISOString(), target: target.href, warmupTrips: 15, measuredTrips: 15, checkpoints: [], snapshots: [], errors, caveat: "Same-state production preview in software-rendered Chromium. Post-GC live-heap diagnostics are not physical GPU/Quest performance or universal leak certification. Snapshotting itself perturbs execution; no frame-budget claim is made. Full snapshots stay in a local temporary directory." };

async function enter() {
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await page.locator('.legacy-screen[data-environment-ready="true"]').waitFor();
}

async function trip() {
  await page.locator('.legacy-label[data-landmark="banner-hall"]').click();
  await page.locator('[data-landmark-panel="banner-hall"]').waitFor();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("e");
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await page.locator("[data-landmark-panel]").waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.locator(".home-grid").waitFor();
  await enter();
  await page.waitForTimeout(300);
}

async function checkpoint(cdp, trips) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = (name) => metrics.find((entry) => entry.name === name)?.value ?? null;
  const stats = await page.evaluate(() => {
    const value = window.__legacyStats?.();
    return value ? { drawCalls: value.drawCalls, triangles: value.triangles, geometries: value.geometries, textures: value.textures, programs: value.programs } : null;
  });
  const result = { trips, jsHeapBytes: metric("JSHeapUsedSize"), nodes: metric("Nodes"), documents: metric("Documents"), eventListeners: metric("JSEventListeners"), stats };
  report.checkpoints.push(result);
  console.log(JSON.stringify(result));
}

async function snapshot(cdp, name) {
  const chunks = [];
  const collect = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", collect);
  try { await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false }); }
  finally { cdp.off("HeapProfiler.addHeapSnapshotChunk", collect); }
  const text = chunks.join("");
  const rawPath = join(rawDirectory, `${name}.heapsnapshot.json.gz`);
  await writeFile(rawPath, gzipSync(text));
  const heap = JSON.parse(text);
  const fields = heap.snapshot.meta.node_fields;
  const field = (key) => fields.indexOf(key);
  const types = heap.snapshot.meta.node_types[field("type")];
  const groups = new Map();
  let selfBytes = 0;
  for (let offset = 0; offset < heap.nodes.length; offset += fields.length) {
    const type = types[heap.nodes[offset + field("type")]];
    const nodeName = heap.strings[heap.nodes[offset + field("name")]];
    // Exclude string contents/function source from the portable report.
    const key = ["object", "native", "hidden"].includes(type) ? `${type}: ${nodeName}` : type;
    const bytes = heap.nodes[offset + field("self_size")];
    const group = groups.get(key) ?? { count: 0, selfBytes: 0 };
    group.count++; group.selfBytes += bytes;
    groups.set(key, group); selfBytes += bytes;
  }
  const summary = { name, rawPath, sha256: createHash("sha256").update(text).digest("hex"), nodes: heap.nodes.length / fields.length, selfBytes, groups: Object.fromEntries(groups) };
  report.snapshots.push(summary);
  return groups;
}

try {
  await page.addInitScript(() => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", renderScale: 75, motion: false, volume: 65 })));
  await page.goto(target.href);
  await waitForBootReady(page);
  await enter();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  for (let index = 0; index < 15; index++) { await trip(); if ((index + 1) % 5 === 0) console.log(`Warmup ${index + 1}/15`); }
  await checkpoint(cdp, 15);
  const before = await snapshot(cdp, "after-15");
  for (let index = 0; index < 15; index++) { await trip(); if ((index + 1) % 5 === 0) await checkpoint(cdp, index + 16); }
  const after = await snapshot(cdp, "after-30");
  report.growthByGroup = [...new Set([...before.keys(), ...after.keys()])].map((group) => ({
    group, countDelta: (after.get(group)?.count ?? 0) - (before.get(group)?.count ?? 0),
    selfBytesDelta: (after.get(group)?.selfBytes ?? 0) - (before.get(group)?.selfBytes ?? 0),
  })).filter((entry) => entry.countDelta !== 0 || entry.selfBytesDelta !== 0).sort((a, b) => b.selfBytesDelta - a.selfBytesDelta);
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/retention.json`, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(`Retention evidence: ${directory}/retention.json; raw snapshots: ${rawDirectory}`);
