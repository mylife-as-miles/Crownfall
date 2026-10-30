import assert from 'node:assert/strict';
import test from 'node:test';
import { freshModuleUrl, RetryableModuleImport } from '../retryable-import';

const PAGE = 'https://crownfall.test/quest/';
const CHUNK = 'https://crownfall.test/quest/assets/legacy-experience-abc.js';
const failed = (url = CHUNK) => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

test('a cached failed entry gets a fresh same-origin URL, then the successful module stays reusable', async () => {
  let initialCalls = 0;
  const requests: string[] = [];
  const module = { create: () => 'ready' };
  const imports = new RetryableModuleImport(async () => { initialCalls++; throw failed(); }, async (url) => { requests.push(url); return module; }, () => PAGE);
  await assert.rejects(imports.load(), /Failed to fetch/);
  assert.equal(imports.reloadRequired, false);
  assert.equal(await imports.load(), module);
  assert.equal(await imports.load(), module, 'panel-document retries reuse the successfully loaded module');
  assert.equal(initialCalls, 1, 'never revisit the permanently rejected original import');
  assert.deepEqual(requests, [`${CHUNK}?moduleRetry=1`]);
});

test('fresh failures are bounded and an exhausted entry explicitly requires a page reload', async () => {
  const requests: string[] = [];
  const imports = new RetryableModuleImport(async () => { throw failed(); }, async (url) => { requests.push(url); throw failed(url); }, () => PAGE);
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(imports.load(), /Failed to fetch/);
  assert.equal(imports.reloadRequired, true);
  await assert.rejects(imports.load(), /Failed to fetch/);
  assert.deepEqual(requests, [`${CHUNK}?moduleRetry=1`, `${CHUNK}?moduleRetry=2`]);
});

test('URL-less, invalid and external module errors ask for reload rather than guessing or importing other origins', async () => {
  for (const error of [new Error('Importing a module script failed.'), failed('https://other.test/module.js'), failed('data:text/javascript,x'), new Error('render exception')]) {
    let freshCalls = 0;
    const imports = new RetryableModuleImport(async () => { throw error; }, async () => { freshCalls++; return {}; }, () => PAGE);
    await assert.rejects(imports.load());
    assert.equal(imports.reloadRequired, true);
    await assert.rejects(imports.load());
    assert.equal(freshCalls, 0);
  }
  assert.equal(freshModuleUrl(failed(), 'invalid page', 1), null);
  assert.equal(freshModuleUrl(failed(), PAGE, 0), null);
  assert.equal(freshModuleUrl(failed(), PAGE, 3), null);
});

test('the browser URL preserves development query strings and subpath deployments', () => {
  assert.equal(freshModuleUrl(new TypeError('error loading dynamically imported module: /quest/src/legacy/legacy-experience.ts?t=42'), PAGE, 1),
    'https://crownfall.test/quest/src/legacy/legacy-experience.ts?t=42&moduleRetry=1');
});
