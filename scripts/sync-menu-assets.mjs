import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateQuestDecorations } from './generate-quest-decoration.mjs';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const menuPublicSource = resolve(repository, 'main game/public');
export const questPublicDestination = resolve(repository, 'main-game-vr/public');
export const sharedAssetPaths = [
  ...['new', 'resume', 'load', 'browse'].map(name => `assets/environments/card-${name}.webp`),
  ...['my-legacy', 'chronicles', 'herald-board'].map(name => `assets/home/${name}.webp`),
  'models/crownfall-sorcerer.glb', 'decoders/draco', 'fonts',
];
export function syncMenuAssets() {
  const copyChanged = path => {
    const source = resolve(menuPublicSource, path), destination = resolve(questPublicDestination, path);
    if (statSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      for (const child of readdirSync(source)) copyChanged(`${path}/${child}`);
    } else if (!existsSync(destination) || !readFileSync(source).equals(readFileSync(destination))) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  };
  for (const path of sharedAssetPaths) copyChanged(path);
  generateQuestDecorations(resolve(questPublicDestination, 'assets/decorations'));
}
export function listSharedFiles(root = menuPublicSource) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => resolve(entry.parentPath || entry.path, entry.name));
}
