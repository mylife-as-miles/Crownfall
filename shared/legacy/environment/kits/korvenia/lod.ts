// Level of detail for the production nation's settlement fabric, terrain and outer
// territory kits (Korvenia). One table maps the quality profile to what the kits emit,
// so desktop gets real timber frames, cut openings and yard life while Quest keeps the
// silhouettes, roofs and window rhythm at miniature scale.

import type { KitContext } from "../context";

export interface FabricLod {
  /** 0 = desktop-low, 1 = desktop-medium and Quest, 2 = desktop-high. */
  detail: 0 | 1 | 2;
  quest: boolean;
  /** Exposed timber members on framed storeys (posts, rails, braces). */
  frameMembers: boolean;
  /** Openings cut through the wall plane with reveals (otherwise surface openings). */
  cutOpenings: boolean;
  /** Shutters, window boxes, signs, lanterns, hoists, gutters. */
  facadeProps: boolean;
  /** Yard props expanded from building tags (woodpiles, coops, vats, hides, drying frames). */
  yardProps: boolean;
  /** Arch segments for doors and windows. */
  segments: number;
  /** Wall subdivision for vertex weathering (0 = none). */
  cell: number;
}

export function fabricLod(ctx: KitContext): FabricLod {
  const q = ctx.quality;
  if (q.id === "quest") return { detail: 1, quest: true, frameMembers: false, cutOpenings: false, facadeProps: false, yardProps: true, segments: 2, cell: 0 };
  if (q.detail >= 2) return { detail: 2, quest: false, frameMembers: true, cutOpenings: true, facadeProps: true, yardProps: true, segments: 5, cell: 1.2 };
  if (q.detail === 1) return { detail: 1, quest: false, frameMembers: true, cutOpenings: true, facadeProps: true, yardProps: true, segments: 4, cell: 0 };
  return { detail: 0, quest: false, frameMembers: false, cutOpenings: false, facadeProps: false, yardProps: false, segments: 2, cell: 0 };
}

/** The production nation these kits author. Other nations keep the shared generic kits. */
export function isKorvenia(ctx: KitContext): boolean {
  return ctx.bp.nationId === "korvenia";
}
