import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/effects/render-controls.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { nextRenderTimestamp, scaledPixelRatio, normalizeFrameLimit } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const cadence = [];
for (const refresh of [60, 120, 144]) {
  for (const limit of [0, 30, 60, 120]) {
    let previous = 0, accepted = 0;
    for (let frame = 1; frame <= refresh * 2; frame++) {
      const timestamp = nextRenderTimestamp(frame * 1000 / refresh, previous, limit);
      if (timestamp !== null) { accepted++; previous = timestamp; }
    }
    const expected = Math.min(refresh, limit || refresh) * 2;
    assert.ok(Math.abs(accepted - expected) <= 1, `${refresh}Hz with cap ${limit}: ${accepted}, expected ${expected}`);
    cadence.push({ refreshHz: refresh, cap: limit || 'unlimited', framesInTwoSeconds: accepted, expected });
  }
}
assert.equal(scaledPixelRatio(1, 100), 1);
assert.equal(scaledPixelRatio(2, 100), 1.5);
assert.equal(scaledPixelRatio(2, 50), 0.75);
assert.equal(scaledPixelRatio(2, 0), 0.75);
assert.equal(scaledPixelRatio(2, 200), 1.5);
assert.equal(scaledPixelRatio(2, NaN), 1.5);
assert.equal(normalizeFrameLimit(90), 0);
assert.equal(nextRenderTimestamp(1, 0, 0), 1, 'default preserves uncapped cadence');
await writeFile('artifacts/settings/render-controls.json', JSON.stringify({ passed: true, scope: 'Deterministic cadence and pixel-ratio boundaries; actual GPU speed is device-dependent.', cadence, pixelRatioChecks: 'Default DPR clamp, 50% scaling, finite bounds and unlimited fallback pass.' }, null, 2) + '\n');
console.log('PASS all 12 display/cap combinations and renderer resolution boundaries');
