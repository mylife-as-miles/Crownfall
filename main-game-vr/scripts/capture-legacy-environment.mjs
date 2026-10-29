// Quest Bannerhold captures in an active, emulated immersive session (IWER browser
// emulation in the IWSDK managed Chromium, software-rendered: NOT a physical headset).
// Starts from the ?legacyEnvironment harness, enters XR through the page's Enter VR button,
// uses hands only (both controllers disconnected) and writes mono 60° screenshots plus
// evidence JSON to --out:
//   seated overview from the observation position, standing overview, a lean-in close-up of
//   the Muster Grounds Pawn, the occlusion reveal, a landmark emphasised after a real hand-ray
//   pinch (the select callback is asserted through the harness component), a wide staging view
//   with the gameplay panel areas, other fixtures, a stereo capture, the other nations, renderer
//   statistics and an emulator frame-timing sample.
//
//   node scripts/capture-legacy-environment.mjs [--out artifacts/legacy-environment/latest]
//     [--nation korvenia] [--fixture founded] [--quality high] [--fb-scale 0.35]
//     [--workspace <iwsdk workspace>] [--nations korvenia,solforiz,...] [--no-stereo] [--keep-runtime]
//     [--only seated,wide,standing,lean,reveal,select,fixtures,stereo,stats,nations] [--shot element|iwsdk]
//
// When run by `iwsdk browser run` the default export reopens the app frame with the harness
// query (HARNESS_SEARCH), which is how the script navigates the managed browser, or saves a
// Playwright screenshot of the app frame (SHOT_OUT). That is the default capture path because
// `iwsdk browser screenshot` repeatedly closed the managed browser mid-capture during XR sessions on
// this loaded host (always in the occlusion-reveal view); --shot iwsdk selects it again.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Browser-runner entry: reopens the app frame on the harness URL (HARNESS_SEARCH), or, with
 * SHOT_OUT set, saves a Playwright screenshot of the app frame's element to that path.
 */
export default async ({ page, frame }) => {
  if (process.env.SHOT_OUT) {
    // Hide the emulator overlays (control panels, edge vignette and badge are shadow-root hosts)
    // and the workspace view switcher for the capture; only the XR view remains.
    const app = frame ?? page.mainFrame();
    const toggle = (target, hide) => target.evaluate((on) => {
      const w = window;
      if (on) {
        w.__bhShotHidden = [];
        for (const e of Array.from(document.querySelectorAll('*'))) {
          if (e.shadowRoot || e.classList.contains('workspace-view-switcher')) { w.__bhShotHidden.push([e, e.style.visibility]); e.style.visibility = 'hidden'; }
        }
      } else {
        for (const [e, v] of w.__bhShotHidden || []) e.style.visibility = v;
        w.__bhShotHidden = null;
      }
    }, hide);
    const targets = frame ? [app, page.mainFrame()] : [app];
    for (const t of targets) await toggle(t, true);
    try {
      const element = frame ? await frame.frameElement() : null;
      const image = element ? await element.screenshot({ type: 'png', timeout: 90000 }) : await page.screenshot({ type: 'png', timeout: 90000 });
      await writeFile(process.env.SHOT_OUT, image);
      return { bytes: image.length, element: !!element };
    } finally {
      for (const t of targets) await toggle(t, false);
    }
  }
  const search = process.env.HARNESS_SEARCH ?? '?legacyEnvironment';
  if (!/^\?legacyEnvironment(&[a-zA-Z]+=[\w.-]+)*$/.test(search)) throw Error(`Unsupported harness query: ${search}`);
  const target = frame ?? page.mainFrame();
  const url = new URL(target.url());
  url.search = search;
  await target.goto(url.href, { waitUntil: 'load' });
  return { url: target.url() };
};

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i === -1 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(name);
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();

function sleep(seconds) { spawnSync('sleep', [String(seconds)]); }

async function main() {
  const workspace = resolve(option('--workspace', process.cwd()));
  const out = resolve(option('--out', 'artifacts/legacy-environment/latest'));
  const nation = option('--nation', 'korvenia');
  const fixture = option('--fixture', 'founded');
  const quality = option('--quality', 'high');
  const fbScale = Number(option('--fb-scale', '0.35'));
  // element: Playwright screenshot of the app frame with the emulator and workspace overlays hidden
  // (default); iwsdk: `iwsdk browser screenshot`, which on this loaded host repeatedly closed the
  // managed browser mid-capture during XR sessions.
  const shotMethod = option('--shot', 'element') === 'iwsdk' ? 'iwsdk' : 'element';
  const nations = option('--nations', nation).split(',').filter(Boolean);
  const only = option('--only', '').split(',').filter(Boolean);
  const want = (step) => only.length === 0 || only.includes(step);
  await mkdir(out, { recursive: true });
  const local = resolve(workspace, 'node_modules/.bin/iwsdk');
  const bin = existsSync(local) ? [local] : ['npx', '--no-install', '@iwsdk/cli'];
  const run = (args, env = {}, timeout = 150000) => {
    const [command, ...rest] = bin;
    for (let attempt = 0; ; attempt++) {
      const result = spawnSync(command, [...rest, ...args, '--workspace', workspace], { cwd: workspace, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
      let response;
      try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(`iwsdk ${args.slice(0, 2).join(' ')}: ${(result.stderr || result.stdout || '').slice(0, 400)}`); }
      if (response.ok) return response.data.result ?? response.data;
      // A loaded host can time out the CLI's runtime-ownership probe; the runtime itself is fine.
      if (attempt < 3 && /Owner probe timed out|ownership is unknown/.test(String(response.error?.message))) { sleep(5); continue; }
      throw Object.assign(Error(`iwsdk ${args.slice(0, 2).join(' ')}: ${JSON.stringify(response.error).slice(0, 400)}`), { sdkError: response.error });
    }
  };
  const cli = (domain, action, input, extra = []) => run([domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra]);
  const evidence = {
    startedAt: new Date().toISOString(),
    profile: {
      runtime: 'IWSDK 1.1.0-rc.2 managed headless Chromium with IWER Meta Quest 3 emulation (not a physical headset)',
      rendering: 'SwiftShader software WebGL on a shared 4-CPU host: frame times are NOT representative of a Quest; draw calls and triangles are.',
      view: 'mono, 60-degree field of view unless noted',
      input: 'hand ray + pinch only; both controllers disconnected',
      developmentFramebufferScale: fbScale,
      physicalHeadset: false,
      pinchView: 'During each landmark pinch the emulated head looks up at the sky so software frames stay inside the pointer click window; the hand ray, its target and the pinch are unchanged.',
      overlays: 'The blue edge vignette and the Remote Control badge are emulator overlays, not part of the scene. Captures marked "playwright frame-element screenshot" hide every emulator and workspace overlay.',
    },
    harness: { nation, fixture, quality },
    captures: [], interactions: [], checks: [], nations: {},
  };
  const record = (check) => { evidence.checks.push(check); console.log(`PASS ${check}`); };
  // ---- Runtime ----
  let started = false;
  const status = () => run(['dev', 'status'], {}, 60000);
  let st = status();
  if (!st.state.running) {
    run(['dev', 'up', '--headless', '--allow-browser-automation', '--timeout', '180000'], {}, 260000);
    started = true;
  }
  for (let i = 0; i < 30; i++) { st = status(); if (st.state.browserCommandReady) break; sleep(5); }
  assert.ok(st.state.browserCommandReady, 'IWSDK managed browser is command-ready');
  evidence.runtimeUrl = st.runtimeUrls.local;
  const self = fileURLToPath(import.meta.url);
  const runner = self.startsWith(workspace + '/') ? self.slice(workspace.length + 1) : 'scripts/capture-legacy-environment.mjs';
  const navigate = (params) => {
    const search = `?legacyEnvironment&${Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')}`;
    if (cli('xr', 'status').sessionActive) { try { cli('xr', 'exit', {}); } catch { /* an ended-session acknowledgement is fine */ } }
    return run(['browser', 'run', runner, '--timeout', '90000'], { HARNESS_SEARCH: search });
  };
  let entityIndex = -1;
  const discover = () => { entityIndex = cli('ecs', 'find', { withComponents: ['LegacyEnvironmentHarnessState'] }).entities[0].entityIndex; };
  const state = () => cli('ecs', 'query', { entityIndex, components: ['LegacyEnvironmentHarnessState'] }).components[0].values;
  const set = (field, value) => cli('ecs', 'set-component', { entityIndex, componentId: 'LegacyEnvironmentHarnessState', field, value });
  const command = (text) => {
    const seq = state().commandSeq + 1;
    set('command', text);
    set('commandSeq', seq);
    for (let i = 0; i < 40; i++) { if (state().handledSeq === seq) return; sleep(0.5); }
    throw Error(`Harness command not handled: ${text}`);
  };
  const report = () => { command('stats'); return JSON.parse(state().report); };
  const waitReady = (expect) => {
    for (let i = 0; i < 90; i++) {
      try { if (entityIndex < 0) discover(); const s = state(); if (s.ready && (!expect || expect(s))) return s; } catch { entityIndex = -1; }
      sleep(2);
    }
    throw Error('The harness did not become ready');
  };
  // ---- XR session, hands and head ----
  const enterXR = () => {
    if (cli('xr', 'status').sessionActive) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      let entry;
      for (let i = 0; i < 12 && !entry; i++) {
        const snapshot = cli('browser', 'snapshot', {});
        entry = snapshot.elements.find((e) => e.role === 'button' && e.name === 'Enter VR' && !e.disabled);
        if (!entry) sleep(2);
      }
      assert.ok(entry, 'The harness Enter VR button is available');
      try { cli('browser', 'interact', { steps: [{ action: 'click', ref: entry.ref }] }); } catch (error) {
        if (error.sdkError?.details?.code !== 'browser_command_timeout') throw error;
      }
      for (let i = 0; i < 30; i++) { if (cli('xr', 'status').sessionActive) return; sleep(2); }
    }
    throw Error('The immersive session did not start after Enter VR');
  };
  const prepareHands = () => {
    cli('xr', 'set-input-mode', { mode: 'hand' });
    for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
    for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
    cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
  };
  const lowerHands = () => {
    for (const [device, x] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
      cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x, y: 0.75, z: -0.15 } });
      cli('xr', 'look-at', { device, target: { x, y: 0, z: -0.2 } });
    }
  };
  const vec = (a) => ({ x: a[0], y: a[1], z: a[2] });
  const head = (position, target) => {
    cli('xr', 'set-transform', { device: 'headset', position: vec(position) });
    cli('xr', 'look-at', { device: 'headset', target: vec(target) });
  };
  /** PNG width and height from the IHDR chunk. */
  const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  /**
   * Screenshot of the app surface: `element` through Playwright on the app frame's element with the
   * overlays hidden, `iwsdk` through `iwsdk browser screenshot` (see --shot).
   */
  const capture = (name, note, extra = {}, method = shotMethod) => {
    sleep(4);
    const file = `${out}/${name}.png`;
    if (method === 'element') run(['browser', 'run', runner, '--timeout', '100000'], { SHOT_OUT: file }, 150000);
    else {
      let metadata;
      for (let attempt = 0; attempt < 4 && !metadata; attempt++) {
        try { metadata = cli('browser', 'screenshot', undefined, ['--output-file', file]); } catch (error) {
          // A slow software frame on a loaded host can time out the capture; the next attempt usually lands.
          if (error.sdkError?.details?.code !== 'browser_command_timeout' || attempt === 3) throw error;
          sleep(5);
        }
      }
    }
    const s = state();
    evidence.captures.push({ name, file: `${name}.png`, note, fixture: s.fixture, nation: s.nation, quality: s.quality, posture: s.posture, yaw: s.yaw, focus: s.focus, ...extra, method: method === 'element' ? 'playwright frame-element screenshot' : 'iwsdk browser screenshot', size: pngSize(file) });
    console.log(`CAPTURE ${file}`);
  };
  const vr = (s) => (s === 'standing' ? { eye: 1.62, surface: 0.98, distance: 0.85 } : { eye: 1.2, surface: 0.74, distance: 0.82 });
  /** Head at the posture's eye height looking at the miniature centre, then recentre the anchor there. */
  const overview = (posture) => {
    set('posture', posture);
    const p = vr(posture);
    head([0, p.eye, 0], [0, p.eye - (p.eye - p.surface), -p.distance]);
    command('recenter');
    sleep(1);
    const r = report();
    head([0, p.eye, 0], r.targets.surfaceCenter);
    return r;
  };
  // ---- Hand ray select ----
  const targetOf = (name, fallback) => {
    try {
      const t = cli('xr', 'list-targets').targets.find((item) => item.name === name);
      if (t) return [t.position.x, t.position.y, t.position.z];
    } catch { /* resolver unavailable: use the harness report */ }
    return fallback;
  };
  const pinchLandmark = (id, r) => {
    const target = targetOf(`Landmark_${id}`, r.targets[id]);
    const holds = [0.05, 0.15, 0.3, 0.5];
    for (let attempt = 0; attempt < holds.length; attempt++) {
      cli('xr', 'set-transform', { device: 'hand-right', anchor: 'target-ray', position: { x: 0.2, y: 0.98, z: -0.28 } });
      cli('xr', 'look-at', { device: 'hand-right', target: vec(target) });
      sleep(3);
      const before = state();
      const hovered = before.hover === id;
      evidence.interactions.push({ id: `Landmark_${id}`, device: 'hand-right', attempt: attempt + 1, aim: target, hovered });
      if (!hovered) continue;
      // Software frames here take ~0.6 s, longer than the pointer click window: the head looks up at the
      // sky during the pinch so frames are cheap. The hand ray, its target and the pinch are unchanged.
      cli('xr', 'look-at', { device: 'headset', target: { x: 0, y: 6, z: -1 } });
      sleep(2);
      cli('xr', 'select', { device: 'hand-right', duration: holds[attempt] });
      for (let i = 0; i < 12; i++) {
        const after = state();
        if (after.selectCount > before.selectCount && after.lastSelect === id) {
          evidence.interactions.push({ id: `Landmark_${id}`, selected: true, holdSeconds: holds[attempt], selectCount: after.selectCount, focus: after.focus, hoverCount: after.hoverCount });
          return { target, after };
        }
        sleep(1);
      }
    }
    throw Error(`Hand-ray pinch did not select ${id}`);
  };
  const summarise = (r) => ({
    views: r.debug.xrViews || 1,
    environmentVisibleDraws: r.debug.visibleDraws,
    environmentVisibleTriangles: r.debug.visibleTriangles,
    staticDraws: r.debug.staticDraws,
    instanceDraws: r.debug.instanceDraws,
    rendererFrame: r.debug.renderer,
    textures: r.debug.textures,
    textureMB: +((r.debug.textureBytes + r.debug.atlasBytes) / 1048576).toFixed(2),
    buildMs: r.debug.buildMs,
    prepMs: r.debug.prepMs,
    installMs: r.debug.installMs,
  });
  const harnessParams = { nation, fixture, quality, posture: 'seated', fbScale };
  const openSession = () => {
    navigate(harnessParams);
    entityIndex = -1;
    sleep(5);
    waitReady();
    enterXR();
    prepareHands();
    lowerHands();
    waitReady((v) => v.presenting);
  };
  const recover = (why) => {
    evidence.recoveries = (evidence.recoveries ?? 0) + 1;
    (evidence.recoveryLog ??= []).push({ at: new Date().toISOString(), why: why.slice(0, 240) });
    console.log(`RECOVER ${why.slice(0, 160)}`);
    for (let i = 0; i < 60; i++) { try { if (status().state.browserCommandReady) break; } catch { /* relaunching */ } sleep(5); }
    openSession();
  };
  /**
   * Runs one capture step; after a managed-browser relaunch (the software-rendered browser on a
   * loaded, shared host occasionally closes) it reopens the session and retries, at most twice.
   */
  const step = (name, fn) => {
    if (!want(name)) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { fn(); return; } catch (error) {
        const text = String(error.message || error);
        if (attempt < 2 && /Browser not ready|browser_relaunched|closed unexpectedly|not_executed|has been closed|did not become ready/.test(text)) { recover(`${name}: ${text}`); continue; }
        throw error;
      }
    }
  };
  try {
    openSession();
    let s = state();
    assert.equal(s.caption, 'Development fixture · environment preview · not saved');
    record('The ?legacyEnvironment harness shows the Bannerhold with a labelled development fixture (never production state)');
    const xr = cli('xr', 'status');
    const device = cli('xr', 'get-device-state', {});
    assert.equal(xr.sessionActive, true);
    assert.equal(device.inputMode, 'hand');
    assert.equal(device.controllers.left.connected, false);
    assert.equal(device.controllers.right.connected, false);
    evidence.session = { active: xr.sessionActive, mode: xr.sessionMode, features: xr.enabledFeatures, inputMode: device.inputMode, controllers: device.controllers, hands: { left: device.hands?.left?.connected, right: device.hands?.right?.connected } };
    record('Active immersive session entered through the page Enter VR button, hand input, both controllers disconnected');
    let r = null;
    evidence.staging = {};
    step('seated', () => {
      r = overview('seated');
      evidence.staging.seated = r.staging;
      capture('seated-overview', 'Seated: eyes 1.20 m above the floor; the miniature centre 0.82 m ahead and 0.46 m below the eyes; anchor recentred at the eyes');
    });
    step('wide', () => {
      overview('seated');
      set('panels', true);
      cli('xr', 'set-device-state', { state: { fov: 100 } });
      head([0, 1.2, 0], [0, 1.0, -1]);
      try {
        capture('seated-staging-wide', 'Wide 100-degree check: getStaging() panel (left) and dock (right) areas at 150 % text width, clear of the holding, its skyline and every structure', { fov: 100 });
      } finally {
        set('panels', false);
        cli('xr', 'set-device-state', { state: { fov: 60 } });
      }
    });
    step('standing', () => {
      r = overview('standing');
      evidence.staging.standing = r.staging;
      capture('standing-overview', 'Standing: eyes 1.62 m; the miniature centre 0.85 m ahead and 0.64 m below the eyes');
    });
    step('lean', () => {
      r = overview('seated');
      const pawn = r.targets.pawnChest;
      const lean = [pawn[0] + 0.02, pawn[1] + 0.12, pawn[2] + 0.17];
      head(lean, pawn);
      capture('lean-in-muster-pawn', 'Leaning in about 0.2 m from the nominated Pawn at the Muster Grounds; the environment never moves the viewer', { headPosition: lean, pawn });
    });
    step('reveal', () => {
      // A low lean toward the Muster Grounds from behind the lower town, until a building stands between
      // the head and the Pawn; with the Muster Grounds focused the occluder dissolves around the line of sight.
      r = overview('seated');
      command('focus:muster-grounds');
      const pawn = r.targets.pawnChest;
      let chosen = null;
      for (const [dx, dy, dz] of [[0, 0.03, 0.2], [0.04, 0.025, 0.24], [-0.05, 0.03, 0.22], [0.08, 0.04, 0.26], [0, 0.02, 0.3], [-0.1, 0.035, 0.2]]) {
        const eye = [pawn[0] + dx, pawn[1] + dy, pawn[2] + dz];
        head(eye, pawn);
        sleep(4);
        const rep = report();
        if (rep.debug.reveal.strength > 0.6) { chosen = { eye, reveal: rep.debug.reveal }; break; }
      }
      if (!chosen) { evidence.reveal = { demonstrated: false, note: 'No tried lean put a building between the head and the Pawn' }; command('focus:'); return; }
      evidence.reveal = { demonstrated: true, ...chosen };
      record(`Occlusion reveal: with the Muster Grounds focused, a building between the head and the Pawn dissolves (strength ${chosen.reveal.strength}, ${chosen.reveal.pairs} occluder materials on dissolve variants)`);
      capture('reveal-muster-pawn', 'Occlusion reveal on Quest: the head leans low behind the lower town; the building between the head and the Pawn dissolves in a noisy, dithered capsule (development fixture)', { headPosition: chosen.eye, pawn }, 'element');
      command('focus:');
    });
    step('select', () => {
      r = overview('seated');
      command('focus:');
      const picked = pinchLandmark('war-record', r);
      assert.equal(picked.after.focus, 'war-record');
      record('A hand-ray pinch on the War Record proxy fired onLandmarkSelect (harness selectCount and lastSelect) and focusLandmark emphasised it without moving the viewer');
      head([0, 1.2, 0], picked.target);
      capture('landmark-war-record-selected', 'After the pinch: the War Record emphasised (label, ground ring, warm rim) with the hand ray still on it', { selected: 'war-record' });
      lowerHands();
      command('focus:');
    });
    step('fixtures', () => {
      for (const [id, note] of [['captive', 'Captive fixture: the Pawn stand at the Muster Grounds is empty and a sealed writ marks the captor'], ['recognised', 'Recognised fixture: hall tier 2 completes the unfinished range and adds development; honour places filled']]) {
        set('fixture', id);
        waitReady((v) => v.fixture === id);
        overview('seated');
        capture(`fixture-${id}`, `${note} (development fixture)`);
      }
      set('fixture', fixture);
      waitReady((v) => v.fixture === fixture);
    });
    if (!flag('--no-stereo')) step('stereo', () => {
      cli('xr', 'set-device-state', { state: { stereoEnabled: true } });
      try {
        overview('seated');
        capture('seated-stereo', 'Stereo emulation: both eyes side by side (development framebuffer scale)', { stereo: true });
      } finally {
        cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 60 } });
      }
    });
    step('stats', () => {
      overview('seated');
      sleep(3);
      r = report();
      evidence.environment = summarise(r);
      evidence.environmentDebug = r.debug;
      evidence.contractStats = { ...r.stats, frameTimesMs: r.stats.frameTimesMs.slice(-60) };
      try {
        const rs = cli('scene', 'render-stats', {});
        const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
        evidence.renderStats = {
          ...pick(rs, ['available', 'calls', 'triangles', 'points', 'lines', 'geometries', 'textures', 'programs', 'meshCount', 'materialCount', 'shadowCasters']),
          environment: pick(rs.environment, ['canvas', 'pixelRatio', 'renderer', 'shadows', 'toneMapping']),
          sceneAssets: rs.sceneAssets ?? null,
          note: 'iwsdk scene render-stats of the last frame; meshCount and materialCount include the hidden menu nodes (not drawn).',
        };
      } catch (error) { evidence.renderStats = { error: String(error.message || error) }; }
      try {
        cli('browser', 'profile', { action: 'start', mode: 'rendering', maxDurationMs: 12000 });
        sleep(8);
        const profile = cli('browser', 'profile', { action: 'stop' });
        const sm = profile.summary ?? {};
        evidence.frameTiming = { durationMs: profile.durationMs, frameTimeMs: sm.frameTimeMs ?? null, longTasks: sm.longTasks ?? null, jsHeapUsedMB: sm.browserMetrics?.JSHeapUsedSize ? +(sm.browserMetrics.JSHeapUsedSize / 1048576).toFixed(1) : null, caveat: evidence.profile.rendering };
      } catch (error) { evidence.frameTiming = { error: String(error.message || error) }; }
      const rf = evidence.environment.rendererFrame;
      const views = r.debug.xrViews || 1;
      evidence.budget = { drawCalls: rf.calls, triangles: rf.triangles, views, perViewDrawCalls: Math.round(rf.calls / views), perViewTriangles: Math.round(rf.triangles / views), limits: { drawCalls: 120, triangles: 250000 }, note: 'renderer.info of the last frame: the whole harness frame (environment, sky, harness caption and controls, emulator hands and rays). Without multiview the emulator draws each eye separately, so per-view numbers are the frame divided by the views rendered.' };
      record(`Renderer frame: ${rf.calls} draw calls, ${rf.triangles} triangles over ${views} view(s) (${evidence.budget.perViewDrawCalls} / ${evidence.budget.perViewTriangles} per view; Quest budget 120 / 250k); environment alone ${evidence.environment.environmentVisibleDraws} draws, ${evidence.environment.environmentVisibleTriangles} triangles submitted`);
    });
    step('nations', () => {
      for (const n of nations) {
        if (n === nation) continue;
        set('nation', n);
        for (let i = 0; i < 90; i++) { try { if (report().debug.nationId === n) break; } catch { /* rebuilding */ } sleep(2); }
        overview('seated');
        sleep(2);
        r = report();
        evidence.nations[n] = summarise(r);
        capture(`nation-${n}-seated`, `Seated overview of the ${n} first-pass layout through the same Quest pipeline`);
      }
      if (nations.length > 1) set('nation', nation);
    });
    evidence.passed = true;
  } catch (error) {
    evidence.passed = false;
    evidence.error = String(error.stack || error.message || error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    try { lowerHands(); } catch { /* the session may have ended */ }
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
    console.log(`EVIDENCE ${out}/evidence.json`);
    if (started && !flag('--keep-runtime')) { try { run(['dev', 'down'], {}, 60000); } catch { /* already down */ } }
  }
}
