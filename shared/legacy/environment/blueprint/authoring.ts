// Authoring helpers for the per-nation blueprint files. They only shorten data
// entry; everything they return is plain blueprint data.

import { resolveBuildingBase } from "./buildings";
import { pointAlongPolyline, polar, rotateLocal, round2, vectorBearing, yawFacingBearing } from "./math2d";
import type { TerrainSampler } from "./terrain";
import type {
  Building,
  BuildingMass,
  CameraFraming,
  CameraId,
  DistantPlace,
  MassRole,
  Pose,
  RoofForm,
  Vec2,
  Vec3,
} from "./types";

export interface MassInput {
  id: string;
  role: MassRole;
  at: Vec2;
  w: number;
  d: number;
  rot?: number;
  storeys: number;
  eave: number;
  ridge: number;
  roof: RoofForm;
  axis?: "x" | "z";
  roofMat: string;
  wallMat: string;
  baseOffset?: number;
  plan?: BuildingMass["plan"];
}

export function mass(m: MassInput): BuildingMass {
  const out: BuildingMass = {
    id: m.id,
    role: m.role,
    center: m.at,
    width: m.w,
    depth: m.d,
    rotationDeg: m.rot ?? 0,
    storeys: m.storeys,
    eaveHeight: m.eave,
    ridgeHeight: Math.max(m.ridge, m.eave),
    roof: { form: m.roof, ridgeAxis: m.axis ?? (m.d >= m.w ? "z" : "x"), material: m.roofMat },
    wallMaterial: m.wallMat,
  };
  if (m.baseOffset !== undefined) out.baseOffset = m.baseOffset;
  if (m.plan && m.plan !== "rect") out.plan = m.plan;
  return out;
}

/** Ground-following helpers bound to one nation's terrain. */
export function groundTools(sampler: TerrainSampler) {
  const ground = (x: number, z: number, dy = 0): Vec3 => [x, round2(sampler.height(x, z) + dy), z];
  const pose = (x: number, z: number, yawDeg: number, dy = 0): Pose => ({ position: ground(x, z, dy), yawDeg });
  /** Pose facing a compass bearing. */
  const facing = (x: number, z: number, bearingDeg: number, dy = 0): Pose => ({ position: ground(x, z, dy), yawDeg: yawFacingBearing(bearingDeg) });
  /** Position on a building's resolved floor. */
  const onFloor = (b: Building, x: number, z: number, dy = 0): Vec3 => [x, round2(resolveBuildingBase(sampler, b).floorY + dy), z];
  return { ground, pose, facing, onFloor };
}

/** Distant place authored by bearing and distance from the datum. */
export function distantPlace(p: Omit<DistantPlace, "position">): DistantPlace {
  return { ...p, position: polar(p.bearingDeg, p.distance) };
}

/** Camera framing helper; orbit defaults suit a landmark inspection. */
export function camera(
  id: CameraId,
  label: string,
  position: Vec3,
  target: Vec3,
  fovDeg: number,
  orbit: CameraFraming["orbit"],
  composition: string,
  transitionSeconds = 1.6,
): CameraFraming {
  return { id, label, position, target, fovDeg, orbit, transitionSeconds, composition };
}

/** Camera position at a compass bearing (from target to camera), horizontal distance and height above target. */
export function cameraFrom(target: Vec3, bearingDeg: number, horizontal: number, rise: number): Vec3 {
  const p = polar(bearingDeg, horizontal, [target[0], target[2]]);
  return [p[0], round2(target[1] + rise), p[1]];
}

/** Bearing from a to b in plan. */
export function bearingBetween(a: Vec2, b: Vec2): number {
  return round2(vectorBearing(b[0] - a[0], b[1] - a[1]));
}

/** Evenly spaced poses along a straight line (inclusive), all facing one bearing. */
export function poseRow(sampler: TerrainSampler, from: Vec2, to: Vec2, count: number, bearingDeg: number, dy = 0): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const x = round2(from[0] + (to[0] - from[0]) * t);
    const z = round2(from[1] + (to[1] - from[1]) * t);
    out.push({ position: [x, round2(sampler.height(x, z) + dy), z], yawDeg: yawFacingBearing(bearingDeg) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Street frontage: lots placed against a street edge, fronts facing the street.
// Every lot is still authored individually (arc position, side, size); the
// helper only keeps plots square to a curving street.
// ---------------------------------------------------------------------------

export interface StreetLike {
  points: readonly Vec2[];
  width: number;
}

export interface FrontagePlacement {
  /** Mass centre. */
  center: Vec2;
  /** Yaw that turns the mass front (local +Z) toward the street. */
  rot: number;
  /** Door position on the street face. */
  door: Vec2;
  /** Compass bearing the front faces. */
  facingBearingDeg: number;
}

/**
 * Lot of `depth` metres on one side of a street at arc length `s` (side relative to
 * the direction the street's points are listed in). `setback` leaves a forecourt
 * or step between the street edge and the façade.
 */
export function onStreet(street: StreetLike, s: number, side: "left" | "right", depth: number, setback = 0): FrontagePlacement {
  const { point, tangent } = pointAlongPolyline(street.points, s);
  // Plan view with north up: the left of travel direction (tx, tz) is (tz, -tx).
  const nx = side === "left" ? tangent[1] : -tangent[1];
  const nz = side === "left" ? -tangent[0] : tangent[0];
  const edge = street.width / 2 + setback;
  const door: Vec2 = [round2(point[0] + nx * edge), round2(point[1] + nz * edge)];
  const center: Vec2 = [round2(point[0] + nx * (edge + depth / 2)), round2(point[1] + nz * (edge + depth / 2))];
  const facingBearingDeg = round2(vectorBearing(-nx, -nz));
  return { center, rot: round2(yawFacingBearing(facingBearingDeg)), door, facingBearingDeg };
}

/** World plan point at a local offset (x right, z toward the front) from a rotated origin. */
export function local(origin: Vec2, rot: number, lx: number, lz: number): Vec2 {
  const r = rotateLocal(lx, lz, rot);
  return [round2(origin[0] + r[0]), round2(origin[1] + r[1])];
}

export interface BuildingInput {
  id: string;
  name: string;
  district: Building["district"];
  fn: Building["function"];
  tradition: string;
  masses: readonly BuildingMass[];
  door: Vec2;
  facing: number;
  foundation?: Building["foundation"];
  era: Building["age"]["era"];
  built: number;
  condition: Building["age"]["condition"];
  repairs?: Building["age"]["repairs"];
  quality: Building["quality"];
  social: Building["social"];
  lod?: Building["lod"];
  kit: string;
  tags?: readonly string[];
  story: string;
  landmark?: Building["landmark"];
  overlap?: readonly string[];
  unfinished?: Building["unfinished"];
  tier?: Building["appearsAtHallTier"];
  floorY?: number;
}

/** Building with the defaults most structures share (plinth foundation, mid LOD). */
export function building(b: BuildingInput): Building {
  const out: Building = {
    id: b.id,
    name: b.name,
    district: b.district,
    function: b.fn,
    tradition: b.tradition,
    masses: b.masses,
    entrance: { position: b.door, facingBearingDeg: b.facing },
    foundation: b.foundation ?? { kind: "plinth", plinth: 0.3, maxRelief: 2 },
    age: { era: b.era, builtYearsAgo: b.built, condition: b.condition, repairs: b.repairs ?? [] },
    quality: b.quality,
    social: b.social,
    lod: b.lod ?? "mid",
    kit: b.kit,
    tags: b.tags ?? [],
    story: b.story,
  };
  if (b.landmark) out.landmark = b.landmark;
  if (b.overlap) out.allowOverlapWith = b.overlap;
  if (b.unfinished) out.unfinished = b.unfinished;
  if (b.tier) out.appearsAtHallTier = b.tier;
  if (b.floorY !== undefined) out.floorY = b.floorY;
  return out;
}

// ---------------------------------------------------------------------------
// Local frames: author a rotated site in axis-aligned local coordinates.
// ---------------------------------------------------------------------------

export interface SiteFrame {
  /** Yaw of the frame (rotationDeg convention): local +Z faces bearingOfYaw(yaw). */
  yaw: number;
  /** World plan point of a local (x, z). */
  p(lx: number, lz: number): Vec2;
  /** World points of local points. */
  pts(points: readonly (readonly [number, number])[]): Vec2[];
  /** World rotation for a local rotation. */
  rot(localDeg?: number): number;
  /** World compass bearing of a local bearing (0 = local -Z, 90 = local +X). */
  bearing(localBearingDeg: number): number;
}

export function siteFrame(origin: Vec2, yaw: number): SiteFrame {
  const p = (lx: number, lz: number): Vec2 => local(origin, yaw, lx, lz);
  return {
    yaw,
    p,
    pts: (points) => points.map((q) => p(q[0], q[1])),
    rot: (localDeg = 0) => round2(yaw + localDeg),
    bearing: (b) => {
      const v = ((b - yaw) % 360 + 360) % 360;
      return round2(v);
    },
  };
}
