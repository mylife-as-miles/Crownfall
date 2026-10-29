// Ground clutter kit: heather clumps, grass tufts and boulders scattered on open
// ground around the holding by surface type (heath, grass, rock and steep ground),
// rejecting roads, water, buildings, walls and paved platforms. Breaks up terrain
// that would otherwise read as flat colour at landmark distances.

import { distanceToPolyline, pointInPolygon, shapePolygon } from "../../blueprint";
import { chamferBox, fbm2, lathe, MeshBuilder, Rng } from "../../kernel";
import type { MeshBuffer } from "../../kernel";
import type { KitContext } from "../context";

type ClutterKind = "heather" | "tuft" | "boulder";

function clutterPrototype(kind: ClutterKind): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("clutter").shadows(kind === "boulder", true);
  const r = Rng.fromKey(`clutter:${kind}`);
  if (kind === "boulder") {
    b.material("stone-generic");
    b.uvMode = "world";
    for (let i = 0; i < 2; i++) {
      b.color(0.8 + r.next() * 0.3, 0.8 + r.next() * 0.25, 0.85 + r.next() * 0.25);
      b.push();
      b.transform(i * 0.5 - 0.2, -0.15, r.jitter(0.3), r.next() * 3, r.jitter(0.25), r.jitter(0.25));
      chamferBox(b, 0, 0, 0, 0.9 + r.next() * 0.6, 0.55 + r.next() * 0.4, 0.8 + r.next() * 0.5, 0.18);
      b.pop();
    }
  } else if (kind === "heather") {
    b.material("foliage-heath");
    // Two low lobes of five facets: ~60 triangles a clump, so dense heath stays cheap.
    for (let i = 0; i < 2; i++) {
      b.color(0.72 + i * 0.2, 0.7 + i * 0.16, 0.72 + i * 0.16);
      b.push();
      b.transform(i * 0.22 - 0.11 + r.jitter(0.08), 0, r.jitter(0.2), r.next() * 3, 0, 0, 0.36 + r.next() * 0.15, 0.22 + r.next() * 0.1, 0.34 + r.next() * 0.15);
      lathe(b, [[0.02, -0.2], [1, 0.1], [0.7, 0.75], [0.02, 1]], 5, { smooth: true });
      b.pop();
    }
  } else {
    b.material("foliage-broadleaf");
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r.next();
      b.color(0.85, 0.95, 0.75);
      b.push();
      b.transform(Math.sin(a) * 0.06, 0, Math.cos(a) * 0.06, a, r.jitter(0.35), r.jitter(0.35));
      lathe(b, [[0.03, 0], [0.005, 0.35 + r.next() * 0.2]], 3, { smooth: false });
      b.pop();
    }
  }
  return b.finish();
}

export function buildClutter(ctx: KitContext): void {
  const { bp, quality, instances } = ctx;
  const q = quality.vegetation * quality.vegetation;
  if (q <= 0.05) return;
  const center = bp.vr.displayCenter;
  const radius = 150;
  const roads = bp.routes.map((r) => ({ pts: r.points, half: r.width / 2 + 0.8 }));
  const walls = bp.walls.map((w) => ({ pts: w.points, half: w.thickness / 2 + 0.8 }));
  const paved = bp.terrain.features.filter((f) => f.kind === "platform" && (f.surface === "paving" || f.surface === "cobble")).map((f) => (f.kind === "platform" ? shapePolygon(f.shape) : []));
  const caps: Record<ClutterKind, number> = { heather: Math.round(3200 * q), tuft: Math.round(2200 * q), boulder: Math.round(420 * Math.sqrt(q)) };
  const counts: Record<ClutterKind, number> = { heather: 0, tuft: 0, boulder: 0 };
  const defined = new Set<ClutterKind>();
  const define = (kind: ClutterKind): string => {
    const key = `clutter:${kind}`;
    if (!defined.has(kind)) {
      instances.define({ key, part: "clutter", castShadow: kind === "boulder", receiveShadow: true, lod: 0, motion: null, gate: null, build: () => clutterPrototype(kind) });
      defined.add(kind);
    }
    return key;
  };
  const rng = new Rng(7717);
  const step = 1.6;
  for (let z = center[1] - radius; z < center[1] + radius; z += step) {
    for (let x = center[0] - radius; x < center[0] + radius; x += step) {
      const px = x + rng.jitter(step * 0.45), pz = z + rng.jitter(step * 0.45);
      const dx = px - center[0], dz = pz - center[1];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius) continue;
      const falloff = 1 - Math.max(0, (d - radius * 0.6) / (radius * 0.4));
      const surf = ctx.terrain.surface(px, pz);
      const slope = ctx.terrain.slope(px, pz);
      let kind: ClutterKind | null = null;
      let p = 0;
      if (surf === "rock" || surf === "scree" || slope > 0.7) {
        kind = "boulder";
        p = 0.05;
      } else if (surf === "heath" || surf === "moss") {
        kind = "heather";
        p = 0.4 * fbm2(px / 14, pz / 14, 3, 3);
      } else if (surf === "grass" || surf === "meadow") {
        kind = "tuft";
        p = 0.32 * fbm2(px / 9, pz / 9, 5, 3);
      }
      if (!kind || counts[kind] >= caps[kind]) continue;
      if (rng.next() > p * falloff * (kind === "boulder" ? 1 : q * 1.6)) continue;
      if (!Number.isNaN(ctx.terrain.waterLevel(px, pz))) continue;
      if (ctx.masses.inFootprint(px, pz, 1.2)) continue;
      let blocked = false;
      for (const r of roads) if (distanceToPolyline([px, pz], r.pts) < r.half) { blocked = true; break; }
      if (blocked) continue;
      for (const w of walls) if (distanceToPolyline([px, pz], w.pts) < w.half) { blocked = true; break; }
      if (blocked) continue;
      for (const poly of paved) if (poly.length > 2 && pointInPolygon([px, pz], poly)) { blocked = true; break; }
      if (blocked) continue;
      const key = define(kind);
      const s = kind === "boulder" ? 0.6 + rng.next() * 1.4 : 0.7 + rng.next() * 0.8;
      const t = 0.85 + rng.next() * 0.3;
      instances.add(key, px, ctx.ground(px, pz) - 0.05, pz, rng.next() * 6.28, s, [t, t * (0.96 + rng.next() * 0.08), t]);
      counts[kind]++;
    }
  }
}
