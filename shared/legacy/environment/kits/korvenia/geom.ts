// Geometry helpers for the production nation's settlement kits: beams between two points,
// lumpy organic volumes (foliage, rocks, rubble heaps), planks and thatch rolls. Everything
// emits through the shared MeshBuilder in local metres; callers set material, colour and
// transforms. Pure and deterministic.

import { box, noise3 } from "../../kernel";
import type { MeshBuilder } from "../../kernel";

export type V3 = readonly [number, number, number];

/** A rectangular member of section w × h (local x × y) running from a to c. */
export function beam(b: MeshBuilder, a: V3, c: V3, w: number, h: number, roll = 0, ends = true): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) return;
  const hor = Math.sqrt(dx * dx + dz * dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, hor);
  b.push();
  b.transform((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, hor < 1e-6 ? 0 : yaw, hor < 1e-6 ? (dy > 0 ? -Math.PI / 2 : Math.PI / 2) : pitch, roll);
  box(b, 0, -h / 2, 0, w, h, len, { top: true, bottom: true, skipSides: ends ? undefined : [] });
  b.pop();
}

/** Vertical post of section s from y0 to y1 at (x, z). */
export function post(b: MeshBuilder, x: number, z: number, y0: number, y1: number, s: number, sz = s): void {
  if (y1 <= y0) return;
  box(b, x, y0, z, s, y1 - y0, sz, { top: true });
}

/**
 * Lumpy ellipsoid with radii (rx, ry, rz) at (x, y, z): a UV sphere whose vertices are pushed
 * in and out by world-stable 3D noise (foliage clumps, boulders, rubble heaps). `flat` squashes
 * the underside; `rough` is the displacement fraction. Normals come from the displaced shape.
 */
export function lump(b: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, seg = 7, rings = 4, rough = 0.22, flat = 0): void {
  const P: number[] = [];
  const rowLen = seg + 1;
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = -Math.PI / 2 + v * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const th = ((s % seg) / seg) * Math.PI * 2;
      let ux = Math.cos(phi) * Math.sin(th), uy = Math.sin(phi), uz = Math.cos(phi) * Math.cos(th);
      if (flat > 0 && uy < 0) uy *= 1 - flat;
      const n = r === 0 || r === rings ? 0 : noise3(ux * 1.7 + seed * 0.13, uy * 1.7 + seed * 0.07, uz * 1.7 - seed * 0.11, seed) * 2 - 1;
      const k = 1 + n * rough;
      ux *= k; uy *= k; uz *= k;
      P.push(x + ux * rx, y + uy * ry, z + uz * rz);
    }
  }
  const idx: number[] = [];
  const at = (r: number, s: number): number => (r * rowLen + s) * 3;
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= seg; s++) {
      // Normal from the neighbouring ring and column (central differences on the displaced grid).
      const r0 = Math.max(0, r - 1), r1 = Math.min(rings, r + 1);
      const s0 = s === 0 ? seg - 1 : s - 1, s1 = s === seg ? 1 : s + 1;
      const a = at(r0, s), c = at(r1, s), d = at(r, s0), e = at(r, s1);
      const tx = P[c] - P[a], ty = P[c + 1] - P[a + 1], tz = P[c + 2] - P[a + 2];
      const ux = P[e] - P[d], uy = P[e + 1] - P[d + 1], uz = P[e + 2] - P[d + 2];
      let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx;
      const o = at(r, s);
      // Poles: point outward along the axis.
      if (r === 0 || r === rings) { nx = 0; ny = r === 0 ? -1 : 1; nz = 0; }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      // Keep normals pointing away from the centre.
      const ox = P[o] - x, oy = P[o + 1] - y, oz = P[o + 2] - z;
      const sgn = nx * ox + ny * oy + nz * oz < 0 ? -1 : 1;
      idx.push(b.vertex(P[o], P[o + 1], P[o + 2], (nx / l) * sgn, (ny / l) * sgn, (nz / l) * sgn, s / seg, r / rings));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const i0 = idx[r * rowLen + s], i1 = idx[r * rowLen + s + 1];
      const i2 = idx[(r + 1) * rowLen + s + 1], i3 = idx[(r + 1) * rowLen + s];
      if (r === 0) b.tri(i0, i2, i3);
      else if (r === rings - 1) b.tri(i0, i1, i3);
      else b.quad(i0, i1, i2, i3);
    }
  }
}

/** Rough block: a box whose eight corners are jittered (boulders, salvaged stone, rubble). */
export function roughBlock(b: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, seed: number, jitter = 0.18): void {
  const j = (i: number, k: number): number => (noise3(i * 3.1 + seed, k * 1.7, seed * 0.37, seed + 11) * 2 - 1) * jitter;
  const c: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : 0, sz = i & 4 ? 1 : -1;
    c.push([x + sx * (w / 2) * (1 + j(i, 0)), y + sy * h * (1 + j(i, 1) * (sy ? 1 : 0)), z + sz * (d / 2) * (1 + j(i, 2))]);
  }
  const q = (a: number, bb: number, cc: number, dd: number): void => {
    b.flatQuad(c[a][0], c[a][1], c[a][2], c[bb][0], c[bb][1], c[bb][2], c[cc][0], c[cc][1], c[cc][2], c[dd][0], c[dd][1], c[dd][2]);
  };
  q(4, 5, 7, 6); // +Z
  q(1, 0, 2, 3); // -Z
  q(5, 1, 3, 7); // +X
  q(0, 4, 6, 2); // -X
  q(6, 7, 3, 2); // top
}

/** Thick thatch or turf roll along local X (ridge rolls, eave bundles). */
export function roll(b: MeshBuilder, x0: number, x1: number, y: number, z: number, r: number, seg = 6): void {
  b.push();
  b.transform((x0 + x1) / 2, y, z, Math.PI / 2, 0, 0);
  const L = Math.abs(x1 - x0);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.flatQuad(Math.cos(a0) * r, Math.sin(a0) * r, -L / 2, Math.cos(a1) * r, Math.sin(a1) * r, -L / 2, Math.cos(a1) * r, Math.sin(a1) * r, L / 2, Math.cos(a0) * r, Math.sin(a0) * r, L / 2);
  }
  b.pop();
}
