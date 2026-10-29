// Solforiz construction grammar: thick sandstone and mud-plaster walls with deep reveals,
// round and pointed heads behind lattice, stepped merlons, carved bands, glazed domes on
// drums, windcatchers with slotted vent heads, barrel vaults with light shafts and beehive
// granaries. Working values from docs/legacy/environment/STYLE_GUIDE.md §3 (sf-* traditions).

import type { Building, BuildingMass } from "../../../blueprint";
import { box, circleOutline, lathe, prism } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";
import type { Face, MassFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { bays, faceBlocked, faceMats, faceWall, hasRepair, litChance, merlonRow, onFace } from "../variant";
import type { BuildingScope, FaceMats, MerlonStyle, Opening, VariantLod } from "../variant";

export const SF = {
  sandstone: "sf-sandstone-ashlar",
  rubble: "sf-sandstone-rubble",
  mudbrick: "sf-mudbrick-plaster",
  plaster: "sf-lime-plaster",
  tile: "sf-glazed-tile",
  palm: "sf-palm-timber",
  iron: "sf-iron-sheet",
  sulfur: "sf-sulfur",
  cloth: "cloth-plain",
} as const;

export const CUT = "sf-cut-sandstone";
export const COURT = "sf-courtyard-house";
export const WORKS = "sf-works";

export type SfKind = "cut" | "court" | "works";

export function sfKind(building: Building): SfKind {
  if (building.tradition === COURT) return "court";
  if (building.tradition === WORKS) return "works";
  return "cut";
}

/** Faces of the opening set for one face of a Solforiz mass. */
export interface SfFacePlan {
  kind: SfKind;
  /** The face looks into the building's own court (courtyard houses, manor court). */
  court: boolean;
  lod: VariantLod;
}

export function sfMats(ctx: KitContext, wallKey: string, kind: SfKind): FaceMats {
  const frame = kind === "cut" ? SF.plaster : kind === "court" ? SF.palm : SF.iron;
  return faceMats(ctx, wallKey, frame, { door: SF.palm, boards: SF.palm, lattice: SF.palm, void: "glass-dark" });
}

/** World-space centre of a building's footprint (the court of ring and U houses). */
export function footprintCentre(building: Building): [number, number] {
  let x = 0, z = 0, a = 0;
  for (const m of building.masses) {
    if (m.role === "windcatcher" || m.role === "chimney" || m.role === "stack" || m.role === "scaffold") continue;
    const area = m.width * m.depth;
    x += m.center[0] * area;
    z += m.center[1] * area;
    a += area;
  }
  return a > 0 ? [x / a, z / a] : [building.masses[0].center[0], building.masses[0].center[1]];
}

/** True when the face's outward normal points into the building's own court. */
export function facesCourt(building: Building, f: MassFrame, face: Face): boolean {
  if (building.masses.length < 2) return false;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const wx = f.cx + face.cx * c + face.cz * s, wz = f.cz - face.cx * s + face.cz * c;
  const nx = face.nx * c + face.nz * s, nz = -face.nx * s + face.nz * c;
  const ctr = footprintCentre(building);
  const dx = ctr[0] - wx, dz = ctr[1] - wz;
  const dist = Math.hypot(dx, dz);
  return dist > 0.5 && (dx * nx + dz * nz) / dist > 0.55;
}

/** Where the building's entrance meets this face (offset along it), or null. */
export function doorAlong(f: MassFrame, face: Face): number | null {
  const door = f.building.entrance.position;
  const dx = door[0] - f.cx, dz = door[1] - f.cz;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const dist = Math.abs((lx - face.cx) * face.nx + (lz - face.cz) * face.nz);
  const along = face.nz !== 0 ? (lx - face.cx) * face.nz : -(lz - face.cz) * face.nx;
  if (dist > 1.3 || Math.abs(along) > face.length / 2 - 0.5) return null;
  return along;
}

export interface SfOpeningOptions {
  eave: number;
  storeys: number;
  door: boolean;
  /** Shuttered windows left to place (boarded-opening repair). */
  shutters?: { left: number };
  /** Openings only on storeys from this index (fortified ground floors). */
  firstStorey?: number;
}

/** Window and door rhythm of one Solforiz face. */
export function sfFaceOpenings(ctx: KitContext, s: BuildingScope, f: MassFrame, face: Face, plan: SfFacePlan, o: SfOpeningOptions, salt: number): Opening[] {
  const out: Opening[] = [];
  const b = f.building;
  const rng = ctx.rng(`sf-open:${b.id}:${f.mass.id}`, salt);
  const lit = litChance(ctx, b);
  const sh = o.eave / Math.max(1, o.storeys);
  const kind = plan.kind;
  const L = face.length;
  const depth = kind === "cut" ? 0.55 : kind === "court" ? 0.42 : 0.3;
  const ornament = plan.lod.ornament;
  let doorU: number | null = null;
  if (o.door) {
    const along = doorAlong(f, face);
    if (along !== null) {
      doorU = along;
      const fine = b.quality === "noble" || b.quality === "fine";
      if (kind === "works") out.push({ u: along, width: 2.8, sill: 0, height: Math.min(3, sh * 0.85), shape: "segmental", depth: 0.35, fill: "door", frame: 0 });
      else if (kind === "court") out.push({ u: along, width: 1.1, sill: 0, height: Math.min(2.2, sh * 0.82), shape: "round", depth: 0.5, fill: "door", frame: fine && ornament >= 1 ? 0.16 : 0, proud: 0.05 });
      else out.push({ u: along, width: 1.5, sill: 0, height: Math.min(2.8, sh * 0.82), shape: "round", depth: 0.65, fill: "door", frame: ornament >= 1 ? 0.24 : 0, proud: 0.07 });
    }
  }
  for (let st = o.firstStorey ?? 0; st < o.storeys; st++) {
    let w = 0.8, h = 1.4, sill = st * sh + 1.0, bay = 2.8, shape: Opening["shape"] = "round";
    let fill: Opening["fill"] = "lattice";
    if (kind === "cut") {
      if (!plan.court && st === 0) { w = 0.6; h = 0.95; sill = Math.min(2.2, sh - 1.2); bay = 4.2; fill = "grille"; }
      else if (plan.court && st === 0) { w = 1.1; h = 2.1; sill = 0.7; bay = 3.2; }
      else if (plan.court) { w = 0.9; h = 1.6; sill = st * sh + 0.8; bay = 2.8; }
    } else if (kind === "court") {
      if (!plan.court && st === 0) { w = 0.42; h = 0.5; sill = Math.min(2.1, sh - 0.8); bay = 6.5; shape = "rect"; fill = "grille"; }
      else if (!plan.court) { w = 0.55; h = 0.65; sill = st * sh + 1.35; bay = 3.6; shape = "rect"; fill = "grille"; }
      else if (st === 0) { w = 0.9; h = 1.8; sill = 0.15; bay = 3.0; shape = "round"; fill = "shutter"; }
      else { w = 0.9; h = 1.3; sill = st * sh + 0.8; bay = 3.0; fill = "lattice"; }
    } else {
      w = 0.3; h = 1.0; sill = st * sh + Math.min(1.9, sh - 1.3); bay = 3.4; shape = "round"; fill = "dark";
    }
    if (sill + h > (st + 1) * sh - 0.3) h = (st + 1) * sh - 0.3 - sill;
    if (h < 0.35) continue;
    for (const u of bays(L, bay, Math.min(1.1, L * 0.2))) {
      if (doorU !== null && st === 0 && Math.abs(u - doorU) < (w + 2.4) / 2) continue;
      if (faceBlocked(ctx, f, face, u, sill + h * 0.5)) continue;
      let ff: Opening["fill"] = fill;
      if (kind !== "works" && rng.chance(lit * (fill === "grille" ? 0.6 : 1))) ff = "lit";
      if (o.shutters && o.shutters.left > 0 && st > 0 && face.long) { ff = "shutter"; o.shutters.left--; }
      if (plan.lod.quest && (ff === "lattice" || ff === "grille")) ff = "dark";
      out.push({ u, width: w, sill, height: h, shape, depth, fill: ff, light: 0.7 + rng.next() * 0.5, frame: kind === "cut" && ornament >= 1 && shape !== "rect" ? 0.1 : 0, proud: 0.04, sillProud: kind === "cut" && ornament >= 1 ? 0.12 : 0 });
    }
  }
  return out;
}

/** Builds the four walls of a rectangular Solforiz mass with its openings (mass-local). */
export function sfWalls(ctx: KitContext, s: BuildingScope, f: MassFrame, faces: readonly Face[], mats: FaceMats, top: number, openings: (face: Face, i: number) => Opening[], rows: readonly number[] = []): void {
  const b = ctx.b;
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    onFace(b, face, () => faceWall(b, { length: face.length, bottom: f.footY, top, openings: openings(face, i), mats, arch: s.lod.arch, detail: s.lod.detail, rows: [0.6, 1.8].concat(rows) }));
  }
}

/** Pointed dome profile (radius, height) from base radius R at y0 to the apex at y1. */
export function pointedDomeProfile(R: number, y0: number, y1: number, n: number): P2[] {
  const H = y1 - y0;
  const c = (R * R - H * H) / (2 * R);
  const rho = R - c;
  const amax = Math.acos(Math.max(-1, Math.min(1, -c / rho)));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (amax * i) / n;
    out.push([Math.max(0.02, c + rho * Math.cos(a)), y0 + rho * Math.sin(a)]);
  }
  return out;
}

/** Beehive (corbelled) profile: steep sides, rounded crown. */
export function beehiveProfile(R: number, y0: number, y1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([Math.max(0.03, R * Math.pow(1 - t, 0.62)), y0 + (y1 - y0) * (1 - Math.pow(1 - t, 2.3))]);
  }
  return out;
}

/** A dome on a mass (mass-local): glazed bands, an optional clay band and a bronze finial. */
export function sfDome(ctx: KitContext, b: MeshBuilder, R: number, y0: number, y1: number, mat: string, lod: VariantLod, opts: { beehive?: boolean; clayBand?: boolean; finial?: boolean } = {}): void {
  const n = lod.quest ? 6 : lod.detail >= 2 ? 12 : 9;
  const prof = opts.beehive ? beehiveProfile(R, y0, y1, n) : pointedDomeProfile(R, y0, y1, n);
  const seg = lod.seg;
  const base = b.getColor();
  b.material(ctx.mat(mat));
  for (let i = 0; i < prof.length - 1; i++) {
    const clay = opts.clayBand && i === 2;
    const band = !opts.beehive && lod.detail >= 1 && i % 2 === 1 ? 0.9 : 1;
    if (clay) b.material(ctx.mat(SF.mudbrick)).color(base[0] * 1.05, base[1] * 0.92, base[2] * 0.85);
    else b.material(ctx.mat(mat)).color(base[0] * band, base[1] * band, base[2] * band);
    lathe(b, [prof[i], prof[i + 1]], seg, { smooth: true });
  }
  b.color(base[0], base[1], base[2]);
  if (opts.finial !== false && !opts.beehive) {
    b.material(ctx.mat("bronze"));
    b.push();
    b.translate(0, y1 - 0.05, 0);
    lathe(b, [[0.12, 0], [0.18, 0.25], [0.06, 0.45], [0.16, 0.7], [0.05, 0.95], [0.012, 1.7]], lod.quest ? 5 : 8, { smooth: false });
    b.pop();
  }
}

/** Faceted drum with small arched windows on alternate facets (mass-local, from y0 to y1). */
export function sfDrum(ctx: KitContext, s: BuildingScope, R: number, y0: number, y1: number, mats: FaceMats, windows: boolean): void {
  const b = ctx.b;
  const n = s.lod.quest ? 8 : 12;
  const side = 2 * R * Math.tan(Math.PI / n);
  const apothem = R;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.push();
    b.transform(Math.sin(a) * apothem, 0, Math.cos(a) * apothem, a);
    const h = y1 - y0;
    const ops: Opening[] = windows && i % 2 === 0 && h > 1.1 ? [{ u: 0, width: Math.min(0.55, side * 0.4), sill: y0 + h * 0.22, height: h * 0.62, shape: "round", depth: 0.35, fill: s.lod.quest ? "dark" : "lattice" }] : [];
    faceWall(b, { length: side + 0.02, bottom: y0, top: y1, openings: ops, mats, arch: s.lod.arch, detail: s.lod.detail });
    b.pop();
  }
  b.material(mats.frame);
  prism(b, circleOutline(R / Math.cos(Math.PI / n) + 0.12, n, Math.PI / n), y1 - 0.02, y1 + 0.16, { top: true, bottom: true });
}
