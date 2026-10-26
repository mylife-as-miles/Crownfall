import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { enterQuestXR } from './enter-quest.mjs';

const directory = 'artifacts/hands';
await mkdir(directory, { recursive: true });
const main = JSON.parse(await readFile(`${directory}/verification.json`, 'utf8'));
const previousExit = JSON.parse(await readFile(`${directory}/exit-postcondition.json`, 'utf8'));
const evidence = {
  passed: false,
  profile: { sdk: '1.1.0-rc.2', runtime: 'Existing IWER Meta Quest 3 managed window', input: 'Real hand ray + .01-second pinch; both controllers disconnected', physicalHeadset: false },
  checks: [], interactions: [], observations: {},
  limitations: main.limitations,
};
function cli(domain, action, input) {
  const result = spawnSync('npx', ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)])], { encoding: 'utf8', timeout: 65000 });
  let response;
  try { response = JSON.parse(result.stdout || result.stderr); }
  catch { throw Error(result.stderr || result.stdout || `CLI ${domain} ${action} did not return JSON`); }
  if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error)), { sdkError: response.error });
  return response.data.result ?? response.data;
}
let entityIndex;
const state = () => {
  const component = cli('ecs', 'query', { entityIndex }).components.find(item => item.componentId === 'CrownfallQuestState');
  assert.ok(component, 'The discovered entity still carries CrownfallQuestState');
  return component.values;
};
const record = (check) => { evidence.checks.push(check); console.log(`PASS ${check}`); };
const inspect = (id) => cli('ui', 'inspect', { entityIndex, selector: `#${id}` }).elements[0];
const poll = (expected) => {
  let value;
  for (let attempt = 0; attempt < 6; attempt++) { value = state(); if (expected(value)) return value; }
  assert.ok(expected(value), `Expected app state was not reached: ${JSON.stringify(value)}`);
};
const identity = () => {
  const entities = cli('ecs', 'find', { namePattern: '^Crownfall Sorcerer$', limit: 10 }).entities;
  assert.equal(entities.length, 1, 'Exactly one loaded hero entity exists');
  const entity = entities[0];
  return Object.fromEntries(Object.entries(entity).filter(([key]) => /^(entityIndex|entityId|id|uuid|version|generation|name)$/.test(key)));
};
function sameComfort(actual, expected) {
  for (const key of ['quality', 'textScale', 'posture', 'motion']) assert.equal(actual[key], expected[key], `${key} retained`);
  assert.ok(Math.abs(actual.panelDistance - expected.panelDistance) < .01, 'Menu distance retained');
}
function pinch(id, expected) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = cli('xr', 'list-targets').targets.find(item => item.name === id);
    assert.ok(target, `Visible hand target exists: ${id}`);
    cli('xr', 'look-at', { device: 'hand-right', target: target.position });
    const control = inspect(id);
    assert.ok(control?.state.visible && control.state.displayed && !control.state.disabled && control.state.hovered, `Right hand ray reaches the enabled ${id}`);
    cli('xr', 'select', { device: 'hand-right', duration: .01 });
    let after;
    for (let query = 0; query < 3; query++) { after = state(); if (expected(after)) break; }
    evidence.interactions.push({ id, device: 'hand-right', attempt: attempt + 1, after });
    if (expected(after)) return after;
  }
  throw Error(`Actual hand pinch did not reach the expected state: ${id}`);
}
function assertHands() {
  const device = cli('xr', 'get-device-state', {});
  assert.equal(device.inputMode, 'hand');
  assert.equal(device.controllers.left.connected, false); assert.equal(device.controllers.right.connected, false);
  return device;
}
let failure;
try {
  const managed = cli('dev', 'status').state;
  assert.equal(managed.browserCommandReady, true, 'Use the already-ready managed browser');
  evidence.observations.managedRuntime = { sessionId: managed.session.sessionId, browserEpoch: managed.session.browser.lifecycle.browserEpoch };
  const initialStatus = cli('xr', 'status');
  if (!initialStatus.sessionActive) enterQuestXR(cli);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  for (const [device, x] of [['hand-left', -.25], ['hand-right', .25]]) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 1.3, z: -.35 } });
  const entities = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities;
  assert.equal(entities.length, 1); entityIndex = entities[0].entityIndex;
  if (state().paused) pinch('Btn_Resume', s => !s.paused);
  const initial = poll(s => s.entered && s.modelReady && s.screen === 'home' && !s.paused && !s.modal);
  sameComfort(initial, previousExit.state);
  const hero = identity(), session = cli('xr', 'status'), device = assertHands();
  assert.equal(session.sessionActive, true); assert.ok(session.enabledFeatures.includes('hand-tracking'));
  assert.equal(device.hands.left.connected, true); assert.equal(device.hands.right.connected, true);
  evidence.observations.initial = { state: initial, hero, session, device };
  record('The existing immersive runtime enters Home with hand tracking, both controllers disconnected, the real hero loaded and the known comfort preferences retained');

  pinch('Nav_Play', s => s.screen === 'play');
  pinch('Play_classic', s => s.modal === 'classic');
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: false });
  const lost = poll(s => s.paused && s.modal === 'classic' && !s.leftTracked && !s.rightTracked);
  const frozen = state(); assert.equal(lost.animationTime, frozen.animationTime);
  const lostDevice = assertHands(); assert.equal(lostDevice.hands.left.connected, false); assert.equal(lostDevice.hands.right.connected, false);
  cli('xr', 'set-connected', { device: 'hand-right', connected: true });
  const recovered = poll(s => s.rightTracked && s.paused && s.modal === 'classic');
  pinch('Btn_Resume', s => !s.paused && s.modal === 'classic' && s.screen === 'play');
  pinch('Btn_Cancel', s => !s.modal && s.screen === 'play');
  pinch('Nav_Home', s => s.screen === 'home');
  cli('xr', 'set-connected', { device: 'hand-left', connected: true });
  evidence.observations.trackingLoss = { lost, frozen, recovered, device: lostDevice };
  record('Disconnecting both real emulated hands pauses and freezes Idle while preserving the Classic modal; reconnecting one hand requires an explicit hand Resume, then Cancel returns safely to Play/Home');

  pinch('Btn_VisitReplay', s => s.screen === 'visit' && s.visitStep === 0 && !s.visitComplete);
  pinch('Btn_VisitNext', s => s.visitStep === 1 && !s.visitComplete);
  pinch('Btn_VisitNext', s => s.visitStep === 2 && !s.visitComplete);
  const completed = pinch('Btn_VisitFinish', s => s.screen === 'visit' && s.visitComplete);
  assert.equal(inspect('Visit_Title').text, 'VISIT COMPLETE');
  assert.equal(inspect('Visit_Count').text, 'Three arenas explored');
  pinch('Btn_Back', s => s.screen === 'home' && s.visitComplete);
  evidence.observations.replayComplete = completed;
  record('The new Home Replay action restarts and completes all three arena steps through real Next/Finish/Back hand selections, without direct progress mutation');

  const beforeExit = state(), beforeHero = identity();
  const target = cli('xr', 'list-targets').targets.find(item => item.name === 'Btn_Exit'); assert.ok(target);
  cli('xr', 'look-at', { device: 'hand-right', target: target.position });
  const exitControl = inspect('Btn_Exit'); assert.ok(exitControl.state.visible && exitControl.state.displayed && !exitControl.state.disabled && exitControl.state.hovered);
  let acknowledgement;
  try { cli('xr', 'select', { device: 'hand-right', duration: .01 }); }
  catch (error) {
    if (error.sdkError?.code !== 'runtime_command_failed' || error.sdkError?.message !== 'The XR session ended.') throw error;
    acknowledgement = error.sdkError;
  }
  const exitedSession = cli('xr', 'status'), exited = poll(s => !s.entered);
  assert.equal(exitedSession.sessionActive, false); assert.equal(exited.entered, false);
  sameComfort(exited, beforeExit); assert.deepEqual(identity(), beforeHero);
  evidence.observations.exit = { selectionAttempts: 1, acknowledgement: acknowledgement || 'Command completed normally', sessionActive: exitedSession.sessionActive, state: exited, hero: beforeHero };
  record('One real hand Exit ends the immersive session; the expected SDK ended-session acknowledgement is accepted only after inactive-session and entered=false postconditions, without retrying Exit');

  enterQuestXR(cli);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  const reentered = poll(s => s.entered && s.screen === 'home' && !s.paused && s.modelReady);
  sameComfort(reentered, beforeExit); assert.deepEqual(identity(), beforeHero); assert.deepEqual(beforeHero, hero);
  const releases = [];
  for (const device of ['hand-left', 'hand-right']) releases.push({ device, result: cli('xr', 'run-sequence', { device, steps: [{ pinch: 0, duration: .15 }] }) });
  const finalSession = cli('xr', 'status'), finalDevice = assertHands(), finalState = state();
  assert.equal(finalSession.sessionActive, true); assert.equal(finalState.entered, true); assert.equal(finalState.screen, 'home');
  const finalManaged = cli('dev', 'status').state;
  assert.equal(finalManaged.session.sessionId, managed.session.sessionId); assert.equal(finalManaged.session.browser.lifecycle.browserEpoch, managed.session.browser.lifecycle.browserEpoch);
  evidence.observations.final = { session: finalSession, device: finalDevice, state: finalState, hero: identity(), releases, releasedBy: 'Supported xr run-sequence pinch:0 for both hands' };
  evidence.passed = true;
  record('Exit/reentry preserves Home, exact comfort preferences and the same hero entity; final XR remains active with both controllers disconnected and both hand pinches explicitly released');
} catch (error) { failure = error; evidence.failure = String(error.stack || error); }
finally {
  await writeFile(`${directory}/session-verification.json`, JSON.stringify(evidence, null, 2) + '\n');
  let priorFailure;
  try { priorFailure = JSON.parse(main.failure?.split('\n')[0].replace(/^Error:\s*/, '')); } catch { /* A different failure must not be marked resolved. */ }
  const originalExitAcknowledgement = main.passed === false && main.checks.length === 6 && priorFailure?.code === 'runtime_command_failed' && priorFailure?.message === 'The XR session ended.';
  const provenExit = previousExit.passed === true && previousExit.sessionActive === false && previousExit.state.entered === false;
  const result = {
    passed: originalExitAcknowledgement && provenExit && evidence.passed,
    scope: 'Composed runtime closeout: preserved six-group main UI evidence plus verified Exit postconditions and focused hand-only session/replay recovery. The full main gesture loop was not rerun.',
    sources: { main: `${directory}/verification.json`, initialExit: `${directory}/exit-postcondition.json`, session: `${directory}/session-verification.json` },
    main: { rawPassed: main.passed, passedChecks: main.checks, rawFailurePreserved: main.failure },
    resolution: { originalFailureWasEndedSessionAcknowledgement: originalExitAcknowledgement, initialExitPostconditionsPassed: provenExit, focusedSessionPassed: evidence.passed, note: 'The initial raw failed report is preserved. Its Exit acknowledgement handling is fixed in the runner; successful application Exit and subsequent hand-only replay/reentry are established by separate named-state evidence, not by silently changing that raw report.' },
    sessionChecks: evidence.checks,
    limitations: evidence.limitations,
    ...(failure ? { failure: evidence.failure } : {}),
  };
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2) + '\n');
}
if (failure) throw failure;
