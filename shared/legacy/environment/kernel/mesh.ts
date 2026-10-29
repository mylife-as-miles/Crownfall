// Mesh-buffer contract between the shared Bannerhold builders and the platform
// renderers (desktop three, Quest super-three). Plain typed arrays only: each
// platform converts them into its own runtime objects and never shares runtime
// Three objects. See docs/legacy/environment/TECHNICAL_SPEC.md (pipeline section).

import type { LandmarkId, NationId } from "../../types";

export type Vec3 = readonly [number, number, number];

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Per-mesh animation hint implemented by each renderer in its vertex stage using
 * MeshBuffer.motionWeights. A renderer that cannot animate draws the mesh static,
 * which is always a valid pose.
 */
export type MeshMotion =
  /** Weights: 0 where cloth is attached, rising to 1 at the free edge. */
  | { kind: "cloth"; amplitude: number; frequency: number }
  /** Weights: 0 at the root, 1 at the tip (foliage, reeds). */
  | { kind: "sway"; amplitude: number; frequency: number }
  /** Emissive modulation (fire, candles). Weights: per-vertex phase in 0..1. */
  | { kind: "flicker"; rate: number; depth: number }
  /** Rising smoke billboards. Weights: per-vertex column phase in 0..1. */
  | { kind: "smoke"; rise: number; drift: number }
  /** Slow surface flow (water). Weights unused. */
  | { kind: "flow"; speed: number };

/**
 * State gate: the mesh is visible only while the scene state satisfies it. Used for
 * development that hall tiers reveal, so a state change toggles visibility instead
 * of rebuilding the environment.
 */
export interface StateGate {
  /** Visible when hallTier >= minHallTier. */
  minHallTier?: 0 | 1 | 2 | 3;
  /** Visible when hallTier <= maxHallTier (the unfinished state of a structure). */
  maxHallTier?: 0 | 1 | 2 | 3;
  /** Visible only while the scene flag is raised (see build/state.ts resolveSceneFlags). */
  flag?: SceneFlag;
}

/**
 * Presentation flags derived from LegacySceneState. They describe what to show,
 * never results: gameplay decides every underlying fact.
 */
export type SceneFlag =
  | "founded"
  | "allied-house"
  | "rival-house"
  | "rival-challenge"
  | "representative-captive"
  | `frontier:${NationId}`;

export interface MeshBuffer {
  /** Unique within a build: `${part}|${material}|${variant}`. */
  name: string;
  /**
   * Semantic part, e.g. "landmark:banner-hall", "settlement", "fortification",
   * "terrain", "vegetation", "outer", "skyline". Picking and highlight use `landmark`.
   */
  part: string;
  /** Material library key (materials/library.ts). */
  material: string;
  /** World metres, xyz per vertex (instance prototypes: instance-local metres). */
  positions: Float32Array;
  /** Unit normals, xyz per vertex. */
  normals: Float32Array;
  /** uv per vertex: world metres or 0..1 (MaterialDefinition.uvSpace). */
  uvs: Float32Array;
  /** Linear rgb per vertex: baked tint, contact darkening, grime and optional light. */
  colors: Float32Array | null;
  /** Terrain only: four splat-layer weights per vertex summing to 1. */
  splat: Float32Array | null;
  /** One float per vertex interpreted by `motion`. */
  motionWeights: Float32Array | null;
  /** Landmark index per vertex (0 = none, 1..4 = LEGACY_LANDMARKS order + 1); lets renderers merge parts and still highlight one landmark. */
  landmarkIds: Uint8Array | null;
  /** Triangle list, counter-clockwise front faces. */
  indices: Uint32Array;
  castShadow: boolean;
  receiveShadow: boolean;
  /** 0 = full detail; higher numbers are coarser representations. */
  lod: number;
  /** Landmark this whole mesh belongs to, or null (see landmarkIds for merged meshes). */
  landmark: LandmarkId | null;
  motion: MeshMotion | null;
  gate: StateGate | null;
  bounds: Bounds3;
}

export type InstanceMotion =
  /** Instances are driven per frame by the renderer from NPC schedules (life metadata). */
  | { kind: "agents" }
  | { kind: "sway"; amplitude: number; frequency: number };

/** Repeated prototype geometry, one instanced draw per prototype mesh. */
export interface InstanceSet {
  name: string;
  part: string;
  /** Prototype meshes in instance-local space (all share the transforms). */
  prototypes: MeshBuffer[];
  /** Column-major 4x4 matrices (three.js Matrix4.elements order), 16 floats per instance. */
  transforms: Float32Array;
  /** Optional linear rgb multiplier per instance. */
  tints: Float32Array | null;
  count: number;
  castShadow: boolean;
  receiveShadow: boolean;
  lod: number;
  motion: InstanceMotion | null;
  gate: StateGate | null;
}

/** Warm practical light (brazier, lantern, forge). Renderers cap the count by priority. */
export interface LocalLight {
  name: string;
  position: Vec3;
  /** sRGB hex. */
  color: string;
  /** Candela-like intensity for physically based point lights. */
  intensity: number;
  /** Metres beyond which the light contributes nothing. */
  range: number;
  /** 0 = steady, 1 = strong fire flicker. */
  flicker: number;
  /** Higher values survive a renderer's light cap first. */
  priority: number;
  gate: StateGate | null;
}

/** Oriented box for camera collision and precise landmark picking. */
export interface Collider {
  center: Vec3;
  halfExtents: Vec3;
  /** Yaw in radians (three.js rotation.y convention). */
  yaw: number;
  landmark: LandmarkId | null;
  /** Small props do not block the camera. */
  blocksCamera: boolean;
}

/** Regular height grid for camera clearance and placement queries (bilinear). */
export interface TerrainField {
  originX: number;
  originZ: number;
  cellSize: number;
  columns: number;
  rows: number;
  /** rows * columns heights, row-major, rows along +Z. */
  heights: Float32Array;
}

export function emptyBounds(): Bounds3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function boundsOfPositions(positions: Float32Array, out: Bounds3 = emptyBounds()): Bounds3 {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < out.min[0]) out.min[0] = x;
    if (y < out.min[1]) out.min[1] = y;
    if (z < out.min[2]) out.min[2] = z;
    if (x > out.max[0]) out.max[0] = x;
    if (y > out.max[1]) out.max[1] = y;
    if (z > out.max[2]) out.max[2] = z;
  }
  return out;
}

export function unionBounds(a: Bounds3, b: Bounds3): Bounds3 {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Bilinear terrain-field lookup (clamped at the edges). */
export function sampleField(f: TerrainField, x: number, z: number): number {
  let fx = (x - f.originX) / f.cellSize;
  let fz = (z - f.originZ) / f.cellSize;
  if (fx < 0) fx = 0;
  if (fz < 0) fz = 0;
  if (fx > f.columns - 1) fx = f.columns - 1;
  if (fz > f.rows - 1) fz = f.rows - 1;
  const c0 = Math.min(Math.floor(fx), f.columns - 2);
  const r0 = Math.min(Math.floor(fz), f.rows - 2);
  const tx = fx - c0;
  const tz = fz - r0;
  const i = r0 * f.columns + c0;
  const h = f.heights;
  const a = h[i] + (h[i + 1] - h[i]) * tx;
  const b = h[i + f.columns] + (h[i + f.columns + 1] - h[i + f.columns]) * tx;
  return a + (b - a) * tz;
}
