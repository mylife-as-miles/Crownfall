// Legacy environment check, run by `npm run check:sync` through scripts/check-menu-sync.ts:
// the baked texture manifest matches the files on disk, the Quest mirror is
// byte-identical to the canonical desktop assets, and shared environment code stays
// free of platform imports and nondeterminism.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "main game/public/assets/legacy/environment");
const quest = join(root, "main-game-vr/public/assets/legacy/environment");
const shared = join(root, "shared/legacy/environment");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

export async function checkLegacyEnvironment(): Promise<void> {
  // 1. Texture manifest integrity.
  const manifestPath = join(desktop, "textures/manifest.json");
  assert.ok(existsSync(manifestPath), "Legacy environment texture manifest is missing; run scripts/generate-legacy-environment-textures.ts");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: number; sets: Record<string, { files: Record<string, { file: string; sha256: string }> }> };
  assert.equal(manifest.version, 1, "Unexpected texture manifest version");
  let textureFiles = 0;
  for (const id of Object.keys(manifest.sets)) {
    for (const entry of Object.values(manifest.sets[id].files)) {
      const path = join(desktop, "textures", entry.file);
      assert.ok(existsSync(path), `Texture listed in the manifest is missing: ${entry.file}`);
      assert.equal(sha(path), entry.sha256, `Texture does not match its manifest hash: ${entry.file}`);
      textureFiles++;
    }
  }
  // 2. Quest mirror is byte-identical and has no stale files.
  const sources = walk(desktop);
  for (const file of sources) {
    const rel = relative(desktop, file);
    const mirror = join(quest, rel);
    assert.ok(existsSync(mirror), `Quest environment asset missing (run the Quest build or scripts/sync-legacy-environment-assets.mjs): ${rel}`);
    assert.equal(sha(mirror), sha(file), `Quest environment asset differs: ${rel}`);
  }
  const wanted = new Set(sources.map((f) => relative(desktop, f)));
  for (const file of walk(quest)) assert.ok(wanted.has(relative(quest, file)), `Stale Quest environment asset: ${relative(quest, file)}`);
  // 3. Shared environment hygiene.
  const forbidden: [RegExp, string][] = [
    [/from\s+["']three["']|from\s+["']three\//, "three import"],
    [/@iwsdk\//, "IWSDK import"],
    [/from\s+["']react/, "React import"],
    [/Math\.random\s*\(/, "Math.random"],
    [/Date\.now\s*\(|new Date\s*\(/, "clock access"],
    [/(?<![.\w])(window|document|localStorage)\./, "DOM or storage access"],
    [/\.at\(-?\d|\.findLast\(|Object\.hasOwn\(|\.replaceAll\(/, "API missing from the Quest ES2020 target"],
  ];
  let checked = 0;
  for (const file of walk(shared).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(file, "utf8");
    for (const [re, what] of forbidden) assert.ok(!re.test(text), `${relative(root, file)} uses ${what}`);
    checked++;
  }
  console.log(`PASS legacy environment: ${textureFiles} manifest textures verified, ${sources.length} byte-identical Quest assets, ${checked} shared modules free of platform imports`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  checkLegacyEnvironment().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
