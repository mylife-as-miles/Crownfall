import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = 'artifacts/showcase';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const captures = [], errors = [];
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'high', motion: false, volume: 65 })));
 await page.goto(process.env.CROWNFALL_TEST_URL || 'http://localhost:4173');
 await page.locator('.creature-model--loaded').waitFor({ timeout: 90000 });
 await page.evaluate(() => document.fonts.ready);
 await page.getByRole('tab', { name: 'Showcase', exact: true }).click();
 const shot = async (view, viewport) => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const path = `${directory}/${view}-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({ path }); captures.push({ path, viewport }); console.log(path);
 };
 for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
  await page.setViewportSize(viewport);
  await shot('overview', viewport);
  for (const [label, view] of [['AI Battles', 'battles'], ['Arenas', 'arenas'], ['Match Replays', 'replays']]) {
   await page.getByRole('button', { name: label, exact: true }).click();
   await shot(view, viewport);
   if (view === 'arenas') { await page.getByRole('button', { name: 'Arena 04', exact: true }).click(); await shot('arena04', viewport); }
   await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
 }
 await writeFile(`${directory}/screenshots.json`, JSON.stringify({ captures, errors, rendering: 'Actual supplied GLB, static reduced motion, high particles and default resolution.' }, null, 2) + '\n');
 if (errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); }
