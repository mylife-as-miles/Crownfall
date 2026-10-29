// Solforiz site kits (nation variants of the generic kits): date palms in the groves and
// gardens; sandstone walls with stepped merlons whose breach is closed in mud brick; square
// battered towers (the rim watchtower's fresh yellow upper courses and palm hoarding); posterns;
// and the dressing that differs here (sulfur heaps, clay water jars, striped awnings and stalls).

import type { DressingCluster, Tower, VegetationZone, WallRun } from "../../../blueprint";
import { distanceToPolyline, pointInPolygon, polygonArea, polygonBounds, shapePolygon } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, lathe, loft, MeshBuilder, prism, rectOutline, Rng } from "../../../kernel";
import type { MeshBuffer } from "../../../kernel";
import { rectFaces } from "../../architecture";
import type { KitContext } from "../../context";
import { wallTop } from "../../settlement/fortifications";
import { buildDressing } from "../../settlement/dressing";
import { buildVegetation } from "../../landscape/vegetation";
import { faceMats, faceWall, merlonRow, onFace, variantLod } from "../variant";
import type { Opening } from "../variant";
import { SF } from "./common";
import { SF_CLOTHS } from "./mass";
import { SF_PALM_PROTO } from "./buildings";

/** Date palm prototype: a leaning ringed trunk and a crown of arched fronds (base at origin, 9 m). */
export function palmPrototype(quest: boolean, detail: number): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("vegetation").shadows(true, true);
  const rng = Rng.fromKey("sf:palm");
  const H = 9;
  const ringsN = quest ? 4 : 7;
  const seg = quest ? 5 : 7;
  b.material("bark");
  const rings: number[][] = [];
  for (let i = 0; i <= ringsN; i++) {
    const t = i / ringsN;
    const y = t * H;
    const off = Math.sin(t * 1.4) * 0.55;
    const r = 0.24 - 0.07 * t;
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      ring.push(off + Math.cos(a) * r, y, -Math.sin(a) * r);
    }
    rings.push(ring);
  }
  b.color(0.92, 0.8, 0.66);
  loft(b, rings, { capEnd: true });
  // Crown of fronds: arched, drooping blades.
  b.material("foliage-broadleaf");
  const top: [number, number, number] = [Math.sin(1.4) * 0.55, H, 0];
  const fronds = quest ? 8 : detail >= 2 ? 16 : 13;
  const steps = quest ? 3 : 5;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + rng.jitter(0.2);
    const up = f % 3 === 0 ? 0.9 : f % 3 === 1 ? 0.35 : -0.15;
    const len = 3.4 + rng.next() * 1.0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let px = top[0], py = top[1], pz = top[2];
    let pitch = up;
    const shade = 0.72 + rng.next() * 0.35;
    b.color(shade * 0.95, shade, shade * 0.62);
    let prevL = -1, prevR = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const w = (k === 0 ? 0.05 : 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15))) + 0.02;
      const lx = px - sy * w, lz = pz + cy * w;
      const rx = px + sy * w, rz = pz - cy * w;
      b.motionWeight(t);
      const vl = b.vertex(lx, py - w * 0.15, lz, 0, 1, 0, 0, t);
      const vr = b.vertex(rx, py - w * 0.15, rz, 0, 1, 0, 1, t);
      if (prevL >= 0) {
        b.tri(prevL, vl, vr).tri(prevL, vr, prevR);
        b.tri(prevL, vr, vl).tri(prevL, prevR, vr);
      }
      prevL = vl; prevR = vr;
      const stepLen = len / steps;
      px += cy * Math.cos(pitch) * stepLen;
      pz += sy * Math.cos(pitch) * stepLen;
      py += Math.sin(pitch) * stepLen;
      pitch -= 0.42;
    }
  }
  b.motionWeight(0);
  return b.finish();
}

function palmZone(zone: VegetationZone): boolean {
  return zone.kind === "palm-grove" || /palm/.test(zone.species.toLowerCase());
}

/** Vegetation: palms in palm groves (and single court palms), the generic kit for the rest. */
export function buildSfVegetation(ctx: KitContext): void {
  const { bp, quality, instances } = ctx;
  const others = bp.vegetation.filter((z) => !palmZone(z));
  buildVegetation({ ...ctx, bp: { ...bp, vegetation: others } });
  if (quality.vegetation <= 0) return;
  const lod = variantLod(ctx);
  instances.define({ key: SF_PALM_PROTO, part: "vegetation", castShadow: true, receiveShadow: true, lod: 0, motion: { kind: "sway", amplitude: 0.06, frequency: 0.4 }, gate: null, build: () => palmPrototype(lod.quest, lod.detail) });
  const roads = bp.routes.filter((r) => !r.outer || r.hierarchy !== "national").map((r) => ({ pts: r.points, half: r.width / 2 + 1 }));
  const walls = bp.walls.map((w) => ({ pts: w.points, half: w.thickness / 2 + 1.4 }));
  for (const zone of bp.vegetation) {
    if (!palmZone(zone)) continue;
    const poly = shapePolygon(zone.shape);
    const area = Math.abs(polygonArea(poly));
    const target = Math.max(1, Math.round((area / 100) * zone.density * Math.min(1, quality.vegetation * 1.4)));
    const bb = polygonBounds(poly);
    const cell = Math.sqrt(area / target);
    const rng = new Rng(zone.seed * 4111 + 7);
    let placed = 0;
    for (let z = bb.minZ + cell * 0.5; z < bb.maxZ && placed < target; z += cell) {
      for (let x = bb.minX + cell * 0.5; x < bb.maxX && placed < target; x += cell) {
        const px = x + rng.jitter(cell * 0.38), pz = z + rng.jitter(cell * 0.38);
        if (!pointInPolygon([px, pz], poly)) continue;
        if (ctx.masses.inFootprint(px, pz, 1.2)) continue;
        let bad = false;
        for (const r of roads) if (distanceToPolyline([px, pz], r.pts) < r.half) { bad = true; break; }
        if (!bad) for (const w of walls) if (distanceToPolyline([px, pz], w.pts) < w.half) { bad = true; break; }
        if (bad || !Number.isNaN(ctx.terrain.waterLevel(px, pz))) continue;
        const h = 7 + rng.next() * 4.5;
        const t = 0.85 + rng.next() * 0.25;
        instances.add(SF_PALM_PROTO, px, ctx.ground(px, pz) - 0.1, pz, rng.next() * 6.28, h / 9, [t, t, t * 0.95]);
        placed++;
      }
    }
  }
}

function wallOuterSide(ctx: KitContext, w: WallRun, mx: number, mz: number, nx: number, nz: number): 1 | -1 {
  const bp = ctx.bp;
  const inside = w.points.every((p) => pointInPolygon([p[0], p[1]], bp.settlementBoundary));
  if (inside) {
    let cx = 0, cz = 0;
    for (const p of w.points) { cx += p[0] / w.points.length; cz += p[1] / w.points.length; }
    return (mx - cx) * nx + (mz - cz) * nz >= 0 ? 1 : -1;
  }
  return pointInPolygon([mx + nx * 4, mz + nz * 4], bp.settlementBoundary) ? -1 : 1;
}

/** Sandstone town walls and curtains with stepped merlons; mud-brick breaches; ruined rim walls. */
export function buildSfWalls(ctx: KitContext): void {
  const { bp, b } = ctx;
  const lod = variantLod(ctx);
  b.part("settlement", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  for (const w of bp.walls) {
    const low = w.kind === "low-wall" || w.kind === "fence" || w.kind === "hedge";
    const mat = ctx.mat(w.material);
    const rng = ctx.rng(`sf-wall:${w.id}`);
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], c = w.points[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const tx = dx / len, tz = dz / len;
      const yaw = Math.atan2(dx, dz) - Math.PI / 2;
      let cond = "sound";
      for (const sg of w.segments) if (i >= sg.from && i < sg.to) cond = sg.condition;
      const n = Math.max(1, Math.ceil(len / (low ? 3 : 2.6)));
      const side = wallOuterSide(ctx, w, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, -tz, tx);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const mx = a[0] + dx * (t0 + t1) / 2, mz = a[1] + dz * (t0 + t1) / 2;
        const { top, bottom } = wallTop(ctx, w, mx, mz, tx, tz);
        const plen = len / n + (low ? 0.02 : 0.1);
        const tone = cond === "weathered" ? 0.88 : cond === "ruinous" ? 0.76 : cond === "damaged" ? 0.9 : 1;
        b.color(tone, tone * 0.99, tone * 0.97);
        b.material(mat);
        b.push();
        b.transform(mx, 0, mz, yaw);
        if (low) {
          const g = ctx.ground(mx, mz);
          chamferBox(b, 0, g - 0.4, 0, plen, w.height + 0.32, w.thickness, 0.04, { top: false });
          b.material(ctx.mat(SF.plaster));
          bevelPrism(b, rectOutline(plen, w.thickness + 0.1), g + w.height - 0.08, g + w.height + 0.08, 0.05);
        } else if (cond === "ruinous") {
          const hh = bottom + (top - bottom) * (0.25 + rng.next() * 0.35);
          chamferBox(b, 0, bottom, 0, plen, hh - bottom, w.thickness, 0.12, { top: true });
          if (lod.detail >= 1) for (let r = 0; r < 3; r++) chamferBox(b, rng.jitter(plen * 0.4), ctx.ground(mx, mz) - 0.2, side * (w.thickness * 0.6 + rng.next() * 0.6), 0.5 + rng.next() * 0.4, 0.4, 0.45, 0.08);
        } else if (cond === "damaged") {
          // The breach: stone footing to half height, then mud brick never refaced in stone.
          const mid = bottom + (top - bottom) * 0.5;
          chamferBox(b, 0, bottom, 0, plen, mid - bottom, w.thickness, 0.04, { top: false });
          b.material(ctx.mat(SF.mudbrick)).color(0.92, 0.82, 0.74);
          const ragged = top + 0.3 + rng.jitter(0.25);
          chamferBox(b, 0, mid, 0, plen, ragged - mid, w.thickness * 0.92, 0.06, { top: true });
        } else {
          chamferBox(b, 0, bottom, 0, plen, top - bottom, w.thickness, 0.04, { top: true });
          // Battered skirt on the outer face.
          const out = side * (w.thickness / 2);
          if (side > 0) b.flatQuad(-plen / 2, bottom, out + 0.45, plen / 2, bottom, out + 0.45, plen / 2, bottom + 2.2, out, -plen / 2, bottom + 2.2, out);
          else b.flatQuad(plen / 2, bottom, out - 0.45, -plen / 2, bottom, out - 0.45, -plen / 2, bottom + 2.2, out, plen / 2, bottom + 2.2, out);
          if (w.walkway || w.kind === "curtain" || w.kind === "town-wall") {
            const keepP = cond === "weathered" ? 0.6 : cond === "worn" ? 0.88 : 1;
            box(b, 0, top, side * (w.thickness / 2 - 0.22), plen, 0.6, 0.44);
            if (lod.detail >= 1) {
              b.push();
              b.transform(0, 0, side * (w.thickness / 2), side > 0 ? 0 : Math.PI);
              merlonRow(b, "stepped", plen - 0.1, top + 0.6, 0.44, 0.62, 0.66, 0.36, () => keepP >= 1 || rng.chance(keepP));
              b.pop();
            }
          }
        }
        b.pop();
      }
    }
  }
  b.color(1, 1, 1);
}

/** Square battered towers with stepped crests; the repaired watchtower shows its seam. */
export function buildSfTowers(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("settlement", null).gate(null).shadows(true, true);
  for (const t of bp.towers) sfTower(ctx, t);
  b.color(1, 1, 1);
}

function sfTower(ctx: KitContext, t: Tower): void {
  const b = ctx.b;
  const lod = variantLod(ctx);
  b.uvMode = "world";
  const hw = t.width / 2;
  let gmin = Infinity, gmax = -Infinity;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
    const g = ctx.ground(t.center[0] + sx * hw, t.center[1] + sz * hw);
    gmin = Math.min(gmin, g);
    gmax = Math.max(gmax, g);
  }
  const base = gmax;
  const foot = gmin - 0.8 - base;
  const h = t.height;
  const mat = ctx.mat(t.material);
  const mats = faceMats(ctx, t.material, SF.plaster, { door: SF.palm, boards: SF.palm, lattice: SF.palm });
  const rng = ctx.rng(`sf-tower:${t.id}`);
  const repaired = t.storyRole === "repaired-watchtower" || t.repairs.some((r) => r.kind === "rebuilt-courses");
  const tone = t.condition === "weathered" ? 0.87 : t.condition === "ruinous" ? 0.72 : 1;
  b.push();
  b.translate(t.center[0], base, t.center[1]);
  b.color(tone, tone, tone);
  b.material(mat);
  // Battered base.
  const lo = rectOutline(t.width + 0.9, t.width + 0.9), hi = rectOutline(t.width, t.width);
  for (let k = 0; k < 4; k++) {
    const p = lo[k], q = lo[(k + 1) % 4], ph = hi[k], qh = hi[(k + 1) % 4];
    b.flatQuad(q[0], foot, q[1], p[0], foot, p[1], ph[0], 2.4, ph[1], qh[0], 2.4, qh[1]);
  }
  if (t.condition === "ruinous") {
    for (const face of rectFaces(t.width, t.width)) {
      onFace(b, face, () => {
        const n = Math.max(3, Math.round(face.length / 0.9));
        for (let k = 0; k < n; k++) {
          const hh = h * (0.35 + 0.55 * Math.pow(rng.next(), 0.6));
          box(b, -face.length / 2 + (k + 0.5) * (face.length / n), foot, -0.4, face.length / n + 0.02, hh - foot, 0.8);
        }
      });
    }
    b.pop();
    ctx.collider([t.center[0], base + h / 2, t.center[1]], [hw, h / 2, hw], 0, null);
    return;
  }
  const seam = repaired ? h * 0.64 : h;
  const faces = rectFaces(t.width, t.width);
  faces.forEach((face, i) => {
    const ops: Opening[] = [];
    for (let lv = 0; lv < 3; lv++) {
      const y = 3 + lv * (h * 0.25);
      if (y > h - 2.2) continue;
      ops.push({ u: ((i + lv) % 2 === 0 ? -0.6 : 0.6) * Math.min(1, hw - 0.6), width: 0.28, sill: y, height: 1.1, shape: "round", depth: 0.5, fill: "dark" });
    }
    ops.push({ u: 0, width: Math.min(0.7, face.length * 0.2), sill: h - 2.0, height: 1.3, shape: "round", depth: 0.5, fill: lod.quest ? "dark" : "lattice", frame: lod.ornament >= 1 ? 0.08 : 0, proud: 0.03 });
    onFace(b, face, () => {
      faceWall(b, { length: face.length, bottom: foot, top: seam, openings: ops.filter((o) => o.sill + o.height < seam), mats, arch: lod.arch, detail: lod.detail, rows: [0.6, 1.8] });
      if (repaired) {
        b.color(tone * 1.16, tone * 1.1, tone * 0.86);
        faceWall(b, { length: face.length, bottom: seam, top: h, openings: ops.filter((o) => o.sill >= seam), mats, arch: lod.arch, detail: lod.detail });
        b.color(tone, tone, tone);
      }
    });
  });
  // Crest: parapet with stepped merlons (flat roofs) on every standing tower.
  b.material(mat);
  if (repaired) b.color(tone * 1.16, tone * 1.1, tone * 0.86);
  prism(b, rectOutline(t.width - 0.9, t.width - 0.9), h - 0.25, h, { top: true });
  for (const face of rectFaces(t.width + 0.3, t.width + 0.3)) {
    onFace(b, face, () => {
      box(b, 0, h - 0.4, -0.25, face.length, 1.3, 0.5);
      if (lod.detail >= 1) merlonRow(b, "stepped", face.length - 0.2, h + 0.9, 0.5, 0.62, 0.66, 0.34, t.condition === "weathered" ? () => rng.chance(0.7) : undefined);
    });
  }
  b.color(tone, tone, tone);
  if (t.repairs.some((r) => r.kind === "new-timber") && lod.detail >= 1) {
    // Palm-timber hoarding round the rebuilt top.
    b.material(ctx.mat(SF.palm));
    b.color(1.25, 1.18, 1.05);
    for (const face of rectFaces(t.width + 1.2, t.width + 1.2)) {
      onFace(b, face, () => {
        box(b, 0, h - 1.4, -0.1, face.length, 0.12, 0.9);
        const n = Math.max(3, Math.round(face.length / 0.9));
        for (let k = 0; k <= n; k++) box(b, -face.length / 2 + (k * face.length) / n, h - 1.4, 0.3, 0.1, 1.5, 0.1);
        box(b, 0, h + 0.05, 0.3, face.length, 0.1, 0.12);
      });
    }
    b.color(tone, tone, tone);
  }
  if (t.repairs.some((r) => r.kind === "iron-strapping")) {
    b.material(ctx.mat("iron"));
    for (const y of [h * 0.3, h * 0.46]) prism(b, rectOutline(t.width + 0.08, t.width + 0.08), y, y + 0.14, { top: true, bottom: true });
  }
  b.pop();
  ctx.collider([t.center[0], base + h / 2, t.center[1]], [hw + 0.4, h / 2 + 1, hw + 0.4], 0, null);
}

/** Posterns and water gates (main and inner gates are built by their gatehouse kits). */
export function buildSfGates(ctx: KitContext): void {
  const { bp, b } = ctx;
  const lod = variantLod(ctx);
  b.part("settlement", null).gate(null).shadows(true, true);
  for (const g of bp.gates) {
    if (g.kind === "main-gate" || g.kind === "inner-gate") continue;
    const wall = bp.walls.find((w) => w.id === g.wallId);
    const t = wall ? wall.thickness : 1.2;
    const bearing = (g.outwardBearingDeg * Math.PI) / 180;
    const ox = Math.sin(bearing), oz = -Math.cos(bearing);
    const yaw = Math.atan2(ox, oz);
    const ground = ctx.ground(g.position[0], g.position[1]);
    const mats = faceMats(ctx, wall ? wall.material : SF.sandstone, SF.plaster, { door: SF.palm });
    for (const sgn of [1, -1]) {
      b.push();
      b.transform(g.position[0] + ox * (t / 2 + 0.02) * sgn, ground, g.position[1] + oz * (t / 2 + 0.02) * sgn, sgn > 0 ? yaw : yaw + Math.PI);
      faceWall(b, { length: g.width + 1.2, bottom: -0.3, top: g.height + 0.6, openings: [{ u: 0, width: g.width, sill: 0, height: g.height, shape: "round", depth: 0.015, fill: "door", frame: lod.ornament >= 1 ? 0.18 : 0, proud: 0.06 }], mats, arch: lod.arch, detail: lod.detail });
      b.pop();
    }
  }
}

function jars(ctx: KitContext, n: number, rng: Rng): void {
  const b = ctx.b;
  b.material(ctx.mat(SF.mudbrick));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.next();
    const r = i === 0 ? 0 : 0.42;
    const h = 0.6 + rng.next() * 0.35;
    const k = 0.85 + rng.next() * 0.25;
    b.color(k * 1.05, k * 0.82, k * 0.66);
    b.push();
    b.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    lathe(b, [[0.1, 0], [0.22, h * 0.25], [0.24, h * 0.55], [0.12, h * 0.88], [0.09, h], [0.11, h + 0.04]], 8, { smooth: true });
    b.pop();
  }
  b.color(1, 1, 1);
}

function sfProp(ctx: KitContext, d: DressingCluster): boolean {
  const b = ctx.b;
  const x = d.position[0], z = d.position[1];
  const g = ctx.ground(x, z);
  const rng = ctx.rng(`sf-dress:${d.id}`);
  const note = `${d.id} ${d.note ?? ""}`.toLowerCase();
  switch (d.kind) {
    case "stone-pile": {
      if (!/sulfur|crust/.test(note)) return false;
      b.push();
      b.transform(x, g - 0.1, z, (d.yawDeg * Math.PI) / 180);
      b.material(ctx.mat(SF.sulfur));
      for (let i = 0; i < 4; i++) {
        const k = 0.85 + rng.next() * 0.3;
        b.color(k, k, k * 0.9);
        b.push();
        b.translate(rng.jitter(1.6), 0, rng.jitter(1.2));
        lathe(b, [[0.9 + rng.next() * 0.6, 0], [0.5, 0.55], [0.08, 0.95 + rng.next() * 0.4]], 7, { smooth: true });
        b.pop();
      }
      b.pop();
      return true;
    }
    case "water-jars": {
      b.push();
      b.transform(x, g, z, (d.yawDeg * Math.PI) / 180);
      jars(ctx, 3 + rng.int(0, 2), rng);
      b.pop();
      return true;
    }
    case "awning":
    case "market-stall": {
      b.push();
      b.transform(x, g, z, (d.yawDeg * Math.PI) / 180);
      b.material(ctx.mat(SF.palm));
      const w = d.kind === "awning" ? 3.2 : 2.6, dd = d.kind === "awning" ? 2.4 : 1.8;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, sx * (w / 2 - 0.08), 0, sz * (dd / 2 - 0.08), 0.1, sz > 0 ? 2.1 : 2.5, 0.1);
      const cloth = SF_CLOTHS[rng.int(0, SF_CLOTHS.length - 1)];
      b.material(ctx.mat(SF.cloth));
      const stripes = 4;
      for (let k = 0; k < stripes; k++) {
        const c = k % 2 === 0 ? cloth : SF_CLOTHS[0];
        b.color(c[0], c[1], c[2]);
        const x0 = -w / 2 + (k * w) / stripes, x1 = x0 + w / stripes;
        b.flatQuad(x0, 2.1, dd / 2 + 0.15, x1, 2.1, dd / 2 + 0.15, x1, 2.5, -dd / 2, x0, 2.5, -dd / 2);
      }
      b.color(1, 1, 1);
      if (d.kind === "market-stall") {
        b.material(ctx.mat(SF.palm));
        chamferBox(b, 0, 0.75, 0, w * 0.9, 0.1, dd * 0.7, 0.02);
        b.push();
        b.translate(-w * 0.25, 0.85, 0);
        jars(ctx, 2, rng);
        b.pop();
      }
      b.pop();
      return true;
    }
    default:
      return false;
  }
}

/** Dressing: the Solforiz props above, the generic kit for every other cluster. */
export function buildSfDressing(ctx: KitContext): void {
  const { bp, b } = ctx;
  const rest: DressingCluster[] = [];
  b.part("dressing", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  for (const d of bp.dressing) {
    if (!ctx.quality.dressing && d.kind !== "brazier" && d.kind !== "cooking-fire" && d.kind !== "crane" && d.kind !== "well") continue;
    b.color(1, 1, 1);
    if (!sfProp(ctx, d)) rest.push(d);
  }
  buildDressing({ ...ctx, bp: { ...bp, dressing: rest } });
  b.color(1, 1, 1);
}
