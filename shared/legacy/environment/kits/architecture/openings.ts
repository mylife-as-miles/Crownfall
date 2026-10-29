// Openings: windows by storey and bay on every free wall face, doors at the
// blueprint entrance, lancets for Gothic work, framed casements for jettied houses,
// small deep windows for cottages and arrow slits for towers. Faces that touch a
// neighbouring mass (party walls, keep against hall) get no openings.

import { archOutline, opening, rectOutline } from "../../kernel";
import type { MeshBuilder, P2, Rng } from "../../kernel";
import type { KitContext } from "../context";
import type { WindowShape } from "../nations/style";
import { rectFaces, toWorld } from "./frame";
import type { Face, MassFrame } from "./frame";
import type { ShellInfo } from "./walls";

export interface OpeningPlan {
  shape: WindowShape;
  width: number;
  height: number;
}

function outlineFor(shape: WindowShape | "pointed" | "door-rect", width: number, height: number): P2[] {
  switch (shape) {
    case "lancet":
    case "pointed": {
      const k = shape === "pointed" ? 0.75 : 0.88;
      const R = k * width;
      const archH = Math.sqrt(Math.max(R * R - (R - width / 2) ** 2, 0));
      return archOutline(width, Math.max(0.2, height - archH), k, 6);
    }
    case "round":
      return archOutline(width, Math.max(0.2, height - width / 2), 0.5, 6);
    case "slit":
      return archOutline(width, Math.max(0.2, height - width * 0.6), 0.9, 3);
    default:
      return rectOutline(width, height, 0, height / 2).map((p) => [p[0], p[1]] as P2);
  }
}

/** Lit-window probability by social class and function. */
function litChance(ctx: KitContext, f: MassFrame): number {
  const b = f.building;
  const storage = ["granary", "storehouse", "barn", "stable", "armoury", "muster-platform", "mill", "beast-pen"];
  if (storage.indexOf(b.function) >= 0) return 0.04;
  if (b.age.condition === "ruinous" || b.age.condition === "under-construction") return 0;
  const byClass: Record<string, number> = { lord: 0.42, retainer: 0.4, martial: 0.3, civic: 0.55, sacred: 0.65, artisan: 0.42, commoner: 0.36, labourer: 0.3 };
  return (byClass[b.social] ?? 0.35) * ctx.style.litWindows;
}

function faceBlocked(ctx: KitContext, f: MassFrame, face: Face, along: number, y: number): boolean {
  const lx = face.cx + face.nx * 0.75 + (face.nz !== 0 ? along * face.nz : 0);
  const lz = face.cz + face.nz * 0.75 + (face.nx !== 0 ? -along * face.nx : 0);
  const p = toWorld(f, lx, lz);
  const own = f.mass;
  return ctx.masses.occupied(p[0], f.y0 + y, p[1], (bid, mm) => bid === f.building.id && mm === own);
}

function emitOpening(
  ctx: KitContext, b: MeshBuilder, face: Face, along: number, sillY: number, outline: readonly P2[], frameMat: string,
  frame: number, proud: number, glass: "lit" | "dark" | "door" | "boarded" | "void", rng: Rng, sill: boolean, mullion: boolean,
): void {
  // Face frame: origin on the wall plane, x to the right seen from outside, z outward.
  const rx = face.nz !== 0 ? face.nz : 0;
  const rz = face.nx !== 0 ? -face.nx : 0;
  b.push();
  b.transform(face.cx + rx * along, sillY, face.cz + rz * along, face.yaw);
  const glassMat = glass === "lit" ? "glass-lit" : glass === "door" ? "door-oak" : glass === "boarded" ? "timber-raw" : "glass-dark";
  const k = glass === "lit" ? 0.65 + rng.next() * 0.45 : glass === "void" ? 0.25 : 1;
  opening(b, {
    outline,
    glassMaterial: ctx.mat(glassMat),
    frameMaterial: ctx.mat(frameMat),
    frame,
    proud,
    sill,
    mullion,
    glassTint: [k, k, k],
  });
  b.pop();
}

/** Where the entrance meets this mass: the face index and offset along it, or null. */
export function doorOnMass(f: MassFrame, faces: readonly Face[]): { face: Face; along: number } | null {
  const door = f.building.entrance.position;
  const dx = door[0] - f.cx, dz = door[1] - f.cz;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  let best: { face: Face; along: number } | null = null;
  let bestD = 1.2;
  for (const face of faces) {
    const dist = Math.abs((lx - face.cx) * face.nx + (lz - face.cz) * face.nz);
    const along = face.nz !== 0 ? (lx - face.cx) * face.nz : -(lz - face.cz) * face.nx;
    if (Math.abs(along) > face.length / 2 - 0.4) continue;
    if (dist < bestD) {
      bestD = dist;
      best = { face, along };
    }
  }
  return best;
}

export interface OpeningOptions {
  /** Boarded window count on this mass (repairs). */
  boarded: number;
  /** Treat the mass as a single tall interior (Gothic halls): one tall lancet per bay. */
  tallHall: boolean;
  /** Mass has a door opening (false for annexes, chimneys, scaffolds). */
  allowDoor: boolean;
  /** Openings are voids without glazing (unfinished, ruins). */
  voids: boolean;
}

/** Windows and the door of one standing rectangular mass. */
export function rectOpenings(ctx: KitContext, b: MeshBuilder, f: MassFrame, shell: ShellInfo, o: OpeningOptions): void {
  const m = f.mass;
  const st = f.style;
  const rng = ctx.rng(`openings:${f.building.id}:${m.id}`);
  const lit = litChance(ctx, f);
  const storeys = Math.max(1, m.storeys);
  const sh = m.eaveHeight / storeys;
  const baseFaces = rectFaces(f.w, f.d);
  const door = o.allowDoor ? doorOnMass(f, baseFaces) : null;
  let boarded = o.boarded;
  const detail = ctx.quality.detail;
  const role = m.role;
  const towerLike = role === "tower" || role === "keep" || role === "stair-tower";
  // Door.
  if (door) {
    const big = role === "porch" || role === "gatehouse" || f.building.function === "barn" || f.building.function === "storehouse" || f.building.function === "stable";
    const wd = role === "porch" ? 2.3 : big ? 2.6 : st.door.width;
    const hd = Math.min(sh * (storeys === 1 ? 0.82 : 0.9), role === "porch" ? 3.9 : big ? 3.0 : st.door.height);
    const shape = st.door.shape === "pointed" ? "pointed" : st.door.shape === "round" ? "round" : "door-rect";
    emitOpening(ctx, b, door.face, door.along, 0.02, outlineFor(shape, wd, hd), st.door.frameMaterial, st.kind === "gothic" ? 0.24 : 0.12, st.kind === "gothic" ? 0.26 : 0.1, o.voids ? "void" : "door", rng, false, false);
  }
  if (role === "chimney" || role === "platform" || role === "scaffold" || role === "canopy" || role === "mast") return;
  for (let s = 0; s < storeys; s++) {
    if (o.tallHall && s > 0) break;
    const jz = shell.jettyAt(s);
    const faces = rectFaces(f.w, f.d, jz);
    for (const face of faces) {
      const len = face.length;
      if (len < 1.5) continue;
      let shape: WindowShape = st.window.shape;
      let ww = st.window.width;
      let wh = Math.min(st.window.height, sh - st.window.sill - 0.4);
      let sill = s * sh + st.window.sill;
      let bay = st.window.bay;
      if (o.tallHall) {
        shape = "lancet";
        ww = Math.min(1.5, Math.max(1.1, len / 9));
        sill = 2.6;
        wh = m.eaveHeight - 4.4;
        bay = 3.4;
      } else if (towerLike) {
        const top = s === storeys - 1;
        shape = top ? (st.kind === "gothic" ? "lancet" : shape) : "slit";
        ww = top ? Math.min(0.9, len * 0.28) : 0.26;
        wh = top ? Math.min(2.2, sh - 1.1) : Math.min(1.3, sh - 1.2);
        sill = s * sh + (top ? 0.9 : sh * 0.35);
        bay = len;
      } else if (role === "shed" || role === "silo") {
        if (s === 0 && role === "shed") continue;
        shape = "small";
        ww = 0.55;
        wh = 0.55;
        bay = 4.5;
      }
      if (wh < 0.35) continue;
      if (st.kind === "jettied" && s === 0 && st.groundStoreyMaterial) {
        shape = "small";
        ww = 0.7;
        wh = Math.min(0.85, wh);
      }
      const margin = Math.min(0.9, len * 0.18);
      const n = Math.max(1, Math.floor((len - 2 * margin) / bay));
      if (n === 1 && len < ww + 0.8) continue;
      for (let i = 0; i < n; i++) {
        const along = -len / 2 + margin + ((i + 0.5) * (len - 2 * margin)) / n;
        if (door && s === 0 && face.nx === door.face.nx && face.nz === door.face.nz && Math.abs(along - door.along) < (ww + 2.2) / 2) continue;
        if (faceBlocked(ctx, f, face, along, sill + wh * 0.5)) continue;
        let glass: "lit" | "dark" | "boarded" | "void" = rng.chance(lit) ? "lit" : "dark";
        if (o.voids) glass = "void";
        else if (boarded > 0 && face.long && s === 0) {
          glass = "boarded";
          boarded--;
        }
        const outline = outlineFor(shape, ww, wh);
        const isGothic = shape === "lancet" || shape === "round";
        const frame = isGothic ? Math.max(0.12, ww * 0.14) : shape === "slit" ? 0.1 : st.window.frame;
        const proud = isGothic ? st.window.proud : shape === "small" ? 0.13 : st.window.proud;
        const frameMat = isGothic || shape === "slit" ? st.window.frameMaterial : shape === "small" && st.kind !== "jettied" ? st.plinthMaterial : st.window.frameMaterial;
        emitOpening(ctx, b, face, along, sill, outline, frameMat, frame, proud, glass, rng, detail >= 1 && shape !== "slit", isGothic && ww >= 1.15 && detail >= 1);
      }
    }
  }
}

/** Windows around a round or octagonal tower. */
export function roundOpenings(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  const m = f.mass;
  const rng = ctx.rng(`round-openings:${f.building.id}:${m.id}`);
  const storeys = Math.max(1, m.storeys);
  const sh = m.eaveHeight / storeys;
  const r = f.w / 2;
  const lit = litChance(ctx, f);
  const n = Math.max(3, Math.round((Math.PI * 2 * r) / 3.2));
  for (let s = 0; s < storeys; s++) {
    const top = s === storeys - 1;
    for (let i = 0; i < n; i++) {
      if ((i + s) % 2 === 1 && !top) continue;
      const a = ((i + s * 0.5) / n) * Math.PI * 2 + 0.3;
      const nx = Math.sin(a), nz = Math.cos(a);
      const p = toWorld(f, nx * (r + 0.7), nz * (r + 0.7));
      if (ctx.masses.occupied(p[0], f.y0 + s * sh + sh * 0.5, p[1], (bid, mm) => bid === f.building.id && mm === m)) continue;
      const ww = top ? 0.6 : 0.24;
      const wh = top ? Math.min(1.6, sh - 1) : Math.min(1.1, sh - 1);
      if (wh < 0.4) continue;
      b.push();
      b.transform(nx * (r - 0.04), s * sh + (top ? 0.9 : sh * 0.38), nz * (r - 0.04), a);
      opening(b, {
        outline: outlineFor(top ? "lancet" : "slit", ww, wh),
        glassMaterial: ctx.mat(rng.chance(top ? lit : lit * 0.4) ? "glass-lit" : "glass-dark"),
        frameMaterial: ctx.mat(f.style.window.frameMaterial),
        frame: 0.1,
        proud: 0.12,
        sill: false,
      });
      b.pop();
    }
  }
}
