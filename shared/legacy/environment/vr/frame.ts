// Quest miniature frame (pure math, shared by the Quest worker, the Quest renderer and
// tests). Maps blueprint metres into the gameplay anchor's space and defines the plan
// "viewer frame" and the presence (rim fade) function that the build preparation uses
// for culling and the Quest shader uses for the fade, so both always agree.
//
// Anchor space (confirmed by the gameplay workflow's Quest Legacy experience): origin at
// the viewer's eyes at recentre, -Z forward, +Y up, metres, yaw only. The miniature
// centre sits at (0, surfaceY, -distance) where surfaceY = surfaceHeight - eyeHeight of
// the posture (blueprint VrStaging), so it is always below eye level.
//
//   anchor = T(0, surfaceY, -distance) · Ry(yaw) · S(scale) · T(-centerX, -datumY, -centerZ) · p
//   yaw = viewerFacingBearing + user rotation   (three.js rotation.y, radians)
//
// Viewer frame for a plan point (x, z): u to the viewer's right, v toward the viewer, in
// blueprint metres from the display centre: u = dx·cos(yaw) + dz·sin(yaw),
// v = -dx·sin(yaw) + dz·cos(yaw). The detail region is |u| <= halfWidth, |v| <= halfDepth.

import type { VrStaging } from "../blueprint/types";

export type VrPosture = "seated" | "standing";

/** Blueprint metres over which land beyond the far skirt fades in from the mist. */
export const VR_AHEAD_FADE = 60;
/** Fraction of the lateral skirt that stays fully visible before its rim fades. */
export const VR_SIDE_SOLID = 0.5;

export interface MiniatureFrame {
  posture: VrPosture;
  /** Physical metres per blueprint metre. */
  scale: number;
  /** three.js rotation.y of the miniature (radians). */
  yaw: number;
  /** Authored yaw without user rotation (radians). */
  restYaw: number;
  cos: number;
  sin: number;
  centerX: number;
  centerZ: number;
  datumY: number;
  /** Anchor-space height of the datum relative to the eyes (negative: below the eyes). */
  surfaceY: number;
  /** Anchor-space distance from the eyes to the miniature centre along -Z. */
  distance: number;
  halfWidth: number;
  halfDepth: number;
  lateral: number;
  far: number;
  near: number;
  /** Viewer-frame v of the near cut (geometry nearer to the viewer is removed). */
  nearCut: number;
}

export function bearingToYaw(bearingDeg: number): number {
  let d = bearingDeg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (d * Math.PI) / 180;
}

export function miniatureFrame(vr: VrStaging, posture: VrPosture, userYawDeg = 0): MiniatureFrame {
  const p = posture === "standing" ? vr.standing : vr.seated;
  const restYaw = bearingToYaw(vr.viewerFacingBearingDeg);
  const yaw = restYaw + (userYawDeg * Math.PI) / 180;
  const halfDepth = vr.detailExtent.depth / 2;
  return {
    posture,
    scale: vr.displayScale,
    yaw,
    restYaw,
    cos: Math.cos(yaw),
    sin: Math.sin(yaw),
    centerX: vr.displayCenter[0],
    centerZ: vr.displayCenter[1],
    datumY: vr.datumY,
    surfaceY: p.surfaceHeight - p.eyeHeight,
    distance: p.viewerDistance,
    halfWidth: vr.detailExtent.width / 2,
    halfDepth,
    lateral: vr.skirtMargins.lateral,
    far: vr.skirtMargins.far,
    near: vr.skirtMargins.near,
    nearCut: halfDepth + vr.skirtMargins.near,
  };
}

/** Viewer-frame u (right) of a plan point. */
export function frameU(f: MiniatureFrame, x: number, z: number): number {
  return (x - f.centerX) * f.cos + (z - f.centerZ) * f.sin;
}

/** Viewer-frame v (toward the viewer) of a plan point. */
export function frameV(f: MiniatureFrame, x: number, z: number): number {
  return -(x - f.centerX) * f.sin + (z - f.centerZ) * f.cos;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Presence of land at viewer-frame (u, v): 1 inside the miniature and in the land ahead
 * beyond the far skirt, 0 in the mist beside the miniature (never beside the viewer).
 * The Quest shader evaluates the same expression per vertex.
 */
export function presence(f: MiniatureFrame, u: number, v: number): number {
  const side = 1 - smooth(f.halfWidth + VR_SIDE_SOLID * f.lateral, f.halfWidth + f.lateral, Math.abs(u));
  const outer = -(f.halfDepth + f.far);
  const ahead = 1 - smooth(outer - VR_AHEAD_FADE, outer, v);
  return Math.max(side, ahead);
}

/** Blueprint point → anchor space (allocation-free when `out` is supplied). */
export function blueprintToAnchor(f: MiniatureFrame, x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = frameU(f, x, z) * f.scale;
  out[1] = f.surfaceY + (y - f.datumY) * f.scale;
  out[2] = -f.distance + frameV(f, x, z) * f.scale;
  return out;
}

/** Anchor-space point → blueprint metres. */
export function anchorToBlueprint(f: MiniatureFrame, ax: number, ay: number, az: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const u = ax / f.scale;
  const v = (az + f.distance) / f.scale;
  out[0] = f.centerX + u * f.cos - v * f.sin;
  out[1] = f.datumY + (ay - f.surfaceY) / f.scale;
  out[2] = f.centerZ + u * f.sin + v * f.cos;
  return out;
}
