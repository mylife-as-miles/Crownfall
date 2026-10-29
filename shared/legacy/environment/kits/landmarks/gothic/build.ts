// Generic Gothic mass builder for the landmark package: a mass's faces with real
// openings, buttresses, string courses, parapets or parapet gables, plus its plinth and
// collider. Landmark kits describe each face (openings, buttress bays, gable or eave
// wall) and add their own roofs and storytelling detail.

import type { LandmarkId } from "../../../../types";
import { bevelPrism, chamferRect, hashString, rectOutline } from "../../../kernel";
import type { MeshBuilder } from "../../../kernel";
import type { Building, BuildingMass } from "../../../blueprint";
import type { KitContext } from "../../context";
import { massFrame } from "../../architecture";
import type { MassFrame } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import { faceWall, weatherField } from "./face";
import type { FaceMaterials, FaceOpening } from "./face";
import { buttress, corbelTable, enterFace, faceBlocked, gableCoping, massCollider, parapet, quoins, rectFaces, steppedPlinth } from "./mass";
import type { ButtressStage, Face } from "./mass";
import type { LandmarkLod } from "./index";

export interface ButtressSpec {
  u: number;
  width: number;
  stages: readonly ButtressStage[];
  pinnacle?: number;
}

export interface FaceSpec {
  openings?: readonly FaceOpening[];
  buttresses?: readonly ButtressSpec[];
  /** The face is a gable end: its top follows the roof line from eave to ridge. */
  gable?: { coping: boolean; finial: number } | null;
  /** Eave parapet on a moulded course (and corbel table when the LOD allows). */
  parapet?: { y0: number; y1: number; proj: number; thick: number; merlons?: { width: number; gap: number; height: number } | null } | null;
  /** Horizontal string courses (y values). */
  courses?: readonly number[];
  /** Dressed quoins at both vertical corners. */
  quoins?: boolean;
  /** Skip the wall itself (a party wall hidden against a neighbour). */
  hidden?: boolean;
  /** Wall material override for this face. */
  wall?: string;
  /** Tint multiplier for the whole face (lime-washed fronts). */
  wash?: readonly [number, number, number];
}

export interface GothicMassOptions {
  ctx: KitContext;
  building: Building;
  mass: BuildingMass;
  landmark: LandmarkId | null;
  lod: LandmarkLod;
  mats: FaceMaterials;
  /** Faces in rectFaces order: +Z, -Z, +X, -X (mass local). */
  faces: readonly (FaceSpec | null)[];
  plinth?: { material: string; steps: readonly { offset: number; top: number; bevel: number }[] } | null;
  /** Wall bottom (local y) where it disappears into the plinth. */
  wallBottom?: number;
  /** Top of the eave walls (defaults to the mass eave). */
  wallTop?: number;
  /** Collider height (defaults to the ridge). */
  colliderTop?: number;
  /** Extra per-mass work in the mass frame (roofs, crowns, attachments). */
  extra?: (b: MeshBuilder, f: MassFrame, faces: readonly Face[]) => void;
}

/** Builds one rectangular mass as authored Gothic architecture. Returns its frame. */
export function buildGothicMass(o: GothicMassOptions): MassFrame {
  const { ctx, building, mass, lod } = o;
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  const faces = rectFaces(f.w, f.d);
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const wallTop = o.wallTop ?? eave;
  const seed = hashString(`${building.id}:${mass.id}`) % 997;
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  const base = b.getColor();
  if (o.plinth && !f.elevated) steppedPlinth(b, chamferRect(f.w, f.d, 0.04), f.footY, o.plinth.steps, o.plinth.material);
  const bottom = o.wallBottom ?? (f.elevated ? 0 : f.footY);
  for (let i = 0; i < 4; i++) {
    const spec = o.faces[i];
    if (!spec) continue;
    const face = faces[i];
    const L = face.length;
    const gable = !!spec.gable;
    const a = L / 2;
    const top = gable ? (u: number) => eave + (ridge - eave) * Math.max(0, 1 - Math.abs(u) / a) : () => wallTop;
    enterFace(b, face);
    // Openings and buttresses hidden by neighbouring masses are skipped.
    const openings = (spec.openings ?? []).filter((op) => !faceBlocked(ctx, f, face, op.u, op.sill + Math.min(op.height * 0.5, 2)));
    const wash = spec.wash ?? [1, 1, 1];
    b.color(base[0] * wash[0], base[1] * wash[1], base[2] * wash[2]);
    if (!spec.hidden) {
      b.material(spec.wall ?? o.mats.wall);
      const field = lod.cell > 0 ? weatherField(seed + i * 31, openings, { strength: 1, dampTo: 1.6, northFace: face.nz < -0.5 }) : undefined;
      faceWall(b, { length: L, bottom, top, apexU: gable ? 0 : undefined, openings, mats: { ...o.mats, wall: spec.wall ?? o.mats.wall }, cell: lod.cell, segments: lod.segments, tint: field, detail: lod.ornament });
    } else if (openings.length) {
      // Hidden walls still carry their visible openings' dressings? No: skip entirely.
    }
    b.color(base[0], base[1], base[2]);
    if (spec.courses && lod.detail >= 1) {
      b.material(o.mats.dressing);
      for (const y of spec.courses) {
        // Courses break around openings (and stop at buttresses' faces by overlapping them).
        const cuts: [number, number][] = [];
        for (const op of openings) {
          const top = op.sill + op.height + (op.splay ?? 0) * 2 + 0.2;
          if (y + 0.17 < op.sill - 0.15 || y > top) continue;
          const half = op.width / 2 + (op.splay ?? 0) + 0.18;
          cuts.push([op.u - half, op.u + half]);
        }
        cuts.sort((p, q) => p[0] - q[0]);
        let from = -L / 2 - 0.12;
        const runs: [number, number][] = [];
        for (const c of cuts) {
          if (c[0] > from + 0.05) runs.push([from, c[0]]);
          from = Math.max(from, c[1]);
        }
        if (L / 2 + 0.12 > from + 0.05) runs.push([from, L / 2 + 0.12]);
        for (const r of runs) bevelPrism(b, rectOutline(r[1] - r[0], 0.26, (r[0] + r[1]) / 2, 0), y, y + 0.17, 0.08, { bottom: true });
      }
    }
    if (spec.quoins && lod.ornament >= 1) {
      const qTop = gable ? eave : wallTop;
      quoins(b, a, 1, Math.max(bottom, 0.5), qTop - 0.2, 0.42, o.mats.dressing, 0.02);
      quoins(b, -a, -1, Math.max(bottom, 0.5), qTop - 0.2, 0.42, o.mats.dressing, 0.02);
    }
    for (const bt of spec.buttresses ?? []) {
      if (faceBlocked(ctx, f, face, bt.u, 1.6, (bt.stages[0]?.depth ?? 0.6) + 0.35)) continue;
      buttress(b, { u: bt.u, width: bt.width, footY: f.footY, stages: bt.stages, slope: 1.2, wall: o.mats.wall, dressing: o.mats.dressing, pinnacle: bt.pinnacle, detail: lod.ornament });
    }
    if (spec.parapet) {
      const p = spec.parapet;
      if (lod.corbels) corbelTable(b, -a + 0.2, a - 0.2, p.y0 - 0.2, p.proj + 0.04, 0.62, o.mats.dressing);
      parapet(b, { u0: -a - (p.proj > 0 ? p.proj : 0), u1: a + (p.proj > 0 ? p.proj : 0), y0: p.y0, y1: p.y1, proj: p.proj, thick: p.thick, wall: spec.wall ?? o.mats.wall, coping: o.mats.dressing, merlons: p.merlons ?? null });
    }
    if (gable && spec.gable && spec.gable.coping) {
      gableCoping(b, { a, eave, ridge, proud: 0.16, thick: 0.62, rise: 0.38, material: o.mats.dressing, finial: spec.gable.finial, detail: lod.ornament });
    }
    b.pop();
  }
  if (o.extra) o.extra(b, f, faces);
  b.pop();
  massCollider(ctx, f, o.landmark, o.colliderTop ?? ridge);
  return f;
}
