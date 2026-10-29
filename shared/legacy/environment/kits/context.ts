// Kit context: everything a kit needs to turn blueprint data into geometry, plus the
// collectors (instances, lights, colliders, life sources) the build entry gathers.
// Kits only append to the context; they never read each other's output.

import type { LandmarkId } from "../../types";
import { massPolygon, pointInPolygon, resolveBuildingBase, toLocal } from "../blueprint";
import type { BannerholdBlueprint, Building, BuildingMass, ResolvedBase, TerrainSampler, Vec2 } from "../blueprint";
import { MeshBuilder, mat4, mat4Compose, Rng, sampleField } from "../kernel";
import type { Collider, InstanceMotion, InstanceSet, LocalLight, MeshBuffer, StateGate, TerrainField, Vec3 } from "../kernel";
import type { MaterialLibrary } from "../materials";
import type { QualityProfile } from "../quality";
import type { NationStyle } from "./nations/style";

export interface PrototypeSpec {
  key: string;
  part: string;
  castShadow: boolean;
  receiveShadow: boolean;
  lod: number;
  motion: InstanceMotion | null;
  gate: StateGate | null;
  /** Builds the prototype meshes in instance-local space (called once). */
  build: () => MeshBuffer[];
}

interface ProtoEntry {
  spec: PrototypeSpec;
  transforms: number[];
  tints: number[] | null;
}

/** Collects instanced placements; one InstanceSet per prototype. */
export class InstanceCollector {
  private protos = new Map<string, ProtoEntry>();
  private m = mat4();

  define(spec: PrototypeSpec): void {
    if (!this.protos.has(spec.key)) this.protos.set(spec.key, { spec, transforms: [], tints: null });
  }

  has(key: string): boolean {
    return this.protos.has(key);
  }

  /** Adds an instance: translation, yaw (radians, three.js convention), uniform or per-axis scale, optional tint. */
  add(key: string, x: number, y: number, z: number, yaw = 0, scale = 1, tint: readonly [number, number, number] | null = null, sy?: number, pitch = 0, roll = 0): void {
    const e = this.protos.get(key);
    if (!e) throw new Error(`prototype ${key} is not defined`);
    mat4Compose(this.m, x, y, z, yaw, pitch, roll, scale, sy ?? scale, scale);
    for (let i = 0; i < 16; i++) e.transforms.push(this.m[i]);
    if (tint) {
      if (!e.tints) {
        e.tints = [];
        for (let i = 0; i < e.transforms.length / 16 - 1; i++) e.tints.push(1, 1, 1);
      }
      e.tints.push(tint[0], tint[1], tint[2]);
    } else if (e.tints) e.tints.push(1, 1, 1);
  }

  count(key: string): number {
    const e = this.protos.get(key);
    return e ? e.transforms.length / 16 : 0;
  }

  finish(): InstanceSet[] {
    const out: InstanceSet[] = [];
    const keys = Array.from(this.protos.keys()).sort();
    for (const key of keys) {
      const e = this.protos.get(key);
      if (!e || e.transforms.length === 0) continue;
      const s = e.spec;
      out.push({
        name: s.key,
        part: s.part,
        prototypes: s.build(),
        transforms: Float32Array.from(e.transforms),
        tints: e.tints ? Float32Array.from(e.tints) : null,
        count: e.transforms.length / 16,
        castShadow: s.castShadow,
        receiveShadow: s.receiveShadow,
        lod: s.lod,
        motion: s.motion,
        gate: s.gate,
      });
    }
    return out;
  }
}

export interface SmokeSource {
  id: string;
  position: Vec3;
  /** 0..1: chimney wisps to forge plumes. */
  strength: number;
  color: string;
  gate: StateGate | null;
}

export interface FireSource {
  id: string;
  position: Vec3;
  size: number;
  gate: StateGate | null;
}

interface MassEntry {
  buildingId: string;
  mass: BuildingMass;
  floorY: number;
  groundMin: number;
  polygon: Vec2[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Spatial lookup over every building mass (window occlusion, scatter rejection). */
export class MassIndex {
  readonly entries: MassEntry[] = [];

  add(buildingId: string, mass: BuildingMass, base: ResolvedBase): void {
    const polygon = massPolygon(mass);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    this.entries.push({ buildingId, mass, floorY: base.floorY, groundMin: base.groundMin, polygon, minX, maxX, minZ, maxZ });
  }

  /** True if the point lies inside another mass's solid (ignoring masses of `exceptMassOf` when given with `exceptMass`). */
  occupied(x: number, y: number, z: number, skip?: (buildingId: string, mass: BuildingMass) => boolean): boolean {
    for (const e of this.entries) {
      if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
      if (skip && skip(e.buildingId, e.mass)) continue;
      const base = e.floorY + (e.mass.baseOffset ?? 0);
      const bottom = (e.mass.baseOffset ?? 0) >= 2.5 ? base : Math.min(base, e.groundMin) - 0.5;
      if (y < bottom || y > base + e.mass.ridgeHeight) continue;
      if (pointInPolygon([x, z], e.polygon)) {
        if (y <= base + e.mass.eaveHeight) return true;
        // Above the eave only the roof volume counts; treat the middle half of the plan as solid.
        const l = toLocal([x, z], e.mass.center, e.mass.rotationDeg);
        const across = e.mass.roof.ridgeAxis === "x" ? Math.abs(l[1]) / (e.mass.depth / 2) : Math.abs(l[0]) / (e.mass.width / 2);
        const f = (base + e.mass.ridgeHeight - y) / Math.max(e.mass.ridgeHeight - e.mass.eaveHeight, 0.01);
        if (across <= f) return true;
      }
    }
    return false;
  }

  /** True if the plan point lies within any mass footprint (inflated by `pad`). */
  inFootprint(x: number, z: number, pad = 0): boolean {
    for (const e of this.entries) {
      if (x < e.minX - pad || x > e.maxX + pad || z < e.minZ - pad || z > e.maxZ + pad) continue;
      if (pad <= 0) {
        if (pointInPolygon([x, z], e.polygon)) return true;
      } else {
        const l = toLocal([x, z], e.mass.center, e.mass.rotationDeg);
        const hw = e.mass.width / 2 + pad, hd = e.mass.depth / 2 + pad;
        if ((e.mass.plan ?? "rect") === "rect" ? Math.abs(l[0]) <= hw && Math.abs(l[1]) <= hd : l[0] * l[0] + l[1] * l[1] <= hw * hw) return true;
      }
    }
    return false;
  }
}

export interface KitContext {
  readonly bp: BannerholdBlueprint;
  readonly quality: QualityProfile;
  readonly style: NationStyle;
  readonly terrain: TerrainSampler;
  /** Cached height grid over the blueprint terrain extents. */
  readonly field: TerrainField;
  /** Main mesh builder (static geometry). */
  readonly b: MeshBuilder;
  readonly lib: MaterialLibrary;
  readonly instances: InstanceCollector;
  readonly lights: LocalLight[];
  readonly colliders: Collider[];
  readonly smoke: SmokeSource[];
  readonly fires: FireSource[];
  readonly masses: MassIndex;
  /** Resolves a blueprint or kit material key to a library key. */
  mat(key: string): string;
  /** Deterministic stream for an element. */
  rng(key: string, salt?: number): Rng;
  base(building: Building): ResolvedBase;
  /** Fast ground height (bilinear field inside the extents, exact sampler outside). */
  ground(x: number, z: number): number;
  /** Adds an oriented collider box. */
  collider(center: Vec3, halfExtents: Vec3, yaw: number, landmark: LandmarkId | null, blocksCamera?: boolean): void;
}

export function buildTerrainField(sampler: TerrainSampler, cell: number): TerrainField {
  const e = sampler.model.extents;
  const columns = Math.floor((e.maxX - e.minX) / cell) + 1;
  const rows = Math.floor((e.maxZ - e.minZ) / cell) + 1;
  const heights = new Float32Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    const z = e.minZ + r * cell;
    for (let c = 0; c < columns; c++) heights[r * columns + c] = sampler.height(e.minX + c * cell, z);
  }
  return { originX: e.minX, originZ: e.minZ, cellSize: cell, columns, rows, heights };
}

export function createKitContext(opts: {
  bp: BannerholdBlueprint;
  quality: QualityProfile;
  style: NationStyle;
  terrain: TerrainSampler;
  field: TerrainField;
  lib: MaterialLibrary;
  /** Ground height outside the blueprint extents (far field). */
  far: (x: number, z: number) => number;
}): KitContext {
  const bases = new Map<string, ResolvedBase>();
  const masses = new MassIndex();
  const { bp, terrain, field, lib } = opts;
  const e = terrain.model.extents;
  const base = (bld: Building): ResolvedBase => {
    let r = bases.get(bld.id);
    if (!r) {
      r = resolveBuildingBase(terrain, bld);
      bases.set(bld.id, r);
    }
    return r;
  };
  for (const bld of bp.buildings) {
    const r = base(bld);
    for (const m of bld.masses) masses.add(bld.id, m, r);
  }
  const colliders: Collider[] = [];
  return {
    bp,
    quality: opts.quality,
    style: opts.style,
    terrain,
    field,
    b: new MeshBuilder(),
    lib,
    instances: new InstanceCollector(),
    lights: [],
    colliders,
    smoke: [],
    fires: [],
    masses,
    mat: (key: string) => lib.resolve(key),
    rng: (key: string, salt = 0) => Rng.fromKey(`${bp.nationId}:${key}`, salt),
    base,
    ground: (x: number, z: number) => (x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ ? sampleField(field, x, z) : opts.far(x, z)),
    collider: (center, halfExtents, yaw, landmark, blocksCamera = true) => {
      colliders.push({ center, halfExtents, yaw, landmark, blocksCamera });
    },
  };
}
