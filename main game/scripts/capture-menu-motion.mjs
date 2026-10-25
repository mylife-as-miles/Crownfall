import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const output = 'artifacts/motion';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion: 'no-preference', recordVideo: { dir: '/tmp/crownfall-menu-motion', size: { width: 960, height: 540 } } });
const recordingOrigin = Date.now();
const page = await context.newPage();
const errors = [], actions = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: true, volume: 65, renderScale: 50, frameLimit: 30 })));
let start;
const pause = ms => page.waitForTimeout(ms);
const step = async (label, action, delay = 700) => { actions.push({ label, seconds: (Date.now() - start) / 1000 }); await action(); await pause(delay); };
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const key = code => page.keyboard.press(code);
try {
 await page.goto(process.env.CROWNFALL_TEST_URL || 'http://localhost:4173');
 await page.locator('.creature-model--loaded').waitFor({ timeout: 90000 });
 await page.evaluate(() => document.fonts.ready);
 await pause(1200); start = Date.now();
 await step('Home screen entrance', () => tab('Home'));
 await step('Home spatial selection', () => key('ArrowRight'), 250);
 await step('Home lower tile selection', () => key('ArrowDown'), 250);
 await step('Home destination dialog entrance', () => key('Enter'));
 await step('Dialog exit', () => key('Escape'), 400);
 await step('Play screen entrance', () => tab('Play'));
 await step('Play option selection', () => key('ArrowRight'), 250);
 await step('Mode dialog entrance', () => key('Enter'));
 await step('Mode dialog exit', () => key('Escape'), 400);
 await step('Showcase overview entrance', () => tab('Showcase'));
 await step('Arena category selection', () => key('ArrowRight'), 200);
 await step('Arena gallery entrance', () => key('Enter'));
 for (let index = 2; index <= 4; index++) await step(`Arena 0${index} crossfade`, () => key('ArrowRight'), 400);
 await step('Return to Showcase overview', () => key('Escape'), 450);
 await key('Home');
 await step('Cinematic library entrance', () => key('Enter'));
 await step('Real Explore Arenas shortcut', () => page.getByRole('button', { name: 'Explore Arenas', exact: true }).click());
 await step('Return to overview', () => key('Escape'), 450);
 await key('End');
 await step('Future replay archive entrance', () => key('Enter'));
 await step('Replay Back', () => key('Escape'), 450);
 await step('Settings hub entrance', () => tab('Settings'));
 await step('Video detail entrance and background defocus', () => page.getByRole('button', { name: 'Video', exact: true }).click());
 await step('Window-mode description transition', () => key('ArrowDown'), 300);
 await step('Resolution description transition', () => key('ArrowDown'), 300);
 await step('Settings Back', () => key('Escape'), 450);
 await step('Rapid interrupted screen requests', () => page.evaluate(async () => {
   for (const label of ['Home', 'Play', 'Settings', 'Home', 'Play']) {
     document.querySelector(`.main-nav [aria-label="${label}"]`).click();
     await new Promise(resolve => setTimeout(resolve, 55));
   }
 }), 750);
 await page.screenshot({ path: `${output}/recording-final-frame.png` });
 await pause(3500);
 if (errors.length) throw Error(errors.join('\n'));
} finally {
 const video = page.video();
 await context.close(); await browser.close();
 const raw = await video.path();
 const offset = 0;
 const file = `${output}/menu-transitions.webm`;
 const encoded = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(offset), '-i', raw, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '34', '-b:v', '0', '-an', file], { encoding: 'utf8' });
 if (encoded.status !== 0) throw Error(encoded.stderr || 'Video encoding failed');
 await writeFile(`${output}/recording.json`, JSON.stringify({ file, viewport: { width: 960, height: 540 }, rendering: 'Actual supplied GLB and Idle. Software WebGL capture uses Low particle quality, 50% scene resolution, 30fps scene cap; UI motion remains enabled. Device frame performance is not established.', preparationSecondsTrimmed: offset, actionTiming: "Action timestamps are wall-clock times after scene warmup, not encoded video seek positions.", warmupMilliseconds: (start || recordingOrigin) - recordingOrigin, actions, errors }, null, 2) + '\n');
 console.log(file);
}
