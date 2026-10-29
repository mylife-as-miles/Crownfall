// Shared detail library of the landmark package (Korvenia Gothic): level of detail per
// quality profile, resolved material keys and re-exports of the face, massing and roof
// pieces. Every key resolves to an existing library material, so the landmarks add no
// material groups (draw calls) of their own.

import type { KitContext } from "../../context";
import type { FaceMaterials } from "./face";

export * from "./face";
export * from "./mass";
export * from "./roofs";

export interface LandmarkLod {
  /** 0 = silhouette (desktop-low), 1 = full openings and trims, 2 = hero extras. */
  detail: 0 | 1 | 2;
  /** Quest miniature: silhouette-first, no interiors or sub-centimetre ornament. */
  quest: boolean;
  /** Small ornament level (hood moulds, leading, gablets, lucarnes, crockets): 0 on Quest and desktop-low. */
  ornament: 0 | 1 | 2;
  /** Wall subdivision for vertex-colour weathering (0 = none). */
  cell: number;
  /** Arch segments per side. */
  segments: number;
  /** Lead roll spacing (0 = none). */
  rolls: number;
  cresting: boolean;
  corbels: boolean;
  interiors: boolean;
}

export function landmarkLod(ctx: KitContext): LandmarkLod {
  const q = ctx.quality;
  if (q.id === "quest") return { detail: 1, quest: true, ornament: 0, cell: 0, segments: 3, rolls: 0, cresting: false, corbels: false, interiors: false };
  if (q.detail >= 2) return { detail: 2, quest: false, ornament: 2, cell: 0.9, segments: 7, rolls: 0.8, cresting: true, corbels: true, interiors: true };
  if (q.detail === 1) return { detail: 1, quest: false, ornament: 1, cell: 1.5, segments: 5, rolls: 1.25, cresting: true, corbels: true, interiors: true };
  return { detail: 0, quest: false, ornament: 0, cell: 0, segments: 3, rolls: 0, cresting: false, corbels: false, interiors: false };
}

export interface LandmarkMaterials {
  ashlar: string;
  rubble: string;
  dressing: string;
  marble: string;
  lead: string;
  slate: string;
  shingle: string;
  frame: string;
  timberDark: string;
  timberRaw: string;
  iron: string;
  gilt: string;
  bronze: string;
  glassLit: string;
  glassDark: string;
  door: string;
  flagstone: string;
  fieldstone: string;
  cloth: string;
  plaster: string;
  hay: string;
  fire: string;
  candle: string;
}

export function landmarkMaterials(ctx: KitContext): LandmarkMaterials {
  const k = ctx.style.keys;
  return {
    ashlar: ctx.mat(k.ashlar),
    rubble: ctx.mat(k.rubble),
    dressing: ctx.mat(k.repair),
    marble: ctx.mat("kv-black-marble"),
    lead: ctx.mat("kv-lead"),
    slate: ctx.mat(k.roof),
    shingle: ctx.mat("kv-shingle"),
    frame: ctx.mat("kv-oak-frame-plaster"),
    timberDark: ctx.mat("timber-dark"),
    timberRaw: ctx.mat("timber-raw"),
    iron: ctx.mat("iron"),
    gilt: ctx.mat("gilt"),
    bronze: ctx.mat("bronze"),
    glassLit: ctx.mat("glass-lit"),
    glassDark: ctx.mat("glass-dark"),
    door: ctx.mat("door-oak"),
    flagstone: ctx.mat("road-flagstone"),
    fieldstone: ctx.mat("stone-generic"),
    cloth: ctx.mat("cloth-plain"),
    plaster: ctx.mat("plaster-lime"),
    hay: ctx.mat("hay"),
    fire: ctx.mat("fire"),
    candle: ctx.mat("candle"),
  };
}

export function faceMaterials(m: LandmarkMaterials, wall: string, dressing = m.dressing): FaceMaterials {
  return { wall, dressing, glassLit: m.glassLit, glassDark: m.glassDark, door: m.door, boards: m.timberRaw, iron: m.iron };
}
export * from "./build";
