// Solforiz masses by role: walls with openings, parapet roofs with stepped merlons, carved
// bands, drain spouts and lattice balconies; round drums with glazed or beehive domes;
// windcatchers; banded flues; vaulted market canopies; arcades; works roofs; palm scaffolds.

import { bevelPrism, box, chamferBox, circleOutline, lathe, prism, rectOutline, roof } from "../../../kernel";
import type { RoofShape } from "../../../kernel/roofs";
import type { Face, MassFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { faceBlocked, faceWall, facesOf, footing, hasRepair, onFace, parapetRoof, strip } from "../variant";
import type { BuildingScope, FaceMats, MerlonStyle, Opening } from "../variant";
import { CUT, facesCourt, sfDome, sfDrum, sfFaceOpenings, sfKind, sfMats, SF, sfWalls } from "./common";
import type { SfKind } from "./common";
import { awning, barrelVault, sawtooth, shadeFrame, windcatcherHead } from "./shapes";

/** Awning and shade-cloth tints (undyed linen, indigo, madder, ochre). */
export const SF_CLOTHS: readonly (readonly [number, number, number])[] = [[1.05, 0.98, 0.86], [0.42, 0.5, 0.78], [0.86, 0.42, 0.34], [1.0, 0.78, 0.42]];

function merlonsFor(s: BuildingScope, kind: SfKind): MerlonStyle {
  const q = s.building.quality;
  if (kind === "works") return "none";
  if (kind === "cut") return "stepped";
  return q === "fine" || q === "noble" ? "stepped" : "none";
}

/** Carved frieze band under the parapet (cut sandstone), with small relief teeth on hero work. */
function friezeBand(ctx: KitContext, s: BuildingScope, f: MassFrame, y: number): void {
  const b = ctx.b;
  const prev = b.getColor();
  b.material(ctx.mat(SF.plaster)).color(prev[0] * 1.06, prev[1] * 1.04, prev[2] * 1.0);
  for (const face of facesOf(f)) {
    onFace(b, face, () => {
      box(b, 0, y, 0.02, face.length + 0.14, 0.34, 0.12);
      if (s.lod.ornament >= 2) {
        const n = Math.floor(face.length / 0.42);
        for (let i = 0; i < n; i++) {
          const u = -face.length / 2 + (i + 0.5) * (face.length / n);
          b.push();
          b.transform(u, y + 0.17, 0.14, 0, 0, Math.PI / 4);
          box(b, 0, -0.07, 0, 0.14, 0.14, 0.05);
          b.pop();
        }
      }
    });
  }
  b.color(prev[0], prev[1], prev[2]);
}

/** Palm-timber drain spouts along the parapet foot of street faces. */
function spouts(ctx: KitContext, f: MassFrame, faces: readonly Face[], y: number, skip: (i: number) => boolean): void {
  const b = ctx.b;
  b.material(ctx.mat(SF.palm));
  faces.forEach((face, i) => {
    if (skip(i) || face.length < 3) return;
    onFace(b, face, () => {
      const n = Math.max(1, Math.floor(face.length / 3.6));
      for (let k = 0; k < n; k++) box(b, -face.length / 2 + (k + 0.5) * (face.length / n), y, 0.28, 0.12, 0.12, 0.62);
    });
  });
}

/** A projecting lattice balcony (mashrabiya) on a face (face frame). */
function latticeBox(ctx: KitContext, s: BuildingScope, u: number, y: number, w: number, h: number): void {
  const b = ctx.b;
  const prev = b.getColor();
  const out = 0.55;
  b.material(ctx.mat(SF.palm)).color(prev[0] * 0.9, prev[1] * 0.85, prev[2] * 0.8);
  box(b, u, y - 0.16, out / 2, w + 0.12, 0.16, out + 0.08);
  box(b, u, y + h, out / 2, w + 0.2, 0.12, out + 0.2);
  for (const sx of [-1, 1]) box(b, u + sx * (w / 2), y, out - 0.04, 0.08, h, 0.08);
  b.material(ctx.mat("glass-dark"));
  b.flatQuad(u - w / 2, y, out, u + w / 2, y, out, u + w / 2, y + h, out, u - w / 2, y + h, out);
  if (s.lod.detail >= 1) {
    b.material(ctx.mat(SF.palm));
    const nu = Math.max(2, Math.round(w / 0.14));
    for (let i = 1; i < nu; i++) strip(b, u - w / 2 + (i * w) / nu, y, u - w / 2 + (i * w) / nu, y + h, 0.03, out + 0.02);
    const nv = Math.max(2, Math.round(h / 0.16));
    for (let i = 1; i < nv; i++) strip(b, u - w / 2, y + (i * h) / nv, u + w / 2, y + (i * h) / nv, 0.03, out + 0.02);
  }
  b.color(prev[0], prev[1], prev[2]);
}

export interface SfMassOptions {
  shutters: { left: number };
  /** Skip the roof (the calling kit builds its own). */
  skipRoof?: boolean;
  /** Extra openings per face index (portals, shop fronts). */
  extraOpenings?: (face: Face, i: number) => Opening[];
  /** Replace the computed openings of a face. */
  openingsOverride?: (face: Face, i: number) => Opening[] | null;
}

/** Walls and roof of a rectangular Solforiz mass (mass-local; caller pushed the frame). */
export function sfBoxMass(ctx: KitContext, s: BuildingScope, f: MassFrame, o: SfMassOptions): void {
  const b = ctx.b;
  const m = f.mass;
  const building = s.building;
  const kind = sfKind(building);
  const mats = sfMats(ctx, m.wallMaterial, kind);
  const faces = facesOf(f);
  const tint = b.getColor();
  const fresh = hasRepair(building, m.id, "fresh-render") || hasRepair(building, m.id, "lime-wash");
  if (fresh) b.color(tint[0] * 1.12, tint[1] * 1.1, tint[2] * 1.06);
  footing(b, f, ctx.mat(kind === "cut" ? SF.sandstone : SF.rubble), kind === "cut" ? 0.36 : 0.18, kind === "cut" ? 0.12 : 0.08, kind === "cut" ? 0.1 : 0);
  const court = faces.map((face) => facesCourt(building, f, face));
  const door = m.role !== "annex" && m.role !== "gallery" && m.role !== "arcade";
  const fortified = m.role === "tower" || m.role === "gatehouse";
  sfWalls(ctx, s, f, faces, mats, m.eaveHeight, (face, i) => {
    const forced = o.openingsOverride ? o.openingsOverride(face, i) : null;
    const ops = forced ?? sfFaceOpenings(ctx, s, f, face, { kind, court: court[i], lod: s.lod }, { eave: m.eaveHeight, storeys: m.storeys, door, shutters: o.shutters, firstStorey: fortified ? Math.max(0, m.storeys - 2) : 0 }, i);
    return o.extraOpenings ? ops.concat(o.extraOpenings(face, i)) : ops;
  });
  if (kind === "cut" && s.lod.ornament >= 1 && m.eaveHeight > 4 && m.role !== "shed") friezeBand(ctx, s, f, m.eaveHeight - 0.62);
  // Lattice balconies on the court (or front) faces of the household's upper storeys.
  if (building.tags.indexOf("lattice-screens") >= 0 && s.lod.ornament >= 1 && m.storeys >= 2 && (m.role === "wing" || m.role === "house" || m.role === "hall")) {
    const sh = m.eaveHeight / m.storeys;
    faces.forEach((face, i) => {
      if (!court[i] && !(m.role === "hall" && i === 0)) return;
      if (face.length < 5) return;
      onFace(b, face, () => {
        const n = face.length > 12 ? 2 : 1;
        for (let k = 0; k < n; k++) latticeBox(ctx, s, n === 1 ? 0 : (k === 0 ? -1 : 1) * face.length * 0.22, sh + 0.7, 1.5, 1.7);
      });
    });
  }
  if (!o.skipRoof) sfRoof(ctx, s, f, kind, mats, faces, court);
  b.color(tint[0], tint[1], tint[2]);
}

/** Roof of a rectangular mass by its blueprint form. */
export function sfRoof(ctx: KitContext, s: BuildingScope, f: MassFrame, kind: SfKind, mats: FaceMats, faces: readonly Face[], court: readonly boolean[]): void {
  const b = ctx.b;
  const m = f.mass;
  const building = s.building;
  const roofMat = ctx.mat(m.roof.material);
  const form = m.roof.form;
  if (form === "flat-parapet" || form === "terrace") {
    const ph = Math.max(0.45, m.ridgeHeight - m.eaveHeight);
    const rebuilt = hasRepair(building, m.id, "rebuilt-courses");
    const prev = b.getColor();
    if (rebuilt) b.color(prev[0] * (building.tradition === CUT ? 1.14 : 0.94), prev[1] * (building.tradition === CUT ? 1.08 : 0.9), prev[2] * (building.tradition === CUT ? 0.9 : 0.86));
    const merlons = merlonsFor(s, kind);
    const weathered = building.age.condition === "weathered" || building.age.condition === "damaged";
    const rng = ctx.rng(`sf-merlon:${building.id}:${m.id}`);
    parapetRoof(b, { w: f.w, d: f.d, deck: m.eaveHeight, height: ph, thickness: kind === "cut" ? 0.5 : 0.32, wall: mats.wall, coping: kind === "works" ? null : ctx.mat(SF.plaster), roof: roofMat, merlons, merlonWidth: kind === "cut" ? 0.6 : 0.45, detail: s.lod.detail }, weathered ? () => rng.chance(0.8) : undefined);
    b.color(prev[0], prev[1], prev[2]);
    if (s.lod.ornament >= 1 && kind !== "works") spouts(ctx, f, faces, m.eaveHeight - 0.05, (i) => court[i]);
    if (building.tags.indexOf("roof-terrace") >= 0 && s.lod.detail >= 1 && f.w * f.d > 30 && m.role !== "windcatcher") {
      const rng2 = ctx.rng(`sf-shade:${building.id}:${m.id}`);
      const cloth = SF_CLOTHS[rng2.int(0, SF_CLOTHS.length - 1)];
      shadeFrame(ctx, b, f.w * 0.22, -f.d * 0.18, Math.min(3.2, f.w * 0.4), Math.min(2.6, f.d * 0.4), m.eaveHeight, 2.1, cloth);
    }
    if (hasRepair(building, m.id, "tarpaulin")) {
      b.material(ctx.mat(SF.cloth));
      const c = b.getColor();
      b.color(c[0] * 0.75, c[1] * 0.7, c[2] * 0.58);
      b.flatQuad(-f.w * 0.3, m.eaveHeight + 0.08, f.d * 0.3, f.w * 0.15, m.eaveHeight + 0.1, f.d * 0.3, f.w * 0.15, m.eaveHeight + 0.12, -f.d * 0.15, -f.w * 0.3, m.eaveHeight + 0.1, -f.d * 0.15);
      b.color(c[0], c[1], c[2]);
    }
    return;
  }
  if (form === "flat") {
    b.material(roofMat);
    const over = kind === "works" ? 0.35 : 0.15;
    bevelPrism(b, rectOutline(f.w + over * 2, f.d + over * 2), m.eaveHeight, m.eaveHeight + (kind === "works" ? 0.12 : 0.22), 0.04, { bottom: true });
    return;
  }
  if (form === "sawtooth") {
    const glazed = !hasRepair(building, m.id, "patched-roof");
    b.push();
    if (m.roof.ridgeAxis === "x") b.rotateY(Math.PI / 2);
    sawtooth(ctx, b, m.roof.ridgeAxis === "x" ? f.d : f.w, m.roof.ridgeAxis === "x" ? f.w : f.d, m.eaveHeight, m.ridgeHeight, m.roof.material, glazed);
    b.pop();
    return;
  }
  if (form === "barrel-vault") {
    b.push();
    if (m.roof.ridgeAxis === "x") b.rotateY(Math.PI / 2);
    const w = m.roof.ridgeAxis === "x" ? f.d : f.w, len = m.roof.ridgeAxis === "x" ? f.w : f.d;
    barrelVault(ctx, b, w, len, m.eaveHeight, Math.max(0.5, m.ridgeHeight - m.eaveHeight), m.roof.material, s.lod.seg >> 1, 0);
    b.pop();
    return;
  }
  if (form === "lean-to" || form === "gable" || form === "hip" || form === "pyramid") {
    roof(b, { form: form as RoofShape, axis: m.roof.ridgeAxis, w: f.w, d: f.d, eaveY: m.eaveHeight, ridgeY: m.ridgeHeight, plan: "rect", overhang: 0.3, verge: 0.2, thickness: 0.06, roofMaterial: roofMat, gableMaterial: mats.wall, trimMaterial: roofMat, soffitMaterial: ctx.mat(SF.palm) });
  }
}

/** Round drum and dome (glazed on cut work, beehive mud plaster on granaries). */
export function sfRoundMass(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  const kind = sfKind(s.building);
  const mats = sfMats(ctx, m.wallMaterial, kind);
  const R = f.w / 2;
  const granary = m.role === "silo" || s.building.function === "granary";
  if (granary) {
    footing(b, f, ctx.mat(SF.rubble), 0.2, 0.15, 0);
    b.material(mats.wall);
    prism(b, circleOutline(R, s.lod.seg), f.footY, m.eaveHeight, { smooth: true, top: false });
    // Door on the entrance side, a seal and a loading ladder to the crown hatch.
    const door = s.building.entrance.position;
    const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const dx = door[0] - f.cx, dz = door[1] - f.cz;
    const a = Math.atan2(dx * c - dz * sn, dx * sn + dz * c);
    b.push();
    b.transform(Math.sin(a) * (R - 0.02), 0, Math.cos(a) * (R - 0.02), a);
    b.material(ctx.mat(SF.palm));
    chamferBox(b, 0, 0, 0.04, 1.0, 1.9, 0.12, 0.03);
    b.material(ctx.mat("figure")).color(0.42, 0.12, 0.08);
    prism(b, circleOutline(0.13, 8, 0, 0, 0.12), 2.25, 2.29, { top: true });
    b.color(1, 1, 1);
    b.pop();
    sfDome(ctx, b, R + 0.04, m.eaveHeight - 0.02, m.ridgeHeight, m.roof.material, s.lod, { beehive: true });
    if (s.lod.detail >= 1 && s.building.tags.indexOf("loading-ladder") >= 0) {
      b.material(ctx.mat(SF.palm));
      const la = a + 0.9;
      b.push();
      b.transform(Math.sin(la) * (R + 0.9), 0, Math.cos(la) * (R + 0.9), la, -0.38);
      for (const sx of [-0.25, 0.25]) box(b, sx, 0, 0, 0.07, m.ridgeHeight * 0.95, 0.07);
      for (let y = 0.4; y < m.ridgeHeight * 0.9; y += 0.45) box(b, 0, y, 0, 0.5, 0.05, 0.05);
      b.pop();
    }
    return;
  }
  // Drum (faceted, with small lattice lights) and glazed pointed dome.
  const drumTop = m.eaveHeight;
  sfDrum(ctx, s, R * 0.94, f.elevated ? 0 : f.footY, drumTop, mats, true);
  if (hasRepair(s.building, m.id, "iron-strapping")) {
    b.material(ctx.mat("iron"));
    prism(b, circleOutline(R * 0.94 / Math.cos(Math.PI / 12) + 0.05, 12, Math.PI / 12), drumTop * 0.45, drumTop * 0.45 + 0.12, { top: true, bottom: true });
  }
  sfDome(ctx, b, R * 0.98, drumTop + 0.1, m.ridgeHeight, m.roof.material, s.lod, { clayBand: hasRepair(s.building, m.id, "re-shingled") });
}

/** Windcatcher tower: plain shaft, slotted vent head and stepped crest. */
export function sfWindcatcher(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  const kind = sfKind(s.building);
  const mats = sfMats(ctx, m.wallMaterial, kind);
  const ventH = Math.min(4.6, Math.max(2.2, m.eaveHeight * 0.22));
  const ventY = m.eaveHeight - ventH;
  footing(b, f, ctx.mat(SF.sandstone), 0.3, 0.1, 0.08);
  const faces = facesOf(f);
  for (const face of faces) {
    onFace(b, face, () => faceWall(b, { length: face.length, bottom: f.footY, top: ventY, openings: [], mats, arch: s.lod.arch, detail: s.lod.detail, rows: [0.6, 1.8, ventY * 0.5] }));
  }
  if (s.lod.ornament >= 1 && kind === "cut") friezeBand(ctx, s, f, ventY - 0.4);
  windcatcherHead(ctx, s, f.w, f.d, ventY, m.eaveHeight, m.ridgeHeight, mats, hasRepair(s.building, m.id, "rebuilt-courses"));
}

/** Tall works flue: banded rubble shaft with riveted plates and a strong smoke plume. */
export function sfStack(ctx: KitContext, s: BuildingScope, f: MassFrame, sulfur: boolean): void {
  const b = ctx.b;
  const m = f.mass;
  const R = f.w / 2;
  const top = m.ridgeHeight;
  b.material(ctx.mat(m.wallMaterial));
  lathe(b, [[R * 1.25, f.footY], [R * 1.15, 1.2], [R, top * 0.55], [R * 0.86, top]], s.lod.quest ? 8 : 12, { smooth: true });
  const plated = hasRepair(s.building, m.id, "welded-plate");
  const bands = s.lod.detail >= 1 ? 5 : 3;
  for (let i = 0; i < bands; i++) {
    const y = top * (0.22 + (i * 0.7) / bands);
    const r = R * (1.15 - (0.29 * y) / top) + 0.04;
    b.material(ctx.mat(plated && i % 2 === 0 ? "iron" : SF.sandstone));
    prism(b, circleOutline(r, s.lod.quest ? 8 : 12), y, y + (plated ? 0.5 : 0.22), { smooth: true, top: true, bottom: true });
  }
  b.material(ctx.mat("iron"));
  prism(b, circleOutline(R * 0.95, 10), top - 0.1, top + 0.35, { smooth: true, top: false });
  const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  void c; void sn;
  ctx.smoke.push({ id: `${s.building.id}:${m.id}`, position: [f.cx, f.y0 + top + 0.8, f.cz], strength: sulfur ? 1 : 0.6, color: sulfur ? "#c8b878" : "#8a8070", gate: null });
}

/** Small square chimney with a cap and a smoke source. */
export function sfChimney(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  b.material(ctx.mat(m.wallMaterial));
  chamferBox(b, 0, f.footY, 0, f.w, m.ridgeHeight - f.footY, f.d, 0.05, { top: false });
  b.material(ctx.mat(SF.plaster));
  bevelPrism(b, rectOutline(f.w + 0.2, f.d + 0.2), m.ridgeHeight - 0.2, m.ridgeHeight + 0.05, 0.05, { bottom: true });
  const smoky = s.building.function === "forge" || s.building.tags.indexOf("smoke") >= 0;
  if (smoky) ctx.smoke.push({ id: `${s.building.id}:${m.id}`, position: [f.cx, f.y0 + m.ridgeHeight + 0.5, f.cz], strength: s.building.function === "forge" ? 0.9 : 0.45, color: "#8a8070", gate: null });
}

/** Arcade: pointed arches on piers along the face that opens to the court, a flat roof. */
export function sfArcade(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  const building = s.building;
  const mats = sfMats(ctx, m.wallMaterial, "cut");
  const faces = facesOf(f);
  // Open faces: the long faces not built against another mass (they look into the court).
  let open = faces.map((face) => face.long && !faceBlocked(ctx, f, face, 0, 2, 0.9));
  if (open.every((x) => !x)) open = faces.map((_face, i) => i === 0);
  void building;
  const bay = 2.6;
  footing(b, f, ctx.mat(SF.sandstone), 0.3, 0.06, 0.06);
  faces.forEach((face, i) => {
    onFace(b, face, () => {
      if (!open[i]) {
        faceWall(b, { length: face.length, bottom: f.footY, top: m.eaveHeight, openings: [], mats, arch: s.lod.arch, detail: s.lod.detail });
        return;
      }
      const n = Math.max(1, Math.round(face.length / bay));
      const ops: Opening[] = [];
      const w = (face.length / n) * 0.66;
      for (let k = 0; k < n; k++) ops.push({ u: -face.length / 2 + (k + 0.5) * (face.length / n), width: w, sill: 0, height: Math.min(m.eaveHeight - 0.9, w * 1.9), shape: "pointed", depth: f.d * 0.48, fill: "void", archK: 0.72, frame: s.lod.ornament >= 1 ? 0.1 : 0, proud: 0.04 });
      faceWall(b, { length: face.length, bottom: f.footY, top: m.eaveHeight, openings: ops, mats, arch: s.lod.arch, detail: s.lod.detail });
    });
  });
  b.material(ctx.mat(m.roof.material));
  bevelPrism(b, rectOutline(f.w + 0.2, f.d + 0.2), m.eaveHeight, m.eaveHeight + 0.3, 0.06, { bottom: true });
  if (s.lod.detail >= 1) {
    b.material(mats.wall);
    for (const face of faces) onFace(b, face, () => box(b, 0, m.eaveHeight + 0.3, -0.12, face.length, 0.35, 0.24));
  }
}

/** Palm-timber scaffold lashed around an unfinished mass. */
export function sfScaffold(ctx: KitContext, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  b.material(ctx.mat(SF.palm));
  const along = f.d >= f.w ? "z" : "x";
  const L = along === "z" ? f.d : f.w;
  const W = along === "z" ? f.w : f.d;
  const n = Math.max(2, Math.round(L / 2.2));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (i * L) / (n - 1);
    for (const sd of [-1, 1]) {
      const x = along === "z" ? sd * W * 0.42 : t, z = along === "z" ? t : sd * W * 0.42;
      box(b, x, f.footY, z, 0.11, m.eaveHeight - f.footY + 0.8, 0.11);
    }
  }
  for (let y = 1.7; y < m.eaveHeight; y += 1.7) {
    for (const sd of [-1, 1]) {
      if (along === "z") box(b, sd * W * 0.42, y, 0, 0.08, 0.08, L);
      else box(b, 0, y, sd * W * 0.42, L, 0.08, 0.08);
    }
    if (along === "z") box(b, 0, y + 0.06, 0, W * 0.85, 0.05, L);
    else box(b, 0, y + 0.06, 0, L, 0.05, W * 0.85);
  }
  // Diagonal braces.
  const ang = Math.atan2(m.eaveHeight, L);
  b.push();
  if (along === "x") b.rotateY(Math.PI / 2);
  b.transform(W * 0.44, m.eaveHeight / 2, 0, 0, ang, 0);
  box(b, 0, -0.04, 0, 0.07, 0.07, Math.hypot(L, m.eaveHeight));
  b.pop();
}
