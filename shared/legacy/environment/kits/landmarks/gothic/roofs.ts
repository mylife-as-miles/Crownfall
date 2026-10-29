// Roof pieces for the landmark package: a thick gable roof without end triangles (the
// landmark kits build their own parapet gables), lead standing-seam rolls, ridge
// cresting, lucarnes, octagonal broach spires, the hall flèche with its bell lantern and
// corbelled bartizans. Mass-local coordinates along local Z unless stated.

import { box, chamferBox, extrudeXY, lathe, prism, circleOutline } from "../../../kernel";
import type { MeshBuilder } from "../../../kernel";

export interface SlopedRoofOptions {
  /** Half span across local X. */
  a: number;
  /** Length along local Z. */
  length: number;
  eave: number;
  ridge: number;
  overhang: number;
  /** Verge beyond each gable end (negative tucks the roof inside parapet gables). */
  verge: number;
  thickness: number;
  roof: string;
  soffit: string;
  ridgeCap: string;
  slopeTints?: readonly (readonly [number, number, number])[];
}

/** Two thick slopes with fascias, soffits, verges and a ridge cap; no gable triangles. */
export function slopedRoof(b: MeshBuilder, o: SlopedRoofOptions): void {
  const e = o.eave, r = o.ridge, a = o.a;
  const k = (r - e) / a;
  const t = o.thickness * Math.sqrt(1 + k * k);
  const xE = a + o.overhang, yE = e - o.overhang * k;
  const zF = o.length / 2 + o.verge, zB = -zF;
  const base = b.getColor();
  const prev = b.uvMode;
  b.material(o.roof);
  b.uvMode = "explicit";
  const slope = Math.hypot(xE, r - yE);
  const len = zF - zB;
  const tint = (i: number, fn: () => void): void => {
    const s = o.slopeTints?.[i];
    if (s) b.color(base[0] * s[0], base[1] * s[1], base[2] * s[2]);
    fn();
    b.color(base[0], base[1], base[2]);
  };
  tint(0, () => b.flatQuad(xE, yE, zF, xE, yE, zB, 0, r, zB, 0, r, zF, [len, 0, 0, 0, 0, slope, len, slope]));
  tint(1, () => b.flatQuad(-xE, yE, zB, -xE, yE, zF, 0, r, zF, 0, r, zB, [0, 0, len, 0, len, slope, 0, slope]));
  b.uvMode = "world";
  b.material(o.soffit);
  b.color(base[0] * 0.45, base[1] * 0.45, base[2] * 0.45);
  b.flatQuad(0, r - t, zF, 0, r - t, zB, xE, yE - t, zB, xE, yE - t, zF);
  b.flatQuad(0, r - t, zB, 0, r - t, zF, -xE, yE - t, zF, -xE, yE - t, zB);
  b.color(base[0], base[1], base[2]);
  b.material(o.roof);
  b.flatQuad(xE, yE, zB, xE, yE, zF, xE, yE - t, zF, xE, yE - t, zB);
  b.flatQuad(-xE, yE, zF, -xE, yE, zB, -xE, yE - t, zB, -xE, yE - t, zF);
  b.flatQuad(0, r - t, zF, xE, yE - t, zF, xE, yE, zF, 0, r, zF);
  b.flatQuad(-xE, yE - t, zF, 0, r - t, zF, 0, r, zF, -xE, yE, zF);
  b.flatQuad(xE, yE - t, zB, 0, r - t, zB, 0, r, zB, xE, yE, zB);
  b.flatQuad(0, r - t, zB, -xE, yE - t, zB, -xE, yE, zB, 0, r, zB);
  b.material(o.ridgeCap);
  b.push();
  b.transform(0, r - 0.04, 0, 0, 0, Math.PI / 4);
  box(b, 0, -0.12, 0, 0.24, 0.24, len + 0.04, { top: true });
  b.pop();
  b.uvMode = prev;
}

/** Lead rolls: raised seams running down both slopes at a fixed spacing along Z. */
export function leadRolls(b: MeshBuilder, o: { a: number; length: number; eave: number; ridge: number; overhang: number; spacing: number; material: string; margin: number }): void {
  const k = (o.ridge - o.eave) / o.a;
  const xE = o.a + o.overhang, yE = o.eave - o.overhang * k;
  const ang = Math.atan2(o.ridge - yE, xE);
  const sl = Math.hypot(xE, o.ridge - yE);
  b.material(o.material);
  const n = Math.max(1, Math.floor((o.length - 2 * o.margin) / o.spacing));
  for (let i = 0; i <= n; i++) {
    const z = -o.length / 2 + o.margin + (i * (o.length - 2 * o.margin)) / n;
    for (const s of [1, -1]) {
      b.push();
      b.transform((s * xE) / 2, (yE + o.ridge) / 2, z, 0, 0, s > 0 ? -ang : ang);
      box(b, 0, 0, 0, sl - 0.1, 0.055, 0.07, { top: true });
      b.pop();
    }
  }
}

/** Wrought-iron ridge cresting: a rail with spaced fleur finials (along local Z at height y). */
export function cresting(b: MeshBuilder, o: { length: number; y: number; spacing: number; height: number; material: string }): void {
  b.material(o.material);
  box(b, 0, o.y + o.height * 0.28, 0, 0.04, 0.05, o.length);
  const n = Math.max(2, Math.round(o.length / o.spacing));
  for (let i = 0; i <= n; i++) {
    const z = -o.length / 2 + (i * o.length) / n;
    box(b, 0, o.y, z, 0.035, o.height * 0.7, 0.035);
    b.push();
    b.translate(0, o.y + o.height * 0.55, z);
    lathe(b, [[0.01, 0], [0.07, o.height * 0.18], [0.01, o.height * 0.45]], 4, { smooth: false });
    b.pop();
  }
}

/**
 * Lucarne (small gabled roof opening) facing local +Z at the origin: cheeks and front in
 * `wall`, a louvred lancet in `louvre`, a steep little roof in `roof` with a finial.
 */
export function lucarne(b: MeshBuilder, o: { w: number; h: number; depth: number; wall: string; roof: string; louvre: string; trim: string }): void {
  const hw = o.w / 2;
  b.material(o.wall);
  box(b, 0, 0, -o.depth / 2, o.w, o.h, o.depth, { top: false });
  b.material(o.louvre);
  const n = 4;
  for (let i = 0; i < n; i++) box(b, 0, 0.2 + (i * (o.h - 0.4)) / n, 0.03, o.w * 0.55, 0.06, 0.05);
  b.material(o.roof);
  const rh = o.w * 0.95;
  extrudeXY(b, [[-hw - 0.1, o.h - 0.06], [hw + 0.1, o.h - 0.06], [0, o.h + rh]], -o.depth, 0.12);
  b.material(o.trim);
  b.push();
  b.translate(0, o.h + rh - 0.05, 0.06);
  lathe(b, [[0.06, 0], [0.03, 0.3], [0.008, 0.55]], 4, { smooth: false });
  b.pop();
}

/**
 * Octagonal spire from y0 to y1 with base radius r (circumradius), optional broaches that
 * carry it from a square base of half-side `square`, lucarnes on alternate faces and a
 * collar (or finial) at the tip.
 */
export function octagonalSpire(b: MeshBuilder, o: { y0: number; y1: number; r: number; square?: number; material: string; trim: string; lucarnes: boolean; finial: number; detail: number }): void {
  b.material(o.material);
  const ph = Math.PI / 8;
  const h = o.y1 - o.y0;
  lathe(b, [[o.r * 1.02, o.y0], [o.r * 0.9, o.y0 + h * 0.05], [o.r * 0.1, o.y0 + h * 0.9], [0.02, o.y1]], 8, { smooth: false, phase: ph });
  if (o.square && o.square > o.r * 0.7) {
    // Broaches: half-pyramids that carry each corner of the square base up onto the
    // spire's diagonal face (the octagon's axis faces touch the square's edges).
    const sq = o.square;
    const bh = h * 0.22;
    const t = (0.22 - 0.05) / 0.85;
    const apexR = (0.9 - 0.8 * t) * o.r * Math.cos(Math.PI / 8);
    const e = sq * (1 - Math.tan(Math.PI / 8)) / Math.SQRT2;
    const along = sq * (1 + Math.tan(Math.PI / 8)) / Math.SQRT2;
    for (let k = 0; k < 4; k++) {
      b.push();
      b.transform(0, 0, 0, Math.PI / 4 + (k * Math.PI) / 2);
      const cz = sq * Math.SQRT2;
      b.flatTri(-e, o.y0, along, 0, o.y0, cz, 0, o.y0 + bh, apexR);
      b.flatTri(0, o.y0, cz, e, o.y0, along, 0, o.y0 + bh, apexR);
      b.pop();
    }
  }
  if (o.lucarnes && o.detail >= 1) {
    const ly = o.y0 + h * 0.2;
    const lr = o.r * 0.82;
    for (let i = 0; i < 8; i += 2) {
      const a = ph + ((i + 0.5) / 8) * Math.PI * 2;
      b.push();
      b.transform(Math.sin(a) * lr, ly, Math.cos(a) * lr, a);
      b.material(o.material);
      box(b, 0, 0, -0.1, 0.6, 1.0, 0.5, { top: false });
      b.material(o.trim);
      box(b, 0, 0.15, 0.16, 0.3, 0.6, 0.02);
      b.material(o.material);
      extrudeXY(b, [[-0.38, 0.95], [0.38, 0.95], [0, 1.55]], -0.35, 0.18);
      b.pop();
    }
  }
  b.material(o.trim);
  b.push();
  b.translate(0, o.y1 - 0.15, 0);
  if (o.finial > 0) lathe(b, [[0.09, 0], [0.15, 0.25], [0.06, 0.45], [0.1, 0.75], [0.012, o.finial]], 6, { smooth: false });
  else lathe(b, [[0.12, 0], [0.16, 0.12], [0.1, 0.25]], 8, { smooth: true, capTop: true });
  b.pop();
}

/**
 * The hall flèche: an octagonal lead base astride the ridge, an open bell lantern of
 * slender posts with a bronze bell, a lead spirelet and a gilt cross-finial.
 */
export function fleche(b: MeshBuilder, o: { y0: number; baseTop: number; lanternTop: number; top: number; r: number; lead: string; post: string; bell: string | null; finial: string; detail: number }): void {
  const ph = Math.PI / 8;
  const R = o.r / Math.cos(Math.PI / 8);
  b.material(o.lead);
  prism(b, circleOutline(R, 8, ph), o.y0, o.baseTop, { top: true });
  prism(b, circleOutline(R + 0.1, 8, ph), o.baseTop, o.baseTop + 0.14, { top: true, bottom: true });
  b.material(o.post);
  for (let i = 0; i < 8; i++) {
    const a = ph + (i / 8) * Math.PI * 2;
    b.push();
    b.translate(Math.sin(a) * o.r * 0.9, o.baseTop + 0.14, Math.cos(a) * o.r * 0.9);
    box(b, 0, 0, 0, 0.11, o.lanternTop - o.baseTop - 0.14, 0.11);
    b.pop();
  }
  if (o.bell && o.detail >= 1) {
    b.material(o.bell);
    b.push();
    b.translate(0, o.baseTop + 0.35, 0);
    const h = (o.lanternTop - o.baseTop) * 0.62;
    lathe(b, [[o.r * 0.52, 0], [o.r * 0.46, h * 0.14], [o.r * 0.32, h * 0.6], [o.r * 0.3, h * 0.88], [0.04, h]], 10, { smooth: true });
    b.pop();
  }
  b.material(o.lead);
  prism(b, circleOutline(R + 0.12, 8, ph), o.lanternTop, o.lanternTop + 0.18, { top: true, bottom: true });
  lathe(b, [[R * 0.98, o.lanternTop + 0.18], [0.03, o.top]], 8, { smooth: false, phase: ph });
  b.material(o.finial);
  b.push();
  b.translate(0, o.top - 0.05, 0);
  lathe(b, [[0.06, 0], [0.11, 0.12], [0.05, 0.24]], 6, { smooth: true });
  box(b, 0, 0.2, 0, 0.05, 1.0, 0.05);
  box(b, 0, 0.82, 0, 0.42, 0.05, 0.05);
  b.pop();
}

/**
 * Corbelled bartizan: a round turret growing out of a corner on a corbel cone, with an
 * optional ring of arrow slits and a conical cap. Local origin at the turret axis.
 */
export function bartizan(b: MeshBuilder, o: { r: number; corbelY: number; baseY: number; topY: number; capTop: number; wall: string; cap: string; trim: string; segments: number }): void {
  b.material(o.wall);
  lathe(b, [[0.12, o.corbelY], [o.r * 0.65, o.corbelY + (o.baseY - o.corbelY) * 0.55], [o.r, o.baseY]], o.segments, { smooth: false });
  prism(b, circleOutline(o.r, o.segments, Math.PI / o.segments), o.baseY, o.topY, { smooth: true, top: true });
  b.material(o.cap);
  lathe(b, [[o.r + 0.12, o.topY - 0.06], [o.r * 0.55, o.topY + (o.capTop - o.topY) * 0.45], [0.03, o.capTop]], o.segments, { smooth: true });
  b.material(o.trim);
  b.push();
  b.translate(0, o.capTop - 0.05, 0);
  lathe(b, [[0.05, 0], [0.08, 0.15], [0.01, 0.6]], 4, { smooth: false });
  b.pop();
  void chamferBox;
}
