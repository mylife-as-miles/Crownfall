// Detail levels for the nation-variant kits (Solforiz, Aethelgard, Kwind-09). Every kit reads
// one VariantLod so the same building authoring yields a hero, a mid and a Quest version:
// Quest keeps silhouettes, openings and the landmark story pieces but drops small ornament,
// interiors and fine repetition (the miniature is seen at 1:125).

import type { Building } from "../../../blueprint";
import type { KitContext } from "../../context";

export interface VariantLod {
  /** 0 = massing with openings; 1 = full openings, bands and trims; 2 = hero extras. */
  detail: 0 | 1 | 2;
  quest: boolean;
  /** 0 = no small ornament; 1 = carved bands, screens, signage; 2 = every ornament. */
  ornament: 0 | 1 | 2;
  /** Segments for round masses, domes and lathes. */
  seg: number;
  /** Arch segments per side. */
  arch: number;
}

export function variantLod(ctx: KitContext, building?: Building): VariantLod {
  const q = ctx.quality;
  const quest = q.id === "quest";
  let detail: 0 | 1 | 2 = quest ? 1 : q.detail;
  let ornament: 0 | 1 | 2 = quest ? 0 : q.detail;
  if (building && building.lod === "background") {
    detail = detail > 0 ? ((detail - 1) as 0 | 1) : 0;
    ornament = 0;
  } else if (building && building.lod === "hero" && !quest && q.detail === 1) {
    // Hero buildings keep their ornament at medium; the rest of the holding stays plain.
    ornament = 1;
  } else if (building && building.lod !== "hero" && ornament > 1) {
    ornament = 1;
  }
  const seg = quest ? 10 : q.detail >= 2 ? 22 : q.detail === 1 ? 16 : 12;
  const arch = quest ? 3 : q.detail >= 2 ? 7 : q.detail === 1 ? 5 : 3;
  return { detail, quest, ornament, seg, arch };
}
