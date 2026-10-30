// Bounded production fallback check at the two supported landscape sizes.
// Serve the production build, then run from main game:
// CROWNFALL_TEST_URL=http://localhost:5196 node scripts/verify-chronicles-fallback.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ts from 'typescript';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shared = async (name) => {
  const source = await readFile(resolve(here, '../../shared/chronicles', name), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};
const { CHRONICLES_LOAD_FAILURE } = await shared('status.ts');
const { CHRONICLE_RECORDS } = await shared('content.ts');
const record = CHRONICLE_RECORDS.find((entry) => entry.id === 'korvenia');
const out = process.env.CROWNFALL_OUT || resolve(here, '../artifacts/chronicles/recovery-2026-10-30');
await mkdir(out, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), passed: false, scope: 'Production desktop flat fallback, shared failure guidance, record and Back at 1280x720 and 844x390', fault: 'WebGL unavailable through a browser initialization seam; not a network failure', checks: [], errors: [], expectedErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => evidence.errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      (/WebGL|Error creating WebGL context/i.test(message.text()) ? evidence.expectedErrors : evidence.errors).push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: false, volume: 0 }));
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...args); };
    });
    const url = new URL(process.env.CROWNFALL_TEST_URL || 'http://localhost:5196');
    url.searchParams.set('model', 'none');
    await page.goto(url.href);
    await waitForBootReady(page, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await waitForMenuIdle(page);
    await page.locator('.home-tile[aria-label="Chronicles"]').click();
    await page.waitForFunction(() => document.querySelector('.menu-transition-live .chronicles-screen')?.dataset.load === 'flat');
    await waitForMenuIdle(page);
    const screen = page.locator('.menu-transition-live .chronicles-screen');
    const feedback = screen.locator('.chronicles-failure');
    assert.equal(await feedback.isVisible(), true);
    assert.equal(await feedback.textContent(), CHRONICLES_LOAD_FAILURE);
    await screen.locator('.chronicles-hotspot[data-nation="korvenia"]').click();
    await page.waitForFunction(() => document.querySelector('#chronicles-record')?.dataset.record === 'korvenia');
    assert.equal(await screen.locator('#chronicles-record-title').textContent(), record.title);
    assert.equal(await screen.locator('.chronicles-body').textContent(), record.body);
    const layout = await screen.evaluate((root) => {
      const box = (element) => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      const notice = root.querySelector('.chronicles-failure'), rect = box(notice);
      const overlaps = [...root.querySelectorAll('button, #chronicles-record')].filter((element) => {
        const b = box(element);
        return b.width > 0 && b.height > 0 && rect.x < b.x + b.width && rect.x + rect.width > b.x && rect.y < b.y + b.height && rect.y + rect.height > b.y;
      }).map((element) => element.id || element.getAttribute('aria-label') || element.className);
      return { notice: rect, overlaps, clipped: notice.scrollWidth > notice.clientWidth || notice.scrollHeight > notice.clientHeight, viewportOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    });
    assert.equal(layout.clipped, false, 'failure guidance is not clipped');
    assert.equal(layout.viewportOverflow, false, 'fallback stays within the landscape viewport');
    assert.deepEqual(layout.overlaps, [], 'failure guidance does not overlap controls or the record');
    const capture = `desktop-fallback-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: resolve(out, capture) });
    for (const expected of [{ entry: '', focus: 'nation:korvenia' }, { entry: '', focus: 'overview' }]) {
      await screen.getByRole('button', { name: 'Back', exact: true }).click();
      assert.equal(await screen.getAttribute('data-entry'), expected.entry);
      assert.equal(await screen.getAttribute('data-focus'), expected.focus);
    }
    await screen.getByRole('button', { name: 'Back', exact: true }).click();
    await waitForMenuIdle(page);
    assert.equal(await page.locator('.home-tile[aria-label="Chronicles"]').isVisible(), true);
    evidence.checks.push({ viewport, passed: true, message: CHRONICLES_LOAD_FAILURE, record: record.id, back: 'entry -> focus -> Home', layout, capture });
    await page.close();
  }
  assert.deepEqual(evidence.errors, [], 'no unexpected browser errors');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  evidence.completedAt = new Date().toISOString();
  await writeFile(resolve(out, 'desktop-fallback-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
