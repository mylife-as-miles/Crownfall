// Pure plan-geometry helpers shared by the blueprint, validator, map generator and
// renderers. Plan points are [x, z] in blueprint metres (see types.ts).

import type { PlanShape, RectShape, Vec2 } from "./types";

const DEG = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG;
}

/** Unit plan vector for a compass bearing (0 = north = -Z, 90 = east = +X). */
export function bearingVector(bearingDeg: number): Vec2 {
  const r = bearingDeg * DEG;
  return [Math.sin(r), -Math.cos(r)];
}

/** Compass bearing (0..360) of a plan direction. */
export function vectorBearing(dx: number, dz: number): number {
  const b = Math.atan2(dx, -dz) / DEG;
  return b < 0 ? b + 360 : b;
}

/** Plan point at a bearing and distance from an origin (default the datum). */
export function polar(bearingDeg: number, distance: number, origin: Vec2 = [0, 0]): Vec2 {
  const v = bearingVector(bearingDeg);
  return [round2(origin[0] + v[0] * distance), round2(origin[1] + v[1] * distance)];
}

/** yaw (rotationDeg convention) that makes local +Z face the given compass bearing. */
export function yawFacingBearing(bearingDeg: number): number {
  // local +Z faces south (bearing 180) at yaw 0; positive yaw turns counter-clockwise.
  let yaw = 180 - bearingDeg;
  while (yaw <= -180) yaw += 360;
  while (yaw > 180) yaw -= 360;
  return yaw;
}

/** Compass bearing faced by local +Z for a yaw. */
export function bearingOfYaw(yawDeg: number): number {
  let b = 180 - yawDeg;
  while (b < 0) b += 360;
  while (b >= 360) b -= 360;
  return b;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Rotate a local plan offset by a yaw (three.js rotation.y convention). */
export function rotateLocal(lx: number, lz: number, yawDeg: number): Vec2 {
  const r = yawDeg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** World plan point → local frame of a rotated rectangle centred at center. */
export function toLocal(p: Vec2, center: Vec2, yawDeg: number): Vec2 {
  const dx = p[0] - center[0];
  const dz = p[1] - center[1];
  const r = yawDeg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // inverse of rotateLocal
  return [dx * c - dz * s, dx * s + dz * c];
}

export function rectCorners(center: Vec2, width: number, depth: number, rotationDeg = 0): Vec2[] {
  const hw = width / 2;
  const hd = depth / 2;
  const local: Vec2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return local.map(([lx, lz]) => {
    const [rx, rz] = rotateLocal(lx, lz, rotationDeg);
    return [center[0] + rx, center[1] + rz] as Vec2;
  });
}

export function shapePolygon(shape: PlanShape): Vec2[] {
  if (shape.kind === "rect") return rectCorners(shape.center, shape.width, shape.depth, shape.rotationDeg ?? 0);
  return shape.points.slice();
}

export function rectShape(center: Vec2, width: number, depth: number, rotationDeg = 0): RectShape {
  return { kind: "rect", center, width, depth, rotationDeg };
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

export function distancePointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a[0] + abx * t - p[0];
  const cz = a[1] + abz * t - p[1];
  return Math.sqrt(cx * cx + cz * cz);
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's boundary. */
export function distanceToPolygonEdge(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const e = distancePointSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (e < d) d = e;
  }
  return d;
}

/** Signed distance: negative inside the polygon, positive outside. */
export function signedDistancePolygon(p: Vec2, poly: readonly Vec2[]): number {
  const d = distanceToPolygonEdge(p, poly);
  return pointInPolygon(p, poly) ? -d : d;
}

export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

export function polygonBounds(poly: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ };
}

/** Oriented rectangle used for footprint tests. */
export interface PlanRect {
  center: Vec2;
  width: number;
  depth: number;
  rotationDeg: number;
}

/**
 * Penetration depth of two convex polygons by the separating-axis theorem:
 * ≤ 0 when separated or touching, otherwise the smallest overlap along any axis.
 */
export function convexPenetration(a: readonly Vec2[], b: readonly Vec2[]): number {
  let minOverlap = Infinity;
  const polys = [a, b];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      let nx = -(q[1] - p[1]);
      let nz = q[0] - p[0];
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len === 0) continue;
      nx /= len;
      nz /= len;
      let aMin = Infinity;
      let aMax = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * nz;
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const v of b) {
        const d = v[0] * nx + v[1] * nz;
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= 0) return overlap;
      if (overlap < minOverlap) minOverlap = overlap;
    }
  }
  return minOverlap;
}

export function rectPolygon(r: PlanRect): Vec2[] {
  return rectCorners(r.center, r.width, r.depth, r.rotationDeg);
}

/** Shortest distance between a segment and an oriented rectangle (0 if they intersect). */
export function distanceSegmentRect(a: Vec2, b: Vec2, r: PlanRect): number {
  const la = toLocal(a, r.center, r.rotationDeg);
  const lb = toLocal(b, r.center, r.rotationDeg);
  const hw = r.width / 2;
  const hd = r.depth / 2;
  if (segmentIntersectsAabb(la, lb, hw, hd)) return 0;
  const corners: Vec2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  let d = Math.min(pointAabbDistance(la, hw, hd), pointAabbDistance(lb, hw, hd));
  for (const c of corners) d = Math.min(d, distancePointSegment(c, la, lb));
  return d;
}

function pointAabbDistance(p: Vec2, hw: number, hd: number): number {
  const dx = Math.max(Math.abs(p[0]) - hw, 0);
  const dz = Math.max(Math.abs(p[1]) - hd, 0);
  return Math.sqrt(dx * dx + dz * dz);
}

function segmentIntersectsAabb(a: Vec2, b: Vec2, hw: number, hd: number): boolean {
  // Liang–Barsky clip of the segment against the box.
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] + hw, hw - a[0], a[1] + hd, hd - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

export function pointInRect(p: Vec2, r: PlanRect, inflate = 0): boolean {
  const l = toLocal(p, r.center, r.rotationDeg);
  return Math.abs(l[0]) <= r.width / 2 + inflate && Math.abs(l[1]) <= r.depth / 2 + inflate;
}

export function polylineLength(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist2(points[i - 1], points[i]);
  return s;
}

/** Distance from a point to a polyline. */
export function distanceToPolyline(p: Vec2, points: readonly Vec2[]): number {
  if (points.length === 1) return dist2(p, points[0]);
  let d = Infinity;
  for (let i = 1; i < points.length; i++) {
    const e = distancePointSegment(p, points[i - 1], points[i]);
    if (e < d) d = e;
  }
  return d;
}

/** Point and unit tangent at arc length s along a polyline (clamped). */
export function pointAlongPolyline(points: readonly Vec2[], s: number): { point: Vec2; tangent: Vec2 } {
  let remaining = s < 0 ? 0 : s;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist2(a, b);
    if (remaining <= len || i === points.length - 1) {
      const t = len > 0 ? Math.min(remaining / len, 1) : 0;
      const tx = len > 0 ? (b[0] - a[0]) / len : 1;
      const tz = len > 0 ? (b[1] - a[1]) / len : 0;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], tangent: [tx, tz] };
    }
    remaining -= len;
  }
  return { point: points[0], tangent: [1, 0] };
}

/** Evenly spaced samples (including both ends) along a polyline, every `step` metres. */
export function samplePolyline(points: readonly Vec2[], step: number): Vec2[] {
  const total = polylineLength(points);
  const n = Math.max(1, Math.ceil(total / step));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAlongPolyline(points, (total * i) / n).point);
  return out;
}
