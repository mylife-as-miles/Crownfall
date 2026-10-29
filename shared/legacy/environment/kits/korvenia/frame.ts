// Timber-framed storeys for the production nation's houses: lime-plastered infill with real
// openings cut through it (shared face library), then exposed oak members proud of the
// plaster — sill beams, wall plates, posts, studs, rails, window jambs and braces — in a
// framing pattern chosen by the house's class and age. Gable infill, jetty bressumers,
// joist ends and brackets complete the frame. Face-local coordinates: u along the face
// (right seen from outside), y up from the storey floor, z out of the wall (plane z = 0).

import { box } from "../../kernel";
import type { MeshBuilder } from "../../kernel";
import { faceWall } from "../landmarks/gothic";
import type { FaceMaterials, FaceOpening } from "../landmarks/gothic";
import { beam } from "./geom";
import type { Rgb } from "./fabric";

export type FramePattern = "close" | "panel" | "braced" | "simple";

export interface FramedFace {
  length: number;
  height: number;
  openings: readonly FaceOpening[];
  pattern: FramePattern;
  mats: FaceMaterials;
  oak: string;
  /** Pale replacement timber (new-timber repairs). */
  oakNew: string;
  oakTint: Rgb;
  plasterTint: Rgb;
  /** Members to render in new pale timber (indices into the emitted member order). */
  newMembers: readonly number[];
  /** Exposed members (desktop); otherwise only the infill and its openings. */
  members: boolean;
  segments: number;
  detail: 0 | 1 | 2;
  /** Skip the sill beam (sits on a bressumer or a stone storey). */
  noSill?: boolean;
  /** Corner posts: false where a neighbouring face owns the corner. */
  corners?: boolean;
}

const MEMBER = 0.075;

/** Infill plane with cut openings and the exposed frame of one storey face. */
export function framedFace(b: MeshBuilder, o: FramedFace): void {
  const L = o.length, H = o.height;
  const base = b.getColor();
  b.color(base[0] * o.plasterTint[0], base[1] * o.plasterTint[1], base[2] * o.plasterTint[2]);
  b.material(o.mats.wall);
  faceWall(b, { length: L, bottom: 0, top: () => H, openings: o.openings, mats: o.mats, cell: 0, segments: o.segments, detail: o.detail });
  b.color(base[0], base[1], base[2]);
  if (!o.members) return;
  let index = 0;
  const mat = (): string => (o.newMembers.indexOf(index++) >= 0 ? o.oakNew : o.oak);
  b.color(base[0] * o.oakTint[0], base[1] * o.oakTint[1], base[2] * o.oakTint[2]);
  const zc = MEMBER / 2 - 0.02;
  const rail = (u0: number, u1: number, y: number, h = 0.16): void => {
    if (u1 - u0 < 0.05) return;
    b.material(mat());
    box(b, (u0 + u1) / 2, y, zc, u1 - u0, h, MEMBER);
  };
  const post = (u: number, y0: number, y1: number, w = 0.2): void => {
    if (y1 - y0 < 0.05) return;
    b.material(mat());
    box(b, u, y0, zc, w, y1 - y0, MEMBER);
  };
  const sill = o.noSill ? 0 : 0.18;
  if (!o.noSill) rail(-L / 2, L / 2, 0, sill);
  rail(-L / 2, L / 2, H - 0.18, 0.18);
  const y0 = sill, y1 = H - 0.18;
  const edge = L / 2 - 0.11;
  if (o.corners !== false) {
    post(-edge, y0, y1, 0.22);
    post(edge, y0, y1, 0.22);
  }
  // Openings claim their jambs, sill and head rails; studs avoid them.
  const spans: [number, number][] = [];
  for (const op of o.openings) {
    const half = op.width / 2 + 0.09;
    if (op.u - half < -L / 2 + 0.1 || op.u + half > L / 2 - 0.1) continue;
    spans.push([op.u - half, op.u + half]);
    post(op.u - op.width / 2 - 0.08, y0, y1, 0.16);
    post(op.u + op.width / 2 + 0.08, y0, y1, 0.16);
    if (op.sill > y0 + 0.2) rail(op.u - half, op.u + half, op.sill - 0.13, 0.13);
    const head = op.sill + op.height;
    if (head < y1 - 0.15) rail(op.u - half, op.u + half, head, 0.14);
  }
  const free = (u: number, w: number): boolean => {
    if (Math.abs(u) > edge - 0.2) return false;
    for (const s of spans) if (u + w / 2 > s[0] - 0.05 && u - w / 2 < s[1] + 0.05) return false;
    return true;
  };
  const spacing = o.pattern === "close" ? 0.48 : o.pattern === "simple" ? 1.6 : 1.15;
  const n = Math.max(1, Math.round((2 * edge) / spacing));
  const midY = o.pattern === "close" ? -1 : Math.min(y1 - 0.4, Math.max(y0 + 0.6, H * 0.46));
  for (let i = 1; i < n; i++) {
    const u = -edge + (2 * edge * i) / n;
    if (free(u, 0.17)) post(u, y0, y1, o.pattern === "close" ? 0.15 : 0.18);
    else {
      // Short studs under and over the openings keep the rhythm.
      for (const op of o.openings) {
        if (Math.abs(u - op.u) > op.width / 2 + 0.05) continue;
        if (op.sill - 0.13 > y0 + 0.25) post(u, y0, op.sill - 0.13, 0.13);
        const head = op.sill + op.height + 0.14;
        if (head < y1 - 0.25) post(u, head, y1, 0.13);
      }
    }
  }
  if (midY > 0) {
    // Mid rail between free stretches.
    const cuts = spans.slice().sort((a, c) => a[0] - c[0]);
    let from = -edge;
    for (const c of cuts) {
      rail(from, Math.max(from, c[0]), midY, 0.14);
      from = Math.max(from, c[1]);
    }
    rail(from, edge, midY, 0.14);
  }
  if (o.pattern === "braced" && H > 2.2) {
    // Long tension braces in the end panels, from the corner post foot toward the plate.
    for (const s of [-1, 1] as const) {
      const ua = s * (edge - 0.12), ub = s * (edge - Math.min(1.3, edge * 0.6));
      if (!free((ua + ub) / 2, Math.abs(ua - ub))) continue;
      b.material(mat());
      beam(b, [ua, y0 + 0.05, zc], [ub, y1 - 0.05, zc], 0.15, MEMBER);
    }
  }
  b.color(base[0], base[1], base[2]);
}

/** Gable infill above the eave plate with a king post, raking struts and studs. */
export function framedGable(b: MeshBuilder, o: { half: number; rise: number; openings: readonly FaceOpening[]; mats: FaceMaterials; oak: string; oakTint: Rgb; plasterTint: Rgb; members: boolean; segments: number; detail: 0 | 1 | 2 }): void {
  const a = o.half, R = o.rise;
  const top = (u: number): number => R * Math.max(0, 1 - Math.abs(u) / a);
  const base = b.getColor();
  b.color(base[0] * o.plasterTint[0], base[1] * o.plasterTint[1], base[2] * o.plasterTint[2]);
  b.material(o.mats.wall);
  faceWall(b, { length: 2 * a, bottom: 0, top, apexU: 0, openings: o.openings, mats: o.mats, cell: 0, segments: o.segments, detail: o.detail });
  b.color(base[0], base[1], base[2]);
  if (!o.members || R < 1.2) return;
  b.color(base[0] * o.oakTint[0], base[1] * o.oakTint[1], base[2] * o.oakTint[2]);
  b.material(o.oak);
  const zc = MEMBER / 2 - 0.02;
  const hasCentre = o.openings.some((op) => Math.abs(op.u) < op.width / 2 + 0.2);
  if (!hasCentre) box(b, 0, 0, zc, 0.2, R - 0.25, MEMBER);
  // Collar at two-thirds and studs under it, clipped to the gable line.
  const collarY = R * 0.55;
  const cu = a * (1 - collarY / R) - 0.12;
  if (cu > 0.4) box(b, 0, collarY, zc, 2 * cu, 0.15, MEMBER);
  for (const s of [-1, 1] as const) {
    for (let k = 1; k <= 2; k++) {
      const u = s * a * (k / 3);
      if (o.openings.some((op) => Math.abs(u - op.u) < op.width / 2 + 0.15)) continue;
      const t = Math.min(top(u), collarY) - 0.05;
      if (t > 0.3) box(b, u, 0.05, zc, 0.15, t - 0.05, MEMBER);
    }
    // Raking strut from the king post foot toward the rafter.
    beam(b, [s * 0.15, 0.1, zc], [s * a * 0.62, Math.max(0.3, top(s * a * 0.62) - 0.15), zc], 0.14, MEMBER);
  }
  b.color(base[0], base[1], base[2]);
}

/**
 * Jetty line where an upper storey oversails the one below on a face of length L: a dark
 * soffit, joist ends, the moulded bressumer and curved-look brackets at the posts.
 * `over` is the projection; the lower face sits at z = 0 and the upper face at z = over.
 */
export function jettyLine(b: MeshBuilder, o: { length: number; y: number; over: number; oak: string; oakTint: Rgb; members: boolean }): void {
  const L = o.length, y = o.y, j = o.over;
  if (j < 0.05) return;
  const base = b.getColor();
  b.material(o.oak);
  b.color(base[0] * o.oakTint[0] * 0.62, base[1] * o.oakTint[1] * 0.62, base[2] * o.oakTint[2] * 0.62);
  b.flatQuad(-L / 2, y, j, L / 2, y, j, L / 2, y, 0, -L / 2, y, 0);
  b.color(base[0] * o.oakTint[0], base[1] * o.oakTint[1], base[2] * o.oakTint[2]);
  // Bressumer along the oversailing edge.
  box(b, 0, y - 0.24, j - 0.1, L + 0.04, 0.26, 0.22, { bottom: true });
  if (o.members) {
    const n = Math.max(2, Math.round(L / 0.62));
    for (let i = 0; i <= n; i++) {
      const u = -L / 2 + 0.12 + ((L - 0.24) * i) / n;
      box(b, u, y - 0.36, j * 0.5 - 0.05, 0.11, 0.12, j + 0.02, { bottom: true });
    }
    for (const u of [-L / 2 + 0.12, L / 2 - 0.12]) beam(b, [u, y - 1.05, 0.03], [u, y - 0.24, j - 0.16], 0.14, 0.12);
    if (L > 5) beam(b, [0, y - 0.95, 0.03], [0, y - 0.24, j - 0.16], 0.13, 0.11);
  }
  b.color(base[0], base[1], base[2]);
}
