// Mass frames and faces: the local coordinate frame of a blueprint mass (centre,
// yaw, base elevation) and its wall faces for openings and attachments.

import type { Building, BuildingMass, ResolvedBase } from "../../blueprint";
import { DEG } from "../../kernel";
import type { TraditionStyle } from "../nations/style";

export interface MassFrame {
  building: Building;
  mass: BuildingMass;
  base: ResolvedBase;
  style: TraditionStyle;
  /** World elevation of the mass's local y = 0 (floor + baseOffset). */
  y0: number;
  /** Yaw in radians (three.js convention). */
  yaw: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  round: boolean;
  octagon: boolean;
  elevated: boolean;
  /** Local y of the foundation bottom (below the lowest ground under the footprint). */
  footY: number;
  storeyHeight: number;
}

export interface Face {
  /** Local outward normal (x, z). */
  nx: number;
  nz: number;
  /** Local face centre (x, z) at the wall plane. */
  cx: number;
  cz: number;
  length: number;
  /** Yaw that turns local +Z onto the face normal. */
  yaw: number;
  /** "long" faces run along the mass's longer axis. */
  long: boolean;
}

export function massFrame(building: Building, mass: BuildingMass, base: ResolvedBase, style: TraditionStyle): MassFrame {
  const plan = mass.plan ?? "rect";
  const y0 = base.floorY + (mass.baseOffset ?? 0);
  const elevated = (mass.baseOffset ?? 0) >= 2.5;
  return {
    building,
    mass,
    base,
    style,
    y0,
    yaw: mass.rotationDeg * DEG,
    cx: mass.center[0],
    cz: mass.center[1],
    w: mass.width,
    d: mass.depth,
    round: plan === "round",
    octagon: plan === "octagon",
    elevated,
    footY: elevated ? 0 : base.groundMin - 0.8 - y0,
    storeyHeight: mass.eaveHeight / Math.max(1, mass.storeys),
  };
}

/** Faces of a rectangular mass, optionally pushed out on ±Z by `jettyZ`. */
export function rectFaces(w: number, d: number, jettyZ = 0): Face[] {
  const hz = d / 2 + jettyZ;
  const long = w >= d;
  return [
    { nx: 0, nz: 1, cx: 0, cz: hz, length: w, yaw: 0, long },
    { nx: 0, nz: -1, cx: 0, cz: -hz, length: w, yaw: Math.PI, long },
    { nx: 1, nz: 0, cx: w / 2, cz: 0, length: d + 2 * jettyZ, yaw: Math.PI / 2, long: !long },
    { nx: -1, nz: 0, cx: -w / 2, cz: 0, length: d + 2 * jettyZ, yaw: -Math.PI / 2, long: !long },
  ];
}

/** World plan point of a local mass point. */
export function toWorld(f: MassFrame, lx: number, lz: number): [number, number] {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.cx + lx * c + lz * s, f.cz - lx * s + lz * c];
}

/** Local mass point of a world plan point. */
export function toMassLocal(f: MassFrame, x: number, z: number): [number, number] {
  const dx = x - f.cx, dz = z - f.cz;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}
