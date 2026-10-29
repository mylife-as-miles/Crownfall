// Hand-only verification of the Quest My Legacy destination in an active,
// emulated immersive session (IWER, browser emulation; not a physical headset).
// Drives Home -> My Legacy, founding with a suggested name, nomination, every
// landmark through the world and through the landmark list, notice acceptance,
// hand-tracking loss -> pause -> Resume, Recenter, Back to Home, Exit VR ->
// re-entry and a reload that must restore the saved banner. Every step is a real
// hand ray + pinch (both controllers disconnected); state is asserted through the
// Legacy fields of CrownfallQuestState. Writes evidence JSON to --out.
//   node scripts/verify-legacy.mjs [--out artifacts/legacy/latest]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { enterQuestXR } from './enter-quest.mjs';

/**
 * Browser-runner entry (runtime started with --allow-browser-automation): drives only the
 * Legacy per-frame update path, through the development diagnostics hook, under the V8
 * sampling heap profiler, and reports the bytes allocated by Legacy and environment code.
 */
export default async ({ frame, page, cdp }) => {
  const app = frame ?? page.mainFrame();
  if (process.env.CROWNFALL_LEGACY_PROBE === 'prepare') {
    // Software-emulation setup only: a smaller managed viewport and the given Quest comfort preferences
    // (applied on the next reload). Never used on a headset.
    const viewport = /^(\d+)x(\d+)$/.exec(process.env.CROWNFALL_VIEWPORT ?? '');
    if (viewport) await page.setViewportSize({ width: Number(viewport[1]), height: Number(viewport[2]) });
    const preferences = process.env.CROWNFALL_QUEST_PREFERENCES;
    if (preferences) await app.evaluate((value) => localStorage.setItem('crownfall.quest.preferences', value), JSON.stringify(JSON.parse(preferences)));
    // The short visit was already verified by the menu suites; marking it done skips onboarding on entry.
    if (process.env.CROWNFALL_QUEST_VISITED === '1') await app.evaluate(() => localStorage.setItem('crownfall.quest.visit-complete', 'true'));
    return { viewport: page.viewportSize(), preferences: preferences ? JSON.parse(preferences) : null, visitCompleted: process.env.CROWNFALL_QUEST_VISITED === '1' };
  }
  if (process.env.CROWNFALL_LEGACY_PROBE === 'pages') {
    // Which managed pages and frames are rendering: each is sampled for two seconds of animation frames.
    const out = [];
    for (const candidate of page.context().pages()) {
      for (const child of candidate.frames()) {
        try {
          out.push({ url: child.url().slice(0, 120), frames: await child.evaluate(() => new Promise((resolve) => {
            let count = 0; const start = performance.now();
            const step = (now) => { count += 1; if (now - start < 2000) requestAnimationFrame(step); else resolve({ count, visibility: document.visibilityState }); };
            requestAnimationFrame(step);
            setTimeout(() => resolve({ count, visibility: document.visibilityState, timedOut: true }), 6000);
          })) });
        } catch (error) { out.push({ url: child.url().slice(0, 120), error: String(error).slice(0, 120) }); }
      }
    }
    return out;
  }
  if (process.env.CROWNFALL_LEGACY_PROBE === 'storage') {
    // The raw save this browser holds for My Legacy (shared persistence key), read without changing it.
    return app.evaluate(() => { try { return localStorage.getItem('crownfall.legacy.save'); } catch { return null; } });
  }
  if (process.env.CROWNFALL_LEGACY_PROBE === 'frames') {
    // Animation-frame intervals of the app page: in emulated XR these pace the session's frames.
    return app.evaluate(() => new Promise((resolve) => {
      const intervals = [];
      let last = performance.now();
      const started = last;
      const step = (now) => {
        intervals.push(now - last);
        last = now;
        if (now - started < 4000) requestAnimationFrame(step);
        else {
          const sorted = intervals.slice().sort((a, b) => a - b);
          const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
          resolve({ frames: intervals.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], visibility: document.visibilityState, framed: window.top !== window });
        }
      };
      requestAnimationFrame(step);
    }));
  }
  const available = await app.evaluate(() => !!window.__crownfallLegacyDiagnostics);
  if (!available) return { available: false, reason: 'Open My Legacy in a development build first.' };
  await app.evaluate(() => window.__crownfallLegacyDiagnostics.runUpdates(600));
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32 });
  const frames = 20000;
  await app.evaluate((count) => window.__crownfallLegacyDiagnostics.runUpdates(count), frames);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const after = await cdp.send('Runtime.getHeapUsage');
  // Attribute every sampled allocation whose stack passes through Legacy code (the probe loop itself excluded).
  const legacyBytes = {};
  const legacyFrame = (callFrame) => callFrame.url.includes('/src/legacy/') && !callFrame.url.includes('legacy-diagnostics');
  const visit = (node, innermost) => {
    const here = legacyFrame(node.callFrame)
      ? `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/src/')[1]}:${node.callFrame.lineNumber + 1}`
      : innermost;
    if (node.selfSize > 0 && here) legacyBytes[here] = (legacyBytes[here] ?? 0) + node.selfSize;
    for (const child of node.children) visit(child, here);
  };
  visit(profile.head, null);
  const stats = await app.evaluate(() => window.__crownfallLegacyDiagnostics.environmentStats());
  return {
    available: true, frames, samplingIntervalBytes: 32,
    legacyAllocatedBytes: Object.values(legacyBytes).reduce((sum, value) => sum + value, 0), legacyAllocationSites: legacyBytes,
    heapUsedBefore: before.usedSize, heapUsedAfter: after.usedSize, environmentStats: stats ? { ...stats, frameTimesMs: stats.frameTimesMs.length } : null,
  };
};

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();

async function main() {

  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; };
  const directory = option('--out', 'artifacts/legacy/latest');
  await mkdir(directory, { recursive: true });
  const bin = existsSync('node_modules/.bin/iwsdk') ? ['node_modules/.bin/iwsdk'] : ['npx', '--no-install', '@iwsdk/cli'];
  const emulatorScale = (() => { try { return Number(/VITE_CROWNFALL_EMULATOR_SCALE=([\d.]+)/.exec(readFileSync('.env.local', 'utf8'))?.[1]) || 1; } catch { return 1; } })();
  const evidence = {
    passed: false,
    startedAt: new Date().toISOString(),
    profile: {
      sdk: '1.1.0-rc.2', runtime: 'IWER Meta Quest 3 browser emulation (managed headless Chromium)', input: 'hand ray + pinch only; both controllers disconnected',
      pinchHoldSeconds: [0.01, 0.15, 0.3], developmentFramebufferScale: emulatorScale, physicalHeadset: false,
      rendering: 'SwiftShader software WebGL on a shared 4-CPU host; frame timings are not representative of a Quest',
      menuPinchView: 'While the menu is shown (Home, its pause view), the emulated head looks almost straight down (88 degrees) during each pinch so the 80k-triangle hero and the menu atmosphere leave the view and software frames stay inside the 800 ms click window; the ray, hit test and pinch are unchanged. Legacy pinches use a level view.',
    },
    checks: [], interactions: [], observations: {},
    limitations: [
      'Browser emulation is not physical Quest validation: tracking quality, comfort, cold start and GPU frame pacing are unmeasured.',
      'Direct fingertip poke is wired (PokeInteractable) but not exercised here, so direct touch is not claimed as a passed runtime test.',
    ],
  };
  function cli(domain, action, input, extra = []) {
    const [command, ...prefix] = bin;
    const result = spawnSync(command, [...prefix, domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra], { encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
    let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(result.stderr || result.stdout || `${domain} ${action} returned no JSON`); }
    if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error)), { sdkError: response.error });
    return response.data.result ?? response.data;
  }
  const record = (check) => { evidence.checks.push(check); console.log(`PASS ${check}`); };
  let stateIndex, panelIndex, dockIndex;
  const findIndex = (pattern) => cli('ecs', 'find', { namePattern: pattern, limit: 5 }).entities[0].entityIndex;
  function discover() {
    stateIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
    panelIndex = findIndex('^My Legacy Panel$');
    dockIndex = findIndex('^My Legacy Dock$');
  }
  const state = () => cli('ecs', 'query', { entityIndex: stateIndex, components: ['CrownfallQuestState'] }).components[0].values;
  const owner = (id) => id.startsWith('Legacy_Dock') ? dockIndex : id.startsWith('Legacy') ? panelIndex : stateIndex;
  const inspect = (id) => cli('ui', 'inspect', { entityIndex: owner(id), selector: `#${id}` }).elements[0];
  function poll(expected, attempts = 6) {
    let value;
    for (let attempt = 0; attempt < attempts; attempt++) { value = state(); if (expected(value)) return value; }
    throw Error(`Expected state was not reached: ${JSON.stringify(value)}`);
  }
  function target(name) {
    const found = cli('xr', 'list-targets').targets.find((item) => item.name === name);
    assert.ok(found, `Visible hand target exists: ${name}`);
    return found;
  }
  // Software-rendered frames can be slow on a shared host. A press only clicks when its start and end are
  // sampled within the pointer's 800 ms click window, so each retry holds the pinch a little longer.
  const PINCH_HOLDS = [0.01, 0.15, 0.3];
  const signature = (v) => `${v.screen}|${v.modal}|${v.paused}|${v.legacyView}|${v.legacyActive}`;
  /** Aims a hand ray at a panel control, proves the ray hovers it, pinches, and waits for the expected state. */
  function pinch(id, expected, device = 'hand-right', attempts = PINCH_HOLDS.length) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      cli('xr', 'look-at', { device, target: target(id).position });
      const before = inspect(id);
      if (!before?.state.hovered || !before.state.displayed) { evidence.interactions.push({ id, device, attempt: attempt + 1, aim: before?.state ?? null }); continue; }
      const start = state();
      const hold = PINCH_HOLDS[attempt % PINCH_HOLDS.length];
      cli('xr', 'select', { device, duration: hold });
      let after;
      for (let query = 0; query < 6; query++) { after = state(); if (expected(after)) break; }
      evidence.interactions.push({ id, device, attempt: attempt + 1, holdSeconds: hold, legacyView: after.legacyView, screen: after.screen });
      if (expected(after)) return after;
      // A late click that moved somewhere unexpected must not be followed by a blind second press.
      if (signature(after) !== signature(start)) throw Error(`${id} led to an unexpected state: ${signature(after)}`);
    }
    throw Error(`Hand pinch did not produce the expected state for ${id}`);
  }
  /** Points a hand ray at a landmark in the holding, proves the environment reports the hover, then pinches it. */
  function pinchLandmark(id, device = 'hand-left') {
    for (let attempt = 0; attempt < PINCH_HOLDS.length; attempt++) {
      cli('xr', 'look-at', { device, target: target(`Landmark_${id}`).position });
      let hovered = false;
      for (let query = 0; query < 3 && !hovered; query++) hovered = state().legacyHover === id;
      if (!hovered) { evidence.interactions.push({ id: `Landmark_${id}`, device, attempt: attempt + 1, hover: state().legacyHover }); continue; }
      cli('xr', 'select', { device, duration: PINCH_HOLDS[attempt] });
      let after;
      for (let query = 0; query < 6; query++) { after = state(); if (after.legacyLandmark === id && after.legacySelectSource === 'world') break; }
      evidence.interactions.push({ id: `Landmark_${id}`, device, attempt: attempt + 1, holdSeconds: PINCH_HOLDS[attempt], legacyView: after.legacyView, landmark: after.legacyLandmark });
      if (after.legacyLandmark === id && after.legacySelectSource === 'world') return after;
    }
    throw Error(`Pointing at ${id} in the holding did not open it`);
  }
  // Software rendering of the 80k-triangle hero takes about a second per frame on this shared host, longer than the
  // pointer's 800 ms click window. While the menu is shown, the emulated head looks down (the hero leaves the
  // 60-degree view) during each pinch; the hand ray, hit test and pinch are unchanged. Legacy pinches keep a level view.
  const HOME_HEAD_PITCH_DEGREES = -88;
  function headPitch(degrees) {
    const half = (degrees * Math.PI / 180) / 2;
    cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) } });
  }
  /** A pinch on a menu control (Home, its pause view or onboarding) with the head looking down. */
  function homePinch(id, expected, attempts = PINCH_HOLDS.length) {
    headPitch(HOME_HEAD_PITCH_DEGREES);
    try { return pinch(id, expected, 'hand-right', attempts); } finally { headPitch(0); }
  }
  /** Animation-frame intervals of the app with the menu shown, level and with the head looking down. */
  function homeFrames() {
    const [command, ...prefix] = bin;
    const sample = () => {
      const result = spawnSync(command, [...prefix, 'browser', 'run', 'scripts/verify-legacy.mjs', '--timeout', '60000'], { encoding: 'utf8', timeout: 90000, env: { ...process.env, CROWNFALL_LEGACY_PROBE: 'frames' } });
      try { const response = JSON.parse(result.stdout || result.stderr); return response.ok ? response.data.result ?? response.data : { unavailable: response.error?.message ?? 'browser run failed' }; }
      catch { return { unavailable: 'browser run failed' }; }
    };
    const level = sample();
    headPitch(HOME_HEAD_PITCH_DEGREES);
    const headDown = sample();
    headPitch(0);
    return { level, headDown, headDownPitchDegrees: HOME_HEAD_PITCH_DEGREES };
  }
  /** Selects the page's Enter VR control and waits until the immersive session is active. */
  function enterXR() {
    // Entering while the hero model is still decoding has crashed the managed software browser; wait for it first.
    for (let wait = 0; wait < 30; wait++) { try { if (state().modelReady) break; } catch { /* The page is still loading. */ } spawnSync('sleep', ['2']); }
    // Fonts, panels and shaders keep the page busy for a while after load; entering in that window crashed the browser too.
    spawnSync('sleep', ['20']);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { enterQuestXR(cli); } catch (error) {
        // A slow software frame can time out the click's acknowledgement even though the click was delivered.
        if (error.sdkError?.details?.code !== 'browser_command_timeout') throw error;
      }
      for (let poll = 0; poll < 20; poll++) { if (cli('xr', 'status').sessionActive) return; spawnSync('sleep', ['2']); }
    }
    throw Error('The immersive session did not start after Enter VR');
  }
  function prepareHands() {
    cli('xr', 'set-input-mode', { mode: 'hand' });
    for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
    cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
    cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    for (const [device, x] of [['hand-left', -0.25], ['hand-right', 0.25]]) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 1.3, z: -0.35 } });
  }
  function assertHandsOnly() {
    const device = cli('xr', 'get-device-state', {});
    assert.equal(device.inputMode, 'hand');
    assert.equal(device.controllers.left.connected, false); assert.equal(device.controllers.right.connected, false);
    return device;
  }
  function anchorYaw() {
    const [x, y, z, w] = cli('scene', 'transform', { nodeId: 'legacy-anchor' }).globalQuaternion;
    return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
  }
  const angleDelta = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  /** Renderer counts, an idle frame profile and (with browser automation) the update-path allocation probe. */
  function measurePerformance(label) {
    const stats = cli('scene', 'render-stats', {});
    const renderer = { calls: stats.calls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures, programs: stats.programs };
    let frames = null;
    try {
      cli('browser', 'profile', { action: 'start', mode: 'rendering', maxDurationMs: 8000 });
      spawnSync('sleep', ['5']);
      const profile = cli('browser', 'profile', { action: 'stop' });
      frames = { durationMs: profile.durationMs, frameTimeMs: profile.summary?.frameTimeMs ?? null, longTasks: profile.summary?.longTasks ?? null };
    } catch (error) { frames = { error: String(error.message || error) }; }
    let allocation;
    try {
      const [command, ...prefix] = bin;
      const result = spawnSync(command, [...prefix, 'browser', 'run', 'scripts/verify-legacy.mjs', '--timeout', '100000'], { encoding: 'utf8', timeout: 130000, maxBuffer: 20 * 1024 * 1024 });
      const response = JSON.parse(result.stdout || result.stderr);
      allocation = response.ok ? response.data.result ?? response.data : { unavailable: response.error?.message ?? 'browser run failed' };
    } catch (error) { allocation = { unavailable: String(error.message || error) }; }
    const measured = { label, renderer, frames, allocation, caveat: 'Software-rendered (SwiftShader) emulation on a shared, heavily loaded 4-CPU host: frame times are not representative of a Quest.' };
    (evidence.performance ??= []).push(measured);
    console.log(`MEASURE ${label}: ${JSON.stringify({ renderer, frameTimeMs: frames?.frameTimeMs, legacyAllocatedBytes: allocation?.legacyAllocatedBytes })}`);
    return measured;
  }
  const legacyFields = (s) => Object.fromEntries(Object.entries(s).filter(([key]) => key.startsWith('legacy') || ['screen', 'paused', 'entered', 'pauseReason'].includes(key)));

  /** Home -> My Legacy from whatever place the runtime is in, with hands only. */
  function openLegacyFromHome() {
    let s = state();
    if (s.paused) s = s.screen === 'pause' && s.legacyActive ? pinch('Legacy_Resume', (v) => !v.paused) : homePinch('Btn_Resume', (v) => !v.paused);
    if (s.screen === 'onboarding') s = homePinch('Btn_SkipVisit', (v) => v.screen === 'home');
    if (s.legacyActive) s = pinch('Legacy_DockHome', (v) => v.screen === 'home' && !v.legacyActive);
    if (s.modal) s = homePinch('Btn_Cancel', (v) => !v.modal);
    if (s.screen !== 'home') s = homePinch('Nav_Home', (v) => v.screen === 'home');
    // Home renders the sorcerer and atmosphere, the heaviest frames on a software renderer, so it gets more attempts.
    return homePinch('Home_legacy', (v) => v.screen === 'legacy' && v.legacyActive && !v.modal, 6);
  }

  /** Errors that mean the managed browser itself went away; the app reloaded and the flow must start again. */
  const browserLost = (error) => /Browser not ready|browser_relaunched|Managed browser is closing|Target disconnected|connection_lost|browser_command_timeout|browser_not_launched/
    .test(String(error?.message || error));
  function waitForRuntime() {
    const [command, ...prefix] = bin;
    spawnSync(command, [...prefix, 'runtime', 'recover'], { encoding: 'utf8', timeout: 180000 });
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (cli('dev', 'status').state.browserCommandReady) { discover(); return; } } catch { /* Still relaunching. */ }
      spawnSync('sleep', ['5']);
    }
    throw Error('The managed browser did not come back after a relaunch');
  }

  function runFlow() {
    discover();
    if (!cli('xr', 'status').sessionActive) enterXR();
    prepareHands();
    const status = cli('xr', 'status');
    assert.equal(status.sessionActive, true); assert.ok(status.enabledFeatures.includes('hand-tracking'));
    const device = assertHandsOnly();
    evidence.observations.session = { active: status.sessionActive, features: status.enabledFeatures, inputMode: device.inputMode, controllers: device.controllers };
    record('Active immersive session with required hand tracking, both controllers disconnected');
    evidence.observations.hostLoadAtStart = readFileSync('/proc/loadavg', 'utf8').trim();
    evidence.observations.menuFrames = homeFrames();

    let s = openLegacyFromHome();
    assert.equal(s.modal, ''); assert.equal(s.legacyActive, true);
    const menuTargets = cli('xr', 'list-targets').targets.map((item) => item.name);
    assert.equal(menuTargets.includes('Home_legacy'), false, 'Menu controls leave the hand targets while My Legacy is shown');
    s = poll((v) => v.legacyEnvironmentReady, 8);
    evidence.observations.entry = legacyFields(s);
    record(`Home -> My Legacy opens a route (no modal); the menu panel, sorcerer and atmosphere are hidden; environment: ${s.legacyEnvironment}`);

    if (s.legacyFounded) {
      s = pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
      assert.equal(inspect('Legacy_ResetConfirm').state.displayed, true);
      s = pinch('Legacy_ResetConfirm', (v) => v.legacyView === 'nation' && !v.legacyFounded);
      record('An existing banner is dissolved only after its confirmation, and founding begins again');
    }
    assert.equal(s.legacyView, 'nation');
    s = pinch('Legacy_Nation_aethelgard', (v) => v.legacyNation === 'aethelgard');
    s = pinch('Legacy_Nation_korvenia', (v) => v.legacyNation === 'korvenia');
    s = pinch('Legacy_NationNext', (v) => v.legacyView === 'name');
    const firstSuggestion = inspect('Legacy_Suggestion_0_Label').text;
    pinch('Legacy_MoreNames', () => inspect('Legacy_Suggestion_0_Label').text !== firstSuggestion);
    s = pinch('Legacy_OpenKeyboard', (v) => v.legacyView === 'keyboard');
    let buffer = '';
    for (const key of ['R', 'O', 'O', 'K']) {
      buffer += buffer ? key.toLowerCase() : key;
      const expectedText = buffer;
      pinch(`Legacy_Key_${key}`, () => inspect('Legacy_Keyboard_Value').text === expectedText);
    }
    const typed = inspect('Legacy_Keyboard_Value').text;
    assert.equal(typed, 'Rook', 'typed in name case with the large-key keyboard');
    s = pinch('Legacy_KeyboardCancel', (v) => v.legacyView === 'name' && v.legacyDraftName === '');
    const suggestion = inspect('Legacy_Suggestion_1_Label').text;
    s = pinch('Legacy_Suggestion_1', (v) => v.legacyDraftName === suggestion);
    s = pinch('Legacy_NameNext', (v) => v.legacyView === 'arms');
    const defaultArms = s.legacyHeraldry;
    s = pinch('Legacy_Preset_2', (v) => v.legacyHeraldry !== defaultArms);
    const presetArms = s.legacyHeraldry;
    s = pinch('Legacy_Part_charge', (v) => v.legacyHeraldry !== presetArms);
    s = pinch('Legacy_PartPrev_charge', (v) => v.legacyHeraldry === presetArms);
    s = pinch('Legacy_ArmsNext', (v) => v.legacyView === 'confirm');
    assert.equal(inspect('Legacy_Confirm_Name').text, suggestion);
    s = pinch('Legacy_ConfirmRaise', (v) => v.legacyFounded && v.legacyView === 'overview');
    assert.equal(s.legacyBanner, suggestion); assert.equal(s.legacyNation, 'korvenia'); assert.equal(s.legacyHeraldry, presetArms);
    if (s.legacyPersistent) assert.equal(s.legacySave, 'saved');
    evidence.observations.founded = legacyFields(s);
    measurePerformance('My Legacy overview with the stand-in environment (menu, sorcerer and atmosphere hidden)');
    record(`Founding with pinches: nation, More names, large-key keyboard (typed then cancelled), suggested name "${suggestion}", preset and per-element arms, confirmed; save: ${s.legacySave}`);

    const landmarks = ['banner-hall', 'muster-grounds', 'war-record', 'heralds-station'];
    const inspectorBack = { 'banner-hall': 'Legacy_HallBack', 'muster-grounds': 'Legacy_MusterBack', 'war-record': 'Legacy_RecordBack', 'heralds-station': 'Legacy_HeraldBack' };
    for (const landmark of landmarks) {
      s = pinchLandmark(landmark);
      assert.equal(s.legacyView, landmark);
    }
    evidence.observations.worldSelection = legacyFields(s);
    record('Every landmark opens by pointing at it in the holding and pinching (environment hover and select callbacks)');
    s = pinch(inspectorBack['heralds-station'], (v) => v.legacyView === 'overview');
    for (const landmark of landmarks) {
      s = pinch(`Legacy_Landmark_${landmark}`, (v) => v.legacyView === landmark && v.legacySelectSource === 'list' && v.legacyLandmark === landmark);
      if (landmark === 'war-record') assert.ok(inspect('Legacy_Record_Entry_0_Title').text.length > 0, 'the War Record lists the founding entry');
      if (landmark === 'banner-hall') assert.equal(inspect('Legacy_Hall_Name').text, suggestion);
      s = pinch(inspectorBack[landmark], (v) => v.legacyView === 'overview' && v.legacyLandmark === '');
    }
    record('Every landmark also opens from the hand-accessible landmark list, with Back returning to the overview');

    s = pinch('Legacy_Landmark_muster-grounds', (v) => v.legacyView === 'muster-grounds');
    s = pinch('Legacy_Member_1', (v) => v.legacyMemberChoice === 'member-2');
    const fileId = ['a', 'b', 'c', 'f', 'g', 'h'].map((file) => `Legacy_File_${file}`).find((id) => inspect(id)?.state.displayed);
    assert.ok(fileId, 'An open Muster file is offered');
    const file = fileId.slice(-1);
    s = pinch(fileId, (v) => v.legacyFileChoice === file);
    s = pinch('Legacy_MusterNominate', (v) => v.legacyRepresentative !== '' && v.legacyFile === file);
    assert.equal(inspect('Legacy_Muster_RepName').text, s.legacyRepresentative);
    if (s.legacyPersistent) assert.equal(s.legacySave, 'saved');
    evidence.observations.nomination = legacyFields(s);
    record(`Nomination: ${s.legacyRepresentative} on the ${file}-file, shown at the Muster Grounds and saved`);

    s = pinch('Legacy_MusterBack', (v) => v.legacyView === 'overview');
    s = pinch('Legacy_Landmark_heralds-station', (v) => v.legacyView === 'heralds-station');
    s = pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice' && v.legacyNotice !== '');
    const wager = inspect('Legacy_NoticeView_Wager').text;
    assert.match(wager, /^These are the terms of this Muster conflict against /, 'the wager is stated before any match');
    s = pinch('Legacy_NoticeAccept', (v) => v.legacyView === 'accept');
    s = pinch('Legacy_AcceptConfirm', (v) => v.legacyView === 'awaiting' && v.legacyChallenge === 'accepted');
    assert.equal(inspect('Legacy_Title').text, 'Awaiting the board');
    evidence.observations.challenge = { ...legacyFields(s), wager };
    record('The rival challenge states its wager; Accept -> confirmation -> "Awaiting the board", with no match played or recorded');

    for (const hand of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device: hand, connected: false });
    const lost = poll((v) => v.paused && v.legacyView === 'pause' && !v.leftTracked && !v.rightTracked, 8);
    assert.equal(inspect('Legacy_Resume').state.displayed, false, 'Resume waits for a tracked hand');
    cli('xr', 'set-connected', { device: 'hand-right', connected: true });
    cli('xr', 'set-transform', { device: 'hand-right', anchor: 'target-ray', position: { x: 0.25, y: 1.3, z: -0.35 } });
    const recovered = poll((v) => v.rightTracked && v.paused, 8);
    s = pinch('Legacy_Resume', (v) => !v.paused && v.screen === 'legacy' && v.legacyView === 'awaiting');
    cli('xr', 'set-connected', { device: 'hand-left', connected: true });
    cli('xr', 'set-transform', { device: 'hand-left', anchor: 'target-ray', position: { x: -0.25, y: 1.3, z: -0.35 } });
    evidence.observations.trackingLoss = { lost: legacyFields(lost), recovered: legacyFields(recovered), resumed: legacyFields(s) };
    record('Losing both hands pauses My Legacy; a returning hand enables Resume, which restores the exact Legacy view and state');

    const recentersBefore = s.legacyRecenters;
    const yaw = 0.5;
    cli('xr', 'set-transform', { device: 'headset', orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
    const headBefore = cli('xr', 'get-transform', { device: 'headset' });
    s = pinch('Legacy_DockRecenter', (v) => v.legacyRecenters === recentersBefore + 1);
    const head = cli('xr', 'get-transform', { device: 'headset' });
    assert.deepEqual(head, headBefore, 'Recenter never moves or rotates the viewer');
    const recenteredYaw = anchorYaw();
    assert.ok(angleDelta(recenteredYaw, yaw) < 0.05, `the Legacy anchor turned to the view (${recenteredYaw.toFixed(3)} vs ${yaw})`);
    cli('xr', 'set-transform', { device: 'headset', orientation: { x: 0, y: 0, z: 0, w: 1 } });
    s = pinch('Legacy_DockRecenter', (v) => v.legacyRecenters === recentersBefore + 2);
    assert.ok(angleDelta(anchorYaw(), 0) < 0.05);
    evidence.observations.recenter = { headAfterTurn: head, anchorYawAfterTurn: recenteredYaw, viewerMovedByApp: false };
    record('Recenter moves the Legacy anchor in front of the current view; the viewer pose is only ever set by the test, never by the app');

    const place = { view: s.legacyView, banner: s.legacyBanner, representative: s.legacyRepresentative, file: s.legacyFile, challenge: s.legacyChallenge };
    s = pinch('Legacy_DockHome', (v) => v.screen === 'home' && !v.legacyActive);
    const homeTargets = cli('xr', 'list-targets').targets.map((item) => item.name);
    assert.ok(homeTargets.includes('Home_legacy') && !homeTargets.includes('Legacy_DockHome'), 'Home is interactive again and the Legacy panels are hidden');
    s = homePinch('Home_legacy', (v) => v.legacyActive && v.screen === 'legacy', 6);
    assert.equal(s.legacyView, place.view); assert.equal(s.legacyBanner, place.banner);
    record('Back to Home restores the menu; reopening My Legacy returns to the same place');

    const beforeExit = state();
    cli('xr', 'look-at', { device: 'hand-right', target: target('Legacy_DockExit').position });
    assert.ok(inspect('Legacy_DockExit').state.hovered, 'The hand ray reaches Exit VR');
    let acknowledgement = 'Command completed normally';
    try { cli('xr', 'select', { device: 'hand-right', duration: 0.01 }); }
    catch (error) {
      if (error.sdkError?.code !== 'runtime_command_failed' || error.sdkError?.message !== 'The XR session ended.') throw error;
      acknowledgement = error.sdkError;
    }
    const exited = poll((v) => !v.entered);
    assert.equal(cli('xr', 'status').sessionActive, false);
    assert.equal(exited.screen, 'legacy'); assert.equal(exited.legacyView, beforeExit.legacyView);
    enterXR();
    prepareHands();
    s = poll((v) => v.entered, 8);
    if (s.paused) s = pinch('Legacy_Resume', (v) => !v.paused);
    assert.equal(s.screen, 'legacy'); assert.equal(s.legacyView, place.view); assert.equal(s.legacyBanner, place.banner);
    assert.equal(s.legacyRepresentative, place.representative); assert.equal(s.legacyChallenge, place.challenge);
    evidence.observations.exitReentry = { acknowledgement, exited: legacyFields(exited), reentered: legacyFields(s) };
    record('Exit VR ends the immersive session from the dock; re-entry returns to the same Legacy place');

    let reloadSkipped = false;
    if (s.legacyPersistent) {
      const [command, ...prefix] = bin;
      const probe = spawnSync(command, [...prefix, 'browser', 'run', 'scripts/verify-legacy.mjs', '--timeout', '60000'], { encoding: 'utf8', timeout: 90000, env: { ...process.env, CROWNFALL_LEGACY_PROBE: 'storage' } });
      const response = JSON.parse(probe.stdout || probe.stderr);
      assert.ok(response.ok, 'The stored save can be read back');
      const raw = response.data.result ?? response.data;
      const stored = JSON.parse(raw);
      assert.equal(stored.banner?.name, place.banner);
      assert.equal(stored.nomination?.file, place.file);
      assert.ok(stored.notices.some((notice) => notice.status === 'accepted'), 'the accepted challenge is in the save');
      evidence.observations.storedSave = {
        key: 'crownfall.legacy.save', bytes: raw.length, schemaVersion: stored.schemaVersion, banner: stored.banner.name,
        nominationFile: stored.nomination.file, acceptedNotices: stored.notices.filter((notice) => notice.status === 'accepted').length,
      };
      record('The banner, nomination and accepted challenge are written to crownfall.legacy.save in this browser');
      try {
        cli('browser', 'reload', {});
        let ready = false;
        for (let attempt = 0; attempt < 20 && !ready; attempt++) {
          try { discover(); ready = true; } catch { spawnSync('sleep', ['3']); }
        }
        assert.ok(ready, 'The app reloaded');
        enterXR();
        prepareHands();
        s = openLegacyFromHome();
        s = poll((v) => v.legacyFounded, 6);
        assert.equal(s.legacySession, 'stored'); assert.equal(s.legacyBanner, place.banner);
        assert.equal(s.legacyRepresentative, place.representative); assert.equal(s.legacyFile, place.file); assert.equal(s.legacyChallenge, place.challenge);
        evidence.observations.reload = legacyFields(s);
        record('After a page reload the saved banner, nomination and accepted challenge load from crownfall.legacy.save');
      } catch (error) {
        if (!browserLost(error)) throw error;
        // The software browser has closed while re-entering right after a reload on this loaded host. The save was read
        // back above; restoring it on reload is then left unclaimed rather than restarting the whole flow.
        reloadSkipped = true;
        evidence.limitations.push(`Restoring the save after a page reload was not exercised in this run: the managed software browser closed while re-entering (${String(error.message || error).slice(0, 160)}). The save itself was read back from crownfall.legacy.save; loading it is covered by the shared persistence tests.`);
      }
    } else {
      evidence.limitations.push(`This run used a ${s.legacySession} session, so persistence across reload was not exercised.`);
    }

    if (!reloadSkipped) {
      evidence.observations.final = { state: legacyFields(state()), session: cli('xr', 'status'), device: assertHandsOnly() };
      for (const hand of ['hand-left', 'hand-right']) cli('xr', 'run-sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    }
  }

  /** Optional software-emulation setup through the browser runner (runtime started with --allow-browser-automation). */
  function prepareEmulation() {
    const [command, ...prefix] = bin;
    const env = { ...process.env, CROWNFALL_LEGACY_PROBE: 'prepare', CROWNFALL_VIEWPORT: '640x480', CROWNFALL_QUEST_PREFERENCES: JSON.stringify({ quality: 'low', motion: false }), CROWNFALL_QUEST_VISITED: '1' };
    const result = spawnSync(command, [...prefix, 'browser', 'run', 'scripts/verify-legacy.mjs', '--timeout', '90000'], { encoding: 'utf8', timeout: 120000, env });
    let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { response = { ok: false, error: { message: result.stderr || result.stdout } }; }
    if (!response.ok) { evidence.profile.emulationSetup = { applied: false, reason: response.error?.message ?? 'browser runner unavailable' }; return; }
    // The comfort preferences and visit flag apply on load; reload only when the running app does not already use them,
    // since re-entering right after a reload is where the managed software browser has closed on this host.
    let current = null;
    try { discover(); current = state(); } catch { /* The app is still loading. */ }
    if (!current || current.quality !== 'low' || current.motion !== false || !current.visitComplete) {
      if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* An ended-session acknowledgement is expected. */ } }
      cli('browser', 'reload', {});
      for (let attempt = 0; attempt < 30; attempt++) { try { discover(); break; } catch { spawnSync('sleep', ['3']); } }
    }
    evidence.profile.emulationSetup = {
      applied: true, ...(response.data.result ?? response.data),
      note: 'Software-emulation accommodation only: a 640x480 managed viewport, Quest Render Quality Low and Ambient Motion Off, and the short visit marked complete so entry opens Home.',
    };
  }

  let failure;
  try {
    if (!process.argv.includes('--no-prepare')) prepareEmulation();
    for (let attempt = 1; ; attempt++) {
      try { runFlow(); break; } catch (error) {
        if (attempt >= 3 || !browserLost(error)) throw error;
        // A relaunched browser loses the immersive session and page state: record it and run the whole flow again.
        (evidence.restarts ??= []).push({ attempt, reason: String(error.message || error).slice(0, 400), checksBeforeRestart: evidence.checks.slice() });
        evidence.checks.length = 0;
        evidence.interactions.length = 0;
        evidence.observations = {};
        waitForRuntime();
        // A relaunched browser starts from its default viewport, so the emulation setup is applied again.
        if (!process.argv.includes('--no-prepare')) prepareEmulation();
      }
    }
    evidence.passed = true;
  } catch (error) {
    failure = error;
    evidence.failure = String(error.stack || error);
    try { evidence.observations.atFailure = legacyFields(state()); } catch { /* The runtime may be gone. */ }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/verification.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`${evidence.passed ? 'PASS' : 'FAIL'} ${evidence.checks.length} checks -> ${directory}/verification.json`);
  }
  if (failure) throw failure;
}
