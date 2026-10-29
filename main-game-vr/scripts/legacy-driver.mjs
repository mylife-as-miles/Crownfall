// Shared hand-only driver for the Quest My Legacy runtime scripts (verify-legacy.mjs and
// capture-legacy.mjs). Everything runs through the IWSDK CLI against the managed runtime in
// IWER browser emulation: real hand rays and pinches, fingertip presses for poke, and the named
// Legacy fields of CrownfallQuestState for state. None of this is a physical headset.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { enterQuestXR } from './enter-quest.mjs';

/** Software-rendered frames can be slow on a shared host; each pinch retry holds a little longer. */
export const PINCH_HOLDS = [0.01, 0.15, 0.3];
/** Menu pinches look almost straight down so the 80k-triangle hero leaves the view (see the README). */
export const HOME_HEAD_PITCH_DEGREES = 88;
/** Errors that mean the managed browser itself went away; the app reloaded and a flow must start again. */
export const browserLost = (error) => /Browser not ready|browser_relaunched|Managed browser is closing|Target disconnected|connection_lost|browser_command_timeout|browser_not_launched/
  .test(String(error?.message || error));

/** Waits on the host without a busy loop (Monitor-free scripts run outside the agent). */
export const sleep = (seconds) => { spawnSync('sleep', [String(seconds)]); };

export function createLegacyDriver({ log = console.log } = {}) {
  const bin = existsSync('node_modules/.bin/iwsdk') ? ['node_modules/.bin/iwsdk'] : ['npx', '--no-install', '@iwsdk/cli'];
  const interactions = [];
  const emulatorScale = (() => { try { return Number(/VITE_CROWNFALL_EMULATOR_SCALE=([\d.]+)/.exec(readFileSync('.env.local', 'utf8'))?.[1]) || 1; } catch { return 1; } })();

  function run(args, env = {}, timeout = 120000) {
    const [command, ...prefix] = bin;
    const result = spawnSync(command, [...prefix, ...args], { encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...env } });
    let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(result.stderr || result.stdout || `${args.join(' ')} returned no JSON`); }
    if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error)), { sdkError: response.error });
    return response.data.result ?? response.data;
  }
  const cli = (domain, action, input, extra = []) => run([domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra]);
  /** Runs a scripts/*.mjs browser-runner entry with the given environment (runtime started with --allow-browser-automation). */
  const browserRun = (script, env, timeout = 90000) => run(['browser', 'run', script, '--timeout', String(timeout - 30000)], env, timeout);

  let stateIndex = null, panelIndex = null, dockIndex = null;
  const findIndex = (pattern) => cli('ecs', 'find', { namePattern: pattern, limit: 5 }).entities[0]?.entityIndex ?? null;
  function discover() {
    stateIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
    // The Legacy panels exist only once My Legacy has been opened in this page.
    panelIndex = findIndex('^My Legacy Panel$');
    dockIndex = findIndex('^My Legacy Dock$');
  }
  const state = () => cli('ecs', 'query', { entityIndex: stateIndex, components: ['CrownfallQuestState'] }).components[0].values;
  const fields = (s) => Object.fromEntries(Object.entries(s).filter(([key]) => key.startsWith('legacy') || ['screen', 'paused', 'entered', 'pauseReason', 'textScale', 'posture', 'panelDistance', 'panelHeight', 'leftTracked', 'rightTracked'].includes(key)));
  function owner(id) {
    if (!id.startsWith('Legacy')) return stateIndex;
    if (panelIndex === null || dockIndex === null) discover();
    return id.startsWith('Legacy_Dock') ? dockIndex : panelIndex;
  }
  const inspect = (id) => cli('ui', 'inspect', { entityIndex: owner(id), selector: `#${id}` }).elements[0];
  function poll(expected, attempts = 8) {
    let value;
    for (let attempt = 0; attempt < attempts; attempt++) { value = state(); if (expected(value)) return value; }
    throw Error(`Expected state was not reached: ${JSON.stringify(fields(value))}`);
  }
  function target(name) {
    const found = cli('xr', 'list-targets').targets.find((item) => item.name === name);
    assert.ok(found, `Visible hand target exists: ${name}`);
    return found;
  }
  /** Head pose for a step: pitch below the horizon and yaw to the left, in degrees, from a fixed eye. */
  function look(pitchDegrees = 0, yawDegrees = 0) {
    const pitch = (-pitchDegrees * Math.PI / 180) / 2, yaw = (yawDegrees * Math.PI / 180) / 2;
    // Yaw then pitch: q = qYaw * qPitch.
    const [px, pw] = [Math.sin(pitch), Math.cos(pitch)], [yy, yw] = [Math.sin(yaw), Math.cos(yaw)];
    cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: yw * px, y: yy * pw, z: -yy * px, w: yw * pw } });
  }
  const restingHand = (device) => ({ x: device === 'hand-right' ? 0.25 : -0.25, y: 1.3, z: -0.35 });
  const signature = (v) => `${v.screen}|${v.modal}|${v.paused}|${v.legacyView}|${v.legacyActive}`;
  /** Aims a hand ray at a control, proves the ray hovers it, pinches, and waits for the expected state. */
  function pinch(id, expected, { device = 'hand-right', pitch = 0, attempts = PINCH_HOLDS.length } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      look(pitch);
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: restingHand(device) });
      cli('xr', 'look-at', { device, target: target(id).position });
      const before = inspect(id);
      if (!before?.state.hovered || !before.state.displayed) { interactions.push({ id, device, kind: 'ray', attempt: attempt + 1, aim: before?.state ?? null }); continue; }
      const start = state();
      const hold = PINCH_HOLDS[attempt % PINCH_HOLDS.length];
      cli('xr', 'select', { device, duration: hold });
      let after;
      for (let query = 0; query < 6; query++) { after = state(); if (expected(after)) break; }
      interactions.push({ id, device, kind: 'ray', attempt: attempt + 1, holdSeconds: hold, legacyView: after.legacyView, screen: after.screen });
      if (expected(after)) { if (pitch) look(0); return after; }
      // A late click that moved somewhere unexpected must not be followed by a blind second press.
      if (signature(after) !== signature(start)) throw Error(`${id} led to an unexpected state: ${signature(after)}`);
    }
    if (pitch) look(0);
    throw Error(`Hand pinch did not produce the expected state for ${id}`);
  }
  const menuPinch = (id, expected, attempts = PINCH_HOLDS.length) => pinch(id, expected, { pitch: HOME_HEAD_PITCH_DEGREES, attempts });
  /**
   * Presses a control with the emulated hand's index fingertip (poke), as a seated viewer would within reach.
   * Records the fingertip contact time and the control's distance from the eye, so reach is evidenced.
   */
  function poke(id, expected, { device = 'hand-right', pitch = 45 } = {}) {
    const control = target(id);
    const eye = { x: 0, y: 1.6, z: 0 };
    const distance = Math.hypot(control.position.x - eye.x, control.position.y - eye.y, control.position.z - eye.z);
    for (let attempt = 0; attempt < 3; attempt++) {
      look(pitch);
      const result = cli('xr', 'run-sequence', { device, steps: [{ target: id, press: {} }] }, ['--timeout', '45000']);
      const press = result.presses?.[0] ?? null;
      let after;
      for (let query = 0; query < 6; query++) { after = state(); if (expected(after)) break; }
      interactions.push({ id, device, kind: 'poke', attempt: attempt + 1, contactMs: press?.contactMs ?? null, distanceFromEye: Number(distance.toFixed(3)), legacyView: after.legacyView });
      if (expected(after)) { look(0); return { state: after, distanceFromEye: distance, press }; }
    }
    look(0);
    throw Error(`Fingertip press did not produce the expected state for ${id}`);
  }
  /** Points a hand ray at a landmark in the holding, proves the environment reports the hover, then pinches it. */
  function pinchLandmark(id, device = 'hand-left') {
    for (let attempt = 0; attempt < PINCH_HOLDS.length; attempt++) {
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: restingHand(device) });
      cli('xr', 'look-at', { device, target: target(`Landmark_${id}`).position });
      let hovered = false;
      for (let query = 0; query < 3 && !hovered; query++) hovered = state().legacyHover === id;
      if (!hovered) { interactions.push({ id: `Landmark_${id}`, device, kind: 'ray', attempt: attempt + 1, hover: state().legacyHover }); continue; }
      cli('xr', 'select', { device, duration: PINCH_HOLDS[attempt] });
      let after;
      for (let query = 0; query < 6; query++) { after = state(); if (after.legacyLandmark === id && after.legacySelectSource === 'world') break; }
      interactions.push({ id: `Landmark_${id}`, device, kind: 'ray', attempt: attempt + 1, holdSeconds: PINCH_HOLDS[attempt], legacyView: after.legacyView });
      if (after.legacyLandmark === id && after.legacySelectSource === 'world') return after;
    }
    throw Error(`Pointing at ${id} in the holding did not open it`);
  }
  /** Lowers both hands with their rays at the floor, so no hover highlight or pointing status is left in a capture. */
  function lowerHands() {
    for (const [device, x] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 0.95, z: -0.3 } });
      cli('xr', 'look-at', { device, target: { x, y: 0, z: -0.35 } });
    }
  }
  function screenshot(file, pitch = 0, yaw = 0) {
    look(pitch, yaw);
    lowerHands();
    const metadata = cli('browser', 'screenshot', undefined, ['--output-file', file]);
    look(0);
    return metadata;
  }
  /** Selects the page's Enter VR control and waits until the immersive session is active. */
  function enterXR() {
    // Entering while the hero model is still decoding has crashed the managed software browser; wait for it first.
    for (let wait = 0; wait < 30; wait++) { try { if (state().modelReady) break; } catch { /* The page is still loading. */ } spawnSync('sleep', ['2']); }
    spawnSync('sleep', ['15']);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { enterQuestXR(cli); } catch (error) {
        if (error.sdkError?.details?.code !== 'browser_command_timeout') throw error;
      }
      for (let tries = 0; tries < 20; tries++) { if (cli('xr', 'status').sessionActive) return; spawnSync('sleep', ['2']); }
    }
    throw Error('The immersive session did not start after Enter VR');
  }
  function prepareHands() {
    cli('xr', 'set-input-mode', { mode: 'hand' });
    for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
    cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
    look(0);
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: restingHand(device) });
  }
  function assertHandsOnly() {
    const device = cli('xr', 'get-device-state', {});
    assert.equal(device.inputMode, 'hand');
    assert.equal(device.controllers.left.connected, false); assert.equal(device.controllers.right.connected, false);
    return device;
  }
  /** Home -> My Legacy from whatever place the runtime is in, with hands only; waits for the lazy load and the holding. */
  function reachLegacy() {
    let s = state();
    if (s.paused) s = s.screen === 'pause' && s.legacyActive ? pinch('Legacy_Resume', (v) => !v.paused) : menuPinch('Btn_Resume', (v) => !v.paused);
    if (s.screen === 'onboarding') s = menuPinch('Btn_SkipVisit', (v) => v.screen === 'home');
    if (!s.legacyActive) {
      if (s.modal) s = menuPinch('Btn_Cancel', (v) => !v.modal);
      if (s.screen !== 'home') s = menuPinch('Nav_Home', (v) => v.screen === 'home');
      s = menuPinch('Home_legacy', (v) => v.screen === 'legacy', 6);
    }
    s = poll((v) => v.legacyLoad === 'ready' && v.legacyActive, 20);
    discover();
    return poll((v) => v.legacyEnvironmentReady && v.legacyView !== 'loading', 12);
  }
  /**
   * Software-emulation setup through the browser runner: a smaller managed viewport, the given Quest comfort
   * preferences and the short visit marked complete (applied on the next load). Returns what was applied.
   */
  function prepareEmulation({ viewport, preferences, reloadIf }) {
    const env = { CROWNFALL_LEGACY_PROBE: 'prepare', CROWNFALL_VIEWPORT: viewport, CROWNFALL_QUEST_PREFERENCES: JSON.stringify(preferences), CROWNFALL_QUEST_VISITED: '1' };
    const applied = browserRun('scripts/verify-legacy.mjs', env);
    let current = null;
    try { discover(); current = state(); } catch { /* The app is still loading. */ }
    if (!current || reloadIf(current)) reload();
    return applied;
  }
  function reload() {
    if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* An ended-session acknowledgement is expected. */ } }
    cli('browser', 'reload', {});
    for (let attempt = 0; attempt < 30; attempt++) { try { discover(); return; } catch { spawnSync('sleep', ['3']); } }
    throw Error('The app did not come back after a reload');
  }
  function waitForRuntime() {
    try { run(['runtime', 'recover'], {}, 180000); } catch { /* Still relaunching. */ }
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (cli('dev', 'status').state.browserCommandReady) { discover(); return; } } catch { /* Still relaunching. */ }
      spawnSync('sleep', ['5']);
    }
    throw Error('The managed browser did not come back after a relaunch');
  }
  return {
    cli, run, browserRun, discover, state, fields, inspect, poll, target, look, pinch, menuPinch, poke, pinchLandmark,
    lowerHands, screenshot, enterXR, prepareHands, assertHandsOnly, reachLegacy, prepareEmulation, reload, waitForRuntime,
    interactions, emulatorScale, log,
  };
}
