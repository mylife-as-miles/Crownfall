// One injected lazy-panel failure, followed by actual hand-operated recovery.
// Browser automation only prepares the network fault; it never clicks the UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLegacyDriver } from './legacy-driver.mjs';

export default async ({ page, frame }) => {
  const app = frame ?? page.mainFrame();
  if (process.env.CROWNFALL_LEGACY_FAULT === 'on') {
    return app.evaluate((hold) => {
      // A browser-run callback ends before the hand commands run. Keep the
      // fault in the app realm rather than a short-lived CDP route binding.
      performance.setResourceTimingBufferSize(5000);
      window.__legacyFetchOriginal ??= window.fetch;
      window.__legacyFaultHits = 0;
      window.fetch = function (input, options) {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('ui/legacy-dock.uikitml')) {
          window.__legacyFaultHits++;
          if (hold) return new Promise((_, reject) => { window.__legacyFaultReject = reject; });
          return Promise.reject(new TypeError('Injected Legacy dock download failure'));
        }
        return window.__legacyFetchOriginal.call(this, input, options);
      };
      return { fault: 'dock document fetch rejection', active: true };
    }, process.env.CROWNFALL_LEGACY_FAULT_WAIT === '1');
  }
  return app.evaluate(() => {
    if (window.__legacyFetchOriginal) window.fetch = window.__legacyFetchOriginal;
    if (window.__legacyFaultReject) {
      window.__legacyFaultReject(new TypeError('Injected Legacy dock download failure while paused'));
      window.__legacyFaultReject = null;
    }
    return { active: false, hits: window.__legacyFaultHits ?? 0 };
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d = createLegacyDriver();
  const paused = process.argv.includes('--paused');
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'artifacts/legacy/codex-round-2';
  await mkdir(out, { recursive: true });
  const evidence = { passed: false, startedAt: new Date().toISOString(), pausedFault: paused, physicalHeadset: false, input: 'Actual emulated hand ray and pinch, controllers disconnected', checks: [], interactions: d.interactions };
  let failure;
  try {
    d.prepareEmulation({ viewport: '640x480', preferences: { quality: 'low', motion: false }, reloadIf: (s) => s.quality !== 'low' || s.motion || !s.visitComplete });
    d.discover();
    d.enterXR();
    d.prepareHands();
    if (d.state().paused) d.menuPinch('Btn_Resume', (s) => !s.paused);
    if (d.state().screen === 'onboarding') d.menuPinch('Btn_SkipVisit', (s) => s.screen === 'home');
    if (d.state().screen !== 'home') d.menuPinch('Nav_Home', (s) => s.screen === 'home');
    assert.equal(d.state().legacyLoad, '', 'Use a fresh page so Legacy has not loaded');
    d.assertHandsOnly();
    d.browserRun('scripts/verify-legacy-failure.mjs', { CROWNFALL_LEGACY_FAULT: 'on', CROWNFALL_LEGACY_FAULT_WAIT: paused ? '1' : '0' });
    if (paused) {
      d.menuPinch('Home_legacy', (s) => s.screen === 'legacy' && s.legacyLoad === 'loading');
      d.menuPinch('Btn_Pause', (s) => s.paused && s.legacyLoad === 'loading');
      d.browserRun('scripts/verify-legacy-failure.mjs', { CROWNFALL_LEGACY_FAULT: 'off' });
      d.poll((s) => s.screen === 'home' && !s.paused && s.legacyLoad === 'failed');
      evidence.checks.push('An actual Pause during loading followed by a fetch failure returns Home without an automatic retry loop');
    } else d.menuPinch('Home_legacy', (s) => s.screen === 'home' && s.legacyLoad === 'failed');
    const fault = d.browserRun('scripts/verify-legacy-failure.mjs', { CROWNFALL_LEGACY_FAULT: 'off' });
    assert.ok(fault.hits > 0, 'The native document fetch was actually rejected');
    evidence.fault = fault;
    assert.equal(d.cli('ecs', 'find', { namePattern: '^My Legacy (Panel|Dock)$' }).entities.length, 0, 'Failed loading leaves no panel entities');
    evidence.checks.push('One native panel failure returns to Home and disposes its successful sibling');
    d.menuPinch('Nav_Play', (s) => s.screen === 'play');
    evidence.checks.push('Play remains usable after a Legacy load failure');
    d.browserRun('scripts/verify-legacy-failure.mjs', { CROWNFALL_LEGACY_FAULT: 'off' });
    d.menuPinch('Nav_Home', (s) => s.screen === 'home');
    d.menuPinch('Home_legacy', (s) => s.screen === 'legacy' && s.legacyLoad === 'ready');
    assert.equal(d.cli('ecs', 'find', { namePattern: '^My Legacy (Panel|Dock)$' }).entities.length, 2, 'Retry creates exactly one panel and dock');
    evidence.checks.push('Selecting My Legacy after the network recovers retries successfully, with exactly two native panel entities');
    evidence.final = d.fields(d.state());
    evidence.passed = true;
  } catch (error) {
    failure = error;
    evidence.failure = String(error.stack || error);
    try { evidence.final = d.fields(d.state()); } catch { /* Preserve the original failure. */ }
  } finally {
    d.browserRun('scripts/verify-legacy-failure.mjs', { CROWNFALL_LEGACY_FAULT: 'off' });
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${out}/${paused ? 'paused-' : ''}loading-failure.json`, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(`${evidence.passed ? 'PASS' : 'FAIL'} lazy loading recovery: ${evidence.checks.length} checks`);
  if (failure) throw failure;
}
