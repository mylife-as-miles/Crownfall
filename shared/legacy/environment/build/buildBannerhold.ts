// buildBannerhold: the environment build entry. Blueprint + LegacySceneState +
// quality profile → typed-array meshes, instance sets, lights, life sources, agent
// bindings, state slots, colliders, landmarks, staging and stats. Pure and
// deterministic: the same input always yields byte-identical buffers.

import type { LegacySceneState } from "../../environment-contract";
import { LEGACY_LANDMARKS } from "../../environment-contract";
import type { LandmarkId, NationId } from "../../types";
import { createTerrainSampler, getBannerholdBlueprint } from "../blueprint";
import type { BannerholdBlueprint, CameraFraming, Vec3 as BpVec3 } from "../blueprint";
import { bakeMesh, boundsOfPositions, emptyBounds, sampleField, unionBounds } from "../kernel";
import type { Bounds3, Collider, InstanceSet, LocalLight, MeshBuffer, TerrainField } from "../kernel";
import { createMaterialLibrary } from "../materials";
import type { MaterialLibrary } from "../materials";
import { qualityProfile } from "../quality";
import type { EnvironmentQuality, QualityProfile } from "../quality";
import { buildTerrainField, createKitContext } from "../kits/context";
import type { FireSource, SmokeSource } from "../kits/context";
import { buildAgents, SLOT_SETS } from "../kits/figures/slots";
import type { AgentBinding, SlotLayout } from "../kits/figures/slots";
import { createFarField } from "../kits/landscape/terrain";
import { nationStyle } from "../kits/nations/style";
import { createDefaultRegistry } from "../kits/packages";
import type { KitRegistry } from "../kits/registry";
import { resolveSceneSlots, slotCapacities } from "./state";
import type { SceneSlotCounts, SlotCapacities } from "./state";

export interface LandmarkBuild {
  id: LandmarkId;
  label: string;
  anchor: BpVec3;
  pickCenter: BpVec3;
  pickRadius: number;
  cameraId: CameraFraming["id"];
  bounds: Bounds3;
}

export interface BuildStats {
  meshes: number;
  instanceSets: number;
  instances: number;
  /** Static meshes plus one draw per instanced prototype mesh (before shadows, sky and post). */
  drawCalls: number;
  triangles: number;
  vertices: number;
  materials: string[];
  trianglesByPart: Record<string, number>;
}

export interface EnvironmentBuild {
  version: 1;
  nationId: NationId;
  quality: QualityProfile;
  meshes: MeshBuffer[];
  instances: InstanceSet[];
  lights: LocalLight[];
  smoke: SmokeSource[];
  fires: FireSource[];
  agents: AgentBinding[];
  slots: SlotLayout;
  /** Slot counts for the state the build was made with (renderers re-resolve on setState). */
  initialSlots: SceneSlotCounts;
  slotCapacities: SlotCapacities;
  colliders: Collider[];
  field: TerrainField;
  landmarks: LandmarkBuild[];
  staging: {
    cameras: readonly CameraFraming[];
    observation: BannerholdBlueprint["observation"];
    atmosphere: BannerholdBlueprint["atmosphere"];
    vr: BannerholdBlueprint["vr"];
    /** World bounds of the detailed settlement (shadow camera fit). */
    settlementBounds: Bounds3;
    /** Named destinations (gate, manor, muster, residential, artisan, archive, herald, ceremonial). */
    destinations: BannerholdBlueprint["destinations"];
  };
  stats: BuildStats;
}

export interface BuildInput {
  blueprint?: BannerholdBlueprint;
  nationId?: NationId;
  state: LegacySceneState | null;
  quality: EnvironmentQuality;
  registry?: KitRegistry;
}

const UNBAKED = new Set(["terrain", "far-terrain", "glass-lit", "fire", "candle", "smoke", "water", "cloth-heraldry", "gilt", "bronze"]);

function bakeAll(meshes: MeshBuffer[], field: TerrainField, quality: QualityProfile, lib: MaterialLibrary, sunDir: [number, number, number]): void {
  const ground = (x: number, z: number): number => sampleField(field, x, z);
  for (const m of meshes) {
    if (UNBAKED.has(m.material)) continue;
    const def = lib.definitions.get(m.material);
    const shading = def ? def.shading : "standard";
    if (shading === "silhouette") {
      bakeMesh(m, { ground, variation: { amount: 0.08, scale: 0.01, seed: 5 } });
      continue;
    }
    bakeMesh(m, {
      ground,
      contact: { strength: m.part === "dressing" ? 0.3 : 0.42, height: 1.8 },
      skyOcclusion: 0.22,
      grime: m.part === "dressing" ? undefined : { strength: 0.22, height: 2.6, seed: 17 },
      variation: { amount: 0.07, scale: 0.06, seed: 23, warm: 0.03 },
      directional: quality.bakeDirectional ? { dir: sunDir, strength: 0.55, ambient: 0.7 } : undefined,
    });
  }
}

function sunDirection(bp: BannerholdBlueprint): [number, number, number] {
  const b = (bp.atmosphere.sun.bearingDeg * Math.PI) / 180;
  const e = (bp.atmosphere.sun.elevationDeg * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
}

function computeStats(meshes: MeshBuffer[], instances: InstanceSet[]): BuildStats {
  let draws = 0, tris = 0, verts = 0, inst = 0;
  const mats = new Set<string>();
  const byPart: Record<string, number> = {};
  for (const m of meshes) {
    draws++;
    const t = m.indices.length / 3;
    tris += t;
    verts += m.positions.length / 3;
    mats.add(m.material);
    byPart[m.part] = (byPart[m.part] ?? 0) + t;
  }
  for (const s of instances) {
    inst += s.count;
    for (const p of s.prototypes) {
      draws++;
      const t = (p.indices.length / 3) * s.count;
      tris += t;
      verts += (p.positions.length / 3) * s.count;
      mats.add(p.material);
      byPart[s.part] = (byPart[s.part] ?? 0) + t;
    }
  }
  return { meshes: meshes.length, instanceSets: instances.length, instances: inst, drawCalls: draws, triangles: tris, vertices: verts, materials: Array.from(mats).sort(), trianglesByPart: byPart };
}

export function buildBannerhold(input: BuildInput): EnvironmentBuild {
  const bp = input.blueprint ?? getBannerholdBlueprint(input.nationId ?? input.state?.nationId ?? "korvenia");
  const quality = qualityProfile(input.quality);
  const registry = input.registry ?? createDefaultRegistry();
  const terrain = createTerrainSampler(bp.terrain);
  const field = buildTerrainField(terrain, 1);
  const lib = createMaterialLibrary(bp.nationId);
  const far = createFarField(bp, terrain);
  const ctx = createKitContext({ bp, quality, style: nationStyle(bp.nationId), terrain, field, lib, far });
  const finished: MeshBuffer[] = [];
  // Landmark membership from the blueprint's landmark anchors.
  const landmarkOf = new Map<string, LandmarkId>();
  for (const l of bp.landmarks) for (const id of l.buildingIds) landmarkOf.set(id, l.id);
  const sites = registry.siteKits();
  for (const s of sites) if (s.order < 10) {
    const out = s.build(ctx);
    if (out) for (const m of out) finished.push(m);
  }
  for (const building of bp.buildings) {
    const kit = registry.buildingKit(building.kit);
    const lm = building.landmark ?? landmarkOf.get(building.id);
    kit(ctx, lm && !building.landmark ? { ...building, landmark: lm } : building);
  }
  for (const s of sites) if (s.order >= 10) {
    const out = s.build(ctx);
    if (out) for (const m of out) finished.push(m);
  }
  const agents = buildAgents(ctx);
  const built = ctx.b.finish();
  bakeAll(built, field, quality, lib, sunDirection(bp));
  const meshes = finished.concat(built);
  const instances = ctx.instances.finish();
  // Instance prototypes get light baking too (no ground contact in instance space).
  for (const s of instances) for (const p of s.prototypes) if (!UNBAKED.has(p.material) && quality.bakeDirectional) bakeMesh(p, { ground: () => -1000, directional: { dir: sunDirection(bp), strength: 0.5, ambient: 0.72 } });
  // Landmark bounds from their meshes.
  const lmBounds = new Map<LandmarkId, Bounds3>();
  for (const m of meshes) {
    if (!m.landmark) continue;
    const prev = lmBounds.get(m.landmark);
    lmBounds.set(m.landmark, prev ? unionBounds(prev, m.bounds) : { min: [...m.bounds.min] as [number, number, number], max: [...m.bounds.max] as [number, number, number] });
  }
  const landmarks: LandmarkBuild[] = bp.landmarks.map((l) => ({
    id: l.id,
    label: l.label,
    anchor: l.anchor,
    pickCenter: l.pickCenter,
    pickRadius: l.pickRadius,
    cameraId: l.cameraId,
    bounds: lmBounds.get(l.id) ?? { min: [l.pickCenter[0] - l.pickRadius, l.pickCenter[1] - l.pickRadius, l.pickCenter[2] - l.pickRadius], max: [l.pickCenter[0] + l.pickRadius, l.pickCenter[1] + l.pickRadius, l.pickCenter[2] + l.pickRadius] },
  }));
  landmarks.sort((a, b) => LEGACY_LANDMARKS.indexOf(a.id) - LEGACY_LANDMARKS.indexOf(b.id));
  // Settlement bounds: everything inside the settlement boundary's box, padded.
  let sb = emptyBounds();
  for (const m of meshes) if (m.part !== "terrain" && m.part !== "far-terrain" && m.part !== "outer" && m.part !== "skyline" && m.part !== "vegetation" && m.part !== "water") sb = unionBounds(sb, m.bounds);
  if (!Number.isFinite(sb.min[0])) sb = boundsOfPositions(new Float32Array([-60, 0, -60, 60, 30, 60]));
  return {
    version: 1,
    nationId: bp.nationId,
    quality,
    meshes,
    instances,
    lights: ctx.lights.slice().sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : 1)),
    smoke: ctx.smoke,
    fires: ctx.fires,
    agents,
    slots: SLOT_SETS,
    initialSlots: resolveSceneSlots(input.state, slotCapacities(bp)),
    slotCapacities: slotCapacities(bp),
    colliders: ctx.colliders,
    field,
    landmarks,
    staging: { cameras: bp.cameras, observation: bp.observation, atmosphere: bp.atmosphere, vr: bp.vr, settlementBounds: sb, destinations: bp.destinations },
    stats: computeStats(meshes, instances),
  };
}
