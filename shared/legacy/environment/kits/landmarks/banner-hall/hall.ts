// The Banner Hall itself (district A): the lead-roofed Gothic hall with buttressed bays,
// tracery and a parapet gable over the black marble porch, the six-storey keep with its
// limestone-rebuilt machicolated crown, bartizans and broach-less spire, the stair turret
// and the flèche with its bell lantern. Footprints, eaves and ridges are the blueprint's.

import type { Building, BuildingMass } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, lathe, offsetPolygon, opening, archOutline, prism, rectOutline, hashString, Rng } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";
import type { KitContext } from "../../context";
import { massFrame, toWorld } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import {
  bartizan, barAlong, buildGothicMass, quadSafe, cresting, enterFace, faceMaterials, fleche, leadRolls, lucarne, massCollider, octagonalSpire, slopedRoof,
} from "../gothic";
import type { ButtressSpec, FaceOpening, FaceSpec, LandmarkLod, LandmarkMaterials } from "../gothic";

const LONG_BAYS = [-10.83, -6.5, -2.17, 2.17, 6.5, 10.83];
const LONG_BUTTRESS_U = [-8.67, -4.33, 0, 4.33, 8.67];

function litOrDark(rng: Rng, p: number): "lit" | "dark" {
  return rng.chance(p) ? "lit" : "dark";
}

/** Heater-shield outline [u, y] of width w and height h from its point at the origin. */
export function shieldOutline(w: number, h: number, seg = 6): P2[] {
  const out: P2[] = [[-w / 2, h], [-w / 2, h * 0.45]];
  for (let i = 1; i < seg; i++) {
    const t = i / seg;
    const a = (t * Math.PI) / 2;
    out.push([-w / 2 * Math.cos(a), h * 0.45 * (1 - Math.sin(a))]);
  }
  out.push([0, 0]);
  for (let i = seg - 1; i >= 1; i--) {
    const t = i / seg;
    const a = (t * Math.PI) / 2;
    out.push([(w / 2) * Math.cos(a), h * 0.45 * (1 - Math.sin(a))]);
  }
  out.push([w / 2, h * 0.45], [w / 2, h]);
  return out;
}

export function buildHallMass(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const rng = Rng.fromKey(`hall:${building.id}`);
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  // "Two gallery lancets boarded": the two middle bays of the west face.
  const boarded = new Set<number>();
  if (building.age.repairs.some((r) => r.kind === "boarded-opening" && (!r.mass || r.mass === mass.id))) {
    boarded.add(-2.17);
    boarded.add(2.17);
  }
  const longWindow = (u: number, west: boolean): FaceOpening => ({
    u, width: 1.9, sill: 2.8, height: 6.6, shape: "pointed", depth: 0.5, splay: 0.22,
    fill: west && boarded.has(u) ? "boarded" : litOrDark(rng, 0.45), light: 0.75 + rng.next() * 0.35,
    tracery: lod.detail >= 1 && !lod.quest ? "two-light" : "mullion", hood: true, sillDrip: true,
  });
  const stages = [{ depth: 1.2, top: 4.2 }, { depth: 0.9, top: 7.6 }, { depth: 0.6, top: 10.2 }];
  const pin = lod.detail >= 1 ? 3.4 : 2.6;
  const longButtresses: ButtressSpec[] = LONG_BUTTRESS_U.map((u) => ({ u, width: 0.95, stages, pinnacle: pin }));
  const cornerStages = [{ depth: 1.0, top: 4.6 }, { depth: 0.75, top: 8.0 }, { depth: 0.5, top: 10.4 }];
  const corner = (u: number): ButtressSpec => ({ u, width: 1.0, stages: cornerStages, pinnacle: pin });
  const parapetSpec = { y0: eave - 0.3, y1: eave + 0.75, proj: 0.22, thick: 0.45, merlons: null };
  const courses = [2.45];
  const south: FaceSpec = {
    openings: [
      { u: 0, width: 4.2, sill: 10.15, height: 7.0, shape: "pointed", depth: 0.55, splay: 0.3, fill: "lit", light: 0.95, tracery: lod.quest ? "mullion" : "three-light", hood: true, sillDrip: true },
      { u: -4.75, width: 0.9, sill: 2.4, height: 3.4, shape: "lancet", depth: 0.4, splay: 0.12, fill: litOrDark(rng, 0.5), light: 0.8, hood: true, sillDrip: true },
      { u: 4.75, width: 0.9, sill: 2.4, height: 3.4, shape: "lancet", depth: 0.4, splay: 0.12, fill: litOrDark(rng, 0.5), light: 0.8, hood: true, sillDrip: true },
    ],
    buttresses: [corner(-6.0), corner(6.0)],
    gable: { coping: true, finial: 1.6 },
    courses: [2.45, eave - 0.12],
  };
  const north: FaceSpec = {
    openings: [
      { u: 0, width: 2.6, sill: 9.0, height: 6.0, shape: "pointed", depth: 0.45, splay: 0.2, fill: litOrDark(rng, 0.3), light: 0.7, tracery: lod.quest ? "mullion" : "two-light", hood: true, sillDrip: true },
      { u: -3.2, width: 0.9, sill: 2.4, height: 3.4, shape: "lancet", depth: 0.4, splay: 0.12, fill: "dark", hood: true },
      { u: 3.2, width: 0.9, sill: 2.4, height: 3.4, shape: "lancet", depth: 0.4, splay: 0.12, fill: "dark", hood: true },
    ],
    buttresses: [corner(-6.0), corner(6.0)],
    gable: { coping: true, finial: 1.2 },
    courses: [2.45, eave - 0.12],
  };
  const east: FaceSpec = { openings: LONG_BAYS.map((u) => longWindow(u, false)), buttresses: longButtresses.concat([corner(12.5)]), parapet: parapetSpec, courses };
  const west: FaceSpec = { openings: LONG_BAYS.map((u) => longWindow(u, true)), buttresses: longButtresses.concat([corner(12.5)]), parapet: parapetSpec, courses };
  const patched = building.age.repairs.some((r) => r.kind === "patched-roof" && (!r.mass || r.mass === mass.id));
  buildGothicMass({
    ctx, building, mass, landmark: "banner-hall", lod, mats: faceMaterials(m, m.ashlar),
    faces: [south, north, east, west],
    plinth: { material: m.ashlar, steps: [{ offset: 0.36, top: -0.2, bevel: 0.1 }, { offset: 0.22, top: 0.25, bevel: 0.12 }, { offset: 0.1, top: 0.62, bevel: 0.1 }] },
    wallBottom: 0.3,
    extra: (b, f) => {
      const a = f.w / 2;
      slopedRoof(b, { a, length: f.d, eave, ridge, overhang: 0, verge: -0.36, thickness: 0.18, roof: m.lead, soffit: m.timberDark, ridgeCap: m.lead });
      if (lod.rolls > 0) leadRolls(b, { a, length: f.d - 0.8, eave, ridge, overhang: 0, spacing: lod.rolls, material: m.lead, margin: 0.4 });
      if (patched) {
        // New lead sheets on the west slope, brighter than the dulled east slope.
        b.material(m.lead);
        const prev = b.getColor();
        b.color(prev[0] * 1.35, prev[1] * 1.33, prev[2] * 1.3);
        const ang = Math.atan2(ridge - eave, a);
        b.push();
        b.transform(-a * 0.52, eave + (ridge - eave) * 0.48 + 0.035, 1.5, 0, 0, ang);
        box(b, 0, 0, 0, (a * 0.62) / Math.cos(ang), 0.02, 9.5, { top: true });
        b.pop();
        b.color(prev[0], prev[1], prev[2]);
      }
      if (lod.cresting) cresting(b, { length: f.d - 1.0, y: ridge + 0.08, spacing: 0.55, height: 0.55, material: m.iron });
      if (lod.ornament >= 1) {
        const k = (ridge - eave) / a;
        const baseY = 13.2;
        const lx = a - (baseY - eave) / k;
        for (const z of [-3.2, 7.4]) {
          for (const s of [1, -1]) {
            b.push();
            b.transform(s * lx, baseY, z, s > 0 ? Math.PI / 2 : -Math.PI / 2);
            lucarne(b, { w: 1.3, h: 1.9, depth: 2.2, wall: m.lead, roof: m.lead, louvre: m.timberDark, trim: m.lead });
            b.pop();
          }
        }
      }
      // The previous holders' arms, chiselled flat, high on the south gable.
      enterFace(b, { nx: 0, nz: 1, cx: 0, cz: f.d / 2, length: f.w, yaw: 0, long: false });
      b.material(m.ashlar);
      const sh = shieldOutline(1.15, 1.45, lod.ornament >= 1 ? 5 : 3);
      const sy = 18.9;
      const pts = sh.map((p) => [p[0], p[1] + sy] as P2);
      const prev = b.getColor();
      b.color(prev[0] * 1.22, prev[1] * 1.2, prev[2] * 1.16);
      panelAt(b, pts, 0.07);
      b.color(prev[0], prev[1], prev[2]);
      if (lod.ornament >= 1) {
        b.material(m.dressing);
        const frame = offsetPolygon(sh, 0.12).map((p) => [p[0], p[1] + sy] as P2);
        barAlong(b, frame, 0.14, 0, 0.13, true);
      }
      b.pop();
    },
  });
}

/** Flat panel at depth z in the current face frame (normal +z). */
function panelAt(b: MeshBuilder, pts: readonly P2[], z: number): void {
  // Thin plate with side faces so the raised panel reads at grazing angles.
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    quadSafe(b, q[0], q[1], z, p[0], p[1], z, p[0], p[1], 0, q[0], q[1], 0);
  }
  // Front cap via fan from the centroid (convex outline).
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  const c = b.vertex(cx, cy, z, 0, 0, 1);
  const ring = pts.map((p) => b.vertex(p[0], p[1], z, 0, 0, 1));
  for (let i = 0; i < n; i++) b.tri(c, ring[i], ring[(i + 1) % n]);
}

/**
 * The black marble porch on the hall's south gable: a portal of receding orders with gilt
 * capital bands, a crocketed parapet gable carrying the house emblem in a moulded frame,
 * pinnacled angle buttresses, side lancets, a lead roof and steps down to the court.
 */
export function buildPorch(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials, emblemY: number): void {
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const portal: FaceOpening = { u: 0, width: 2.0, sill: 0, height: 3.6, shape: "pointed", depth: 0.95, splay: 0.6, orders: lod.ornament >= 1 ? 3 : 1, fill: "door", hood: true };
  const side = (u: number): FaceOpening => ({ u, width: 0.75, sill: 1.6, height: 2.4, shape: "lancet", depth: 0.35, splay: 0.1, fill: "lit", light: 0.7, hood: true, sillDrip: true });
  const st = [{ depth: 0.7, top: 3.2 }, { depth: 0.45, top: 5.5 }];
  const front: FaceSpec = {
    openings: [portal],
    buttresses: [{ u: -2.95, width: 0.7, stages: st, pinnacle: lod.detail >= 1 ? 2.6 : 2.0 }, { u: 2.95, width: 0.7, stages: st, pinnacle: lod.detail >= 1 ? 2.6 : 2.0 }],
    gable: { coping: true, finial: 1.3 },
  };
  const f = buildGothicMass({
    ctx, building, mass, landmark: "banner-hall", lod, mats: faceMaterials(m, m.marble, m.dressing),
    faces: [front, null, { openings: [side(0)] }, { openings: [side(0)] }],
    plinth: { material: m.marble, steps: [{ offset: 0.22, top: -0.3, bevel: 0.06 }, { offset: 0.1, top: -0.02, bevel: 0.05 }] },
    wallBottom: -0.3,
    extra: (b, fr) => {
      const a = fr.w / 2;
      // Roof from just behind the front parapet gable back into the hall gable.
      b.push();
      b.translate(0, 0, -0.33);
      slopedRoof(b, { a, length: fr.d - 0.05, eave, ridge, overhang: 0.18, verge: 0, thickness: 0.14, roof: m.lead, soffit: m.timberDark, ridgeCap: m.lead });
      b.pop();
      // Steps from the court up to the porch floor.
      b.material(m.marble);
      const z0 = fr.d / 2;
      const drop = Math.max(0.2, fr.y0 - fr.base.groundMin);
      const n = Math.max(1, Math.round(drop / 0.2));
      for (let i = 0; i < n; i++) {
        const depth = (n - i) * 0.34;
        bevelPrism(b, rectOutline(4.4 - i * 0.1, depth, 0, z0 + depth / 2), -drop + (i * drop) / n - 0.05, -drop + ((i + 1) * drop) / n, 0.03);
      }
      enterFace(b, { nx: 0, nz: 1, cx: 0, cz: fr.d / 2, length: fr.w, yaw: 0, long: false });
      // Gilt capital bands where each order springs.
      if (lod.ornament >= 1) {
        b.material(m.gilt);
        const spring = 3.6 - 1.732;
        for (let k = 0; k < 3; k++) {
          const off = 0.6 * (1 - k / 3);
          const z = -k * Math.min(0.95 * 0.7, 0.32 * 3) / 3;
          for (const s of [-1, 1]) box(b, s * (1.0 + off - 0.05), spring - 0.12, z - 0.06, 0.22, 0.14, 0.14);
        }
      }
      // Iron lanterns on brackets either side of the portal.
      for (const sx of [-1, 1]) {
        b.material(m.iron);
        box(b, sx * 1.95, 3.2, 0.22, 0.05, 0.05, 0.44);
        box(b, sx * 1.95, 3.25, 0.42, 0.04, 0.3, 0.04);
        b.material(m.glassLit);
        chamferBox(b, sx * 1.95, 2.55, 0.42, 0.24, 0.42, 0.24, 0.04);
        b.material(m.iron);
        b.push();
        b.translate(sx * 1.95, 2.97, 0.42);
        lathe(b, [[0.17, 0], [0.02, 0.2]], 4, { smooth: false, phase: Math.PI / 4 });
        b.pop();
      }
      // The emblem's moulded frame on the gable (the emblem itself is a banner mount).
      const ey = emblemY;
      b.material(m.marble);
      // A canted frame that stays inside the gable line around the emblem plate.
      const frame: P2[] = [[-0.98, ey - 1.06], [0.98, ey - 1.06], [0.98, ey + 0.66], [0.56, ey + 1.16], [-0.56, ey + 1.16], [-0.98, ey + 0.66]];
      barAlong(b, frame, 0.2, 0, 0.3, true);
      // Hall tier 3 ("gilded emblem"): the frame's inner moulding is gilded.
      const tier3 = ctx.bp.slots.hallTiers.find((t) => t.dressing.indexOf("gilded-emblem") >= 0);
      if (tier3) {
        // A thin moulding: it casts no shadow, so the tier costs one draw rather than two.
        b.gate({ minHallTier: tier3.tier as 1 | 2 | 3 }).shadows(false, true);
        b.material(m.gilt);
        barAlong(b, frame.map((p) => [p[0] * 0.9, ey + (p[1] - ey) * 0.92] as P2), 0.06, 0.28, 0.34, true);
        b.gate(null).shadows(true, true);
      }
      b.material(m.gilt);
      if (lod.ornament >= 1) {
        // Crockets climbing the gable coping (restrained gilt points).
        const k = (ridge - eave) / a;
        for (let i = 1; i <= 4; i++) {
          const t = i / 5;
          for (const s of [-1, 1]) {
            const x = s * a * (1 - t);
            const y = eave + (ridge - eave) * t + 0.42;
            b.push();
            b.transform(x, y, 0.1, 0, 0, s * Math.atan(k) * 0.5);
            lathe(b, [[0.08, 0], [0.03, 0.22]], 4, { smooth: false });
            b.pop();
          }
        }
      }
      b.pop();
    },
  });
  void f;
}

/**
 * The keep: battered base, clasping corner buttresses, slit-lit storeys, a two-light
 * chamber window, a machicolated crown rebuilt in pale limestone (the seam runs level
 * all round), corbelled bartizans and an octagonal lead spire with lucarnes. The veiled
 * standard on the spire tip is a banner mount.
 */
export function buildKeep(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const storeys = Math.max(1, mass.storeys);
  const sh = eave / storeys;
  const rng = Rng.fromKey(`keep:${building.id}`);
  const rebuilt = building.age.repairs.some((r) => r.kind === "rebuilt-courses" && (!r.mass || r.mass === mass.id));
  const crownStone = rebuilt ? m.dressing : m.ashlar;
  const faceOpenings = (fi: number): FaceOpening[] => {
    const out: FaceOpening[] = [];
    for (let s = 0; s < storeys; s++) {
      const y = s * sh;
      if (s === storeys - 1) {
        for (const u of [-1.55, 1.55]) out.push({ u, width: 0.72, sill: y + 0.9, height: 2.3, shape: "lancet", depth: 0.45, splay: 0.12, fill: litOrDark(rng, 0.55), light: 0.85, hood: true, sillDrip: true });
      } else if (s === storeys - 2 && fi !== 1) {
        out.push({ u: 0, width: 1.5, sill: y + 0.9, height: 2.6, shape: "pointed", depth: 0.45, splay: 0.16, fill: litOrDark(rng, 0.5), light: 0.8, tracery: lod.quest ? "none" : "two-light", hood: true, sillDrip: true });
      } else if (s >= 1) {
        out.push({ u: s % 2 === 0 ? -1.4 : 1.4, width: 0.22, sill: y + sh * 0.32, height: 1.3, shape: "rect", depth: 0.6, splay: 0.2, fill: "dark" });
      }
    }
    return out;
  };
  const cl = [{ depth: 0.75, top: 6.5 }, { depth: 0.5, top: 13 }, { depth: 0.28, top: 18.2 }];
  const corners: ButtressSpec[] = [{ u: -3.8, width: 0.9, stages: cl }, { u: 3.8, width: 0.9, stages: cl }];
  const courses = [sh * 2, sh * 4];
  const faces: (FaceSpec | null)[] = [0, 1, 2, 3].map((i) => ({ openings: faceOpenings(i), buttresses: corners, courses }));
  buildGothicMass({
    ctx, building, mass, landmark: "banner-hall", lod, mats: faceMaterials(m, m.ashlar),
    faces,
    plinth: { material: m.ashlar, steps: [{ offset: 0.6, top: 1.2, bevel: 0.55 }, { offset: 0.14, top: 1.55, bevel: 0.1 }] },
    wallBottom: 0.8,
    wallTop: eave - 0.4,
    extra: (b, f) => {
      const hw = f.w / 2;
      const proj = 0.5;
      // Machicolation: corbel brackets carrying the projecting parapet.
      b.material(m.ashlar);
      const spacing = lod.ornament >= 1 ? 0.85 : 1.7;
      for (let fi = 0; fi < 4; fi++) {
        b.push();
        b.rotateY((fi * Math.PI) / 2);
        const n = Math.max(2, Math.round((f.w + proj * 2) / spacing));
        for (let i = 0; i < n; i++) {
          const x = -hw - proj + ((i + 0.5) * (f.w + proj * 2)) / n;
          box(b, x, eave - 1.75, hw + 0.15, 0.3, 0.42, 0.3);
          box(b, x, eave - 1.33, hw + 0.28, 0.32, 0.42, 0.56);
          if (lod.ornament >= 1) box(b, x, eave - 0.91, hw + 0.38, 0.34, 0.33, 0.76);
        }
        b.pop();
      }
      // The rebuilt crown: parapet, walkway and merlons in pale stone above a level seam.
      const outer = rectOutline(f.w + proj * 2, f.d + proj * 2);
      const inner = rectOutline(f.w + proj * 2 - 0.8, f.d + proj * 2 - 0.8);
      b.material(crownStone);
      prism(b, outer, eave - 0.58, eave + 1.05, { top: false, bottom: true });
      prism(b, inner, eave - 0.1, eave + 1.05, { top: false, inward: true });
      b.material(m.dressing);
      bevelPrism(b, offsetPolygon(outer, 0.05), eave - 0.66, eave - 0.52, 0.04, { bottom: true });
      b.material(m.flagstone);
      b.shadows(false, true);
      prism(b, inner, eave - 0.12, eave - 0.02, { top: true });
      b.shadows(true, true);
      b.material(crownStone);
      const keepMerlon = (i: number): boolean => i >= 0;
      const ch = hw + proj - 0.2;
      for (let fi = 0; fi < 4; fi++) {
        b.push();
        b.rotateY((fi * Math.PI) / 2);
        const n = Math.max(3, Math.floor((f.w + proj * 2 - 1.2) / 1.25));
        for (let i = 0; i < n; i++) {
          if (!keepMerlon(i)) continue;
          const x = -ch + 0.9 + (i * (2 * ch - 1.8)) / Math.max(1, n - 1);
          box(b, x, eave + 1.05, ch, 0.72, 0.82, 0.4, { top: true });
        }
        b.pop();
      }
      b.material(m.dressing);
      bevelPrism(b, offsetPolygon(outer, 0.04), eave + 1.0, eave + 1.12, 0.04);
      // Corner bartizans on corbels.
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        b.push();
        b.translate(sx * (hw + 0.25), 0, sz * (hw + 0.25));
        bartizan(b, { r: 0.95, corbelY: eave - 3.0, baseY: eave - 1.4, topY: eave + 1.8, capTop: eave + 4.4, wall: crownStone, cap: m.lead, trim: m.lead, segments: lod.ornament >= 1 ? 10 : 7 });
        b.pop();
      }
      octagonalSpire(b, { y0: eave - 0.05, y1: ridge, r: 3.55, material: m.lead, trim: m.lead, lucarnes: lod.ornament >= 1, finial: 0, detail: lod.ornament });
      void rng;
    },
  });
}

/** Round stair turret: plinth ring, slits climbing with the stair, a corbelled crown and a slate cone. */
export function buildRoundTurret(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials, landmark: "banner-hall" | "heralds-station" | null): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  const r = f.w / 2;
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const seg = lod.detail >= 2 ? 20 : lod.detail === 1 ? 16 : 10;
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  b.material(m.ashlar);
  prism(b, circleOutline(r + 0.22, seg, Math.PI / seg), f.footY, 0.35, { smooth: true, top: true });
  prism(b, circleOutline(r, seg, Math.PI / seg), 0.35, eave - 1.1, { smooth: true, top: false });
  // Corbelled crown and parapet ring under the cone.
  lathe(b, [[r, eave - 1.1], [r + 0.32, eave - 0.55], [r + 0.32, eave]], seg, { smooth: false, phase: Math.PI / seg });
  b.material(m.dressing);
  if (lod.ornament >= 1) prism(b, circleOutline(r + 0.07, seg, Math.PI / seg), eave * 0.55, eave * 0.55 + 0.18, { smooth: true, top: true, bottom: true });
  lathe(b, [[r + 0.36, eave - 0.02], [r + 0.36, eave + 0.12]], seg, { smooth: true, capTop: false });
  // Slits following the stair, turned away from neighbouring masses.
  const steps = Math.max(3, Math.floor(eave / 2.4));
  for (let i = 0; i < steps; i++) {
    const a = 0.6 + i * 1.15;
    const nx = Math.sin(a), nz = Math.cos(a);
    const p = toWorld(f, nx * (r + 0.7), nz * (r + 0.7));
    const y = 1.6 + i * 2.25;
    if (y + 1.2 > eave - 1.2) break;
    if (ctx.masses.occupied(p[0], f.y0 + y + 0.6, p[1], (bid, mm) => bid === building.id && mm === mass)) continue;
    b.push();
    b.transform(nx * (r - 0.03), y, nz * (r - 0.03), a);
    opening(b, { outline: archOutline(0.2, 0.95, 0.9, 3), glassMaterial: m.glassDark, frameMaterial: m.dressing, frame: 0.09, proud: 0.1 });
    b.pop();
  }
  b.material(m.slate);
  lathe(b, [[r + 0.48, eave + 0.05], [r * 0.62, eave + (ridge - eave) * 0.42], [0.03, ridge]], seg, { smooth: true });
  b.material(m.lead);
  b.push();
  b.translate(0, ridge - 0.05, 0);
  lathe(b, [[0.07, 0], [0.11, 0.2], [0.04, 0.36], [0.012, 1.2]], 6, { smooth: false });
  b.pop();
  b.pop();
  massCollider(ctx, f, landmark, ridge);
}

/** The flèche astride the hall ridge (a mass with a base offset on the roof). */
export function buildFleche(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  b.push();
  // The mass frame's y0 already includes the base offset: build in local y from 0.
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  // The base starts inside the roof slopes and rises clear of the ridge before the lantern.
  const top = mass.ridgeHeight;
  fleche(b, { y0: 0.4, baseTop: top * 0.42, lanternTop: top * 0.64, top, r: Math.min(f.w, f.d) * 0.47, lead: m.lead, post: m.lead, bell: lod.ornament >= 1 ? m.bronze : null, finial: m.gilt, detail: lod.ornament });
  b.pop();
  massCollider(ctx, f, "banner-hall", mass.ridgeHeight, false);
  void chamferBox;
  void hashString;
}
