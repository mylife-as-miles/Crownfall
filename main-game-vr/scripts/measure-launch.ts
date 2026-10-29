// Home launch-to-interactive for production builds of the Quest app, opened in a browser without a headset
// or an XR session: the time from navigation to the menu being bound and drawn, with and without a stored
// banner, and which requests were made before My Legacy is ever opened. Each variant is a built dist folder
// served as static files, so the lazy build can be compared with a build that has no Legacy at all and with
// an earlier, eager build. Software-rendered (SwiftShader) on a shared host: compare the variants with each
// other; never read the absolute numbers as Quest timings.
//   npx tsx scripts/measure-launch.ts --variant lazy=dist [--variant none=/path/dist] [--runs 5] [--out launch.json]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeraldry } from '../../shared/legacy/content/heraldry';
import { serializeLegacy } from '../../shared/legacy/domain/persistence';
import { reduceLegacyAll } from '../../shared/legacy/domain/reducer';
import { createLegacyState } from '../../shared/legacy/domain/state';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.uikitml': 'text/plain', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
};
const LEGACY_REQUEST = /legacy-experience|legacy\.uikitml|legacy-dock\.uikitml|createStandInEnvironment|fixtures/;

interface RunResult {
  variant: string;
  storedBanner: boolean;
  bootReadyMs: number | null;
  menuReadyMarkMs: number | null;
  firstFrameAfterBootMs: number | null;
  longTasks: number[];
  requests: number;
  legacyRequests: string[];
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(name); return index === -1 ? fallback : args[index + 1]; };
const variants = args.flatMap((arg, index) => (arg === '--variant' ? [args[index + 1]] : [])).map((value) => {
  const [label, dir] = value.split('=');
  return { label, dir: resolve(dir) };
});
if (variants.length === 0) variants.push({ label: 'lazy', dir: resolve('dist') });
const runs = Number(option('--runs', '5'));
const out = option('--out', 'artifacts/legacy/latest/launch.json');

/** A stored banner that has founded, nominated and accepted its challenge, built with the shared rules. */
function storedBanner(): string {
  const at = '2026-10-29T12:00:00.000Z';
  const result = reduceLegacyAll(createLegacyState({ at }), [
    { type: 'found-banner', name: 'House Noirval', nationId: 'korvenia', heraldry: defaultHeraldry('korvenia'), motto: 'We hold', at, seed: 7 },
    { type: 'nominate', memberId: 'member-1', file: 'a', at },
    { type: 'read-notice', noticeId: 'notice-0002' },
    { type: 'accept-challenge', noticeId: 'notice-0002', at },
  ]);
  if (result.error) throw new Error(result.error);
  const serialized = serializeLegacy(result.state);
  if (serialized.ok === false) throw new Error(serialized.error);
  return serialized.json;
}

function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(dir) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    resolveServer({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
  }));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const banner = storedBanner();
  const results: RunResult[] = [];
  try {
    for (const variant of variants) {
      const server = await serve(variant.dir);
      try {
        for (let run = 0; run < runs; run++) {
          for (const stored of [false, true]) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
            await context.addInitScript(([save, withBanner]) => {
              localStorage.setItem('crownfall.quest.visit-complete', 'true');
              if (withBanner) localStorage.setItem('crownfall.legacy.save', save);
              const launch = { bootReady: null as number | null, firstFrame: null as number | null, longTasks: [] as number[] };
              (window as unknown as { __launch: typeof launch }).__launch = launch;
              new PerformanceObserver((list) => { for (const entry of list.getEntries()) launch.longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: true });
              new MutationObserver(() => {
                if (launch.bootReady === null && document.body?.dataset.boot === 'ready') {
                  launch.bootReady = performance.now();
                  requestAnimationFrame(() => { launch.firstFrame = performance.now(); });
                }
              }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-boot'] });
            }, [banner, stored] as const);
            const page = await context.newPage();
            const requests: string[] = [];
            page.on('request', (request) => requests.push(request.url().replace(server.url, '/')));
            await page.goto(server.url, { waitUntil: 'load' });
            await page.waitForFunction(() => (window as unknown as { __launch: { firstFrame: number | null } }).__launch.firstFrame !== null, undefined, { timeout: 180000 });
            const measured = await page.evaluate(() => {
              const launch = (window as unknown as { __launch: { bootReady: number; firstFrame: number; longTasks: number[] } }).__launch;
              const mark = performance.getEntriesByName('crownfall:menu-ready')[0];
              return { bootReady: launch.bootReady, firstFrame: launch.firstFrame, longTasks: launch.longTasks.slice(), menuReady: mark ? mark.startTime : null };
            });
            const result: RunResult = {
              variant: variant.label, storedBanner: stored,
              bootReadyMs: Math.round(measured.bootReady), menuReadyMarkMs: measured.menuReady === null ? null : Math.round(measured.menuReady),
              firstFrameAfterBootMs: Math.round(measured.firstFrame), longTasks: measured.longTasks,
              requests: requests.length, legacyRequests: requests.filter((url) => LEGACY_REQUEST.test(url)),
            };
            results.push(result);
            console.log(JSON.stringify(result));
            await context.close();
          }
        }
      } finally { server.close(); }
    }
  } finally { await browser.close(); }
  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const summary = variants.flatMap((variant) => [false, true].map((stored) => {
    const rows = results.filter((row) => row.variant === variant.label && row.storedBanner === stored);
    return {
      variant: variant.label, storedBanner: stored, runs: rows.length,
      bootReadyMedianMs: median(rows.flatMap((row) => (row.bootReadyMs === null ? [] : [row.bootReadyMs]))),
      firstFrameAfterBootMedianMs: median(rows.flatMap((row) => (row.firstFrameAfterBootMs === null ? [] : [row.firstFrameAfterBootMs]))),
      legacyRequestsBeforeEntry: Array.from(new Set(rows.flatMap((row) => row.legacyRequests))),
    };
  }));
  await writeFile(out, `${JSON.stringify({
    measuredAt: new Date().toISOString(),
    caveat: 'Production builds served locally and opened in headless Chromium with SwiftShader software WebGL on a shared 4-CPU host, without a headset or an XR session. Compare variants with each other; the absolute times are not Quest timings.',
    variants, runs, summary, results,
  }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
