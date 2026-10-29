// Platform quality profiles. The same blueprint builds at every profile; profiles
// trade terrain resolution, architectural detail, vegetation density, life and
// texture size against the draw-call and triangle budgets in docs/legacy/PERFORMANCE.md.

export type EnvironmentQuality = "desktop-low" | "desktop-medium" | "desktop-high" | "quest";

export interface QualityProfile {
  id: EnvironmentQuality;
  /** 0 = massing, roofs and simplified openings; 1 = full openings, courses and trims; 2 = hero extras. */
  detail: 0 | 1 | 2;
  terrain: {
    /** Cell size inside the detailed core (metres). */
    coreCell: number;
    /** Half extents of the detailed core around the datum. */
    coreHalfX: number;
    coreHalfZ: number;
    /** Geometric growth of cell size outside the core. */
    growth: number;
    maxCell: number;
  };
  /** Far landscape beyond the blueprint terrain extents: radius and the geometric growth of its cells. */
  farTerrain: { radius: number; growth: number };
  /** Vegetation instance density multiplier (1 = blueprint density). */
  vegetation: number;
  /** Dressing clusters (props) included. */
  dressing: boolean;
  /** NPC agents animated; 0 disables figures. */
  agents: number;
  smoke: boolean;
  /** Texture variant the renderer loads. */
  textures: "high" | "512" | "none";
  shadows: { enabled: boolean; mapSize: number };
  /** Practical point lights kept (highest priority first). */
  maxLights: number;
  /** Bake a directional light term into vertex colours (Quest). */
  bakeDirectional: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<EnvironmentQuality, QualityProfile>> = {
  "desktop-low": {
    id: "desktop-low",
    detail: 0,
    terrain: { coreCell: 2, coreHalfX: 80, coreHalfZ: 80, growth: 1.22, maxCell: 14 },
    farTerrain: { radius: 9000, growth: 1.55 },
    vegetation: 0.35,
    dressing: false,
    agents: 8,
    smoke: false,
    textures: "512",
    shadows: { enabled: false, mapSize: 0 },
    maxLights: 0,
    bakeDirectional: false,
  },
  "desktop-medium": {
    id: "desktop-medium",
    detail: 1,
    terrain: { coreCell: 1.25, coreHalfX: 85, coreHalfZ: 85, growth: 1.16, maxCell: 10 },
    farTerrain: { radius: 9000, growth: 1.38 },
    vegetation: 0.7,
    dressing: true,
    agents: 24,
    smoke: true,
    textures: "512",
    shadows: { enabled: true, mapSize: 2048 },
    maxLights: 3,
    bakeDirectional: false,
  },
  "desktop-high": {
    id: "desktop-high",
    detail: 2,
    terrain: { coreCell: 0.8, coreHalfX: 90, coreHalfZ: 90, growth: 1.12, maxCell: 8 },
    farTerrain: { radius: 9000, growth: 1.28 },
    vegetation: 1,
    dressing: true,
    agents: 40,
    smoke: true,
    textures: "high",
    shadows: { enabled: true, mapSize: 4096 },
    maxLights: 6,
    bakeDirectional: false,
  },
  quest: {
    id: "quest",
    detail: 1,
    terrain: { coreCell: 2, coreHalfX: 70, coreHalfZ: 66, growth: 1.3, maxCell: 18 },
    farTerrain: { radius: 3500, growth: 1.6 },
    vegetation: 0.26,
    dressing: true,
    agents: 10,
    smoke: true,
    textures: "512",
    shadows: { enabled: false, mapSize: 0 },
    maxLights: 0,
    bakeDirectional: true,
  },
};

export function qualityProfile(id: EnvironmentQuality): QualityProfile {
  return QUALITY_PROFILES[id];
}
