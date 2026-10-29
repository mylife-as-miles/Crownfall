// Heraldry atlas layout shared by both renderers: every heraldic cloth mesh in a
// build samples one atlas texture, so all standards, shields and pennants draw in a
// single call and a heraldry change only re-uploads the atlas.

export type HeraldrySlot = "player" | "ally" | "rival" | "crown" | "veiled";
export type HeraldryAspectKind = "banner" | "shield" | "pennant";

export interface AtlasTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HERALDRY_ATLAS_SIZE = { width: 1024, height: 1024 } as const;

const COLUMN: Readonly<Record<HeraldrySlot, number>> = { player: 0, ally: 1, rival: 2, crown: 3, veiled: 3 };

/** Pixel rect of a slot/aspect tile (row 0 at the top of the image). */
export function atlasTile(slot: HeraldrySlot, aspect: HeraldryAspectKind): AtlasTile {
  if (slot === "veiled") return { x: 768, y: 819, w: 256, h: 205 };
  const x = COLUMN[slot] * 256;
  if (aspect === "banner") return { x, y: 0, w: 256, h: 384 };
  if (aspect === "shield") return { x, y: 384, w: 256, h: 307 };
  return { x, y: 691, w: 256, h: 128 };
}

/**
 * UV rect [u0, v0, u1, v1] of a tile for textures uploaded with flipY (three.js
 * default for images): v = 1 is the top row of the atlas image.
 */
export function atlasUv(slot: HeraldrySlot, aspect: HeraldryAspectKind): [number, number, number, number] {
  const t = atlasTile(slot, aspect);
  const W = HERALDRY_ATLAS_SIZE.width, H = HERALDRY_ATLAS_SIZE.height;
  const inset = 1.5;
  return [(t.x + inset) / W, 1 - (t.y + t.h - inset) / H, (t.x + t.w - inset) / W, 1 - (t.y + inset) / H];
}

export const HERALDRY_SLOTS: readonly HeraldrySlot[] = ["player", "ally", "rival", "crown", "veiled"];
export const HERALDRY_ASPECTS: readonly HeraldryAspectKind[] = ["banner", "shield", "pennant"];
