// Pure spatial helpers for the archive blueprint: compass directions, the
// footprint, occluder volumes, sphere sweeps, ring sampling, orbiting framings
// and perspective frames. Archive metres, conventions in ./types.ts. No
// allocation in the per-sample functions that take an `out` argument.

import type { DesktopFraming, MechanismRing, OccluderVolume, Vec2, Vec3 } from "./types";

export const DEG = Math.PI / 180;

/** Unit horizontal direction of a compass bearing: [x, z]. */
export function bearingDirection(bearing: number): [number, number] {
  return [Math.sin(bearing), -Math.cos(bearing)];
}

/** Compass bearing of a horizontal offset, in (-PI, PI]. */
export function bearingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** The yaw that turns an object's local -Z toward a compass bearing. */
export function yawForBearing(bearing: number): number {
  return -bearing;
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(angle: number): number {
  const turned = angle - Math.PI * 2 * Math.floor((angle + Math.PI) / (Math.PI * 2));
  return turned <= -Math.PI ? turned + Math.PI * 2 : turned;
}

/** A point at a bearing and horizontal distance from an origin, at height y. */
export function atBearing(origin: Vec2, bearing: number, distance: number, y = 0): [number, number, number] {
  const [dx, dz] = bearingDirection(bearing);
  return [origin[0] + dx * distance, y, origin[1] + dz * distance];
}

/** Even-odd test of a point against a closed polygon in plan. */
export function pointInPolygon(x: number, z: number, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [ax, az] = polygon[previous], [bx, bz] = polygon[index];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Distance in plan from a point to the nearest edge of a closed polygon. */
export function distanceToPolygonEdge(x: number, z: number, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    best = Math.min(best, segmentDistance2(x, z, polygon[previous][0], polygon[previous][1], polygon[index][0], polygon[index][1]));
  }
  return best;
}

/** Signed area in plan with x east and z south; positive means clockwise seen from above. */
export function polygonArea(polygon: readonly Vec2[]): number {
  let area = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    area += polygon[previous][0] * polygon[index][1] - polygon[index][0] * polygon[previous][1];
  }
  return area / 2;
}

function segmentDistance2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const lx = bx - ax, lz = bz - az, length = lx * lx + lz * lz;
  const t = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / length)) : 0;
  return Math.hypot(x - ax - lx * t, z - az - lz * t);
}

/** Moves a point into an occluder's frame: box axes follow its yaw. */
function toLocal(volume: OccluderVolume, x: number, y: number, z: number, out: number[]): number[] {
  const dx = x - volume.center[0], dz = z - volume.center[2];
  const c = Math.cos(volume.yaw), s = Math.sin(volume.yaw);
  // Inverse of the yaw rotation: local = R(-yaw) * world.
  out[0] = dx * c - dz * s;
  out[1] = y - volume.center[1];
  out[2] = dx * s + dz * c;
  return out;
}

const localA = [0, 0, 0], localB = [0, 0, 0];

/** Distance from a point to an occluder's surface; 0 inside it. */
export function distanceToOccluder(volume: OccluderVolume, point: Vec3): number {
  const p = toLocal(volume, point[0], point[1], point[2], localA);
  if (volume.kind === "box") {
    const qx = Math.max(0, Math.abs(p[0]) - volume.size[0] / 2);
    const qy = Math.max(0, Math.abs(p[1]) - volume.size[1] / 2);
    const qz = Math.max(0, Math.abs(p[2]) - volume.size[2] / 2);
    return Math.hypot(qx, qy, qz);
  }
  if (volume.kind === "prism") {
    const plan = volume.plan || [];
    const vertical = Math.max(0, Math.abs(p[1]) - volume.size[1] / 2);
    const across = pointInPolygon(p[0], p[2], plan) ? 0 : distanceToPolygonEdge(p[0], p[2], plan);
    return Math.hypot(across, vertical);
  }
  const radial = Math.max(0, Math.hypot(p[0], p[2]) - volume.size[0] / 2);
  const vertical = Math.max(0, Math.abs(p[1]) - volume.size[1] / 2);
  return Math.hypot(radial, vertical);
}

/**
 * True when a sphere of `radius` swept from `a` to `b` touches the volume. The
 * box test inflates the box by the radius (slightly conservative at corners);
 * the cylinder test is exact up to its flat caps.
 */
export function sweepHitsOccluder(volume: OccluderVolume, a: Vec3, b: Vec3, radius: number): boolean {
  const pa = toLocal(volume, a[0], a[1], a[2], localA), pb = toLocal(volume, b[0], b[1], b[2], localB);
  if (volume.kind === "box") {
    let near = 0, far = 1;
    for (let axis = 0; axis < 3; axis++) {
      const half = volume.size[axis] / 2 + radius, origin = pa[axis], delta = pb[axis] - pa[axis];
      if (Math.abs(delta) < 1e-12) {
        if (Math.abs(origin) > half) return false;
        continue;
      }
      let t0 = (-half - origin) / delta, t1 = (half - origin) / delta;
      if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) return false;
    }
    return true;
  }
  if (volume.kind === "prism") {
    // Clip the segment against the plan's edges pushed out by the radius and the inflated height band.
    const plan = volume.plan || [];
    let cx = 0, cz = 0;
    for (const point of plan) { cx += point[0] / plan.length; cz += point[1] / plan.length; }
    let near = 0, far = 1;
    const clipHalf = (nx: number, nz: number, ny: number, limit: number): boolean => {
      const start = nx * pa[0] + ny * pa[1] + nz * pa[2], delta = nx * (pb[0] - pa[0]) + ny * (pb[1] - pa[1]) + nz * (pb[2] - pa[2]);
      if (Math.abs(delta) < 1e-12) return start <= limit;
      const t = (limit - start) / delta;
      if (delta > 0) far = Math.min(far, t);
      else near = Math.max(near, t);
      return near <= far;
    };
    for (let index = 0, previous = plan.length - 1; index < plan.length; previous = index++) {
      const [ax, az] = plan[previous], [bx, bz] = plan[index];
      let nx = bz - az, nz = ax - bx;
      const length = Math.hypot(nx, nz) || 1;
      nx /= length; nz /= length;
      // Point the normal away from the plan's centre.
      if (nx * (cx - ax) + nz * (cz - az) > 0) { nx = -nx; nz = -nz; }
      if (!clipHalf(nx, nz, 0, nx * ax + nz * az + radius)) return false;
    }
    const half = volume.size[1] / 2 + radius;
    return clipHalf(0, 0, 1, half) && clipHalf(0, 0, -1, half);
  }
  // Cylinder: clip to the inflated height band, then the closest approach to the axis in plan.
  const half = volume.size[1] / 2 + radius, reach = volume.size[0] / 2 + radius;
  let t0 = 0, t1 = 1;
  const dy = pb[1] - pa[1];
  if (Math.abs(dy) < 1e-12) {
    if (Math.abs(pa[1]) > half) return false;
  } else {
    let lo = (-half - pa[1]) / dy, hi = (half - pa[1]) / dy;
    if (lo > hi) { const swap = lo; lo = hi; hi = swap; }
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    if (t0 > t1) return false;
  }
  const ax = pa[0] + (pb[0] - pa[0]) * t0, az = pa[2] + (pb[2] - pa[2]) * t0;
  const bx = pa[0] + (pb[0] - pa[0]) * t1, bz = pa[2] + (pb[2] - pa[2]) * t1;
  return segmentDistance2(0, 0, ax, az, bx, bz) <= reach;
}

/** Rotates a vector by Euler angles applied X, then Y, then Z (three.js "XYZ" order on a column vector). */
export function rotateEuler(x: number, y: number, z: number, euler: Vec3, out: number[]): number[] {
  const [ex, ey, ez] = euler;
  const cx = Math.cos(ex), sx = Math.sin(ex), cy = Math.cos(ey), sy = Math.sin(ey), cz = Math.cos(ez), sz = Math.sin(ez);
  // three.js XYZ order builds R = Rx * Ry * Rz.
  const y1 = y * cz + x * sz, x1 = x * cz - y * sz;
  const x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy;
  const y3 = y1 * cx - z2 * sx, z3 = y1 * sx + z2 * cx;
  out[0] = x2;
  out[1] = y3;
  out[2] = z3;
  return out;
}

const ringScratch = [0, 0, 0];

/** A point on a ring's centre line at ring angle `angle` (0 at its local north, positive toward its local east). */
export function ringPoint(ring: MechanismRing, angle: number, out: number[] = [0, 0, 0]): number[] {
  rotateEuler(Math.sin(angle) * ring.radius, 0, -Math.cos(angle) * ring.radius, ring.tilt, ringScratch);
  out[0] = ring.center[0] + ringScratch[0];
  out[1] = ring.center[1] + ringScratch[1];
  out[2] = ring.center[2] + ringScratch[2];
  return out;
}

/** The unit normal of a ring's plane (its pivot axis). */
export function ringAxis(ring: MechanismRing, out: number[] = [0, 0, 0]): number[] {
  return rotateEuler(0, 1, 0, ring.tilt, out);
}

/** Distance from a point to a ring band, treating the band as a torus around its centre line. */
export function distanceToRing(ring: MechanismRing, point: Vec3): number {
  const axis = ringAxis(ring, [0, 0, 0]);
  const dx = point[0] - ring.center[0], dy = point[1] - ring.center[1], dz = point[2] - ring.center[2];
  const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
  const px = dx - axis[0] * along, py = dy - axis[1] * along, pz = dz - axis[2] * along;
  const radial = Math.hypot(px, py, pz) - ring.radius;
  const half = Math.max(ring.section.width, ring.section.thickness) / 2;
  return Math.max(0, Math.hypot(radial, along) - half);
}

/** A framing's eye after orbiting by yaw and pitch offsets (radians) and a zoom factor. */
export function orbitEye(framing: DesktopFraming, yawOffset: number, pitchOffset: number, zoom: number, out: number[] = [0, 0, 0]): number[] {
  const [tx, ty, tz] = framing.target;
  const dx = framing.eye[0] - tx, dy = framing.eye[1] - ty, dz = framing.eye[2] - tz;
  const level = Math.hypot(dx, dz), distance = Math.hypot(level, dy) * zoom;
  const elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, Math.atan2(dy, level) + pitchOffset));
  // Yaw turns counter-clockwise seen from above, as three.js does.
  const heading = Math.atan2(dx, dz) + yawOffset;
  out[0] = tx + Math.sin(heading) * Math.cos(elevation) * distance;
  out[1] = ty + Math.sin(elevation) * distance;
  out[2] = tz + Math.cos(heading) * Math.cos(elevation) * distance;
  return out;
}

export interface CameraFrame {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  tanHalfV: number;
  tanHalfH: number;
}

/** A perspective frame looking from `eye` at `target` with world up +Y. */
export function cameraFrame(eye: Vec3, target: Vec3, fovDegrees: number, aspect: number): CameraFrame {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const length = Math.hypot(fx, fy, fz) || 1;
  fx /= length; fy /= length; fz /= length;
  // right = forward x up(0,1,0)
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up = right x forward
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const tanHalfV = Math.tan((fovDegrees * DEG) / 2);
  return { eye, forward: [fx, fy, fz], right: [rx, 0, rz], up: [ux, uy, uz], tanHalfV, tanHalfH: tanHalfV * aspect };
}

/** Normalised frame coordinates of a point: |x|, |y| <= 1 inside; `depth` is the distance along the view. */
export function projectToFrame(frame: CameraFrame, point: Vec3, out: { x: number; y: number; depth: number } = { x: 0, y: 0, depth: 0 }) {
  const dx = point[0] - frame.eye[0], dy = point[1] - frame.eye[1], dz = point[2] - frame.eye[2];
  const depth = dx * frame.forward[0] + dy * frame.forward[1] + dz * frame.forward[2];
  const across = dx * frame.right[0] + dy * frame.right[1] + dz * frame.right[2];
  const rise = dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2];
  out.depth = depth;
  out.x = depth > 1e-6 ? across / (depth * frame.tanHalfH) : Infinity;
  out.y = depth > 1e-6 ? rise / (depth * frame.tanHalfV) : Infinity;
  return out;
}

export function insideFrame(frame: CameraFrame, point: Vec3, margin = 0): boolean {
  const p = projectToFrame(frame, point);
  return p.depth > 0.05 && Math.abs(p.x) <= 1 - margin && Math.abs(p.y) <= 1 - margin;
}

/** Bearing and elevation of a point seen from an eye, in radians. */
export function lookAngles(eye: Vec3, point: Vec3): { bearing: number; elevation: number; distance: number } {
  const dx = point[0] - eye[0], dy = point[1] - eye[1], dz = point[2] - eye[2];
  const level = Math.hypot(dx, dz);
  return { bearing: bearingOf(dx, dz), elevation: Math.atan2(dy, level), distance: Math.hypot(level, dy) };
}

/** Convex hull of 2D points (monotone chain), counter-clockwise. */
export function convexHull(points: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = points.map((point) => [point[0], point[1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Separating-axis test between two convex polygons; `gap` is the clearance they must keep. */
export function convexPolygonsOverlap(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[], gap = 0): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const p = polygon[index], q = polygon[(index + 1) % polygon.length];
      const nx = q[1] - p[1], ny = p[0] - q[0], length = Math.hypot(nx, ny) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const point of a) { const d = (point[0] * nx + point[1] * ny) / length; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const point of b) { const d = (point[0] * nx + point[1] * ny) / length; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA + gap < minB || maxB + gap < minA) return false;
    }
  }
  return true;
}
