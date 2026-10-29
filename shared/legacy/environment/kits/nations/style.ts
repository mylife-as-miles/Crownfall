// Nation variants: construction-tradition parameters the architecture kit reads, so
// each nation gets its own openings, plinths, overhangs and gables from the same
// kit code. Keys match blueprint `tradition` values; unknown traditions fall back by
// keyword. Working values pending the environment bible's style guide.

import type { NationId } from "../../../types";

export type WindowShape = "lancet" | "rect" | "small" | "slit" | "round";
export type TraditionKind = "gothic" | "jettied" | "cottage" | "timber" | "desert" | "generic";

export interface TraditionStyle {
  kind: TraditionKind;
  plinthMaterial: string;
  plinthOffset: number;
  waterTable: boolean;
  /** Material of the ground storey when it differs from the mass wall material (rubble under jettied frames). */
  groundStoreyMaterial: string | null;
  /** Jetty overhang per upper storey on the long faces (0 = none). */
  jetty: number;
  chamfer: number;
  stringCourses: boolean;
  window: { shape: WindowShape; width: number; height: number; sill: number; frame: number; proud: number; frameMaterial: string; bay: number };
  door: { shape: "pointed" | "rect" | "round"; width: number; height: number; frameMaterial: string };
  buttresses: boolean;
  parapetGables: boolean;
  overhang: number;
  verge: number;
}

/** Default material keys site kits use where the blueprint does not name one. */
export interface NationKeys {
  ashlar: string;
  rubble: string;
  roof: string;
  trim: string;
  timber: string;
  repair: string;
  paving: string;
  plaster: string;
}

export interface NationStyle {
  nationId: NationId;
  keys: NationKeys;
  traditions: Readonly<Record<string, TraditionStyle>>;
  fallback: TraditionStyle;
  /** Probability multiplier for lit windows (eclipse light makes Korvenia's interiors glow). */
  litWindows: number;
  /** Trim material per roof material (ridge caps, flashing); default is the roof material itself. */
  roofTrim: Readonly<Record<string, string>>;
  /** Roof slab thickness per roof material. */
  roofThickness: Readonly<Record<string, number>>;
}

const GOTHIC: TraditionStyle = {
  kind: "gothic",
  plinthMaterial: "kv-basalt-ashlar",
  plinthOffset: 0.2,
  waterTable: true,
  groundStoreyMaterial: null,
  jetty: 0,
  chamfer: 0.1,
  stringCourses: true,
  window: { shape: "lancet", width: 1.1, height: 2.6, sill: 1.1, frame: 0.17, proud: 0.18, frameMaterial: "kv-limestone", bay: 3.2 },
  door: { shape: "pointed", width: 1.7, height: 2.9, frameMaterial: "kv-limestone" },
  buttresses: true,
  parapetGables: true,
  overhang: 0.3,
  verge: 0,
};

const JETTIED: TraditionStyle = {
  kind: "jettied",
  plinthMaterial: "kv-basalt-rubble",
  plinthOffset: 0.12,
  waterTable: false,
  groundStoreyMaterial: "kv-basalt-rubble",
  jetty: 0.38,
  chamfer: 0.04,
  stringCourses: false,
  window: { shape: "rect", width: 0.85, height: 1.1, sill: 0.95, frame: 0.1, proud: 0.09, frameMaterial: "timber-dark", bay: 2.2 },
  door: { shape: "rect", width: 1.05, height: 2.05, frameMaterial: "timber-dark" },
  buttresses: false,
  parapetGables: false,
  overhang: 0.45,
  verge: 0.32,
};

const COTTAGE: TraditionStyle = {
  kind: "cottage",
  plinthMaterial: "kv-basalt-rubble",
  plinthOffset: 0.1,
  waterTable: false,
  groundStoreyMaterial: null,
  jetty: 0,
  chamfer: 0.06,
  stringCourses: false,
  window: { shape: "small", width: 0.62, height: 0.7, sill: 0.95, frame: 0.12, proud: 0.12, frameMaterial: "timber-dark", bay: 2.6 },
  door: { shape: "rect", width: 0.95, height: 1.85, frameMaterial: "timber-dark" },
  buttresses: false,
  parapetGables: false,
  overhang: 0.55,
  verge: 0.38,
};

const TIMBER_HALL: TraditionStyle = {
  ...COTTAGE,
  kind: "timber",
  plinthMaterial: "ag-fieldstone",
  window: { shape: "small", width: 0.5, height: 0.5, sill: 1.2, frame: 0.1, proud: 0.1, frameMaterial: "ag-oak-plank", bay: 3.4 },
  door: { shape: "round", width: 1.4, height: 2.4, frameMaterial: "ag-oak-plank" },
  overhang: 0.8,
  verge: 0.6,
};

const DESERT: TraditionStyle = {
  kind: "desert",
  plinthMaterial: "sf-sandstone-ashlar",
  plinthOffset: 0.12,
  waterTable: true,
  groundStoreyMaterial: null,
  jetty: 0,
  chamfer: 0.06,
  stringCourses: true,
  window: { shape: "round", width: 0.8, height: 1.4, sill: 1.4, frame: 0.14, proud: 0.14, frameMaterial: "sf-sandstone-ashlar", bay: 2.8 },
  door: { shape: "round", width: 1.5, height: 2.6, frameMaterial: "sf-sandstone-ashlar" },
  buttresses: false,
  parapetGables: false,
  overhang: 0.15,
  verge: 0.1,
};

const KORVENIA_STYLE: NationStyle = {
  nationId: "korvenia",
  keys: { ashlar: "kv-basalt-ashlar", rubble: "kv-basalt-rubble", roof: "kv-slate", trim: "kv-lead", timber: "kv-timber-raw", repair: "kv-limestone", paving: "road-flagstone", plaster: "plaster-lime" },
  traditions: { "kv-ashlar-gothic": GOTHIC, "kv-rubble-jettied": JETTIED, "kv-cottage": COTTAGE },
  fallback: JETTIED,
  litWindows: 1,
  roofTrim: { "kv-slate": "kv-lead", "kv-lead": "kv-lead", "kv-shingle": "timber-dark", "kv-thatch-dark": "kv-thatch-dark" },
  roofThickness: { "kv-slate": 0.16, "kv-lead": 0.12, "kv-shingle": 0.14, "kv-thatch-dark": 0.42, "kv-timber-raw": 0.1 },
};

function keywordStyle(tradition: string): TraditionStyle {
  if (/gothic|ashlar/.test(tradition)) return GOTHIC;
  if (/jett|frame/.test(tradition)) return JETTIED;
  if (/cottage|turf|sod/.test(tradition)) return COTTAGE;
  if (/hall|timber|stave|long/.test(tradition)) return TIMBER_HALL;
  if (/sand|desert|court|mud/.test(tradition)) return DESERT;
  return JETTIED;
}

const COURTYARD: TraditionStyle = {
  ...DESERT,
  plinthMaterial: "sf-sandstone-rubble",
  window: { shape: "small", width: 0.6, height: 0.7, sill: 1.9, frame: 0.12, proud: 0.12, frameMaterial: "sf-palm-timber", bay: 3.2 },
  door: { shape: "round", width: 1.1, height: 2.1, frameMaterial: "sf-sandstone-ashlar" },
  stringCourses: false,
};

const WORKS: TraditionStyle = {
  ...DESERT,
  plinthMaterial: "sf-sandstone-rubble",
  window: { shape: "slit", width: 0.3, height: 1.0, sill: 1.6, frame: 0.1, proud: 0.1, frameMaterial: "sf-iron-sheet", bay: 3.4 },
  door: { shape: "rect", width: 3, height: 3, frameMaterial: "sf-iron-sheet" },
  overhang: 0.3,
  verge: 0.2,
  stringCourses: false,
};

const TURF: TraditionStyle = {
  ...COTTAGE,
  kind: "timber",
  plinthMaterial: "ag-fieldstone",
  window: { shape: "small", width: 0.4, height: 0.4, sill: 1.1, frame: 0.1, proud: 0.1, frameMaterial: "ag-oak-plank", bay: 4 },
  door: { shape: "rect", width: 0.9, height: 1.7, frameMaterial: "ag-oak-plank" },
  overhang: 0.6,
  verge: 0.4,
};

const HERITAGE: TraditionStyle = {
  kind: "generic",
  plinthMaterial: "kw-concrete",
  plinthOffset: 0.15,
  waterTable: true,
  groundStoreyMaterial: null,
  jetty: 0,
  chamfer: 0.04,
  stringCourses: true,
  window: { shape: "rect", width: 1.2, height: 2.2, sill: 0.9, frame: 0.12, proud: 0.1, frameMaterial: "kw-steel-panel", bay: 3.0 },
  door: { shape: "rect", width: 1.6, height: 2.8, frameMaterial: "kw-steel-panel" },
  buttresses: false,
  parapetGables: false,
  overhang: 1.0,
  verge: 0.7,
};

const FERRO: TraditionStyle = {
  ...HERITAGE,
  stringCourses: false,
  window: { shape: "rect", width: 1.4, height: 1.5, sill: 0.9, frame: 0.08, proud: 0.06, frameMaterial: "kw-steel-panel", bay: 3.0 },
  door: { shape: "rect", width: 1.0, height: 2.2, frameMaterial: "kw-steel-panel" },
  overhang: 0.2,
  verge: 0.1,
};

const SHEET: TraditionStyle = {
  ...FERRO,
  window: { shape: "rect", width: 2.0, height: 0.6, sill: 3.0, frame: 0.06, proud: 0.05, frameMaterial: "kw-rusted-steel", bay: 3.6 },
  door: { shape: "rect", width: 3.6, height: 4.0, frameMaterial: "kw-rusted-steel" },
  overhang: 0.4,
  verge: 0.3,
};

const SOLFORIZ_STYLE: NationStyle = {
  nationId: "solforiz",
  keys: { ashlar: "sf-sandstone-ashlar", rubble: "sf-sandstone-rubble", roof: "sf-lime-plaster", trim: "sf-sandstone-ashlar", timber: "sf-palm-timber", repair: "sf-lime-plaster", paving: "road-flagstone", plaster: "sf-lime-plaster" },
  traditions: { "sf-cut-sandstone": DESERT, "sf-courtyard-house": COURTYARD, "sf-works": WORKS },
  fallback: DESERT,
  litWindows: 0.7,
  roofTrim: {},
  roofThickness: { "sf-glazed-tile": 0.12, "sf-iron-sheet": 0.06 },
};

const AETHELGARD_STYLE: NationStyle = {
  nationId: "aethelgard",
  keys: { ashlar: "ag-fieldstone", rubble: "ag-fieldstone", roof: "ag-oak-shingle", trim: "ag-oak-plank", timber: "ag-oak-plank", repair: "ag-oak-plank", paving: "road-earth", plaster: "ag-wattle-daub" },
  traditions: { "ag-longhall-timber": TIMBER_HALL, "ag-turf-house": TURF, "ag-fieldstone-work": { ...TURF, window: { ...TURF.window, bay: 99 } } },
  fallback: TIMBER_HALL,
  litWindows: 0.6,
  roofTrim: {},
  roofThickness: { "ag-sod-turf": 0.45, "ag-reed-thatch": 0.42, "ag-oak-shingle": 0.14 },
};

const KWIND_STYLE: NationStyle = {
  nationId: "kwind-09",
  keys: { ashlar: "kw-concrete", rubble: "kw-brick-soot", roof: "kw-asphalt-felt", trim: "kw-steel-panel", timber: "kw-timber-lattice", repair: "kw-steel-panel", paving: "road-setts", plaster: "kw-concrete" },
  traditions: { "kw-charter-heritage": HERITAGE, "kw-ferroconcrete": FERRO, "kw-sheet-industrial": SHEET },
  fallback: FERRO,
  litWindows: 1.2,
  roofTrim: {},
  roofThickness: { "kw-ceramic-tile": 0.12, "kw-corrugated-sheet": 0.05, "kw-asphalt-felt": 0.2 },
};

export function nationStyle(nationId: NationId): NationStyle {
  switch (nationId) {
    case "korvenia": return KORVENIA_STYLE;
    case "solforiz": return SOLFORIZ_STYLE;
    case "aethelgard": return AETHELGARD_STYLE;
    default: return KWIND_STYLE;
  }
}

export function traditionStyle(style: NationStyle, tradition: string): TraditionStyle {
  return style.traditions[tradition] ?? (style.nationId === "korvenia" ? keywordStyle(tradition) : style.fallback);
}
