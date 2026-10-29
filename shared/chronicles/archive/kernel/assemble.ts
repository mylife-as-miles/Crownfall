// Assembles the archive from its blueprint: every element and artifact is
// built by its kernel form, placed (once or per instance), and merged per
// material into static batches; small repeats (balusters) come out as
// instanced prototypes. The build is a generator, so each platform can spread
// it across frames; running it to the end in one go gives the same result.
// The Living Atlas relief and the monument's plinth are built per platform by
// the monument modules (relief.ts and plinthForm), not here.

import { ARCHIVE_ZONES, type ArchiveBlueprint, type ArchiveQuality, type ArchiveZone, type ArchitecturalElement, type MechanismRing } from "../types";
import { RELIEF_ASPECT, RELIEF_LEVELS, RELIEF_SLAB } from "../relief";
import { ringPoint } from "../space";
import {
  arcadeArchForm, balusterForm, bayForm, chamberMouldingForm, daisForm, dialForm, floorForm, galleryForm, lampSconceForm, lampStandForm, oculusRingForm,
  oculusTraceryForm, pierForm, plinthForm, ringBandForm, skyDiscForm, steleForm, suspensionRodsForm, vaultRibsForm, vaultShellForm, type FormContext,
  type FormGeometry, type PlinthSpec,
} from "./forms";
import { eulerMatrix, MeshWriter, rotateMesh, transformMesh, type MeshBuffer } from "./mesh";
import type { P3 } from "./primitives";

/** One static batch: every surface of one material, merged in archive space. */
export interface ArchiveBatch {
  materialId: string;
  castShadow: boolean;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Index into ARCHIVE_ZONES per vertex. */
  zones: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** A small prototype drawn once per instance (balusters). */
export interface ArchiveInstanced {
  id: string;
  materialIds: readonly string[];
  prototype: MeshBuffer;
  /** Per instance: position x, y, z and yaw. */
  placements: Float32Array;
  zones: Float32Array;
  count: number;
}

export interface ArchiveBuild {
  quality: ArchiveQuality;
  batches: ArchiveBatch[];
  instanced: ArchiveInstanced[];
  triangles: number;
  vertices: number;
  /** Triangles per element or artifact id, for budgets and contact sheets. */
  perElement: Record<string, number>;
}

/** Geometry budgets per tier for everything this module builds (the relief and plinth come on top). */
export const ARCHIVE_GEOMETRY_BUDGET: Readonly<Record<ArchiveQuality, number>> = { quest: 150000, low: 200000, medium: 640000, high: 1000000 };

interface Pending {
  positions: number[];
  normals: number[];
  uvs: number[];
  zones: number[];
  indices: number[];
}

const zoneIndex = (zone: ArchiveZone) => ARCHIVE_ZONES.indexOf(zone);

/** The form for an element or artifact builder id, as a generator writing into the context's writer. */
function formFor(builder: string, params: Readonly<Record<string, number | string | boolean>>, blueprint: ArchiveBlueprint, ctx: FormContext, ringId?: string): Generator<void, void, void> | null {
  const g = ctx.geometry;
  const num = (key: string, fallback: number) => (typeof params[key] === "number" ? (params[key] as number) : fallback);
  const str = (key: string, fallback: string) => (typeof params[key] === "string" ? (params[key] as string) : fallback);
  switch (builder) {
    case "floor": return floorForm(ctx, blueprint.chamber.sides);
    case "pier": return pierForm(ctx, params.niche === true);
    case "arcade-arch": return arcadeArchForm(ctx);
    case "octagon-moulding": return chamberMouldingForm(ctx, str("profile", "string") === "cornice" ? "cornice" : "string", num("y", g.levels.string), num("height", 0.3));
    case "gallery": return galleryForm(ctx);
    case "vault-shell": return vaultShellForm(ctx);
    case "vault-ribs": return vaultRibsForm(ctx);
    case "oculus-ring": return oculusRingForm(ctx, blueprint.chamber.oculus.radius);
    case "oculus-tracery": return oculusTraceryForm(ctx, blueprint.chamber.oculus.radius, blueprint.chamber.oculus.tracery);
    case "sky-disc": return skyDiscForm(ctx, blueprint.chamber.oculus.radius + 0.7);
    case "bay": return bayForm(ctx, num("depth", 6), str("back", "plain"), str("floor", "flat"), num("ribs", 0));
    case "lamp-stand": return lampStandForm(ctx, num("height", g.lampHeight));
    case "lamp-sconce": return lampSconceForm(ctx);
    case "suspension-rods": return suspensionRodsForm(ctx, blueprint.mechanism.rings, ringPoint, num("radius", 0.028));
    case "dial": return dialForm(ctx, num("radius", 1.7), num("rings", 5), num("ticks", 72), 0.32);
    case "dais": return daisForm(ctx, num("width", 5), num("depth", 4), num("height", 0.45), num("steps", 3), num("grid", 8));
    case "stele": return steleForm(ctx, num("width", 0.9), num("height", 2.3), num("depth", 0.34));
    case "ring-band": {
      const ring = blueprint.mechanism.rings.find((item) => item.id === ringId);
      if (!ring) return null;
      return (function* () { ringBandForm(ctx.writer, ctx.quality, ring); yield; })();
    }
    default: return null;
  }
}

/** Builder ids this kernel implements (the relief is the monument's own). */
export const ARCHIVE_BUILDERS = [
  "floor", "pier", "arcade-arch", "octagon-moulding", "gallery", "vault-shell", "vault-ribs", "oculus-ring", "oculus-tracery", "sky-disc", "bay",
  "lamp-stand", "lamp-sconce", "suspension-rods", "dial", "dais", "stele", "ring-band", "relief", "plinth",
] as const;

/**
 * The archive build in slices: each next() runs up to `grain` steps of the
 * forms, then yields the share done (monotonic, 0 to 1). The return value is
 * the finished build.
 */
export function* archiveBuildSlices(blueprint: ArchiveBlueprint, geometry: FormGeometry, quality: ArchiveQuality, grain = 1): Generator<number, ArchiveBuild, void> {
  const batches = new Map<string, Pending & { materialId: string; castShadow: boolean }>();
  const instancedPlacements = new Map<string, { placements: number[]; zones: number[]; materialIds: readonly string[] }>();
  const perElement: Record<string, number> = {};
  const jobs: { id: string; run: () => Generator<void, void, void> }[] = [];
  let steps = 0;
  const tick = function* (): Generator<number, void, void> {
    steps++;
    if (steps % Math.max(1, grain) === 0) yield progress;
  };
  let progress = 0;

  const merge = (mesh: MeshBuffer, materialIds: readonly string[], zone: ArchiveZone, castShadow: boolean, id: string) => {
    perElement[id] = (perElement[id] || 0) + mesh.triangleCount;
    for (const group of mesh.groups) {
      const materialId = materialIds[group.materialIndex] ?? materialIds[0];
      const key = `${materialId}|${castShadow ? 1 : 0}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, (batch = { materialId, castShadow, positions: [], normals: [], uvs: [], zones: [], indices: [] }));
      // Copy only the vertices this group uses, remapped.
      const remap = new Map<number, number>();
      for (let index = group.start; index < group.start + group.count; index++) {
        const vertex = mesh.indices[index];
        let mapped = remap.get(vertex);
        if (mapped === undefined) {
          mapped = batch.positions.length / 3;
          remap.set(vertex, mapped);
          batch.positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
          batch.normals.push(mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]);
          batch.uvs.push(mesh.uvs[vertex * 2], mesh.uvs[vertex * 2 + 1]);
          batch.zones.push(zoneIndex(zone));
        }
        batch.indices.push(mapped);
      }
    }
  };

  // Elements: build once, place per instance.
  for (const element of blueprint.elements) {
    if (!("builder" in element.mesh)) continue;
    const mesh = element.mesh;
    jobs.push({
      id: element.id,
      run: function* () {
        const writer = new MeshWriter();
        const local: { prototype: string; position: P3; yaw: number }[] = [];
        const ctx: FormContext = { writer, quality, geometry, instance: (prototype, position, yaw) => local.push({ prototype, position, yaw }) };
        const form = formFor(mesh.builder, mesh.params, blueprint, ctx);
        if (!form) throw new Error(`No kernel form for builder "${mesh.builder}" (${element.id})`);
        for (let step = form.next(); !step.done; step = form.next()) yield;
        const built = writer.build();
        const places = element.instances || [element.transform];
        for (const place of places) {
          merge(transformMesh(built, place.position, place.yaw, (place as ArchitecturalElement["transform"]).scale), element.materialIds, element.zone, !!element.castShadow, element.id);
          for (const copy of local) {
            const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
            const x = copy.position[0] * c + copy.position[2] * s + place.position[0];
            const z = -copy.position[0] * s + copy.position[2] * c + place.position[2];
            let entry = instancedPlacements.get(copy.prototype);
            if (!entry) instancedPlacements.set(copy.prototype, (entry = { placements: [], zones: [], materialIds: [element.materialIds[0]] }));
            entry.placements.push(x, copy.position[1] + place.position[1], z, copy.yaw + place.yaw);
            entry.zones.push(zoneIndex(element.zone));
          }
        }
      },
    });
  }
  // Artifacts: the relief belongs to the monument; rings take their place from the mechanism.
  for (const artifact of blueprint.artifacts) {
    if (!("builder" in artifact.mesh) || artifact.mesh.builder === "relief") continue;
    const mesh = artifact.mesh;
    jobs.push({
      id: artifact.id,
      run: function* () {
        const writer = new MeshWriter();
        const ctx: FormContext = { writer, quality, geometry };
        const form = formFor(mesh.builder, mesh.params || {}, blueprint, ctx, artifact.id);
        if (!form) throw new Error(`No kernel form for builder "${mesh.builder}" (${artifact.id})`);
        for (let step = form.next(); !step.done; step = form.next()) yield;
        const built = writer.build();
        if (artifact.kind === "ring") {
          const ring = blueprint.mechanism.rings.find((item) => item.id === artifact.id) as MechanismRing;
          merge(rotateMesh(built, eulerMatrix(ring.tilt[0], ring.tilt[1], ring.tilt[2]), ring.center), artifact.materialIds, artifact.zone, true, artifact.id);
        } else if (artifact.placement) {
          merge(transformMesh(built, artifact.placement.position, artifact.placement.yaw), artifact.materialIds, artifact.zone, false, artifact.id);
        }
      },
    });
  }

  for (let index = 0; index < jobs.length; index++) {
    const run = jobs[index].run();
    for (let step = run.next(); !step.done; step = run.next()) {
      progress = (index + 0.5) / jobs.length * 0.97;
      yield* tick();
    }
    progress = ((index + 1) / jobs.length) * 0.97;
    yield* tick();
  }

  // Instanced prototypes.
  const instanced: ArchiveInstanced[] = [];
  for (const [id, entry] of instancedPlacements) {
    const writer = new MeshWriter();
    if (id === "baluster") balusterForm(writer, quality);
    const prototype = writer.build();
    instanced.push({ id, materialIds: entry.materialIds, prototype, placements: Float32Array.from(entry.placements), zones: Float32Array.from(entry.zones), count: entry.placements.length / 4 });
    perElement[`instanced:${id}`] = prototype.triangleCount * (entry.placements.length / 4);
  }
  yield 0.985;

  const out: ArchiveBatch[] = [];
  for (const batch of [...batches.values()].sort((a, b) => (a.materialId + a.castShadow).localeCompare(b.materialId + b.castShadow))) {
    const vertexCount = batch.positions.length / 3;
    out.push({
      materialId: batch.materialId,
      castShadow: batch.castShadow,
      positions: Float32Array.from(batch.positions),
      normals: Float32Array.from(batch.normals),
      uvs: Float32Array.from(batch.uvs),
      zones: Float32Array.from(batch.zones),
      indices: vertexCount > 65535 ? Uint32Array.from(batch.indices) : Uint16Array.from(batch.indices),
      vertexCount,
      triangleCount: batch.indices.length / 3,
    });
  }
  const triangles = out.reduce((sum, batch) => sum + batch.triangleCount, 0) + instanced.reduce((sum, item) => sum + item.prototype.triangleCount * item.count, 0);
  const vertices = out.reduce((sum, batch) => sum + batch.vertexCount, 0) + instanced.reduce((sum, item) => sum + item.prototype.vertexCount * item.count, 0);
  yield 1;
  return { quality, batches: out, instanced, triangles, vertices, perElement };
}

/** The whole build at once. */
export function buildArchive(blueprint: ArchiveBlueprint, geometry: FormGeometry, quality: ArchiveQuality): ArchiveBuild {
  const slices = archiveBuildSlices(blueprint, geometry, quality, Infinity);
  let step = slices.next();
  while (!step.done) step = slices.next();
  return step.value;
}

/**
 * One element's or artifact's form in its own frame, before placement, for
 * contact sheets and previews. Instanced repeats (balusters) are not included;
 * build them with balusterForm. Returns null for the relief and asset meshes.
 */
export function buildArchiveForm(blueprint: ArchiveBlueprint, geometry: FormGeometry, quality: ArchiveQuality, id: string): MeshBuffer | null {
  const element = blueprint.elements.find((item) => item.id === id);
  const artifact = element ? undefined : blueprint.artifacts.find((item) => item.id === id);
  const mesh = element ? element.mesh : artifact?.mesh;
  if (!mesh || !("builder" in mesh) || mesh.builder === "relief") return null;
  const writer = new MeshWriter();
  const form = formFor(mesh.builder, mesh.params || {}, blueprint, { writer, quality, geometry, instance: () => undefined }, artifact?.id);
  if (!form) return null;
  for (let step = form.next(); !step.done; step = form.next()) { /* run to the end */ }
  return writer.build();
}

/**
 * The plinth around one platform's relief, from the blueprint's monument: the
 * desktop monument at full moulding scale, Quest's table-scale relief with its
 * mouldings reduced. Relief space y = 0 (sea level) sits at the rim plane less
 * the rim's rise.
 */
export function monumentPlinthSpec(blueprint: ArchiveBlueprint, platform: "desktop" | "quest", posture: "seated" | "standing" = "seated"): PlinthSpec {
  const m = blueprint.monument;
  const width = platform === "desktop" ? m.desktop.reliefWidth : m.quest.reliefWidth;
  const top = platform === "desktop" ? m.desktop.reliefTop : m.quest.reliefTop[posture];
  const sea = top - RELIEF_LEVELS.rim * width;
  const desktop = platform === "desktop";
  const scale = desktop ? 1 : 0.42;
  return {
    reliefWidth: width,
    reliefDepth: width * RELIEF_ASPECT,
    footY: sea + RELIEF_SLAB.base * width,
    slabMargin: RELIEF_SLAB.chamfer * width,
    margin: m.plinth.margin * (desktop ? 1 : 0.3),
    step: m.plinth.step * scale,
    stepHeight: m.plinth.stepHeight * scale,
    frameBand: m.frame.band * (desktop ? 1 : 0.5),
    frameRise: m.frame.rise,
    scale,
  };
}

/** The monument's plinth for one platform at its relief scale. Slots: 0 basalt, 1 carved stone, 2 bronze. */
export function buildPlinth(geometry: FormGeometry, quality: ArchiveQuality, spec: PlinthSpec): MeshBuffer {
  const writer = new MeshWriter();
  const form = plinthForm({ writer, quality, geometry }, spec);
  for (let step = form.next(); !step.done; step = form.next()) { /* run to the end */ }
  return writer.build();
}
