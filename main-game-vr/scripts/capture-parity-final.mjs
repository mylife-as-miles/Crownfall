import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { enterQuestXR } from './enter-quest.mjs';
const directory = 'artifacts/parity/final'; await mkdir(directory, { recursive: true });
function cli(domain, action, input, extra = []) {
  const p = spawnSync('npx', ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra], { encoding: 'utf8', timeout: 65000 });
  const response = JSON.parse(p.stdout || p.stderr); if (!response.ok) throw Error(JSON.stringify(response.error)); return response.data.result ?? response.data;
}
enterQuestXR(cli);
cli('xr', 'set-input-mode', { mode: 'hand' });
for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
cli('xr', 'set-connected', { device: 'hand-left', connected: true });
cli('xr', 'set-connected', { device: 'hand-right', connected: false });
cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
cli('xr', 'set-transform', { device: 'hand-left', anchor: 'target-ray', position: { x: -.3, y: 1, z: -.35 } });
const entityIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
const state = () => cli('ecs', 'query', { entityIndex }).components.find(c => c.componentId === 'CrownfallQuestState').values;
const result = { profile: 'Active mono IWER Quest3,60-degree close view; default head pose, one tracked hand lowered for unobstructed composition; both controllers disconnected', captures: [], final: null };
function aim(id) { const target = cli('xr', 'list-targets').targets.find(t => t.name === id); assert.ok(target, id); cli('xr', 'look-at', { device: 'hand-left', target: target.position }); }
function select(id, expected) {
  cli('xr', 'set-transform', { device: 'hand-left', anchor: 'target-ray', position: { x: -.25, y: 1.5, z: -.4 } });
  for (let attempt = 0; attempt < 3; attempt++) {
    aim(id); const hovered = cli('ui', 'inspect', { entityIndex, selector: `#${id}` }).elements[0].state.hovered; assert.ok(hovered, id);
    cli('xr', 'select', { device: 'hand-left', duration: .01 }); if (expected(state())) return;
  }
  throw Error(`Selection failed: ${id}`);
}
function capture(name, selection) {
  cli('xr', 'set-transform', { device: 'hand-left', anchor: 'target-ray', position: { x: -.3, y: 1, z: -.35 } });
  if (selection) { aim(selection); assert.equal(state().selectedControl, selection); }
  const metadata = cli('browser', 'screenshot', undefined, ['--output-file', `${directory}/${name}.png`]);
  result.captures.push({ name, metadata, state: state() }); console.log(`CAPTURE final ${name}`);
}
if (state().paused) select('Btn_Resume', s => !s.paused);
if (state().screen === 'onboarding') select('Btn_SkipVisit', s => s.screen === 'home');
if (state().modal) select('Btn_Cancel', s => !s.modal);
if (state().screen !== 'home') select('Nav_Home', s => s.screen === 'home');
for (const [name, selected] of [['home', 'Home_legacy'], ['play', 'Play_local-duel'], ['showcase', 'Showcase_battles'], ['settings', 'Settings_general']]) {
  if (state().screen !== name) select(`Nav_${name[0].toUpperCase() + name.slice(1)}`, s => s.screen === name);
  capture(name, selected);
  if (name === 'play') {
    select('Play_classic', s => s.modal === 'classic'); capture('modal');
    select('Btn_Cancel', s => !s.modal);
    select('Play_chapters', s => s.screen === 'chapters'); capture('chapters', 'Chapter_chapter-01');
    select('Btn_Back', s => s.screen === 'play');
  }
  if (name === 'settings') {
    select('Settings_video', s => s.category === 'video'); capture('settings-detail');
    select('Btn_Back', s => !s.category);
  }
}
select('Nav_Home', s => s.screen === 'home');
result.final = { state: state(), session: cli('xr', 'status'), device: cli('xr', 'get-device-state', {}) };
await writeFile(`${directory}/evidence.json`, JSON.stringify(result, null, 2) + '\n');
console.log('PASS final corrected composition with real one-hand navigation');
