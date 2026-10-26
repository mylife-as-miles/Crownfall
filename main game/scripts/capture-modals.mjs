import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle, waitForDialogClosed } from './motion-helpers.mjs';
const origin = process.env.CROWNFALL_TEST_URL || 'http://localhost:4173';
const directory = 'artifacts/modals';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], captures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'high', motion: true, renderScale: 100, frameLimit: 30 })));
  await page.goto(origin); await waitForBootReady(page);
  const shot = async (state, viewport) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const path = `${directory}/${state}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path }); captures.push({ state, viewport, path }); console.log(path);
  };
  const close = async () => { await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await waitForDialogClosed(page); };
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  await shot('classic', { width: 1280, height: 720 }); await close();
  await page.getByRole('tab', { name: 'Home', exact: true }).click(); await waitForMenuIdle(page);
  await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
  await shot('legacy', { width: 1280, height: 720 }); await close();
  await page.getByRole('tab', { name: 'Play', exact: true }).click(); await waitForMenuIdle(page);
  await page.getByRole('button', { name: 'Chapters', exact: true }).click(); await waitForMenuIdle(page);
  await page.getByRole('button', { name: 'Chapter 02', exact: true }).click();
  await shot('chapter02', { width: 1280, height: 720 });
  await page.setViewportSize({ width: 844, height: 390 });
  await shot('chapter02', { width: 844, height: 390 }); await close();
  await page.keyboard.press('Escape'); await waitForMenuIdle(page);
  await page.keyboard.press('Escape');
  for (const viewport of [{ width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport); await shot('confirmation', viewport);
  }
  await close(); await page.close();

  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion: 'no-preference', recordVideo: { dir: '/tmp/crownfall-modal-recording', size: { width: 960, height: 540 } } });
  const motion = await context.newPage(); motion.on('pageerror', error => errors.push(error.message));
  await motion.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: true, renderScale: 50, frameLimit: 30 })));
  await motion.goto(origin); await waitForBootReady(motion);
  await motion.getByRole('button', { name: 'Classic', exact: true }).click(); await motion.waitForTimeout(800);
  await motion.keyboard.press('ArrowRight'); await motion.waitForTimeout(300); await motion.keyboard.press('Enter'); await waitForDialogClosed(motion);
  await motion.keyboard.press('Escape'); await motion.waitForTimeout(1000);
  await motion.getByRole('button', { name: 'Confirm', exact: true }).click(); await waitForDialogClosed(motion); await waitForMenuIdle(motion);
  await motion.getByRole('button', { name: 'Chronicles', exact: true }).click(); await motion.waitForTimeout(1000);
  await motion.getByRole('button', { name: 'Confirm', exact: true }).click(); await waitForDialogClosed(motion); await motion.waitForTimeout(1600);
  const video = motion.video(); await context.close();
  const raw = await video.path();
  const encoded = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '32', '-b:v', '0', '-an', `${directory}/modal-flow.webm`], { encoding: 'utf8' });
  if (encoded.status !== 0) throw Error(encoded.stderr);
  await writeFile(`${directory}/captures.json`, JSON.stringify({ reference: '279179.jpg (user reference, kept outside repository)', captures, recording: `${directory}/modal-flow.webm`, errors, rendering: 'Actual supplied sorcerer GLB. Static captures: High particles, 100% scene resolution, OS reduced motion. Full untrimmed 960x540 flow recording: motion enabled, Low particles, 50% scene resolution and 30fps scene cap for software capture. No target-device frame-pacing claim.' }, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); }
