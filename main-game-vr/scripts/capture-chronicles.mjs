import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { reliefHeightAt, imageToRelief } from '../../shared/chronicles/archive/relief.ts';
import { textureMemory, QUEST_PRESETS } from '../../shared/chronicles/archive/materials.ts';
import { ARCHIVE_PREVIEW_FRAMING } from '../src/chronicles/archive-controller.ts';
import { chroniclesPanelPose, controlSurfaceCheck, panelDegrees } from '../src/chronicles/control-surface.ts';

// Chronicles Quest evidence from the one running IWSDK runtime of this checkout.
// Run from main-game-vr after `npx @iwsdk/cli dev up --headless --allow-browser-automation`:
//   npx tsx scripts/capture-chronicles.mjs [milestone]
// The browser preview is driven by real canvas clicks; the emulated XR session
// (IWER) by hand rays and pinches with both controllers disconnected. Every
// interaction is checked against state (CrownfallQuestState and the archive's
// ChroniclesArchiveState), never against a screenshot alone. Emulation only:
// nothing here is evidence of physical headset comfort, tracking or GPU time.
const milestone = process.argv[2] || process.env.CROWNFALL_MILESTONE || 'm1';
const workspace = process.env.CROWNFALL_IWSDK_WORKSPACE || process.cwd();
const directory = process.env.CROWNFALL_OUT ? resolve(process.env.CROWNFALL_OUT) : resolve('artifacts/chronicles', milestone);
// Phases to run, for iterating on one of them; the evidence of record runs them all.
const phases = new Set((process.env.CROWNFALL_PHASES || 'preview,probe,presets,xr').split(','));
await mkdir(directory, { recursive: true });
const evidence = {
  milestone, complete: false, startedAt: new Date().toISOString(),
  profile: {
    runtime: 'IWSDK 1.1.0-rc.2 managed browser with IWER Meta Quest 3 emulation',
    physicalHeadset: false,
    rendering: 'SwiftShader software rendering on a shared 4-CPU host without a GPU; frame times are not headset evidence',
    xrFramebufferScale: 'VITE_CROWNFALL_EMULATOR_SCALE=0.25 (development-only accommodation for software emulation; production keeps the native scale); draw calls and triangles do not depend on it',
    browserInputs: 'canvas clicks; the page\'s browser entry card is hidden during browser-preview steps because it overlays the monument, and shown again for XR entry',
    xrInputs: 'hand ray and pinch, both controllers disconnected',
    room: 'interim monument room: the Living Atlas diorama alone, behind the ArchiveRoom contract, until main-game-vr/src/chronicles/scene/archive-room.ts lands',
    hostLoadAtStart: loadavg().map((value) => +value.toFixed(2)), hostCpus: cpus().length,
  },
  captures: [], interactions: [], checks: [], measurements: {},
};
const hotspots = ['korvenia', 'solforiz', 'aethelgard', 'kwind-09'];
// The browser preview camera sits at the anchor, pitched toward the panel; while
// the archive is presented it turns, tilts and widens by ARCHIVE_PREVIEW_FRAMING.
const BASE_PITCH = Math.atan2(-0.12, 1.5);
const MENU_VIEW = { fov: 42, pitch: BASE_PITCH, turn: 0 };
const ARCHIVE_VIEW = { fov: ARCHIVE_PREVIEW_FRAMING.fov, pitch: BASE_PITCH + ARCHIVE_PREVIEW_FRAMING.tilt, turn: ARCHIVE_PREVIEW_FRAMING.turn };

function cli(domain, action, input, extra = [], env) {
  const args = ['--no-install', '@iwsdk/cli', domain, action, ...(input === undefined ? [] : ['--input-json', JSON.stringify(input)]), ...extra];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync('npx', args, { cwd: workspace, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });
    let response; try { response = JSON.parse(result.stdout || result.stderr); } catch { throw Error(`${domain} ${action}: ${(result.stderr || result.stdout || '').slice(0, 600)}`); }
    if (response.ok) return response.data.result ?? response.data;
    // A managed browser relaunch or a reload between calls: retry once it is back.
    if (/browser_relaunched|not_executed|bridge|reconnect/u.test(JSON.stringify(response.error)) && attempt < 2) continue;
    throw Object.assign(Error(`${domain} ${action}: ${JSON.stringify(response.error).slice(0, 800)}`), { sdkError: response.error });
  }
}
let entityIndex;
const stateEntity = () => entityIndex ??= cli('ecs', 'find', { withComponents: ['CrownfallQuestState'] }).entities[0].entityIndex;
const components = () => Object.fromEntries(cli('ecs', 'query', { entityIndex: stateEntity() }).components.map((item) => [item.componentId, item.values]));
const state = () => components().CrownfallQuestState;
const archive = () => components().ChroniclesArchiveState;
const both = () => { const c = components(); return { quest: c.CrownfallQuestState, archive: c.ChroniclesArchiveState, panel: c.Transform }; };
const settle = () => { for (let attempt = 0; attempt < 30; attempt++) { try { entityIndex = undefined; const s = state(); if (s.selectedControl) return s; } catch { /* reloading */ } } throw Error('The runtime did not come back'); };
const targets = () => cli('xr', 'list-targets').targets;
const stats = () => { const s = cli('scene', 'render-stats', {}); return { calls: s.calls, triangles: s.triangles, points: s.points, lines: s.lines, geometries: s.geometries, textures: s.textures, programs: s.programs }; };
// A failed check is recorded; it stops the run only when later steps depend on it.
const check = (name, passed, detail = {}, fatal = true) => { evidence.checks.push({ name, passed, ...detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); if (fatal) assert.ok(passed, name); };
const poll = (read, until, tries = 12) => { let value; for (let i = 0; i < tries; i++) { value = read(); if (until(value)) return value; } return value; };
const xrActive = () => cli('xr', 'status').sessionActive;

function project(point, view, width, height) {
  // Into the camera frame: undo its turn about +Y, then its pitch about +X.
  const dx = point.x, dy = point.y - 1.6, dz = point.z;
  const cy = Math.cos(-view.turn), sy = Math.sin(-view.turn);
  const x1 = cy * dx + sy * dz, z1 = -sy * dx + cy * dz;
  const cp = Math.cos(-view.pitch), sp = Math.sin(-view.pitch);
  const y2 = cp * dy - sp * z1, z2 = sp * dy + cp * z1;
  const t = Math.tan(view.fov * Math.PI / 360);
  return { x: Math.round(((x1 / -z2) / (t * width / height) + 1) / 2 * width), y: Math.round((1 - (y2 / -z2) / t) / 2 * height) };
}
function canvas() {
  // After a full-size capture the app may still be resizing back to the managed window.
  for (let attempt = 0; attempt < 10; attempt++) {
    const bounds = cli('browser', 'snapshot', {}).elements.find((element) => element.role === 'canvas').bounds;
    if (bounds.width <= 800) return bounds;
  }
  throw Error('The runtime canvas did not return to the managed window size');
}
function click(id, expected, view = MENU_VIEW, lift = 0) {
  const target = targets().find((item) => item.name === id);
  assert.ok(target, `Visible target exists: ${id}`);
  const { width, height } = canvas();
  const point = project({ ...target.position, y: target.position.y + lift }, view, width, height);
  cli('browser', 'interact', { steps: [{ action: 'click', point }] });
  const after = poll(both, (value) => expected(value.quest, value.archive), 8);
  evidence.interactions.push({ input: 'canvas click', id, point, screen: after.quest.screen, selectedControl: after.quest.selectedControl, archive: pick(after.archive), passed: expected(after.quest, after.archive) });
  assert.ok(expected(after.quest, after.archive), `Click on ${id} reached its state`);
  return after;
}
const pick = (a) => a && ({ loadingFrames: a.loadingFrames, buildSeconds: +(a.buildSeconds ?? 0).toFixed(2), open: a.open, presented: a.presented, visible: a.visible, ready: a.ready, load: a.load, collection: a.collection, focus: a.focus, entry: a.entry, emphasis: a.emphasis, selection: a.selection, panelPose: a.panelPose, panelScale: +a.panelScale.toFixed(4), loading: a.loading, placements: a.placements, roomYaw: +a.roomYaw.toFixed(4), fade: +a.fade.toFixed(3), triangles: a.triangles, textureBytes: a.textureBytes });

// Full-size frames, saved preferences, the emulated visibility and the probe go through the managed browser's Playwright runner.
function step(env, timeout = 100000) {
  return cli('browser', 'run', undefined, ['scripts/chronicles-runtime-step.mjs', '--timeout', String(timeout)], env);
}
async function capture(slug, title, group, settleMs = 6000) {
  const filename = `${String(evidence.captures.length + 1).padStart(2, '0')}-${slug}.png`, path = resolve(directory, filename);
  const xr = xrActive();
  const before = both();
  // XR frames render slowly in software emulation, longer than the managed screenshot command allows,
  // so they are taken through the Playwright runner at the managed window's size.
  if (xr) lowerHands();
  const metadata = step(xr ? { CROWNFALL_STEP: 'shot', CROWNFALL_FRAME: path } : { CROWNFALL_STEP: 'frame', CROWNFALL_FRAME: path, CROWNFALL_SETTLE: String(settleMs) });
  const after = both();
  evidence.captures.push({
    filename, title, group, xrSessionActive: xr,
    state: { screen: after.quest.screen, selectedControl: after.quest.selectedControl, posture: after.quest.posture, quality: after.quest.quality, entered: after.quest.entered, paused: after.quest.paused },
    archiveBefore: pick(before.archive), archive: pick(after.archive),
    renderStats: stats(), metadata: { width: metadata.width ?? 1280, height: metadata.height ?? 720 },
  });
  await save();
  console.log(`CAPTURE ${evidence.captures.length}: ${title}`);
  return evidence.captures.at(-1);
}
let cardHidden = false;
function startWith(preferences) {
  step({ CROWNFALL_STEP: 'preferences', CROWNFALL_PREFERENCES: JSON.stringify(preferences) });
  const settled = settle();
  if (cardHidden) hideEntryCard();
  return settled;
}
// Browser preview only: the page's entry card would cover the monument; XR entry needs it back.
function hideEntryCard() { cardHidden = true; step({ CROWNFALL_STEP: 'entry-card', CROWNFALL_CARD: 'hidden' }); }
function showEntryCard() { cardHidden = false; step({ CROWNFALL_STEP: 'entry-card', CROWNFALL_CARD: 'shown' }); }
async function save() { await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n'); }
function waitForArchive(tries = 40) {
  const value = poll(archive, (a) => a.ready && a.presented && a.visible && a.fade === 0, tries);
  assert.ok(value.ready && value.presented, 'The archive room became ready and presented');
  return value;
}
function leaveToHome() {
  const s = state();
  if (s.screen === 'onboarding') click('Btn_SkipVisit', (q) => q.screen === 'home');
  if (state().modal) click('Btn_Cancel', (q) => !q.modal);
  for (let guard = 0; guard < 4 && state().screen === 'chronicles'; guard++) click('Btn_Back', () => true, archive().presented ? ARCHIVE_VIEW : MENU_VIEW);
  if (state().screen !== 'home') click('Nav_Home', (q) => q.screen === 'home');
}

// World pose of an entity from its Transform chain (position, quaternion, scale).
function worldTransform(index) {
  const chain = [];
  for (let current = index; current !== undefined;) {
    const transform = cli('ecs', 'query', { entityIndex: current }).components.find((item) => item.componentId === 'Transform').values;
    chain.unshift(transform);
    current = transform.parent?.entityIndex;
  }
  let p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1];
  for (const t of chain) {
    const rotated = rotate(q, [t.position[0] * s[0], t.position[1] * s[1], t.position[2] * s[2]]);
    p = [p[0] + rotated[0], p[1] + rotated[1], p[2] + rotated[2]];
    q = multiply(q, t.orientation);
    s = [s[0] * t.scale[0], s[1] * t.scale[1], s[2] * t.scale[2]];
  }
  return { position: p, orientation: q, scale: s };
}
function multiply(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotate(q, v) {
  const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const entityNamed = (name) => cli('ecs', 'find', { namePattern: `^${name}$`, limit: 1 }).entities?.[0];
const hovered = (index) => cli('ecs', 'query', { entityIndex: index }).components.some((item) => item.componentId === 'Hovered');
// A point on the relief's painted surface, in world space, from the diorama's own transform.
function reliefPoint(x, y) {
  const root = entityNamed('Atlas_Diorama');
  assert.ok(root, 'The Atlas diorama entity exists');
  const pose = worldTransform(root.entityIndex), width = 0.95;
  const [rx, rz] = imageToRelief(x, y, width), ry = reliefHeightAt(x, y) * width;
  const local = rotate(pose.orientation, [rx * pose.scale[0], ry * pose.scale[1], rz * pose.scale[2]]);
  return { x: pose.position[0] + local[0], y: pose.position[1] + local[1], z: pose.position[2] + local[2] };
}

// IWER Euler degrees: positive yaw turns left and positive pitch looks up.
const euler = (yaw, pitch = 0) => ({ yaw, pitch, roll: 0 });
const look = (yaw, pitch) => cli('xr', 'set-transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: euler(yaw, pitch) });
// A hand rests at a fixed pose and aims its target ray with look-at, so every pinch starts the same way.
const restingHand = (device) => ({ x: device === 'hand-right' ? 0.25 : -0.25, y: 1.3, z: -0.35 });
const lowerHands = () => { for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: { x: device === 'hand-right' ? 0.3 : -0.3, y: 0.75, z: -0.15 } }); };
// A click needs press and release inside the pointer system's 800 ms window, and software XR frames are slow:
// while pinching, the headset looks up at the empty vault so frames stay light. The ray, not the gaze, selects.
const PINCH_HOLDS = [0.01, 0.15, 0.3, 0.15];
const PINCH_GAZE = 80;
function pinch(id, expected, device = 'hand-right', gazeYaw = 0) {
  for (let attempt = 0; attempt < PINCH_HOLDS.length; attempt++) {
    look(gazeYaw, PINCH_GAZE);
    cli('xr', 'set-transform', { device, anchor: 'target-ray', position: restingHand(device) });
    const target = targets().find((item) => item.name === id);
    assert.ok(target, `Visible hand target exists: ${id}`);
    cli('xr', 'look-at', { device, target: target.position });
    const entity = entityNamed(id);
    const hover = entity ? poll(() => hovered(entity.entityIndex), Boolean, 4)
      : poll(() => cli('ui', 'inspect', { entityIndex: stateEntity(), selector: `#${id}` }).elements?.[0]?.state?.hovered, Boolean, 4);
    if (!hover) { evidence.interactions.push({ input: 'hand ray aim', id, device, attempt: attempt + 1, hovered: false }); continue; }
    cli('xr', 'select', { device, duration: PINCH_HOLDS[attempt] });
    const after = poll(both, (value) => expected(value.quest, value.archive), 8);
    evidence.interactions.push({ input: 'hand ray pinch', id, device, attempt: attempt + 1, holdSeconds: PINCH_HOLDS[attempt], hoveredBeforePinch: true, xrSessionActive: xrActive(), screen: after.quest.screen, selectedControl: after.quest.selectedControl, paused: after.quest.paused, handsTracked: after.quest.handsTracked, archive: pick(after.archive), passed: expected(after.quest, after.archive) });
    if (expected(after.quest, after.archive)) return after;
  }
  throw Error(`Hand pinch did not reach its state: ${id}`);
}
const headset = () => cli('xr', 'get-transform', { device: 'headset' });

try {
  // Start from the browser preview: end a session an earlier run left behind.
  if (xrActive()) { try { cli('xr', 'exit', {}); } catch { /* An ended-session acknowledgement is fine. */ } poll(xrActive, (active) => !active, 10); }
  assert.equal(xrActive(), false, 'Start Chronicles captures from the browser preview');
  // ---------------------------------------------------------------- browser preview, seated
  startWith({ posture: 'seated', quality: 'medium' });
  hideEntryCard();
  leaveToHome();
  if (phases.has('preview')) {
  const home = await capture('home', 'Home (browser preview)', 'Browser preview');
  // The loading bar lasts only while the room builds, so the click and the frame share one lease.
  const tile = targets().find((item) => item.name === 'Home_chronicles'), managed = canvas();
  const tilePoint = project(tile.position, MENU_VIEW, managed.width, managed.height);
  const loadingFile = `${String(evidence.captures.length + 1).padStart(2, '0')}-loading.png`;
  const loadingFrame = step({ CROWNFALL_STEP: 'click-frame', CROWNFALL_FRAME: resolve(directory, loadingFile), CROWNFALL_CLICK_X: String(tilePoint.x), CROWNFALL_CLICK_Y: String(tilePoint.y), CROWNFALL_AFTER_CLICK: '1500', CROWNFALL_THROTTLE: '6' });
  const opened = poll(both, (value) => value.quest.screen === 'chronicles', 6);
  evidence.interactions.push({ input: 'canvas click (full size, with the frame in the same lease)', id: 'Home_chronicles', point: tilePoint, screen: opened.quest.screen, selectedControl: opened.quest.selectedControl, archive: pick(opened.archive), passed: opened.quest.screen === 'chronicles' });
  evidence.captures.push({ filename: loadingFile, title: 'Chronicles a moment after the Home tile: the wordless loading bar under the tabs while the room builds', group: 'Browser preview', xrSessionActive: false,
    capturedAfterClickMs: loadingFrame.capturedAfterMs, cpuThrottleDuringFrame: loadingFrame.cpuThrottle, state: { screen: opened.quest.screen, selectedControl: opened.quest.selectedControl }, archive: pick(opened.archive), renderStats: stats(), metadata: { width: loadingFrame.width, height: loadingFrame.height, note: 'managed window size, with the page CPU held at a 6x CDP throttle for this one frame so it lands while the room still builds; every other measurement is unthrottled' } });
  console.log(`CAPTURE ${evidence.captures.length}: loading`);
  const ready = waitForArchive();
  check('Home opens Chronicles at the Atlas, and the wordless loading bar shows until the room is ready', opened.quest.selectedControl.startsWith('Exhibit_atlas') && ready.loadingFrames > 0 && !ready.loading,
    { loadingFrames: ready.loadingFrames, buildSeconds: +ready.buildSeconds.toFixed(2), capturedAfterClickMs: loadingFrame.capturedAfterMs });
  check('The room becomes ready and the panel takes the control surface, with the load reported to the shared state', ready.load === 'ready' && ready.panelPose === 'control-surface' && !ready.loading && ready.placements >= 1, { archive: pick(ready) });
  evidence.measurements.atlasSeated = stats();
  await capture('archive-seated', 'Archive, seated (browser preview framing)', 'Browser preview');
  evidence.measurements.previewBreakdown = step({ CROWNFALL_STEP: 'breakdown' });
  for (const id of hotspots) {
    // A marker outside the browser window's view is reached through its panel button; XR pinches the markers themselves.
    const marker = targets().find((item) => item.name === `Marker_${id}`), bounds = canvas();
    const at = project(marker.position, ARCHIVE_VIEW, bounds.width, bounds.height);
    const visible = at.x > 12 && at.x < bounds.width - 12 && at.y > 12 && at.y < bounds.height - 12;
    click(visible ? `Marker_${id}` : `Hotspot_${id}`, (q, a) => q.selectedControl === `Hotspot_${id}` && a.entry === id && a.focus === id, ARCHIVE_VIEW);
    await capture(`record-${id}`, `Atlas record from its ${visible ? 'marker' : 'panel button (marker outside the browser view)'}: ${id}`, 'Browser preview', 4000);
  }
  // Bare ground at the map centre: the ground stand-in takes the pointer, and a click selects nothing.
  const groundEntity = entityNamed('Atlas_Ground');
  const centre = reliefPoint(0.5, 0.5);
  const { width, height } = canvas();
  const point = project(centre, ARCHIVE_VIEW, width, height);
  cli('browser', 'interact', { steps: [{ action: 'pointerMove', point }] });
  const immediate = hovered(groundEntity.entityIndex);
  const groundHover = poll(() => hovered(groundEntity.entityIndex), Boolean, 8);
  const beforeGround = both();
  cli('browser', 'interact', { steps: [{ action: 'click', point }] });
  const afterGround = poll(both, () => false, 3);
  check('Bare ground at the map centre takes the pointer and selects nothing', groundHover && afterGround.quest.selectedControl === beforeGround.quest.selectedControl && afterGround.archive.entry === beforeGround.archive.entry,
    { point, centre, hoveredOnFirstQuery: immediate, hoveredAfterPolling: groundHover, entryBefore: beforeGround.archive.entry, entryAfter: afterGround.archive.entry });
  click('Exhibit_interregnum', (q, a) => q.selectedControl === 'Exhibit_interregnum' && a.collection === 'interregnum' && a.emphasis === 'interregnum' && a.entry === '', ARCHIVE_VIEW);
  click('Stop_year-19', (q, a) => q.selectedControl === 'Stop_year-19' && a.entry === 'year-19', ARCHIVE_VIEW);
  await capture('interregnum', 'Interregnum: Year 19 (browser preview)', 'Browser preview', 4000);
  click('Exhibit_laws', (q, a) => q.selectedControl === 'Exhibit_laws' && a.collection === 'laws', ARCHIVE_VIEW);
  click('Article_why-representatives', (q, a) => a.entry === 'why-representatives', ARCHIVE_VIEW);
  await capture('laws', 'Laws of the Gambit: Why representatives (browser preview)', 'Browser preview', 4000);
  click('Btn_Back', (q, a) => q.selectedControl === 'Exhibit_laws' && a.entry === '', ARCHIVE_VIEW);
  check('Back closes the open record first', state().screen === 'chronicles');
  click('Btn_Back', (q) => q.screen === 'home', ARCHIVE_VIEW);
  const closed = poll(archive, (a) => !a.open && a.panelPose === 'menu', 10);
  check('Back returns Home, and the room closes and gives the panel back its menu pose', !closed.open && closed.panelPose === 'menu', { archive: pick(closed) });
  const homeAgain = await capture('return-home', 'Return to Home (browser preview)', 'Browser preview');
  check('Leaving Chronicles releases the room: geometry and textures return to the Home baseline', homeAgain.renderStats.geometries <= home.renderStats.geometries + 2 && homeAgain.renderStats.textures <= home.renderStats.textures + 1,
    { home: home.renderStats, archive: evidence.measurements.atlasSeated, after: homeAgain.renderStats });
  }

  // ---------------------------------------------------------------- allocation probe, idle archive
  if (phases.has('probe')) {
  click('Home_chronicles', (q) => q.screen === 'chronicles');
  waitForArchive();
  // Windows of at most 90 s each (the managed browser's script lease) until 600 idle frames are sampled.
  const windows = [];
  for (let total = 0; total < 600 && windows.length < 5;) {
    const window = step({ CROWNFALL_STEP: 'probe', CROWNFALL_FRAMES: String(600 - total) }, 100000);
    windows.push(window);
    total += window.frames.frames;
  }
  const sum = (pick) => windows.reduce((total, item) => total + pick(item), 0);
  const files = {};
  for (const window of windows) for (const [file, value] of Object.entries(window.byChroniclesFile)) {
    files[file] = files[file] || { samples: 0, bytes: 0, underUpdate: 0 };
    files[file].samples += value.samples; files[file].bytes += value.bytes; files[file].underUpdate += value.underUpdate;
  }
  const probe = {
    windows: windows.length, frames: sum((item) => item.frames.frames), wallMs: sum((item) => item.wallMs),
    samples: sum((item) => item.samples), estimatedAllocatedBytes: sum((item) => item.estimatedAllocatedBytes), byChroniclesFile: files,
    longTasks: windows.flatMap((item) => item.longTasks || []), detail: windows,
  };
  const controllerFiles = ['archive-controller.ts', 'monument-room.ts', 'archive-runtime.ts', 'control-surface.ts'];
  const controllerSamples = controllerFiles.reduce((total, file) => total + (files[file]?.underUpdate || 0), 0);
  const roomSamples = Object.entries(files).filter(([file]) => !controllerFiles.includes(file)).reduce((total, [, value]) => total + value.underUpdate, 0);
  probe.controllerUpdateSamples = controllerSamples; probe.roomUpdateSamples = roomSamples;
  evidence.measurements.allocationProbe = probe;
  check('Over 600 idle frames no allocation is attributed to the controller update (archive-controller, the interim room wrapper)', probe.frames >= 600 && controllerSamples === 0, { frames: probe.frames, windows: probe.windows, byChroniclesFile: files }, false);
  check('Over 600 idle frames no allocation is attributed to the room renderer update (the interim room draws through scene/atlas-diorama.ts)', probe.frames >= 600 && roomSamples === 0, { frames: probe.frames, roomSamples, estimatedAllocatedBytes: probe.estimatedAllocatedBytes }, false);
  check('No long task over 50 ms while the archive is idle', probe.longTasks.every((duration) => duration <= 50), { longTasks: probe.longTasks.slice(0, 40), observed: probe.longTasks.length }, false);
  await save();
  }

  // ---------------------------------------------------------------- presets and posture
  if (phases.has('presets')) {
  evidence.measurements.presets = {};
  for (const quality of QUEST_PRESETS) {
    startWith({ posture: 'seated', quality });
    click('Home_chronicles', (q) => q.screen === 'chronicles');
    waitForArchive();
    const s = stats(), estimate = textureMemory('quest', quality);
    evidence.measurements.presets[quality] = { renderStats: s, textureEstimateMB: +(estimate.bytes / 2 ** 20).toFixed(2), estimateFiles: estimate.files.length, roomTextureBytes: archive().textureBytes, roomTriangles: archive().triangles };
    check(`Quest ${quality}: at most 120 draw calls, 250k triangles and a 64 MB texture estimate`, s.calls <= 120 && s.triangles <= 250000 && estimate.bytes <= 64 * 2 ** 20, evidence.measurements.presets[quality], false);
    if (quality !== 'medium') await capture(`archive-${quality}`, `Archive, seated, ${quality} preset (browser preview)`, 'Browser preview');
  }
  startWith({ posture: 'standing', quality: 'medium' });
  click('Home_chronicles', (q) => q.screen === 'chronicles');
  waitForArchive();
  await capture('archive-standing', 'Archive, standing (browser preview framing)', 'Browser preview');
  }
  startWith({ posture: 'seated', quality: 'medium' });
  leaveToHome();
  showEntryCard();
  if (phases.has('xr')) {

  // ---------------------------------------------------------------- emulated XR, hands only
  // Entering while the sorcerer is still decoding can crash the managed software browser: wait for it.
  poll(state, (q) => q.modelReady, 30);
  spawnSync('sleep', ['10']);
  const entry = cli('browser', 'snapshot', {}).elements.find((element) => element.role === 'button' && element.name === 'Enter VR' && element.visible && !element.disabled);
  assert.ok(entry, 'The browser Enter VR button is ready');
  cli('browser', 'interact', { steps: [{ action: 'click', ref: entry.ref }] });
  poll(xrActive, Boolean, 20);
  cli('xr', 'set-input-mode', { mode: 'hand' });
  for (const device of ['controller-left', 'controller-right']) cli('xr', 'set-connected', { device, connected: false });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  cli('xr', 'set-device-state', { state: { stereoEnabled: false, fov: 90 } });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-transform', { device, anchor: 'target-ray', position: restingHand(device) });
  poll(state, (q) => q.entered && q.leftTracked && q.rightTracked, 20);
  const device = cli('xr', 'get-device-state', {});
  evidence.measurements.xrDevice = { inputMode: device.inputMode, controllers: { left: device.controllers.left.connected, right: device.controllers.right.connected }, hands: { left: device.hands.left.connected, right: device.hands.right.connected }, stereo: device.stereoEnabled, fov: device.fov };
  if (state().paused) pinch('Btn_Resume', (q) => !q.paused);
  check('XR is active with hands tracked and controllers disconnected', xrActive() && state().entered && state().handsTracked && device.inputMode === 'hand' && !device.controllers.left.connected && !device.controllers.right.connected, { xr: cli('xr', 'status').sessionActive, device: evidence.measurements.xrDevice });
  look(0, -8);
  await capture('xr-home', 'XR: Home, hands only', 'Emulated XR');
  evidence.measurements.xrHomeBreakdown = step({ CROWNFALL_STEP: 'breakdown' });
  pinch('Home_chronicles', (q) => q.screen === 'chronicles');
  const xrReady = waitForArchive();
  check('A hand pinch on the Home tile opens the archive in XR', xrReady.presented && state().entered, { archive: pick(xrReady) });
  evidence.measurements.xrBreakdown = {};
  for (const [slug, title, yaw, pitch] of [['xr-forward', 'XR look-around: forward, the monument below', 0, -28], ['xr-up', 'XR look-around: up toward where the rings hang', 0, 40], ['xr-left', 'XR look-around: left', 60, -10], ['xr-right', 'XR look-around: right, the control surface', -40, -6]]) {
    look(yaw, pitch);
    await capture(slug, title, 'Emulated XR');
    // What each view draws, by subtree, to explain its render stats.
    if (slug === 'xr-forward' || slug === 'xr-up') evidence.measurements.xrBreakdown[slug] = step({ CROWNFALL_STEP: 'breakdown' });
  }
  look(0, -30);
  const markerPinch = pinch('Marker_kwind-09', (q, a) => q.selectedControl === 'Hotspot_kwind-09' && a.entry === 'kwind-09');
  check('XR: a pinch on the Kwind-09 marker opens its record, and the room lights that marker', markerPinch.archive.entry === 'kwind-09' && markerPinch.archive.selection === 'kwind-09' && markerPinch.quest.selectedControl === 'Hotspot_kwind-09', { archive: pick(markerPinch.archive) });
  look(-28, -12);
  await capture('xr-record', 'XR: pinch on the Kwind-09 marker opens its record', 'Emulated XR');
  // Bare ground under the hand ray takes it and selects nothing.
  look(0, -30);
  const xrCentre = reliefPoint(0.5, 0.5), xrGround = entityNamed('Atlas_Ground');
  cli('xr', 'look-at', { device: 'hand-right', target: xrCentre });
  const xrGroundHover = poll(() => hovered(xrGround.entityIndex), Boolean, 6);
  const xrBefore = both();
  cli('xr', 'select', { device: 'hand-right', duration: 0.05 });
  const xrAfter = poll(both, () => false, 3);
  check('XR: bare ground takes the hand ray and selects nothing', xrGroundHover && xrAfter.archive.entry === xrBefore.archive.entry && xrAfter.quest.selectedControl === xrBefore.quest.selectedControl, { target: xrCentre, hovered: xrGroundHover, entry: xrAfter.archive.entry });
  const tabPinch = pinch('Exhibit_laws', (q, a) => q.selectedControl === 'Exhibit_laws' && a.collection === 'laws' && a.emphasis === 'laws');
  check('XR: a pinch on the Laws tab switches the collection and the room emphasises it', tabPinch.archive.collection === 'laws' && tabPinch.archive.emphasis === 'laws' && tabPinch.archive.entry === '', { archive: pick(tabPinch.archive) });
  look(-30, -8);
  await capture('xr-collection', 'XR: pinch on the Laws tab emphasises its collection', 'Emulated XR');
  pinch('Btn_Back', (q) => q.screen === 'home');
  const xrClosed = poll(archive, (a) => !a.open, 10);
  check('XR: Back by hand returns Home and closes the room', state().screen === 'home' && !xrClosed.open && xrClosed.panelPose === 'menu', { archive: pick(xrClosed) });
  look(0, -8);
  await capture('xr-home-again', 'XR: Back returns Home', 'Emulated XR');

  // Pause through the headset's own visibility blur, then Resume by hand.
  pinch('Home_chronicles', (q) => q.screen === 'chronicles');
  waitForArchive();
  look(0, -30);
  pinch('Marker_aethelgard', (q, a) => a.entry === 'aethelgard');
  const blurred = step({ CROWNFALL_STEP: 'visibility', CROWNFALL_VISIBILITY: 'visible-blurred' });
  const paused = poll(both, (value) => value.quest.paused, 8);
  check('A visibility blur pauses Chronicles and holds the room', paused.quest.paused && paused.quest.screen === 'pause' && paused.archive.open && !paused.archive.visible, { blurred, archive: pick(paused.archive) });
  step({ CROWNFALL_STEP: 'visibility', CROWNFALL_VISIBILITY: 'visible' });
  look(-40, -6);
  await capture('xr-paused', 'XR: paused by a visibility blur, the room held out of sight', 'Emulated XR');
  const resumed = pinch('Btn_Resume', (q, a) => !q.paused && q.screen === 'chronicles' && a.entry === 'aethelgard' && a.visible);
  check('Resume returns to the same record with the room shown again', resumed.archive.entry === 'aethelgard' && resumed.archive.visible, { archive: pick(resumed.archive) });

  // Recentre after a 40 degree head turn: the rig never moves, so the camera's world pose stays the headset pose.
  const rig = 2, camera = 3;
  const poseCheck = (label) => {
    const h = headset(), rigPose = worldTransform(rig), cam = worldTransform(camera);
    const dp = Math.hypot(cam.position[0] - h.position.x, cam.position[1] - h.position.y, cam.position[2] - h.position.z);
    const q = h.orientation, dq = 1 - Math.abs(cam.orientation[0] * q.x + cam.orientation[1] * q.y + cam.orientation[2] * q.z + cam.orientation[3] * q.w);
    return { label, headset: h, rig: rigPose, camera: cam, positionError: dp, orientationError: dq };
  };
  look(-40, -4);
  const before = poseCheck('after the 40 degree turn, before Recenter');
  const placementsBefore = archive().placements;
  // The head stays turned 40 degrees right while the hand pinches Recenter, then takes the same pose again.
  pinch('Btn_Recenter', (q, a) => a.placements > placementsBefore && a.fade === 0, 'hand-right', -40);
  look(-40, -4);
  const recentred = archive(), after = poseCheck('after Recenter, the head in the same pose');
  evidence.measurements.recenter = { before, after, archive: pick(recentred) };
  check('Recenter re-places the room toward the head yaw under the fade, and never moves the XR origin', Math.abs(recentred.roomYaw + 40 * Math.PI / 180) < 0.05
    && before.positionError < 0.005 && after.positionError < 0.005 && before.orientationError < 1e-4 && after.orientationError < 1e-4
    && JSON.stringify(before.rig) === JSON.stringify(after.rig), { roomYaw: recentred.roomYaw, before: { p: before.positionError, q: before.orientationError }, after: { p: after.positionError, q: after.orientationError } });
  look(-40, -28);
  await capture('xr-recentred', 'XR: after Recenter with the head turned 40 degrees right, the monument stands ahead again', 'Emulated XR');

  // Hand tracking lost and recovered: the visit pauses, Resume needs a hand, then pinching works again.
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: false });
  const lost = poll(state, (q) => q.paused && !q.handsTracked, 10);
  check('Losing both hands pauses the visit and keeps its place', lost.paused && lost.screen === 'pause', { pauseReason: lost.pauseReason });
  for (const device of ['hand-left', 'hand-right']) cli('xr', 'set-connected', { device, connected: true });
  poll(state, (q) => q.handsTracked, 10);
  pinch('Btn_Resume', (q) => !q.paused && q.screen === 'chronicles');
  const recovered = pinch('Marker_solforiz', (q, a) => q.selectedControl === 'Hotspot_solforiz' && a.entry === 'solforiz');
  check('After hand tracking returns, Resume and a marker pinch work again', recovered.archive.entry === 'solforiz' && !recovered.quest.paused && recovered.quest.handsTracked, { archive: pick(recovered.archive) });
  // The room now faces the recentred direction, so the record view turns with it.
  look(-68, -12);
  await capture('xr-after-tracking-loss', 'XR: hands recovered, a marker pinch opens Solforiz (room and panel recentred 40 degrees right)', 'Emulated XR');

  // The render cost of one XR frame looking at the monument with a record open, then Exit VR by hand.
  // The emulator renders both eye views even with its stereo display off, so renderer.info is a two-eye total.
  look(-40, -28);
  const frame = poll(stats, (s) => s.calls > 0, 3), frameBreakdown = step({ CROWNFALL_STEP: 'breakdown' });
  evidence.measurements.xrFrame = { view: 'recentred forward view of the monument, a record open on the control surface', renderStats: frame, eyeViews: frameBreakdown.views, breakdown: frameBreakdown };
  check('XR frame within the Quest budget: at most 120 draw calls and 250k triangles for both eye views together', frame.calls <= 120 && frame.triangles <= 250000, { renderStats: frame, eyeViews: frameBreakdown.views }, false);
  // Exit VR ends the session inside the pinch, so the select reports the ended session: the state below is the proof.
  try { pinch('Btn_Exit', () => true); } catch (error) {
    if (!/The XR session ended/u.test(String(error.message))) throw error;
    evidence.interactions.push({ input: 'hand ray pinch', id: 'Btn_Exit', device: 'hand-right', hoveredBeforePinch: true, note: 'the session ended during the select, as Exit VR does' });
  }
  const exited = poll(() => ({ xr: xrActive(), quest: state() }), (value) => !value.xr && !value.quest.entered, 10);
  check('Exit VR ends the session by hand and keeps the visit in the browser', !exited.xr && !exited.quest.entered && exited.quest.screen === 'chronicles', { screen: exited.quest.screen });
  }

  // Control-surface numbers the runtime applied, from the blueprint vantages.
  evidence.measurements.controlSurface = ['seated', 'standing'].map((posture) => {
    const pose = chroniclesPanelPose(posture, 100), clearance = controlSurfaceCheck(posture, 100, 0.0934);
    return { posture, scale: +pose.scale.toFixed(4), widthMetres: +pose.width.toFixed(3), distanceMetres: +pose.distance.toFixed(3), liftMetres: pose.lift, body16Degrees: +panelDegrees(16, pose.scale, pose.distance).toFixed(3), recordBody18Degrees: +panelDegrees(18, pose.scale, pose.distance).toFixed(3), target50Degrees: +panelDegrees(50, pose.scale, pose.distance).toFixed(3), menuTarget50Degrees: +panelDegrees(50, 0.15, 1.5).toFixed(3), clearanceDegrees: { upright: +clearance.upright.toFixed(2), tilted: +clearance.tilted.toFixed(2) }, furthestBearingDegrees: +clearance.bearing.toFixed(1), highestDegrees: +clearance.top.toFixed(1) };
  });
  evidence.profile.hostLoadAtEnd = loadavg().map((value) => +value.toFixed(2));
  evidence.finishedAt = new Date().toISOString();
  evidence.phases = [...phases];
  evidence.failedChecks = evidence.checks.filter((item) => !item.passed).map((item) => item.name);
  evidence.complete = true;
  await save();
  console.log(`DONE: ${evidence.captures.length} Chronicles captures, ${evidence.checks.length} checks`);
} catch (error) { evidence.error = String(error.stack || error); evidence.failedAt = new Date().toISOString(); await save(); throw error; }
