// Fortifications kit: wall runs that follow the terrain with stepped tops, outer
// crenellation and per-segment condition (fallen merlons, timber-patched breaches),
// low parapets, fences and hedges; towers (round, square, polygonal) with their
// repairs and ruins; gate arches and posterns.

import type { BannerholdBlueprint, ConditionGrade, Tower, Vec2, WallRun } from "../../blueprint";
import { pointInPolygon } from "../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, crenellate, lathe, opening, prism, rectOutline, roof, archOutline } from "../../kernel";
import type { RoofShape } from "../../kernel/roofs";
import type { KitContext } from "../context";

const CROSS = 1.4;

/** Walkway (top) elevation of a wall at a plan point: the higher ground across the wall plus its height. */
export function wallTop(ctx: { ground(x: number, z: number): number }, w: WallRun, x: number, z: number, tx: number, tz: number): { top: number; bottom: number } {
  const ox = tz, oz = -tx;
  const off = w.thickness / 2 + CROSS;
  const g0 = ctx.ground(x, z), g1 = ctx.ground(x + ox * off, z + oz * off), g2 = ctx.ground(x - ox * off, z - oz * off);
  return { top: Math.max(g0, g1, g2) + w.height, bottom: Math.min(g0, g1, g2) - 0.7 };
}

function conditionAt(w: WallRun, segment: number): ConditionGrade {
  for (const s of w.segments) if (segment >= s.from && segment < s.to) return s.condition;
  return "sound";
}

function outerSide(bp: BannerholdBlueprint, x: number, z: number, nx: number, nz: number): 1 | -1 {
  const inside = pointInPolygon([x + nx * 4, z + nz * 4], bp.settlementBoundary);
  return inside ? -1 : 1;
}

export function buildWalls(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("settlement", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  for (const w of bp.walls) {
    const low = w.kind === "low-wall" || w.kind === "retaining" || w.kind === "dry-stone" || w.kind === "fence" || w.kind === "hedge";
    const mat = w.kind === "hedge" ? ctx.mat("foliage-broadleaf") : w.kind === "fence" || w.kind === "palisade" ? ctx.mat("timber-raw") : ctx.mat(w.material);
    const pts = w.points.slice();
    if (w.closed) pts.push(pts[0]);
    const rng = ctx.rng(`wall:${w.id}`);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const tx = dx / len, tz = dz / len;
      const yaw = Math.atan2(dx, dz) - Math.PI / 2;
      const cond = conditionAt(w, i);
      const pieceLen = low ? 3 : 2.6;
      const n = Math.max(1, Math.ceil(len / pieceLen));
      // Local +Z of a wall piece is (-tz, tx); side = +1 puts the parapet on that side when it is outside.
      const side = outerSide(bp, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, -tz, tx);
      const tint = cond === "weathered" ? 0.86 : cond === "damaged" ? 0.82 : cond === "ruinous" ? 0.72 : cond === "new" ? 1.05 : 1;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const mx = a[0] + dx * (t0 + t1) / 2, mz = a[1] + dz * (t0 + t1) / 2;
        const { top, bottom } = wallTop(ctx, w, mx, mz, tx, tz);
        const plen = len / n + (low ? 0.02 : 0.12);
        b.color(tint, tint, tint);
        b.material(mat);
        b.push();
        b.transform(mx, 0, mz, yaw);
        if (w.kind === "fence" || w.kind === "palisade") {
          const g = ctx.ground(mx, mz);
          box(b, 0, g - 0.3, 0, 0.14, w.height + 0.3, 0.14);
          box(b, 0, g + w.height * 0.45, 0, plen, 0.1, 0.08);
          box(b, 0, g + w.height * 0.85, 0, plen, 0.1, 0.08);
        } else if (low) {
          const g = ctx.ground(mx, mz);
          chamferBox(b, 0, Math.min(bottom + 0.4, g - 0.4), 0, plen, g + w.height - 0.12 - Math.min(bottom + 0.4, g - 0.4), w.thickness, 0.03, { top: false });
          bevelPrism(b, rectOutline(plen, w.thickness + 0.12), g + w.height - 0.12, g + w.height + 0.04, 0.05);
        } else if (cond === "damaged") {
          // Breach closed with salvaged stone to half height and a timber palisade above.
          const mid = bottom + (top - bottom) * 0.55;
          box(b, 0, bottom, 0, plen, mid - bottom, w.thickness);
          b.material(ctx.mat("timber-raw"));
          const stakes = Math.max(3, Math.round(plen / 0.32));
          for (let s = 0; s < stakes; s++) {
            const x = -plen / 2 + (s + 0.5) * (plen / stakes);
            const hgt = top + 1.4 - mid + rng.jitter(0.25);
            box(b, x, mid - 0.2, side * 0.2, 0.24, hgt, 0.24);
            b.push();
            b.transform(x, mid + hgt - 0.2, side * 0.2);
            lathe(b, [[0.13, 0], [0.01, 0.38]], 4, { smooth: false, phase: Math.PI / 4 });
            b.pop();
          }
          box(b, 0, mid + (top - mid) * 0.6, side * -0.05, plen, 0.18, 0.12);
        } else {
          chamferBox(b, 0, bottom, 0, plen, top - bottom, w.thickness, 0.04, { top: true });
          // Outer parapet with merlons; weathered stretches have lost some.
          if (w.walkway || w.kind === "curtain" || w.kind === "town-wall") {
            const keepP = cond === "weathered" ? 0.62 : cond === "worn" ? 0.88 : cond === "ruinous" ? 0.3 : 1;
            box(b, 0, top, side * (w.thickness / 2 - 0.22), plen, 0.55, 0.44);
            if (ctx.quality.detail >= 1 || w.kind === "curtain") {
              crenellate(b, -plen / 2, side * (w.thickness / 2 - 0.22), plen / 2, side * (w.thickness / 2 - 0.22), top + 0.55, 0.44, 0.75, 0.75, 0.55, () => keepP >= 1 || rng.chance(keepP));
            }
          }
        }
        b.pop();
      }
    }
    b.color(1, 1, 1);
  }
}

export function buildTowers(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("settlement", null).gate(null).shadows(true, true);
  for (const t of bp.towers) buildTower(ctx, t);
  b.color(1, 1, 1);
}

function buildTower(ctx: KitContext, t: Tower): void {
  const b = ctx.b;
  b.uvMode = "world";
  const r = t.width / 2;
  let gmin = Infinity, gmax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = ctx.ground(t.center[0] + Math.sin(a) * r, t.center[1] + Math.cos(a) * r);
    gmin = Math.min(gmin, g);
    gmax = Math.max(gmax, g);
  }
  const base = gmax;
  const foot = gmin - 0.8 - base;
  const h = t.height;
  const ruin = t.condition === "ruinous";
  const repaired = t.storyRole === "repaired-watchtower" || t.repairs.some((x) => x.kind === "rebuilt-courses");
  const mat = ctx.mat(t.material);
  const tint = t.condition === "weathered" ? 0.86 : ruin ? 0.62 : t.condition === "damaged" ? 0.8 : 1;
  const round = t.shape === "round";
  const outline = round ? circleOutline(r, 18, Math.PI / 18) : t.shape === "polygonal" ? circleOutline(r / Math.cos(Math.PI / 8), 8, Math.PI / 8) : rectOutline(t.width, t.width);
  b.push();
  b.translate(t.center[0], base, t.center[1]);
  b.material(mat);
  b.color(tint, tint, tint);
  // Battered base.
  if (round) lathe(b, [[r + 0.45, foot], [r + 0.3, 1.2], [r, 2.2]], 18, { smooth: true });
  else prism(b, outline.map((p) => [p[0] * 1.08, p[1] * 1.08] as Vec2), foot, 1.6, { top: true });
  if (ruin) {
    // Broken shell: jagged top, soot-darkened.
    const seg = 14;
    const rng = ctx.rng(`tower:${t.id}`);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const hh = h * (0.45 + 0.55 * Math.pow(rng.next(), 0.5));
      const k = 0.55 + rng.next() * 0.3;
      b.color(tint * k, tint * k, tint * k);
      b.push();
      b.transform(Math.sin(am) * (r - 0.4), 0, Math.cos(am) * (r - 0.4), am);
      box(b, 0, 1.2, 0, 2 * r * Math.sin(Math.PI / seg) + 0.1, hh - 1.2, 0.8);
      b.pop();
    }
    b.pop();
    ctx.collider([t.center[0], base + h / 2, t.center[1]], [r, h / 2 + 1, r], 0, null);
    return;
  }
  const seam = repaired ? h * 0.66 : h;
  prism(b, outline, 1.2, seam, { smooth: round, top: false });
  if (repaired) {
    b.material(ctx.mat(ctx.style.keys.repair));
    b.color(1.04, 1.04, 1.02);
    prism(b, outline, seam, h, { smooth: round, top: false });
    b.color(tint, tint, tint);
  }
  // Slit windows.
  if (ctx.quality.detail >= 1) {
    const slits = Math.max(2, Math.round(r * 1.2));
    for (let s = 0; s < slits; s++) {
      const a = (s / slits) * Math.PI * 2 + 0.4;
      const y = 3 + (s % 3) * (h * 0.22);
      if (y > h - 1.5) continue;
      b.push();
      b.transform(Math.sin(a) * (round ? r - 0.03 : r * 0.98), y, Math.cos(a) * (round ? r - 0.03 : r * 0.98), a);
      opening(b, { outline: archOutline(0.24, 0.9, 0.9, 3), glassMaterial: ctx.mat("glass-dark"), frameMaterial: ctx.mat(t.material), frame: 0.12, proud: 0.1, glassTint: [0.5, 0.5, 0.5] });
      b.pop();
    }
  }
  if (t.repairs.some((x) => x.kind === "iron-strapping")) {
    b.material(ctx.mat("iron"));
    for (const y of [h * 0.3, h * 0.48]) prism(b, round ? circleOutline(r + 0.05, 18) : rectOutline(t.width + 0.1, t.width + 0.1), y, y + 0.14, { smooth: round, top: true, bottom: true });
  }
  b.material(repaired ? ctx.mat(ctx.style.keys.repair) : mat);
  if (t.roof === "none") {
    // Open top: parapet ring and merlons.
    const ring = round ? circleOutline(r + 0.15, 18) : rectOutline(t.width + 0.3, t.width + 0.3);
    prism(b, ring, h, h + 0.9, { smooth: round, top: true });
    if (round) {
      const n = Math.max(6, Math.round(r * 3));
      for (let i = 0; i < n; i += 1) {
        if (t.condition === "weathered" && i % 3 === 1) continue;
        const a = (i / n) * Math.PI * 2;
        b.push();
        b.transform(Math.sin(a) * (r - 0.05), h + 0.9, Math.cos(a) * (r - 0.05), a);
        chamferBox(b, 0, 0, 0, 0.75, 0.8, 0.45, 0.04);
        b.pop();
      }
    } else {
      const hw = t.width / 2;
      const c: [number, number][] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
      for (let i = 0; i < 4; i++) crenellate(b, c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], h + 0.9, 0.45, 0.75, 0.8, 0.55);
    }
  } else {
    // Timber hoarding on repaired towers, then the roof.
    let eave = h;
    if (repaired && t.repairs.some((x) => x.kind === "new-timber")) {
      b.material(ctx.mat("timber-raw"));
      b.color(1.15, 1.1, 1.0);
      if (round) prism(b, circleOutline(r + 0.65, 14), h - 0.1, h + 1.8, { smooth: false, top: false, bottom: true });
      else prism(b, rectOutline(t.width + 1.3, t.width + 1.3), h - 0.1, h + 1.8, { top: false, bottom: true });
      eave = h + 1.8;
      b.color(tint, tint, tint);
    }
    const roofMat = ctx.mat(ctx.style.keys.roof);
    const rise = round ? r * 2.2 : r * 2.4;
    b.color(1, 1, 1);
    roof(b, {
      form: (t.roof === "conical" || t.roof === "spire" || t.roof === "pyramid" ? t.roof : "pyramid") as RoofShape,
      axis: "z",
      w: round ? t.width + (eave > h ? 1.3 : 0) : t.width + (eave > h ? 1.3 : 0),
      d: t.width + (eave > h ? 1.3 : 0),
      eaveY: eave,
      ridgeY: eave + rise,
      plan: round ? "round" : "rect",
      overhang: 0.35,
      verge: 0.2,
      thickness: 0.15,
      roofMaterial: roofMat,
      gableMaterial: mat,
      trimMaterial: ctx.mat(ctx.style.keys.trim),
      soffitMaterial: ctx.mat("timber-dark"),
      segments: 16,
    });
  }
  b.pop();
  ctx.collider([t.center[0], base + h / 2, t.center[1]], [r + 0.4, h / 2 + 2, r + 0.4], 0, null);
}

/** Gate arches (dark passages with open leaves) and posterns. */
export function buildGates(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("settlement", null).gate(null).shadows(true, true);
  for (const g of bp.gates) {
    const wall = bp.walls.find((w) => w.id === g.wallId);
    const bearing = (g.outwardBearingDeg * Math.PI) / 180;
    const ox = Math.sin(bearing), oz = -Math.cos(bearing);
    const yaw = Math.atan2(ox, oz);
    const ground = ctx.ground(g.position[0], g.position[1]);
    const depth = g.kind === "main-gate" ? 3.4 : g.kind === "inner-gate" ? 2.3 : (wall?.thickness ?? 1) / 2 + 0.1;
    for (const s of [1, -1]) {
      b.push();
      b.transform(g.position[0] + ox * depth * s, ground, g.position[1] + oz * depth * s, s > 0 ? yaw : yaw + Math.PI);
      opening(b, {
        outline: archOutline(g.width, Math.max(0.6, g.height - g.width * 0.6), 0.8, 6),
        glassMaterial: ctx.mat("glass-dark"),
        frameMaterial: ctx.mat(g.kind === "postern" ? ctx.style.keys.rubble : ctx.style.keys.repair),
        frame: g.kind === "postern" ? 0.2 : 0.38,
        proud: g.kind === "postern" ? 0.15 : 0.32,
        glassTint: [0.18, 0.17, 0.2],
      });
      b.pop();
    }
    if (g.kind !== "postern") {
      // Portcullis teeth in the passage head and the open leaves against the reveals.
      b.material(ctx.mat("iron"));
      b.push();
      b.transform(g.position[0] + ox * (depth - 0.5), ground, g.position[1] + oz * (depth - 0.5), yaw);
      const bars = Math.round(g.width / 0.3);
      for (let i = 0; i < bars; i++) box(b, -g.width / 2 + (i + 0.5) * (g.width / bars), g.height - 1.1, 0, 0.07, 1.0, 0.07);
      box(b, 0, g.height - 0.25, 0, g.width, 0.12, 0.09);
      b.pop();
      b.material(ctx.mat("door-oak"));
      for (const s of [1, -1]) {
        b.push();
        b.transform(g.position[0] + ox * (depth * 0.2) + Math.cos(yaw) * s * (g.width / 2 - 0.08), ground, g.position[1] + oz * (depth * 0.2) - Math.sin(yaw) * s * (g.width / 2 - 0.08), yaw + Math.PI / 2);
        box(b, 0, 0, 0, g.width * 0.5, g.height - g.width * 0.35, 0.14);
        b.pop();
      }
    }
  }
}
