// The textures the Quest archive room can load, derived from the shared
// material descriptors. Pure data, so the manifest (archive-assets.ts) and the
// Node-side sync check read the same list.
import { ARCHIVE_MATERIALS, getArchiveTexture, textureFile } from '../../../shared/chronicles/archive/materials';
import type { TextureDescriptor } from '../../../shared/chronicles/archive/materials';

export interface QuestArchiveTexture {
  id: string;
  size: number | readonly [number, number];
  descriptor: TextureDescriptor;
}

/** The manifest id of an archive texture at a size, e.g. `chronicles-limestone-quest-512`. */
export const archiveTextureAssetId = (id: string, size: number | readonly [number, number]): string => `chronicles-${textureFile(id, size).replace(/\.webp$/u, '')}`;

/**
 * Every texture the Quest room can load at any preset: each material's baked
 * lit albedo at its Quest sizes (512, and 256 on low) and the masks it names.
 * Desktop-only maps (albedo, normal, ORM, the cookie) are left out.
 */
export function questArchiveTextures(): readonly QuestArchiveTexture[] {
  const seen = new Set<string>(), textures: QuestArchiveTexture[] = [];
  for (const material of ARCHIVE_MATERIALS) {
    for (const kind of ['quest', 'mask'] as const) {
      const id = material.textures[kind];
      const descriptor = id ? getArchiveTexture(id) : undefined;
      if (!id || !descriptor) continue;
      for (const size of descriptor.sizes) {
        const file = textureFile(id, size);
        if (seen.has(file)) continue;
        seen.add(file);
        textures.push({ id, size, descriptor });
      }
    }
  }
  return textures;
}
