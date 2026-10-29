// Anti-generic primitives: chamfered and bevelled solids, prisms, lathes, lofts,
// arched openings, stairs, crenellation and string courses. Everything emits through
// a MeshBuilder in local metres; callers position pieces with the builder's
// transform stack. Plan outlines are [x, z] pairs; elevations are [x, y] pairs.

import type { MeshBuilder } from "./builder";
import { offsetPolygon, signedArea2, triangulate } from "./triangulate";
import type { P2 } from "./triangulate";

/** Returns the outline with positive shoelace area in (x, z) (see prism winding notes). */
export function orientPositive(points: readonly P2[]): P2[] {
  return signedArea2(points) >= 0 ? points.slice() : points.slice().reverse();
}

export function rectOutline(w: number, d: number, cx = 0, cz = 0): P2[] {
  const hw = w / 2, hd = d / 2;
  return [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
}

/** Rectangle with chamfered corners (8 points). */
export function chamferRect(w: number, d: number, c: number, cx = 0, cz = 0): P2[] {
  const hw = w / 2, hd = d / 2;
  const k = Math.min(c, hw * 0.45, hd * 0.45);
  return [
    [cx - hw + k, cz - hd], [cx + hw - k, cz - hd], [cx + hw, cz - hd + k], [cx + hw, cz + hd - k],
    [cx + hw - k, cz + hd], [cx - hw + k, cz + hd], [cx - hw, cz + hd - k], [cx - hw, cz - hd + k],
  ];
}

export function circleOutline(r: number, segments: number, phase = 0, cx = 0, cz = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = phase + (i / segments) * Math.PI * 2;
    out.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]);
  }
  return out;
}

export interface PrismOptions {
  top?: boolean;
  bottom?: boolean;
  /** Smooth normals around the outline (round towers). Forces explicit UVs. */
  smooth?: boolean;
  /** Skip side faces whose index is listed (e.g. faces hidden against a neighbour). */
  skipSides?: readonly number[];
  /** Side faces point inward (inner face of a parapet or courtyard). */
  inward?: boolean;
}

/** Vertical extrusion of a plan outline between y0 and y1. */
export function prism(b: MeshBuilder, outline: readonly P2[], y0: number, y1: number, opts: PrismOptions = {}): void {
  const pts = orientPositive(outline);
  const n = pts.length;
  if (n < 3 || y1 <= y0) return;
  const smooth = opts.smooth === true;
  if (smooth) {
    const prevMode = b.uvMode;
    b.uvMode = "explicit";
    const normals: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      normals.push([dz / l, -dx / l]);
    }
    let u = 0;
    const cols: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const a = normals[(k + n - 1) % n], c = normals[k];
      let nx = a[0] + c[0], nz = a[1] + c[1];
      const l = Math.sqrt(nx * nx + nz * nz) || 1;
      nx /= l;
      nz /= l;
      if (i > 0) {
        const p = pts[i - 1], q = pts[k];
        u += Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
      }
      const v0 = b.vertex(pts[k][0], y0, pts[k][1], nx, 0, nz, u, y0);
      b.vertex(pts[k][0], y1, pts[k][1], nx, 0, nz, u, y1);
      cols.push(v0);
    }
    // Columns run along positive-area order; quads (next,y0)->(cur,y0)->(cur,y1)->(next,y1) face outward.
    for (let i = 0; i < n; i++) {
      const cur = cols[i], next = cols[i + 1];
      b.quad(next, cur, cur + 1, next + 1);
    }
    b.uvMode = prevMode;
  } else {
    const skip = opts.skipSides;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const len = Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
      if (!skip || skip.indexOf(i) < 0) {
        if (opts.inward) b.flatQuad(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1], [u, y0, u + len, y0, u + len, y1, u, y1]);
        else b.flatQuad(q[0], y0, q[1], p[0], y0, p[1], p[0], y1, p[1], q[0], y1, q[1], [u + len, y0, u, y0, u, y1, u + len, y1]);
      }
      u += len;
    }
  }
  if (opts.top !== false) cap(b, pts, y1, true);
  if (opts.bottom === true) cap(b, pts, y0, false);
}

/** Horizontal cap of a positive-area outline: up = true faces +Y. */
export function cap(b: MeshBuilder, outline: readonly P2[], y: number, up: boolean): void {
  const pts = orientPositive(outline);
  const tris = triangulate(pts);
  const ny = up ? 1 : -1;
  const base: number[] = [];
  for (const p of pts) base.push(b.vertex(p[0], y, p[1], 0, ny, 0, p[0], p[1]));
  for (let i = 0; i < tris.length; i += 3) {
    if (up) b.tri(base[tris[i]], base[tris[i + 2]], base[tris[i + 1]]);
    else b.tri(base[tris[i]], base[tris[i + 1]], base[tris[i + 2]]);
  }
}

/** Axis-aligned box with its base centred at (cx, y0, cz). */
export function box(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, h: number, d: number, opts: PrismOptions = {}): void {
  prism(b, rectOutline(w, d, cx, cz), y0, y0 + h, { top: opts.top, bottom: opts.bottom, skipSides: opts.skipSides });
}

/** Box with chamfered vertical edges. */
export function chamferBox(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, h: number, d: number, chamfer: number, opts: PrismOptions = {}): void {
  prism(b, chamferRect(w, d, chamfer, cx, cz), y0, y0 + h, opts);
}

/** Prism whose top edge is chamfered by `bevel` (weathered copings, plinth tops). */
export function bevelPrism(b: MeshBuilder, outline: readonly P2[], y0: number, y1: number, bevel: number, opts: { bottom?: boolean } = {}): void {
  const pts = orientPositive(outline);
  const bv = Math.min(bevel, (y1 - y0) * 0.5);
  prism(b, pts, y0, y1 - bv, { top: false, bottom: opts.bottom });
  const inner = orientPositive(offsetPolygon(pts, -bv));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const pi = inner[i], qi = inner[(i + 1) % n];
    b.flatQuad(q[0], y1 - bv, q[1], p[0], y1 - bv, p[1], pi[0], y1, pi[1], qi[0], y1, qi[1]);
  }
  cap(b, inner, y1, true);
}

export interface LatheOptions {
  phase?: number;
  /** Smooth around the axis (true) or faceted (false). */
  smooth?: boolean;
  capTop?: boolean;
  capBottom?: boolean;
}

/** Surface of revolution of a profile [radius, y] listed bottom to top. */
export function lathe(b: MeshBuilder, profile: readonly P2[], segments: number, opts: LatheOptions = {}): void {
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const phase = opts.phase ?? 0;
  const smooth = opts.smooth !== false;
  for (let k = 0; k < profile.length - 1; k++) {
    const r0 = profile[k][0], y0 = profile[k][1];
    const r1 = profile[k + 1][0], y1 = profile[k + 1][1];
    const dr = r1 - r0, dy = y1 - y0;
    const pl = Math.sqrt(dr * dr + dy * dy) || 1;
    const pnr = dy / pl, pny = -dr / pl;
    const vStart = y0, vEnd = y0 + pl;
    if (smooth) {
      const ring: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = phase + (i / segments) * Math.PI * 2;
        const s = Math.sin(a), c = Math.cos(a);
        const u = (i / segments) * Math.PI * 2 * Math.max(r0, r1, 0.01);
        const v0 = b.vertex(s * r0, y0, c * r0, s * pnr, pny, c * pnr, u, vStart);
        b.vertex(s * r1, y1, c * r1, s * pnr, pny, c * pnr, u, vEnd);
        ring.push(v0);
      }
      for (let i = 0; i < segments; i++) {
        const a = ring[i], c = ring[i + 1];
        b.quad(a, c, c + 1, a + 1);
      }
    } else {
      for (let i = 0; i < segments; i++) {
        const a0 = phase + (i / segments) * Math.PI * 2;
        const a1 = phase + ((i + 1) / segments) * Math.PI * 2;
        const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
        const w = 2 * Math.max(r0, r1) * Math.sin(Math.PI / segments);
        b.flatQuad(s0 * r0, y0, c0 * r0, s1 * r0, y0, c1 * r0, s1 * r1, y1, c1 * r1, s0 * r1, y1, c0 * r1, [0, vStart, w, vStart, w, vEnd, 0, vEnd]);
      }
    }
  }
  const last = profile[profile.length - 1];
  if (opts.capTop && last[0] > 1e-4) {
    const c = b.vertex(0, last[1], 0, 0, 1, 0, 0, 0);
    const ring: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = phase + (i / segments) * Math.PI * 2;
      ring.push(b.vertex(Math.sin(a) * last[0], last[1], Math.cos(a) * last[0], 0, 1, 0, Math.sin(a) * last[0], Math.cos(a) * last[0]));
    }
    for (let i = 0; i < segments; i++) b.tri(c, ring[i], ring[i + 1]);
  }
  const first = profile[0];
  if (opts.capBottom && first[0] > 1e-4) {
    const c = b.vertex(0, first[1], 0, 0, -1, 0, 0, 0);
    const ring: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = phase + (i / segments) * Math.PI * 2;
      ring.push(b.vertex(Math.sin(a) * first[0], first[1], Math.cos(a) * first[0], 0, -1, 0, 0, 0));
    }
    for (let i = 0; i < segments; i++) b.tri(c, ring[i + 1], ring[i]);
  }
  b.uvMode = prevMode;
}

/**
 * Lofts closed rings (flat xyz arrays with equal point counts) with smooth normals.
 * Rings are listed along the loft axis; points within a ring run counter-clockwise
 * seen from the end the loft runs toward, so faces point outward.
 */
export function loft(b: MeshBuilder, rings: readonly (readonly number[])[], opts: { capStart?: boolean; capEnd?: boolean } = {}): void {
  const nr = rings.length;
  if (nr < 2) return;
  const np = rings[0].length / 3;
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  // Accumulate smooth normals.
  const normals = new Float64Array(nr * np * 3);
  const P = (r: number, i: number, k: number): number => rings[r][((i + np) % np) * 3 + k];
  for (let r = 0; r < nr - 1; r++) {
    for (let i = 0; i < np; i++) {
      const j = (i + 1) % np;
      const ax = P(r, i, 0), ay = P(r, i, 1), az = P(r, i, 2);
      const bx = P(r, j, 0), by = P(r, j, 1), bz = P(r, j, 2);
      const dx = P(r + 1, i, 0), dy = P(r + 1, i, 1), dz = P(r + 1, i, 2);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = dx - ax, vy = dy - ay, vz = dz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const [rr, ii] of [[r, i], [r, j], [r + 1, i], [r + 1, j]]) {
        const o = (rr * np + ii) * 3;
        normals[o] += nx;
        normals[o + 1] += ny;
        normals[o + 2] += nz;
      }
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < nr; r++) {
    for (let i = 0; i <= np; i++) {
      const ii = i % np;
      const o = (r * np + ii) * 3;
      let nx = normals[o], ny = normals[o + 1], nz = normals[o + 2];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      idx.push(b.vertex(P(r, ii, 0), P(r, ii, 1), P(r, ii, 2), nx, ny, nz, i / np, r / (nr - 1)));
    }
  }
  const stride = np + 1;
  for (let r = 0; r < nr - 1; r++) {
    for (let i = 0; i < np; i++) {
      const a = idx[r * stride + i], c = idx[r * stride + i + 1];
      const d = idx[(r + 1) * stride + i], e = idx[(r + 1) * stride + i + 1];
      b.quad(a, c, e, d);
    }
  }
  const capRing = (r: number, flip: boolean): void => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < np; i++) {
      cx += P(r, i, 0); cy += P(r, i, 1); cz += P(r, i, 2);
    }
    cx /= np; cy /= np; cz /= np;
    // Cap normal from the ring's average cross product.
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < np; i++) {
      const ax = P(r, i, 0) - cx, ay = P(r, i, 1) - cy, az = P(r, i, 2) - cz;
      const bx = P(r, i + 1, 0) - cx, by = P(r, i + 1, 1) - cy, bz = P(r, i + 1, 2) - cz;
      nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const s = flip ? -1 : 1;
    nx = (nx / l) * s; ny = (ny / l) * s; nz = (nz / l) * s;
    const c = b.vertex(cx, cy, cz, nx, ny, nz, 0.5, 0.5);
    const ring: number[] = [];
    for (let i = 0; i < np; i++) ring.push(b.vertex(P(r, i, 0), P(r, i, 1), P(r, i, 2), nx, ny, nz, 0, 0));
    for (let i = 0; i < np; i++) {
      if (flip) b.tri(c, ring[(i + 1) % np], ring[i]);
      else b.tri(c, ring[i], ring[(i + 1) % np]);
    }
  };
  if (opts.capStart) capRing(0, true);
  if (opts.capEnd) capRing(nr - 1, false);
  b.uvMode = prevMode;
}

/**
 * Filled flat polygon in the plane origin + u·uAxis + v·vAxis (normal = uAxis × vAxis).
 * `pts` are [u, v] pairs; winding is normalised so the face looks along the normal.
 */
export function panel(b: MeshBuilder, pts: readonly P2[], origin: readonly [number, number, number], uAxis: readonly [number, number, number], vAxis: readonly [number, number, number], uvScale = 1): void {
  const poly = signedArea2(pts) >= 0 ? pts.slice() : pts.slice().reverse();
  const tris = triangulate(poly);
  let nx = uAxis[1] * vAxis[2] - uAxis[2] * vAxis[1];
  let ny = uAxis[2] * vAxis[0] - uAxis[0] * vAxis[2];
  let nz = uAxis[0] * vAxis[1] - uAxis[1] * vAxis[0];
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const base: number[] = [];
  for (const p of poly) {
    base.push(b.vertex(origin[0] + uAxis[0] * p[0] + vAxis[0] * p[1], origin[1] + uAxis[1] * p[0] + vAxis[1] * p[1], origin[2] + uAxis[2] * p[0] + vAxis[2] * p[1], nx, ny, nz, p[0] * uvScale, p[1] * uvScale));
  }
  for (let i = 0; i < tris.length; i += 3) b.tri(base[tris[i]], base[tris[i + 1]], base[tris[i + 2]]);
}

/**
 * Pointed (lancet) or round arch window outline [x, y] from the sill centre:
 * width w, springing height s; k = arc radius / width (0.5 round, 1 equilateral).
 */
export function archOutline(w: number, s: number, k: number, segments = 6): P2[] {
  const R = Math.max(k, 0.5) * w;
  const hw = w / 2;
  const h = Math.sqrt(Math.max(R * R - (R - hw) * (R - hw), 0));
  const out: P2[] = [[-hw, 0], [hw, 0], [hw, s]];
  // Right arc: centred at (hw - R, s), from angle 0 up to the apex.
  const cxr = hw - R;
  const apexA = Math.atan2(h, -cxr);
  for (let i = 1; i <= segments; i++) {
    const a = (apexA * i) / segments;
    out.push([cxr + Math.cos(a) * R, s + Math.sin(a) * R]);
  }
  // Left arc mirrored, from the apex down to the left springing point (apex already added).
  for (let i = segments - 1; i >= 0; i--) {
    const a = (apexA * i) / segments;
    out.push([-(cxr + Math.cos(a) * R), s + Math.sin(a) * R]);
  }
  return out;
}

export interface OpeningOptions {
  /** Outline [x, y] in the wall plane, sill centre at the origin, wall normal +Z. */
  outline: readonly P2[];
  glassMaterial: string;
  frameMaterial: string;
  /** Surround width around the opening. */
  frame: number;
  /** How far the surround stands proud of the wall face (also the visual reveal depth). */
  proud: number;
  /** Optional sill projecting below the opening. */
  sill?: boolean;
  /** Colour multiplier for the glass/door leaf (lit windows use 1, dark ones less). */
  glassTint?: readonly [number, number, number];
  /** Mullion: vertical bar dividing the light (Gothic two-light windows). */
  mullion?: boolean;
}

/**
 * A window or door on a wall face: a glazed (or leaf) panel just proud of the face,
 * a projecting surround with inward-facing reveals, and an optional sill. Wall
 * faces cannot be cut, so the surround's projection supplies the depth.
 */
export function opening(b: MeshBuilder, o: OpeningOptions): void {
  const prevMode = b.uvMode;
  const tint = b.getColor();
  const pts = o.outline;
  // Glass / leaf.
  b.material(o.glassMaterial);
  b.uvMode = "explicit";
  if (o.glassTint) b.color(o.glassTint[0], o.glassTint[1], o.glassTint[2]);
  panel(b, pts, [0, 0, 0.012], [1, 0, 0], [0, 1, 0]);
  b.color(tint[0], tint[1], tint[2]);
  // Surround ring and reveals.
  b.material(o.frameMaterial);
  b.uvMode = "world";
  const outer = offsetPolygon(pts, o.frame);
  const n = pts.length;
  const z0 = 0.01, z1 = o.proud;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const po = outer[i], qo = outer[(i + 1) % n];
    // Front face of the surround (facing +Z).
    b.flatQuad(p[0], p[1], z1, po[0], po[1], z1, qo[0], qo[1], z1, q[0], q[1], z1);
    // Outer edge band (facing outward from the opening).
    b.flatQuad(qo[0], qo[1], z1, po[0], po[1], z1, po[0], po[1], z0, qo[0], qo[1], z0);
  }
  // Reveals face inward (toward the opening's centre), shaded as recesses.
  b.color(tint[0] * 0.62, tint[1] * 0.62, tint[2] * 0.62);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    b.flatQuad(p[0], p[1], z1, q[0], q[1], z1, q[0], q[1], z0, p[0], p[1], z0);
  }
  b.color(tint[0], tint[1], tint[2]);
  if (o.mullion) {
    let top = 0;
    for (const p of pts) top = Math.max(top, p[1]);
    box(b, 0, 0, z1 * 0.5, Math.max(o.frame * 0.55, 0.06), top * 0.86, z1 * 0.9);
  }
  if (o.sill) {
    let minX = Infinity, maxX = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
    }
    const w = maxX - minX + o.frame * 2.6;
    box(b, (minX + maxX) / 2, -o.frame * 0.9, z1 * 0.6, w, o.frame * 0.9, z1 * 1.6 + 0.04);
  }
  b.uvMode = prevMode;
}

/** Solid straight stair climbing along +Z from z = 0, base at y = 0, centred on x. */
export function stairs(b: MeshBuilder, width: number, steps: number, rise: number, run: number, opts: { sides?: boolean; base?: number } = {}): void {
  const hw = width / 2;
  const base = opts.base ?? 0;
  const prevMode = b.uvMode;
  b.uvMode = "world";
  for (let i = 0; i < steps; i++) {
    const z0 = i * run, z1 = (i + 1) * run;
    const y0 = i * rise, y1 = (i + 1) * rise;
    // Riser (faces -Z, toward the foot of the stair) and tread (faces up).
    b.flatQuad(hw, y0, z0, -hw, y0, z0, -hw, y1, z0, hw, y1, z0);
    b.flatQuad(-hw, y1, z1, hw, y1, z1, hw, y1, z0, -hw, y1, z0);
    if (opts.sides !== false) {
      b.flatQuad(-hw, base, z0, -hw, base, z1, -hw, y1, z1, -hw, y1, z0);
      b.flatQuad(hw, base, z1, hw, base, z0, hw, y1, z0, hw, y1, z1);
    }
  }
  b.uvMode = prevMode;
}

/**
 * Merlons along a straight wall top from (ax, az) to (bx, bz) at height y.
 * `keep(i)` may drop merlons (fallen crenels on weathered walls).
 */
export function crenellate(
  b: MeshBuilder, ax: number, az: number, bx: number, bz: number, y: number, thickness: number,
  merlonWidth: number, merlonHeight: number, gap: number, keep?: (i: number) => boolean,
): number {
  const dx = bx - ax, dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < merlonWidth) return 0;
  const count = Math.max(1, Math.floor((len + gap) / (merlonWidth + gap)));
  const used = count * merlonWidth + (count - 1) * gap;
  const start = (len - used) / 2 + merlonWidth / 2;
  const yaw = Math.atan2(dx, dz) - Math.PI / 2;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    if (keep && !keep(i)) continue;
    const t = (start + i * (merlonWidth + gap)) / len;
    b.push();
    b.transform(ax + dx * t, y, az + dz * t, yaw);
    chamferBox(b, 0, 0, 0, merlonWidth, merlonHeight, thickness, Math.min(0.05, merlonWidth * 0.1));
    b.pop();
    placed++;
  }
  return placed;
}

/** String course / water table: a projecting band around a plan outline. */
export function band(b: MeshBuilder, outline: readonly P2[], y: number, height: number, projection: number): void {
  const grown = offsetPolygon(orientPositive(outline), projection);
  bevelPrism(b, grown, y, y + height, Math.min(height * 0.5, projection), { bottom: true });
}
