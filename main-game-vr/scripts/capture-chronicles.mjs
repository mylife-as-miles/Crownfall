import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Chronicles evidence from a running IWSDK runtime. The browser preview is
// driven by real canvas clicks, which register at any frame rate; the
// emulated XR session is then driven by hand-ray pinches. Start the runtime
// with `npx @iwsdk/cli dev up --headless --allow-browser-automation` (without
// the flag, captures stay at the managed window size). Run from main-game-vr;
// CROWNFALL_IWSDK_WORKSPACE selects the workspace when it lives elsewhere.
const workspace = process.env.CROWNFALL_IWSDK_WORKSPACE || process.cwd();
const directory = resolve('artifacts/chronicles');
await mkdir(directory, { recursive: true });
const evidence = {
  complete: false,
  profile: { runtime: 'IWSDK-managed IWER Meta Quest 3', physicalHeadset: false, rendering: 'software (SwiftShader); not headset GPU or frame-time evidence', browserInputs: 'canvas clicks', xrInputs: 'hand ray + pinch, controllers disconnected' },
  captures: [], interactions: [], checks: [],
};
const hotspots = ['korvenia', 'solforiz', 'aethelgard', 'kwind-09'];
// The browser preview camera sits at the anchor, pitched toward the panel; on
// the Atlas it tilts a further 0.295 rad and widens to 70 degrees.
const MENU_VIEW = { fov: 42, pitch: Math.atan2(-.12, 1.5) };
const ATLAS_VIEW = { fov: 70, pitch: Math.atan2(-.12, 1.5) - .295 };

function cli(domain, action, input, extra = [], env) {
  const args = ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra];
  const result = spawnSync('npx', args, { cwd: workspace, encoding: 'utf8', timeout: 150000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } });
  let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(result.stderr || result.stdout); }
  if (!response.ok) throw Object.assign(Error(JSON.stringify(response.error).slice(0, 800)), { sdkError: response.error });
  return response.data.result ?? response.data;
}
let entityIndex;
const stateEntity = () => entityIndex ??= cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
const state = () => cli('ecs', 'query', { entityIndex: stateEntity() }).components.find(item => item.componentId === 'CrownfallQuestState').values;
const settle = () => { for (let attempt = 0; attempt < 20; attempt++) { try { entityIndex = undefined; if (state().screen) return; } catch { /* reloading */ } } throw Error('The runtime did not come back'); };
const targets = () => cli('xr', 'list-targets').targets;
const stats = () => { const s = cli('scene', 'render-stats', {}); return { calls: s.calls, triangles: s.triangles, points: s.points, geometries: s.geometries, textures: s.textures, programs: s.programs }; };
const check = (name, passed, detail = {}) => { evidence.checks.push({ name, passed, ...detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); assert.ok(passed, name); };
let automation = true;

function project(point, view, width, height) {
  const dy = point.y - 1.6, theta = -view.pitch;
  const y = dy * Math.cos(theta) - point.z * Math.sin(theta), z = dy * Math.sin(theta) + point.z * Math.cos(theta);
  const t = Math.tan(view.fov * Math.PI / 360);
  return { x: Math.round(((point.x / -z) / (t * width / height) + 1) / 2 * width), y: Math.round((1 - (y / -z) / t) / 2 * height) };
}
function canvas() {
  // After a full-size capture the app may still be resizing back to the managed window.
  for (let poll = 0; poll < 10; poll++) {
    const bounds = cli('browser', 'snapshot', {}).elements.find(element => element.role === 'canvas').bounds;
    if (bounds.width <= 800) return bounds;
  }
  throw Error('The runtime canvas did not return to the managed window size');
}
function click(id, expected, view = MENU_VIEW, lift = 0) {
  const target = targets().find(item => item.name === id);
  assert.ok(target, `Visible target exists: ${id}`);
  const { width, height } = canvas();
  const point = project({ ...target.position, y: target.position.y + lift }, view, width, height);
  cli('browser', 'interact', { steps: [{ action: 'click', point }] });
  let after;
  for (let poll = 0; poll < 5; poll++) { after = state(); if (expected(after)) break; }
  evidence.interactions.push({ input: 'canvas click', id, point, selectedControl: after.selectedControl, screen: after.screen, passed: expected(after) });
  assert.ok(expected(after), `Click on ${id} reached its state`);
  return after;
}

// Full-size frames and saved preferences go through the managed browser's
// Playwright runner when the runtime allows it.
function step(env, timeout = 100000) {
  return cli('browser', 'run', undefined, ['scripts/chronicles-runtime-step.mjs', '--timeout', String(timeout)], env);
}
async function capture(slug, title, group, settleMs = 9000) {
  const filename = `${String(evidence.captures.length + 1).padStart(2, '0')}-${slug}.png`, path = resolve(directory, filename);
  const xr = cli('xr', 'status').sessionActive;
  let metadata;
  if (automation && !xr) {
    try { metadata = step({ CROWNFALL_STEP: 'frame', CROWNFALL_FRAME: path, CROWNFALL_SETTLE: String(settleMs) }); }
    catch (error) { automation = false; evidence.automationUnavailable = String(error.message).slice(0, 300); }
  }
  metadata ??= cli('browser', 'screenshot', undefined, ['--output-file', path]);
  const current = state();
  evidence.captures.push({ filename, title, group, xr, state: { screen: current.screen, selectedControl: current.selectedControl, posture: current.posture, entered: current.entered, paused: current.paused }, renderStats: stats(), metadata: { width: metadata.width ?? 1280, height: metadata.height ?? 720 } });
  await save();
  console.log(`CAPTURE ${evidence.captures.length}: ${title}`);
}
function startWith(preferences) {
  if (!automation) return false;
  step({ CROWNFALL_STEP: 'preferences', CROWNFALL_PREFERENCES: JSON.stringify(preferences) });
  settle();
  return true;
}
async function save() { await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n'); }
function waitForAtlas() {
  // The diorama builds in slices and reveals itself; render stats show its relief.
  for (let poll = 0; poll < 12; poll++) { const s = stats(); if (s.triangles > 40000 && s.triangles < 150000) return s; }
  throw Error('The Atlas diorama did not appear');
}
function pinch(id, expected, device = 'hand-right') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = targets().find(item => item.name === id);
    assert.ok(target, `Visible hand target exists: ${id}`);
    cli('xr', 'look-at', { device, target: target.position });
    const entity = cli('ecs', 'find', { namePattern: `^${id}$`, limit: 1 }).entities?.[0];
    const hovered = entity ? cli('ecs', 'query', { entityIndex: entity.entityIndex }).components.some(item => item.componentId === 'Hovered')
      : cli('ui', 'inspect', { entityIndex: stateEntity(), selector: `#${id}` }).elements[0]?.state.hovered;
    cli('xr', 'select', { device, duration: .01 });
    let after;
    for (let poll = 0; poll < 4; poll++) { after = state(); if (expected(after)) break; }
    evidence.interactions.push({ input: 'hand ray pinch', id, device, attempt: attempt + 1, hoveredBeforePinch: hovered, selectedControl: after.selectedControl, screen: after.screen, passed: expected(after) });
    if (expected(after)) return after;
  }
  throw Error(`Hand pinch did not reach its state: ${id}`);
}
const pitch = degrees => ({ x: Math.sin(degrees * Math.PI / 360), y: 0, z: 0, w: Math.cos(degrees * Math.PI / 360) });

try {
  assert.equal(cli('xr', 'status').sessionActive, false, 'Start Chronicles captures from the browser preview');
  // Seated, with the short visit already done, so XR entry keeps the current screen.
  if (!startWith({ posture: 'seated' })) settle();
  if (state().screen !== 'home') { leaveToHome(); }
  await capture('home', 'Home', 'Browser preview');
  click('Home_chronicles', s => s.screen === 'chronicles');
  evidence.atlasStats = waitForAtlas();
  check('Home opens Chronicles at the Atlas', state().selectedControl === 'Exhibit_atlas');
  await capture('atlas-seated', 'Atlas - seated', 'Browser preview', 12000);
  for (const id of hotspots) {
    // In the browser preview the page's entry card covers Kwind-09's marker, so its
    // panel button stands in; XR below pinches the markers themselves.
    if (id === 'kwind-09') click(`Hotspot_${id}`, s => s.selectedControl === `Hotspot_${id}`, ATLAS_VIEW);
    else click(`Marker_${id}`, s => s.selectedControl === `Hotspot_${id}`, ATLAS_VIEW);
    await capture(`record-${id}`, `Atlas record - ${id}`, 'Browser preview');
  }
  // Bare ground: the diorama's ground stand-in takes the ray, and selecting it leaves the record as it was.
  const ground = targets().find(item => item.name === 'Atlas_Ground'), { width, height } = canvas();
  const centre = project({ x: ground.position.x, y: ground.position.y + .02, z: ground.position.z }, ATLAS_VIEW, width, height);
  cli('browser', 'interact', { steps: [{ action: 'pointerMove', point: centre }] });
  const groundEntity = cli('ecs', 'find', { namePattern: '^Atlas_Ground$', limit: 1 }).entities[0];
  const groundHovered = cli('ecs', 'query', { entityIndex: groundEntity.entityIndex }).components.some(item => item.componentId === 'Hovered');
  cli('browser', 'interact', { steps: [{ action: 'click', point: centre }] });
  check('Bare ground at the map centre takes the pointer and selects nothing', groundHovered && state().selectedControl === `Hotspot_${hotspots.at(-1)}`, { point: centre, groundHovered });
  click('Marker_korvenia', s => s.selectedControl === 'Hotspot_korvenia', ATLAS_VIEW);
  check('A marker on the table opens the same record as its panel button', state().selectedControl === 'Hotspot_korvenia');
  click('Exhibit_interregnum', s => s.selectedControl === 'Exhibit_interregnum', ATLAS_VIEW);
  click('Stop_year-19', s => s.selectedControl === 'Stop_year-19', ATLAS_VIEW);
  await capture('interregnum', 'Interregnum - Year 19', 'Browser preview');
  click('Exhibit_laws', s => s.selectedControl === 'Exhibit_laws', ATLAS_VIEW);
  click('Article_why-representatives', s => s.selectedControl === 'Article_why-representatives', ATLAS_VIEW);
  await capture('laws', 'Laws of the Gambit - Why representatives', 'Browser preview');
  click('Btn_Back', s => s.selectedControl === 'Exhibit_laws', ATLAS_VIEW);
  check('Back closes the open record first', state().screen === 'chronicles');
  click('Btn_Back', s => s.screen === 'home', ATLAS_VIEW);
  await capture('return-home', 'Return to Home', 'Browser preview');
  const home = evidence.captures[0].renderStats, after = evidence.captures.at(-1).renderStats;
  check('Leaving Chronicles releases the diorama', after.geometries <= home.geometries + 2 && after.textures <= home.textures + 1, { home, atlas: evidence.atlasStats, after });
  if (startWith({ posture: 'standing' })) {
    click('Home_chronicles', s => s.screen === 'chronicles');
    waitForAtlas();
    await capture('atlas-standing', 'Atlas - standing', 'Browser preview', 12000);
    startWith({ posture: 'seated' });
  }

  // Emulated XR: enter from the browser, point with a hand and pinch.
  click('Home_chronicles', s => s.screen === 'chronicles');
  waitForAtlas();
  const entry = cli('browser', 'snapshot', {}).elements.find(element => element.role === 'button' && element.name === 'Enter VR' && element.visible && !element.disabled);
  assert.ok(entry, 'The browser Enter VR button is ready');
  cli('browser', 'interact', { steps: [{ action: 'click', ref: entry.ref }] });
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 90 } });
  if (state().paused) pinch('Btn_Resume', s => !s.paused);
  check('Chronicles survives XR entry and Resume', state().screen === 'chronicles' && state().entered);
  cli('xr', 'set-transform', { device: 'headset', orientation: pitch(0) });
  await capture('xr-atlas-ahead', 'XR - looking ahead at the panel, the table below', 'Emulated XR');
  cli('xr', 'set-transform', { device: 'headset', orientation: pitch(-34) });
  await capture('xr-atlas-seated', 'XR - seated, looking down at the table', 'Emulated XR');
  pinch('Marker_kwind-09', s => s.selectedControl === 'Hotspot_kwind-09');
  await capture('xr-pinch-marker', 'XR - pinch on the Kwind-09 marker', 'Emulated XR');
  pinch('Exhibit_laws', s => s.selectedControl === 'Exhibit_laws');
  await capture('xr-pinch-tab', 'XR - pinch on the Laws tab', 'Emulated XR');
  pinch('Btn_Back', s => s.screen === 'home');
  await capture('xr-return-home', 'XR - Back returns Home', 'Emulated XR');
  evidence.session = cli('xr', 'status').sessionActive;
  evidence.finalState = state();
  evidence.complete = true;
  await save();
  console.log(`DONE: ${evidence.captures.length} Chronicles captures`);
} catch (error) { evidence.error = String(error.stack || error); await save(); throw error; }

function leaveToHome() {
  // A fresh profile may open on onboarding or a dialog; the browser preview can leave both with clicks.
  const s = state();
  if (s.screen === 'onboarding') click('Btn_SkipVisit', after => after.screen === 'home');
  if (state().modal) click('Btn_Cancel', after => !after.modal);
  if (state().screen !== 'home') click('Nav_Home', after => after.screen === 'home');
}
