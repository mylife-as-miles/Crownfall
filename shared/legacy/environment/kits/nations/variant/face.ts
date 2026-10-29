// Wall faces with real cut openings for the nation-variant kits. Coordinates are local to one
// face: u runs along the face (to the right seen from outside), y is mass-local height and z
// points out of the wall (the wall plane is z = 0). Openings are holes: the wall is built as
// columns around them, arched heads get spandrel panels, and every opening has reveals of its
// own depth with the glazing, door, lattice or boards set back inside. No hole triangulation
// is needed, so the output is cheap and robust.

import { box, offsetPolygon, panel } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";

export type OpeningShape = "rect" | "round" | "pointed" | "segmental";
export type OpeningFill = "lit" | "dark" | "door" | "boarded" | "void" | "shutter" | "lattice" | "grille" | "roller" | "niche" | "none";

export interface Opening {
  /** Centre along the face. */
  u: number;
  width: number;
  /** Bottom of the opening (doors: the wall bottom). */
  sill: number;
  /** Height from the sill to the top of the head. */
  height: number;
  shape: OpeningShape;
  /** Reveal depth (how far the fill sits behind the wall plane). */
  depth: number;
  fill: OpeningFill;
  /** Brightness of lit glazing (0.5–1.3). */
  light?: number;
  /** Projecting surround width (0 or absent: none). */
  frame?: number;
  /** Surround projection. */
  proud?: number;
  /** Pointed heads: arc radius as a multiple of the width (0.5 round … 1 equilateral). */
  archK?: number;
  /** Projecting sill under a window. */
  sillProud?: number;
}

export interface FaceMats {
  wall: string;
  frame: string;
  lit: string;
  dark: string;
  door: string;
  boards: string;
  lattice: string;
  void: string;
}

export interface FaceSpec {
  length: number;
  bottom: number;
  top: number;
  openings: readonly Opening[];
  mats: FaceMats;
  /** Arch segments per side. */
  arch: number;
  detail: 0 | 1 | 2;
  /** Extra horizontal splits of the wall (vertex rows for baked contact light). */
  rows?: readonly number[];
}

/** Rise of a head above its springing line. */
export function headRise(shape: OpeningShape, w: number, k = 0.75): number {
  const hw = w / 2;
  if (shape === "round") return hw;
  if (shape === "segmental") return w * 0.16;
  if (shape === "pointed") {
    const R = Math.max(k, 0.5) * w;
    return Math.sqrt(Math.max(R * R - (R - hw) * (R - hw), 0));
  }
  return 0;
}

/** Head points from the right springing over the top to the left springing (inclusive). */
export function headPoints(shape: OpeningShape, ua: number, ub: number, spring: number, n: number, k = 0.75): P2[] {
  const w = ub - ua, hw = w / 2, u = (ua + ub) / 2;
  const out: P2[] = [];
  if (shape === "rect") return [[ub, spring], [ua, spring]];
  if (shape === "round") {
    const m = Math.max(2, n * 2);
    for (let i = 0; i <= m; i++) {
      const a = (Math.PI * i) / m;
      out.push([u + Math.cos(a) * hw, spring + Math.sin(a) * hw]);
    }
    return out;
  }
  if (shape === "segmental") {
    const rise = headRise(shape, w);
    const R = (hw * hw + rise * rise) / (2 * rise);
    const cy = spring + rise - R;
    const a0 = Math.atan2(spring - cy, hw);
    const m = Math.max(2, n * 2);
    for (let i = 0; i <= m; i++) {
      const a = a0 + ((Math.PI - 2 * a0) * i) / m;
      out.push([u + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    return out;
  }
  const R = Math.max(k, 0.5) * w;
  const th = Math.acos(Math.min(1, Math.max(-1, (R - hw) / R)));
  const m = Math.max(2, n);
  for (let i = 0; i <= m; i++) {
    const a = (th * i) / m;
    out.push([ub - R + Math.cos(a) * R, spring + Math.sin(a) * R]);
  }
  for (let i = m - 1; i >= 0; i--) {
    const a = (th * i) / m;
    out.push([ua + R - Math.cos(a) * R, spring + Math.sin(a) * R]);
  }
  return out;
}

/** Counter-clockwise outline of an opening in (u, y), starting at the bottom-left corner. */
export function openingOutline(o: Opening, arch: number): P2[] {
  const ua = o.u - o.width / 2, ub = o.u + o.width / 2;
  const rise = headRise(o.shape, o.width, o.archK);
  const spring = o.sill + Math.max(0.05, o.height - rise);
  const head = o.shape === "rect" ? [[ub, o.sill + o.height], [ua, o.sill + o.height]] as P2[] : headPoints(o.shape, ua, ub, spring, arch, o.archK);
  return ([[ua, o.sill], [ub, o.sill]] as P2[]).concat(head);
}

function wallQuad(b: MeshBuilder, u0: number, u1: number, y0: number, y1: number, rows: readonly number[]): void {
  if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
  let lo = y0;
  for (const r of rows) {
    if (r > lo + 0.05 && r < y1 - 0.05) {
      b.flatQuad(u0, lo, 0, u1, lo, 0, u1, r, 0, u0, r, 0);
      lo = r;
    }
  }
  b.flatQuad(u0, lo, 0, u1, lo, 0, u1, y1, 0, u0, y1, 0);
}

/** Thin flat strip facing +z (lattice bars, slats, seams), from (u0, y0) to (u1, y1) with width t. */
export function strip(b: MeshBuilder, u0: number, y0: number, u1: number, y1: number, t: number, z: number): void {
  const du = u1 - u0, dy = y1 - y0;
  const l = Math.sqrt(du * du + dy * dy) || 1;
  const nu = (-dy / l) * (t / 2), ny = (du / l) * (t / 2);
  b.flatQuad(u0 - nu, y0 - ny, z, u1 - nu, y1 - ny, z, u1 + nu, y1 + ny, z, u0 + nu, y0 + ny, z);
}

function fillOpening(b: MeshBuilder, o: Opening, outline: readonly P2[], mats: FaceMats, detail: 0 | 1 | 2): void {
  const prev = b.getColor();
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const d = -o.depth;
  const ua = o.u - o.width / 2, ub = o.u + o.width / 2;
  const rise = headRise(o.shape, o.width, o.archK);
  const spring = o.sill + Math.max(0.05, o.height - rise);
  switch (o.fill) {
    case "none":
      break;
    case "niche": {
      b.material(mats.wall).color(prev[0] * 0.62, prev[1] * 0.6, prev[2] * 0.58);
      b.uvMode = "world";
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      break;
    }
    case "lit": {
      const k = o.light ?? 1;
      b.material(mats.lit).color(k, k, k);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      break;
    }
    case "door":
    case "roller": {
      b.material(mats.door).color(prev[0], prev[1], prev[2]);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      if (detail >= 1) {
        b.color(prev[0] * 0.55, prev[1] * 0.55, prev[2] * 0.55);
        if (o.fill === "roller") for (let y = o.sill + 0.3; y < spring - 0.05; y += 0.3) strip(b, ua + 0.04, y, ub - 0.04, y, 0.035, d + 0.01);
        else strip(b, o.u, o.sill + 0.05, o.u, spring - 0.05, 0.04, d + 0.01);
      }
      break;
    }
    case "void": {
      b.material(mats.void).color(0.25, 0.24, 0.24);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      break;
    }
    case "shutter": {
      b.material(mats.boards).color(prev[0] * 0.9, prev[1] * 0.9, prev[2] * 0.9);
      panel(b, outline, [0, 0, Math.max(d, -0.08)], [1, 0, 0], [0, 1, 0]);
      if (detail >= 1) {
        b.color(prev[0] * 0.5, prev[1] * 0.5, prev[2] * 0.5);
        strip(b, o.u, o.sill + 0.03, o.u, spring, 0.04, Math.max(d, -0.08) + 0.01);
        for (let y = o.sill + 0.16; y < spring - 0.05; y += 0.16) strip(b, ua + 0.05, y, ub - 0.05, y, 0.025, Math.max(d, -0.08) + 0.01);
      }
      break;
    }
    case "boarded": {
      b.material(mats.dark).color(0.6, 0.6, 0.6);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      b.material(mats.boards).color(prev[0], prev[1], prev[2]);
      const planks = Math.max(2, Math.round((spring - o.sill) / 0.32));
      for (let i = 0; i < planks; i++) {
        const y = o.sill + ((i + 0.5) * (spring + rise * 0.5 - o.sill)) / planks;
        box(b, o.u, y - 0.09, 0.03, o.width + 0.24, 0.18, 0.04);
      }
      break;
    }
    case "lattice":
    case "grille": {
      b.material(mats.dark).color(0.75, 0.75, 0.75);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      if (detail >= 1) {
        b.material(o.fill === "lattice" ? mats.lattice : mats.frame).color(prev[0] * 0.85, prev[1] * 0.85, prev[2] * 0.85);
        const z = d * 0.3;
        const step = o.fill === "lattice" ? 0.16 : 0.12;
        const nu = Math.max(1, Math.round(o.width / step));
        for (let i = 1; i < nu; i++) strip(b, ua + (i * o.width) / nu, o.sill, ua + (i * o.width) / nu, spring, 0.035, z);
        const top = o.fill === "lattice" ? spring : spring;
        const nv = Math.max(1, Math.round((top - o.sill) / 0.18));
        for (let i = 1; i < nv; i++) strip(b, ua, o.sill + (i * (top - o.sill)) / nv, ub, o.sill + (i * (top - o.sill)) / nv, 0.035, z);
      }
      break;
    }
    default: {
      b.material(mats.dark).color(1, 1, 1);
      panel(b, outline, [0, 0, d], [1, 0, 0], [0, 1, 0]);
      if (detail >= 1 && o.width >= 0.8) {
        b.material(mats.frame).color(prev[0] * 0.8, prev[1] * 0.8, prev[2] * 0.8);
        strip(b, o.u, o.sill, o.u, spring, 0.05, d + 0.02);
      }
    }
  }
  b.color(prev[0], prev[1], prev[2]);
  b.uvMode = prevMode;
}

function surround(b: MeshBuilder, o: Opening, outline: readonly P2[], mat: string): void {
  const fw = o.frame ?? 0;
  if (fw <= 0) return;
  const z1 = o.proud ?? 0.06;
  const outer = offsetPolygon(outline, fw);
  const door = o.fill === "door" || o.fill === "roller";
  b.material(mat);
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    if (door && i === 0) continue;
    const p = outline[i], q = outline[(i + 1) % n];
    const po = outer[i], qo = outer[(i + 1) % n];
    b.flatQuad(p[0], p[1], z1, po[0], po[1], z1, qo[0], qo[1], z1, q[0], q[1], z1);
    b.flatQuad(qo[0], qo[1], z1, po[0], po[1], z1, po[0], po[1], 0, qo[0], qo[1], 0);
  }
  if (!door && (o.sillProud ?? 0) > 0) {
    const sp = o.sillProud ?? 0;
    box(b, o.u, o.sill - fw - 0.08, sp / 2, o.width + fw * 2 + 0.16, 0.1, sp + z1);
  }
}

/**
 * Builds one wall face with its openings. The caller positions the face (push a transform
 * to the face centre and yaw) and sets the part, gate, shadows and colour.
 */
export function faceWall(b: MeshBuilder, f: FaceSpec): void {
  const L = f.length, hl = L / 2;
  const rows = f.rows ?? [];
  const ops = f.openings.slice().sort((a, c) => a.u - c.u);
  const kept: Opening[] = [];
  let lastEnd = -hl + 0.05;
  for (const o of ops) {
    const ua = o.u - o.width / 2, ub = o.u + o.width / 2;
    if (ua < lastEnd || ub > hl - 0.05) continue;
    const top = Math.min(o.sill + o.height, f.top - 0.08);
    if (top - o.sill < 0.25) continue;
    kept.push(top < o.sill + o.height ? { ...o, height: top - o.sill } : o);
    lastEnd = ub + 0.08;
  }
  const prevMode = b.uvMode;
  b.uvMode = "world";
  const base = b.getColor();
  b.material(f.mats.wall);
  let u = -hl;
  for (const o of kept) {
    const ua = o.u - o.width / 2, ub = o.u + o.width / 2;
    wallQuad(b, u, ua, f.bottom, f.top, rows);
    const rise = headRise(o.shape, o.width, o.archK);
    const spring = o.sill + Math.max(0.05, o.height - rise);
    const apex = o.sill + o.height;
    if (o.sill > f.bottom + 0.005) wallQuad(b, ua, ub, f.bottom, o.sill, rows);
    if (rise > 0.001) {
      const head = headPoints(o.shape, ua, ub, spring, f.arch, o.archK);
      // Split the head at its apex (the point nearest the centre line) into right and left halves.
      let mid = 0, best = Infinity;
      for (let i = 0; i < head.length; i++) {
        const dd = Math.abs(head[i][0] - o.u);
        if (dd < best) { best = dd; mid = i; }
      }
      const right = head.slice(0, mid + 1);
      const left = head.slice(mid);
      panel(b, ([[ub, apex]] as P2[]).concat(right), [0, 0, 0], [1, 0, 0], [0, 1, 0]);
      panel(b, ([[ua, apex]] as P2[]).concat(left.slice().reverse()), [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    }
    if (apex < f.top - 0.005) wallQuad(b, ua, ub, apex, f.top, rows);
    u = ub;
  }
  wallQuad(b, u, hl, f.bottom, f.top, rows);
  for (const o of kept) {
    const outline = openingOutline(o, f.arch);
    // Reveals face into the opening, shaded as a recess.
    b.material(f.mats.wall).color(base[0] * 0.66, base[1] * 0.64, base[2] * 0.62);
    const n = outline.length;
    const door = o.fill === "door" || o.fill === "roller";
    for (let i = 0; i < n; i++) {
      if (door && i === 0) continue;
      const p = outline[i], q = outline[(i + 1) % n];
      b.flatQuad(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], -o.depth, p[0], p[1], -o.depth);
    }
    b.color(base[0], base[1], base[2]);
    fillOpening(b, o, outline, f.mats, f.detail);
    surround(b, o, outline, f.mats.frame);
    b.color(base[0], base[1], base[2]);
  }
  b.material(f.mats.wall);
  b.uvMode = prevMode;
}

/** Evenly spaced bay centres along a face of length L with an end margin. */
export function bays(L: number, bay: number, margin: number): number[] {
  const usable = L - 2 * margin;
  if (usable <= 0) return [];
  const n = Math.max(1, Math.floor(usable / bay));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-L / 2 + margin + ((i + 0.5) * usable) / n);
  return out;
}
