// Ear-clipping triangulation of simple polygons (no holes) and polygon offsetting.
// Points are 2D [a, b] pairs in any plane; output indices refer to the input order.

export type P2 = readonly [number, number];

export function signedArea2(points: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInTri(px: number, py: number, a: P2, b: P2, c: P2): boolean {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Triangulates a simple polygon. Returned triangles keep the polygon's own winding
 * (counter-clockwise input → counter-clockwise triangles in the same 2D plane).
 */
export function triangulate(points: readonly P2[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  const ccw = signedArea2(points) > 0;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard < n * n) {
    guard++;
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = points[i0], b = points[i1], c = points[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (ccw ? cross <= 1e-12 : cross >= -1e-12) continue;
      let inside = false;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTri(points[k][0], points[k][1], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else if (idx.length > 3) {
    // Degenerate input: fan the remainder so callers still get a closed cap.
    for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
  }
  return out;
}

/**
 * Offsets a closed polygon by `d` (positive grows a counter-clockwise polygon,
 * using mitred corners clamped to 3× the offset).
 */
export function offsetPolygon(points: readonly P2[], d: number): [number, number][] {
  const n = points.length;
  const ccw = signedArea2(points) > 0;
  const s = ccw ? 1 : -1;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i + n - 1) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    let e0x = p1[0] - p0[0], e0y = p1[1] - p0[1];
    let e1x = p2[0] - p1[0], e1y = p2[1] - p1[1];
    const l0 = Math.sqrt(e0x * e0x + e0y * e0y) || 1;
    const l1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
    e0x /= l0; e0y /= l0; e1x /= l1; e1y /= l1;
    // Outward normals of a CCW polygon in (a, b): (eb, -ea).
    const n0x = e0y * s, n0y = -e0x * s;
    const n1x = e1y * s, n1y = -e1x * s;
    let mx = n0x + n1x, my = n0y + n1y;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml < 1e-9) {
      out.push([p1[0] + n0x * d, p1[1] + n0y * d]);
      continue;
    }
    mx /= ml;
    my /= ml;
    const cos = mx * n0x + my * n0y;
    const k = Math.min(3, 1 / Math.max(cos, 1e-3));
    out.push([p1[0] + mx * d * k, p1[1] + my * d * k]);
  }
  return out;
}
