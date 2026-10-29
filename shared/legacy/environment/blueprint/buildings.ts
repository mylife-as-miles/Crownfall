// Building placement helpers: floor resolution against the terrain and solid
// volumes for clipping / line-of-sight tests. Renderers use resolveBuildingBase so
// foundations, plinths and undercrofts meet the same ground on every platform.

import { rectCorners, toLocal } from "./math2d";
import type { TerrainSampler } from "./terrain";
import type { Building, BuildingMass, Tower, Vec2 } from "./types";

export interface ResolvedBase {
  /** Ground floor elevation of the building. */
  floorY: number;
  /** Lowest and highest ground under the footprint (foundations reach groundMin). */
  groundMin: number;
  groundMax: number;
  relief: number;
}

/** Masses starting this high above the floor (bridges, galleries) do not touch the ground. */
const ELEVATED_MASS_OFFSET = 2.5;

/**
 * Plan outline of a mass as a convex polygon: the rectangle, an octagon, or a
 * 16-gon for round masses (radius = width / 2). Used for overlap tests and maps.
 */
export function massPolygon(m: BuildingMass): Vec2[] {
  const plan = m.plan ?? "rect";
  if (plan === "rect") return rectCorners(m.center, m.width, m.depth, m.rotationDeg);
  const sides = plan === "octagon" ? 8 : 16;
  const r = plan === "octagon" ? m.width / 2 / Math.cos(Math.PI / 8) : m.width / 2;
  const out: Vec2[] = [];
  const start = ((m.rotationDeg + (plan === "octagon" ? 22.5 : 0)) * Math.PI) / 180;
  for (let i = 0; i < sides; i++) {
    const a = start + (i * 2 * Math.PI) / sides;
    out.push([m.center[0] + r * Math.cos(a), m.center[1] + r * Math.sin(a)]);
  }
  return out;
}

function massSamplePoints(m: BuildingMass): Vec2[] {
  const corners = massPolygon(m);
  const pts: Vec2[] = [m.center];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    pts.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return pts;
}

export function resolveBuildingBase(sampler: TerrainSampler, b: Building): ResolvedBase {
  let groundMin = Infinity;
  let groundMax = -Infinity;
  for (const m of b.masses) {
    if ((m.baseOffset ?? 0) >= ELEVATED_MASS_OFFSET) continue;
    for (const p of massSamplePoints(m)) {
      const h = sampler.height(p[0], p[1]);
      if (h < groundMin) groundMin = h;
      if (h > groundMax) groundMax = h;
    }
  }
  if (!Number.isFinite(groundMin)) {
    const h = sampler.height(b.entrance.position[0], b.entrance.position[1]);
    groundMin = h;
    groundMax = h;
  }
  const floorY = b.floorY !== undefined ? b.floorY : Math.round((groundMax + b.foundation.plinth) * 100) / 100;
  return { floorY, groundMin, groundMax, relief: groundMax - groundMin };
}

/** Highest point of a building (ridge, spire or parapet) in world metres. */
export function buildingTopY(base: ResolvedBase, b: Building): number {
  let top = -Infinity;
  for (const m of b.masses) top = Math.max(top, base.floorY + (m.baseOffset ?? 0) + m.ridgeHeight);
  return top;
}

/**
 * Whether a world point lies inside a mass's solid: the box up to the eave plus
 * the roof volume (prism for ridged roofs, pyramid for spires/pyramids/cones, box
 * for flat roofs and domes treated conservatively).
 */
export function pointInMass(m: BuildingMass, floorY: number, groundMin: number, x: number, y: number, z: number): boolean {
  const l = toLocal([x, z], m.center, m.rotationDeg);
  const hw = m.width / 2;
  const hd = m.depth / 2;
  const round = (m.plan ?? "rect") !== "rect";
  // Round and octagonal masses are tested as circles of radius width / 2.
  const radial = round ? Math.sqrt(l[0] * l[0] + l[1] * l[1]) / hw : 0;
  if (round ? radial > 1 : Math.abs(l[0]) > hw || Math.abs(l[1]) > hd) return false;
  const base = floorY + (m.baseOffset ?? 0);
  const bottom = (m.baseOffset ?? 0) >= ELEVATED_MASS_OFFSET ? base : Math.min(base, groundMin);
  if (y < bottom) return false;
  const eave = base + m.eaveHeight;
  const ridge = base + m.ridgeHeight;
  if (y <= eave) return true;
  if (y > ridge) return false;
  const rise = ridge - eave;
  if (rise <= 0) return false;
  const f = (ridge - y) / rise; // 1 at eave, 0 at ridge
  if (round) {
    // Cones, spires and domes over a round or octagonal plan narrow toward the apex.
    if (m.roof.form === "flat" || m.roof.form === "flat-parapet" || m.roof.form === "terrace" || m.roof.form === "none" || m.roof.form === "open-frame") return true;
    return m.roof.form === "dome" ? radial * radial + (1 - f) * (1 - f) <= 1 : radial <= f;
  }
  switch (m.roof.form) {
    case "flat":
    case "flat-parapet":
    case "terrace":
    case "dome":
    case "barrel-vault":
    case "setback-crown":
    case "open-frame":
    case "sawtooth":
    case "none":
      return true;
    case "spire":
    case "pyramid":
    case "conical":
      return Math.abs(l[0]) <= hw * f && Math.abs(l[1]) <= hd * f;
    case "lean-to":
      return (m.roof.ridgeAxis === "x" ? (l[1] + hd) / (2 * hd) : (l[0] + hw) / (2 * hw)) <= f;
    default: {
      // Ridged roofs: the cross-axis half-span shrinks toward the ridge.
      const across = m.roof.ridgeAxis === "x" ? Math.abs(l[1]) / hd : Math.abs(l[0]) / hw;
      return across <= f;
    }
  }
}

export function pointInTower(t: Tower, groundY: number, x: number, y: number, z: number): boolean {
  if (y < groundY - 1 || y > groundY + t.height) return false;
  const dx = x - t.center[0];
  const dz = z - t.center[1];
  const r = t.width / 2;
  if (t.shape === "square") return Math.abs(dx) <= r && Math.abs(dz) <= r;
  return dx * dx + dz * dz <= r * r;
}
