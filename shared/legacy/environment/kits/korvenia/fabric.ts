// Shared vocabulary of the production nation's settlement fabric: resolved material keys,
// lime-wash and timber palettes, and predicates over the blueprint's authored tags, repairs,
// condition and class. Kits read these so every house is varied by its own data (age,
// quality, repairs, trade) rather than by random choice. Every key resolves to an existing
// library material, so the fabric adds no material groups (draw calls) of its own.

import type { Building, RepairKind } from "../../blueprint";
import { hashString } from "../../kernel";
import type { KitContext } from "../context";

export interface FabricMaterials {
  rubble: string;
  ashlar: string;
  limestone: string;
  plaster: string;
  framePlaster: string;
  oak: string;
  oakRaw: string;
  slate: string;
  shingle: string;
  thatch: string;
  lead: string;
  iron: string;
  door: string;
  glassLit: string;
  glassDark: string;
  cloth: string;
  clothDyed: string;
  hay: string;
  stone: string;
  water: string;
  fire: string;
  candle: string;
  flagstone: string;
  cobble: string;
}

export function fabricMaterials(ctx: KitContext): FabricMaterials {
  return {
    rubble: ctx.mat("kv-basalt-rubble"),
    ashlar: ctx.mat("kv-basalt-ashlar"),
    limestone: ctx.mat("kv-limestone"),
    plaster: ctx.mat("plaster-lime"),
    framePlaster: ctx.mat("kv-oak-frame-plaster"),
    oak: ctx.mat("timber-dark"),
    oakRaw: ctx.mat("timber-raw"),
    slate: ctx.mat("kv-slate"),
    shingle: ctx.mat("kv-shingle"),
    thatch: ctx.mat("kv-thatch-dark"),
    lead: ctx.mat("kv-lead"),
    iron: ctx.mat("iron"),
    door: ctx.mat("door-oak"),
    glassLit: ctx.mat("glass-lit"),
    glassDark: ctx.mat("glass-dark"),
    cloth: ctx.mat("cloth-plain"),
    clothDyed: ctx.mat("cloth-dyed"),
    hay: ctx.mat("hay"),
    stone: ctx.mat("stone-generic"),
    water: ctx.mat("water"),
    fire: ctx.mat("fire"),
    candle: ctx.mat("candle"),
    flagstone: ctx.mat("road-flagstone"),
    cobble: ctx.mat("road-cobble"),
  };
}

export type Rgb = readonly [number, number, number];

/** Lime-wash tints over the plaster texture (restrained, eclipse-lit: no white walls). */
const WASHES: readonly Rgb[] = [
  [0.82, 0.8, 0.77], // grey lime
  [0.88, 0.83, 0.74], // bone
  [0.9, 0.78, 0.6], // ochre wash
  [0.7, 0.7, 0.73], // smoke grey
  [0.8, 0.74, 0.82], // faded violet
  [0.76, 0.79, 0.71], // lichen grey
  [0.68, 0.62, 0.55], // umber, unwashed
];

export function hashOf(building: Building, salt = ""): number {
  return hashString(`${building.id}:${salt}`);
}

export function has(building: Building, tag: string): boolean {
  return building.tags.indexOf(tag) >= 0;
}

export function repaired(building: Building, kind: RepairKind, massId?: string): boolean {
  for (const r of building.age.repairs) if (r.kind === kind && (massId === undefined || r.mass === undefined || r.mass === massId)) return true;
  return false;
}

/** Condition multiplier for surfaces (clean new work to soot-dark ruins). */
export function conditionShade(building: Building): number {
  switch (building.age.condition) {
    case "new": return 1.06;
    case "sound": return 1;
    case "worn": return 0.94;
    case "weathered": return 0.86;
    case "damaged": return 0.8;
    case "ruinous": return 0.62;
    default: return 1.02;
  }
}

/** Plaster wash for a house: chosen by its own id, dirtied by condition and poverty, brightened by fresh render. */
export function plasterWash(building: Building): Rgb {
  const h = hashOf(building, "wash");
  let c = WASHES[h % WASHES.length];
  if (building.quality === "poor") c = WASHES[(h % 2) + 5];
  const k = conditionShade(building) * (repaired(building, "fresh-render") || repaired(building, "lime-wash") ? 1.12 : 1) * (building.quality === "fine" ? 1.04 : 1);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Oak tone: tarred dark on old work, paler on founding-era timber. */
export function oakShade(building: Building): Rgb {
  const young = building.age.era === "founding" || building.age.era === "recent" || has(building, "pale-timber");
  const k = young ? 1.25 : building.age.condition === "weathered" ? 0.62 : 0.78;
  return young ? [k * 1.05, k, k * 0.92] : [k, k * 0.96, k * 0.92];
}

/** Trade shown on a hanging sign, read from the building's authored tags. */
export type Trade = "candle" | "glove" | "jug" | "barrel" | "cloth" | "hammer" | "none";

export function tradeOf(building: Building): Trade {
  if (building.function === "forge") return "hammer";
  if (!has(building, "shop-front") && building.social !== "artisan") return "none";
  if (has(building, "candle-light")) return "candle";
  if (has(building, "hides")) return "glove";
  if (has(building, "dye-vats") || has(building, "fabric-drying")) return "cloth";
  if (has(building, "barrels")) return "barrel";
  if (has(building, "shop-front")) return "jug";
  return "none";
}
