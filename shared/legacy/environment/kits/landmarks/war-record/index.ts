// War Record kit (district F): the archive on its shelf as authored Gothic (a tall south
// gable with a great tracery window over a square-headed door whose raw oak lintel waits
// to be carved, buttressed lancet bays), the iron-banded record tower under a broach
// spire, the half-timbered gallery bridge to the Lodging on struts and corbels, the
// interior (war table at the record-marker slots, ledger presses whose upper shelves are
// still empty, lectern and chest), and the Record Gallery that appears at hall tier 2
// on its marked plot. The record markers themselves are state slots.

import type { Building, BuildingMass } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, prism, rectOutline, Rng } from "../../../kernel";
import type { P2, StateGate } from "../../../kernel";
import type { KitContext } from "../../context";
import { massFrame } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import {
  barAlong, buildGothicMass, enterFace, faceMaterials, landmarkLod, landmarkMaterials, lucarne, massCollider, octagonalSpire, rectFaces, slopedRoof,
} from "../gothic";
import type { ButtressSpec, FaceOpening, FaceSpec, LandmarkLod, LandmarkMaterials } from "../gothic";
import { shieldOutline } from "../banner-hall/hall";

function archiveHouse(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const rng = Rng.fromKey(`archive:${building.id}`);
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const newLintel = building.age.repairs.some((r) => r.kind === "new-lintel");
  const lit = (p: number): "lit" | "dark" => (rng.chance(p) ? "lit" : "dark");
  const lancet = (u: number): FaceOpening => ({ u, width: 1.15, sill: 2.6, height: 5.4, shape: "lancet", depth: 0.45, splay: 0.16, fill: lit(0.6), light: 0.7 + rng.next() * 0.3, tracery: lod.quest ? "none" : "mullion", hood: true, sillDrip: true });
  const st = [{ depth: 1.0, top: 3.6 }, { depth: 0.72, top: 6.6 }, { depth: 0.45, top: 8.9 }];
  const pin = lod.detail >= 1 ? 2.6 : 2.0;
  const bays = [-5.4, -1.8, 1.8, 5.4];
  const longButtress: ButtressSpec[] = [-7.2, -3.6, 0, 3.6, 7.2].map((u) => ({ u, width: 0.85, stages: st, pinnacle: pin }));
  const door: FaceOpening = { u: 0, width: 1.5, sill: 0, height: 2.45, shape: "rect", depth: 0.5, splay: 0.14, fill: "door" };
  const south: FaceSpec = {
    openings: [door, { u: 0, width: 3.4, sill: 4.3, height: 5.8, shape: "pointed", depth: 0.5, splay: 0.26, fill: "lit", light: 0.8, tracery: lod.quest ? "mullion" : "three-light", hood: true, sillDrip: true }],
    buttresses: [{ u: -4.45, width: 0.9, stages: st, pinnacle: pin }],
    gable: { coping: true, finial: 1.4 },
    courses: [2.9, eave - 0.1],
  };
  const north: FaceSpec = {
    openings: [{ u: 0, width: 2.2, sill: 4.0, height: 5.0, shape: "pointed", depth: 0.45, splay: 0.2, fill: lit(0.4), light: 0.7, tracery: lod.quest ? "mullion" : "two-light", hood: true, sillDrip: true }],
    buttresses: [{ u: -4.45, width: 0.9, stages: st, pinnacle: pin }, { u: 4.45, width: 0.9, stages: st, pinnacle: pin }],
    gable: { coping: true, finial: 1.0 },
    courses: [2.9, eave - 0.1],
  };
  const long = (): FaceSpec => ({ openings: bays.map(lancet), buttresses: longButtress, courses: [2.25], parapet: { y0: eave - 0.3, y1: eave + 0.7, proj: 0.2, thick: 0.42, merlons: null } });
  buildGothicMass({
    ctx, building, mass, landmark: "war-record", lod, mats: faceMaterials(m, m.ashlar),
    faces: [south, north, long(), long()],
    plinth: { material: m.ashlar, steps: [{ offset: 0.34, top: -0.15, bevel: 0.1 }, { offset: 0.18, top: 0.2, bevel: 0.1 }, { offset: 0.08, top: 0.45, bevel: 0.08 }] },
    wallBottom: -0.3,
    extra: (b, f) => {
      const a = f.w / 2;
      slopedRoof(b, { a, length: f.d, eave, ridge, overhang: 0, verge: -0.36, thickness: 0.15, roof: m.slate, soffit: m.timberDark, ridgeCap: m.lead });
      if (lod.ornament >= 1) {
        const k = (ridge - eave) / a;
        const by = eave + 1.8;
        const lx = a - (by - eave) / k;
        for (const s of [1, -1]) {
          b.push();
          b.transform(s * lx, by, -3.5, s > 0 ? Math.PI / 2 : -Math.PI / 2);
          lucarne(b, { w: 1.0, h: 1.5, depth: 1.9, wall: m.lead, roof: m.slate, louvre: m.timberDark, trim: m.lead });
          b.pop();
        }
      }
      // The door: a raw oak lintel (replaced, not yet carved) under a pointed relieving arch.
      enterFace(b, rectFaces(f.w, f.d)[0]);
      b.material(newLintel ? m.timberRaw : m.dressing);
      const prev = b.getColor();
      if (newLintel) b.color(prev[0] * 1.35, prev[1] * 1.25, prev[2] * 1.12);
      chamferBox(b, 0, door.height, 0.02, door.width + 0.7, 0.3, 0.32, 0.03);
      b.color(prev[0], prev[1], prev[2]);
      b.material(m.dressing);
      // Pointed relieving arch over the lintel (radius 1.5 m, half-span 1.1 m).
      const arch: P2[] = [];
      const R = 1.5, hw = 1.1;
      const cxr = hw - R;
      const apexA = Math.atan2(Math.sqrt(R * R - cxr * cxr), -cxr);
      const y0 = door.height + 0.3;
      for (let i = 0; i <= 5; i++) {
        const ang = (apexA * i) / 5;
        arch.push([-(cxr + Math.cos(ang) * R), y0 + Math.sin(ang) * R]);
      }
      for (let i = 4; i >= 0; i--) {
        const ang = (apexA * i) / 5;
        arch.push([cxr + Math.cos(ang) * R, y0 + Math.sin(ang) * R]);
      }
      barAlong(b, arch, 0.22, 0, 0.14);
      b.pop();
    },
  });
}

function recordTower(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const storeys = Math.max(1, mass.storeys);
  const sh = eave / storeys;
  const strapped = building.age.repairs.some((r) => r.kind === "iron-strapping" && (!r.mass || r.mass === mass.id));
  const rng = Rng.fromKey(`record-tower:${building.id}`);
  const faceOpen = (): FaceOpening[] => {
    const out: FaceOpening[] = [];
    for (let s = 0; s < storeys; s++) {
      if (s === storeys - 1) out.push({ u: 0, width: 0.9, sill: s * sh + 0.9, height: 2.3, shape: "lancet", depth: 0.4, splay: 0.12, fill: rng.chance(0.5) ? "lit" : "dark", light: 0.75, tracery: "none", hood: true, sillDrip: true });
      else if (s > 0) out.push({ u: s % 2 ? 0.9 : -0.9, width: 0.22, sill: s * sh + 1.0, height: 1.25, shape: "rect", depth: 0.5, splay: 0.16, fill: "dark" });
    }
    return out;
  };
  const cl = [{ depth: 0.55, top: 6 }, { depth: 0.35, top: 11.5 }];
  const corner: ButtressSpec[] = [{ u: -2.4, width: 0.7, stages: cl }, { u: 2.4, width: 0.7, stages: cl }];
  const faces: FaceSpec[] = [0, 1, 2, 3].map(() => ({ openings: faceOpen(), buttresses: corner, courses: [sh * 2] }));
  buildGothicMass({
    ctx, building, mass, landmark: "war-record", lod, mats: faceMaterials(m, m.ashlar),
    faces,
    plinth: { material: m.ashlar, steps: [{ offset: 0.32, top: -0.1, bevel: 0.1 }, { offset: 0.14, top: 0.35, bevel: 0.08 }] },
    wallBottom: -0.3,
    extra: (b, f) => {
      // Corbelled eaves course, then the broach spire straight off the tower walls.
      b.material(m.dressing);
      bevelPrism(b, rectOutline(f.w + 0.3, f.d + 0.3), eave - 0.35, eave + 0.05, 0.12, { bottom: true });
      if (strapped) {
        // Iron bands where frost split the quoins.
        b.material(m.iron);
        for (const y of [sh * 1.05, sh * 2.2, sh * 3.1]) prism(b, rectOutline(f.w + 0.09, f.d + 0.09), y, y + 0.13, { top: true, bottom: true });
      }
      octagonalSpire(b, { y0: eave + 0.05, y1: ridge, r: (f.w / 2) / Math.cos(Math.PI / 8), square: f.w / 2, material: m.lead, trim: m.lead, lucarnes: lod.ornament >= 1, finial: 1.6, detail: lod.ornament });
    },
  });
}

/** Half-timbered gallery bridge on struts and stone corbels between two buildings. */
function galleryBridge(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  b.part("landmark:war-record", "war-record").gate(null).shadows(true, true);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  const L = mass.roof.ridgeAxis === "x" ? f.w : f.d;
  const W = mass.roof.ridgeAxis === "x" ? f.d : f.w;
  const alongX = mass.roof.ridgeAxis === "x";
  if (!alongX) b.rotateY(Math.PI / 2);
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  // Floor beam and joists.
  b.material(m.timberDark);
  box(b, 0, -0.32, 0, L + 0.3, 0.32, W + 0.12, { bottom: true });
  // Walls: framed panels with small leaded lights.
  b.material(m.frame);
  for (const s of [1, -1]) {
    b.push();
    b.transform(0, 0, s * W / 2, s > 0 ? 0 : Math.PI);
    b.flatQuad(-L / 2, 0, 0, L / 2, 0, 0, L / 2, eave, 0, -L / 2, eave, 0);
    b.material(m.timberDark);
    const posts = Math.max(3, Math.round(L / 1.1));
    for (let i = 0; i <= posts; i++) box(b, -L / 2 + (i * L) / posts, 0, 0.03, 0.14, eave, 0.08);
    box(b, 0, eave - 0.18, 0.04, L, 0.18, 0.09);
    box(b, 0, 0, 0.04, L, 0.16, 0.09);
    if (lod.ornament >= 1) {
      for (let i = 0; i < posts; i++) {
        if (i % 2) continue;
        const u = -L / 2 + ((i + 0.5) * L) / posts;
        b.material(i % 4 === 0 ? m.glassLit : m.glassDark);
        b.flatQuad(u - 0.32, 1.0, 0.035, u + 0.32, 1.0, 0.035, u + 0.32, 2.0, 0.035, u - 0.32, 2.0, 0.035);
        b.material(m.timberDark);
      }
    }
    b.material(m.frame);
    b.pop();
  }
  // Roof along the bridge.
  b.push();
  b.rotateY(Math.PI / 2);
  slopedRoof(b, { a: W / 2, length: L + 0.2, eave, ridge, overhang: 0.25, verge: 0.0, thickness: 0.12, roof: m.slate, soffit: m.timberDark, ridgeCap: m.lead });
  b.pop();
  // Raking struts down to corbels on both walls.
  b.material(m.timberDark);
  for (const e of [1, -1]) {
    for (const s of [1, -1]) {
      b.push();
      b.transform(e * (L / 2 - 0.9), -1.3, s * (W / 2 - 0.3), 0, 0, e * 0.62);
      box(b, 0, -0.9, 0, 0.18, 2.0, 0.18);
      b.pop();
    }
    b.material(m.dressing);
    box(b, e * (L / 2 - 0.05), -2.6, 0, 0.5, 0.4, W - 0.3);
    b.material(m.timberDark);
  }
  b.pop();
  massCollider(ctx, f, "war-record", ridge);
}

/** Interior of the archive: war table at the record-marker slots, ledger presses, lectern and chest. */
function archiveInterior(ctx: KitContext, building: Building, house: BuildingMass, m: LandmarkMaterials): void {
  const b = ctx.b;
  const site = ctx.bp.activitySites.find((s) => s.kind === "war-table" && s.district === building.district);
  const markers = ctx.bp.slots.recordMarkers;
  const floor = ctx.base(building).floorY;
  // Interior meshes share the exterior's material groups (no extra draw calls).
  b.part("landmark:war-record", "war-record").gate(null).shadows(true, true);
  b.uvMode = "world";
  // The table top carries the record markers: its surface is the markers' height.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = site ? site.position[1] : floor + 0.95;
  for (const p of markers) {
    minX = Math.min(minX, p.position[0]); maxX = Math.max(maxX, p.position[0]);
    minZ = Math.min(minZ, p.position[2]); maxZ = Math.max(maxZ, p.position[2]);
    top = p.position[1];
  }
  if (!Number.isFinite(minX) && site) { minX = maxX = site.position[0]; minZ = maxZ = site.position[2]; }
  if (Number.isFinite(minX)) {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const w = maxX - minX + 1.0, d = maxZ - minZ + 0.8;
    b.material(m.timberDark);
    chamferBox(b, cx, top - 0.12, cz, w, 0.12, d, 0.03);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, cx + sx * (w / 2 - 0.15), floor, cz + sz * (d / 2 - 0.15), 0.14, top - 0.12 - floor, 0.14);
    box(b, cx, floor + 0.25, cz, w - 0.3, 0.08, 0.08);
    // The map sheet (reserved for the regional map, a later increment).
    b.material(m.plaster);
    b.color(1.25, 1.18, 1.0);
    b.flatQuad(cx - w / 2 + 0.12, top + 0.004, cz + d / 2 - 0.12, cx + w / 2 - 0.12, top + 0.004, cz + d / 2 - 0.12, cx + w / 2 - 0.12, top + 0.004, cz - d / 2 + 0.12, cx - w / 2 + 0.12, top + 0.004, cz - d / 2 + 0.12);
    b.color(1, 1, 1);
  }
  // Ledger presses along both long walls: lower shelves full, the top shelf nearly empty.
  const hx = house.center[0], hz = house.center[1];
  const rng = Rng.fromKey(`ledgers:${building.id}`);
  for (const s of [1, -1]) {
    const x = hx + s * (house.width / 2 - 0.55);
    for (let k = 0; k < 2; k++) {
      const z0 = hz - house.depth / 2 + 3 + k * 6.5;
      b.material(m.timberDark);
      box(b, x, floor, z0 + 2, 0.6, 3.0, 0.08);
      box(b, x, floor, z0 - 2, 0.6, 3.0, 0.08);
      for (let shelf = 0; shelf < 5; shelf++) box(b, x, floor + 0.15 + shelf * 0.62, z0, 0.6, 0.05, 4.0);
      for (let shelf = 0; shelf < 4; shelf++) {
        b.material(shelf % 2 ? m.door : m.timberRaw);
        const k2 = 0.8 + rng.next() * 0.4;
        b.color(k2, k2 * 0.95, k2 * 0.9);
        if (shelf < 3) box(b, x - s * 0.02, floor + 0.2 + shelf * 0.62, z0, 0.42, 0.4, 3.8);
        else box(b, x - s * 0.02, floor + 0.2 + shelf * 0.62, z0 - 1.6, 0.42, 0.42, 0.45);
      }
      b.color(1, 1, 1);
    }
  }
  // Lectern with an open ledger and an iron-bound chest.
  b.material(m.timberDark);
  const lx = hx - 2.6, lz = hz + 5.5;
  box(b, lx, floor, lz, 0.3, 1.0, 0.3);
  b.push();
  b.transform(lx, floor + 1.05, lz, 0, -0.45, 0);
  box(b, 0, 0, 0, 0.7, 0.05, 0.5);
  b.material(m.plaster);
  b.color(1.3, 1.22, 1.05);
  box(b, 0, 0.05, 0, 0.6, 0.03, 0.42);
  b.color(1, 1, 1);
  b.pop();
  b.material(m.timberDark);
  chamferBox(b, hx + 2.8, floor, hz + 6.2, 1.1, 0.6, 0.6, 0.04);
  b.material(m.iron);
  box(b, hx + 2.8, floor + 0.2, hz + 6.2, 1.12, 0.06, 0.62);
  b.shadows(true, true);
}

/** The Record Gallery (hall tier 2): new Gothic range with an honour wall of carved, gilt-rimmed shields. */
export function buildRecordGalleryKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  const tier = building.appearsAtHallTier ?? 2;
  const gate: StateGate = { minHallTier: tier };
  b.part("landmark:war-record", "war-record").gate(gate).shadows(true, true);
  b.color(1.08, 1.07, 1.05);
  const mass = building.masses[0];
  const rng = Rng.fromKey(`gallery:${building.id}`);
  // Every gallery window is lit and the door, ridge and roof reuse materials the gallery already
  // draws with: each extra material on a tier-gated building is another draw (and shadow draw).
  const tall = (u: number): FaceOpening => ({ u, width: 1.5, sill: 1.8, height: 5.0, shape: "pointed", depth: 0.45, splay: 0.18, fill: "lit", light: 0.7 + rng.next() * 0.25, tracery: lod.quest ? "none" : "two-light", hood: true, sillDrip: true });
  const st = [{ depth: 0.9, top: 3.4 }, { depth: 0.6, top: 7.3 }];
  // Ridge along X: the long faces are ±Z, the gables ±X.
  const long: FaceSpec = { openings: [tall(-2.6), tall(2.6), { u: 0, width: 1.6, sill: 0, height: 2.9, shape: "pointed", depth: 0.5, splay: 0.22, orders: 2, fill: "door", hood: true }], buttresses: [-4.0, -1.3, 1.3, 4.0].map((u) => ({ u, width: 0.7, stages: st, pinnacle: lod.detail >= 1 ? 2.2 : 1.6 })), courses: [1.5] };
  const back: FaceSpec = { openings: [tall(-2.6), tall(2.6)], buttresses: [-4.0, 4.0].map((u) => ({ u, width: 0.7, stages: st })), courses: [1.5] };
  const gableFace: FaceSpec = { openings: [{ u: 0, width: 1.8, sill: 2.2, height: 5.2, shape: "pointed", depth: 0.45, splay: 0.18, fill: "lit", light: 0.8, tracery: lod.quest ? "none" : "two-light", hood: true }], gable: { coping: true, finial: 1.0 }, courses: [1.5] };
  buildGothicMass({
    ctx, building, mass, landmark: "war-record", lod, mats: { ...faceMaterials(m, m.ashlar), door: m.timberDark },
    faces: [long, back, gableFace, gableFace],
    plinth: { material: m.ashlar, steps: [{ offset: 0.25, top: -0.1, bevel: 0.08 }, { offset: 0.1, top: 0.3, bevel: 0.08 }] },
    wallBottom: -0.3,
    extra: (bb, f) => {
      bb.push();
      bb.rotateY(Math.PI / 2);
      slopedRoof(bb, { a: f.d / 2, length: f.w, eave: mass.eaveHeight, ridge: mass.ridgeHeight, overhang: 0, verge: -0.36, thickness: 0.14, roof: m.slate, soffit: m.timberDark, ridgeCap: m.dressing });
      bb.pop();
      // Honour wall: carved shields with gilt rims between the windows of the south face.
      enterFace(bb, rectFaces(f.w, f.d)[0]);
      for (const u of [-1.3, 1.3, -4.0, 4.0]) {
        const sh = shieldOutline(0.7, 0.9, lod.ornament >= 1 ? 4 : 3).map((p) => [p[0] + u, p[1] + 3.6] as P2);
        bb.material(m.dressing);
        barAlong(bb, sh, 0.06, 0, 0.1, true);
        if (lod.ornament >= 1) {
          bb.material(m.gilt);
          barAlong(bb, sh.map((p) => [u + (p[0] - u) * 0.82, 3.6 + (p[1] - 3.6) * 0.82 + 0.08] as P2), 0.035, 0.08, 0.13, true);
        }
      }
      bb.pop();
    },
  });
  b.gate(null);
  b.color(1, 1, 1);
}

/** Setting-out stakes and cords on an expansion plot until the tier that develops it. */
export function plotStakes(ctx: KitContext, m: LandmarkMaterials, polygon: readonly (readonly [number, number])[], gate: StateGate, landmark: "war-record" | "heralds-station" | "banner-hall" | null): void {
  const b = ctx.b;
  b.part(landmark ? `landmark:${landmark}` : "settlement", landmark).gate(gate).shadows(false, true);
  b.material(m.timberRaw);
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p = polygon[i], q = polygon[(i + 1) % n];
    const gp = ctx.ground(p[0], p[1]);
    box(b, p[0], gp - 0.3, p[1], 0.08, 1.05, 0.08);
    const gq = ctx.ground(q[0], q[1]);
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    b.push();
    b.transform((p[0] + q[0]) / 2, (gp + gq) / 2 + 0.55, (p[1] + q[1]) / 2, yaw, 0, 0);
    box(b, 0, 0, 0, 0.02, 0.02, len);
    b.pop();
  }
  b.gate(null).shadows(true, true);
}

export function buildWarRecordKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:war-record", "war-record").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const house = building.masses.find((mm) => mm.role === "hall");
  for (const mass of building.masses) {
    b.part("landmark:war-record", "war-record").gate(null).shadows(true, true);
    b.color(1, 1, 1);
    if (mass.role === "hall") archiveHouse(ctx, building, mass, lod, m);
    else if (mass.role === "tower") recordTower(ctx, building, mass, lod, m);
    else if (mass.role === "gallery") galleryBridge(ctx, building, mass, lod, m);
  }
  if (house && lod.interiors) archiveInterior(ctx, building, house, m);
  // The tier-2 gallery's plot is pegged out until it is built.
  const gallery = ctx.bp.buildings.find((x) => x.kit === "kv.record.gallery");
  const plot = ctx.bp.expansion.find((e) => e.district === building.district && e.unlocksAtHallTier === (gallery?.appearsAtHallTier ?? 2));
  if (plot) plotStakes(ctx, m, plot.polygon, { maxHallTier: ((plot.unlocksAtHallTier ?? 2) - 1) as 0 | 1 | 2 }, "war-record");
  b.part("landmark:war-record", "war-record").gate(null);
  b.color(1, 1, 1);
  void circleOutline;
}
