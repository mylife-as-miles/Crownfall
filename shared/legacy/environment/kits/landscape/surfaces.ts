// Terrain surface palette: absolute albedo (sRGB authored, linear output) per blueprint
// surface category, and the splat layer each category drives. Layer textures add
// detail on top of these colours (renderers multiply by 2 × detail texture).

import type { TerrainSurface } from "../../blueprint";
import { hexToLinear } from "../../kernel";
import type { V3 } from "../../kernel";

/** Splat layers: 0 vegetated ground, 1 bare earth, 2 rock, 3 paving. */
export const SURFACE_LAYER: Readonly<Record<TerrainSurface, 0 | 1 | 2 | 3>> = {
  grass: 0, meadow: 0, heath: 0, moss: 0, field: 0, snow: 0,
  earth: 1, mud: 1, "forest-floor": 1, sand: 1, dune: 1, gravel: 1, "salt-flat": 1, "sulfur-crust": 1, slag: 1,
  rock: 2, scree: 2,
  paving: 3, cobble: 3, concrete: 3, asphalt: 3,
};

const HEX: Readonly<Record<TerrainSurface, string>> = {
  grass: "#47503a",
  meadow: "#525a3a",
  heath: "#4d443f",
  moss: "#465236",
  field: "#4f4630",
  snow: "#c9ccd6",
  earth: "#4b3f34",
  mud: "#372d26",
  "forest-floor": "#2e2a24",
  sand: "#9a8466",
  dune: "#a88f6a",
  gravel: "#5c5753",
  "salt-flat": "#b8b2a6",
  "sulfur-crust": "#a8973e",
  slag: "#2c2a2a",
  rock: "#3d3b41",
  scree: "#57535a",
  paving: "#56535b",
  cobble: "#4c4a50",
  concrete: "#6a6a6c",
  asphalt: "#2e2e31",
};

const CACHE = new Map<TerrainSurface, V3>();

export function surfaceColor(s: TerrainSurface): V3 {
  let c = CACHE.get(s);
  if (!c) {
    c = hexToLinear(HEX[s]);
    CACHE.set(s, c);
  }
  return c;
}

/** Field colours by condition (overrides the base "field" surface inside field plots). */
export const FIELD_HEX: Readonly<Record<string, string>> = {
  tended: "#46512f",
  harvested: "#7a6a42",
  fallow: "#5a4c3c",
  neglected: "#5e5a3e",
};
