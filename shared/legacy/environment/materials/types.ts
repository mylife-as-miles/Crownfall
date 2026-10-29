// Shared material definitions. Both renderers resolve a material key to the same
// look: PBR parameters, a baked texture set and a Quest fallback. Keys used by the
// blueprint (wall/roof material keys such as "kv-basalt-ashlar") resolve through
// the nation's material set; kits add generic keys (glass, cloth, foliage, terrain).

export type Shading =
  | "standard" // opaque PBR, vertex colours multiply albedo
  | "terrain" // four-layer splat (MeshBuffer.splat) over vertex colours
  | "foliage" // opaque, wind sway from motion weights
  | "cloth" // heraldry atlas, double-sided, wind from motion weights
  | "glass" // dark or lit glazing; lit glass is emissive
  | "emissive" // fire, embers, candles (flicker)
  | "water" // still or flowing water surface
  | "smoke" // soft additive-alpha billboards
  | "silhouette"; // distant architecture and skyline: unlit-ish, aerial perspective

export type TextureSetId =
  | "ashlar" | "rubble" | "limestone" | "black-marble" | "slate" | "lead" | "shingle" | "thatch" | "timber"
  | "frame-plaster" | "plaster" | "cobble" | "setts" | "flagstone" | "earth" | "grass" | "heath" | "rock"
  | "cloth" | "bark" | "foliage" | "iron" | "sandstone" | "mudbrick";

export interface TextureSetRecipe {
  id: TextureSetId;
  /** Generator in textures/generators.ts. */
  generator: TextureSetId;
  /** World metres covered by one tile (used as the default material texture scale). */
  tileMetres: number;
  /** Desktop-high resolution; every set also ships a 512 px variant for medium, low and Quest. */
  highSize: 512 | 1024;
  /** sRGB hex colours fed to the generator (palette of the set). */
  palette: Readonly<Record<string, string>>;
  seed: number;
}

export interface MaterialDefinition {
  key: string;
  label: string;
  shading: Shading;
  /** sRGB base-colour multiplier applied over the texture and vertex colours. */
  color: string;
  roughness: number;
  metalness: number;
  texture: TextureSetId | null;
  /** World metres per texture repeat (world-space UVs); ignored for unit UVs. */
  textureScale: number;
  uvSpace: "world" | "unit";
  normalScale: number;
  emissive?: { color: string; intensity: number };
  /** Rendered with both faces (cloth, foliage cards). */
  doubleSided?: boolean;
  transparent?: boolean;
  opacity?: number;
  /** Quest fallback when textures are off: flat sRGB colour; vertex colours still apply. */
  quest: { color: string; textured: boolean };
}

/** Terrain splat layers (MeshBuffer.splat channel order). */
export const TERRAIN_LAYERS = ["grass", "earth", "rock", "paving"] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];
