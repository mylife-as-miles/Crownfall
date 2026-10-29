// Geometric primitives of the archive kernel: triangulation, bevelled boxes
// and prisms, lathes, mitred and smooth sweeps of moulding profiles, discs and
// rods, and arch curves. Everything writes into a MeshWriter in metres, with
// UVs in metres for tiling textures, and every face is wound to its normal.

import type { ArchiveQuality } from "../types";
import { MeshWriter } from "./mesh";
import { profileLengths, segmentEndNormals, type Profile } from "./profiles";
import { arcSegments, latheSegments } from "./quality";

export type P2 = readonly [number, number];
export type P3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Polygons

/** Shoelace area of a plan polygon (x, z); positive when it runs clockwise seen from above. */
export function signedArea(points: readonly P2[]): number {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    area += points[previous][0] * points[index][1] - points[index][0] * points[previous][1];
  }
  return area / 2;
}

/** Ear clipping of a simple polygon; returns triangles as index triples into `points`. */
export function triangulate(points: readonly P2[]): number[] {
  const count = points.length;
  if (count < 3) return [];
  const order = Array.from({ length: count }, (_, index) => index);
  if (signedArea(points) < 0) order.reverse();
  const out: number[] = [];
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = count * count;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let index = 0; index < order.length; index++) {
      const ia = order[(index + order.length - 1) % order.length], ib = order[index], ic = order[(index + 1) % order.length];
      const a = points[ia], b = points[ib], c = points[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      let blocked = false;
      for (const other of order) {
        if (other === ia || other === ib || other === ic) continue;
        if (inside(points[other], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      out.push(ia, ib, ic);
      order.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) out.push(order[0], order[1], order[2]);
  return out;
}

/** Offsets a convex or mildly concave polygon by `distance` toward its interior. */
export function insetPolygon(points: readonly P2[], distance: number): P2[] {
  const sign = signedArea(points) > 0 ? 1 : -1;
  const count = points.length, out: P2[] = [];
  for (let index = 0; index < count; index++) {
    const a = points[(index + count - 1) % count], b = points[index], c = points[(index + 1) % count];
    // Interior normals of the two edges meeting at b.
    const n1 = interiorNormal(a, b, sign), n2 = interiorNormal(b, c, sign);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const length = Math.hypot(mx, mz) || 1;
    mx /= length; mz /= length;
    const scale = Math.min(4, 1 / Math.max(0.25, mx * n1[0] + mz * n1[1]));
    out.push([b[0] + mx * distance * scale, b[1] + mz * distance * scale]);
  }
  return out;
}

function interiorNormal(a: P2, b: P2, sign: number): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
  // For a polygon with positive shoelace area the outward normal is (dz, -dx).
  return [(-dz / length) * sign, (dx / length) * sign];
}

// ---------------------------------------------------------------------------
// Boxes and prisms

/** A face from points in order, wound to `normal`. */
export function face(writer: MeshWriter, slot: number, points: readonly P3[], normal: P3, uvOrigin?: P3): void {
  writer.flatPolygon(slot, points, normal, uvOrigin);
}

/**
 * A box centred at (cx, cy, cz) with full extents (sx, sy, sz), every edge
 * chamfered by `bevel`. Closed: it is watertight by position.
 */
export function bevelBox(writer: MeshWriter, slot: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bevel = 0): void {
  const a = sx / 2, b = sy / 2, c = sz / 2, e = Math.max(0, Math.min(bevel, a * 0.49, b * 0.49, c * 0.49));
  const start = writer.vertexCount;
  const P = (x: number, y: number, z: number): P3 => [cx + x, cy + y, cz + z];
  // Main faces, inset by the bevel.
  for (const s of [-1, 1]) {
    face(writer, slot, [P(s * a, -(b - e), -(c - e)), P(s * a, b - e, -(c - e)), P(s * a, b - e, c - e), P(s * a, -(b - e), c - e)], [s, 0, 0]);
    face(writer, slot, [P(-(a - e), s * b, -(c - e)), P(a - e, s * b, -(c - e)), P(a - e, s * b, c - e), P(-(a - e), s * b, c - e)], [0, s, 0]);
    face(writer, slot, [P(-(a - e), -(b - e), s * c), P(a - e, -(b - e), s * c), P(a - e, b - e, s * c), P(-(a - e), b - e, s * c)], [0, 0, s]);
  }
  if (e > 0) {
    const r = Math.SQRT1_2, t = 1 / Math.sqrt(3);
    for (const s of [-1, 1]) for (const u of [-1, 1]) {
      // Edges along z, x and y.
      face(writer, slot, [P(s * a, u * (b - e), -(c - e)), P(s * (a - e), u * b, -(c - e)), P(s * (a - e), u * b, c - e), P(s * a, u * (b - e), c - e)], [s * r, u * r, 0]);
      face(writer, slot, [P(-(a - e), s * b, u * (c - e)), P(-(a - e), s * (b - e), u * c), P(a - e, s * (b - e), u * c), P(a - e, s * b, u * (c - e))], [0, s * r, u * r]);
      face(writer, slot, [P(s * a, -(b - e), u * (c - e)), P(s * (a - e), -(b - e), u * c), P(s * (a - e), b - e, u * c), P(s * a, b - e, u * (c - e))], [s * r, 0, u * r]);
      for (const w of [-1, 1]) face(writer, slot, [P(s * a, u * (b - e), w * (c - e)), P(s * (a - e), u * b, w * (c - e)), P(s * (a - e), u * (b - e), w * c)], [s * t, u * t, w * t]);
    }
  }
  void start;
}

/**
 * Extrudes a plan polygon (x, z) from y0 to y1 with flat walls; the top edge
 * may be chamfered by `bevel`. Closed when both caps are on.
 */
export function prism(writer: MeshWriter, slot: number, plan: readonly P2[], y0: number, y1: number, options: { bevel?: number; top?: boolean; bottom?: boolean; topSlot?: number } = {}): void {
  const { bevel = 0, top = true, bottom = true, topSlot = slot } = options;
  const sign = signedArea(plan) > 0 ? 1 : -1;
  const wallTop = bevel > 0 ? y1 - bevel : y1;
  const count = plan.length;
  for (let index = 0; index < count; index++) {
    const a = plan[index], b = plan[(index + 1) % count];
    const n = interiorNormal(a, b, sign);
    face(writer, slot, [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], wallTop, b[1]], [a[0], wallTop, a[1]]], [-n[0], 0, -n[1]]);
  }
  let upper: readonly P2[] = plan;
  if (bevel > 0) {
    upper = insetPolygon(plan, bevel);
    for (let index = 0; index < count; index++) {
      const a = plan[index], b = plan[(index + 1) % count], c = upper[(index + 1) % count], d = upper[index];
      const n = interiorNormal(a, b, sign);
      const length = Math.SQRT1_2;
      face(writer, topSlot, [[a[0], wallTop, a[1]], [b[0], wallTop, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]]], [-n[0] * length, length, -n[1] * length]);
    }
  }
  const triangles = triangulate(upper);
  if (top) for (let index = 0; index < triangles.length; index += 3) {
    face(writer, topSlot, [0, 1, 2].map((k) => [upper[triangles[index + k]][0], y1, upper[triangles[index + k]][1]] as P3), [0, 1, 0]);
  }
  if (bottom) {
    const lower = triangulate(plan);
    for (let index = 0; index < lower.length; index += 3) face(writer, slot, [0, 1, 2].map((k) => [plan[lower[index + k]][0], y0, plan[lower[index + k]][1]] as P3), [0, -1, 0]);
  }
}

// ---------------------------------------------------------------------------
// Lathes

export interface LatheOptions {
  /** Segments around; defaults to the quality tier for the largest radius. */
  segments?: number;
  /** Start angle and sweep in radians (a full turn closes on itself). */
  phase?: number;
  arc?: number;
  /** Discs closing the profile's ends where they leave the axis. */
  caps?: boolean;
  /** Centre of the lathe. */
  center?: P3;
}

/**
 * Revolves a profile (x = radius, y = height) about the vertical axis. A full
 * turn with caps (or with ends on the axis) is watertight. Angle 0 points at
 * -Z (north) and positive angles turn toward +X (east).
 */
export function lathe(writer: MeshWriter, slot: number, quality: ArchiveQuality, profile: Profile, options: LatheOptions = {}): void {
  const p = profile.points, rows = p.length / 2;
  let maxRadius = 0;
  for (let index = 0; index < p.length; index += 2) maxRadius = Math.max(maxRadius, p[index]);
  const arc = options.arc ?? Math.PI * 2, full = Math.abs(arc - Math.PI * 2) < 1e-9;
  const segments = Math.max(3, options.segments ?? Math.ceil((latheSegments(quality, maxRadius) * arc) / (Math.PI * 2)));
  const phase = options.phase ?? 0, [ox, oy, oz] = options.center ?? [0, 0, 0];
  const lengths = profileLengths(profile);
  for (let row = 0; row < rows - 1; row++) {
    const [sx, sy, ex, ey] = segmentEndNormals(profile, row);
    const r0 = p[row * 2], y0 = p[row * 2 + 1], r1 = p[row * 2 + 2], y1 = p[row * 2 + 3];
    if (Math.abs(r0 - r1) < 1e-12 && Math.abs(y0 - y1) < 1e-12) continue;
    const base = writer.vertexCount;
    for (let index = 0; index <= segments; index++) {
      const angle = phase + (arc * index) / segments, s = Math.sin(angle), c = -Math.cos(angle);
      const u = angle * maxRadius;
      writer.vertex(ox + r0 * s, oy + y0, oz + r0 * c, sx * s, sy, sx * c, u, lengths[row]);
      writer.vertex(ox + r1 * s, oy + y1, oz + r1 * c, ex * s, ey, ex * c, u, lengths[row + 1]);
    }
    for (let index = 0; index < segments; index++) {
      const a = base + index * 2, b = a + 2;
      if (r0 < 1e-9) writer.orientTriangle(slot, a, b + 1, a + 1);
      else if (r1 < 1e-9) writer.orientTriangle(slot, a, b, a + 1);
      else writer.orientQuad(slot, a, b, b + 1, a + 1);
    }
  }
  if (options.caps && full) {
    for (const [index, up] of [[0, -1], [rows - 1, 1]] as const) {
      const radius = p[index * 2], y = p[index * 2 + 1];
      if (radius < 1e-9) continue;
      const centre = writer.vertex(ox, oy + y, oz, 0, up, 0, 0, 0);
      const ring = writer.vertexCount;
      for (let k = 0; k < segments; k++) {
        const angle = phase + (arc * k) / segments;
        writer.vertex(ox + radius * Math.sin(angle), oy + y, oz - radius * Math.cos(angle), 0, up, 0, radius * Math.sin(angle), -radius * Math.cos(angle));
      }
      for (let k = 0; k < segments; k++) writer.orientTriangle(slot, centre, ring + k, ring + ((k + 1) % segments));
    }
  }
}

// ---------------------------------------------------------------------------
// Sweeps

/**
 * Sweeps a profile along a closed plan polygon at height `y`, with mitred
 * corners and crisp normals on each straight run. The profile's x offset
 * points toward the polygon's interior (`inward`) or away from it.
 */
export function sweepPolygon(writer: MeshWriter, slot: number, profile: Profile, plan: readonly P2[], y: number, inward: boolean): void {
  const count = plan.length;
  const sign = signedArea(plan) > 0 ? 1 : -1;
  const normals: [number, number][] = [];
  for (let index = 0; index < count; index++) {
    const n = interiorNormal(plan[index], plan[(index + 1) % count], sign);
    normals.push(inward ? n : [-n[0], -n[1]]);
  }
  const mitres: [number, number, number][] = [];
  for (let index = 0; index < count; index++) {
    const before = normals[(index + count - 1) % count], after = normals[index];
    let mx = before[0] + after[0], mz = before[1] + after[1];
    const length = Math.hypot(mx, mz) || 1;
    mx /= length; mz /= length;
    mitres.push([mx, mz, Math.min(4, 1 / Math.max(0.25, mx * after[0] + mz * after[1]))]);
  }
  const lengths = profileLengths(profile), p = profile.points, rows = p.length / 2;
  let along = 0;
  for (let index = 0; index < count; index++) {
    const a = plan[index], b = plan[(index + 1) % count], n = normals[index];
    const ma = mitres[index], mb = mitres[(index + 1) % count];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let row = 0; row < rows - 1; row++) {
      const [sx, sy, ex, ey] = segmentEndNormals(profile, row);
      const x0 = p[row * 2], y0 = p[row * 2 + 1], x1 = p[row * 2 + 2], y1 = p[row * 2 + 3];
      const v0 = writer.vertex(a[0] + ma[0] * x0 * ma[2], y + y0, a[1] + ma[1] * x0 * ma[2], n[0] * sx, sy, n[1] * sx, along, lengths[row]);
      const v1 = writer.vertex(b[0] + mb[0] * x0 * mb[2], y + y0, b[1] + mb[1] * x0 * mb[2], n[0] * sx, sy, n[1] * sx, along + run, lengths[row]);
      const v2 = writer.vertex(b[0] + mb[0] * x1 * mb[2], y + y1, b[1] + mb[1] * x1 * mb[2], n[0] * ex, ey, n[1] * ex, along + run, lengths[row + 1]);
      const v3 = writer.vertex(a[0] + ma[0] * x1 * ma[2], y + y1, a[1] + ma[1] * x1 * ma[2], n[0] * ex, ey, n[1] * ex, along, lengths[row + 1]);
      writer.orientQuad(slot, v0, v1, v2, v3);
    }
    along += run;
  }
}

export interface SweepFrame {
  /** Point on the path. */
  p: P3;
  /** Unit direction of the profile's x (its outward offset). */
  n: P3;
  /** Unit direction of the profile's y. */
  b: P3;
}

/** Sweeps a profile along a smooth path of frames; `closed` joins the last frame to the first. */
export function sweepFrames(writer: MeshWriter, slot: number, profile: Profile, frames: readonly SweepFrame[], closed = false): void {
  const p = profile.points, rows = p.length / 2, lengths = profileLengths(profile);
  const count = frames.length, steps = closed ? count : count - 1;
  const along = [0];
  for (let index = 1; index <= steps; index++) {
    const a = frames[index - 1].p, b = frames[index % count].p;
    along.push(along[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  for (let row = 0; row < rows - 1; row++) {
    const [sx, sy, ex, ey] = segmentEndNormals(profile, row);
    const x0 = p[row * 2], y0 = p[row * 2 + 1], x1 = p[row * 2 + 2], y1 = p[row * 2 + 3];
    const base = writer.vertexCount;
    for (let index = 0; index <= steps; index++) {
      const f = frames[index % count];
      const put = (x: number, y: number, nx: number, ny: number, v: number) => {
        let mx = f.n[0] * nx + f.b[0] * ny, my = f.n[1] * nx + f.b[1] * ny, mz = f.n[2] * nx + f.b[2] * ny;
        const length = Math.hypot(mx, my, mz) || 1;
        mx /= length; my /= length; mz /= length;
        writer.vertex(f.p[0] + f.n[0] * x + f.b[0] * y, f.p[1] + f.n[1] * x + f.b[1] * y, f.p[2] + f.n[2] * x + f.b[2] * y, mx, my, mz, along[index], v);
      };
      put(x0, y0, sx, sy, lengths[row]);
      put(x1, y1, ex, ey, lengths[row + 1]);
    }
    for (let index = 0; index < steps; index++) {
      const a = base + index * 2, b = a + 2;
      writer.orientQuad(slot, a, b, b + 1, a + 1);
    }
  }
}

/** A thin rod (n-sided prism) between two points, with optional end caps. */
export function rod(writer: MeshWriter, slot: number, a: P3, b: P3, radius: number, sides: number, caps = true): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], length = Math.hypot(dx, dy, dz) || 1;
  const t: P3 = [dx / length, dy / length, dz / length];
  // Any vector not parallel to the axis builds the frame.
  const helper: P3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = helper[1] * t[2] - helper[2] * t[1], uy = helper[2] * t[0] - helper[0] * t[2], uz = helper[0] * t[1] - helper[1] * t[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = t[1] * uz - t[2] * uy, vy = t[2] * ux - t[0] * uz, vz = t[0] * uy - t[1] * ux;
  const base = writer.vertexCount;
  for (let k = 0; k <= sides; k++) {
    const angle = (k / sides) * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
    writer.vertex(a[0] + nx * radius, a[1] + ny * radius, a[2] + nz * radius, nx, ny, nz, (k / sides) * Math.PI * 2 * radius, 0);
    writer.vertex(b[0] + nx * radius, b[1] + ny * radius, b[2] + nz * radius, nx, ny, nz, (k / sides) * Math.PI * 2 * radius, length);
  }
  for (let k = 0; k < sides; k++) writer.orientQuad(slot, base + k * 2, base + k * 2 + 2, base + k * 2 + 3, base + k * 2 + 1);
  if (caps) {
    for (const [end, sign] of [[a, -1], [b, 1]] as const) {
      const centre = writer.vertex(end[0], end[1], end[2], t[0] * sign, t[1] * sign, t[2] * sign, 0, 0);
      const ring = writer.vertexCount;
      for (let k = 0; k < sides; k++) {
        const angle = (k / sides) * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
        writer.vertex(end[0] + (ux * c + vx * s) * radius, end[1] + (uy * c + vy * s) * radius, end[2] + (uz * c + vz * s) * radius, t[0] * sign, t[1] * sign, t[2] * sign, c * radius, s * radius);
      }
      for (let k = 0; k < sides; k++) writer.orientTriangle(slot, centre, ring + k, ring + ((k + 1) % sides));
    }
  }
}

/** A flat annulus (or disc when inner is 0) at height y facing up (+1) or down (-1), split into rings for the vertex bake. */
export function annulus(writer: MeshWriter, slot: number, inner: number, outer: number, y: number, facing: 1 | -1, segments: number, rings = 1, center: P3 = [0, 0, 0]): void {
  const base = writer.vertexCount;
  for (let ring = 0; ring <= rings; ring++) {
    const radius = inner + ((outer - inner) * ring) / rings;
    for (let k = 0; k <= segments; k++) {
      const angle = (k / segments) * Math.PI * 2, x = Math.sin(angle) * radius, z = -Math.cos(angle) * radius;
      writer.vertex(center[0] + x, center[1] + y, center[2] + z, 0, facing, 0, x, -z);
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let k = 0; k < segments; k++) {
      const a = base + ring * (segments + 1) + k, b = a + 1, c = a + segments + 2, d = a + segments + 1;
      if (inner < 1e-9 && ring === 0) writer.orientTriangle(slot, a, c, d);
      else writer.orientQuad(slot, a, b, c, d);
    }
  }
}

// ---------------------------------------------------------------------------
// Arches

export type ArchKind = "pointed" | "segmental" | "round";

export interface ArchShape {
  kind: ArchKind;
  span: number;
  /** Pointed: each half's radius as a factor of the span (0.5 is round). */
  radiusFactor?: number;
  /** Segmental: the rise above the springing line. */
  rise?: number;
}

export interface ArchCurve {
  /** Points from the left springing (-span/2, 0) to the right (span/2, 0), apex once. */
  points: [number, number][];
  /** For each point, the centre of the arc it lies on (two centres for a pointed arch). */
  centres: [number, number][];
  rise: number;
}

/** The intrados of an arch, offset outward by `offset` for an extrados (the same centres, larger radii). */
export function archCurve(quality: ArchiveQuality, shape: ArchShape, offset = 0): ArchCurve {
  const half = shape.span / 2;
  if (shape.kind === "segmental") {
    const h = shape.rise ?? shape.span / 4;
    const radius = (half * half + h * h) / (2 * h), cy = h - radius, r = radius + offset;
    const start = Math.atan2(-cy, -half), end = Math.atan2(-cy, half);
    const segments = Math.max(2, arcSegments(quality, start - end, r));
    const points: [number, number][] = [], centres: [number, number][] = [];
    // The extrados keeps the intrados's angles so voussoir joints stay radial.
    for (let index = 0; index <= segments; index++) {
      const angle = start + ((end - start) * index) / segments;
      points.push([Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      centres.push([0, cy]);
    }
    return { points, centres, rise: h + offset };
  }
  const k = shape.kind === "round" ? 0.5 : Math.max(0.5, shape.radiusFactor ?? 0.72);
  const radius = k * shape.span, r = radius + offset;
  const cx = radius - half; // the left half's centre sits right of the left springing
  // Apex angle on the left arc where it meets x = 0.
  const apex = Math.acos(Math.max(-1, Math.min(1, (0 - (-half + radius)) / r)));
  const start = Math.PI;
  const segments = Math.max(2, arcSegments(quality, start - apex, r));
  const left: [number, number][] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = start + ((apex - start) * index) / segments;
    left.push([-half + radius + Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  void cx;
  const points: [number, number][] = [...left];
  const centres: [number, number][] = left.map(() => [-half + radius, 0] as [number, number]);
  for (let index = left.length - 2; index >= 0; index--) {
    points.push([-left[index][0], left[index][1]]);
    centres.push([half - radius, 0]);
  }
  return { points, centres, rise: left[left.length - 1][1] };
}

/** Height of an arch's intrados above its springing at offset x; NaN beyond its span. */
export function archHeightAt(shape: ArchShape, x: number, offset = 0): number {
  const half = shape.span / 2, a = Math.abs(x);
  if (shape.kind === "segmental") {
    const h = shape.rise ?? shape.span / 4, radius = (half * half + h * h) / (2 * h), r = radius + offset;
    return a > r ? NaN : h - radius + Math.sqrt(Math.max(0, r * r - a * a));
  }
  const k = shape.kind === "round" ? 0.5 : Math.max(0.5, shape.radiusFactor ?? 0.72);
  const radius = k * shape.span, r = radius + offset, c = half - radius;
  if (a > half + offset + 1e-9) return NaN;
  return Math.sqrt(Math.max(0, r * r - (a - c) ** 2));
}
