// The archive room's textures as Quest manifest entries. src/assets.ts, which
// the app runtime and the editor each evaluate, spreads them, so this module is
// deterministic and side-effect free: no World, DOM, timers or shared identity.
import { AssetType } from '@iwsdk/core';
import { textureFile, texturePath } from '../../../shared/chronicles/archive/materials';
import { archiveTextureAssetId, questArchiveTextures } from './archive-textures.js';

/** Manifest entries for every Quest archive texture, lazy so nothing loads before the archive opens. */
export function archiveAssets(publicUrl: (path: string) => string) {
  return Object.fromEntries(questArchiveTextures().map(({ id, size }) => [
    archiveTextureAssetId(id, size),
    { url: publicUrl(texturePath(id, size)), type: AssetType.Texture, name: textureFile(id, size), priority: 'lazy' as const },
  ]));
}
