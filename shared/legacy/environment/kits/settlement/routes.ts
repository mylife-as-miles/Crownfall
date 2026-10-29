// Circulation kit: paved road and street ribbons draped on the terrain (setts,
// cobbles, flagstones) with kerbs in town, and stairs: elevated flights from deck
// elevations (the Muster Stair) and stepped treads on graded ground.

import type { Route, Vec2 } from "../../blueprint";
import { box, triangulate } from "../../kernel";
import type { MeshBuilder } from "../../kernel";
import type { KitContext } from "../context";

const PAVED = new Set(["cobble", "setts", "flagstone", "sandstone-paving", "concrete", "asphalt", "steel-grate"]);

function materialFor(ctx: KitContext, r: Route): string {
  switch (r.surface) {
    case "setts": return ctx.mat("road-setts");
    case "flagstone":
    case "sandstone-paving": return ctx.mat("road-flagstone");
    default: return ctx.mat("road-cobble");
  }
}

function resample(points: readonly Vec2[], step: number): { p: Vec2; s: number; tx: number; tz: number }[] {
  const out: { p: Vec2; s: number; tx: number; tz: number }[] = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], c = points[i + 1];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-6) continue;
    const tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ p: [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t], s: acc + len * t, tx, tz });
    }
    acc += len;
  }
  const last = points[points.length - 1];
  const prev = out.length ? out[out.length - 1] : { tx: 1, tz: 0 };
  out.push({ p: last, s: acc, tx: prev.tx, tz: prev.tz });
  // Smooth tangents at corners.
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1].p, c = out[i + 1].p;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    out[i].tx = (c[0] - a[0]) / l;
    out[i].tz = (c[1] - a[1]) / l;
  }
  return out;
}

export function buildRoutes(ctx: KitContext): void {
  const { bp, b } = ctx;
  const e = ctx.terrain.model.extents;
  b.part("settlement", null).gate(null).shadows(false, true);
  for (const r of bp.routes) {
    if (r.kind === "stair") continue;
    if (r.grade === "elevated") continue;
    if (!PAVED.has(r.surface)) continue;
    b.material(materialFor(ctx, r));
    b.uvMode = "explicit";
    const samples = resample(r.points, 1.2);
    const half = r.width / 2;
    const across = 3;
    let prevRow: number[] | null = null;
    for (const s of samples) {
      const inside = s.p[0] >= e.minX && s.p[0] <= e.maxX && s.p[1] >= e.minZ && s.p[1] <= e.maxZ;
      if (!inside && !r.outer) {
        prevRow = null;
        continue;
      }
      const row: number[] = [];
      for (let k = 0; k <= across; k++) {
        const o = -half + (k / across) * r.width;
        const x = s.p[0] - s.tz * o, z = s.p[1] + s.tx * o;
        const y = ctx.ground(x, z) + (inside ? 0.05 : 0.12);
        row.push(b.vertex(x, y, z, 0, 1, 0, o, s.s));
      }
      if (prevRow) for (let k = 0; k < across; k++) b.quad(prevRow[k], prevRow[k + 1], row[k + 1], row[k]);
      prevRow = row;
      if (!inside && s.s > 2600) break;
    }
    // Kerbs on town streets.
    if ((r.kind === "street" || r.kind === "road") && !r.outer && ctx.quality.detail >= 1) {
      b.material(ctx.mat(ctx.style.keys.ashlar));
      b.uvMode = "world";
      for (let i = 0; i < samples.length - 1; i++) {
        const s = samples[i], n = samples[i + 1];
        const len = Math.hypot(n.p[0] - s.p[0], n.p[1] - s.p[1]);
        if (len < 0.2) continue;
        const yaw = Math.atan2(n.p[0] - s.p[0], n.p[1] - s.p[1]) - Math.PI / 2;
        for (const side of [1, -1]) {
          const mx = (s.p[0] + n.p[0]) / 2 - s.tz * side * (half + 0.12), mz = (s.p[1] + n.p[1]) / 2 + s.tx * side * (half + 0.12);
          const g = ctx.ground(mx, mz);
          b.push();
          b.transform(mx, g - 0.2, mz, yaw);
          box(b, 0, 0, 0, len + 0.05, 0.34, 0.24);
          b.pop();
        }
      }
    }
  }
  buildStairs(ctx);
}

function buildStairs(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("settlement", null).shadows(true, true);
  for (const r of bp.routes) {
    if (r.kind !== "stair") continue;
    b.material(ctx.mat(r.surface === "flagstone" ? ctx.style.keys.ashlar : ctx.style.keys.rubble));
    b.uvMode = "world";
    const pts = r.points;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.1) continue;
      const tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len;
      const yaw = Math.atan2(tx, tz);
      const y0 = r.deckY ? r.deckY[i] : ctx.ground(a[0], a[1]);
      const y1 = r.deckY ? r.deckY[i + 1] : ctx.ground(c[0], c[1]);
      const rise = y1 - y0;
      const steps = Math.max(1, Math.round(Math.abs(rise) / 0.19));
      if (Math.abs(rise) < 0.08) {
        // Landing.
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        const g = Math.min(ctx.ground(mx, mz), y0) - 0.6;
        b.push();
        b.transform(mx, 0, mz, yaw);
        box(b, 0, g, 0, r.width, y0 + 0.02 - g, len + 0.1);
        b.pop();
        acc += len;
        continue;
      }
      const run = len / steps;
      // Tread heights per step (the first tread sits one rise above the foot).
      const h: number[] = [];
      for (let s = 0; s < steps; s++) h.push(rise > 0 ? y0 + rise * ((s + 1) / steps) : y0 + rise * (s / steps));
      const margin = r.grade === "elevated" ? 0.5 : 0.35;
      const hw = r.width / 2;
      const elevated = r.grade === "elevated";
      // Ground under a local point (z along the flight, x across; local +X is world (tz, -tx)).
      const groundAt = (zl: number, xl: number): number => ctx.ground(a[0] + tx * zl + tz * xl, a[1] + tz * zl - tx * xl);
      const zs: number[] = [];
      const bot: number[] = [];
      const balBot: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const zl = k * run;
        zs.push(zl);
        const tread = Math.min(h[Math.max(0, k - 1)], h[Math.min(steps - 1, k)]);
        bot.push(Math.min(groundAt(zl, -hw), groundAt(zl, 0), groundAt(zl, hw), tread) - margin);
        balBot.push(Math.min(groundAt(zl, hw + 0.41), tread) - 0.4);
      }
      b.push();
      b.transform(a[0], 0, a[1], yaw);
      buildFlight(b, zs, h, bot, hw, !elevated);
      // Balustrade on the open side of elevated flights: one solid parapet with a sloped
      // coping, so no per-step pieces leave seams on its long face.
      if (elevated) buildParapet(b, zs, bot, balBot, h[0] + 1.0, h[steps - 1] + 1.0, hw - 0.01, hw + 0.41);
      b.pop();
      acc += len;
    }
  }
}

/**
 * One stair flight as a single solid: treads, risers, front and back faces and each side
 * as one stepped polygon whose vertices are shared with the treads, so long side faces
 * never show seams between steps. Local frame: z along the flight, x across, y up.
 */
export function buildFlight(b: MeshBuilder, zs: readonly number[], h: readonly number[], bot: readonly number[], hw: number, plusSide: boolean): void {
  const n = h.length;
  const len = zs[n];
  for (let s = 0; s < n; s++) b.flatQuad(-hw, h[s], zs[s + 1], hw, h[s], zs[s + 1], hw, h[s], zs[s], -hw, h[s], zs[s]);
  for (let k = 1; k < n; k++) {
    const lo = Math.min(h[k - 1], h[k]), hi = Math.max(h[k - 1], h[k]);
    if (hi - lo < 1e-4) continue;
    if (h[k] > h[k - 1]) b.flatQuad(hw, lo, zs[k], -hw, lo, zs[k], -hw, hi, zs[k], hw, hi, zs[k]);
    else b.flatQuad(-hw, lo, zs[k], hw, lo, zs[k], hw, hi, zs[k], -hw, hi, zs[k]);
  }
  b.flatQuad(hw, bot[0], 0, -hw, bot[0], 0, -hw, h[0], 0, hw, h[0], 0);
  b.flatQuad(-hw, bot[n], len, hw, bot[n], len, hw, h[n - 1], len, -hw, h[n - 1], len);
  // Side outline in (z, y): bottom forward, then the stepped top back to the start.
  const outline: [number, number][] = [];
  for (let k = 0; k <= n; k++) outline.push([zs[k], bot[k]]);
  for (let k = n - 1; k >= 0; k--) {
    outline.push([zs[k + 1], h[k]]);
    outline.push([zs[k], h[k]]);
  }
  sidePolygon(b, outline, -hw, -1);
  if (plusSide) sidePolygon(b, outline, hw, 1);
}

/** Solid parapet from x0 to x1 along the flight: sloped coping from yStart to yEnd. */
function buildParapet(b: MeshBuilder, zs: readonly number[], _bot: readonly number[], balBot: readonly number[], yStart: number, yEnd: number, x0: number, x1: number): void {
  const n = zs.length - 1;
  const len = zs[n];
  const outline: [number, number][] = [];
  for (let k = 0; k <= n; k++) outline.push([zs[k], balBot[k]]);
  outline.push([len, yEnd], [0, yStart]);
  sidePolygon(b, outline, x1, 1);
  sidePolygon(b, outline, x0, -1);
  b.flatQuad(x0, yEnd, len, x1, yEnd, len, x1, yStart, 0, x0, yStart, 0);
  b.flatQuad(x1, balBot[0], 0, x0, balBot[0], 0, x0, yStart, 0, x1, yStart, 0);
  b.flatQuad(x0, balBot[n], len, x1, balBot[n], len, x1, yEnd, len, x0, yEnd, len);
}

/**
 * A planar polygon in the (z, y) plane at x, facing -X (side -1) or +X (side +1). The
 * outline runs counter-clockwise with z to the right and y up.
 */
function sidePolygon(b: MeshBuilder, outline: readonly [number, number][], x: number, side: 1 | -1): void {
  const tris = triangulate(outline);
  const idx = outline.map(([z, y]) => b.vertex(x, y, z, side, 0, 0));
  for (let t = 0; t < tris.length; t += 3) {
    if (side < 0) b.tri(idx[tris[t]], idx[tris[t + 1]], idx[tris[t + 2]]);
    else b.tri(idx[tris[t]], idx[tris[t + 2]], idx[tris[t + 1]]);
  }
}
