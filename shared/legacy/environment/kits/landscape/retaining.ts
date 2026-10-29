// Retaining walls along levelled platforms (edge "retaining-wall"): solid masonry
// that covers the terrain's blend band, battered on the low side (fill) or facing
// the platform where the platform is cut into rising ground. Stretches already
// carried by a curtain or town wall are left to the fortification kit.

import type { TerrainFeature, Vec2 } from "../../blueprint";
import { distanceToPolyline, shapePolygon } from "../../blueprint";
import { signedArea2 } from "../../kernel";
import type { KitContext } from "../context";

type Platform = Extract<TerrainFeature, { kind: "platform" }>;

export function buildRetainingWalls(ctx: KitContext): void {
  const { bp, b } = ctx;
  const walls = bp.walls.filter((w) => w.kind === "curtain" || w.kind === "town-wall" || w.kind === "rampart");
  // Elevated stairs are solid flights built against the retaining walls; leave their strip to them.
  const stairs = bp.routes.filter((r) => r.kind === "stair" && r.grade === "elevated").map((r) => ({ pts: r.points, half: r.width / 2 + 0.6 }));
  b.part("settlement", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  for (const f of bp.terrain.features) {
    if (f.kind !== "platform" || f.edge !== "retaining-wall") continue;
    buildPlatformEdge(ctx, f, walls.map((w) => w.points), stairs);
  }
}

function buildPlatformEdge(ctx: KitContext, f: Platform, wallLines: (readonly Vec2[])[], stairs: { pts: readonly Vec2[]; half: number }[]): void {
  const { b } = ctx;
  const raw = shapePolygon(f.shape);
  // Positive orientation so the outward normal of every edge is (tz, -tx).
  const poly = signedArea2(raw) > 0 ? raw : raw.slice().reverse();
  const top = f.elevation;
  b.material(ctx.mat(top >= 4 ? ctx.style.keys.ashlar : ctx.style.keys.rubble));
  const n = poly.length;
  const off = f.falloff + 0.3;
  // Per-edge record of whether the first and last sections were built as fill, so
  // convex corners can be closed with a wedge that shares their end vertices.
  const firstFill: boolean[] = new Array(n).fill(false);
  const lastFill: boolean[] = new Array(n).fill(false);
  const probeAt = (p: Vec2, ox: number, oz: number): number => ctx.terrain.height(p[0] + ox * (off + 1.2), p[1] + oz * (off + 1.2));
  const batterAt = (h: number): number => Math.max(0, top - h) / 14;
  // Close the open end of a fill run where it stops: dir +1 faces along the edge, -1 back.
  const cap = (p: Vec2, h: number, ox: number, oz: number, dir: 1 | -1): void => {
    const bat = batterAt(h);
    const yb = h - 0.7;
    const fo: Vec2 = [p[0] + ox * (off + bat), p[1] + oz * (off + bat)];
    const ft: Vec2 = [p[0] + ox * off, p[1] + oz * off];
    if (dir > 0) b.flatQuad(p[0], yb, p[1], fo[0], yb, fo[1], ft[0], top + 0.04, ft[1], p[0], top + 0.04, p[1]);
    else b.flatQuad(fo[0], yb, fo[1], p[0], yb, p[1], p[0], top + 0.04, p[1], ft[0], top + 0.04, ft[1]);
  };
  for (let i = 0; i < n; i++) {
    const a = poly[i], c = poly[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) continue;
    const tx = dx / len, tz = dz / len;
    const ox = tz, oz = -tx;
    const steps = Math.max(1, Math.ceil(len / 1.4));
    let prevFill = false;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const p0: Vec2 = [a[0] + dx * t0, a[1] + dz * t0];
      const p1: Vec2 = [a[0] + dx * t1, a[1] + dz * t1];
      const mid: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      let covered = false;
      for (const line of wallLines) if (distanceToPolyline(mid, line) < 2.6) covered = true;
      for (const st of stairs) if (distanceToPolyline(mid, st.pts) < st.half + 1.2) covered = true;
      const h0 = probeAt(p0, ox, oz), h1 = probeAt(p1, ox, oz);
      const hm = (h0 + h1) / 2;
      const fill = !covered && hm < top - 0.35;
      const cut = !covered && hm > top + 0.35;
      if (fill) {
        if (s === 0) firstFill[i] = true;
        if (s === steps - 1) lastFill[i] = true;
        // Fill: outer face at `off`, battered 1:14 from each end's own low ground, so
        // neighbouring sections share their end vertices exactly (no hairline gaps).
        const yb0 = h0 - 0.7, yb1 = h1 - 0.7;
        const b0 = batterAt(h0), b1 = batterAt(h1);
        const fo0: Vec2 = [p0[0] + ox * (off + b0), p0[1] + oz * (off + b0)];
        const fo1: Vec2 = [p1[0] + ox * (off + b1), p1[1] + oz * (off + b1)];
        const ft0: Vec2 = [p0[0] + ox * off, p0[1] + oz * off];
        const ft1: Vec2 = [p1[0] + ox * off, p1[1] + oz * off];
        // Outer face (normal points outward).
        b.flatQuad(fo1[0], yb1, fo1[1], fo0[0], yb0, fo0[1], ft0[0], top + 0.04, ft0[1], ft1[0], top + 0.04, ft1[1]);
        // Coping / top from the edge to the outer face.
        b.flatQuad(p0[0], top + 0.04, p0[1], p1[0], top + 0.04, p1[1], ft1[0], top + 0.04, ft1[1], ft0[0], top + 0.04, ft0[1]);
        if (!prevFill && s > 0) cap(p0, h0, ox, oz, -1);
      } else if (prevFill) {
        cap(p0, h0, ox, oz, 1);
      }
      if (cut) {
        // Cut: face looks back over the platform, holding the higher ground.
        const yt0 = h0 + 0.25, yt1 = h1 + 0.25;
        b.flatQuad(p0[0], top - 0.3, p0[1], p1[0], top - 0.3, p1[1], p1[0], yt1, p1[1], p0[0], yt0, p0[1]);
        const bo0: Vec2 = [p0[0] + ox * off, p0[1] + oz * off];
        const bo1: Vec2 = [p1[0] + ox * off, p1[1] + oz * off];
        b.flatQuad(p1[0], yt1, p1[1], bo1[0], yt1, bo1[1], bo0[0], yt0, bo0[1], p0[0], yt0, p0[1]);
      }
      prevFill = fill;
    }
  }
  // Convex corners between two fill edges: a wedge face and coping triangle.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!lastFill[i] && !firstFill[j]) continue;
    const a = poly[i], v = poly[j], c = poly[(j + 1) % n];
    const l0 = Math.hypot(v[0] - a[0], v[1] - a[1]), l1 = Math.hypot(c[0] - v[0], c[1] - v[1]);
    if (l0 < 0.5 || l1 < 0.5) continue;
    const t0x = (v[0] - a[0]) / l0, t0z = (v[1] - a[1]) / l0;
    const t1x = (c[0] - v[0]) / l1, t1z = (c[1] - v[1]) / l1;
    const o0x = t0z, o0z = -t0x, o1x = t1z, o1z = -t1x;
    // A run that stops at the corner gets an end cap instead of a wedge.
    if (lastFill[i] !== firstFill[j]) {
      if (lastFill[i]) cap(v, probeAt(v, o0x, o0z), o0x, o0z, 1);
      else cap(v, probeAt(v, o1x, o1z), o1x, o1z, -1);
      continue;
    }
    if (t0x * o1x + t0z * o1z <= 0.02) continue; // concave or straight: faces already meet
    const hA = probeAt(v, o0x, o0z), hB = probeAt(v, o1x, o1z);
    const bA = batterAt(hA), bB = batterAt(hB);
    const Ab: Vec2 = [v[0] + o0x * (off + bA), v[1] + o0z * (off + bA)];
    const Bb: Vec2 = [v[0] + o1x * (off + bB), v[1] + o1z * (off + bB)];
    const At: Vec2 = [v[0] + o0x * off, v[1] + o0z * off];
    const Bt: Vec2 = [v[0] + o1x * off, v[1] + o1z * off];
    b.flatQuad(Bb[0], hB - 0.7, Bb[1], Ab[0], hA - 0.7, Ab[1], At[0], top + 0.04, At[1], Bt[0], top + 0.04, Bt[1]);
    b.flatTri(v[0], top + 0.04, v[1], Bt[0], top + 0.04, Bt[1], At[0], top + 0.04, At[1]);
  }
}
