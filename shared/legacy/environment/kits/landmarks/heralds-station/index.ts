// Herald's Station kit (district E): the herald tower (buttressed ashlar, slit-lit storeys,
// a slate roof truncated under the raven loft rebuilt in pale new timber, louvred and
// perched, with the signal horn and, while an allied house exists, the ally's pennant), the
// post room (rubble ground storey, jettied framed upper storey sheltering the notice board
// with its six seal places, the rival's correspondence hook and the signal lantern over the
// door) and the West Gate (a real gate passage under a machicolated upper storey between
// two battered round towers). Notices and the rival's sealed letter are state slots.

import type { Building, BuildingMass } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, lathe, opening, archOutline, prism, rectOutline, roof } from "../../../kernel";
import type { MeshBuilder } from "../../../kernel";
import type { KitContext } from "../../context";
import { massFrame, toWorld } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import { clothPanel, pennantPanel } from "../../props/heraldry";
import { buildGothicMass, enterFace, faceMaterials, faceWall as faceWallImpl, landmarkLod, landmarkMaterials, massCollider, rectFaces, slopedRoof } from "../gothic";
import type { ButtressSpec, FaceOpening, LandmarkLod, LandmarkMaterials } from "../gothic";
import { plotStakes } from "../war-record";

function heraldTower(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const storeys = Math.max(1, mass.storeys);
  const sh = eave / storeys;
  const openFace = (fi: number): FaceOpening[] => {
    const out: FaceOpening[] = [];
    for (let s = 1; s < storeys; s++) {
      if (s === storeys - 1) out.push({ u: 0, width: 0.85, sill: s * sh + 0.9, height: 2.1, shape: "lancet", depth: 0.42, splay: 0.12, fill: fi === 2 ? "lit" : "dark", light: 0.8, hood: true, sillDrip: true });
      else out.push({ u: s % 2 ? 0.8 : -0.8, width: 0.22, sill: s * sh + 0.9, height: 1.2, shape: "rect", depth: 0.5, splay: 0.16, fill: "dark" });
    }
    if (fi === 2) out.push({ u: 0, width: 1.1, sill: 0, height: 2.3, shape: "pointed", depth: 0.42, splay: 0.12, fill: "door", hood: true });
    return out;
  };
  const cl = [{ depth: 0.6, top: 5.0 }, { depth: 0.38, top: 9.5 }];
  const corner: ButtressSpec[] = [{ u: -2.6, width: 0.75, stages: cl }, { u: 2.6, width: 0.75, stages: cl }];
  buildGothicMass({
    ctx, building, mass, landmark: "heralds-station", lod, mats: faceMaterials(m, m.ashlar),
    faces: [0, 1, 2, 3].map((i) => ({ openings: openFace(i), buttresses: corner, courses: [sh * 2] })),
    plinth: { material: m.ashlar, steps: [{ offset: 0.3, top: -0.1, bevel: 0.08 }, { offset: 0.12, top: 0.3, bevel: 0.08 }] },
    wallBottom: -0.3,
    extra: (b, f) => {
      const hw = f.w / 2, hd = f.d / 2;
      // Eaves course, then a slate roof truncated under the loft.
      b.material(m.dressing);
      bevelPrism(b, rectOutline(f.w + 0.3, f.d + 0.3), eave - 0.35, eave + 0.02, 0.1, { bottom: true });
      const loftBase = eave + (ridge - eave) * 0.5;
      const top = 1.25;
      const o = 0.42;
      b.material(m.slate);
      const e = eave + 0.02;
      const pts: [number, number][] = [[-hw - o, -hd - o], [hw + o, -hd - o], [hw + o, hd + o], [-hw - o, hd + o]];
      const tp: [number, number][] = [[-top, -top], [top, -top], [top, top], [-top, top]];
      for (let i = 0; i < 4; i++) {
        const p = pts[i], q = pts[(i + 1) % 4], tq = tp[(i + 1) % 4], tpp = tp[i];
        b.flatQuad(q[0], e - o * 0.6, q[1], p[0], e - o * 0.6, p[1], tpp[0], loftBase, tpp[1], tq[0], loftBase, tq[1]);
      }
      // The raven loft: a framed, louvred cage of new timber with perches, and its cap.
      const lh = (ridge - loftBase) * 0.62;
      const ly = loftBase;
      b.material(m.timberRaw);
      const prev = b.getColor();
      b.color(prev[0] * 1.3, prev[1] * 1.22, prev[2] * 1.08);
      prism(b, rectOutline(top * 2 + 0.3, top * 2 + 0.3), ly - 0.1, ly + 0.12, { top: true, bottom: true });
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, sx * (top - 0.08), ly, sz * (top - 0.08), 0.16, lh, 0.16);
      for (let fi = 0; fi < 4; fi++) {
        b.push();
        b.rotateY((fi * Math.PI) / 2);
        const n = lod.ornament >= 1 ? 6 : 3;
        for (let i = 0; i < n; i++) box(b, 0, ly + 0.25 + (i * (lh - 0.4)) / n, top - 0.02, top * 1.8, 0.06, 0.05);
        // Perches.
        if (lod.ornament >= 1) for (const px of [-0.6, 0.6]) box(b, px, ly + 0.1, top + 0.3, 0.05, 0.05, 0.6);
        b.pop();
      }
      b.color(prev[0], prev[1], prev[2]);
      b.material(m.shingle);
      roof(b, { form: "pyramid", axis: "z", w: top * 2 + 0.5, d: top * 2 + 0.5, eaveY: ly + lh, ridgeY: ridge, plan: "rect", overhang: 0.2, verge: 0, thickness: 0.08, roofMaterial: m.shingle, gableMaterial: m.timberRaw, trimMaterial: m.iron });
      // Signal horn on a bracket (east side, toward the yard and the road).
      b.material(m.iron);
      box(b, top + 0.05, ly + 0.55, 0, 0.6, 0.05, 0.05);
      b.material(m.bronze);
      b.push();
      b.transform(top + 0.55, ly + 0.45, 0, 0, 0, -1.1);
      lathe(b, [[0.03, -0.5], [0.06, 0.1], [0.2, 0.42]], 8, { smooth: true });
      b.pop();
      ctx.collider(toWorldY(f, 0, ly + lh / 2, 0), [top + 0.2, lh / 2 + 0.6, top + 0.2], f.yaw, "heralds-station", true);
    },
  });
}

function toWorldY(f: ReturnType<typeof massFrame>, x: number, y: number, z: number): [number, number, number] {
  const p = toWorld(f, x, z);
  return [p[0], f.y0 + y, p[1]];
}

/** The post room: rubble ground storey, a jettied framed upper storey, the notice board, lantern and correspondence hook. */
function postRoom(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const storeys = Math.max(1, mass.storeys);
  const sh = eave / storeys;
  const slots = ctx.bp.slots;
  b.part("landmark:heralds-station", "heralds-station").gate(null).shadows(true, true);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  // Mass-local positions of the state slots on the south (+Z) face.
  const local = (x: number, z: number): [number, number] => {
    const dx = x - f.cx, dz = z - f.cz;
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    return [dx * c - dz * s, dx * s + dz * c];
  };
  let nMin = Infinity, nMax = -Infinity, nYmin = Infinity, nYmax = -Infinity;
  for (const p of slots.noticeBoard) {
    const l = local(p.position[0], p.position[2]);
    nMin = Math.min(nMin, l[0]); nMax = Math.max(nMax, l[0]);
    nYmin = Math.min(nYmin, p.position[1] - f.y0); nYmax = Math.max(nYmax, p.position[1] - f.y0);
  }
  const rival = local(slots.rivalCorrespondence.position[0], slots.rivalCorrespondence.position[2]);
  // The door sits between the notice board and the rival's hook.
  const boardL = nMin - 0.4, boardR = nMax + 0.4;
  const doorU = Number.isFinite(boardR) ? Math.min(f.w / 2 - 0.9, Math.max(boardR + 0.68, (boardR + rival[0]) / 2 - 0.05)) : 0;
  const faces = rectFaces(f.w, f.d);
  const mats = faceMaterials(m, m.rubble, m.ashlar);
  // Ground storey (rubble with dressed openings), upper storey framed and jettied south.
  const jetty = 0.4;
  for (let i = 0; i < 4; i++) {
    const face = faces[i];
    const L = face.length;
    const openings: FaceOpening[] = [];
    if (i === 0) {
      openings.push({ u: doorU, width: 0.85, sill: 0, height: 2.15, shape: "rect", depth: 0.35, splay: 0.08, fill: "door" });
    } else if (i === 2 || i === 3) {
      openings.push({ u: 0, width: 0.7, sill: 1.1, height: 0.9, shape: "rect", depth: 0.3, splay: 0.06, fill: i === 2 ? "lit" : "dark", light: 0.8 });
    }
    enterFace(b, face);
    b.material(m.rubble);
    faceWallLocal(b, L, f.footY, sh, openings, mats, lod);
    b.pop();
  }
  // Upper storey: framed walls (jettied on the long faces).
  const upper = (i: number): FaceOpening[] => (i === 1 ? [] : [{ u: i === 0 ? -0.9 : 0, width: 0.8, sill: sh + 0.75, height: 1.1, shape: "rect", depth: 0.25, splay: 0.04, fill: i === 0 ? "lit" : "dark", light: 0.85, tracery: lod.ornament >= 1 ? "mullion" : "none" }]);
  const upFaces = rectFaces(f.w, f.d, jetty);
  for (let i = 0; i < 4; i++) {
    const face = upFaces[i];
    const L = face.length;
    enterFace(b, face);
    b.material(m.frame);
    const gable = i >= 2;
    const a = L / 2;
    const top = gable ? (u: number) => eave + (ridge - eave) * Math.max(0, 1 - Math.abs(u) / a) : () => eave;
    faceWallTop(b, L, sh, top, gable ? 0 : undefined, upper(i), faceMaterials(m, m.frame, m.timberDark), lod);
    b.pop();
  }
  // Jetty soffits and bressumers on the long faces.
  b.material(m.timberDark);
  for (const s of [1, -1]) {
    box(b, 0, sh - 0.22, s * (f.d / 2 + jetty - 0.1), f.w + 0.1, 0.22, 0.2);
    const n = Math.max(3, Math.round(f.w / 0.9));
    for (let k = 0; k < n; k++) box(b, -f.w / 2 + 0.3 + (k * (f.w - 0.6)) / (n - 1), sh - 0.42, s * (f.d / 2 + jetty * 0.45), 0.12, 0.2, jetty * 0.95);
    b.flatQuad(-f.w / 2, sh, s * (f.d / 2 + jetty), f.w / 2, sh, s * (f.d / 2 + jetty), f.w / 2, sh, s * (f.d / 2), -f.w / 2, sh, s * (f.d / 2));
  }
  // Roof along X with verges over the framed gables.
  b.push();
  b.rotateY(Math.PI / 2);
  slopedRoof(b, { a: f.d / 2 + jetty, length: f.w, eave, ridge, overhang: 0.32, verge: 0.36, thickness: 0.14, roof: m.slate, soffit: m.timberDark, ridgeCap: m.lead });
  b.pop();
  // Notice board with its six seal places, under the jetty; the rival's hook; the lantern.
  const zf = f.d / 2;
  if (Number.isFinite(nMin)) {
    b.material(m.timberDark);
    chamferBox(b, (boardL + boardR) / 2, nYmin - 0.42, zf + 0.1, boardR - boardL, nYmax - nYmin + 0.88, 0.2, 0.02);
    b.material(m.timberRaw);
    box(b, (boardL + boardR) / 2, nYmax + 0.46, zf + 0.12, boardR - boardL + 0.16, 0.08, 0.22);
    box(b, (boardL + boardR) / 2, nYmin - 0.5, zf + 0.12, boardR - boardL + 0.16, 0.08, 0.22);
    if (lod.ornament >= 1) {
      b.material(m.iron);
      for (const p of slots.noticeBoard) {
        const l = local(p.position[0], p.position[2]);
        box(b, l[0], p.position[1] - f.y0 + 0.02, zf + 0.19, 0.05, 0.05, 0.03);
      }
    }
  }
  b.material(m.timberDark);
  box(b, rival[0], slots.rivalCorrespondence.position[1] - f.y0 - 0.32, zf + 0.06, 0.62, 0.7, 0.1);
  b.material(m.iron);
  box(b, rival[0], slots.rivalCorrespondence.position[1] - f.y0 + 0.08, zf + 0.12, 0.5, 0.04, 0.05);
  // Signal lantern over the door: an iron cage with a pyramid cap on a wall bracket.
  b.material(m.iron);
  box(b, doorU, 2.55, zf + 0.25, 0.05, 0.05, 0.5);
  box(b, doorU, 2.42, zf + 0.48, 0.03, 0.14, 0.03);
  box(b, doorU, 1.97, zf + 0.48, 0.32, 0.04, 0.32);
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(b, doorU + cx * 0.14, 2.0, zf + 0.48 + cz * 0.14, 0.035, 0.42, 0.035);
  b.push();
  b.translate(doorU, 2.4, zf + 0.48);
  lathe(b, [[0.22, 0], [0.03, 0.16]], 4, { smooth: false, phase: Math.PI / 4 });
  b.pop();
  b.material(m.glassLit);
  chamferBox(b, doorU, 2.01, zf + 0.48, 0.24, 0.37, 0.24, 0.03);
  b.pop();
  const lp = toWorld(f, doorU, zf + 0.48);
  ctx.lights.push({ name: `${building.id}:signal-lantern`, position: [lp[0], f.y0 + 2.2, lp[1]], color: "#ffb870", intensity: 4, range: 9, flicker: 0.2, priority: 2, gate: null });
  massCollider(ctx, f, "heralds-station", ridge);
}

function faceWallLocal(b: MeshBuilder, L: number, bottom: number, top: number, openings: FaceOpening[], mats: ReturnType<typeof faceMaterials>, lod: LandmarkLod): void {
  faceWallTop(b, L, bottom, () => top, undefined, openings, mats, lod);
}

function faceWallTop(b: MeshBuilder, L: number, bottom: number, top: (u: number) => number, apexU: number | undefined, openings: FaceOpening[], mats: ReturnType<typeof faceMaterials>, lod: LandmarkLod): void {
  faceWallImpl(b, { length: L, bottom, top, apexU, openings, mats, cell: lod.cell, segments: lod.segments, detail: lod.ornament });
}


/** Battered round gate tower with arrow loops, a corbelled crenellated crown and a slate cone. */
function gateTower(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  const r = f.w / 2;
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  const seg = lod.quest ? 10 : lod.detail >= 2 ? 20 : 16;
  b.part("landmark:heralds-station", "heralds-station").gate(null).shadows(true, true);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  b.material(m.ashlar);
  lathe(b, [[r + 0.55, f.footY], [r + 0.5, 0.2], [r, 2.4]], seg, { smooth: true, phase: Math.PI / seg });
  prism(b, circleOutline(r, seg, Math.PI / seg), 2.3, eave - 1.0, { smooth: true, top: false });
  b.material(m.dressing);
  prism(b, circleOutline(r + 0.07, seg, Math.PI / seg), 2.3, 2.5, { smooth: true, top: true, bottom: true });
  // Corbelled crown, parapet ring and merlons.
  b.material(m.ashlar);
  lathe(b, [[r, eave - 1.0], [r + 0.4, eave - 0.45], [r + 0.4, eave + 0.9]], seg, { smooth: false, phase: Math.PI / seg });
  prism(b, circleOutline(r - 0.05, seg, Math.PI / seg), eave - 0.1, eave + 0.9, { smooth: true, top: false, inward: true });
  b.material(m.flagstone);
  b.shadows(false, true);
  prism(b, circleOutline(r, seg, Math.PI / seg), eave - 0.12, eave - 0.02, { top: true });
  b.shadows(true, true);
  b.material(m.ashlar);
  const nm = lod.quest ? 6 : 10;
  for (let i = 0; i < nm; i++) {
    const a = (i / nm) * Math.PI * 2;
    b.push();
    b.transform(Math.sin(a) * (r + 0.18), eave + 0.9, Math.cos(a) * (r + 0.18), a);
    box(b, 0, 0, 0, 0.62, 0.72, 0.42, { top: true });
    b.pop();
  }
  // Arrow loops on the outer half (skipping faces against the gate passage).
  const storeys = Math.max(1, mass.storeys);
  const sh = eave / storeys;
  for (let s = 0; s < storeys; s++) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + s * 0.6;
      const p = toWorld(f, Math.sin(a) * (r + 0.7), Math.cos(a) * (r + 0.7));
      const y = s * sh + sh * 0.35 + (s === 0 ? 1.0 : 0);
      if (ctx.masses.occupied(p[0], f.y0 + y + 0.5, p[1], (bid, mm) => bid === building.id && mm === mass)) continue;
      b.push();
      b.transform(Math.sin(a) * (r - 0.03), y, Math.cos(a) * (r - 0.03), a);
      opening(b, { outline: archOutline(0.18, 1.0, 0.9, 3), glassMaterial: m.glassDark, frameMaterial: m.dressing, frame: 0.09, proud: 0.1 });
      if (lod.ornament >= 1) box(b, 0, 0.42, 0.06, 0.42, 0.12, 0.05);
      b.pop();
    }
  }
  b.material(m.slate);
  lathe(b, [[r + 0.15, eave + 0.2], [r * 0.6, eave + 0.2 + (ridge - eave) * 0.45], [0.03, ridge]], seg, { smooth: true });
  b.material(m.lead);
  b.push();
  b.translate(0, ridge - 0.05, 0);
  lathe(b, [[0.07, 0], [0.1, 0.2], [0.01, 1.0]], 6, { smooth: false });
  b.pop();
  b.pop();
  massCollider(ctx, f, "heralds-station", ridge);
}

/** The gate passage: a lined passage under a machicolated upper storey with a hip roof behind battlements. */
function gatePassage(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const base = ctx.base(building);
  const gate = ctx.bp.gates.find((g) => g.kind === "main-gate");
  const gw = gate ? gate.width : 4, gh = gate ? gate.height : 5.5;
  const archY = gate ? ctx.ground(gate.position[0], gate.position[1]) - base.floorY : 0;
  const ringW = gw + 0.9;
  const R0 = 0.8 * gw;
  const spring0 = Math.max(0.6, gh - gw * 0.6);
  const rise0 = Math.sqrt(Math.max(R0 * R0 - (R0 - gw / 2) * (R0 - gw / 2), 0));
  const h = spring0 + rise0 + 0.75;
  const k = (R0 + 0.45) / ringW;
  // Faces in rectFaces order: +Z, -Z, +X (town side), -X (outside, the road).
  const outward = gate ? Math.sin((gate.outwardBearingDeg * Math.PI) / 180) : -1;
  const outIdx = outward < 0 ? 3 : 2, inIdx = outward < 0 ? 2 : 3;
  const passage: FaceOpening = { u: 0, width: ringW, sill: archY, height: h, shape: "pointed", archK: k, depth: mass.width, through: mass.width, fill: "void" };
  const loop = (u: number): FaceOpening => ({ u, width: 0.2, sill: mass.eaveHeight * 0.6, height: 1.25, shape: "rect", depth: 0.5, splay: 0.16, fill: "dark" });
  const faces: (import("../gothic").FaceSpec | null)[] = [
    { openings: [], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0.15, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } } },
    { openings: [], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0.15, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } } },
    null,
    null,
  ];
  faces[outIdx] = { openings: [passage, loop(-2.9), loop(2.9)], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.75, proj: 0.5, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.85 } }, courses: [h + archY + 0.35] };
  faces[inIdx] = { openings: [{ ...passage, through: undefined, cutOnly: true }, { u: -2.2, width: 0.85, sill: mass.eaveHeight * 0.55, height: 1.9, shape: "lancet", depth: 0.4, splay: 0.12, fill: "lit", light: 0.8, hood: true }, { u: 2.2, width: 0.85, sill: mass.eaveHeight * 0.55, height: 1.9, shape: "lancet", depth: 0.4, splay: 0.12, fill: "dark", hood: true }], parapet: { y0: mass.eaveHeight - 0.3, y1: mass.eaveHeight + 0.7, proj: 0.15, thick: 0.45, merlons: { width: 0.7, gap: 0.55, height: 0.8 } } };
  buildGothicMass({
    ctx, building, mass, landmark: "heralds-station", lod, mats: faceMaterials(m, m.ashlar),
    faces,
    plinth: { material: m.ashlar, steps: [{ offset: 0.25, top: Math.min(-0.05, archY), bevel: 0.06 }] },
    wallBottom: Math.min(-0.3, archY - 0.05),
    extra: (b, f) => {
      roof(b, { form: "hip", axis: mass.roof.ridgeAxis, w: f.w - 0.9, d: f.d - 0.9, eaveY: mass.eaveHeight - 0.15, ridgeY: mass.ridgeHeight, plan: "rect", overhang: 0, verge: 0, thickness: 0.12, roofMaterial: m.slate, gableMaterial: m.ashlar, trimMaterial: m.lead });
      // Machicolation corbels under the outer parapet.
      if (lod.ornament >= 1) {
        const face = rectFaces(f.w, f.d)[outIdx];
        enterFace(b, face);
        b.material(m.ashlar);
        const n = Math.round(face.length / 0.8);
        for (let i = 0; i < n; i++) {
          const u = -face.length / 2 + ((i + 0.5) * face.length) / n;
          box(b, u, mass.eaveHeight - 1.45, 0.12, 0.3, 0.42, 0.24);
          box(b, u, mass.eaveHeight - 1.03, 0.22, 0.32, 0.42, 0.44);
          box(b, u, mass.eaveHeight - 0.61, 0.3, 0.34, 0.32, 0.6);
        }
        b.pop();
      }
    },
  });
}

/** The ally's pennant over the herald tower while an allied house exists (flag-gated). */
function alliedEnvoy(ctx: KitContext, m: LandmarkMaterials): void {
  const b = ctx.b;
  const p = ctx.bp.slots.alliedEnvoy;
  b.part("heraldry", null).gate({ flag: "allied-house" }).shadows(true, true);
  b.push();
  b.translate(p.position[0], p.position[1], p.position[2]);
  b.material(m.iron);
  prism(b, circleOutline(0.05, 6), -0.4, 2.6, { smooth: true, top: true });
  b.material(ctx.mat("cloth-heraldry"));
  b.motion({ kind: "cloth", amplitude: 0.22, frequency: 1.6 });
  const windYaw = Math.PI / 2 - (ctx.bp.atmosphere.wind.towardBearingDeg * Math.PI) / 180;
  b.push();
  b.transform(0, 2.45, 0, windYaw);
  pennantPanel(b, 1.9, 0.6, "ally");
  b.pop();
  b.motion(null);
  b.pop();
  b.gate(null);
  void clothPanel;
}

export function buildHeraldsStationKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:heralds-station", "heralds-station").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  for (const mass of building.masses) {
    b.part("landmark:heralds-station", "heralds-station").gate(null).shadows(true, true);
    b.color(1, 1, 1);
    if (mass.role === "tower") heraldTower(ctx, building, mass, lod, m);
    else postRoom(ctx, building, mass, lod, m);
  }
  alliedEnvoy(ctx, m);
  b.color(1, 1, 1);
}

/** The West Gate: passage block and its two round towers; the barbican plot is pegged out until it is built. */
export function buildMainGateKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  for (const mass of building.masses) {
    b.part("landmark:heralds-station", "heralds-station").gate(null).shadows(true, true);
    b.color(1, 1, 1);
    if ((mass.plan ?? "rect") === "round") gateTower(ctx, building, mass, lod, m);
    else gatePassage(ctx, building, mass, lod, m);
  }
  const plot = ctx.bp.expansion.find((e) => e.district === building.district && e.unlocksAtHallTier !== null);
  if (plot && plot.unlocksAtHallTier) plotStakes(ctx, m, plot.polygon, { maxHallTier: (plot.unlocksAtHallTier - 1) as 0 | 1 | 2 }, "heralds-station");
  b.color(1, 1, 1);
}
