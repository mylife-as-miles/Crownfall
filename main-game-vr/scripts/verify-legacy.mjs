// Hand-only verification of the Quest My Legacy destination in an active, emulated immersive
// session (IWER, browser emulation; not a physical headset). Drives Home -> My Legacy (loaded
// lazily on that first entry), founding with a suggested name and a typed motto, the raising beat,
// every landmark through the world (right hand) and the landmark list (left hand), the War Record's
// three sections, a nomination, the challenge with its stated terms, Accept -> Awaiting the board,
// fingertip presses on the touch tray, hand-tracking loss -> pause -> Resume, the tray's Pause and
// the pause view's Return to Home, Recenter, Exit VR -> re-entry and a reload that must restore the
// saved banner. With --session guest or --session preview:<id> it proves those sessions never write
// storage. Writes evidence JSON to --out.
//   node scripts/verify-legacy.mjs [--out artifacts/legacy/latest] [--session production|guest|preview:<id>]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { HOME_HEAD_PITCH_DEGREES, browserLost, createLegacyDriver, sleep } from './legacy-driver.mjs';

const SAVE_KEY = 'crownfall.legacy.save';

/**
 * Browser-runner entry (runtime started with --allow-browser-automation): emulation setup, storage
 * reads and writes, frame and main-thread timing, and the per-frame allocation probe of the Legacy path.
 */
export default async ({ frame, page, cdp }) => {
  const app = frame ?? page.mainFrame();
  const probe = process.env.CROWNFALL_LEGACY_PROBE;
  if (probe === 'prepare') {
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
  if (probe === 'storage') {
    // The raw save this browser holds for My Legacy (shared persistence key), read without changing it.
    return app.evaluate((key) => { try { return localStorage.getItem(key); } catch { return null; } }, SAVE_KEY);
  }
  if (probe === 'set-save') {
    // Test setup: replaces (or, with an empty value, removes) the stored save before a reload.
    const value = process.env.CROWNFALL_LEGACY_SAVE ?? '';
    return app.evaluate(([key, raw]) => { if (raw) localStorage.setItem(key, raw); else localStorage.removeItem(key); return localStorage.getItem(key); }, [SAVE_KEY, value]);
  }
  if (probe === 'marks') {
    // Launch marks and every resource this page has requested so far, to show what loaded before My Legacy was opened.
    return app.evaluate(() => {
      performance.setResourceTimingBufferSize(5000);
      return ({
      marks: performance.getEntriesByType('mark').map((mark) => ({ name: mark.name, at: Math.round(mark.startTime) })),
      resources: performance.getEntriesByType('resource').map((entry) => entry.name.replace(location.origin, '')),
      });
    });
  }
  if (probe === 'launch') {
    // Cold page navigation, with only the save varied. Observe storage reads
    // before entry without importing the Legacy domain into the test page.
    await app.evaluate(([key, raw]) => { if (raw) localStorage.setItem(key, raw); else localStorage.removeItem(key); }, [SAVE_KEY, process.env.CROWNFALL_LEGACY_SAVE ?? '']);
    await page.addInitScript((key) => {
      performance.setResourceTimingBufferSize(5000);
      window.__legacyLaunchReads = 0;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) window.__legacyLaunchReads++;
        return getItem.call(this, name);
      };
    }, SAVE_KEY);
    const url = new URL(app.url());
    url.search = '';
    await app.goto(url.href, { waitUntil: 'load' });
    await app.waitForFunction(() => performance.getEntriesByName('crownfall:menu-ready').length > 0);
    return app.evaluate(() => ({
      menuReadyMs: performance.getEntriesByName('crownfall:menu-ready')[0].startTime,
      saveReads: window.__legacyLaunchReads,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name.replace(location.origin, '')),
    }));
  }
  if (probe === 'frames') {
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
          resolve({ frames: intervals.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], visibility: document.visibilityState });
        }
      };
      requestAnimationFrame(step);
    }));
  }
  if (probe === 'script-time') {
    // Main-thread script and task time per animation frame over a five-second window (CDP Performance metrics,
    // which include the IWER emulator's own work), and the Legacy update path timed in isolation.
    await cdp.send('Performance.enable');
    const metric = (metrics, name) => metrics.find((item) => item.name === name)?.value ?? 0;
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    const frames = await app.evaluate(() => new Promise((resolve) => {
      let count = 0; const start = performance.now();
      const step = (now) => { count += 1; if (now - start < 5000) requestAnimationFrame(step); else resolve(count); };
      requestAnimationFrame(step);
    }));
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const per = (name) => (metric(after, name) - metric(before, name)) * 1000 / Math.max(1, frames);
    const isolated = await app.evaluate(() => {
      const diagnostics = window.__crownfallLegacyDiagnostics;
      if (!diagnostics) return null;
      diagnostics.runUpdates(300);
      const total = diagnostics.timeUpdates(5000);
      return { updates: 5000, totalMs: total, msPerUpdate: total / 5000 };
    });
    return { windowSeconds: 5, frames, scriptMsPerFrame: per('ScriptDuration'), taskMsPerFrame: per('TaskDuration'), layoutMsPerFrame: per('LayoutDuration'), legacyUpdate: isolated };
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
  const session = option('--session', 'production');
  const prefix = session === 'production' ? '' : `${session.replace(/[^a-z0-9-]/g, '-')}-`;
  await mkdir(directory, { recursive: true });
  const d = createLegacyDriver();
  const { cli, state, fields, inspect, poll, target, look, pinch, menuPinch, poke, pinchLandmark } = d;
  const evidence = {
    passed: false,
    session,
    startedAt: new Date().toISOString(),
    profile: {
      sdk: '1.1.0-rc.2', runtime: 'IWER Meta Quest 3 browser emulation (managed headless Chromium)',
      input: 'hand rays + pinches with either hand, and index-fingertip presses (poke) on the touch tray; both controllers disconnected',
      pinchHoldSeconds: [0.01, 0.15, 0.3], developmentFramebufferScale: d.emulatorScale, physicalHeadset: false,
      rendering: 'SwiftShader software WebGL on a shared 4-CPU host; frame timings are not representative of a Quest',
      menuPinchView: `While the menu is shown (Home, its pause view), the emulated head looks almost straight down (${HOME_HEAD_PITCH_DEGREES} degrees) during each pinch so the 80k-triangle hero and the menu atmosphere leave the view and software frames stay inside the 800 ms click window; the ray, hit test and pinch are unchanged. Legacy pinches use a level view; tray presses look down at the tray.`,
    },
    checks: [], interactions: d.interactions, cliRetries: d.cliRetries, observations: {},
    limitations: [
      'Browser emulation is not physical Quest validation: tracking quality, comfort, reach for a particular body, cold start and GPU frame pacing are unmeasured.',
      'The emulated fingertip press moves the hand to the control; reach is evidenced by the control\'s measured distance from the eye, not by a body model.',
    ],
  };
  const record = (check) => { evidence.checks.push(check); console.log(`PASS ${check}`); };
  const capture = (name, pitch = 0) => {
    if (!process.argv.includes('--capture')) return;
    const file = `${directory}/${prefix}${name}.png`;
    const metadata = d.screenshot(file, pitch);
    (evidence.captures ??= []).push({ name, file, state: fields(state()), metadata });
    console.log(`CAPTURE ${file}`);
  };
  const probe = (name, env = {}, timeout = 90000) => d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: name, ...env }, timeout);
  function anchorYaw() {
    const [x, y, z, w] = cli('scene', 'transform', { nodeId: 'legacy-anchor' }).globalQuaternion;
    return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
  }
  const angleDelta = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  /** Renderer counts, an idle frame profile, main-thread script time per frame and the update-path allocation probe. */
  function measurePerformance(label) {
    const stats = cli('scene', 'render-stats', {});
    const renderer = { calls: stats.calls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures, programs: stats.programs };
    let frames = null;
    try {
      cli('browser', 'profile', { action: 'start', mode: 'rendering', maxDurationMs: 8000 });
      sleep(5);
      const profile = cli('browser', 'profile', { action: 'stop' });
      frames = { durationMs: profile.durationMs, frameTimeMs: profile.summary?.frameTimeMs ?? null, longTasks: profile.summary?.longTasks ?? null };
    } catch (error) { frames = { error: String(error.message || error) }; }
    let scriptTime;
    try { scriptTime = probe('script-time', {}, 120000); } catch (error) { scriptTime = { unavailable: String(error.message || error) }; }
    let allocation;
    try { allocation = probe('allocation', {}, 130000); } catch (error) { allocation = { unavailable: String(error.message || error) }; }
    const measured = { label, renderer, frames, scriptTime, allocation, caveat: 'Software-rendered (SwiftShader) emulation on a shared, heavily loaded 4-CPU host: frame and script times include the IWER emulator and are not representative of a Quest.' };
    (evidence.performance ??= []).push(measured);
    console.log(`MEASURE ${label}: ${JSON.stringify({ renderer, scriptMsPerFrame: scriptTime?.scriptMsPerFrame, legacyUpdateMs: scriptTime?.legacyUpdate?.msPerUpdate, legacyAllocatedBytes: allocation?.legacyAllocatedBytes })}`);
    return measured;
  }
  /** Animation-frame intervals of the app with the menu shown, level and with the head looking down. */
  function homeFrames() {
    const sample = () => { try { return probe('frames'); } catch (error) { return { unavailable: String(error.message || error) }; } };
    const level = sample();
    look(HOME_HEAD_PITCH_DEGREES);
    const headDown = sample();
    look(0);
    return { level, headDown, headDownPitchDegrees: HOME_HEAD_PITCH_DEGREES };
  }
  // Manifest identities are tiny startup metadata, not the lazy experience.
  const legacyResources = (resources) => resources.filter((name) => /legacy-experience|legacy\.uikitml|legacy-dock\.uikitml|\/legacy\/(?!legacy-manifest\.(?:js|ts)|environment-contract)/.test(name));
  const openLandmark = (landmark, device = 'hand-left') => pinch(`Legacy_Landmark_${landmark}`, (v) => v.legacyView === landmark && v.legacySelectSource === 'list', { device });

  function checkPlayReturn(label) {
    const before = state();
    const reached = pinch('Legacy_DockPlay', (v) => v.screen === 'play' && !v.legacyActive, { pitch: 44 });
    (evidence.observations.actionsToPlay ??= []).push({ from: label, actions: 1, reachedPlay: reached.screen === 'play' });
    menuPinch('Nav_Home', (v) => v.screen === 'home');
    const restored = d.reachLegacy();
    assert.equal(restored.legacyView, before.legacyView, 'Returning from Play keeps the Legacy place');
    assert.equal(restored.legacyBanner, before.legacyBanner);
  }

  function chessFirst() {
    const saved = probe('storage');
    assert.ok(saved && JSON.parse(saved).banner, 'Run production verification first to provide a real saved banner');
    evidence.observations.launch = [];
    evidence.observations.launchToFirstMove = { measured: false, reason: 'Chess is not connected to this menu. These measurements stop at the working Play menu; no legal move can be timed until the creator ports gameplay.' };
    try {
      for (const withSave of [false, true]) {
        if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* Check inactive below, not an ended-session acknowledgement. */ } }
        assert.equal(cli('xr', 'status').sessionActive, false);
        const launch = probe('launch', { CROWNFALL_LEGACY_SAVE: withSave ? saved : '' });
        assert.deepEqual(legacyResources(launch.resources), [], 'Home requests no Legacy code or panel');
        assert.equal(launch.saveReads, 0, 'Home does not read the Legacy save');
        d.discover();
        enterLegacy();
        menuPinch('Nav_Play', (v) => v.screen === 'play');
        assert.equal(state().legacyLoad, '', 'Play never starts loading Legacy');
        evidence.observations.launch.push({ withSave, ...launch, reachedPlayByHands: true });
        menuPinch('Nav_Home', (v) => v.screen === 'home');
        d.reachLegacy();
        checkPlayReturn(withSave ? 'saved banner' : 'founding nation');
      }
    } finally {
      probe('set-save', { CROWNFALL_LEGACY_SAVE: saved });
    }
    record('Launch with and without a saved banner requests no Legacy resources or save reads; hands reach Play without Legacy, and the reachable tray returns from both founding and a saved banner to Play in one action');
  }

  /** Enters the session, proves hands only, and opens My Legacy lazily from Home. */
  function enterLegacy() {
    d.discover();
    if (!cli('xr', 'status').sessionActive) d.enterXR();
    d.prepareHands();
    const status = cli('xr', 'status');
    assert.equal(status.sessionActive, true); assert.ok(status.enabledFeatures.includes('hand-tracking'));
    if (state().paused) {
      const id = state().legacyActive ? 'Legacy_Resume' : 'Btn_Resume';
      if (id === 'Legacy_Resume') pinch(id, (v) => !v.paused);
      else menuPinch(id, (v) => !v.paused);
    }
    const device = d.assertHandsOnly();
    evidence.observations.session = { active: status.sessionActive, features: status.enabledFeatures, inputMode: device.inputMode, controllers: device.controllers };
    record('Active immersive session with required hand tracking, both controllers disconnected');
  }

  function production() {
    enterLegacy();
    evidence.observations.hostLoadAtStart = readFileSync('/proc/loadavg', 'utf8').trim();
    evidence.observations.menuFrames = homeFrames();
    const beforeEntry = probe('marks');
    assert.deepEqual(legacyResources(beforeEntry.resources), [], 'no My Legacy code or panel was requested before My Legacy was opened');
    evidence.observations.beforeEntry = { marks: beforeEntry.marks, resources: beforeEntry.resources.length, legacyResources: [] };
    assert.equal(cli('ecs', 'find', { namePattern: '^My Legacy (Panel|Dock)$' }).entities.length, 0, 'the Legacy panels are not created at launch');
    record('Home is interactive with no My Legacy chunk or panel document requested (the Legacy panels do not exist yet)');

    let s = d.reachLegacy();
    assert.equal(s.modal, ''); assert.equal(s.legacyActive, true); assert.equal(s.legacyLoad, 'ready');
    const menuTargets = cli('xr', 'list-targets').targets.map((item) => item.name);
    assert.equal(menuTargets.includes('Home_legacy'), false, 'Menu controls leave the hand targets while My Legacy is shown');
    const afterEntry = probe('marks');
    const mark = (name) => afterEntry.marks.find((item) => item.name === name)?.at ?? null;
    evidence.observations.entry = {
      ...fields(s), menuReadyMs: mark('crownfall:menu-ready'), legacyRequestedMs: mark('crownfall:legacy-requested'), legacyReadyMs: mark('crownfall:legacy-ready'),
      legacyLoadMs: mark('crownfall:legacy-ready') !== null && mark('crownfall:legacy-requested') !== null ? mark('crownfall:legacy-ready') - mark('crownfall:legacy-requested') : null,
      legacyResources: legacyResources(afterEntry.resources),
      note: 'Development server (unbundled modules): the first-entry load time is not the production figure.',
    };
    record(`Home -> My Legacy loads its chunk and panels on this first entry (${evidence.observations.entry.legacyLoadMs} ms in the development server), then hides the menu, sorcerer and atmosphere; environment: ${s.legacyEnvironment}`);
    assert.ok(s.legacyPanelTopDegrees < 13 && s.legacyPanelBottomDegrees > -24, `the reading panel spans ${s.legacyPanelTopDegrees.toFixed(1)} to ${s.legacyPanelBottomDegrees.toFixed(1)} degrees`);
    assert.ok(s.legacyTrayDistance <= 0.62, `the touch tray is ${s.legacyTrayDistance.toFixed(2)} m from the eye`);
    evidence.observations.staging = { panelTopDegrees: s.legacyPanelTopDegrees, panelBottomDegrees: s.legacyPanelBottomDegrees, panelDistance: s.legacyPanelDistance, trayDistance: s.legacyTrayDistance, trayElevationDegrees: s.legacyTrayElevationDegrees };
    record(`The reading panel sits from ${s.legacyPanelTopDegrees.toFixed(1)} to ${s.legacyPanelBottomDegrees.toFixed(1)} degrees at ${s.legacyPanelDistance.toFixed(2)} m; the touch tray is ${s.legacyTrayDistance.toFixed(2)} m from the eye at ${s.legacyTrayElevationDegrees.toFixed(1)} degrees`);

    if (s.legacyView === 'aftermath') s = pinch('Legacy_AftermathLater', (v) => v.legacyView === 'overview');
    if (s.legacyFounded) {
      s = openLandmark('banner-hall');
      s = pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
      assert.equal(inspect('Legacy_ResetConfirm').state.displayed, true);
      s = pinch('Legacy_ResetConfirm', (v) => v.legacyView === 'nation' && !v.legacyFounded);
      record('An existing banner is dissolved from the Banner Hall only after its confirmation, and founding begins again');
    }
    assert.equal(s.legacyView, 'nation');
    assert.equal(s.legacySaved, false, 'nothing is claimed as saved during founding');
    assert.notEqual(inspect('Legacy_DockLabel').text, 'Saved on this device');
    checkPlayReturn('founding nation');
    s = pinch('Legacy_Nation_aethelgard', (v) => v.legacyNation === 'aethelgard');
    s = pinch('Legacy_Nation_korvenia', (v) => v.legacyNation === 'korvenia', { device: 'hand-left' });
    assert.equal(s.legacyMirrorPrimary, 'Legacy_NationNext');
    const nationPress = poke('Legacy_DockPrimary', (v) => v.legacyView === 'name');
    s = nationPress.state;
    evidence.observations.poke = [{ control: 'Legacy_DockPrimary (mirrors Continue)', distanceFromEye: nationPress.distanceFromEye, contactMs: nationPress.press?.contactMs ?? null }];
    record(`A fingertip press on the touch tray, ${nationPress.distanceFromEye.toFixed(2)} m from the eye, presses the founding step's Continue`);
    const firstSuggestion = inspect('Legacy_Suggestion_0_Label').text;
    pinch('Legacy_MoreNames', () => inspect('Legacy_Suggestion_0_Label').text !== firstSuggestion);
    s = pinch('Legacy_OpenKeyboard', (v) => v.legacyView === 'keyboard');
    let buffer = '';
    for (const key of ['R', 'O', 'O', 'K']) {
      buffer += buffer ? key.toLowerCase() : key;
      const expectedText = buffer;
      pinch(`Legacy_Key_${key}`, () => inspect('Legacy_Keyboard_Value').text === expectedText);
    }
    assert.equal(inspect('Legacy_Keyboard_Value').text, 'Rook', 'typed in name case with the large-key keyboard');
    s = pinch('Legacy_KeyboardCancel', (v) => v.legacyView === 'name' && v.legacyDraftName === '');
    const suggestion = inspect('Legacy_Suggestion_1_Label').text;
    s = pinch('Legacy_Suggestion_1', (v) => v.legacyDraftName === suggestion, { device: 'hand-left' });
    s = pinch('Legacy_NameNext', (v) => v.legacyView === 'arms');
    const defaultArms = s.legacyHeraldry;
    s = pinch('Legacy_Preset_2', (v) => v.legacyHeraldry !== defaultArms);
    const presetArms = s.legacyHeraldry;
    s = pinch('Legacy_Part_charge', (v) => v.legacyHeraldry !== presetArms);
    s = pinch('Legacy_PartPrev_charge', (v) => v.legacyHeraldry === presetArms, { device: 'hand-left' });
    s = pinch('Legacy_ArmsNext', (v) => v.legacyView === 'confirm');
    s = pinch('Legacy_ConfirmMotto', (v) => v.legacyView === 'keyboard');
    for (const key of ['W', 'E', 'Space', 'H', 'O', 'L', 'D']) pinch(key === 'Space' ? 'Legacy_Key_Space' : `Legacy_Key_${key}`, () => true);
    s = pinch('Legacy_KeyboardDone', (v) => v.legacyView === 'confirm' && v.legacyMotto === 'We hold');
    assert.equal(inspect('Legacy_Confirm_Name').text, suggestion);
    assert.equal(inspect('Legacy_Confirm_Motto').text, '"We hold"');
    capture('founding-confirm');
    s = pinch('Legacy_ConfirmRaise', (v) => v.legacyFounded && v.legacyView === 'raised');
    assert.equal(inspect('Legacy_Raised_Heading').text, 'A banner is raised');
    assert.equal(inspect('Legacy_Raised_Name').text, suggestion);
    s = poke('Legacy_DockPrimary', (v) => v.legacyView === 'overview').state;
    assert.equal(s.legacyBanner, suggestion); assert.equal(s.legacyNation, 'korvenia'); assert.equal(s.legacyHeraldry, presetArms); assert.equal(s.legacyMotto, 'We hold');
    if (s.legacyPersistent) { assert.equal(s.legacySave, 'saved'); assert.equal(s.legacySaved, true); assert.equal(inspect('Legacy_DockLabel').text, 'Saved on this device'); }
    evidence.observations.founded = fields(s);
    capture('overview');
    measurePerformance('My Legacy overview with the stand-in environment (menu, sorcerer and atmosphere hidden)');
    record(`Founding with pinches from either hand: nation, Other names, the keyboard typed then cancelled, suggested name "${suggestion}", preset and per-element arms, motto "We hold" typed, raised; the raising beat continued by a fingertip press; save: ${s.legacySave}`);

    const landmarks = ['banner-hall', 'muster-grounds', 'war-record', 'heralds-station'];
    const inspectorBack = { 'banner-hall': 'Legacy_HallBack', 'muster-grounds': 'Legacy_MusterBack', 'war-record': 'Legacy_RecordBack', 'heralds-station': 'Legacy_HeraldBack' };
    for (const landmark of landmarks) {
      s = pinchLandmark(landmark, 'hand-right');
      assert.equal(s.legacyView, landmark);
      assert.equal(s.legacyLandmark, landmark, 'the inspected landmark is emphasised in the holding');
    }
    evidence.observations.worldSelection = fields(s);
    record('Every landmark opens by pointing at it in the holding with the right hand and pinching (environment hover and select callbacks)');
    s = pinch(inspectorBack['heralds-station'], (v) => v.legacyView === 'overview', { device: 'hand-left' });
    for (const landmark of landmarks) {
      s = openLandmark(landmark, 'hand-left');
      if (landmark === 'war-record') {
        assert.equal(s.legacyRecordTab, 'unresolved', 'with no conflicts the War Record opens on its open matters');
        assert.match(inspect('Legacy_Record_Entry_0_Title').text, /^Open challenge from /, 'the rival\'s open challenge is listed, not only counted');
        s = pinch('Legacy_RecordTab_ledger', (v) => v.legacyRecordTab === 'ledger', { device: 'hand-left' });
        assert.ok(inspect('Legacy_Record_Entry_0_Title').text.length > 0, 'the ledger lists the founding');
        s = pinch('Legacy_RecordTab_conflicts', (v) => v.legacyRecordTab === 'conflicts', { device: 'hand-left' });
        assert.equal(inspect('Legacy_Record_Empty').text, 'No conflicts recorded yet.');
        capture('war-record-conflicts');
      }
      if (landmark === 'banner-hall') {
        assert.equal(inspect('Legacy_Hall_Name').text, suggestion);
        assert.equal(inspect('Legacy_Hall_Motto').text, '"We hold"');
        assert.equal(inspect('Legacy_ResetOpen').state.displayed, true, 'Dissolve banner lives in the Banner Hall');
      }
      s = pinch(inspectorBack[landmark], (v) => v.legacyView === 'overview' && v.legacyLandmark === '', { device: 'hand-left' });
    }
    assert.equal(inspect('Legacy_AftermathReview').state.displayed, false);
    record('Every landmark also opens from the landmark list with the left hand; the War Record\'s three sections list open matters, the ledger and (honestly empty) conflicts');

    s = openLandmark('muster-grounds', 'hand-right');
    assert.equal(inspect('Legacy_Legend_player').text, 'Your banner / 0', 'before a nomination no one on the board belongs to the house');
    s = pinch('Legacy_MusterChoose', (v) => v.legacyView === 'nominate');
    s = pinch('Legacy_Member_1', (v) => v.legacyMemberChoice === 'member-2');
    const fileId = ['a', 'b', 'c', 'f', 'g', 'h'].map((file) => `Legacy_File_${file}`).find((id) => inspect(id)?.state.displayed);
    assert.ok(fileId, 'An open Muster file is offered');
    const file = fileId.slice(-1);
    s = pinch(fileId, (v) => v.legacyFileChoice === file);
    s = pinch('Legacy_MusterNominate', (v) => v.legacyView === 'muster-grounds' && v.legacyRepresentative !== '' && v.legacyFile === file);
    assert.equal(inspect('Legacy_Muster_RepName').text, s.legacyRepresentative);
    assert.equal(inspect('Legacy_Muster_Row_0_Value').text, suggestion, 'the ledger names the banner allegiance');
    assert.equal(inspect('Legacy_Legend_player').text, 'Your banner / 1', 'the formation shows the one member of the house on the board');
    if (s.legacyPersistent) assert.equal(s.legacySave, 'saved');
    evidence.observations.nomination = fields(s);
    record(`Nomination: ${s.legacyRepresentative} on the ${file}-file, shown in the Muster ledger and the formation, and saved`);

    s = pinch('Legacy_MusterBack', (v) => v.legacyView === 'overview');
    s = openLandmark('heralds-station', 'hand-right');
    capture('herald-list');
    s = pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice' && v.legacyNotice !== '');
    const terms = [0, 1, 2, 3].map((index) => ({ when: inspect(`Legacy_NoticeView_Term_${index}_When`).text, then: inspect(`Legacy_NoticeView_Term_${index}_Then`).text }));
    assert.match(inspect('Legacy_NoticeView_WagerIntro').text, /^These are the terms of this Muster conflict against /, 'the wager is stated before any match');
    assert.match(terms[0].then, /held captive until your house wins a later Muster/);
    assert.match(terms[1].then, /wounded and recover after one further recorded match/);
    s = pinch('Legacy_NoticeAccept', (v) => v.legacyView === 'accept');
    capture('accept-confirmation');
    assert.equal(inspect('Legacy_Accept_Term_0_Then').text, terms[0].then, 'the acceptance repeats the same terms');
    s = pinch('Legacy_AcceptConfirm', (v) => v.legacyView === 'awaiting' && v.legacyChallenge === 'accepted');
    assert.equal(inspect('Legacy_Title').text, 'Awaiting the board');
    capture('awaiting-board');
    checkPlayReturn('awaiting board');
    evidence.observations.challenge = { ...fields(s), terms };
    record('The rival challenge states its wager as four terms, repeated on Accept; confirming shows "Awaiting the board", with no match played or recorded');
    assert.equal(s.legacyMirrorBack, 'Legacy_AwaitingBack');
    const backPress = poke('Legacy_DockBack', (v) => v.legacyView === 'heralds-station', { device: 'hand-left' });
    s = backPress.state;
    evidence.observations.poke.push({ control: 'Legacy_DockBack (mirrors Back)', device: 'hand-left', distanceFromEye: backPress.distanceFromEye, contactMs: backPress.press?.contactMs ?? null });
    record(`A left fingertip press on the tray's Back (${backPress.distanceFromEye.toFixed(2)} m from the eye) returns to the Herald's Station`);
    s = pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice');
    s = pinch('Legacy_NoticeAwaiting', (v) => v.legacyView === 'awaiting');

    for (const hand of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device: hand, connected: false });
    const lost = poll((v) => v.paused && v.legacyView === 'pause' && !v.leftTracked && !v.rightTracked, 8);
    assert.equal(inspect('Legacy_Resume').state.displayed, false, 'Resume waits for a tracked hand');
    cli('xr', 'set-connected', { device: 'hand-right', connected: true });
    cli('xr', 'set-transform', { device: 'hand-right', anchor: 'target-ray', position: { x: 0.25, y: 1.3, z: -0.35 } });
    const recovered = poll((v) => v.rightTracked && v.paused, 8);
    s = pinch('Legacy_Resume', (v) => !v.paused && v.screen === 'legacy' && v.legacyView === 'awaiting');
    cli('xr', 'set-connected', { device: 'hand-left', connected: true });
    cli('xr', 'set-transform', { device: 'hand-left', anchor: 'target-ray', position: { x: -0.25, y: 1.3, z: -0.35 } });
    evidence.observations.trackingLoss = { lost: fields(lost), recovered: fields(recovered), resumed: fields(s) };
    record('Losing both hands pauses My Legacy; a returning hand enables Resume, which restores the exact Legacy view and state');

    s = pinch('Legacy_DockPause', (v) => v.paused && v.legacyView === 'pause', { pitch: 44 });
    assert.equal(s.legacyMirrorPrimary, 'Legacy_Resume', 'while paused the tray mirrors Resume');
    s = pinch('Legacy_PauseHome', (v) => !v.paused && v.screen === 'home' && !v.legacyActive);
    evidence.observations.pauseHome = fields(s);
    record('The tray\'s Pause (pinched) pauses My Legacy, and the pause view\'s Return to Home (pinched) goes Home');
    s = d.reachLegacy();
    assert.equal(s.legacyView, 'awaiting', 'reopening My Legacy returns to the same place');

    const recentersBefore = s.legacyRecenters;
    const yaw = 0.5;
    cli('xr', 'set-transform', { device: 'headset', orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
    const headBefore = cli('xr', 'get-transform', { device: 'headset' });
    const recenterTarget = target('Legacy_DockRecenter').position;
    cli('xr', 'set-transform', { device: 'hand-right', anchor: 'target-ray', position: { x: 0.25, y: 1.3, z: -0.35 } });
    cli('xr', 'look-at', { device: 'hand-right', target: recenterTarget });
    cli('xr', 'select', { device: 'hand-right', duration: 0.15 });
    s = poll((v) => v.legacyRecenters === recentersBefore + 1, 8);
    const head = cli('xr', 'get-transform', { device: 'headset' });
    assert.deepEqual(head, headBefore, 'Recenter never moves or rotates the viewer');
    const recenteredYaw = anchorYaw();
    assert.ok(angleDelta(recenteredYaw, yaw) < 0.05, `the Legacy anchor turned to the view (${recenteredYaw.toFixed(3)} vs ${yaw})`);
    look(0);
    s = pinch('Legacy_DockRecenter', (v) => v.legacyRecenters === recentersBefore + 2, { pitch: 44 });
    assert.ok(angleDelta(anchorYaw(), 0) < 0.05);
    evidence.observations.recenter = { headAfterTurn: head, anchorYawAfterTurn: recenteredYaw, viewerMovedByApp: false };
    record('Recenter moves the Legacy anchor, panel and tray in front of the current view; the viewer pose is only ever set by the test, never by the app');

    const place = { view: s.legacyView, banner: s.legacyBanner, representative: s.legacyRepresentative, file: s.legacyFile, challenge: s.legacyChallenge };
    const beforeExit = state();
    look(44);
    cli('xr', 'set-transform', { device: 'hand-right', anchor: 'target-ray', position: d.restingHand('hand-right', 'Legacy_DockExit') });
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
    d.enterXR();
    d.prepareHands();
    s = poll((v) => v.entered, 8);
    if (s.paused) s = pinch('Legacy_Resume', (v) => !v.paused);
    assert.equal(s.screen, 'legacy'); assert.equal(s.legacyView, place.view); assert.equal(s.legacyBanner, place.banner);
    assert.equal(s.legacyRepresentative, place.representative); assert.equal(s.legacyChallenge, place.challenge);
    evidence.observations.exitReentry = { acknowledgement, exited: fields(exited), reentered: fields(s) };
    record('Exit VR ends the immersive session from the tray; re-entry returns to the same Legacy place');

    if (!s.legacyPersistent) { evidence.limitations.push(`This run used a ${s.legacySession} session, so persistence across reload was not exercised.`); return; }
    const raw = probe('storage');
    const stored = JSON.parse(raw);
    assert.equal(stored.banner?.name, place.banner);
    assert.equal(stored.banner?.motto, 'We hold');
    assert.equal(stored.nomination?.file, place.file);
    assert.ok(stored.notices.some((notice) => notice.status === 'accepted'), 'the accepted challenge is in the save');
    evidence.observations.storedSave = {
      key: SAVE_KEY, bytes: raw.length, schemaVersion: stored.schemaVersion, banner: stored.banner.name, motto: stored.banner.motto,
      nominationFile: stored.nomination.file, acceptedNotices: stored.notices.filter((notice) => notice.status === 'accepted').length,
    };
    record(`The banner, motto, nomination and accepted challenge are written to ${SAVE_KEY} in this browser`);
    try {
      d.reload();
      d.enterXR();
      d.prepareHands();
      s = d.reachLegacy();
      assert.equal(s.legacySession, 'stored'); assert.equal(s.legacyBanner, place.banner); assert.equal(s.legacySaved, true);
      assert.equal(s.legacyRepresentative, place.representative); assert.equal(s.legacyFile, place.file); assert.equal(s.legacyChallenge, place.challenge);
      evidence.observations.reload = fields(s);
      record('After a page reload the saved banner, nomination and accepted challenge load from storage, and the tray says so');
    } catch (error) {
      if (!browserLost(error)) throw error;
      evidence.limitations.push(`Restoring the save after a page reload was not exercised in this run: the managed software browser closed while re-entering (${String(error.message || error).slice(0, 160)}). The save was read back above; loading it is covered by the session and persistence tests.`);
    }
  }

  /** Guest and preview sessions must never write storage: an earlier tester's record stays byte-identical. */
  function sessionWithoutStorage(kind) {
    const sentinel = JSON.stringify({ note: 'An earlier tester\'s save, which this session must neither read into the panels nor change', at: evidence.startedAt });
    if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* An ended-session acknowledgement is expected. */ } }
    assert.equal(probe('set-save', { CROWNFALL_LEGACY_SAVE: sentinel }), sentinel);
    const search = kind === 'guest' ? '?legacy=fresh' : `?legacyPreview=${kind.slice('preview:'.length)}`;
    evidence.observations.navigation = d.run(['browser', 'run', 'scripts/capture-legacy.mjs'], { CROWNFALL_LEGACY_SEARCH: search });
    for (let attempt = 0; attempt < 30; attempt++) { try { d.discover(); break; } catch { sleep(3); } }
    enterLegacy();
    let s = d.reachLegacy();
    evidence.observations.entry = fields(s);
    if (kind === 'guest') {
      assert.equal(s.legacySession, 'guest'); assert.equal(s.legacyPersistent, false); assert.equal(s.legacyView, 'nation');
      assert.equal(inspect('Legacy_DockLabel').text, 'Guest session - not saved');
      s = poke('Legacy_DockPrimary', (v) => v.legacyView === 'name').state;
      s = pinch('Legacy_Suggestion_0', (v) => v.legacyDraftName !== '');
      s = pinch('Legacy_NameNext', (v) => v.legacyView === 'arms');
      s = pinch('Legacy_ArmsNext', (v) => v.legacyView === 'confirm');
      assert.equal(inspect('Legacy_Confirm_Body').text, 'This guest banner lasts for this visit only and will not be saved.');
      s = pinch('Legacy_ConfirmRaise', (v) => v.legacyView === 'raised' && v.legacyFounded);
      s = pinch('Legacy_RaisedContinue', (v) => v.legacyView === 'overview');
      s = openLandmark('muster-grounds');
      s = pinch('Legacy_MusterChoose', (v) => v.legacyView === 'nominate');
      s = pinch('Legacy_MusterNominate', (v) => v.legacyView === 'muster-grounds' && v.legacyRepresentative !== '');
      s = pinch('Legacy_MusterBack', (v) => v.legacyView === 'overview');
      s = openLandmark('banner-hall');
      s = pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
      s = pinch('Legacy_ResetConfirm', (v) => v.legacyView === 'nation' && !v.legacyFounded);
      record('A guest founds, nominates and dissolves a banner with hands only, labelled "Guest session - not saved" throughout');
    } else {
      assert.equal(s.legacySession, 'preview'); assert.equal(s.legacyPersistent, false);
      if (s.legacyView === 'aftermath') {
        assert.equal(inspect('Legacy_Aftermath_0_Body').text.endsWith('...'), false, 'the aftermath is shown whole');
        s = pinch('Legacy_AftermathDismiss', (v) => v.legacyView === 'overview' && v.legacyAftermath === 0);
      }
      s = openLandmark('banner-hall');
      assert.equal(inspect('Legacy_ResetOpen').state.displayed, false, 'a development preview has no Dissolve control');
      assert.equal(inspect('Legacy_Hall_Locked').text, 'Development previews are fixture data and cannot be dissolved or saved.');
      s = pinch('Legacy_HallBack', (v) => v.legacyView === 'overview');
      record(`A development preview acknowledges its aftermath and cannot be dissolved; it stays labelled "${s.legacyLabel}"`);
    }
    const after = probe('storage');
    assert.equal(after, sentinel, `${kind}: the stored save is byte-identical after the session`);
    evidence.observations.storage = { key: SAVE_KEY, before: 'sentinel', afterIdentical: after === sentinel, session: s.legacySession };
    record(`${kind}: ${SAVE_KEY} is byte-identical before and after the session, so nothing was read into it or written`);
    probe('set-save', { CROWNFALL_LEGACY_SAVE: '' });
  }

  let failure;
  try {
    if (!process.argv.includes('--no-prepare')) {
      evidence.profile.emulationSetup = {
        applied: true,
        ...d.prepareEmulation({
          viewport: '640x480', preferences: { quality: 'low', motion: false },
          reloadIf: (current) => current.quality !== 'low' || current.motion !== false || !current.visitComplete,
        }),
        note: 'Software-emulation accommodation only: a 640x480 managed viewport, Quest Render Quality Low and Ambient Motion Off, and the short visit marked complete so entry opens Home.',
      };
    }
    for (let attempt = 1; ; attempt++) {
      try {
        if (session === 'production') production();
        else if (session === 'chessfirst') chessFirst();
        else if (session === 'guest' || session.startsWith('preview:')) sessionWithoutStorage(session);
        else throw Error(`Unknown session ${session}`);
        break;
      } catch (error) {
        if (attempt >= 3 || !browserLost(error)) throw error;
        // A relaunched browser loses the immersive session and page state: record it and run the whole flow again.
        (evidence.restarts ??= []).push({ attempt, reason: String(error.message || error).slice(0, 400), checksBeforeRestart: evidence.checks.slice() });
        evidence.checks.length = 0;
        d.interactions.length = 0;
        evidence.observations = {};
        d.waitForRuntime();
      }
    }
    try { evidence.observations.final = { state: fields(state()), session: cli('xr', 'status'), device: d.assertHandsOnly() }; } catch { /* Not in a session. */ }
    evidence.passed = true;
  } catch (error) {
    failure = error;
    evidence.failure = String(error.stack || error);
    try { evidence.observations.atFailure = fields(state()); } catch { /* The runtime may be gone. */ }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/${prefix}verification.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`${evidence.passed ? 'PASS' : 'FAIL'} ${evidence.checks.length} checks -> ${directory}/${prefix}verification.json`);
  }
  if (failure) throw failure;
}
