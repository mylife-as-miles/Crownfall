// The material library: texture-set recipes and per-nation material definitions.
// Every key a kit or blueprint uses resolves here; unknown blueprint keys resolve by
// keyword so first-pass nations render with sensible materials until they get sets.

import type { NationId } from "../../types";
import type { MaterialDefinition, TextureSetId, TextureSetRecipe } from "./types";

export const TEXTURE_SETS: readonly TextureSetRecipe[] = [
  { id: "ashlar", generator: "ashlar", tileMetres: 2.4, highSize: 1024, seed: 11, palette: { stone: "#4a4750", stone2: "#3b3940", mortar: "#6e6a66", stain: "#2a2a2c" } },
  { id: "rubble", generator: "rubble", tileMetres: 2.4, highSize: 1024, seed: 12, palette: { stone: "#45434a", stone2: "#57524f", mortar: "#7a746c", stain: "#2d2b2c" } },
  { id: "limestone", generator: "ashlar", tileMetres: 2.4, highSize: 512, seed: 13, palette: { stone: "#8e897e", stone2: "#7d786e", mortar: "#9a9488", stain: "#5c574f" } },
  { id: "black-marble", generator: "black-marble", tileMetres: 2.4, highSize: 512, seed: 14, palette: { base: "#171619", vein: "#6e6973", gold: "#7d6838" } },
  { id: "slate", generator: "slate", tileMetres: 2.0, highSize: 1024, seed: 15, palette: { slate: "#3c4049", slate2: "#2f333b", edge: "#23252b", moss: "#4c5638" } },
  { id: "lead", generator: "lead", tileMetres: 3.0, highSize: 512, seed: 16, palette: { lead: "#6f747b", patina: "#9aa0a3", dark: "#4b4f55" } },
  { id: "shingle", generator: "shingle", tileMetres: 2.0, highSize: 512, seed: 17, palette: { wood: "#5b4a3a", wood2: "#43372d", grey: "#6e6862", moss: "#4f5636" } },
  { id: "thatch", generator: "thatch", tileMetres: 2.4, highSize: 512, seed: 18, palette: { straw: "#5a4b35", dark: "#33291e", moss: "#46502f" } },
  { id: "timber", generator: "timber", tileMetres: 2.0, highSize: 512, seed: 19, palette: { wood: "#6a5038", wood2: "#4a3726", dark: "#2a1f17" } },
  { id: "frame-plaster", generator: "frame-plaster", tileMetres: 3.2, highSize: 1024, seed: 20, palette: { plaster: "#b9b0a0", plaster2: "#a39a89", oak: "#3b2c21", oak2: "#2a1f18", grime: "#6d6658" } },
  { id: "plaster", generator: "plaster", tileMetres: 3.0, highSize: 512, seed: 21, palette: { plaster: "#b4ab9b", plaster2: "#9c9384", grime: "#6b6458" } },
  { id: "cobble", generator: "cobble", tileMetres: 2.0, highSize: 1024, seed: 22, palette: { stone: "#4c4a50", stone2: "#5d5853", dirt: "#3b342c" } },
  { id: "setts", generator: "setts", tileMetres: 2.0, highSize: 512, seed: 23, palette: { stone: "#55525a", stone2: "#46434a", dirt: "#3a332c" } },
  { id: "flagstone", generator: "flagstone", tileMetres: 3.0, highSize: 512, seed: 24, palette: { stone: "#57545c", stone2: "#4a464d", joint: "#2e2b2c" } },
  { id: "earth", generator: "earth", tileMetres: 4.0, highSize: 512, seed: 25, palette: { earth: "#4d4136", earth2: "#3c3229", pebble: "#6a645c" } },
  { id: "grass", generator: "grass", tileMetres: 4.0, highSize: 512, seed: 26, palette: { grass: "#4b5733", grass2: "#3a452a", dry: "#6b6440" } },
  { id: "heath", generator: "heath", tileMetres: 4.0, highSize: 512, seed: 27, palette: { heath: "#55494f", heath2: "#3f373a", green: "#4a5132", dry: "#6d5f4c" } },
  { id: "rock", generator: "rock", tileMetres: 6.0, highSize: 512, seed: 28, palette: { rock: "#3e3c42", rock2: "#2c2b30", light: "#5d5a5e", lichen: "#5f6a4a" } },
  { id: "cloth", generator: "cloth", tileMetres: 0.5, highSize: 512, seed: 29, palette: { cloth: "#8a8278", thread: "#6f685f" } },
  { id: "bark", generator: "bark", tileMetres: 1.5, highSize: 512, seed: 30, palette: { bark: "#3b332d", bark2: "#26211d", light: "#5b524a" } },
  { id: "foliage", generator: "foliage", tileMetres: 2.0, highSize: 512, seed: 31, palette: { leaf: "#2f3b26", leaf2: "#1f2a1c", light: "#4f5c37" } },
  { id: "iron", generator: "iron", tileMetres: 1.0, highSize: 512, seed: 32, palette: { iron: "#2b2a2c", rust: "#5a3a26", bright: "#5d5c60" } },
  { id: "sandstone", generator: "ashlar", tileMetres: 2.4, highSize: 512, seed: 33, palette: { stone: "#b38a5a", stone2: "#9c7449", mortar: "#c9a77c", stain: "#7a5734" } },
  { id: "mudbrick", generator: "plaster", tileMetres: 3.0, highSize: 512, seed: 34, palette: { plaster: "#a87f57", plaster2: "#8f6a47", grime: "#6a4d33" } },
];

export function textureSet(id: TextureSetId): TextureSetRecipe {
  for (const t of TEXTURE_SETS) if (t.id === id) return t;
  throw new Error(`unknown texture set ${id}`);
}

const std = (
  key: string, label: string, color: string, roughness: number, texture: TextureSetId | null,
  quest: string, extra: Partial<MaterialDefinition> = {},
): MaterialDefinition => ({
  key,
  label,
  shading: "standard",
  color,
  roughness,
  metalness: 0,
  texture,
  textureScale: texture ? TEXTURE_SETS.find((t) => t.id === texture)?.tileMetres ?? 2 : 1,
  uvSpace: "world",
  normalScale: 1,
  quest: { color: quest, textured: texture !== null },
  ...extra,
});

/** Materials every nation shares (kits reference these directly). */
export const COMMON_MATERIALS: readonly MaterialDefinition[] = [
  { ...std("terrain", "Terrain splat", "#ffffff", 0.95, null, "#5a5550"), shading: "terrain" },
  { ...std("far-terrain", "Far terrain", "#ffffff", 1, null, "#4b4650"), shading: "terrain" },
  std("road-setts", "Road setts", "#ffffff", 0.88, "setts", "#4e4b50"),
  std("road-cobble", "Cobbles", "#ffffff", 0.86, "cobble", "#4f4c50"),
  std("road-flagstone", "Flagstones", "#ffffff", 0.84, "flagstone", "#55525a"),
  std("road-earth", "Packed earth", "#ffffff", 0.95, "earth", "#4a3f35"),
  std("timber-dark", "Dark oak", "#ffffff", 0.78, "timber", "#3a2c21", { color: "#8a7766" }),
  std("timber-raw", "Raw timber", "#ffffff", 0.82, "timber", "#6a5038"),
  std("iron", "Wrought iron", "#ffffff", 0.55, "iron", "#2c2b2e", { metalness: 0.75 }),
  std("gilt", "Gilt", "#c9a23a", 0.35, null, "#c9a23a", { metalness: 1 }),
  std("bronze", "Bronze", "#8a6a3a", 0.42, null, "#8a6a3a", { metalness: 1 }),
  std("black-marble", "Black marble", "#ffffff", 0.22, "black-marble", "#19181b"),
  std("limestone", "Pale limestone", "#ffffff", 0.82, "limestone", "#8d887d"),
  std("plaster-lime", "Lime plaster", "#ffffff", 0.9, "plaster", "#b4ab9b"),
  std("hay", "Hay and straw", "#ffffff", 0.95, "thatch", "#7b6a45", { color: "#d6c08a" }),
  std("stone-generic", "Fieldstone", "#ffffff", 0.9, "rubble", "#55525a"),
  { ...std("glass-dark", "Dark glazing", "#1b1d24", 0.18, null, "#1b1d24"), shading: "glass" },
  { ...std("glass-lit", "Lit window", "#ffb35c", 0.4, null, "#ffb35c"), shading: "glass", emissive: { color: "#f08a32", intensity: 1.35 } },
  { ...std("door-oak", "Oak door", "#ffffff", 0.75, "timber", "#3a2a1f", { color: "#7a6250" }) },
  { ...std("cloth-heraldry", "Heraldic cloth (atlas)", "#ffffff", 0.88, null, "#ffffff"), shading: "cloth", uvSpace: "unit", doubleSided: true },
  { ...std("cloth-plain", "Undyed cloth", "#ffffff", 0.9, "cloth", "#8a8278"), shading: "cloth", doubleSided: true },
  { ...std("cloth-dyed", "Dyed cloth", "#ffffff", 0.9, "cloth", "#6e5a7c"), shading: "cloth", doubleSided: true },
  { ...std("foliage-conifer", "Conifer foliage", "#ffffff", 0.9, "foliage", "#26301f", { color: "#9fae96" }), shading: "foliage" },
  { ...std("foliage-broadleaf", "Broadleaf foliage", "#ffffff", 0.88, "foliage", "#343f28"), shading: "foliage" },
  { ...std("foliage-heath", "Heath and scrub", "#ffffff", 0.95, "heath", "#4d4150"), shading: "foliage" },
  std("bark", "Bark", "#ffffff", 0.92, "bark", "#3b332d"),
  { ...std("figure", "Figures (vertex palette)", "#ffffff", 0.8, null, "#ffffff"), uvSpace: "unit" },
  { ...std("fire", "Fire and embers", "#ffb050", 1, null, "#ff9a40"), shading: "emissive", emissive: { color: "#ff7a1a", intensity: 4 } },
  { ...std("candle", "Candle flame", "#ffd9a0", 1, null, "#ffd9a0"), shading: "emissive", emissive: { color: "#ffc070", intensity: 3 } },
  { ...std("smoke", "Smoke", "#8a8090", 1, null, "#8a8090"), shading: "smoke", transparent: true, opacity: 0.5, uvSpace: "unit" },
  { ...std("water", "Water", "#1d2430", 0.08, null, "#232a35"), shading: "water" },
  { ...std("silhouette", "Distant architecture", "#ffffff", 1, null, "#3a3440"), shading: "silhouette" },
  { ...std("skyline", "Skyline layers", "#ffffff", 1, null, "#3a3440"), shading: "silhouette" },
];

/** Korvenia: dark basalt, slate and lead, oak framing and lime plaster (blueprint keys). */
const KORVENIA: readonly MaterialDefinition[] = [
  std("kv-basalt-ashlar", "Basalt ashlar", "#ffffff", 0.82, "ashlar", "#46434b"),
  std("kv-basalt-rubble", "Basalt rubble", "#ffffff", 0.9, "rubble", "#4a474c"),
  std("kv-oak-frame-plaster", "Oak frame and plaster", "#ffffff", 0.88, "frame-plaster", "#8c8373"),
  std("kv-slate", "Slate", "#ffffff", 0.7, "slate", "#363a43"),
  std("kv-lead", "Lead", "#ffffff", 0.6, "lead", "#6c7178", { metalness: 0.3 }),
  std("kv-shingle", "Oak shingle", "#ffffff", 0.86, "shingle", "#54453a"),
  std("kv-thatch-dark", "Dark thatch", "#ffffff", 0.97, "thatch", "#4a3d2c"),
  std("kv-timber-raw", "Raw oak", "#ffffff", 0.82, "timber", "#6a5038"),
  std("kv-limestone", "Limestone repairs", "#ffffff", 0.84, "limestone", "#8d887d"),
  std("kv-black-marble", "Black marble", "#ffffff", 0.24, "black-marble", "#19181b"),
];

/** Solforiz first-pass keys (sandstone, mudbrick, tile, palm timber). */
const SOLFORIZ: readonly MaterialDefinition[] = [
  std("sf-sandstone-ashlar", "Sandstone ashlar", "#ffffff", 0.85, "sandstone", "#b38a5a"),
  std("sf-sandstone-rubble", "Sandstone rubble", "#d8b48a", 0.9, "rubble", "#a07a52"),
  std("sf-mudbrick-plaster", "Mudbrick plaster", "#ffffff", 0.93, "mudbrick", "#a87f57"),
  std("sf-lime-plaster", "Lime plaster", "#f0e2c8", 0.9, "plaster", "#d8c8a8"),
  std("sf-glazed-tile", "Glazed tile", "#3d6b78", 0.35, "slate", "#3d6b78"),
  std("sf-palm-timber", "Palm timber", "#ffffff", 0.85, "timber", "#7a5a3a"),
  std("sf-iron-sheet", "Iron sheet", "#ffffff", 0.6, "iron", "#5a4a40", { metalness: 0.6 }),
];

/** Aethelgard first-pass keys (oak, sod, thatch, fieldstone). */
const AETHELGARD: readonly MaterialDefinition[] = [
  std("ag-oak-stave", "Oak staves", "#ffffff", 0.85, "timber", "#4a3828"),
  std("ag-oak-plank", "Oak planks", "#ffffff", 0.85, "timber", "#57412e"),
  std("ag-oak-frame", "Oak frame", "#ffffff", 0.85, "timber", "#4a3828"),
  std("ag-sod-turf", "Sod roof", "#ffffff", 0.98, "grass", "#4a5232"),
  std("ag-oak-shingle", "Oak shingle", "#ffffff", 0.86, "shingle", "#54453a"),
  std("ag-reed-thatch", "Reed thatch", "#e0cfa0", 0.97, "thatch", "#7a6844"),
  std("ag-wattle-daub", "Wattle and daub", "#ffffff", 0.92, "plaster", "#8e8270"),
  std("ag-fieldstone", "Fieldstone", "#ffffff", 0.9, "rubble", "#5a5650"),
  std("ag-oak-palisade", "Oak palisade", "#ffffff", 0.88, "timber", "#4a3828"),
];

/** Kwind-09 first-pass keys (concrete, soot brick, steel, sheet, glazing). */
const KWIND: readonly MaterialDefinition[] = [
  std("kw-concrete", "Board-marked concrete", "#9a9894", 0.9, "plaster", "#77767a"),
  std("kw-brick-soot", "Soot brick", "#8a5a48", 0.88, "setts", "#4e3a34"),
  std("kw-steel-panel", "Steel panel", "#ffffff", 0.5, "iron", "#4c5056", { metalness: 0.7 }),
  std("kw-corrugated-sheet", "Corrugated sheet", "#9a9ea2", 0.55, "lead", "#5e6266", { metalness: 0.6 }),
  std("kw-rusted-steel", "Rusted steel", "#ffffff", 0.75, "iron", "#5a3a2a", { metalness: 0.4 }),
  { ...std("kw-glass-grid", "Glazed grid", "#26303a", 0.15, null, "#26303a", { metalness: 0.4 }), shading: "glass" },
  std("kw-ceramic-tile", "Glazed ceramic tile", "#2c3236", 0.35, "slate", "#2c3236"),
  std("kw-copper-verdigris", "Copper verdigris", "#5d8a7e", 0.55, "lead", "#5d8a7e", { metalness: 0.5 }),
  std("kw-asphalt-felt", "Asphalt felt", "#2e2e31", 0.95, "earth", "#2e2e31"),
  std("kw-timber-lattice", "Timber lattice", "#ffffff", 0.82, "timber", "#5a4030"),
];

export const NATION_MATERIALS: Readonly<Record<NationId, readonly MaterialDefinition[]>> = {
  korvenia: KORVENIA,
  solforiz: SOLFORIZ,
  aethelgard: AETHELGARD,
  "kwind-09": KWIND,
};

const KEYWORD_FALLBACKS: readonly [RegExp, string][] = [
  [/marble/, "black-marble"],
  [/ashlar|cut-|dressed|stone-work|masonry/, "kv-basalt-ashlar"],
  [/rubble|fieldstone|stone/, "stone-generic"],
  [/slate|tile/, "kv-slate"],
  [/lead|copper|zinc/, "kv-lead"],
  [/shingle/, "kv-shingle"],
  [/thatch|reed|straw/, "kv-thatch-dark"],
  [/sod|turf/, "ag-sod-turf"],
  [/frame|wattle|daub|half-timber/, "kv-oak-frame-plaster"],
  [/plaster|render|mudbrick|adobe/, "plaster-lime"],
  [/iron|steel|metal|sheet/, "iron"],
  [/timber|oak|plank|stave|palisade|wood|palm/, "timber-raw"],
  [/concrete|asphalt/, "stone-generic"],
];

export interface MaterialLibrary {
  nationId: NationId;
  /** Every definition available to this nation (common + nation set). */
  definitions: ReadonlyMap<string, MaterialDefinition>;
  /** Resolves any key (blueprint or kit) to a definition key present in `definitions`. */
  resolve(key: string): string;
  get(key: string): MaterialDefinition;
}

export function createMaterialLibrary(nationId: NationId): MaterialLibrary {
  const definitions = new Map<string, MaterialDefinition>();
  for (const m of COMMON_MATERIALS) definitions.set(m.key, m);
  // Fallback targets from every nation so keyword resolution always finds a definition.
  for (const list of [KORVENIA, SOLFORIZ, AETHELGARD, KWIND]) for (const m of list) definitions.set(m.key, m);
  for (const m of NATION_MATERIALS[nationId]) definitions.set(m.key, m);
  const cache = new Map<string, string>();
  const resolve = (key: string): string => {
    const hit = cache.get(key);
    if (hit) return hit;
    let out = definitions.has(key) ? key : "";
    if (!out) {
      for (const [re, target] of KEYWORD_FALLBACKS) {
        if (re.test(key)) {
          out = target;
          break;
        }
      }
    }
    if (!out) out = "stone-generic";
    cache.set(key, out);
    return out;
  };
  return {
    nationId,
    definitions,
    resolve,
    get: (key: string) => {
      const d = definitions.get(resolve(key));
      if (!d) throw new Error(`material ${key} unresolved`);
      return d;
    },
  };
}
