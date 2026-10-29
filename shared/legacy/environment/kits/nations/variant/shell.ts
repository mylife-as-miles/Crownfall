// Building scope and mass helpers shared by the nation-variant kits: the part, landmark, gate,
// tint and detail level of a building, mass frames and faces, colliders, plinths, flat roofs
// with parapets, and the material set every face needs. Nation kits keep their own grammar;
// this module only removes repetition.

import type { LandmarkId } from "../../../../types";
import type { Building, BuildingMass, ResolvedBase } from "../../../blueprint";
import { bevelPrism, box, chamferRect, offsetPolygon, prism, rectOutline } from "../../../kernel";
import type { MeshBuilder, P2, StateGate } from "../../../kernel";
import { buildingTint, massFrame, partFor, rectFaces } from "../../architecture";
import type { Face, MassFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { traditionStyle } from "../style";
import type { FaceMats } from "./face";
import { variantLod } from "./lod";
import type { VariantLod } from "./lod";

export interface BuildingScope {
  building: Building;
  part: string;
  landmark: LandmarkId | null;
  gate: StateGate | null;
  tint: [number, number, number];
  lod: VariantLod;
  base: ResolvedBase;
  condition: Building["age"]["condition"];
}

export interface ScopeOptions {
  gate?: StateGate | null;
  condition?: Building["age"]["condition"];
  landmark?: LandmarkId | null;
}

/** Sets the builder state for a building and returns its scope. */
export function beginBuilding(ctx: KitContext, building: Building, opts: ScopeOptions = {}): BuildingScope {
  const b = ctx.b;
  const landmark = opts.landmark !== undefined ? opts.landmark : building.landmark ?? null;
  const part = landmark ? `landmark:${landmark}` : partFor(building);
  let gate: StateGate | null = opts.gate ?? null;
  if (!gate && building.appearsAtHallTier) gate = { minHallTier: building.appearsAtHallTier };
  const condition = opts.condition ?? building.age.condition;
  const tint = buildingTint(ctx, building, condition);
  b.part(part, landmark).gate(gate).shadows(true, true).lod(0);
  b.color(tint[0], tint[1], tint[2]);
  b.uvMode = "world";
  return { building, part, landmark, gate, tint, lod: variantLod(ctx, building), base: ctx.base(building), condition };
}

/** Restores neutral builder state after a building. */
export function endBuilding(ctx: KitContext): void {
  ctx.b.gate(null).color(1, 1, 1).shadows(true, true);
  ctx.b.uvMode = "world";
}

/** Re-applies a scope's state with a different gate (unfinished and completed variants). */
export function withGate(ctx: KitContext, s: BuildingScope, gate: StateGate | null, fn: () => void): void {
  const prev = s.gate;
  ctx.b.gate(gate);
  fn();
  ctx.b.gate(prev);
}

export function frameOf(ctx: KitContext, building: Building, mass: BuildingMass): MassFrame {
  return massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
}

/** Runs fn inside the mass's local frame (origin at the mass centre on its floor, +Z its front). */
export function inMass(ctx: KitContext, f: MassFrame, fn: () => void): void {
  ctx.b.push();
  ctx.b.transform(f.cx, f.y0, f.cz, f.yaw);
  fn();
  ctx.b.pop();
}

/** Runs fn in a face frame of a rectangular mass (u right seen from outside, z outward). */
export function onFace(b: MeshBuilder, face: Face, fn: () => void): void {
  b.push();
  b.transform(face.cx, 0, face.cz, face.yaw);
  fn();
  b.pop();
}

export function facesOf(f: MassFrame): Face[] {
  return rectFaces(f.w, f.d);
}

/** Camera and picking collider over a mass (mass-local top). */
export function massCollider(ctx: KitContext, s: BuildingScope, f: MassFrame, top: number, blocks = true): void {
  const bottom = f.elevated ? f.y0 : s.base.groundMin;
  const t = f.y0 + top;
  ctx.collider([f.cx, (bottom + t) / 2, f.cz], [f.w / 2 + 0.3, Math.max(0.2, (t - bottom) / 2), f.d / 2 + 0.3], f.yaw, s.landmark, blocks);
}

/** True when a world point beside a face is inside another mass (party walls get no openings). */
export function faceBlocked(ctx: KitContext, f: MassFrame, face: Face, along: number, y: number, reach = 0.75): boolean {
  const lx = face.cx + face.nx * reach + (face.nz !== 0 ? along * face.nz : 0);
  const lz = face.cz + face.nz * reach + (face.nx !== 0 ? -along * face.nx : 0);
  const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  const x = f.cx + lx * c + lz * sn, z = f.cz - lx * sn + lz * c;
  const own = f.mass;
  return ctx.masses.occupied(x, f.y0 + y, z, (bid, mm) => bid === f.building.id && mm === own);
}

/** Plinth or footing from below the ground to `top` (mass-local), following the mass outline. */
export function footing(b: MeshBuilder, f: MassFrame, mat: string, top: number, grow: number, bevel = 0.06): void {
  if (f.elevated) return;
  b.material(mat);
  const outline = offsetPolygon(rectOutline(f.w, f.d), grow);
  if (bevel > 0) bevelPrism(b, outline, f.footY, top, bevel);
  else prism(b, outline, f.footY, top, { top: true });
}

/** Battered (tapering) wall skin from y0 to y1, outward lean `batter` metres at the base. */
export function batteredSkin(b: MeshBuilder, w: number, d: number, y0: number, y1: number, batter: number, mat: string): void {
  b.material(mat);
  const lo = offsetPolygon(rectOutline(w, d), batter), hi = rectOutline(w, d);
  for (let i = 0; i < 4; i++) {
    const p = lo[i], q = lo[(i + 1) % 4], ph = hi[i], qh = hi[(i + 1) % 4];
    b.flatQuad(q[0], y0, q[1], p[0], y0, p[1], ph[0], y1, ph[1], qh[0], y1, qh[1]);
  }
}

export type MerlonStyle = "none" | "square" | "stepped" | "rounded" | "sawtooth";

export interface ParapetSpec {
  w: number;
  d: number;
  /** Roof deck level (mass-local). */
  deck: number;
  /** Parapet top above the deck. */
  height: number;
  thickness: number;
  wall: string;
  coping: string | null;
  roof: string;
  merlons: MerlonStyle;
  merlonWidth?: number;
  /** Faces (0 +Z, 1 -Z, 2 +X, 3 -X) without parapet (party walls). */
  skip?: readonly number[];
  /** Detail level (merlons and copings only from 1). */
  detail: 0 | 1 | 2;
}

function merlonProfile(style: MerlonStyle, mw: number, mh: number): P2[] {
  const a = mw / 2;
  switch (style) {
    case "stepped": {
      const b2 = a * 0.66, c = a * 0.33;
      return [[-a, 0], [a, 0], [a, mh * 0.42], [b2, mh * 0.42], [b2, mh * 0.72], [c, mh * 0.72], [c, mh], [-c, mh], [-c, mh * 0.72], [-b2, mh * 0.72], [-b2, mh * 0.42], [-a, mh * 0.42]];
    }
    case "rounded": {
      const out: P2[] = [[-a, 0], [a, 0], [a, mh - a]];
      for (let i = 1; i < 6; i++) {
        const t = (Math.PI * i) / 6;
        out.push([Math.cos(t) * a, mh - a + Math.sin(t) * a]);
      }
      out.push([-a, mh - a]);
      return out;
    }
    case "sawtooth":
      return [[-a, 0], [a, 0], [0, mh]];
    default:
      return [[-a, 0], [a, 0], [a, mh], [-a, mh]];
  }
}

/** Extrudes a profile in the face's (u, y) plane through the parapet thickness (z from -t to 0). */
function extrudeProfile(b: MeshBuilder, pts: readonly P2[], z0: number, z1: number): void {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const P = area < 0 ? pts.slice().reverse() : pts.slice();
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n];
    b.flatQuad(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
  }
  // Front cap (+z): fan from the first point (profiles are star-shaped from their base centre).
  const cx = (P[0][0] + P[1][0]) / 2, cy = P[0][1];
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n];
    b.flatTri(cx, cy, z1, p[0], p[1], z1, q[0], q[1], z1);
    b.flatTri(cx, cy, z0, q[0], q[1], z0, p[0], p[1], z0);
  }
}

/** A row of merlons on a parapet top along a face of length L (face frame, parapet at z ∈ [-t, 0]). */
export function merlonRow(b: MeshBuilder, style: MerlonStyle, L: number, y: number, t: number, mw: number, mh: number, gap: number, keep?: (i: number) => boolean): void {
  if (style === "none") return;
  const count = Math.max(1, Math.floor((L + gap) / (mw + gap)));
  const used = count * mw + (count - 1) * gap;
  const prof = merlonProfile(style, mw, mh);
  for (let i = 0; i < count; i++) {
    if (keep && !keep(i)) continue;
    const x = -used / 2 + mw / 2 + i * (mw + gap);
    b.push();
    b.translate(x, y, 0);
    extrudeProfile(b, prof, -t, 0);
    b.pop();
  }
}

/** Flat roof deck with a parapet, coping and merlons on a rectangular mass (mass-local). */
export function parapetRoof(b: MeshBuilder, p: ParapetSpec, keep?: (side: number, i: number) => boolean): void {
  const t = p.thickness;
  const inner = chamferRect(Math.max(0.4, p.w - 2 * t), Math.max(0.4, p.d - 2 * t), 0);
  b.material(p.roof);
  prism(b, inner, p.deck - 0.2, p.deck + 0.02, { top: true });
  const faces = rectFaces(p.w, p.d);
  for (let i = 0; i < 4; i++) {
    if (p.skip && p.skip.indexOf(i) >= 0) continue;
    const face = faces[i];
    onFace(b, face, () => {
      b.material(p.wall);
      const L = face.length;
      // Outer skin (continues the wall plane), inner face and top.
      b.flatQuad(-L / 2, p.deck, 0, L / 2, p.deck, 0, L / 2, p.deck + p.height, 0, -L / 2, p.deck + p.height, 0);
      b.flatQuad(L / 2 - t, p.deck, -t, -L / 2 + t, p.deck, -t, -L / 2 + t, p.deck + p.height, -t, L / 2 - t, p.deck + p.height, -t);
      const ct = p.detail >= 1 && p.coping ? 0.1 : 0;
      if (ct > 0 && p.coping) {
        b.material(p.coping);
        box(b, 0, p.deck + p.height, -t / 2, L + 0.08, ct, t + 0.12);
      } else {
        b.flatQuad(-L / 2, p.deck + p.height, 0, L / 2, p.deck + p.height, 0, L / 2 - t, p.deck + p.height, -t, -L / 2 + t, p.deck + p.height, -t);
      }
      if (p.detail >= 1 && p.merlons !== "none") {
        b.material(p.wall);
        const mw = p.merlonWidth ?? 0.7;
        merlonRow(b, p.merlons, L - 0.2, p.deck + p.height + ct, t, mw, mw * 1.05, mw * 0.55, keep ? (k) => keep(i, k) : undefined);
      }
    });
  }
}

/** The material set faces need, resolved through the nation's library. */
export function faceMats(ctx: KitContext, wall: string, frame: string, opts: Partial<FaceMats> = {}): FaceMats {
  return {
    wall: ctx.mat(wall),
    frame: ctx.mat(frame),
    lit: ctx.mat(opts.lit ?? "glass-lit"),
    dark: ctx.mat(opts.dark ?? "glass-dark"),
    door: ctx.mat(opts.door ?? "door-oak"),
    boards: ctx.mat(opts.boards ?? "timber-raw"),
    lattice: ctx.mat(opts.lattice ?? "timber-dark"),
    void: ctx.mat(opts.void ?? "glass-dark"),
  };
}

/** Repairs recorded on a mass. */
export function hasRepair(building: Building, massId: string, kind: Building["age"]["repairs"][number]["kind"]): boolean {
  for (const r of building.age.repairs) if (r.kind === kind && (r.mass === undefined || r.mass === massId)) return true;
  return false;
}

/** Deterministic lit-window chance by social class (scaled by the nation's litWindows). */
export function litChance(ctx: KitContext, building: Building): number {
  const storage = ["granary", "storehouse", "barn", "stable", "armoury", "muster-platform", "mill", "beast-pen", "warehouse", "depot", "substation"];
  if (storage.indexOf(building.function) >= 0) return 0.05;
  if (building.age.condition === "ruinous" || building.age.condition === "under-construction") return 0;
  const byClass: Record<string, number> = { lord: 0.4, retainer: 0.4, martial: 0.3, civic: 0.5, sacred: 0.6, artisan: 0.42, commoner: 0.36, labourer: 0.32 };
  return (byClass[building.social] ?? 0.35) * ctx.style.litWindows;
}
