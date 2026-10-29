// Polygon primitives for heraldry. Rings are closed polygons stored as flat
// [x0, y0, x1, y1, ...] arrays in y-down unit space. Outer rings have positive
// shoelace area and holes negative, so a nonzero fill (SVG) and the coverage
// rasterizer agree on every shape.

export type Ring = Float32Array;

export function signedArea(ring: ArrayLike<number>): number {
  let area = 0;
  const count = ring.length;
  for (let index = 0; index < count; index += 2) {
    const next = (index + 2) % count;
    area += ring[index] * ring[next + 1] - ring[next] * ring[index + 1];
  }
  return area / 2;
}

function reversed(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = points.length - 2; index >= 0; index -= 2) out.push(points[index], points[index + 1]);
  return out;
}

/** An outer ring (positive area) from flat points in any winding. */
export function outer(points: readonly number[]): Ring {
  return Float32Array.from(signedArea(points) >= 0 ? points : reversed(points));
}

/** A hole ring (negative area) from flat points in any winding. */
export function hole(points: readonly number[]): Ring {
  return Float32Array.from(signedArea(points) <= 0 ? points : reversed(points));
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

export function circlePoints(cx: number, cy: number, r: number, segments = 48): number[] {
  const out: number[] = [];
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    out.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  return out;
}

/**
 * The outline of a union of circles that is star-shaped around (cx, cy): for
 * each sampled direction, the farthest circle boundary along the ray. A single
 * non-overlapping ring, so holes cut through it cleanly under the nonzero rule.
 */
export function radialUnionPoints(circles: readonly (readonly [number, number, number])[], cx: number, cy: number, samples = 128): number[] {
  const out: number[] = [];
  for (let index = 0; index < samples; index++) {
    const angle = (index / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let reach = 0;
    for (const [x, y, r] of circles) {
      const ox = cx - x;
      const oy = cy - y;
      const b = ox * dx + oy * dy;
      const disc = b * b - (ox * ox + oy * oy - r * r);
      if (disc < 0) continue;
      const far = -b + Math.sqrt(disc);
      if (far > reach) reach = far;
    }
    out.push(cx + dx * reach, cy + dy * reach);
  }
  return out;
}

/** Appends a cubic Bézier (excluding its start point) to `out`. */
export function cubicTo(out: number[], x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, segments = 14): void {
  const x0 = out[out.length - 2];
  const y0 = out[out.length - 1];
  for (let step = 1; step <= segments; step++) {
    const t = step / segments;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

/** Mirrors a right-half profile (top to bottom, x ≥ 0) into a symmetric closed polygon around x = 0. */
export function mirrorProfile(right: readonly number[]): number[] {
  const out = right.slice();
  for (let index = right.length - 2; index >= 0; index -= 2) {
    if (Math.abs(right[index]) < 1e-9) continue;
    out.push(-right[index], right[index + 1]);
  }
  return out;
}

export function transformPoints(points: readonly number[], scale: number, dx: number, dy: number): number[] {
  const out = new Array<number>(points.length);
  for (let index = 0; index < points.length; index += 2) {
    out[index] = points[index] * scale + dx;
    out[index + 1] = points[index + 1] * scale + dy;
  }
  return out;
}

export function transformRing(ring: Ring, scale: number, dx: number, dy: number): Ring {
  const out = new Float32Array(ring.length);
  for (let index = 0; index < ring.length; index += 2) {
    out[index] = ring[index] * scale + dx;
    out[index + 1] = ring[index + 1] * scale + dy;
  }
  return out;
}

/** Scales, rotates (radians, clockwise on screen) and translates a ring. */
export function rotateRing(ring: Ring, scale: number, angle: number, dx: number, dy: number): Ring {
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  const out = new Float32Array(ring.length);
  for (let index = 0; index < ring.length; index += 2) {
    const x = ring[index];
    const y = ring[index + 1];
    out[index] = x * cos - y * sin + dx;
    out[index + 1] = x * sin + y * cos + dy;
  }
  return out;
}

/** Sutherland–Hodgman clip of a ring to an axis-aligned box. Winding is preserved; empty results return null. */
export function clipRingToBox(ring: Ring, x0: number, y0: number, x1: number, y1: number): Ring | null {
  let points: number[] = Array.from(ring);
  const edges: [number, number, boolean][] = [[0, x0, true], [0, x1, false], [1, y0, true], [1, y1, false]];
  for (const [axis, limit, keepGreater] of edges) {
    if (points.length < 6) return null;
    const input = points;
    points = [];
    const count = input.length;
    for (let index = 0; index < count; index += 2) {
      const ax = input[index];
      const ay = input[index + 1];
      const next = (index + 2) % count;
      const bx = input[next];
      const by = input[next + 1];
      const av = axis === 0 ? ax : ay;
      const bv = axis === 0 ? bx : by;
      const aIn = keepGreater ? av >= limit : av <= limit;
      const bIn = keepGreater ? bv >= limit : bv <= limit;
      if (aIn) points.push(ax, ay);
      if (aIn !== bIn) {
        const t = (limit - av) / (bv - av);
        points.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
  }
  if (points.length < 6 || Math.abs(signedArea(points)) < 1e-9) return null;
  return Float32Array.from(points);
}

/**
 * Offsets a simple polygon inward by `distance` with mitred joins (bevelled
 * beyond a 3× miter). Used for bordures and cloth borders on convex or gently
 * concave outlines. Returns a ring with the same winding as the input.
 */
export function insetRing(ring: Ring, distance: number): Ring {
  const count = ring.length / 2;
  const orientation = signedArea(ring) >= 0 ? 1 : -1;
  const out: number[] = [];
  for (let index = 0; index < count; index++) {
    const prev = (index + count - 1) % count;
    const next = (index + 1) % count;
    const px = ring[prev * 2], py = ring[prev * 2 + 1];
    const cx = ring[index * 2], cy = ring[index * 2 + 1];
    const nx = ring[next * 2], ny = ring[next * 2 + 1];
    let e1x = cx - px, e1y = cy - py;
    let e2x = nx - cx, e2y = ny - cy;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // Inward normals: for positive (y-down shoelace) area the interior lies to the right of each edge.
    const n1x = -e1y * orientation, n1y = e1x * orientation;
    const n2x = -e2y * orientation, n2y = e2x * orientation;
    const bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    const cos = bl / 2;
    if (bl < 1e-6 || 1 / Math.max(cos, 1e-6) > 3) {
      out.push(cx + n1x * distance, cy + n1y * distance, cx + n2x * distance, cy + n2y * distance);
    } else {
      const miter = distance / cos;
      out.push(cx + (bx / bl) * miter, cy + (by / bl) * miter);
    }
  }
  return Float32Array.from(out);
}
