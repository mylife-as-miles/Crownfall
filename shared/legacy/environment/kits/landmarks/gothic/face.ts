// Face-local architecture for the landmark package: wall faces with real openings cut
// through the wall plane (reveals, receding orders, recessed glazing, doors or boards),
// tracery bars, hood moulds and sills, plus a per-vertex weathering field. Coordinates
// are local to one wall face: u runs along the face (to the right seen from outside),
// y is mass-local height, z points out of the wall (the wall plane is z = 0).

import { archOutline, box, noise2, offsetPolygon, panel } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";

export type ArchShape = "rect" | "pointed" | "lancet" | "round" | "segmental";
export type OpeningFill = "lit" | "dark" | "door" | "boarded" | "void" | "shutter";
export type TraceryKind = "none" | "mullion" | "two-light" | "three-light";

export interface FaceOpening {
  /** Centre along the face. */
  u: number;
  width: number;
  /** Sill (bottom) height. */
  sill: number;
  /** Total height from the sill to the apex. */
  height: number;
  shape: ArchShape;
  /** Reveal depth: how far the glazing, door or boards sit behind the wall plane. */
  depth: number;
  fill: OpeningFill;
  /** Lit-glass brightness multiplier (0.6–1.2). */
  light?: number;
  /** Outward widening of the reveal at the wall plane (splayed or moulded jambs). */
  splay?: number;
  /** Receding orders (portals): the splay steps back in this many stages. */
  orders?: number;
  tracery?: TraceryKind;
  /** Hood mould with label stops over the head. */
  hood?: boolean;
  /** Projecting drip sill under the opening. */
  sillDrip?: boolean;
  /** Opening that passes through a wall of this thickness (no glazing; inner face mirrored). */
  through?: number;
  /** Cut the hole only: no reveal, fill or dressing (the far side of a through-passage). */
  cutOnly?: boolean;
  /** Arch radius as a multiple of the width for pointed heads (1 = equilateral). */
  archK?: number;
}

export interface FaceMaterials {
  wall: string;
  dressing: string;
  glassLit: string;
  glassDark: string;
  door: string;
  boards: string;
  iron: string;
}

export interface FaceWallOptions {
  length: number;
  bottom: number;
  /** Top of the wall at u (constant for eave walls, a gable line for end walls). */
  top: (u: number) => number;
  /** Kink of the top line (gable apex), if any. */
  apexU?: number;
  openings: readonly FaceOpening[];
  mats: FaceMaterials;
  /** Cell size for vertex-colour detail (0 = no subdivision). */
  cell: number;
  /** Arch segments per side. */
  segments: number;
  /** Per-vertex colour multiplier (weathering); defaults to 1. */
  tint?: (u: number, y: number) => readonly [number, number, number];
  /** Tracery and hood detail allowed. */
  detail: 0 | 1 | 2;
}

const ONE: readonly [number, number, number] = [1, 1, 1];

/** Rise of an arch head above its springing for a given width. */
export function archRise(shape: ArchShape, w: number, k = 1): number {
  const hw = w / 2;
  switch (shape) {
    case "pointed": {
      const R = Math.max(0.5, k) * w;
      return Math.sqrt(Math.max(R * R - (R - hw) * (R - hw), 0));
    }
    case "lancet": {
      const R = 1.3 * w;
      return Math.sqrt(Math.max(R * R - (R - hw) * (R - hw), 0));
    }
    case "round":
      return hw;
    case "segmental":
      return w * 0.16;
    default:
      return 0;
  }
}

/**
 * Opening outline [u, y] from the sill centre, counter-clockwise seen from outside:
 * bottom-left, bottom-right, up the right jamb, over the head, ending at the left springing.
 */
export function openingOutline(shape: ArchShape, w: number, h: number, segments: number, archK = 1): P2[] {
  const hw = w / 2;
  const rise = Math.min(archRise(shape, w, archK), h * 0.92);
  if (shape === "rect" || rise <= 0.01) return [[-hw, 0], [hw, 0], [hw, h], [-hw, h]];
  const s = h - rise;
  if (shape === "segmental") {
    const R = (hw * hw + rise * rise) / (2 * rise);
    const cy = s + rise - R;
    const a0 = Math.atan2(s - cy, hw);
    const out: P2[] = [[-hw, 0], [hw, 0], [hw, s]];
    const n = Math.max(2, segments);
    for (let i = 1; i < n; i++) {
      const a = a0 + ((Math.PI - 2 * a0) * i) / n;
      out.push([Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    out.push([-hw, s]);
    return out;
  }
  const k = shape === "pointed" ? Math.max(0.5, archK) : shape === "lancet" ? 1.3 : 0.5;
  return archOutline(w, s, k, Math.max(2, segments));
}

/** The head chain of an outline from the left springing over the top to the right springing. */
export function headChain(outline: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (let i = outline.length - 1; i >= 2; i--) out.push(outline[i]);
  return out;
}

function clampBottom(pts: readonly P2[], y: number): P2[] {
  return pts.map((p) => [p[0], Math.max(y, p[1])] as P2);
}

function translate(pts: readonly P2[], du: number, dy: number): P2[] {
  return pts.map((p) => [p[0] + du, p[1] + dy] as P2);
}

interface Column {
  u0: number;
  u1: number;
  items: { o: FaceOpening; hole: P2[]; inner: P2[]; bottom: number; spring: number; top: number }[];
}

/** Sorted unique breakpoints. */
function uniqSorted(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || v - out[out.length - 1] > 1e-4) out.push(v);
  return out;
}

/**
 * Emits a wall face with its openings cut out. Rectangular regions are subdivided into
 * cells (shared breakpoints, so neighbouring regions meet without T-junction cracks) and
 * carry the weathering tint per vertex; arch heads and gable tops are triangulated panels.
 * Returns the opening outlines actually cut (for reveals and dressings).
 */
export function faceWall(b: MeshBuilder, o: FaceWallOptions): void {
  const L = o.length;
  const tint = o.tint ?? (() => ONE);
  const base = b.getColor();
  const cols: Column[] = [];
  // Group openings into columns by their hole extent at the wall plane.
  const placed: Column["items"] = [];
  for (const op of o.openings) {
    const outline = openingOutline(op.shape, op.width, op.height, o.segments, op.archK ?? 1);
    const splay = op.splay ?? 0;
    const inner = translate(outline, op.u, op.sill);
    const hole = splay > 0 ? translate(clampBottom(offsetPolygon(outline, splay), 0), op.u, op.sill) : inner;
    let minU = Infinity, maxU = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hole) {
      minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    if (minU < -L / 2 + 0.05 || maxU > L / 2 - 0.05 || minY < o.bottom - 1e-3) continue;
    if (maxY > Math.min(o.top(minU), o.top(maxU), o.top(op.u)) - 0.05) continue;
    const spring = hole[2][1];
    placed.push({ o: op, hole, inner, bottom: minY, spring, top: maxY });
  }
  // Openings whose hole extents overlap share one column (a door under a wider window).
  placed.sort((a, c) => a.hole[0][0] - c.hole[0][0]);
  for (const it of placed) {
    const u0 = it.hole[0][0], u1 = it.hole[1][0];
    const col = cols.find((c) => u0 < c.u1 - 1e-3 && u1 > c.u0 + 1e-3);
    if (col) {
      // Reject a vertical overlap with an opening already in the column.
      if (col.items.some((o) => it.bottom < o.top + 0.05 && it.top > o.bottom - 0.05)) continue;
      col.u0 = Math.min(col.u0, u0);
      col.u1 = Math.max(col.u1, u1);
      col.items.push(it);
    } else cols.push({ u0, u1, items: [it] });
  }
  // A widened column must not swallow a neighbour.
  for (let i = cols.length - 1; i > 0; i--) {
    const a = cols[i - 1], c = cols[i];
    if (a.u1 > c.u0 + 1e-3) {
      a.u0 = Math.min(a.u0, c.u0);
      a.u1 = Math.max(a.u1, c.u1);
      const ok = c.items.every((it) => !a.items.some((o) => it.bottom < o.top + 0.05 && it.top > o.bottom - 0.05));
      if (ok) a.items.push(...c.items);
      cols.splice(i, 1);
    }
  }
  cols.sort((a, c) => a.u0 - c.u0);
  for (const c of cols) c.items.sort((a, d) => a.bottom - d.bottom);
  // Shared horizontal breakpoints.
  const maxTop = Math.max(o.top(-L / 2), o.top(L / 2), o.apexU !== undefined ? o.top(o.apexU) : -Infinity, o.top(0));
  const ys: number[] = [o.bottom];
  if (o.cell > 0) for (let y = o.bottom + o.cell; y < maxTop - 0.05; y += o.cell) ys.push(y);
  for (const c of cols) for (const it of c.items) ys.push(it.bottom, it.spring, it.top);
  const Y = uniqSorted(ys);
  const vtx = (u: number, y: number): number => {
    const t = tint(u, y);
    b.color(base[0] * t[0], base[1] * t[1], base[2] * t[2]);
    return b.vertex(u, y, 0, 0, 0, 1);
  };
  // A region from u0 to u1 between y0 and y1 (y1 may exceed the top at some u: clipped as a panel).
  const region = (u0: number, u1: number, y0: number, y1: number | null): void => {
    if (u1 - u0 < 1e-4) return;
    const t0 = o.top(u0), t1 = o.top(u1);
    const kink = o.apexU !== undefined && o.apexU > u0 + 1e-4 && o.apexU < u1 - 1e-4 ? o.apexU : null;
    const tk = kink !== null ? o.top(kink) : Infinity;
    const yTop = y1 !== null ? y1 : Math.min(t0, t1, kink !== null ? tk : Infinity);
    // Rectangular part: rows from shared breakpoints, columns from cells.
    const nu = o.cell > 0 ? Math.max(1, Math.round((u1 - u0) / o.cell)) : 1;
    const us: number[] = [];
    for (let i = 0; i <= nu; i++) us.push(u0 + ((u1 - u0) * i) / nu);
    const rows = Y.filter((y) => y > y0 + 1e-4 && y < yTop - 1e-4);
    const rowY = [y0].concat(rows, [yTop]);
    if (yTop > y0 + 1e-4) {
      let prev: number[] | null = null;
      for (const y of rowY) {
        const cur = us.map((u) => vtx(u, y));
        if (prev) for (let i = 0; i < nu; i++) b.quad(prev[i], prev[i + 1], cur[i + 1], cur[i]);
        prev = cur;
      }
    }
    if (y1 !== null) return;
    // Sloped remainder under a gable line: a panel whose edges carry the breakpoints.
    const left = Y.filter((y) => y > yTop + 1e-4 && y < t0 - 1e-4);
    const right = Y.filter((y) => y > yTop + 1e-4 && y < t1 - 1e-4);
    if (t0 - yTop < 1e-3 && t1 - yTop < 1e-3 && kink === null) return;
    const poly: P2[] = [];
    for (const u of us) poly.push([u, yTop]);
    for (const y of right) poly.push([u1, y]);
    if (t1 > yTop + 1e-4) poly.push([u1, t1]);
    if (kink !== null) poly.push([kink, tk]);
    if (t0 > yTop + 1e-4) poly.push([u0, t0]);
    for (let i = left.length - 1; i >= 0; i--) poly.push([u0, left[i]]);
    const cu = (u0 + u1) / 2, cy = (yTop + Math.max(t0, t1)) / 2;
    const t = tint(cu, cy);
    b.color(base[0] * t[0], base[1] * t[1], base[2] * t[2]);
    panel(b, poly, [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  };
  let cursor = -L / 2;
  for (const c of cols) {
    region(cursor, c.u0, o.bottom, null);
    // Column pieces: below each opening, beside it where it is narrower than the column,
    // then its head up to the next opening or the top.
    let y = o.bottom;
    for (let k = 0; k < c.items.length; k++) {
      const it = c.items[k];
      region(c.u0, c.u1, y, it.bottom);
      const hl = it.hole[0][0], hr = it.hole[1][0];
      if (hl > c.u0 + 1e-4) region(c.u0, hl, it.bottom, it.spring);
      if (hr < c.u1 - 1e-4) region(hr, c.u1, it.bottom, it.spring);
      const next = k + 1 < c.items.length ? c.items[k + 1].bottom : null;
      const head = headChain(it.hole);
      const poly: P2[] = [];
      if (hl > c.u0 + 1e-4) poly.push([c.u0, it.spring]);
      for (const q of head) poly.push(q);
      if (hr < c.u1 - 1e-4) poly.push([c.u1, it.spring]);
      const yTopHere = next !== null ? next : null;
      const tR = yTopHere !== null ? yTopHere : o.top(c.u1);
      const tL = yTopHere !== null ? yTopHere : o.top(c.u0);
      for (const yy of Y) if (yy > it.spring + 1e-4 && yy < tR - 1e-4) poly.push([c.u1, yy]);
      poly.push([c.u1, tR]);
      if (yTopHere === null && o.apexU !== undefined && o.apexU > c.u0 + 1e-4 && o.apexU < c.u1 - 1e-4) poly.push([o.apexU, o.top(o.apexU)]);
      poly.push([c.u0, tL]);
      for (let i = Y.length - 1; i >= 0; i--) if (Y[i] > it.spring + 1e-4 && Y[i] < tL - 1e-4) poly.push([c.u0, Y[i]]);
      const t = tint((c.u0 + c.u1) / 2, (it.spring + tR) / 2);
      b.color(base[0] * t[0], base[1] * t[1], base[2] * t[2]);
      panel(b, poly, [0, 0, 0], [1, 0, 0], [0, 1, 0]);
      y = next !== null ? next : Infinity;
    }
    cursor = c.u1;
  }
  region(cursor, L / 2, o.bottom, null);
  b.color(base[0], base[1], base[2]);
  // Reveals, fills, tracery and dressings.
  for (const c of cols) for (const it of c.items) if (!it.o.cutOnly) openingDetail(b, it.o, it.hole, it.inner, o);
}

/**
 * Flat quad that is skipped when degenerate (collinear corners): a zero normal would turn
 * into NaN in the shader and spread through post-processing.
 */
export function quadSafe(
  b: MeshBuilder,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
): void {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = dx - ax, vy = dy - ay, vz = dz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const wx = cx - ax, wy = cy - ay, wz = cz - az;
  const mx = uy * wz - uz * wy, my = uz * wx - ux * wz, mz = ux * wy - uy * wx;
  if (nx * nx + ny * ny + nz * nz < 1e-10 && mx * mx + my * my + mz * mz < 1e-10) return;
  if (nx * nx + ny * ny + nz * nz < 1e-10) {
    // First corner pair collapsed: emit the remaining triangle with its own normal.
    b.flatTri(ax, ay, az, cx, cy, cz, dx, dy, dz);
    return;
  }
  b.flatQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
}

/** Reveal band between two outlines with matching point order (front at za, back at zb). */
export function revealBand(b: MeshBuilder, front: readonly P2[], back: readonly P2[], za: number, zb: number, skipBottom = false): void {
  const n = front.length;
  for (let i = 0; i < n; i++) {
    if (skipBottom && i === 0) continue;
    const j = (i + 1) % n;
    quadSafe(b, front[i][0], front[i][1], za, front[j][0], front[j][1], za, back[j][0], back[j][1], zb, back[i][0], back[i][1], zb);
  }
}

/** Flat ring facing +z between an outer and an inner outline with matching point order. */
export function ringFace(b: MeshBuilder, outer: readonly P2[], inner: readonly P2[], z: number): void {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quadSafe(b, outer[i][0], outer[i][1], z, outer[j][0], outer[j][1], z, inner[j][0], inner[j][1], z, inner[i][0], inner[i][1], z);
  }
}

/**
 * Bar along a polyline in the face plane between z0 (back) and z1 (front): front strip
 * and both sides. Closed polylines wrap. Used for tracery, hood moulds and label stops.
 */
export function barAlong(b: MeshBuilder, pts: readonly P2[], width: number, z0: number, z1: number, closed = false): void {
  const n = pts.length;
  if (n < 2) return;
  const hw = width / 2;
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    // Mitre: scale the normal by 1/cos(half angle) with a clamp.
    let k = 1;
    if ((closed || (i > 0 && i < n - 1))) {
      const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n], p = pts[i];
      const e0x = p[0] - a[0], e0y = p[1] - a[1], e1x = c[0] - p[0], e1y = c[1] - p[1];
      const l0 = Math.hypot(e0x, e0y) || 1, l1 = Math.hypot(e1x, e1y) || 1;
      const cos = (e0x * e1x + e0y * e1y) / (l0 * l1);
      k = Math.min(2, 1 / Math.max(0.35, Math.sqrt((1 + cos) / 2)));
    }
    const nx = -dy * hw * k, ny = dx * hw * k;
    L.push([pts[i][0] + nx, pts[i][1] + ny]);
    R.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    quadSafe(b, R[i][0], R[i][1], z1, R[j][0], R[j][1], z1, L[j][0], L[j][1], z1, L[i][0], L[i][1], z1);
    quadSafe(b, L[i][0], L[i][1], z1, L[j][0], L[j][1], z1, L[j][0], L[j][1], z0, L[i][0], L[i][1], z0);
    quadSafe(b, R[j][0], R[j][1], z1, R[i][0], R[i][1], z1, R[i][0], R[i][1], z0, R[j][0], R[j][1], z0);
  }
  if (!closed) {
    // End caps.
    quadSafe(b, L[0][0], L[0][1], z1, R[0][0], R[0][1], z1, R[0][0], R[0][1], z0, L[0][0], L[0][1], z0);
    const e = n - 1;
    quadSafe(b, R[e][0], R[e][1], z1, L[e][0], L[e][1], z1, L[e][0], L[e][1], z0, R[e][0], R[e][1], z0);
  }
}

function circlePts(cx: number, cy: number, r: number, seg: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Horizontal span of a convex outline at height y, or null. */
function spanAt(outline: readonly P2[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i], q = outline[(i + 1) % n];
    if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) continue;
    const t = (y - p[1]) / (q[1] - p[1]);
    const x = p[0] + (q[0] - p[0]) * t;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return hi > lo ? [lo, hi] : null;
}

/** Vertical span of a convex outline at u, or null. */
function heightAt(outline: readonly P2[], u: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i], q = outline[(i + 1) % n];
    if ((p[0] - u) * (q[0] - u) > 0 || p[0] === q[0]) continue;
    const t = (u - p[0]) / (q[0] - p[0]);
    const y = p[1] + (q[1] - p[1]) * t;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? [lo, hi] : null;
}

/** Leaded glazing: a lattice of thin came strips over the glass, clipped to the outline. */
export function leading(b: MeshBuilder, outline: readonly P2[], du: number, dy: number, z: number): void {
  let minU = Infinity, maxU = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outline) {
    minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const w = 0.028;
  const nu = Math.max(1, Math.round((maxU - minU) / du));
  for (let i = 1; i < nu; i++) {
    const u = minU + ((maxU - minU) * i) / nu;
    const s = heightAt(outline, u);
    if (!s) continue;
    quadSafe(b, u - w, s[0], z, u + w, s[0], z, u + w, s[1], z, u - w, s[1], z);
  }
  const ny = Math.max(1, Math.round((maxY - minY) / dy));
  for (let i = 1; i < ny; i++) {
    const y = minY + ((maxY - minY) * i) / ny;
    const s = spanAt(outline, y);
    if (!s) continue;
    quadSafe(b, s[0], y - w, z, s[1], y - w, z, s[1], y + w, z, s[0], y + w, z);
  }
}

/** Tracery bars in the plane just in front of the glazing. */
function tracery(b: MeshBuilder, op: FaceOpening, inner: readonly P2[], zBack: number, segments: number, detail: number): void {
  const kind = op.tracery ?? "none";
  if (kind === "none") return;
  const w = op.width;
  const bar = Math.max(0.07, Math.min(0.15, w * 0.055));
  const z0 = zBack + 0.01, z1 = zBack + Math.min(0.2, 0.06 + w * 0.05);
  const spring = inner[2][1] - op.sill;
  const sill = op.sill;
  const u = op.u;
  const lights = kind === "three-light" ? 3 : kind === "two-light" ? 2 : 2;
  // Mullions from sill to springing.
  for (let i = 1; i < lights; i++) {
    const x = u - w / 2 + (w * i) / lights;
    box(b, x, sill, (z0 + z1) / 2, bar, spring + (kind === "mullion" ? 0.02 : 0), z1 - z0);
  }
  if (kind === "mullion" || op.shape === "rect" || op.shape === "segmental") {
    if (op.shape === "rect" && op.height > 2.2) box(b, u, sill + op.height * 0.62, (z0 + z1) / 2, w, bar * 0.9, z1 - z0);
    return;
  }
  // Sub-arches over each light.
  const lw = (w - bar * (lights - 1)) / lights;
  let subApex = 0;
  for (let i = 0; i < lights; i++) {
    const cx = u - w / 2 + lw / 2 + i * (lw + bar);
    const sub = translate(openingOutline("pointed", lw, spring + archRise("pointed", lw), Math.max(2, segments - 1)), cx, sill);
    const chain = headChain(sub);
    barAlong(b, chain, bar * 0.85, z0, z1);
    subApex = Math.max(subApex, sill + spring + archRise("pointed", lw));
  }
  // An oculus (with a quatrefoil at high detail) in the head above the sub-arches.
  let apex = -Infinity;
  for (const p of inner) apex = Math.max(apex, p[1]);
  const room = apex - subApex;
  if (room > 0.45) {
    const r = Math.min(room * 0.36, w * 0.24);
    const cy = subApex + Math.max(r + bar * 0.4, room * 0.46);
    const seg = detail >= 2 ? 14 : 10;
    barAlong(b, circlePts(u, cy, r, seg), bar * 0.85, z0, z1, true);
    if (detail >= 2 && r > 0.28) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        barAlong(b, circlePts(u + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.36, 8), bar * 0.6, z0, z1, true);
      }
    }
  }
}

function openingDetail(b: MeshBuilder, op: FaceOpening, hole: readonly P2[], inner: readonly P2[], o: FaceWallOptions): void {
  const base = b.getColor();
  const m = o.mats;
  const through = op.through ?? 0;
  const depth = through > 0 ? through : op.depth;
  const orders = Math.max(0, Math.min(4, op.orders ?? 0));
  b.material(m.dressing);
  b.color(base[0] * 0.78, base[1] * 0.78, base[2] * 0.78);
  if (orders > 0 && (op.splay ?? 0) > 0) {
    // Receding orders: each steps back by an equal share of the splay and of the depth.
    const outline = translate(inner, -op.u, -op.sill);
    const splay = op.splay ?? 0;
    const step = Math.min(depth * 0.7, 0.32 * orders) / orders;
    let prev = hole as P2[];
    let z = 0;
    for (let k = 1; k <= orders; k++) {
      const off = splay * (1 - k / orders);
      const cur = off > 1e-4 ? translate(clampBottom(offsetPolygon(outline, off), 0), op.u, op.sill) : (inner as P2[]);
      b.color(base[0] * (0.95 - k * 0.06), base[1] * (0.95 - k * 0.06), base[2] * (0.95 - k * 0.06));
      ringFace(b, prev, cur, z);
      b.color(base[0] * 0.66, base[1] * 0.66, base[2] * 0.66);
      revealBand(b, cur, cur, z, z - step);
      prev = cur;
      z -= step;
    }
    revealBand(b, inner, inner, z, -depth);
  } else {
    revealBand(b, hole, inner, 0, -depth);
  }
  b.color(base[0], base[1], base[2]);
  // Fill.
  const fill = op.fill;
  if (through <= 0) {
    if (fill === "lit" || fill === "dark" || fill === "void") {
      b.material(fill === "lit" ? m.glassLit : m.glassDark);
      const k = fill === "lit" ? op.light ?? 1 : fill === "void" ? 0.2 : 1;
      b.color(k, k, k);
      panel(b, inner, [0, 0, -depth], [1, 0, 0], [0, 1, 0]);
      b.color(base[0], base[1], base[2]);
      if (fill !== "void") {
        if (o.detail >= 1 && op.width >= 0.6) {
          b.material(m.iron);
          leading(b, inner, op.width > 2.4 ? 0.42 : 0.34, 0.46, -depth + 0.006);
        }
        b.material(m.dressing);
        tracery(b, op, inner, -depth, o.segments, o.detail);
      }
    } else if (fill === "door") {
      b.material(m.door);
      panel(b, inner, [0, 0, -depth], [1, 0, 0], [0, 1, 0]);
      b.material(m.iron);
      const w = op.width;
      for (const t of [0.2, 0.55]) box(b, op.u, op.sill + op.height * t, -depth + 0.025, w * 0.92, 0.07, 0.05);
      if (w > 1.3) box(b, op.u, op.sill, -depth + 0.02, 0.05, op.height * 0.86, 0.04);
      box(b, op.u + w * 0.22, op.sill + 1.0, -depth + 0.05, 0.1, 0.1, 0.08);
    } else if (fill === "boarded" || fill === "shutter") {
      b.material(m.glassDark);
      b.color(0.35, 0.35, 0.35);
      panel(b, inner, [0, 0, -depth], [1, 0, 0], [0, 1, 0]);
      b.color(base[0], base[1], base[2]);
      b.material(m.boards);
      let top = -Infinity;
      for (const p of inner) top = Math.max(top, p[1]);
      const h = top - op.sill;
      if (fill === "boarded") {
        const n = Math.max(3, Math.round(h / 0.32));
        for (let i = 0; i < n; i++) box(b, op.u, op.sill + 0.1 + (i * (h - 0.3)) / n, -depth * 0.35, op.width + 0.22, 0.24, 0.05);
        box(b, op.u - op.width * 0.3, op.sill, -depth * 0.35 + 0.04, 0.12, h * 0.8, 0.04);
        box(b, op.u + op.width * 0.3, op.sill, -depth * 0.35 + 0.04, 0.12, h * 0.8, 0.04);
      } else {
        box(b, op.u - op.width * 0.25, op.sill, -depth + 0.06, op.width * 0.48, Math.min(h, op.height * 0.82), 0.05);
        box(b, op.u + op.width * 0.25, op.sill, -depth + 0.06, op.width * 0.48, Math.min(h, op.height * 0.82), 0.05);
      }
    }
  }
  // Dressings on the wall plane.
  b.material(m.dressing);
  if (op.hood && o.detail >= 1) {
    const outline = translate(hole, -op.u, -op.sill);
    const grown = translate(offsetPolygon(outline, 0.1), op.u, op.sill);
    const chain = headChain(grown);
    const drop = op.shape === "rect" ? 0.32 : 0.28;
    const first = chain[0], last = chain[chain.length - 1];
    const pts: P2[] = [[first[0], first[1] - drop] as P2];
    for (const q of chain) pts.push(q);
    pts.push([last[0], last[1] - drop]);
    barAlong(b, pts, 0.13, 0, 0.12);
    // Label stops.
    box(b, first[0], first[1] - drop - 0.16, 0.06, 0.2, 0.16, 0.14);
    box(b, last[0], last[1] - drop - 0.16, 0.06, 0.2, 0.16, 0.14);
  }
  if (op.sillDrip && through <= 0) {
    const u0 = hole[0][0], u1 = hole[1][0], y = hole[0][1];
    box(b, (u0 + u1) / 2, y - 0.12, 0.07, u1 - u0 + 0.2, 0.12, 0.14);
  }
  b.color(base[0], base[1], base[2]);
}

/**
 * Weathering field for a wall face: low-frequency mottling, rain streaks that run down
 * from openings and string courses, and an optional cool damp tint near the foot.
 */
export function weatherField(seed: number, openings: readonly FaceOpening[], o: { strength: number; dampTo?: number; northFace?: boolean }): (u: number, y: number) => readonly [number, number, number] {
  const out: [number, number, number] = [1, 1, 1];
  return (u: number, y: number) => {
    let k = 1 + 0.12 * o.strength * (noise2(u * 0.33 + seed * 0.13, y * 0.42, seed) * 2 - 1);
    k *= 1 - 0.13 * o.strength * Math.max(0, noise2(u * 2.1, y * 0.07, seed + 5) * 2 - 1);
    // Paler, cleaner courses high on the wall where rain washes it; darker toward the foot.
    k *= 1 + 0.05 * o.strength * Math.min(1, Math.max(0, (y - 2) / 8));
    for (const op of openings) {
      const half = op.width * 0.62;
      const du = Math.abs(u - op.u);
      if (du < half && y < op.sill && y > op.sill - 3.6) {
        const f = (1 - du / half) * (1 - (op.sill - y) / 3.6);
        k *= 1 - 0.28 * o.strength * f;
      }
    }
    let green = 0;
    if (o.dampTo !== undefined && y < o.dampTo) green = (1 - y / Math.max(o.dampTo, 0.01)) * (o.northFace ? 0.06 : 0.03) * o.strength;
    out[0] = k * (1 - green);
    out[1] = k * (1 + green * 0.6);
    out[2] = k * (1 - green * 0.4);
    return out;
  };
}
