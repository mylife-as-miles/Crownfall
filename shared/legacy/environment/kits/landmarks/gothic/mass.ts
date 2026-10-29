// Massing and structure for the landmark package: face frames and occlusion probes,
// stepped plinths, buttresses with weathering set-offs, pinnacles, corbel tables,
// parapets, gable copings, quoins and per-mass colliders. Mass-local coordinates: the
// caller has pushed the mass transform (centre, floor, yaw); faces come from rectFaces.

import type { LandmarkId } from "../../../../types";
import { bevelPrism, box, chamferBox, chamferRect, extrudeXY, lathe, offsetPolygon, prism, rectOutline } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";
import type { BuildingMass } from "../../../blueprint";
import type { KitContext } from "../../context";
import { rectFaces, toWorld } from "../../architecture";
import type { Face, MassFrame } from "../../architecture";

export { rectFaces };
export type { Face, MassFrame };

/** Mass-local plan point of a face-local (u, z) point. */
export function faceToMass(face: Face, u: number, z: number): [number, number] {
  const rx = face.nz !== 0 ? face.nz : 0;
  const rz = face.nx !== 0 ? -face.nx : 0;
  return [face.cx + rx * u + face.nx * z, face.cz + rz * u + face.nz * z];
}

/** True when another mass (not `own`) occupies the point `out` metres in front of the face at (u, y). */
export function faceBlocked(ctx: KitContext, f: MassFrame, face: Face, u: number, y: number, out = 0.75, own: BuildingMass = f.mass): boolean {
  const l = faceToMass(face, u, out);
  const p = toWorld(f, l[0], l[1]);
  return ctx.masses.occupied(p[0], f.y0 + y, p[1], (bid, mm) => bid === f.building.id && mm === own);
}

/** Enters a face-local frame (u right seen from outside, z out of the wall). */
export function enterFace(b: MeshBuilder, face: Face, out = 0): void {
  b.push();
  b.transform(face.cx + face.nx * out, 0, face.cz + face.nz * out, face.yaw);
}

/** Stepped plinth: courses from the foundation bottom, each set back with a bevelled top. */
export function steppedPlinth(b: MeshBuilder, outline: readonly P2[], footY: number, steps: readonly { offset: number; top: number; bevel: number }[], material: string): void {
  b.material(material);
  let y = footY;
  for (const s of steps) {
    const o = s.offset !== 0 ? offsetPolygon(outline, s.offset) : outline.slice();
    bevelPrism(b, o, y, s.top, s.bevel);
    y = s.top - s.bevel;
  }
}

export interface ButtressStage {
  /** Projection from the wall face. */
  depth: number;
  /** Top of the stage (before its weathering). */
  top: number;
}

export interface ButtressOptions {
  u: number;
  width: number;
  footY: number;
  stages: readonly ButtressStage[];
  /** Weathering rise per metre of set-back. */
  slope: number;
  wall: string;
  dressing: string;
  /** Pinnacle on the last stage (height above its weathering), or 0. */
  pinnacle?: number;
  detail: number;
}

/**
 * Buttress in a face frame: stages that set back with sloped weathering caps in the
 * dressing stone, optionally crowned by a pinnacle. Profiles are extruded across the
 * buttress width (local Z of the rotated frame = -u).
 */
export function buttress(b: MeshBuilder, o: ButtressOptions): void {
  b.push();
  b.transform(o.u, 0, 0, -Math.PI / 2);
  const hw = o.width / 2;
  let y0 = o.footY;
  for (let i = 0; i < o.stages.length; i++) {
    const s = o.stages[i];
    const next = i + 1 < o.stages.length ? o.stages[i + 1].depth : 0;
    b.material(o.wall);
    extrudeXY(b, [[-0.04, y0], [s.depth, y0], [s.depth, s.top], [-0.04, s.top]], -hw, hw);
    const rise = Math.max(0.12, (s.depth - next) * o.slope);
    b.material(o.dressing);
    const ov = 0.035;
    extrudeXY(b, [[-0.04, s.top], [s.depth + ov, s.top], [s.depth + ov, s.top + 0.06], [next, s.top + rise], [-0.04, s.top + rise]], -hw - ov, hw + ov);
    y0 = s.top + rise * 0.5;
  }
  b.pop();
  const last = o.stages[o.stages.length - 1];
  if (o.pinnacle && o.pinnacle > 0.3) {
    const pw = Math.min(o.width * 0.72, last.depth * 1.1 + 0.2);
    pinnacle(b, o.u, last.top + 0.05, Math.max(pw * 0.5, last.depth * 0.5), pw, o.pinnacle, o.dressing, o.detail);
  }
}

/**
 * Pinnacle: chamfered shaft, gablets on each face (detail ≥ 1), a four-sided spirelet with
 * edge crockets (detail 2) and a finial. Placed in a face frame at (u, y, z).
 */
export function pinnacle(b: MeshBuilder, u: number, y: number, z: number, w: number, h: number, material: string, detail: number): void {
  b.material(material);
  const shaft = h * 0.4;
  chamferBox(b, u, y, z, w, shaft, w, w * 0.14);
  const hw = w / 2;
  if (detail >= 1) {
    for (let k = 0; k < 4; k++) {
      b.push();
      b.transform(u, y + shaft, z, (k * Math.PI) / 2);
      extrudeXY(b, [[-hw * 0.95, 0], [hw * 0.95, 0], [0, w * 0.75]], hw - 0.05, hw + 0.03);
      b.pop();
    }
  }
  b.push();
  b.translate(u, y + shaft, z);
  const r = hw * Math.SQRT2 * 0.84;
  lathe(b, [[r, 0], [r * 0.82, h * 0.1], [0.02, h * 0.56]], 4, { smooth: false, phase: Math.PI / 4 });
  if (detail >= 2) {
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      for (let j = 1; j <= 3; j++) {
        const t = j / 4.2;
        const rr = r * (0.82 * (1 - t)) + 0.04;
        b.push();
        b.transform(Math.sin(a) * rr, h * 0.1 + t * (h * 0.46), Math.cos(a) * rr, a, 0.6, 0);
        box(b, 0, -0.05, 0.03, 0.09, 0.1, 0.12);
        b.pop();
      }
    }
  }
  lathe(b, [[0.05, h * 0.55], [0.09, h * 0.6], [0.05, h * 0.66], [0.012, h * 0.7]], 6, { smooth: true });
  b.pop();
}

/** Corbel table in a face frame: small stepped corbels under a projecting course. */
export function corbelTable(b: MeshBuilder, u0: number, u1: number, y: number, proj: number, spacing: number, material: string): void {
  b.material(material);
  const n = Math.max(1, Math.round((u1 - u0) / spacing));
  for (let i = 0; i < n; i++) {
    const u = u0 + ((i + 0.5) * (u1 - u0)) / n;
    box(b, u, y - 0.42, proj * 0.25, 0.2, 0.2, proj * 0.5);
    box(b, u, y - 0.22, proj * 0.4, 0.22, 0.22, proj * 0.8);
  }
}

/**
 * Parapet along a face frame from u0 to u1: wall slab standing proud of the face by
 * `proj` on a moulded course, with a bevelled coping. Optional crenellation.
 */
export function parapet(b: MeshBuilder, o: { u0: number; u1: number; y0: number; y1: number; proj: number; thick: number; wall: string; coping: string; merlons?: { width: number; gap: number; height: number } | null; course?: boolean }): void {
  const len = o.u1 - o.u0;
  const cu = (o.u0 + o.u1) / 2;
  const zc = o.proj - o.thick / 2;
  b.material(o.wall);
  box(b, cu, o.y0, zc, len, o.y1 - o.y0, o.thick, { top: false, bottom: true });
  if (o.course !== false) {
    b.material(o.coping);
    bevelPrism(b, rectOutline(len + 0.04, 0.24, cu, o.proj - 0.08), o.y0 - 0.2, o.y0 + 0.02, 0.07, { bottom: true });
  }
  b.material(o.coping);
  bevelPrism(b, rectOutline(len + 0.06, o.thick + 0.1, cu, zc), o.y1, o.y1 + 0.16, 0.06);
  if (o.merlons) {
    const m = o.merlons;
    const n = Math.max(1, Math.floor((len + m.gap) / (m.width + m.gap)));
    const used = n * m.width + (n - 1) * m.gap;
    const start = o.u0 + (len - used) / 2 + m.width / 2;
    b.material(o.wall);
    for (let i = 0; i < n; i++) {
      const u = start + i * (m.width + m.gap);
      box(b, u, o.y1 + 0.16, zc, m.width, m.height - 0.16, o.thick, { top: false });
      b.material(o.coping);
      bevelPrism(b, rectOutline(m.width + 0.06, o.thick + 0.06, u, zc), o.y1 + m.height, o.y1 + m.height + 0.12, 0.05);
      b.material(o.wall);
    }
  }
}

/**
 * Gable coping in a face frame: a raking band proud of the gable line from the eave
 * kneelers to the apex, with a finial block. `a` is the half-span, eave and ridge local.
 */
export function gableCoping(b: MeshBuilder, o: { a: number; eave: number; ridge: number; proud: number; thick: number; rise: number; material: string; finial: number; detail: number }): void {
  b.material(o.material);
  const k = (o.ridge - o.eave) / o.a;
  // Kneelers.
  for (const s of [-1, 1]) chamferBox(b, s * (o.a - 0.15), o.eave - 0.45, -o.thick / 2 + o.proud, 0.62, 0.62 + o.rise, o.thick + 0.06, 0.05);
  // Raking copings: extruded along the rake as quads (top, outer edge and soffit).
  for (const s of [-1, 1]) {
    const x0 = s * (o.a + 0.08), y0 = o.eave + o.rise * 0.6;
    const x1 = 0, y1 = o.ridge + o.rise;
    const zf = o.proud, zb = o.proud - o.thick;
    // Top surface (slopes up toward the apex), normal up and outward along the rake.
    if (s > 0) {
      b.flatQuad(x0, y0, zf, x0, y0, zb, x1, y1, zb, x1, y1, zf);
      b.flatQuad(x1, y1 - 0.28, zf, x0, y0 - 0.28, zf, x0, y0, zf, x1, y1, zf);
      b.flatQuad(x0, y0 - 0.28, zb, x1, y1 - 0.28, zb, x1, y1, zb, x0, y0, zb);
      b.flatQuad(x1, y1 - 0.28, zb, x0, y0 - 0.28, zb, x0, y0 - 0.28, zf, x1, y1 - 0.28, zf);
    } else {
      b.flatQuad(x1, y1, zf, x1, y1, zb, x0, y0, zb, x0, y0, zf);
      b.flatQuad(x0, y0 - 0.28, zf, x1, y1 - 0.28, zf, x1, y1, zf, x0, y0, zf);
      b.flatQuad(x1, y1 - 0.28, zb, x0, y0 - 0.28, zb, x0, y0, zb, x1, y1, zb);
      b.flatQuad(x0, y0 - 0.28, zb, x1, y1 - 0.28, zb, x1, y1 - 0.28, zf, x0, y0 - 0.28, zf);
    }
    void k;
  }
  if (o.finial > 0) {
    b.push();
    b.translate(0, o.ridge + o.rise - 0.1, o.proud - o.thick / 2);
    chamferBox(b, 0, 0, 0, 0.42, 0.55, 0.42, 0.06);
    b.translate(0, 0.55, 0);
    lathe(b, [[0.24, 0], [0.16, o.finial * 0.25], [0.03, o.finial]], o.detail >= 1 ? 4 : 4, { smooth: false, phase: Math.PI / 4 });
    b.pop();
  }
}

/** Quoins on a vertical corner of a face frame (at u = edge): alternating long and short dressed blocks. */
export function quoins(b: MeshBuilder, edge: number, dir: 1 | -1, y0: number, y1: number, course: number, material: string, proud = 0.025): void {
  b.material(material);
  let i = 0;
  for (let y = y0; y + course * 0.5 < y1; y += course, i++) {
    const len = i % 2 === 0 ? 0.62 : 0.36;
    const h = Math.min(course - 0.02, y1 - y);
    if (h > 0.01) b.flatQuad(edge, y, proud, edge - dir * len, y, proud, edge - dir * len, y + h, proud, edge, y + h, proud);
    void chamferRect;
  }
}

/** Camera/picking collider over a mass (oriented box), as the architecture kit adds. */
export function massCollider(ctx: KitContext, f: MassFrame, landmark: LandmarkId | null, top: number, blocks = true): void {
  const bottom = f.elevated ? f.y0 : f.base.groundMin;
  const t = f.y0 + top;
  ctx.collider([f.cx, (bottom + t) / 2, f.cz], [f.w / 2 + 0.3, (t - bottom) / 2, f.d / 2 + 0.3], f.yaw, landmark, blocks);
}

/** Simple vertical prism helper re-exported for kits. */
export { prism, box, chamferBox, bevelPrism };
