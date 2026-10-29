// The Banner Court's ranges: the unfinished West Range (thick walls standing to the
// blueprint height with toothed tops, dressed voids, scaffold with putlogs, a partly
// raised roof frame and the mason's banker) and the range it becomes at the tier that
// completes it; the Lodging with its lime-washed court face, corbelled oriel turret and
// stacks; and the Court Gate with a real passage under its battlemented upper storey.

import type { Building, BuildingMass } from "../../../blueprint";
import { archOutline, bevelPrism, box, chamferBox, lathe, opening, prism, rectOutline, roof, Rng } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";
import type { KitContext } from "../../context";
import { buildArchitecture, massFrame, toWorld } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import { buildGothicMass, enterFace, faceMaterials, faceWall, landmarkLod, landmarkMaterials, lucarne, massCollider, rectFaces, slopedRoof } from "../gothic";
import type { FaceOpening, FaceSpec, LandmarkLod, LandmarkMaterials } from "../gothic";

function rngFor(building: Building, salt: string): Rng {
  return Rng.fromKey(`${building.id}:${salt}`);
}

/** Thick wall shell with through-voids for the unfinished range; tops toothed for the next course. */
function unfinishedShell(b: MeshBuilder, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials, footY: number): void {
  const w = mass.width, d = mass.depth;
  const t = 0.75;
  const eave = mass.eaveHeight;
  const rng = rngFor(building, "toothing");
  const faces = rectFaces(w, d);
  for (let i = 0; i < 4; i++) {
    const face = faces[i];
    const L = face.length;
    const voids: FaceOpening[] = [];
    const bays = Math.max(1, Math.floor((L - 1.6) / 3.2));
    for (let k = 0; k < bays; k++) {
      const u = -L / 2 + 0.8 + ((k + 0.5) * (L - 1.6)) / bays;
      if (i === 0 && Math.abs(u) < 1.2) continue;
      voids.push({ u, width: 1.1, sill: 1.1, height: 2.75, shape: "lancet", depth: t, splay: 0.12, fill: "void", through: t });
    }
    if (i === 0) voids.push({ u: 0, width: 1.6, sill: 0, height: 2.9, shape: "pointed", depth: t, splay: 0.18, fill: "void", through: t });
    // Outer face.
    enterFace(b, face);
    b.material(m.ashlar);
    faceWall(b, { length: L, bottom: footY, top: () => eave, openings: voids, mats: faceMaterials(m, m.ashlar, m.ashlar), cell: lod.cell, segments: lod.segments, detail: lod.detail });
    b.pop();
    // Inner face: the same voids cut in a face set back by the wall thickness and turned inward.
    b.push();
    b.transform(face.cx - face.nx * t, 0, face.cz - face.nz * t, face.yaw + Math.PI);
    b.material(m.ashlar);
    const inner = voids.map((v) => ({ ...v, u: -v.u, cutOnly: true }));
    faceWall(b, { length: L - 2 * t, bottom: 0, top: () => eave, openings: inner, mats: faceMaterials(m, m.ashlar, m.ashlar), cell: 0, segments: lod.segments, detail: 0 });
    b.pop();
    // Wall top: toothed courses, higher at the corners where the masons build first.
    enterFace(b, face);
    b.material(m.ashlar);
    box(b, 0, eave - 0.02, -t / 2, L, 0.02, t, { top: true });
    const blocks = Math.max(4, Math.round(L / 0.9));
    for (let k = 0; k < blocks; k++) {
      const u0 = -L / 2 + (k * L) / blocks;
      const edge = Math.min(k, blocks - 1 - k);
      const courses = edge < 2 ? 2 : edge < 4 ? (rng.chance(0.6) ? 1 : 0) : rng.chance(0.25) ? 1 : 0;
      for (let c = 0; c < courses; c++) box(b, u0 + L / blocks / 2 + (c % 2 ? 0.2 : 0), eave + c * 0.42, -t / 2 + rng.jitter(0.05), L / blocks - 0.04, 0.4, t - 0.06, { top: true });
    }
    b.pop();
  }
}

/** Scaffold of standards, ledgers, putlogs into the wall, planked lifts, braces and a ladder. */
function scaffoldRig(b: MeshBuilder, mass: BuildingMass, wallSide: 1 | -1, lod: LandmarkLod, m: LandmarkMaterials, footY: number): void {
  const L = mass.depth, W = mass.width;
  const h = mass.eaveHeight;
  b.material(m.timberRaw);
  const n = Math.max(3, Math.round(L / 2));
  const xs = [-W * 0.42, W * 0.42];
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + 0.2 + (i * (L - 0.4)) / (n - 1);
    for (const x of xs) box(b, x, footY, z, 0.1, h - footY + 0.9, 0.1);
  }
  for (let y = 1.8; y < h + 0.1; y += 1.8) {
    for (const x of xs) box(b, x, y, 0, 0.08, 0.08, L);
    // Planks and putlogs running into the wall.
    box(b, 0, y + 0.06, 0, W * 0.92, 0.05, L - 0.2, { top: true });
    if (lod.ornament >= 1) for (let i = 0; i < n; i++) box(b, wallSide * W * 0.2, y - 0.08, -L / 2 + 0.2 + (i * (L - 0.4)) / (n - 1), W * 1.3, 0.07, 0.07);
  }
  if (lod.ornament >= 1) {
    // Diagonal braces on the outer face.
    for (let i = 0; i < n - 1; i += 2) {
      const z0 = -L / 2 + 0.2 + (i * (L - 0.4)) / (n - 1), z1 = -L / 2 + 0.2 + ((i + 1) * (L - 0.4)) / (n - 1);
      const len = Math.hypot(z1 - z0, 3.6);
      b.push();
      b.transform(-wallSide * W * 0.44, 1.8 + 1.8, (z0 + z1) / 2, 0, Math.atan2(z1 - z0, 3.6), 0);
      box(b, 0, -len / 2, 0, 0.06, len, 0.06);
      b.pop();
    }
    // Ladder.
    const lz = L / 2 - 1.2;
    box(b, -wallSide * W * 0.62 - 0.25, footY, lz - 0.22, 0.06, h + 0.6 - footY, 0.06);
    box(b, -wallSide * W * 0.62 - 0.25, footY, lz + 0.22, 0.06, h + 0.6 - footY, 0.06);
    for (let y = 0.3; y < h; y += 0.36) box(b, -wallSide * W * 0.62 - 0.25, y, lz, 0.05, 0.05, 0.44);
  }
}

/** The unfinished West Range: walls to the blueprint height now; its completed form appears at the tier that completes it. */
export function buildWestRangeKit(ctx: KitContext, building: Building): void {
  const u = building.unfinished;
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  if (!u) {
    buildArchitecture(ctx, building, { landmark: "banner-hall" });
    return;
  }
  const done = u.completesAtHallTier;
  const walls = building.masses.find((mm) => mm.role !== "scaffold");
  const scaf = building.masses.find((mm) => mm.role === "scaffold");
  if (!walls) return;
  const style = traditionStyle(ctx.style, building.tradition);
  const base = ctx.base(building);
  // Unfinished state (visible until the completing tier).
  b.part("landmark:banner-hall", "banner-hall").gate({ maxHallTier: (done - 1) as 0 | 1 | 2 }).shadows(true, true);
  b.color(1.04, 1.03, 1.0);
  b.uvMode = "world";
  {
    const f = massFrame(building, walls, base, style);
    b.push();
    b.transform(f.cx, f.y0, f.cz, f.yaw);
    b.material(m.ashlar);
    bevelPrism(b, rectOutline(f.w + 0.3, f.d + 0.3), f.footY, 0.25, 0.08);
    unfinishedShell(b, building, walls, lod, m, -0.3);
    // Rubble-strewn floor inside; the roof waits until the walls reach the second storey,
    // so its timbers lie stacked inside rather than raised on walls that will grow.
    b.material(m.ashlar);
    b.color(0.8, 0.78, 0.76);
    prism(b, rectOutline(f.w - 1.5, f.d - 1.5), -0.1, 0.12, { top: true });
    b.color(1.04, 1.03, 1.0);
    if (lod.ornament >= 1) {
      b.material(m.timberRaw);
      for (let i = 0; i < 6; i++) box(b, -0.9 + (i % 3) * 0.32, 0.12 + Math.floor(i / 3) * 0.3, f.d * 0.18, 0.28, 0.28, f.d * 0.5);
    }
    b.pop();
    massCollider(ctx, f, "banner-hall", walls.eaveHeight + 1);
  }
  if (scaf) {
    const f = massFrame(building, scaf, base, style);
    b.push();
    b.transform(f.cx, f.y0, f.cz, f.yaw);
    const side: 1 | -1 = walls.center[0] > scaf.center[0] ? 1 : -1;
    scaffoldRig(b, scaf, side, lod, m, f.footY);
    b.pop();
    massCollider(ctx, f, "banner-hall", scaf.eaveHeight, false);
  }
  // The mason's banker by the activity site.
  const site = ctx.bp.activitySites.find((s) => s.kind === "workbench" && s.district === building.district);
  if (site && lod.ornament >= 1) {
    b.push();
    b.translate(site.position[0], ctx.ground(site.position[0], site.position[2]), site.position[2]);
    b.material(m.ashlar);
    chamferBox(b, 0, 0, 0, 1.2, 0.75, 0.75, 0.05);
    b.color(1.18, 1.15, 1.1);
    chamferBox(b, 0.1, 0.75, 0, 0.7, 0.42, 0.5, 0.03);
    b.color(1.04, 1.03, 1.0);
    b.pop();
  }
  b.gate(null);
  b.color(1, 1, 1);
  // Completed state: the range raised to two storeys under a slate roof, in clean new masonry.
  b.part("landmark:banner-hall", "banner-hall").gate({ minHallTier: done }).shadows(true, true);
  b.color(1.08, 1.07, 1.05);
  const completed: BuildingMass = { ...walls, storeys: 2, eaveHeight: 8.4, ridgeHeight: 15, roof: { form: "steep-gable", ridgeAxis: walls.roof.ridgeAxis, material: "kv-slate" } };
  const rng = rngFor(building, "completed");
  const win = (u: number, s: number): FaceOpening => ({ u, width: 1.1, sill: s === 0 ? 1.2 : 5.2, height: s === 0 ? 2.6 : 2.4, shape: "lancet", depth: 0.4, splay: 0.12, fill: rng.chance(0.5) ? "lit" : "dark", light: 0.8, hood: true, sillDrip: true });
  const longOpenings = (L: number): FaceOpening[] => {
    const out: FaceOpening[] = [];
    const n = Math.max(1, Math.floor((L - 1.6) / 3.2));
    for (let k = 0; k < n; k++) {
      const uu = -L / 2 + 0.8 + ((k + 0.5) * (L - 1.6)) / n;
      out.push(win(uu, 0), win(uu, 1));
    }
    return out;
  };
  const south: FaceSpec = { openings: [{ u: 0, width: 1.6, sill: 0, height: 2.9, shape: "pointed", depth: 0.5, splay: 0.22, orders: 2, fill: "door", hood: true }, win(0, 1)], gable: { coping: true, finial: 1.0 }, courses: [4.6] };
  const north: FaceSpec = { openings: [win(0, 0), win(0, 1)], gable: { coping: true, finial: 0.8 }, courses: [4.6] };
  const long: FaceSpec = { openings: longOpenings(completed.depth), courses: [4.6], quoins: true };
  buildGothicMass({
    ctx, building, mass: completed, landmark: "banner-hall", lod, mats: faceMaterials(m, m.ashlar),
    faces: [south, north, long, long],
    plinth: { material: m.ashlar, steps: [{ offset: 0.25, top: 0.0, bevel: 0.08 }, { offset: 0.1, top: 0.4, bevel: 0.08 }] },
    wallBottom: 0.1,
    extra: (bb, f) => {
      // Stone ridge and iron finials: the tier-gated range reuses materials it already draws with.
      slopedRoof(bb, { a: f.w / 2, length: f.d, eave: completed.eaveHeight, ridge: completed.ridgeHeight, overhang: 0.32, verge: -0.36, thickness: 0.15, roof: m.slate, soffit: m.timberDark, ridgeCap: m.dressing });
      if (lod.ornament >= 1) {
        const k = (completed.ridgeHeight - completed.eaveHeight) / (f.w / 2);
        const by = completed.eaveHeight + 1.6;
        const lx = f.w / 2 - (by - completed.eaveHeight) / k;
        for (const s of [1, -1]) {
          bb.push();
          bb.transform(s * lx, by, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2);
          lucarne(bb, { w: 1.1, h: 1.6, depth: 2.0, wall: m.ashlar, roof: m.slate, louvre: m.glassDark, trim: m.iron });
          bb.pop();
        }
      }
    },
  });
  b.gate(null);
  b.color(1, 1, 1);
}

/**
 * The Lodging: three storeys of domestic Gothic (pointed ground-floor lights, square-headed
 * two-light windows with labels above), a lime-washed court face, parapet gables, dormers,
 * the corbelled oriel turret over the court and the chimney stack (with its smoke source).
 */
export function buildLodgingKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:banner-hall", "banner-hall").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const range = building.masses.find((mm) => mm.role === "wing") ?? building.masses[0];
  const others = building.masses.filter((mm) => mm !== range);
  const rng = rngFor(building, "lodging");
  const washed = building.age.repairs.some((r) => (r.kind === "lime-wash" || r.kind === "fresh-render") && (!r.mass || r.mass === range.id));
  const storeys = Math.max(1, range.storeys);
  const sh = range.eaveHeight / storeys;
  const lit = (): "lit" | "dark" => (rng.chance(0.55) ? "lit" : "dark");
  const win = (u: number, s: number): FaceOpening =>
    s === 0
      ? { u, width: 1.25, sill: 1.0, height: 2.3, shape: "pointed", depth: 0.42, splay: 0.12, fill: lit(), light: 0.8 + rng.next() * 0.3, tracery: lod.quest ? "none" : "two-light", hood: true, sillDrip: true }
      : { u, width: 1.35, sill: s * sh + 0.85, height: 1.75, shape: "rect", depth: 0.38, splay: 0.08, fill: lit(), light: 0.75 + rng.next() * 0.35, tracery: lod.quest ? "none" : "mullion", hood: true, sillDrip: true };
  const bays = (L: number, skip: (u: number) => boolean): FaceOpening[] => {
    const out: FaceOpening[] = [];
    const n = Math.max(1, Math.floor((L - 1.4) / 3.3));
    for (let k = 0; k < n; k++) {
      const u = -L / 2 + 0.7 + ((k + 0.5) * (L - 1.4)) / n;
      if (skip(u)) continue;
      for (let s = 0; s < storeys; s++) out.push(win(u, s));
    }
    return out;
  };
  const door = building.entrance.position;
  // Face 3 (-X, the court face): u runs toward +Z.
  const doorU = door[1] - range.center[1];
  const court = bays(range.depth, (u) => Math.abs(u - doorU) < 1.4).concat([{ u: doorU, width: 1.5, sill: 0, height: 2.9, shape: "pointed", depth: 0.55, splay: 0.24, orders: lod.ornament >= 1 ? 2 : 1, fill: "door", hood: true }]);
  const gableOpen = (): FaceOpening[] => {
    const out: FaceOpening[] = [];
    for (let s = 0; s < storeys; s++) out.push(win(0, s));
    out.push({ u: 0, width: 0.8, sill: range.eaveHeight + 0.9, height: 1.6, shape: "lancet", depth: 0.3, splay: 0.08, fill: "dark", hood: true });
    return out;
  };
  const courses = [sh - 0.05, sh * 2 - 0.05];
  const wash: readonly [number, number, number] = washed ? [1.32, 1.3, 1.24] : [1, 1, 1];
  buildGothicMass({
    ctx, building, mass: range, landmark: "banner-hall", lod, mats: faceMaterials(m, m.ashlar),
    faces: [
      { openings: gableOpen(), gable: { coping: true, finial: 1.0 }, courses, quoins: true },
      { openings: gableOpen(), gable: { coping: true, finial: 0.8 }, courses, quoins: true },
      { openings: bays(range.depth, () => false), courses, quoins: true },
      { openings: court, courses, quoins: true, wash },
    ],
    plinth: { material: m.ashlar, steps: [{ offset: 0.24, top: -0.15, bevel: 0.08 }, { offset: 0.1, top: 0.3, bevel: 0.08 }] },
    wallBottom: -0.3,
    extra: (bb, f) => {
      slopedRoof(bb, { a: f.w / 2, length: f.d, eave: range.eaveHeight, ridge: range.ridgeHeight, overhang: 0.36, verge: -0.36, thickness: 0.15, roof: m.slate, soffit: m.timberDark, ridgeCap: m.lead });
      if (lod.ornament >= 1) {
        const k = (range.ridgeHeight - range.eaveHeight) / (f.w / 2);
        const by = range.eaveHeight + 1.3;
        const lx = f.w / 2 - (by - range.eaveHeight) / k;
        for (const z of [-6.5, 4.5]) {
          for (const s of [1, -1]) {
            bb.push();
            bb.transform(s * lx, by, z, s > 0 ? Math.PI / 2 : -Math.PI / 2);
            lucarne(bb, { w: 1.2, h: 1.7, depth: 2.2, wall: m.ashlar, roof: m.slate, louvre: rng.chance(0.5) ? m.glassLit : m.glassDark, trim: m.lead });
            bb.pop();
          }
        }
      }
    },
  });
  for (const mm of others) {
    if (mm.role === "annex" && (mm.baseOffset ?? 0) > 1) buildOriel(ctx, building, mm, lod, m);
    else buildArchitecture(ctx, building, { landmark: "banner-hall", masses: [mm] });
  }
  b.color(1, 1, 1);
}

/** Corbelled oriel turret: a three-sided bay on a stepped corbel, glazed on each storey, under a lead roof. */
function buildOriel(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  b.part("landmark:banner-hall", "banner-hall").gate(null).shadows(true, true);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  // The bay projects toward the side away from its building's main mass.
  const main = building.masses.find((mm) => mm.role === "wing") ?? building.masses[0];
  const towardMain = Math.sign(main.center[0] - mass.center[0]) || 1;
  const out = -towardMain;
  const hw = f.d / 2, depth = f.w;
  // Plan in local (x out, z along): back corners on the wall, front facet narrower.
  const xb = -out * depth / 2, xf = out * depth / 2;
  const plan: P2[] = [[xb, -hw], [xf, -hw * 0.5], [xf, hw * 0.5], [xb, hw]];
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  b.material(m.ashlar);
  prism(b, plan, 0, eave, { top: false, bottom: true });
  // Stepped corbel below.
  b.material(m.dressing);
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const s = 1 - t * 0.85;
    const pts: P2[] = plan.map((p) => [xb + (p[0] - xb) * s, p[1] * (1 - t * 0.55)] as P2);
    prism(b, pts, -0.42 * (i + 1), -0.42 * i, { top: false, bottom: i === 3 });
  }
  // Glazed lights on the three outer facets, two storeys plus the top stage.
  const facets: [P2, P2][] = [[plan[0], plan[1]], [plan[1], plan[2]], [plan[2], plan[3]]];
  for (const [p, q] of facets) {
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    // Outward normal of the facet: the one pointing away from the wall.
    let nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
    if (nx * out < 0) { nx = -nx; nz = -nz; }
    const fy = Math.atan2(nx, nz);
    for (const sill of [1.0, 4.4]) {
      b.push();
      b.transform(mx + nx * 0.02, sill, mz + nz * 0.02, fy);
      opening(b, { outline: archOutline(Math.min(0.75, len * 0.62), 1.6, 0.88, lod.segments), glassMaterial: rngFor(building, `oriel:${sill}:${mz}`).chance(0.6) ? m.glassLit : m.glassDark, frameMaterial: m.dressing, frame: 0.1, proud: 0.12, sill: lod.ornament >= 1, glassTint: [0.85, 0.85, 0.85] });
      b.pop();
    }
  }
  // String course and cornice.
  b.material(m.dressing);
  prism(b, plan.map((p) => [p[0] + out * 0.06, p[1] * 1.02] as P2), eave - 0.25, eave, { top: true, bottom: true });
  // Lead roof: a half-pyramid against the wall.
  b.material(m.lead);
  const apex: [number, number, number] = [xb, ridge, 0];
  const r0 = plan.map((p) => [p[0] + out * 0.18, p[1] * 1.06] as P2);
  for (let i = 0; i < r0.length - 1; i++) {
    const p = r0[i], q = r0[i + 1];
    b.flatTri(p[0], eave, p[1], q[0], eave, q[1], apex[0], apex[1], apex[2]);
  }
  b.material(m.lead);
  b.push();
  b.translate(xb + out * 0.25, ridge - 0.1, 0);
  lathe(b, [[0.05, 0], [0.08, 0.15], [0.01, 0.7]], 4, { smooth: false });
  b.pop();
  b.pop();
  massCollider(ctx, f, "banner-hall", ridge);
}

/**
 * The Court Gate: a real passage (the arch of the gate opening, lined through the
 * gatehouse) under an upper storey with arrow loops, a battlemented parapet flush with the
 * court-stair face where the house standard hangs, a pyramid roof behind it and a lantern.
 */
export function buildCourtGateKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("settlement", null).gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const mass = building.masses[0];
  const gate = ctx.bp.gates.find((g) => g.kind === "inner-gate" && Math.hypot(g.position[0] - mass.center[0], g.position[1] - mass.center[1]) < Math.max(mass.width, mass.depth));
  const base = ctx.base(building);
  const gw = gate ? gate.width : 3.2, gh = gate ? gate.height : 4.0;
  const spring = Math.max(0.6, gh - gw * 0.6);
  const archY = gate ? ctx.ground(gate.position[0], gate.position[1]) - base.floorY : 0;
  // The passage lining sits just outside the gate ring of the fortifications kit.
  const ringW = gw + 0.9;
  const R = 0.8 * gw, hwG = gw / 2;
  const rise = Math.sqrt(Math.max(R * R - (R - hwG) * (R - hwG), 0));
  const passage: FaceOpening = { u: 0, width: ringW, sill: archY, height: spring + rise + 0.6, shape: "pointed", archK: 0.8 * gw / ringW + 0.05, depth: mass.depth, through: mass.depth, fill: "void" };
  const back: FaceOpening = { ...passage, through: undefined, cutOnly: true };
  const loop = (u: number, y: number): FaceOpening => ({ u, width: 0.2, sill: y, height: 1.2, shape: "rect", depth: 0.5, splay: 0.16, fill: "dark" });
  const upper = mass.eaveHeight * 0.62;
  const front: FaceSpec = { openings: [passage, loop(-2.0, upper)].concat(mass.width > 5.5 ? [loop(2.0, upper)] : []), parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } }, courses: [upper - 0.6] };
  const rear: FaceSpec = { openings: [back, { u: 0, width: 0.9, sill: upper, height: 1.9, shape: "lancet", depth: 0.4, splay: 0.12, fill: "lit", light: 0.8, hood: true }], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0.15, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } }, courses: [upper - 0.6] };
  const sides: FaceSpec = { openings: [loop(0, upper)], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0.15, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } }, courses: [upper - 0.6] };
  buildGothicMass({
    ctx, building, mass, landmark: null, lod, mats: faceMaterials(m, m.ashlar),
    faces: [front, rear, sides, sides],
    plinth: { material: m.ashlar, steps: [{ offset: 0.2, top: -0.05, bevel: 0.06 }] },
    wallBottom: Math.min(-0.25, archY - 0.05),
    extra: (bb, f) => {
      roof(bb, { form: "pyramid", axis: "z", w: f.w - 0.7, d: f.d - 0.7, eaveY: mass.eaveHeight - 0.2, ridgeY: mass.ridgeHeight, plan: "rect", overhang: 0, verge: 0, thickness: 0.12, roofMaterial: m.slate, gableMaterial: m.ashlar, trimMaterial: m.lead });
      // Iron lantern on a bracket beside the passage (court-stair face).
      const zf = f.d / 2;
      bb.material(m.iron);
      box(bb, ringW / 2 + 0.75, upper - 1.2, zf + 0.3, 0.06, 0.06, 0.6);
      bb.material(m.glassLit);
      chamferBox(bb, ringW / 2 + 0.75, upper - 1.75, zf + 0.55, 0.26, 0.4, 0.26, 0.04);
      ctx.lights.push({ name: `${building.id}:lantern`, position: toWorldY(f, ringW / 2 + 0.75, upper - 1.5, zf + 0.55), color: "#ffb870", intensity: 3, range: 8, flicker: 0.15, priority: 1, gate: null });
    },
  });
  b.color(1, 1, 1);
}

function toWorldY(f: ReturnType<typeof massFrame>, x: number, y: number, z: number): [number, number, number] {
  const p = toWorld(f, x, z);
  return [p[0], f.y0 + y, p[1]];
}
