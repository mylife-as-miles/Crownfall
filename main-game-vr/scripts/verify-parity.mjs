import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { enterQuestXR } from './enter-quest.mjs';

const directory = 'artifacts/parity'; await mkdir(directory, { recursive: true });
const evidence = process.argv.includes('--resume') ? JSON.parse(await readFile(`${directory}/verification.json`, 'utf8')) : { passed: false, profile: 'Actual IWER hand ray/pinch input; mono software emulator, close-view captures at60 degrees; production layout unchanged by capture framing', checks: [], captures: [], interactions: [] };
if (evidence.error) { (evidence.previousErrors ||= []).push(evidence.error); delete evidence.error; }
function cli(domain, action, input, extra = []) {
  const result = spawnSync('npx', ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra], { encoding: 'utf8', timeout: 65000, maxBuffer: 10 * 1024 * 1024 });
  const response = JSON.parse(result.stdout || result.stderr);
  if (!response.ok) throw Error(JSON.stringify(response.error));
  return response.data.result ?? response.data;
}
let entityIndex;
const state = () => cli('ecs', 'query', { entityIndex }).components.find(item => item.componentId === 'CrownfallQuestState').values;
const inspect = id => cli('ui', 'inspect', { entityIndex, selector: `#${id}` }).elements[0];
function size(id, width, height) {
  const actual = inspect(id).layout.size;
  assert.ok(Math.abs(actual[0] - width) < .002 && Math.abs(actual[1] - height) < .002, `${id} preserves ${width}x${height}: ${actual}`);
}
const record = text => { if (!evidence.checks.includes(text)) evidence.checks.push(text); console.log(`PASS ${text}`); };
function select(id, expected) {
  for (const device of ['hand-left', 'hand-right']) {
    const target = cli('xr', 'list-targets').targets.find(item => item.name === id); assert.ok(target, id);
    cli('xr', 'look-at', { device, target: target.position });
    const control = inspect(id);
    if (!control.state.visible || !control.state.displayed || !control.state.hovered) { evidence.interactions.push({ id, device, aim: control.state }); continue; }
    cli('xr', 'select', { device, duration: .01 });
    const after = state(); evidence.interactions.push({ id, device, after });
    if (expected(after)) return after;
  }
  throw Error(`Actual hand selection did not reach expected state: ${id}`);
}
function capture(name) {
  if (evidence.captures.some(item => item.name === name)) return;
  assert.equal(cli('xr', 'status').sessionActive, true);
  const metadata = cli('browser', 'screenshot', undefined, ['--output-file', `${directory}/${name}.png`]);
  evidence.captures.push({ name, state: state(), metadata }); console.log(`CAPTURE ${name}`);
}
try {
  entityIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
  enterQuestXR(cli);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 90 } });
  if (state().paused) select('Btn_Resume', s => !s.paused);
  if (state().screen === 'onboarding') select('Btn_SkipVisit', s => s.screen === 'home');
  if (state().screen !== 'home') select('Nav_Home', s => s.screen === 'home');
  let ready; for (let attempt = 0; attempt < 6; attempt++) { ready = state(); if (ready.modelReady) break; }
  assert.ok(ready.modelReady && ready.entered && ready.handsTracked);
  capture('home-default-xr');
  cli('xr', 'set-device-state', { state: { fov: 60 } });
  capture('home');
  size('Home_legacy', 298, 434);
  size('Home_chronicles', 298, 215);
  record('Home keeps the desktop600x434 grid and full-art tile sizes in an active hand-tracked session');
  select('Nav_Play', s => s.screen === 'play');
  if (!evidence.checks.some(check => check.startsWith('Four197x298'))) {
    for (const id of ['classic', 'local-duel', 'chapters', 'online-duel']) size(`Play_${id}`, 197, 298);
    capture('play');
    select('Play_classic', s => s.modal === 'classic' && s.selectedControl === 'Play_classic');
    assert.equal(inspect('Nav_Home').state.displayed, false);
    capture('modal');
    select('Btn_Cancel', s => !s.modal && s.screen === 'play');
    record('Four197x298 full-art Play cards, persistent hand selection and isolated reference modal preserve actual interaction');
  }
  select('Play_chapters', s => s.screen === 'chapters');
  capture('chapters');
  assert.equal(inspect('Nav_Play').state.displayed, false);
  if (!evidence.interactions.some(item => item.id === 'Chapter_chapter-03' && item.after?.chapterIndex === 2)) select('Chapter_chapter-03', s => s.chapterIndex === 2 && !s.modal);
  select('Btn_Back', s => s.screen === 'play');
  select('Nav_Showcase', s => s.screen === 'showcase');
  capture('showcase');
  select('Showcase_battles', s => s.screen === 'library');
  select('Btn_ExploreArenas', s => s.screen === 'arenas');
  select('Arena_3', s => s.arenaIndex === 3);
  record('Desktop chapter grid/locks and Showcase full-image routes retain real hand navigation and the Explore Arenas destination');
  select('Nav_Settings', s => s.screen === 'settings' && !s.category);
  for (const category of ['general', 'controls', 'input', 'video', 'audio', 'credits']) size(`Settings_${category}`, 300, 219);
  capture('settings');
  select('Settings_video', s => s.category === 'video');
  capture('settings-detail');
  size('Setting_0', 544, 35);
  const before = state(); select('Setting_0', s => s.quality !== before.quality);
  select('Setting_0', s => s.quality !== before.quality); // second valid cycle; exact preference is restored below
  select('Setting_0', s => s.quality === before.quality);
  select('Btn_Pause', s => s.paused);
  const frozen = state(); assert.equal(state().animationTime, frozen.animationTime);
  select('Btn_Resume', s => !s.paused && s.category === 'video');
  select('Btn_Back', s => !s.category);
  select('Settings_general', s => s.category === 'general');
  select('Setting_1', s => !s.motion);
  const reduced = state(); assert.equal(state().animationTime, reduced.animationTime);
  select('Setting_1', s => s.motion);
  select('Btn_Back', s => !s.category);
  select('Nav_Home', s => s.screen === 'home');
  record('Desktop settings hub/list geometry, real quality changes, pause/resume and motion-off/on work with hands without changing the desktop proportions');
  evidence.finalState = state(); evidence.device = cli('xr', 'get-device-state', {}); evidence.session = cli('xr', 'status');
  assert.equal(evidence.device.controllers.left.connected, false); assert.equal(evidence.device.controllers.right.connected, false);
  evidence.passed = true;
} catch (error) { evidence.error = String(error.stack || error); throw error; }
finally { await writeFile(`${directory}/verification.json`, JSON.stringify(evidence, null, 2) + '\n'); }
