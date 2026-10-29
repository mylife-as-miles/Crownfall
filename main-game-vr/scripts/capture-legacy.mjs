// Mono 60-degree captures of the Quest My Legacy destination in an active, emulated immersive
// session (IWER browser emulation, not a physical headset), reached only through real hand rays,
// pinches and fingertip presses. Sessions:
//   production        founding (all four steps, the motto keyboard and the raising beat), overview,
//                     every landmark, the War Record's three sections, the nomination, the Herald's list,
//                     a notice with its wager, the acceptance, Awaiting the board, the dissolve
//                     confirmation, the touch tray, pause from the tray, and the standing posture.
//   guest             ?legacy=fresh: the labelled browser entry and the guest founding.
//   preview:<id>      ?legacyPreview=<id>: the aftermath, then the holding's responses to it.
//   recovery:<kind>   an unreadable (corrupt) or newer (future) save left untouched, with its choices.
//   comfort:<size>    Text Size 125 or 150 percent, with the stored banner's overview and a notice.
// The app frame is reopened with a session query through the IWSDK browser runner (start the runtime
// with --allow-browser-automation).
//   node scripts/capture-legacy.mjs [--out artifacts/legacy/latest] [--session production|guest|preview:<id>|recovery:corrupt|recovery:future|comfort:125|comfort:150]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { browserLost, createLegacyDriver, sleep } from './legacy-driver.mjs';

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
  const d = createLegacyDriver();
  const evidence = {
    session, startedAt: new Date().toISOString(),
    profile: {
      runtime: 'IWER Meta Quest 3 browser emulation, managed headless Chromium', view: 'mono, 60-degree field of view',
      input: 'hand ray + pinch, and index-fingertip presses on the touch tray; both controllers disconnected',
      developmentFramebufferScale: d.emulatorScale, physicalHeadset: false,
      note: 'Development captures from software-rendered (SwiftShader) emulation, including emulator hand and ray overlays; not a headset recording.',
      menuPinchView: 'Menu pinches (reaching My Legacy) look almost straight down (88 degrees) so the hero and the menu atmosphere leave the view and software frames stay inside the 800 ms click window.',
    },
    captures: [], interactions: d.interactions,
  };
  /** Captures the runtime view with the head pitched down by `pitch` degrees, recording the Legacy state shown. */
  const capture = (name, pitch, note, yaw = 0) => {
    const file = `${directory}/${prefix}${name}.png`;
    const metadata = d.screenshot(file, pitch, yaw);
    const s = d.state();
    evidence.captures.push({ name, file, headPitchDegrees: pitch, headYawDegrees: yaw, note, legacyView: s.legacyView, session: s.legacySession, label: s.legacyLabel, recordTab: s.legacyRecordTab, comfort: { textScale: s.textScale, posture: s.posture, panelDistance: s.panelDistance, panelHeight: s.panelHeight }, metadata });
    console.log(`CAPTURE ${file}`);
  };
  const preferences = (extra = {}) => ({ quality: 'low', motion: false, ...extra });
  const comfort = session.startsWith('comfort:') ? Number(session.slice('comfort:'.length)) : 100;
  const setup = () => {
    evidence.emulationSetup = {
      applied: true,
      ...d.prepareEmulation({
        viewport: option('--viewport', '800x560'),
        preferences: preferences(comfort !== 100 ? { textScale: comfort } : {}),
        reloadIf: (current) => current.quality !== 'low' || current.motion !== false || !current.visitComplete || current.textScale !== comfort,
      }),
      note: 'Software-emulation accommodation only: the capture viewport, Quest Render Quality Low and Ambient Motion Off, and the short visit marked complete so entry opens Home.',
    };
  };
  const openSession = (search) => {
    if (d.cli('xr', 'status').sessionActive) { try { d.cli('xr', 'exit', {}); } catch { /* An ended session acknowledgement is fine. */ } }
    evidence.navigation = d.run(['browser', 'run', 'scripts/capture-legacy.mjs'], { CROWNFALL_LEGACY_SEARCH: search });
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt++) { try { d.discover(); ready = true; } catch { sleep(3); } }
    assert.ok(ready, 'The app reopened with the Legacy session query');
  };
  const enter = () => {
    d.discover();
    if (!d.cli('xr', 'status').sessionActive) d.enterXR();
    d.prepareHands();
    return d.reachLegacy();
  };
  const back = (id, view) => d.pinch(id, (v) => v.legacyView === view);
  const openLandmark = (landmark) => d.pinch(`Legacy_Landmark_${landmark}`, (v) => v.legacyView === landmark);

  const flows = {
    production() {
      let s = enter();
      if (s.legacyView === 'aftermath') s = d.pinch('Legacy_AftermathLater', (v) => v.legacyView === 'overview');
      if (s.legacyFounded) {
        s = openLandmark('banner-hall');
        s = d.pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
        s = d.pinch('Legacy_ResetConfirm', (v) => v.legacyView === 'nation');
      }
      capture('founding-nation', 0, 'Founding step 1: the four nations from shared content');
      s = d.pinch('Legacy_NationNext', (v) => v.legacyView === 'name');
      s = d.pinch('Legacy_OpenKeyboard', (v) => v.legacyView === 'keyboard');
      for (const key of ['A', 'S', 'H']) d.pinch(`Legacy_Key_${key}`, () => true);
      capture('founding-keyboard', 0, 'Optional large-key letter keyboard for a custom banner name');
      s = d.pinch('Legacy_KeyboardCancel', (v) => v.legacyView === 'name');
      s = d.pinch('Legacy_Suggestion_0', (v) => v.legacyDraftName !== '');
      capture('founding-name', 0, 'Quick name suggestions with Other names and Type a name');
      s = d.pinch('Legacy_NameNext', (v) => v.legacyView === 'arms');
      s = d.pinch('Legacy_Preset_1', (v) => v.legacyHeraldry !== '');
      capture('founding-arms', 0, 'Heraldry presets, per-element cycling and the live shared raster preview');
      s = d.pinch('Legacy_ArmsNext', (v) => v.legacyView === 'confirm');
      s = d.pinch('Legacy_ConfirmMotto', (v) => v.legacyView === 'keyboard');
      for (const key of ['W', 'E', 'Space', 'H', 'O', 'L', 'D']) d.pinch(key === 'Space' ? 'Legacy_Key_Space' : `Legacy_Key_${key}`, () => true);
      capture('founding-motto', 0, 'The optional motto on the same large-key keyboard, in sentence case');
      s = d.pinch('Legacy_KeyboardDone', (v) => v.legacyView === 'confirm' && v.legacyMotto !== '');
      capture('founding-confirm', 0, 'Founding step 4: the arms, the motto, the sworn members and what raising the banner saves');
      s = d.pinch('Legacy_ConfirmRaise', (v) => v.legacyView === 'raised' && v.legacyFounded);
      capture('founding-raised', 0, 'The raising beat: the new arms and the founding line, before the Bannerhold');
      s = d.pinch('Legacy_RaisedContinue', (v) => v.legacyView === 'overview');
      capture('overview', 10, 'Overview: crest, landmark list and the holding below; head pitched 10 degrees down');
      s = openLandmark('war-record');
      capture('record-unresolved', 0, 'War Record: with no conflicts yet it opens on the open matters, here the rival\'s challenge');
      s = d.pinch('Legacy_RecordTab_ledger', (v) => v.legacyRecordTab === 'ledger');
      capture('record-ledger', 0, 'War Record ledger: every entry, newest first, shown whole');
      s = d.pinch('Legacy_RecordTab_conflicts', (v) => v.legacyRecordTab === 'conflicts');
      capture('record-conflicts-empty', 0, 'War Record conflicts: honestly empty until a real match is recorded');
      s = back('Legacy_RecordBack', 'overview');
      s = openLandmark('banner-hall');
      capture('landmark-banner-hall', 0, 'Banner Hall: arms, motto, standing, honours, both houses with their arms, and Dissolve banner');
      s = d.pinch('Legacy_ResetOpen', (v) => v.legacyView === 'reset');
      capture('reset-confirm', 0, 'Dissolving asks first; Keep the banner leaves everything as it was');
      s = d.pinch('Legacy_ResetCancel', (v) => v.legacyView === 'banner-hall');
      s = back('Legacy_HallBack', 'overview');
      s = openLandmark('muster-grounds');
      capture('landmark-muster-grounds-empty', 0, 'Muster Grounds before a nomination: no one on the board belongs to the house yet');
      s = d.pinch('Legacy_MusterChoose', (v) => v.legacyView === 'nominate');
      s = d.pinch('Legacy_Member_1', (v) => v.legacyMemberChoice === 'member-2');
      capture('muster-nominate', 0, 'Nominate: a member and an open file; claimed files are named');
      s = d.pinch('Legacy_MusterNominate', (v) => v.legacyView === 'muster-grounds' && v.legacyRepresentative !== '');
      capture('landmark-muster-grounds', 0, 'Muster Grounds: the representative\'s ledger beside the house\'s side of the formation');
      s = back('Legacy_MusterBack', 'overview');
      s = openLandmark('heralds-station');
      capture('herald-list', 0, 'Herald\'s Station: notices newest first, with Muster readiness');
      s = d.pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice');
      capture('notice-wager', 0, 'The formal challenge with its wager as four stated terms, before any match');
      s = d.pinch('Legacy_NoticeAccept', (v) => v.legacyView === 'accept');
      capture('accept-wager', 0, 'The acceptance repeats the same terms');
      s = d.pinch('Legacy_AcceptConfirm', (v) => v.legacyView === 'awaiting' && v.legacyChallenge === 'accepted');
      capture('awaiting-board', 0, 'Awaiting the board: no match is played or recorded in this build');
      capture('touch-tray', 44, 'The touch tray within reach below the holding: Back, the view\'s primary action, Home, Recenter, Pause, Exit VR');
      s = d.pinch('Legacy_DockPause', (v) => v.paused && v.legacyView === 'pause', { pitch: 44 });
      capture('pause', 0, 'Pause from the tray: Resume and Return to Home');
      s = d.pinch('Legacy_Resume', (v) => !v.paused && v.legacyView === 'awaiting');
    },
    guest() {
      openSession('?legacy=fresh');
      const file = `${directory}/${prefix}browser-entry.png`;
      evidence.captures.push({ name: 'browser-entry', file, note: 'Browser entry panel before entering VR, showing the session label', metadata: d.cli('browser', 'screenshot', undefined, ['--output-file', file]) });
      enter();
      capture('founding-nation', 0, 'Guest founding: the session band and the tray say the banner is not saved');
    },
    preview(id) {
      openSession(`?legacyPreview=${id}`);
      const file = `${directory}/${prefix}browser-entry.png`;
      evidence.captures.push({ name: 'browser-entry', file, note: 'Browser entry panel before entering VR, showing the development preview label', metadata: d.cli('browser', 'screenshot', undefined, ['--output-file', file]) });
      let s = enter();
      if (s.legacyView === 'aftermath') {
        capture('aftermath', 0, 'Aftermath: at most two prominent messages, each shown whole; every fact is in the War Record');
        s = d.pinch('Legacy_AftermathLater', (v) => v.legacyView === 'overview');
      }
      capture('overview', 10, 'Overview after the preview\'s matches; a set-aside aftermath can be reviewed');
      s = openLandmark('muster-grounds');
      capture('landmark-muster-grounds', 0, 'Muster Grounds in the preview, with the representative\'s condition as recorded');
      s = back('Legacy_MusterBack', 'overview');
      s = openLandmark('war-record');
      capture('record-conflicts', 0, 'War Record conflicts: outcome, reason, moves and the representative\'s fate');
      s = d.pinch('Legacy_RecordTab_unresolved', (v) => v.legacyRecordTab === 'unresolved');
      capture('record-unresolved', 0, 'War Record open matters, including threads opened by a win');
      s = back('Legacy_RecordBack', 'overview');
      s = openLandmark('banner-hall');
      capture('landmark-banner-hall', 0, 'Banner Hall in a development preview: honours from fixtures, and no Dissolve control');
      s = back('Legacy_HallBack', 'overview');
      s = openLandmark('heralds-station');
      capture('herald-list', 0, 'Herald\'s Station in the preview');
      s = back('Legacy_HeraldBack', 'overview');
      if (s.legacyAftermath > 0) {
        s = d.pinch('Legacy_AftermathReview', (v) => v.legacyView === 'aftermath');
        s = d.pinch('Legacy_AftermathDismiss', (v) => v.legacyView === 'overview' && v.legacyAftermath === 0);
        capture('overview-acknowledged', 10, 'After Acknowledge: the aftermath is cleared for this preview (never saved)');
      }
    },
    recovery(kind) {
      const raw = kind === 'future' ? JSON.stringify({ schemaVersion: 99, banner: null }) : '{"schemaVersion":1,"banner":';
      if (d.cli('xr', 'status').sessionActive) { try { d.cli('xr', 'exit', {}); } catch { /* An ended session acknowledgement is fine. */ } }
      evidence.storedBefore = d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: 'set-save', CROWNFALL_LEGACY_SAVE: raw });
      d.reload();
      enter();
      capture('recovery', 0, kind === 'future' ? 'A save from a newer version, left untouched' : 'An unreadable save, left untouched, with a guest visit or a new banner offered');
      evidence.storedAfter = d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: 'storage' });
      assert.equal(evidence.storedAfter, raw, 'the unreadable save is exactly as it was');
      d.pinch('Legacy_RecoveryHome', (v) => v.screen === 'home');
      evidence.restored = d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: 'set-save', CROWNFALL_LEGACY_SAVE: '' });
    },
    comfort() {
      let s = enter();
      if (s.legacyView === 'aftermath') s = d.pinch('Legacy_AftermathLater', (v) => v.legacyView === 'overview');
      capture('overview', 10, `Text Size ${comfort}%: the panel grows about its centre and stays clear of the holding`);
      capture('overview-level', 0, `Text Size ${comfort}%: level view, panel top ${s.legacyPanelTopDegrees.toFixed(1)} degrees`);
      if (s.legacyFounded) {
        s = openLandmark('heralds-station');
        s = d.pinch('Legacy_Notice_0', (v) => v.legacyView === 'notice');
        capture('notice-wager', 0, `Text Size ${comfort}%: the wager terms`);
        s = d.pinch('Legacy_NoticeBack', (v) => v.legacyView === 'heralds-station');
        s = back('Legacy_HeraldBack', 'overview');
      }
    },
  };

  let failure;
  try {
    if (!process.argv.includes('--no-prepare')) setup();
    for (let attempt = 1; ; attempt++) {
      try {
        if (session === 'production') flows.production();
        else if (session === 'guest') flows.guest();
        else if (session.startsWith('preview:')) flows.preview(session.slice('preview:'.length));
        else if (session.startsWith('recovery:')) flows.recovery(session.slice('recovery:'.length));
        else if (session.startsWith('comfort:')) flows.comfort();
        else throw Error(`Unknown session ${session}`);
        break;
      } catch (error) {
        if (attempt >= 3 || !browserLost(error)) throw error;
        (evidence.restarts ??= []).push({ attempt, reason: String(error.message || error).slice(0, 400), capturesBeforeRestart: evidence.captures.map((item) => item.name) });
        evidence.captures.length = 0;
        d.interactions.length = 0;
        d.waitForRuntime();
        if (!process.argv.includes('--no-prepare')) setup();
      }
    }
    evidence.final = { state: d.fields(d.state()), session: d.cli('xr', 'status') };
  } catch (error) {
    failure = error;
    evidence.failure = String(error.stack || error);
    try { evidence.atFailure = d.fields(d.state()); } catch { /* The runtime may be gone. */ }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/${prefix}capture-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  if (failure) throw failure;
}
