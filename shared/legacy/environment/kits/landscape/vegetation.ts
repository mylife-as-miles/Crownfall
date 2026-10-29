// Vegetation kit: instanced tree, shrub, heath, hedge and garden prototypes scattered
// deterministically inside the blueprint's vegetation zones (jittered grid + seeded
// PRNG), rejecting roads, water, buildings, walls and steep crags. Far woods continue
// the scarp forest beyond the terrain extents so the crest never ends abruptly.

import type { VegetationZone, Vec2 } from "../../blueprint";
import { distanceToPolyline, pointInPolygon, polygonArea, polygonBounds, shapePolygon } from "../../blueprint";
import { fbm2, lathe, makePiece, MeshBuilder, Rng } from "../../kernel";
import type { MeshBuffer } from "../../kernel";
import type { KitContext } from "../context";

type ProtoKind = "conifer-a" | "conifer-b" | "broadleaf-a" | "broadleaf-b" | "yew" | "shrub" | "heath" | "hedge" | "garden" | "far-conifer";

function blob(b: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, rz: number, seg = 7, rings = 4): void {
  b.push();
  b.transform(x, y, z, 0, 0, 0, rx, ry, rz);
  const prof: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    prof.push([Math.max(0.02, Math.cos(a)), Math.sin(a)]);
  }
  lathe(b, prof, seg, { smooth: true });
  b.pop();
}

function shade(b: MeshBuilder, k: number, warm = 0): void {
  b.color(k * (1 + warm), k, k * (1 - warm));
}

/** Prototype meshes for one vegetation kind (instance-local, base at the origin). */
export function vegetationPrototype(kind: ProtoKind): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("vegetation").shadows(true, true);
  const r = Rng.fromKey(`veg:${kind}`);
  if (kind === "conifer-a" || kind === "far-conifer") {
    // Fir: a straight dark spire of drooping, uneven tiers.
    const h = kind === "far-conifer" ? 14 : 12.5;
    b.material("foliage-conifer");
    b.color(0.32, 0.27, 0.23);
    lathe(b, [[0.3, -0.4], [0.22, 2], [0.08, h * 0.72]], 5, { smooth: true });
    const tiers = kind === "far-conifer" ? 3 : 6;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const y0 = h * (0.2 + t * 0.66);
      const rad = 2.5 * (1 - t * 0.78) * (0.85 + r.next() * 0.3);
      shade(b, 0.5 + t * 0.5, -0.02);
      b.push();
      b.transform(r.jitter(0.25), 0, r.jitter(0.25), r.next() * 6, r.jitter(0.06), r.jitter(0.06));
      lathe(b, [[rad * 0.35, y0 - 0.15], [rad, y0 + 0.25], [rad * 0.55, y0 + h * 0.12], [0.05, y0 + h * 0.26]], 7, { smooth: false });
      b.pop();
    }
  } else if (kind === "conifer-b") {
    // Black pine: a tall bare trunk carrying a broad, uneven umbrella of needle clumps.
    const h = 13;
    b.material("foliage-conifer");
    b.color(0.34, 0.28, 0.24);
    lathe(b, [[0.32, -0.4], [0.24, h * 0.4], [0.12, h * 0.82]], 5, { smooth: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r.next();
      b.push();
      b.transform(0, h * 0.62, 0, a, 0, 0.9);
      lathe(b, [[0.08, 0], [0.04, h * 0.22]], 4, { smooth: false });
      b.pop();
    }
    // Two loose tiers of needle clumps: a rounded, irregular crown rather than flat plates.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.next() * 0.8;
      const top = i === 0;
      const rr = top ? 0 : (i % 2 ? 1.0 : 1.7) + r.next() * 0.6;
      const y = top ? h * 0.93 : h * (i % 2 ? 0.8 : 0.68) + r.next() * h * 0.06;
      shade(b, 0.5 + (y / h) * 0.42, -0.03);
      blob(b, Math.sin(a) * rr, y, Math.cos(a) * rr, 1.5 + r.next() * 0.6, 1.05 + r.next() * 0.4, 1.5 + r.next() * 0.6, 6, 3);
    }
  } else if (kind === "broadleaf-a" || kind === "broadleaf-b") {
    const h = kind === "broadleaf-a" ? 9 : 7;
    b.material("foliage-broadleaf");
    b.color(kind === "broadleaf-a" ? 0.62 : 0.36, kind === "broadleaf-a" ? 0.6 : 0.31, kind === "broadleaf-a" ? 0.56 : 0.27);
    lathe(b, [[0.24, -0.3], [0.16, h * 0.45], [0.08, h * 0.75]], 6, { smooth: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r.next();
      b.push();
      b.transform(0, h * 0.38, 0, a, 0, 0.7);
      lathe(b, [[0.09, 0], [0.04, h * 0.35]], 4, { smooth: false });
      b.pop();
    }
    const n = kind === "broadleaf-a" ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.next();
      const rr = i === 0 ? 0 : h * 0.18;
      const y = h * (0.62 + r.next() * 0.2) + (i === 0 ? h * 0.12 : 0);
      shade(b, 0.62 + (y / h) * 0.45, 0.02);
      blob(b, Math.sin(a) * rr, y, Math.cos(a) * rr, h * 0.2 + r.next() * 0.6, h * 0.16 + r.next() * 0.5, h * 0.2 + r.next() * 0.6, 6, 3);
    }
  } else if (kind === "yew") {
    // Old yew: a short, fluted trunk splitting into stems under a broad, uneven dome of
    // dense lobes, lit lighter on top so it reads as foliage rather than a dark mass.
    b.material("foliage-broadleaf");
    b.color(0.62, 0.4, 0.3);
    lathe(b, [[0.75, -0.3], [0.62, 0.4], [0.5, 1.4], [0.42, 2.2]], 9, { smooth: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r.next();
      b.push();
      b.transform(0, 1.9, 0, a, 0, 0.55);
      lathe(b, [[0.24, 0], [0.12, 2.1]], 5, { smooth: true });
      b.pop();
    }
    const lobes = 7;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + r.jitter(0.3);
      const rr = 1.7 + r.next() * 0.7;
      const y = 3.1 + r.next() * 1.2;
      b.color(0.72 + (y - 3) * 0.14, 0.86 + (y - 3) * 0.16, 0.7 + (y - 3) * 0.12);
      blob(b, Math.sin(a) * rr, y, Math.cos(a) * rr, 1.7 + r.next() * 0.5, 1.35 + r.next() * 0.4, 1.7 + r.next() * 0.5, 8, 4);
    }
    b.color(1.0, 1.16, 0.94);
    blob(b, r.jitter(0.4), 5.4, r.jitter(0.4), 2.1, 1.6, 2.1, 8, 4);
  } else if (kind === "shrub") {
    b.material("foliage-heath");
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r.next();
      shade(b, 0.7 + i * 0.12, 0.03);
      blob(b, Math.sin(a) * 0.45, 0.55 + r.next() * 0.3, Math.cos(a) * 0.45, 0.7, 0.62, 0.7, 6);
    }
  } else if (kind === "heath") {
    b.material("foliage-heath");
    shade(b, 0.85, 0.05);
    blob(b, 0, 0.12, 0, 0.55, 0.32, 0.55, 6);
  } else if (kind === "hedge") {
    b.material("foliage-broadleaf");
    for (let i = 0; i < 3; i++) {
      shade(b, 0.62 + i * 0.1);
      blob(b, (i - 1) * 1.1, 0.7, r.jitter(0.1), 0.95, 0.85, 0.75, 6);
    }
  } else {
    b.material("foliage-broadleaf");
    for (let i = 0; i < 4; i++) {
      shade(b, 0.9, 0.04);
      blob(b, (i - 1.5) * 0.55, 0.18, 0, 0.26, 0.24, 0.26, 5);
    }
  }
  return b.finish();
}

function protoKindsFor(zone: VegetationZone): ProtoKind[] {
  const sp = zone.species.toLowerCase();
  switch (zone.kind) {
    case "forest":
      return /pine|fir|spruce|conifer|cedar/.test(sp) ? ["conifer-a", "conifer-b"] : ["broadleaf-a", "broadleaf-b"];
    case "woodland":
      return ["broadleaf-a", "broadleaf-b"];
    case "orchard":
      return ["broadleaf-b"];
    case "lone-tree":
      return /yew/.test(sp) ? ["yew"] : ["broadleaf-a"];
    case "scrub":
      return ["shrub"];
    case "heath":
    case "moss-bank":
      return ["heath"];
    case "hedgerow":
      return ["hedge"];
    case "garden":
    case "planter":
    case "vine-terrace":
      return ["garden"];
    default:
      return ["shrub"];
  }
}

const MOTION = { kind: "sway" as const, amplitude: 0.1, frequency: 0.45 };

export function buildVegetation(ctx: KitContext): void {
  const { bp, quality, instances } = ctx;
  const q = quality.vegetation;
  if (q <= 0) return;
  const e = ctx.terrain.model.extents;
  const roads = bp.routes.filter((r) => !r.outer || r.hierarchy !== "national").map((r) => ({ pts: r.points, half: r.width / 2 + 1.2 }));
  const national = bp.routes.filter((r) => r.outer && r.hierarchy === "national").map((r) => ({ pts: r.points, half: r.width / 2 + 2 }));
  const walls = bp.walls.map((w) => ({ pts: w.points, half: w.thickness / 2 + 1.5 }));
  const water = bp.terrain.water;
  const platforms = bp.terrain.features.filter((f) => f.kind === "platform").map((f) => (f.kind === "platform" ? shapePolygon(f.shape) : []));
  const boundary = bp.settlementBoundary;
  const define = (kind: ProtoKind): string => {
    const key = `veg:${kind}`;
    instances.define({
      key,
      part: "vegetation",
      castShadow: kind !== "heath" && kind !== "garden",
      receiveShadow: true,
      lod: 0,
      motion: kind === "heath" || kind === "garden" ? null : MOTION,
      gate: null,
      build: () => vegetationPrototype(kind),
    });
    return key;
  };
  const okAt = (x: number, z: number, zone: VegetationZone, inTown: boolean): boolean => {
    if (x < e.minX + 1 || x > e.maxX - 1 || z < e.minZ + 1 || z > e.maxZ - 1) return false;
    if (ctx.masses.inFootprint(x, z, zone.kind === "garden" ? 0.4 : 1.6)) return false;
    for (const r of roads) if (distanceToPolyline([x, z], r.pts) < r.half) return false;
    for (const r of national) if (distanceToPolyline([x, z], r.pts) < r.half) return false;
    for (const w of walls) if (distanceToPolyline([x, z], w.pts) < w.half) return false;
    if (!Number.isNaN(ctx.terrain.waterLevel(x, z))) return false;
    if (zone.kind !== "lone-tree" && zone.kind !== "garden") {
      for (const p of platforms) if (p.length > 2 && pointInPolygon([x, z], p)) return false;
      if (!inTown && pointInPolygon([x, z], boundary)) return false;
    }
    if (zone.kind !== "scrub" && zone.kind !== "heath" && ctx.terrain.slope(x, z) > 1.25) return false;
    return true;
  };
  let budget = Math.round(2600 * q);
  for (const zone of bp.vegetation) {
    const kinds = protoKindsFor(zone);
    const keys = kinds.map(define);
    const poly = shapePolygon(zone.shape);
    const rng = new Rng(zone.seed * 7919 + 13);
    const inTown = zone.kind === "garden" || zone.kind === "lone-tree" || zone.kind === "planter";
    if (zone.kind === "lone-tree") {
      const c = poly.reduce((acc, p) => [acc[0] + p[0] / poly.length, acc[1] + p[1] / poly.length] as [number, number], [0, 0] as [number, number]);
      // The authored footprint sizes the tree (a 2 m plot carries a yew about 5 m across).
      const lb = polygonBounds(poly);
      const ext = Math.max(lb.maxX - lb.minX, lb.maxZ - lb.minZ);
      const ls = Math.max(0.55, Math.min(1.3, ext / 2.8));
      instances.add(keys[0], c[0], ctx.ground(c[0], c[1]) - 0.2, c[1], rng.next() * 6.28, ls);
      continue;
    }
    const area = Math.abs(polygonArea(poly));
    const small = zone.kind === "heath" || zone.kind === "garden";
    const density = zone.density * (small ? Math.min(1, q * 1.2) * 0.35 : q);
    let target = Math.round((area / 100) * density);
    if (small) target = Math.min(target, Math.round(900 * q));
    if (target <= 0) continue;
    const bounds = polygonBounds(poly);
    const cell = Math.sqrt(area / Math.max(target, 1));
    const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
    const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    let placed = 0;
    for (let j = 0; j < rows && placed < target; j++) {
      for (let i = 0; i < cols && placed < target; i++) {
        const x = bounds.minX + (i + 0.15 + rng.next() * 0.7) * cell;
        const z = bounds.minZ + (j + 0.15 + rng.next() * 0.7) * cell;
        if (!pointInPolygon([x, z], poly)) continue;
        // Clumping: woods break into stands and clearings instead of a planted grid.
        const clump = fbm2(x / 34, z / 34, zone.seed, 3);
        if (!small && clump < 0.4) continue;
        if (!okAt(x, z, zone, inTown)) continue;
        if (!small && budget <= 0) continue;
        const k = keys[Math.floor(rng.next() * keys.length) % keys.length];
        const s = small ? 0.7 + rng.next() * 0.7 : (0.55 + rng.next() * 0.55) * (0.8 + 0.6 * fbm2(x / 18, z / 18, zone.seed + 3, 2));
        const t = 0.82 + rng.next() * 0.3;
        // Slight lean and uneven height so stands never read as planted rows.
        const lean = small ? 0 : rng.jitter(0.06);
        const leanR = small ? 0 : rng.jitter(0.06);
        instances.add(k, x, ctx.ground(x, z) - 0.15, z, rng.next() * Math.PI * 2, s, [t * (0.95 + rng.next() * 0.1), t, t * (0.92 + rng.next() * 0.1)], s * (small ? 1 : 0.85 + rng.next() * 0.4), lean, leanR);
        placed++;
        if (!small) budget--;
      }
    }
  }
  buildFarWoods(ctx);
}

/** Sparse far conifers continuing woods beyond the blueprint extents. */
function buildFarWoods(ctx: KitContext): void {
  const { quality, instances, bp } = ctx;
  if (quality.vegetation < 0.5) return;
  const e = ctx.terrain.model.extents;
  const forests = bp.vegetation.filter((v) => v.kind === "forest");
  if (forests.length === 0) return;
  const key = "veg:far-conifer";
  instances.define({ key, part: "vegetation", castShadow: false, receiveShadow: false, lod: 1, motion: null, gate: null, build: () => vegetationPrototype("far-conifer") });
  const rng = new Rng(9021);
  const polys = forests.map((f) => shapePolygon(f.shape));
  const count = Math.round(900 * quality.vegetation);
  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const x = -700 + rng.next() * 1400;
    const z = e.minZ - 10 - rng.next() * 520;
    if (x > e.minX && x < e.maxX && z > e.minZ) continue;
    // Continue the forest band north of the extents (where blueprint forests touch the edge).
    let near = false;
    for (const p of polys) {
      const pb = polygonBounds(p);
      if (pb.minZ <= e.minZ + 2 && x >= pb.minX - 400 && x <= pb.maxX + 400) near = true;
    }
    if (!near) continue;
    if (fbm2(x / 120, z / 120, 77, 3) < 0.42) continue;
    const y = ctx.ground(x, z);
    instances.add(key, x, y - 0.3, z, rng.next() * 6.28, 0.9 + rng.next() * 0.6, [0.8, 0.82, 0.86]);
    placed++;
  }
}

export type { ProtoKind };
void makePiece;
