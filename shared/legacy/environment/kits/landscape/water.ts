// Water kit: stream ribbons following their surface levels and still-water areas
// (ponds, cisterns), drawn with the shared water material.

import { distanceToPolyline } from "../../blueprint";
import type { Vec2 } from "../../blueprint";
import { cap } from "../../kernel";
import type { KitContext } from "../context";

export function buildWater(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("water", null).gate(null).shadows(false, true).material(ctx.mat("water"));
  b.uvMode = "world";
  b.motion({ kind: "flow", speed: 0.4 });
  for (const w of bp.terrain.water) {
    if (w.shape.kind === "area") {
      cap(b, w.shape.points, w.level, true);
      continue;
    }
    const pts = w.shape.points;
    const levels = w.pointLevels;
    const half = w.shape.width / 2;
    // Resample the polyline at ~2 m for smooth banks.
    const samples: { p: Vec2; y: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const y = levels && levels.length === pts.length ? levels[i] + (levels[i + 1] - levels[i]) * t : w.level;
        samples.push({ p: [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t], y });
      }
    }
    const last = pts[pts.length - 1];
    samples.push({ p: last, y: levels && levels.length === pts.length ? levels[levels.length - 1] : w.level });
    let prevL = -1, prevR = -1;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const a = samples[Math.max(0, i - 1)].p, c = samples[Math.min(samples.length - 1, i + 1)].p;
      let tx = c[0] - a[0], tz = c[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      // Keep the surface just below the carved bank so it never floats above the ground.
      const g = Math.min(ctx.terrain.height(s.p[0], s.p[1]) + 0.15, s.y);
      const lx = s.p[0] - tz * half, lz = s.p[1] + tx * half;
      const rx = s.p[0] + tz * half, rz = s.p[1] - tx * half;
      const L = b.vertex(lx, g, lz, 0, 1, 0, lx, lz);
      const R = b.vertex(rx, g, rz, 0, 1, 0, rx, rz);
      if (prevL >= 0) b.quad(prevL, L, R, prevR);
      prevL = L;
      prevR = R;
    }
    void distanceToPolyline;
  }
  b.motion(null);
}
