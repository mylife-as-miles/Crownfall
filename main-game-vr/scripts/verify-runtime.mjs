import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = 'artifacts/hands'; await mkdir(directory, { recursive: true });
const evidence = { passed: false, profile: { sdk: '1.1.0-rc.2', runtime: 'IWER Meta Quest 3', inputs: 'hand ray + pinch only; no controller selection', developmentFramebufferScale: .25, pinchHoldSeconds: .01, physicalHeadset: false }, checks: [], interactions: [], limitations: ['Physical Quest tracking, comfort, cold start and GPU frame pacing are unmeasured.', 'Default direct-poke helper exceeded its 800ms contact window under software rendering; direct touch is not claimed as a passed runtime test.'] };
function cli(domain, action, input, extra = []) {
  const args = ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra];
  const result = spawnSync('npx', args, { encoding: 'utf8', timeout: 65000 });
  let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(result.stderr || result.stdout); }
  if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error)), { sdkError: response.error });
  return response.data.result;
}
let entityIndex;
const state = () => cli('ecs', 'query', { entityIndex }).components.find(component => component.componentId === 'CrownfallQuestState').values;
const record = (check) => { evidence.checks.push(check); console.log(`PASS ${check}`); };
function inspect(id) { return cli('ui', 'inspect', { entityIndex, selector: `#${id}` }).elements[0]; }
function pinch(id, expected, device = 'hand-right') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = cli('xr', 'list-targets').targets.find(target => target.name === id);
    assert.ok(target, `Visible hand target exists: ${id}`);
    cli('xr', 'look-at', { device, target: target.position });
    const before = inspect(id); assert.ok(before.state.visible && before.state.displayed && !before.state.disabled, id);
    assert.ok(before.state.hovered, `The hand ray reaches ${id}`);
    cli('xr', 'select', { device, duration: .01 });
    let after;
    for (let poll = 0; poll < 3; poll++) { after = state(); if (expected(after)) break; }
    evidence.interactions.push({ id, device, attempt: attempt + 1, after });
    if (expected(after)) return after;
  }
  throw Error(`Hand pinch did not produce the expected state for ${id}`);
}
try {
  let status = cli('xr', 'status'); if (!status.sessionActive) cli('xr', 'enter', {});
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  for (const [device, x] of [['hand-left', -.25], ['hand-right', .25]]) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 1.3, z: -.35 } });
  entityIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
  const device = cli('xr', 'get-device-state', {});
  assert.equal(device.inputMode, 'hand'); assert.equal(device.controllers.left.connected, false); assert.equal(device.controllers.right.connected, false);
  status = cli('xr', 'status'); assert.equal(status.sessionActive, true); assert.ok(status.enabledFeatures.includes('hand-tracking'));
  evidence.initialSession = { active: status.sessionActive, features: status.enabledFeatures, inputMode: device.inputMode, controllers: device.controllers, hands: { left: device.hands.left.connected, right: device.hands.right.connected } };
  record('Active immersive session requires hand tracking, with both controllers disconnected and both hands available');
  let s = state(); if (s.paused) pinch('Btn_Resume', s => !s.paused);
  s = state();
  if (s.screen === 'visit') pinch('Btn_Back', s => s.screen === 'onboarding' || s.screen === 'home');
  const startVisit = state().screen === 'home' ? 'Btn_VisitReplay' : 'Btn_StartVisit';
  pinch(startVisit, s => s.screen === 'visit' && s.visitStep === 0 && !s.visitComplete);
  pinch('Btn_VisitNext', s => s.visitStep === 1);
  pinch('Btn_VisitNext', s => s.visitStep === 2);
  pinch('Btn_VisitFinish', s => s.visitComplete);
  cli('browser', 'screenshot', undefined, ['--output-file', `${directory}/visit-complete.png`]);
  record('The three-arena visit reaches explicit completion entirely through hand pinches, with no timer or controller');
  pinch('Btn_Back', s => s.screen === 'home', 'hand-left');
  pinch('Home_legacy', s => s.modal === 'legacy'); pinch('Btn_Cancel', s => !s.modal);
  pinch('Nav_Play', s => s.screen === 'play');
  for (const id of ['classic', 'local-duel', 'online-duel']) { pinch(`Play_${id}`, s => s.modal === id); assert.equal(inspect('Nav_Home').state.displayed, false); pinch('Btn_Confirm', s => !s.modal); }
  pinch('Play_chapters', s => s.screen === 'chapters');
  pinch('Chapter_chapter-03', s => s.chapterIndex === 2 && !s.modal);
  pinch('Chapter_chapter-02', s => s.modal === 'chapter-preview'); pinch('Btn_Cancel', s => !s.modal);
  pinch('Btn_Back', s => s.screen === 'play');
  record('Home, mode previews, modal isolation and available/locked Chapters all work with hands and remain honest previews');
  pinch('Nav_Showcase', s => s.screen === 'showcase'); pinch('Showcase_arenas', s => s.screen === 'arenas');
  for (let index = 0; index < 4; index++) pinch(`Arena_${index}`, s => s.arenaIndex === index);
  assert.equal(inspect('Arena_Count').text, '4 / 4');
  pinch('Btn_Back', s => s.screen === 'showcase'); pinch('Showcase_replays', s => s.screen === 'library'); pinch('Btn_Back', s => s.screen === 'showcase');
  record('All four arena images and the honest future replay view are reachable through hand-only Showcase navigation');
  pinch('Nav_Settings', s => s.screen === 'settings');
  for (const category of ['general', 'controls', 'input', 'audio', 'credits']) { pinch(`Settings_${category}`, s => s.category === category); pinch('Btn_Back', s => !s.category); }
  pinch('Settings_video', s => s.category === 'video');
  const before = state(); pinch('Setting_0', s => s.quality !== before.quality);
  const priorTextScale = state().textScale; pinch('Setting_1', s => s.textScale !== priorTextScale);
  const priorDistance = state().panelDistance; pinch('Setting_2', s => Math.abs(s.panelDistance - priorDistance) > .01);
  const priorPosture = state().posture; pinch('Setting_3', s => s.posture !== priorPosture);
  const running = state(); pinch('Btn_Pause', s => s.paused);
  const stopped = state(); const still = state(); assert.equal(stopped.animationTime, still.animationTime);
  pinch('Btn_Resume', s => !s.paused && s.category === 'video' && s.textScale === running.textScale);
  record('Every settings category and actual comfort changes work with hands; Pause freezes Idle and Resume retains the exact page/preferences');
  pinch('Btn_Back', s => !s.category); pinch('Nav_Play', s => s.screen === 'play');
  pinch('Btn_Back', s => s.modal === 'quit'); pinch('Btn_Cancel', s => !s.modal && s.screen === 'play');
  pinch('Btn_Back', s => s.modal === 'quit'); pinch('Btn_Confirm', s => !s.modal && s.screen === 'home');
  record('Hand Confirm and Cancel choose distinct Home/Play destinations without a keyboard or controller');
  cli('browser', 'screenshot', undefined, ['--output-file', `${directory}/home-xr.png`]);
  const target = cli('xr', 'list-targets').targets.find(t => t.name === 'Btn_Exit');
  assert.ok(target, 'Visible Exit hand target exists');
  cli('xr', 'look-at', { device: 'hand-right', target: target.position });
  assert.ok(inspect('Btn_Exit').state.hovered, 'The hand ray reaches Exit');
  let exitAcknowledgement;
  try { cli('xr', 'select', { device: 'hand-right', duration: .01 }); }
  catch (error) {
    if (error.sdkError?.code !== 'runtime_command_failed' || error.sdkError?.message !== 'The XR session ended.') throw error;
    exitAcknowledgement = error.sdkError;
  }
  status = cli('xr', 'status'); const exitedState = state();
  evidence.exit = { acknowledgement: exitAcknowledgement || 'Command completed normally', sessionActive: status.sessionActive, entered: exitedState.entered, selectionAttempts: 1 };
  assert.equal(status.sessionActive, false); assert.equal(exitedState.entered, false);
  record('Exit VR ends the real immersive session from an on-screen hand action');
  evidence.finalState = state(); evidence.passed = true;
} catch (error) { evidence.failure = String(error.stack || error); throw error; }
finally { await writeFile(`${directory}/verification.json`, JSON.stringify(evidence, null, 2) + '\n'); }
