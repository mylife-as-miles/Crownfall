import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = 'artifacts/screens';
await mkdir(directory, { recursive: true });
const resume = process.argv.includes('--resume');
const evidence = resume ? JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8')) : { complete: false, sourceCommit: process.env.CROWNFALL_SOURCE_COMMIT || '9817e3faa4c882401288570cbad30c8e978f3032', profile: { runtime: 'IWSDK-managed IWER Meta Quest 3', physicalHeadset: false, rendering: 'mono software emulator', captureFov: 45, note: 'Closer emulator field of view for reading screenshots; this is not a physical Quest field-of-view or performance measurement. No product layout was changed.' }, captures: [], interactions: [] };
if (evidence.error) { (evidence.previousErrors ||= []).push(evidence.error); delete evidence.error; }
const hasCapture = title => evidence.captures.some(item => item.title === title);
const continueSettings = resume && hasCapture('Settings');
function cli(domain, action, input, extra = []) {
  const result = spawnSync('npx', ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra], { encoding: 'utf8', timeout: 65000, maxBuffer: 8 * 1024 * 1024 });
  const response = JSON.parse(result.stdout || result.stderr);
  if (!response.ok) throw Error(JSON.stringify(response.error));
  return response.data.result ?? response.data;
}
let entityIndex;
const state = () => cli('ecs', 'query', { entityIndex }).components.find(item => item.componentId === 'CrownfallQuestState').values;
async function save() { await writeFile(`${directory}/manifest.json`, JSON.stringify(evidence, null, 2) + '\n'); }
function pinch(id, expected) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const device = attempt === 0 ? 'hand-left' : 'hand-right';
    const target = cli('xr', 'list-targets').targets.find(item => item.name === id);
    assert.ok(target, `Visible target ${id}`);
    cli('xr', 'look-at', { device, target: target.position });
    const control = cli('ui', 'inspect', { entityIndex, selector: `#${id}` }).elements[0];
    assert.ok(control?.state.visible && control.state.displayed && !control.state.disabled && control.state.hovered, `Hand ray reaches ${id}`);
    cli('xr', 'select', { device, duration: .01 });
    let after;
    for (let poll = 0; poll < 3; poll++) { after = state(); if (expected(after)) break; }
    evidence.interactions.push({ id, device, attempt: attempt + 1, state: after });
    if (expected(after)) return after;
  }
  throw Error(`Hand selection did not reach expected state: ${id}`);
}
async function capture(slug, title, group) {
  if (hasCapture(title)) return;
  const filename = `${String(evidence.captures.length + 1).padStart(2, '0')}-${slug}.png`;
  const metadata = cli('browser', 'screenshot', undefined, ['--output-file', `${directory}/${filename}`]);
  const current = state();
  evidence.captures.push({ filename, title, group, state: current, metadata });
  await save();
  console.log(`CAPTURE ${evidence.captures.length}: ${title}`);
}
try {
  entityIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
  if (!resume) {
  assert.equal(cli('xr', 'status').sessionActive, false, 'Start this gallery from the browser preview');
  await capture('browser-entry', 'Browser entry', 'Entry & visit');
  cli('xr', 'enter', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 45 } });
  cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  if (state().paused) pinch('Btn_Resume', s => !s.paused);
  assert.equal(state().screen, 'onboarding');
  await capture('welcome', 'Welcome / hand instructions', 'Entry & visit');
  pinch('Btn_StartVisit', s => s.screen === 'visit' && s.visitStep === 0);
  await capture('visit-1', 'Short visit — arena 1', 'Entry & visit');
  pinch('Btn_VisitNext', s => s.visitStep === 1);
  await capture('visit-2', 'Short visit — arena 2', 'Entry & visit');
  pinch('Btn_VisitNext', s => s.visitStep === 2);
  await capture('visit-3', 'Short visit — arena 3', 'Entry & visit');
  pinch('Btn_VisitFinish', s => s.visitComplete);
  await capture('visit-complete', 'Visit complete', 'Entry & visit');
  pinch('Btn_Back', s => s.screen === 'home');
  await capture('home', 'Home', 'Main menus');
  } else {
    assert.equal(cli('xr', 'status').sessionActive, true, 'Resume the existing immersive capture session');
    if (state().paused) pinch('Btn_Resume', s => !s.paused);
    if (state().modal) pinch('Btn_Cancel', s => !s.modal);
    if (!continueSettings && state().screen !== 'home') pinch('Nav_Home', s => s.screen === 'home');
  }
  if (!continueSettings) {
  for (const [id, title] of [['legacy', 'My Legacy'], ['chronicles', 'Chronicles'], ['herald', 'Herald Board']]) {
    if (hasCapture(title)) continue;
    pinch(`Home_${id}`, s => s.modal === id);
    await capture(`home-${id}`, title, 'Dialogs');
    pinch('Btn_Cancel', s => !s.modal);
  }
  pinch('Nav_Play', s => s.screen === 'play');
  await capture('play', 'Play', 'Main menus');
  for (const [id, title] of [['classic', 'Classic'], ['local-duel', 'Local Duel'], ['online-duel', 'Online Duel']]) {
    if (hasCapture(title)) continue;
    pinch(`Play_${id}`, s => s.modal === id);
    await capture(`play-${id}`, title, 'Dialogs');
    pinch('Btn_Cancel', s => !s.modal);
  }
  pinch('Play_chapters', s => s.screen === 'chapters');
  await capture('chapters', 'Chapters', 'Main menus');
  for (const index of [0, 1]) {
    if (hasCapture(`Chapter 0${index + 1} preview`)) continue;
    pinch(`Chapter_chapter-0${index + 1}`, s => s.modal === 'chapter-preview' && s.chapterIndex === index);
    await capture(`chapter-${index + 1}-preview`, `Chapter 0${index + 1} preview`, 'Dialogs');
    pinch('Btn_Cancel', s => !s.modal);
  }
  pinch('Btn_Back', s => s.screen === 'play');
  pinch('Btn_Back', s => s.modal === 'quit');
  await capture('return-home', 'Return to Home confirmation', 'Dialogs');
  pinch('Btn_Cancel', s => !s.modal);
  pinch('Nav_Showcase', s => s.screen === 'showcase');
  await capture('showcase', 'Showcase', 'Main menus');
  pinch('Showcase_battles', s => s.screen === 'library');
  await capture('ai-battles', 'AI Battles', 'Showcase');
  pinch('Btn_Back', s => s.screen === 'showcase');
  pinch('Showcase_arenas', s => s.screen === 'arenas');
  for (let index = 0; index < 4; index++) {
    if (hasCapture(`Arena 0${index + 1}`)) continue;
    pinch(`Arena_${index}`, s => s.arenaIndex === index);
    await capture(`arena-${index + 1}`, `Arena 0${index + 1}`, 'Showcase');
  }
  pinch('Btn_Back', s => s.screen === 'showcase');
  pinch('Showcase_replays', s => s.screen === 'library');
  await capture('match-replays', 'Match Replays — future', 'Showcase');
  pinch('Btn_Back', s => s.screen === 'showcase');
  }
  pinch('Nav_Settings', s => s.screen === 'settings');
  await capture('settings', 'Settings', 'Main menus');
  for (const category of ['general', 'controls', 'input', 'video', 'audio', 'credits']) {
    if (hasCapture(`Settings — ${category[0].toUpperCase() + category.slice(1)}`)) continue;
    pinch(`Settings_${category}`, s => s.category === category);
    await capture(`settings-${category}`, `Settings — ${category[0].toUpperCase() + category.slice(1)}`, 'Settings');
    pinch('Btn_Back', s => !s.category);
  }
  pinch('Btn_Pause', s => s.paused);
  await capture('pause', 'Pause / Resume', 'Entry & visit');
  pinch('Btn_Resume', s => !s.paused);
  pinch('Nav_Home', s => s.screen === 'home');
  evidence.finalState = state();
  evidence.device = cli('xr', 'get-device-state', {});
  evidence.session = cli('xr', 'status');
  evidence.complete = true;
  await save();
  console.log(`DONE: ${evidence.captures.length} actual Quest screen captures`);
} catch (error) { evidence.error = String(error.stack || error); await save(); throw error; }
