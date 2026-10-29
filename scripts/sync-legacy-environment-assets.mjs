// Mirrors the canonical Bannerhold environment assets from the desktop app
// (main game/public/assets/legacy/environment/) into the Quest app's public folder
// (main-game-vr/public/assets/legacy/environment/, git-ignored there). Called by
// main-game-vr/vite.config.ts at startup and build; verified by
// scripts/check-legacy-environment.ts. Copies changed files and removes stale ones.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const legacyEnvironmentSource = join(root, "main game/public/assets/legacy/environment");
export const legacyEnvironmentDestination = join(root, "main-game-vr/public/assets/legacy/environment");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function syncLegacyEnvironmentAssets() {
  let copied = 0;
  let removed = 0;
  const sources = walk(legacyEnvironmentSource);
  const wanted = new Set();
  for (const file of sources) {
    const rel = relative(legacyEnvironmentSource, file);
    wanted.add(rel);
    const dest = join(legacyEnvironmentDestination, rel);
    const data = readFileSync(file);
    if (existsSync(dest)) {
      const current = readFileSync(dest);
      if (current.length === data.length && current.equals(data)) continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    copied++;
  }
  for (const file of walk(legacyEnvironmentDestination)) {
    if (!wanted.has(relative(legacyEnvironmentDestination, file))) {
      rmSync(file);
      removed++;
    }
  }
  return { files: sources.length, copied, removed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = syncLegacyEnvironmentAssets();
  console.log(`Legacy environment assets: ${r.files} files (${r.copied} copied, ${r.removed} removed)`);
}
