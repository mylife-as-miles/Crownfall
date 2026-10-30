// Real hand-only recovery checks. Storage writes below prepare isolated test
// sessions; all app actions use IWSDK hand rays/pinches or fingertip presses.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLegacyDriver, sleep } from './legacy-driver.mjs';

const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? 'artifacts/legacy/codex-round-4' : process.argv[outIndex + 1];
await mkdir(out, { recursive: true });
const d = createLegacyDriver();
const evidence = { passed: false, startedAt: new Date().toISOString(), physicalHeadset: false, input: 'Active IWER hand rays/pinches and fingertip presses, both controllers disconnected', developmentFramebufferScale: d.emulatorScale, checks: [], captures: [], interactions: d.interactions, cliRetries: d.cliRetries };
const raw = () => d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: 'storage' });
const store = (value) => d.browserRun('scripts/verify-legacy.mjs', { CROWNFALL_LEGACY_PROBE: 'set-save', CROWNFALL_LEGACY_SAVE: value ?? '' });
let original;
let failure;

function openRecovery(value) {
  if (d.cli('xr', 'status').sessionActive) { try { d.cli('xr', 'exit', {}); } catch { /* Session-end acknowledgement. */ } }
  store(value);
  d.browserRun('scripts/capture-legacy.mjs', { CROWNFALL_LEGACY_SEARCH: '' });
  let ready = false;
  for (let attempt = 0; attempt < 20 && !ready; attempt++) { try { d.discover(); ready = true; } catch { sleep(2); } }
  assert.ok(ready, 'The fresh recovery session initialized');
  d.enterXR();
  d.prepareHands();
  const state = d.reachLegacy();
  assert.equal(state.legacySession, 'recovery');
  assert.equal(state.legacyView, 'recovery');
  d.assertHandsOnly();
}

function found() {
  d.pinch('Legacy_NationNext', (s) => s.legacyView === 'name');
  const name = d.inspect('Legacy_Suggestion_0_Label').text;
  d.pinch('Legacy_Suggestion_0', (s) => s.legacyDraftName === name, { device: 'hand-left' });
  d.pinch('Legacy_NameNext', (s) => s.legacyView === 'arms');
  d.pinch('Legacy_ArmsNext', (s) => s.legacyView === 'confirm');
  d.pinch('Legacy_ConfirmRaise', (s) => s.legacyView === 'raised' && s.legacyFounded);
  d.poke('Legacy_DockPrimary', (s) => s.legacyView === 'overview');
  return name;
}

try {
  original = raw();
  d.prepareEmulation({ viewport: '640x480', preferences: { quality: 'low', motion: false }, reloadIf: (s) => s.quality !== 'low' || s.motion || !s.visitComplete });
  const cases = [
    ['corrupt', '{"schemaVersion":1,"banner":'],
    ['future', JSON.stringify({ schemaVersion: 99, banner: null })],
  ];
  for (const [kind, value] of cases) {
    openRecovery(value);
    assert.equal(d.state().legacyMirrorPrimary, 'Legacy_RecoveryGuest');
    assert.equal(d.inspect('Legacy_DockPrimary_Label').text, 'Continue as a guest');
    assert.equal(raw(), value);
    d.pinch('Legacy_RecoveryNew', (s) => s.legacyView === 'replace');
    assert.equal(d.inspect('Legacy_ResetConfirm_Label').text, 'Raise a new banner');
    assert.equal(d.inspect('Legacy_ResetCancel_Label').text, 'Back');
    assert.match(d.inspect('Legacy_Reset_Body').text, /replac/i);
    assert.equal(d.state().legacyMirrorPrimary, '');
    assert.equal(d.inspect('Legacy_DockPrimary').state.displayed, false, 'No destructive default is mirrored');
    assert.equal(d.inspect('Legacy_DockBack_Label').text, 'Back');
    assert.equal(raw(), value, 'Opening confirmation preserves the exact source bytes');
    assert.equal(d.cli('xr', 'status').sessionActive, true);
    const file = `${out}/${kind}-replacement.png`;
    evidence.captures.push({ kind, file, metadata: d.screenshot(file) });
    d.poke('Legacy_DockBack', (s) => s.legacyView === 'recovery');
    assert.equal(raw(), value, 'Cancelling replacement preserves the exact source bytes');
    evidence.checks.push(`${kind}: explicit replacement confirmation, no mirrored destructive action, fingertip Back preserves stored bytes`);
    d.poke('Legacy_DockPrimary', (s) => s.legacyView === 'nation' && !s.legacyPersistent);
    assert.equal(raw(), value);
    if (kind === 'future') {
      found();
      assert.equal(d.state().legacyPersistent, false);
      assert.equal(raw(), value, 'Completed guest founding cannot overwrite a newer save');
      evidence.checks.push('Future save: completing the safe guest path never writes the newer stored record');
    }
    evidence.checks.push(`${kind}: the default fingertip action starts a nonpersistent guest session`);
  }
  const future = cases[1][1];
  openRecovery(future);
  d.pinch('Legacy_RecoveryNew', (s) => s.legacyView === 'replace');
  d.pinch('Legacy_ResetConfirm', (s) => s.legacyView === 'nation');
  assert.equal(raw(), future, 'Confirming replacement still waits for the completed founding');
  const name = found();
  const replacement = JSON.parse(raw());
  assert.equal(replacement.schemaVersion, 1);
  assert.equal(replacement.banner.name, name);
  evidence.checks.push('Only an explicitly confirmed and completed replacement founding writes a new saved banner');
  d.pinch('Legacy_Landmark_banner-hall', (s) => s.legacyView === 'banner-hall');
  d.pinch('Legacy_ResetOpen', (s) => s.legacyView === 'reset');
  assert.equal(d.inspect('Legacy_ResetConfirm_Label').text, 'Dissolve the banner');
  assert.equal(d.inspect('Legacy_ResetCancel_Label').text, 'Keep the banner');
  d.poke('Legacy_DockBack', (s) => s.legacyView === 'banner-hall');
  d.pinch('Legacy_DockPlay', (s) => s.screen === 'play' && !s.legacyActive, { pitch: 44 });
  evidence.checks.push('Normal dissolution keeps its own labels and safe Back; the preserved Play exit works');
  evidence.final = d.fields(d.state());
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.failure = String(error.stack || error);
  try { evidence.final = d.fields(d.state()); } catch { /* Preserve original failure. */ }
} finally {
  if (original !== undefined) {
    try { store(original); evidence.originalSaveRestored = raw() === original; }
    catch (error) { evidence.restoreFailure = String(error); }
  }
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${out}/recovery-verification.json`, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(`${evidence.passed ? 'PASS' : 'FAIL'} hand recovery: ${evidence.checks.length} checks`);
if (failure) throw failure;
