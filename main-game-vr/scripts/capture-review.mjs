import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = 'artifacts/final';
await mkdir(directory, { recursive: true });
function cli(domain, action, input, extra = []) {
  const result = spawnSync('npx', ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra], { encoding: 'utf8', timeout: 65000 });
  const response = JSON.parse(result.stdout || result.stderr);
  if (!response.ok) throw Error(JSON.stringify(response.error));
  return response.data.result ?? response.data;
}
if (!cli('xr', 'status').sessionActive) cli('xr', 'enter', {});
cli('xr', 'set-input-mode', { mode: 'hand' });
for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
cli('xr', 'set-device-state', { state: { stereoEnabled: false } });
const entityIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
const state = () => cli('ecs', 'query', { entityIndex }).components.find(item => item.componentId === 'CrownfallQuestState').values;
const evidence = { profile: { runtime: 'Active IWER Meta Quest 3, mono emulator rendering', input: 'hand ray/pinch only, both controllers disconnected', requestedDevelopmentFramebufferScale: .25, actualFramebufferSize: 'not measured', physicalHeadset: false }, captureLimit: 'Stereo capture timed out and the managed browser closed on this software host. One managed recovery was used; this capture uses mono emulation and makes no physical performance claim.', captures: [], interactions: [] };
const device = cli('xr', 'get-device-state', {});
assert.equal(device.stereoEnabled, false);
assert.equal(device.inputMode, 'hand');
assert.equal(device.controllers.left.connected, false);
assert.equal(device.controllers.right.connected, false);
assert.equal(cli('xr', 'status').sessionActive, true);
function pinch(id, expected) {
  const target = cli('xr', 'list-targets').targets.find(item => item.name === id);
  assert.ok(target, id);
  cli('xr', 'look-at', { device: 'hand-right', target: target.position });
  cli('xr', 'select', { device: 'hand-right', duration: .01 });
  const after = state();
  assert.ok(expected(after), `${id}: ${JSON.stringify(after)}`);
  evidence.interactions.push({ id, after });
}
function capture(name) {
  const output = `${directory}/${name}.png`;
  const metadata = cli('browser', 'screenshot', undefined, ['--output-file', output]);
  evidence.captures.push({ output, state: state(), metadata });
  console.log(`Captured ${name}`);
}
if (state().paused) pinch('Btn_Resume', s => !s.paused);
assert.equal(state().screen, 'home');
pinch('Nav_Play', s => s.screen === 'play' && !s.modal && !s.paused);
pinch('Nav_Home', s => s.screen === 'home');
capture('home-xr');
evidence.finalState = state();
evidence.device = cli('xr', 'get-device-state', {});
evidence.session = cli('xr', 'status');
await writeFile(`${directory}/capture-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
console.log('PASS mono emulated hand navigation and final active Home');
