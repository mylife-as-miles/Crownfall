import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const menuPublicSource = resolve(repository, 'main game/public');
export const questPublicDestination = resolve(repository, 'main-game-vr/public');
export const sharedAssetPaths = [
  ...['new', 'resume', 'load', 'browse'].map(name => `assets/environments/card-${name}.webp`),
  ...['my-legacy', 'chronicles', 'herald-board'].map(name => `assets/home/${name}.webp`),
  'models/crownfall-sorcerer.glb', 'decoders/draco', 'fonts',
];
export function syncMenuAssets() {
  for (const path of sharedAssetPaths) {
    const destination = resolve(questPublicDestination, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(menuPublicSource, path), destination, { recursive: true });
  }
}
export function listSharedFiles(root = menuPublicSource) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => resolve(entry.parentPath || entry.path, entry.name));
}
