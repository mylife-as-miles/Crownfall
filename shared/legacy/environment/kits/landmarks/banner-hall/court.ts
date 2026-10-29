// The Banner Court's ceremonial pieces: the Honour Court (raised flagstone court, low
// walls with eight recessed candle niches that only recognition fills, a black marble
// eclipse dial), the stepped socle of the court standard, and hall-tier development:
// braziers lit at tier 1, a gilded frame on the hall emblem at tier 3.

import { bevelPrism, box, chamferBox, circleOutline, lathe, panel, prism, rectOutline } from "../../../kernel";
import type { MeshBuilder, P2, StateGate } from "../../../kernel";
import type { KitContext } from "../../context";
import { barAlong, enterFace, revealBand, openingOutline, headChain, quadSafe } from "../gothic";
import type { LandmarkLod, LandmarkMaterials } from "../gothic";

/** A recessed pointed niche in a wall face frame (u, sill) with depth d. */
function niche(b: MeshBuilder, u: number, sill: number, w: number, h: number, d: number, m: LandmarkMaterials, segments: number): void {
  const out = openingOutline("pointed", w, h, segments).map((p) => [p[0] + u, p[1] + sill] as P2);
  b.material(m.dressing);
  const base = b.getColor();
  b.color(base[0] * 0.7, base[1] * 0.7, base[2] * 0.7);
  revealBand(b, out, out, 0, -d);
  b.color(base[0] * 0.55, base[1] * 0.55, base[2] * 0.55);
  // Back of the niche.
  const n = out.length;
  let cx = 0, cy = 0;
  for (const p of out) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  const c = b.vertex(cx, cy, -d, 0, 0, 1);
  const ring = out.map((p) => b.vertex(p[0], p[1], -d, 0, 0, 1));
  for (let i = 0; i < n; i++) b.tri(c, ring[i], ring[(i + 1) % n]);
  b.color(base[0], base[1], base[2]);
  // Moulded arch over the niche.
  barAlong(b, headChain(out.map((p) => [p[0] + (p[0] - u) * 0.12, p[1] + (p[1] > sill + 0.05 ? 0.06 : 0)] as P2)), 0.09, 0, 0.07);
}

/** A wall run (in world plan) with the face frame on its +z side; returns after building. */
function nicheWall(ctx: KitContext, m: LandmarkMaterials, lod: LandmarkLod, o: { x0: number; z0: number; x1: number; z1: number; floor: number; top: number; thick: number; niches: readonly number[]; nicheSill: number }): void {
  const b = ctx.b;
  const dx = o.x1 - o.x0, dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz) - Math.PI / 2;
  b.push();
  b.transform((o.x0 + o.x1) / 2, 0, (o.z0 + o.z1) / 2, yaw);
  // Local +Z is the inner (court) face. Solid wall with the niches cut as recesses: the
  // face is built as panels around them.
  b.material(m.ashlar);
  const zf = 0;
  const w = 0.62, h = 0.92, d = 0.3;
  const holes = o.niches.map((u) => openingOutline("pointed", w, h, lod.segments).map((p) => [p[0] + u, p[1] + o.nicheSill] as P2));
  // Back, ends and top of the wall slab (the court face is built below).
  box(b, 0, o.floor - 0.4, -o.thick / 2, len, o.top - o.floor + 0.4, o.thick, { top: false, skipSides: [2] });
  // Court face: strips between niches, below and above each niche.
  const yb = o.floor - 0.1;
  let cursor = -len / 2;
  const sorted = holes.map((hp, i) => ({ hp, u: o.niches[i] })).sort((a, c) => a.u - c.u);
  for (const s of sorted) {
    const u0 = s.u - w / 2, u1 = s.u + w / 2;
    quadSafe(b, cursor, yb, zf, u0, yb, zf, u0, o.top, zf, cursor, o.top, zf);
    quadSafe(b, u0, yb, zf, u1, yb, zf, u1, o.nicheSill, zf, u0, o.nicheSill, zf);
    // Above the niche: polygon with the arch as its lower edge.
    const head = headChain(s.hp);
    const poly: P2[] = head.slice();
    poly.push([u1, o.top], [u0, o.top]);
    panel(b, poly, [0, 0, zf], [1, 0, 0], [0, 1, 0]);
    cursor = u1;
  }
  quadSafe(b, cursor, yb, zf, len / 2, yb, zf, len / 2, o.top, zf, cursor, o.top, zf);
  for (const s of sorted) niche(b, s.u, o.nicheSill, w, h, d, m, lod.segments);
  // Coping.
  b.material(m.dressing);
  bevelPrism(b, rectOutline(len + 0.12, o.thick + 0.14, 0, -o.thick / 2 + 0.0), o.top, o.top + 0.17, 0.06);
  b.pop();
}

/** The Honour Court at the blueprint's ceremonial shape, its niches at the honour-niche slots. */
export function buildHonourCourt(ctx: KitContext, lod: LandmarkLod, m: LandmarkMaterials): void {
  const { bp, b } = ctx;
  const c = bp.ceremonial;
  const shape = c.shape;
  if (shape.kind !== "rect") return;
  const g = ctx.ground(shape.center[0], shape.center[1]);
  const raise = 0.45;
  const floor = g + raise;
  const hw = shape.width / 2, hd = shape.depth / 2;
  const x0 = shape.center[0] - hw, x1 = shape.center[0] + hw, z0 = shape.center[1] - hd, z1 = shape.center[1] + hd;
  b.part("landmark:banner-hall", "banner-hall").shadows(true, true).gate(null);
  b.uvMode = "world";
  // Raised flagstone court with a moulded edge and steps on its open south and west sides
  // (the paving joins the settlement's paving group: it receives shadows but casts none).
  b.material(m.flagstone);
  b.shadows(false, true);
  prism(b, rectOutline(shape.width, shape.depth, shape.center[0], shape.center[1]), g - 0.3, floor, { top: true });
  b.shadows(true, true);
  b.material(m.dressing);
  bevelPrism(b, rectOutline(shape.width + 0.12, shape.depth + 0.12, shape.center[0], shape.center[1]), floor - 0.12, floor + 0.02, 0.04);
  b.material(m.ashlar);
  bevelPrism(b, rectOutline(shape.width - 0.6, 0.5, shape.center[0] - 0.3, z1 + 0.25), g - 0.2, g + raise / 2, 0.03);
  bevelPrism(b, rectOutline(0.5, shape.depth - 0.6, x0 - 0.25, shape.center[1] + 0.3), g - 0.2, g + raise / 2, 0.03);
  // Niche walls from the slots: east wall (niches facing west) and north wall (facing south).
  const east = bp.slots.honourNiches.filter((n) => Math.abs(n.yawDeg + 90) < 1);
  const north = bp.slots.honourNiches.filter((n) => Math.abs(n.yawDeg) < 1);
  const thick = 0.55;
  const top = floor + 1.85;
  if (east.length) {
    const sill = east[0].position[1] - 0.4;
    const face = Math.min(...east.map((n) => n.position[0])) - 0.15;
    // Wall from north to south: its court face (local +Z) looks west into the court.
    nicheWall(ctx, m, lod, { x0: face, z0: z0, x1: face, z1: z1, floor, top, thick, niches: east.map((n) => n.position[2] - (z0 + z1) / 2), nicheSill: sill });
  }
  if (north.length) {
    const sill = north[0].position[1] - 0.4;
    const face = Math.max(...north.map((n) => n.position[2])) + 0.15;
    nicheWall(ctx, m, lod, { x0: x0, z0: face, x1: x1 - thick, z1: face, floor, top, thick, niches: north.map((n) => n.position[0] - (x0 + x1 - thick) / 2), nicheSill: sill });
  }
  // The eclipse dial: a black marble column on a stepped base, an inclined disc with a gilt ring.
  const [dx, dz] = c.centrepiece;
  b.push();
  b.translate(dx, floor, dz);
  b.material(m.marble);
  bevelPrism(b, rectOutline(1.1, 1.1), 0, 0.18, 0.04);
  bevelPrism(b, rectOutline(0.8, 0.8), 0.18, 0.34, 0.04);
  lathe(b, [[0.24, 0.34], [0.2, 0.5], [0.17, 1.15], [0.24, 1.3], [0.3, 1.36]], lod.ornament >= 1 ? 12 : 8, { smooth: true, capTop: true });
  b.push();
  b.transform(0, 1.62, 0, 0.35, Math.PI / 2 - 0.42, 0);
  lathe(b, [[0.6, -0.05], [0.6, 0.05]], lod.ornament >= 1 ? 24 : 12, { smooth: true, capTop: true, capBottom: true });
  b.material(m.gilt);
  lathe(b, [[0.62, -0.03], [0.66, 0], [0.62, 0.03]], lod.ornament >= 1 ? 24 : 12, { smooth: true });
  // The occulting disc, offset as in an eclipse just past totality.
  b.material(m.marble);
  b.push();
  b.translate(0.05, 0.06, 0.03);
  lathe(b, [[0.44, 0], [0.44, 0.03]], lod.ornament >= 1 ? 20 : 10, { smooth: true, capTop: true });
  b.pop();
  b.pop();
  b.pop();
  ctx.collider([dx, floor + 0.9, dz], [0.6, 0.9, 0.6], 0, "banner-hall", false);
  void chamferBox;
  void box;
  void circleOutline;
  void enterFace;
}

/** Stepped socle under the court standard (the standard itself is a banner mount). */
export function buildStandardSocle(ctx: KitContext, m: LandmarkMaterials, x: number, z: number): void {
  const b = ctx.b;
  const g = ctx.ground(x, z);
  b.part("landmark:banner-hall", "banner-hall").shadows(true, true).gate(null);
  b.uvMode = "world";
  b.push();
  b.translate(x, g, z);
  b.material(m.ashlar);
  bevelPrism(b, rectOutline(1.5, 1.5), -0.2, 0.22, 0.05);
  bevelPrism(b, rectOutline(1.05, 1.05), 0.22, 0.52, 0.05);
  b.material(m.dressing);
  bevelPrism(b, rectOutline(0.62, 0.62), 0.52, 0.86, 0.06);
  b.material(m.iron);
  prism(b, circleOutline(0.16, 8), 0.86, 1.02, { top: true });
  b.pop();
}

/** A brazier with its fire and light, gated (tier dressing). */
export function gatedBrazier(ctx: KitContext, m: LandmarkMaterials, id: string, x: number, y: number, z: number, gate: StateGate | null, priority = 4): void {
  const b = ctx.b;
  b.gate(gate);
  b.material(m.iron);
  b.push();
  b.translate(x, y, z);
  lathe(b, [[0.13, 0], [0.09, 0.85], [0.42, 1.0], [0.48, 1.2]], 8, { smooth: false });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.push();
    b.transform(Math.sin(a) * 0.22, 0, Math.cos(a) * 0.22, a, -0.25, 0);
    box(b, 0, 0, 0, 0.05, 0.9, 0.05);
    b.pop();
  }
  b.pop();
  b.material(m.fire);
  b.motion({ kind: "flicker", rate: 7, depth: 0.35 });
  b.shadows(false, false);
  b.push();
  b.translate(x, y + 1.08, z);
  for (let i = 0; i < 3; i++) {
    b.push();
    b.rotateY((i / 3) * Math.PI);
    b.motionWeight(i / 3);
    lathe(b, [[0.19, 0], [0.12, 0.25], [0.01, 0.55]], 5, { smooth: false });
    b.pop();
  }
  b.pop();
  b.motion(null);
  b.motionWeight(0);
  b.shadows(true, true);
  ctx.fires.push({ id, position: [x, y + 1.08, z], size: 0.42, gate });
  ctx.lights.push({ name: id, position: [x, y + 1.5, z], color: "#ffad5c", intensity: 8, range: 11, flicker: 0.8, priority, gate });
  b.gate(null);
}
