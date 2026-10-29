// Mono 60-degree captures of the Quest My Legacy destination in an active,
// emulated immersive session (IWER browser emulation, not a physical headset),
// reached only through real hand rays and pinches. Captures: founding (nation
// and arms), the overview with the holding, landmark inspections, a Herald
// notice with its wager, and pause. With --session guest or --session
// preview:<id>, the managed app frame is first reopened with ?legacy=fresh or
// ?legacyPreview=<id> through the IWSDK browser runner (start the runtime with
// --allow-browser-automation) and the labelled browser entry panel is captured too.
//   node scripts/capture-legacy.mjs [--out artifacts/legacy/latest] [--session production|guest|preview:<id>]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { enterQuestXR } from './enter-quest.mjs';

/** Browser-runner entry: reopens the app frame with a Legacy session query (guest or development preview). */
export default async ({ page, frame }) => {
  const search = process.env.CROWNFALL_LEGACY_SEARCH ?? '';
  if (!/^(\?(legacy=fresh|legacyPreview=[a-z0-9-]+))?$/.test(search)) throw Error(`Unsupported Legacy session query: ${search}`);
  const target = frame ?? page.mainFrame();
  const url = new URL(target.url());
  url.search = search;
  await target.goto(url.href, { waitUntil: 'load' });
  return { url: target.url() };
};

const option = (name, fallback) => { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; };
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();

async function main() {
  const directory = option('--out', 'artifacts/legacy/latest');
  const session = option('--session', 'production');
  const prefix = session === 'production' ? '' : `${session.replace(/[^a-z0-9-]/g, '-')}-`;
  await mkdir(directory, { recursive: true });
  const bin = existsSync('node_modules/.bin/iwsdk') ? ['node_modules/.bin/iwsdk'] : ['npx', '--no-install', '@iwsdk/cli'];
  const emulatorScale = (() => { try { return Number(/VITE_CROWNFALL_EMULATOR_SCALE=([\d.]+)/.exec(readFileSync('.env.local', 'utf8'))?.[1]) || 1; } catch { return 1; } })();
  const run = (args, env) => {
    const [command, ...rest] = bin;
    const result = spawnSync(command, [...rest, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...env } });
    let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(result.stderr || result.stdout); }
    if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error)), { sdkError: response.error });
    return response.data.result ?? response.data;
  };
  const cli = (domain, action, input, extra = []) => run([domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra]);
  const evidence = {
    session, startedAt: new Date().toISOString(),
    profile: {
      runtime: 'IWER Meta Quest 3 browser emulation, managed headless Chromium', view: 'mono, 60-degree field of view', input: 'hand ray + pinch; both controllers disconnected',
      developmentFramebufferScale: emulatorScale, physicalHeadset: false,
      note: 'Development captures from software-rendered (SwiftShader) emulation, including emulator hand and ray overlays; not a headset recording.',
      menuPinchView: 'Menu pinches (reaching My Legacy) look almost straight down (88 degrees) so the hero and the menu atmosphere leave the view and software frames stay inside the 800 ms click window.',
    },
    captures: [], interactions: [],
  };
  let stateIndex, panelIndex, dockIndex;
  const discover = () => {
    stateIndex = cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
    panelIndex = cli('ecs', 'find', { namePattern: '^My Legacy Panel$' }).entities[0].entityIndex;
    dockIndex = cli('ecs', 'find', { namePattern: '^My Legacy Dock$' }).entities[0].entityIndex;
  };
  const state = () => cli('ecs', 'query', { entityIndex: stateIndex, components: ['CrownfallQuestState'] }).components[0].values;
  const owner = (id) => id.startsWith('Legacy_Dock') ? dockIndex : id.startsWith('Legacy') ? panelIndex : stateIndex;
  const inspect = (id) => cli('ui', 'inspect', { entityIndex: owner(id), selector: `#${id}` }).elements[0];
  const poll = (expected, attempts = 8) => { let value; for (let i = 0; i < attempts; i++) { value = state(); if (expected(value)) return value; } throw Error(`State not reached: ${JSON.stringify(value)}`); };
  const target = (name) => { const found = cli('xr', 'list-targets').targets.find((item) => item.name === name); assert.ok(found, name); return found; };
  const lowerHands = () => {
    for (const [device, x] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 0.95, z: -0.3 } });
      // Resting rays point at the floor, so no hover highlight or pointing status is left in the capture.
      cli('xr', 'look-at', { device, target: { x, y: 0, z: -0.35 } });
    }
  };
  const holds = [0.01, 0.15, 0.3];
  const pinch = (id, expected, device = 'hand-right', attempts = holds.length) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x: device === 'hand-right' ? 0.25 : -0.25, y: 1.3, z: -0.35 } });
      cli('xr', 'look-at', { device, target: target(id).position });
      const control = inspect(id);
      if (!control?.state.hovered) { evidence.interactions.push({ id, attempt: attempt + 1, aim: control?.state ?? null }); continue; }
      const hold = holds[attempt % holds.length];
      cli('xr', 'select', { device, duration: hold });
      let after; for (let query = 0; query < 6; query++) { after = state(); if (expected(after)) break; }
      evidence.interactions.push({ id, attempt: attempt + 1, holdSeconds: hold, legacyView: after.legacyView });
      if (expected(after)) return after;
    }
    throw Error(`Hand pinch failed: ${id}`);
  };
  /** Head pitch for a capture: 0 looks level at the panel; a small downward pitch frames panel and holding together. */
  const look = (pitchDegrees) => {
    const half = (-pitchDegrees * Math.PI / 180) / 2;
    cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) } });
  };
  const capture = (name, pitchDegrees, note) => {
    look(pitchDegrees);
    lowerHands();
    const file = `${directory}/${prefix}${name}.png`;
    const metadata = cli('browser', 'screenshot', undefined, ['--output-file', file]);
    const s = state();
    evidence.captures.push({ name, file, headPitchDegrees: pitchDegrees, note, legacyView: s.legacyView, session: s.legacySession, label: s.legacyLabel, metadata });
    console.log(`CAPTURE ${file}`);
    look(0);
  };
  const enterXR = () => {
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
  };
  const prepareHands = () => {
    cli('xr', 'set-input-mode', { mode: 'hand' });
    for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
    cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
    look(0);
  };
  /**
   * A pinch on a menu control with the head looking almost straight down (88 degrees): software rendering of the 80k-triangle hero
   * takes about a second per frame here, longer than the pointer's 800 ms click window. The ray and pinch are unchanged.
   */
  const menuPinch = (id, expected, attempts) => {
    look(88);
    try { return pinch(id, expected, 'hand-right', attempts); } finally { look(0); }
  };
  const reachLegacy = () => {
    let s = state();
    if (s.paused) s = s.legacyActive ? pinch('Legacy_Resume', (v) => !v.paused) : menuPinch('Btn_Resume', (v) => !v.paused);
    if (s.screen === 'onboarding') s = menuPinch('Btn_SkipVisit', (v) => v.screen === 'home');
    if (!s.legacyActive) {
      if (s.modal) s = menuPinch('Btn_Cancel', (v) => !v.modal);
      if (s.screen !== 'home') s = menuPinch('Nav_Home', (v) => v.screen === 'home');
      s = menuPinch('Home_legacy', (v) => v.legacyActive, 6);
    }
    return poll((v) => v.legacyEnvironmentReady);
  };
  /**
   * Software-emulation setup shared with verify-legacy.mjs: the capture viewport, Quest Render Quality Low and
   * Ambient Motion Off (lighter software frames), and the short visit marked complete so entry opens Home.
   */
  const prepareEmulation = () => {
    const viewport = option('--viewport', '800x560');
    const env = { CROWNFALL_LEGACY_PROBE: 'prepare', CROWNFALL_VIEWPORT: viewport, CROWNFALL_QUEST_PREFERENCES: JSON.stringify({ quality: 'low', motion: false }), CROWNFALL_QUEST_VISITED: '1' };
    try {
      evidence.emulationSetup = { applied: true, ...run(['browser', 'run', 'scripts/verify-legacy.mjs', '--timeout', '90000'], env) };
      // Preferences apply on load; reload only when the running app does not already use them (re-entering right
      // after a reload is where the managed software browser has closed on this host).
      let current = null;
      try { discover(); current = state(); } catch { /* The app is still loading. */ }
      if (!current || current.quality !== 'low' || current.motion !== false || !current.visitComplete) {
        if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* An ended-session acknowledgement is expected. */ } }
        cli('browser', 'reload', {});
        for (let attempt = 0; attempt < 30; attempt++) { try { discover(); break; } catch { spawnSync('sleep', ['3']); } }
      }
    } catch (error) { evidence.emulationSetup = { applied: false, reason: String(error.message || error) }; }
  };
  /** The whole capture sequence from the current page; run again from the start after a browser relaunch. */
  const captureFlow = () => {
    if (session !== 'production') {
      const search = session === 'guest' ? '?legacy=fresh' : `?legacyPreview=${session.slice('preview:'.length)}`;
      assert.ok(session === 'guest' || session.startsWith('preview:'), `Unknown session ${session}`);
      if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* An ended session acknowledgement is fine. */ } }
      evidence.navigation = run(['browser', 'run', 'scripts/capture-legacy.mjs'], { CROWNFALL_LEGACY_SEARCH: search });
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) { try { discover(); ready = true; } catch { spawnSync('sleep', ['3']); } }
      assert.ok(ready, 'The app reopened with the Legacy session query');
      const file = `${directory}/${prefix}browser-entry.png`;
      evidence.captures.push({ name: 'browser-entry', file, note: 'Browser entry panel before entering VR, showing the session label', metadata: cli('browser', 'screenshot', undefined, ['--output-file', file]) });
      console.log(`CAPTURE ${file}`);
    }
    discover();
    if (!cli('xr', 'status').sessionActive) enterXR();
    prepareHands();
    let s = reachLegacy();
    if (session === 'production') {
      if (s.legacyFounded) {
        s = pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
        s = pinch('Legacy_ResetConfirm', (v) => v.legacyView === 'nation');
      }
      capture('founding-nation', 0, 'Founding step 1: the four nations from shared content');
      s = pinch('Legacy_NationNext', (v) => v.legacyView === 'name');
      s = pinch('Legacy_OpenKeyboard', (v) => v.legacyView === 'keyboard');
      for (const key of ['A', 'S', 'H']) pinch(`Legacy_Key_${key}`, () => true);
      capture('founding-keyboard', 0, 'Optional large-key letter keyboard for a custom banner name');
      s = pinch('Legacy_KeyboardCancel', (v) => v.legacyView === 'name');
      s = pinch('Legacy_Suggestion_0', (v) => v.legacyDraftName !== '');
      capture('founding-name', 0, 'Quick name suggestions with Other names and Type a name');
      s = pinch('Legacy_NameNext', (v) => v.legacyView === 'arms');
      s = pinch('Legacy_Preset_1', (v) => v.legacyHeraldry !== '');
      capture('founding-arms', 0, 'Heraldry presets, per-element cycling and the live shared raster preview');
      s = pinch('Legacy_ArmsNext', (v) => v.legacyView === 'confirm');
      s = pinch('Legacy_ConfirmRaise', (v) => v.legacyFounded && v.legacyView === 'overview');
      capture('overview', 10, 'Overview: landmark list above the holding; head pitched 10 degrees down to frame panel, dock and holding');
      s = pinch('Legacy_Landmark_banner-hall', (v) => v.legacyView === 'banner-hall');
      capture('landmark-banner-hall', 10, 'Banner Hall inspection with the founded arms and honest empty honours');
      s = pinch('Legacy_HallBack', (v) => v.legacyView === 'overview');
      s = pinch('Legacy_Landmark_muster-grounds', (v) => v.legacyView === 'muster-grounds');
      s = pinch('Legacy_Member_0', (v) => v.legacyMemberChoice === 'member-1');
      const file = ['a', 'b', 'c', 'f', 'g', 'h'].map((letter) => `Legacy_File_${letter}`).find((id) => inspect(id)?.state.displayed);
      s = pinch(file, (v) => v.legacyFileChoice === file.slice(-1));
      s = pinch('Legacy_MusterNominate', (v) => v.legacyRepresentative !== '');
      capture('landmark-muster-grounds', 10, 'Muster Grounds after nominating a member and an open file');
      s = pinch('Legacy_MusterBack', (v) => v.legacyView === 'overview');
      s = pinch('Legacy_Landmark_heralds-station', (v) => v.legacyView === 'heralds-station');
      s = pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice');
      capture('notice-wager', 0, 'Formal challenge with its wager stated before any match');
    } else if (session === 'guest') {
      capture('founding-nation', 0, 'Guest founding: the session band says the banner is not saved');
    } else {
      capture('overview', 10, 'Development preview: fixture data, at most two aftermath messages');
      s = pinch('Legacy_Landmark_muster-grounds', (v) => v.legacyView === 'muster-grounds');
      capture('landmark-muster-grounds', 10, 'Development preview of the Muster Grounds');
      s = pinch('Legacy_MusterBack', (v) => v.legacyView === 'overview');
    }
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: false });
    poll((v) => v.paused && v.legacyView === 'pause');
    capture('pause', 0, 'Hand-tracking loss pauses My Legacy; Resume waits for a tracked hand');
    cli('xr', 'set-connected', { device: 'hand-right', connected: true });
    poll((v) => v.rightTracked);
    pinch('Legacy_Resume', (v) => !v.paused);
    cli('xr', 'set-connected', { device: 'hand-left', connected: true });
    evidence.final = { state: Object.fromEntries(Object.entries(state()).filter(([key]) => key.startsWith('legacy') || key === 'screen')), session: cli('xr', 'status') };
  };
  /** Errors that mean the managed browser itself went away or stalled; the capture sequence must start again. */
  const browserLost = (error) => /Browser not ready|browser_relaunched|Managed browser is closing|Target disconnected|connection_lost|browser_command_timeout|browser_not_launched/
    .test(String(error?.message || error));
  const waitForRuntime = () => {
    try { run(['runtime', 'recover']); } catch { /* Still relaunching. */ }
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (cli('dev', 'status').state.browserCommandReady) return; } catch { /* Still relaunching. */ }
      spawnSync('sleep', ['5']);
    }
    throw Error('The managed browser did not come back after a relaunch');
  };
  let failure;
  try {
    if (!process.argv.includes('--no-prepare')) prepareEmulation();
    for (let attempt = 1; ; attempt++) {
      try { captureFlow(); break; } catch (error) {
        if (attempt >= 3 || !browserLost(error)) throw error;
        (evidence.restarts ??= []).push({ attempt, reason: String(error.message || error).slice(0, 400), capturesBeforeRestart: evidence.captures.map((item) => item.name) });
        evidence.captures.length = 0;
        evidence.interactions.length = 0;
        waitForRuntime();
        if (!process.argv.includes('--no-prepare')) prepareEmulation();
      }
    }
  } catch (error) {
    failure = error;
    evidence.failure = String(error.stack || error);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/${prefix}capture-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  if (failure) throw failure;
}
