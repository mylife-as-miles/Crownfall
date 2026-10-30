// Fault setup captures a real rejected ESM request, then injects that rejection
// into the next loader attempt. All app actions run afterward through actual
// CLI hands, with no held CDP lease. This is a loader fault, not a network outage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLegacyDriver } from './legacy-driver.mjs';

export default async ({ page, frame }) => {
  if (process.env.CROWNFALL_CHUNK_FAULT === 'prime') {
    const appFrame = frame ?? page.mainFrame();
    const requests = [];
    // This verifier targets the managed development server, not a guessed
    // production chunk. The URL is the app's actual development entry module.
    const moduleUrl = new URL('/src/legacy/legacy-experience.ts', appFrame.url()).href;
    const reject = async (route) => { requests.push(route.request().url()); await route.abort('failed'); };
    await page.route(moduleUrl, reject);
    try {
      const result = await appFrame.evaluate(async (url) => {
        performance.setResourceTimingBufferSize(5000);
        performance.clearResourceTimings();
        let rejection;
        try { await import(url); return { rejected: false }; }
        catch (error) { rejection = error; }
        const { RetryableModuleImport } = await import('/src/retryable-import.ts');
        const prototype = RetryableModuleImport.prototype;
        const load = prototype.load;
        const observation = window.__crownfallRetryFault = { injected: 0, restored: false };
        prototype.load = async function () {
          prototype.load = load;
          const initial = this.initial;
          this.initial = async () => { observation.injected++; throw rejection; };
          try { return await load.call(this); }
          finally { this.initial = initial; observation.restored = true; }
        };
        return { rejected: true, message: String(rejection), injectionArmed: true };
      }, moduleUrl);
      return { ...result, requests, hits: requests.length, moduleUrl, routeRemoved: true };
    } finally { await page.unroute(moduleUrl, reject); }
  }
  return (frame ?? page.mainFrame()).evaluate(() => ({
    requests: performance.getEntriesByType('resource')
      .filter((entry) => /legacy-experience/.test(entry.name))
      .map((entry) => ({ url: entry.name, transferSize: entry.transferSize, responseStatus: entry.responseStatus })),
    rejectionInjection: window.__crownfallRetryFault,
  }));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex < 0 ? 'artifacts/legacy/codex-round-4' : process.argv[outIndex + 1];
  await mkdir(out, { recursive: true });
  const d = createLegacyDriver();
  const evidence = { passed: false, startedAt: new Date().toISOString(), physicalHeadset: false, input: 'Actual IWER hand ray and pinch with both controllers disconnected', checks: [], interactions: d.interactions, cliRetries: d.cliRetries };
  let failure;
  try {
    d.prepareEmulation({ viewport: '640x480', preferences: { quality: 'low', motion: false }, reloadIf: () => true });
    d.discover(); d.enterXR(); d.prepareHands();
    if (d.state().paused) d.menuPinch('Btn_Resume', (s) => !s.paused);
    if (d.state().screen === 'onboarding') d.menuPinch('Btn_SkipVisit', (s) => s.screen === 'home');
    if (d.state().screen !== 'home') d.menuPinch('Nav_Home', (s) => s.screen === 'home');
    assert.equal(d.state().legacyLoad, '', 'Legacy must not have loaded in this document');
    d.assertHandsOnly();
    evidence.fault = d.browserRun('scripts/verify-legacy-chunk-failure.mjs', { CROWNFALL_CHUNK_FAULT: 'prime' });
    assert.ok(evidence.fault.rejected && evidence.fault.hits === 1, 'Fault setup rejected the actual development ESM request');
    assert.equal(d.state().legacyLoad, '', 'Priming a failed module cache does not activate a UI route');
    d.menuPinch('Home_legacy', (s) => s.screen === 'home' && s.legacyLoad === 'failed');
    evidence.failedRequests = d.browserRun('scripts/verify-legacy-chunk-failure.mjs', {});
    assert.deepEqual(evidence.failedRequests.rejectionInjection, { injected: 1, restored: true });
    // Aborted requests need not retain timing entries. The completed fault
    // callback recorded the exact request, before any CLI hand command ran.
    assert.equal(d.cli('ecs', 'find', { namePattern: '^My Legacy (Panel|Dock)$' }).entities.length, 0);
    evidence.checks.push('After injecting the captured ESM rejection into the next loader attempt, hand entry fails safely on Home with no Legacy panel entities');
    d.menuPinch('Nav_Play', (s) => s.screen === 'play');
    d.menuPinch('Nav_Home', (s) => s.screen === 'home');
    evidence.checks.push('The existing Play and Home navigation remain usable after the module failure');
    d.menuPinch('Home_legacy', (s) => s.screen === 'legacy' && s.legacyLoad === 'ready');
    evidence.requestsAfterRetry = d.browserRun('scripts/verify-legacy-chunk-failure.mjs', {});
    assert.ok(evidence.requestsAfterRetry.requests.some((request) => new URL(request.url).searchParams.get('moduleRetry') === '1' && request.responseStatus === 200), 'Retry fetched a fresh module URL successfully');
    assert.equal(d.cli('ecs', 'find', { namePattern: '^My Legacy (Panel|Dock)$' }).entities.length, 2);
    evidence.checks.push('An actual hand retry fetches the fresh module URL and creates exactly one panel and dock');
    evidence.final = d.fields(d.state());
    evidence.passed = true;
  } catch (error) {
    failure = error; evidence.failure = String(error.stack || error);
    try { evidence.final = d.fields(d.state()); } catch { /* Preserve original failure. */ }
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(`${out}/chunk-failure-verification.json`, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(`${evidence.passed ? 'PASS' : 'FAIL'} injected module-loader recovery: ${evidence.checks.length} checks`);
  if (failure) throw failure;
}
