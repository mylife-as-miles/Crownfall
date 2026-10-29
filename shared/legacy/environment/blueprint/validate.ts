// Blueprint validation shared by the tests (shared/legacy/tests/environment-blueprint.test.ts),
// the map generator and scripts/check-legacy-environment.ts. Pure and deterministic.

import { LEGACY_LANDMARKS } from "../../environment-contract";
import { buildingTopY, massPolygon, pointInMass, pointInTower, resolveBuildingBase } from "./buildings";
import { NATION_KIT_PREFIX } from "./coordinates";
import {
  convexPenetration,
  dist2,
  distanceSegmentRect,
  distanceToPolygonEdge,
  distanceToPolyline,
  pointInPolygon,
  pointInRect,
  polar,
  polylineLength,
  rectCorners,
  samplePolyline,
  shapePolygon,
  vectorBearing,
} from "./math2d";
import { compileSchedule } from "./schedule";
import { createTerrainSampler } from "./terrain";
import type { TerrainSampler } from "./terrain";
import type { BannerholdBlueprint, BuildingMass, CameraFraming, Route, StoryKind, Vec2, Vec3 } from "./types";

export interface BlueprintIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export const REQUIRED_STORY_KINDS: readonly StoryKind[] = [
  "repaired-watchtower",
  "weathered-fortification",
  "levy-yard-vs-noble-architecture",
  "merchant-road",
  "unfinished-structure",
  "ceremonial-place",
  "empty-character-position",
];

export const REQUIRED_NPC_ROLES = ["sentry", "smith", "messenger", "drill", "resident"] as const;

/** Walls a route may only cross at a gate. */
const BARRIER_WALLS = new Set(["curtain", "town-wall", "palisade", "rampart", "low-wall", "security-fence", "barrier"]);

interface Ctx {
  bp: BannerholdBlueprint;
  T: TerrainSampler;
  issues: BlueprintIssue[];
  floors: Map<string, { floorY: number; groundMin: number }>;
}

function err(c: Ctx, code: string, message: string): void {
  c.issues.push({ severity: "error", code, message: `${c.bp.nationId}: ${message}` });
}

function warn(c: Ctx, code: string, message: string): void {
  c.issues.push({ severity: "warning", code, message: `${c.bp.nationId}: ${message}` });
}

function inExtents(c: Ctx, p: Vec2, margin = 0): boolean {
  const e = c.bp.terrain.extents;
  return p[0] >= e.minX - margin && p[0] <= e.maxX + margin && p[1] >= e.minZ - margin && p[1] <= e.maxZ + margin;
}

/** Id of the water body covering a plan point, or null. */
function waterBodyAt(c: Ctx, p: Vec2): string | null {
  for (const w of c.bp.terrain.water) {
    if (w.shape.kind === "area" ? pointInPolygon(p, w.shape.points) : distanceToPolyline(p, w.shape.points) <= w.shape.width / 2) return w.id;
  }
  return null;
}

function massRect(m: BuildingMass) {
  return { center: m.center, width: m.width, depth: m.depth, rotationDeg: m.rotationDeg };
}

function allows(a: { allowOverlapWith?: readonly string[] }, id: string): boolean {
  return !!a.allowOverlapWith && a.allowOverlapWith.indexOf(id) >= 0;
}

function districtPolygon(c: Ctx, id: string): readonly Vec2[] | null {
  for (const d of c.bp.districts) if (d.id === id) return d.polygon;
  return null;
}

/** Open structures people and props can stand under (but cameras cannot see through their roofs). */
function isOpenMass(m: BuildingMass): boolean {
  return m.role === "canopy" || m.role === "scaffold" || m.role === "arcade" || m.roof.form === "open-frame";
}

/** Point is solid: inside a building mass or a tower (optionally ignoring some ids). */
function solidAt(c: Ctx, x: number, y: number, z: number, ignore: readonly string[], passOpen = false): string | null {
  for (const b of c.bp.buildings) {
    if (ignore.indexOf(b.id) >= 0 || b.appearsAtHallTier !== undefined) continue;
    const f = c.floors.get(b.id);
    if (!f) continue;
    for (const m of b.masses) {
      if (passOpen && isOpenMass(m)) continue;
      if (pointInMass(m, f.floorY, f.groundMin, x, y, z)) return b.id;
    }
  }
  for (const t of c.bp.towers) {
    if (ignore.indexOf(t.id) >= 0) continue;
    if (pointInTower(t, c.T.height(t.center[0], t.center[1]), x, y, z)) return t.id;
  }
  return null;
}

function checkFinite(c: Ctx, value: unknown, path: string, depth = 0): void {
  if (depth > 12) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) err(c, "non-finite", `${path} is not a finite number`);
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) checkFinite(c, value[i], `${path}[${i}]`, depth + 1);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) checkFinite(c, (value as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
  }
}

function checkIdsAndScale(c: Ctx): void {
  const bp = c.bp;
  const seen = new Set<string>();
  const groups: { name: string; ids: string[] }[] = [
    { name: "building", ids: bp.buildings.map((b) => b.id) },
    { name: "wall", ids: bp.walls.map((w) => w.id) },
    { name: "tower", ids: bp.towers.map((t) => t.id) },
    { name: "route", ids: bp.routes.map((r) => r.id) },
    { name: "gate", ids: bp.gates.map((g) => g.id) },
    { name: "expansion", ids: bp.expansion.map((e) => e.id) },
    { name: "npc", ids: bp.npcs.map((n) => n.id) },
    { name: "dressing", ids: bp.dressing.map((d) => d.id) },
    { name: "vegetation", ids: bp.vegetation.map((v) => v.id) },
    { name: "site", ids: bp.activitySites.map((s) => s.id) },
    { name: "place", ids: bp.outer.places.map((p) => p.id) },
    { name: "outpost", ids: bp.outer.outposts.map((o) => o.id) },
  ];
  for (const g of groups) {
    for (const id of g.ids) {
      if (seen.has(id)) err(c, "duplicate-id", `duplicate id ${id} (${g.name})`);
      seen.add(id);
    }
  }
  const e = bp.terrain.extents;
  if (!(e.maxX > e.minX && e.maxZ > e.minZ)) err(c, "terrain-extents", "terrain extents are empty");
  const w = bp.coreReference.width;
  const d = bp.coreReference.depth;
  if (w < 70 || w > 160 || d < 60 || d > 130) err(c, "core-scale", `core ${w} × ${d} m strays too far from the brief's ≈100 × 80 m`);
  const ids = new Set(bp.districts.map((x) => x.id));
  for (const id of ["A", "B", "C", "D", "E", "F"]) if (!ids.has(id as "A")) err(c, "district-missing", `district ${id} missing`);
  for (const dd of bp.districts) if (dd.polygon.length < 3) err(c, "district-polygon", `district ${dd.id} has no polygon`);
  for (const p of bp.settlementBoundary) if (!inExtents(c, p)) err(c, "boundary-extents", "settlement boundary leaves the terrain extents");
}

function checkBuildings(c: Ctx): void {
  const bp = c.bp;
  const T = c.T;
  for (const b of bp.buildings) {
    if (b.masses.length === 0) {
      err(c, "building-empty", `${b.id} has no masses`);
      continue;
    }
    const base = resolveBuildingBase(T, b);
    c.floors.set(b.id, { floorY: base.floorY, groundMin: base.groundMin });
    if (base.relief > b.foundation.maxRelief + 1e-6)
      err(c, "foundation-relief", `${b.id} sits on ${base.relief.toFixed(2)} m of ground relief; ${b.foundation.kind} allows ${b.foundation.maxRelief} m`);
    if (base.floorY < base.groundMax - 0.05 && b.floorY === undefined) err(c, "floor-buried", `${b.id} floor is below the ground`);
    const massIds = new Set<string>();
    for (const m of b.masses) {
      if (massIds.has(m.id)) err(c, "mass-id", `${b.id} repeats mass id ${m.id}`);
      massIds.add(m.id);
      if (!(m.width > 0 && m.depth > 0)) err(c, "mass-size", `${b.id}/${m.id} has no footprint`);
      if (m.ridgeHeight < m.eaveHeight) err(c, "mass-height", `${b.id}/${m.id} ridge below eave`);
      if (m.eaveHeight <= 0) err(c, "mass-height", `${b.id}/${m.id} has no height`);
      if ((m.plan ?? "rect") !== "rect" && Math.abs(m.width - m.depth) > 1e-6) err(c, "mass-plan", `${b.id}/${m.id} is ${m.plan} but width ≠ depth`);
      const corners = massPolygon(m);
      for (const p of corners) {
        if (!inExtents(c, p)) err(c, "building-extents", `${b.id}/${m.id} leaves the terrain`);
        if (b.district !== "G" && !pointInPolygon(p, bp.settlementBoundary)) err(c, "building-boundary", `${b.id}/${m.id} corner [${p[0].toFixed(1)}, ${p[1].toFixed(1)}] lies outside the settlement boundary`);
        if (b.foundation.kind !== "stilts" && (m.baseOffset ?? 0) < 2.5) {
          const wet = waterBodyAt(c, p);
          if (wet && !allows(b, wet)) err(c, "building-water", `${b.id}/${m.id} stands in ${wet}`);
        }
      }
    }
    if (b.district !== "G") {
      const poly = districtPolygon(c, b.district);
      const centre = b.masses[0].center;
      if (poly && !pointInPolygon(centre, poly)) err(c, "building-district", `${b.id} centre lies outside district ${b.district}`);
    }
    if (b.unfinished && b.age.condition !== "under-construction") err(c, "unfinished-condition", `${b.id} is unfinished but not under construction`);
    if (b.age.condition === "under-construction" && !b.unfinished) err(c, "unfinished-meta", `${b.id} is under construction without unfinished metadata`);
  }
  // Pairwise footprint overlap between different buildings.
  for (let i = 0; i < bp.buildings.length; i++) {
    const a = bp.buildings[i];
    for (let j = i + 1; j < bp.buildings.length; j++) {
      const b = bp.buildings[j];
      if (allows(a, b.id) || allows(b, a.id)) continue;
      for (const ma of a.masses) {
        for (const mb of b.masses) {
          const pen = convexPenetration(massPolygon(ma), massPolygon(mb));
          if (pen > 0.05) err(c, "building-overlap", `${a.id}/${ma.id} overlaps ${b.id}/${mb.id} by ${pen.toFixed(2)} m`);
        }
      }
    }
  }
  // Buildings against walls, towers and routes.
  for (const b of bp.buildings) {
    for (const m of b.masses) {
      const r = massRect(m);
      for (const w of bp.walls) {
        if (allows(b, w.id) || allows(w, b.id)) continue;
        const n = w.points.length;
        const segs = w.closed ? n : n - 1;
        for (let s = 0; s < segs; s++) {
          const d = distanceSegmentRect(w.points[s], w.points[(s + 1) % n], r);
          if (d < w.thickness / 2 - 0.05) {
            err(c, "building-wall", `${b.id}/${m.id} intersects wall ${w.id}`);
            break;
          }
        }
      }
      for (const t of bp.towers) {
        if (allows(b, t.id) || allows(t, b.id)) continue;
        const tw = t.shape === "square" ? t.width : t.width * 0.9;
        const pen = convexPenetration(massPolygon(m), rectCorners(t.center, tw, tw, 0));
        if (pen > 0.05) err(c, "building-tower", `${b.id}/${m.id} overlaps tower ${t.id}`);
      }
      if ((m.baseOffset ?? 0) >= 2.5) continue;
      for (const rt of bp.routes) {
        if (rt.grade === "elevated" || allows(b, rt.id)) continue;
        const inflate = rt.width / 2 - 0.3;
        for (const p of samplePolyline(rt.points, 0.5)) {
          if (!pointInRect(p, r, inflate)) continue;
          if (dist2(p, b.entrance.position) <= 2.5) continue;
          err(c, "building-route", `${b.id}/${m.id} blocks route ${rt.id} near [${p[0].toFixed(1)}, ${p[1].toFixed(1)}]`);
          break;
        }
      }
    }
  }
}

/** Dwelling functions that make up the residential quarter. */
const DWELLINGS = new Set(["house", "tenement", "cottage", "longhouse", "pit-house", "courtyard-house", "worker-block"]);
/** Furthest an entrance may lie from the edge of a route (doors open onto streets, lanes, yards or courts). */
const ENTRANCE_REACH = 6;

function checkCirculationAndHabitation(c: Ctx): void {
  const bp = c.bp;
  const traditions = new Set(bp.traditions.map((t) => t.key));
  const prefix = NATION_KIT_PREFIX[bp.nationId];
  for (const b of bp.buildings) {
    if (!traditions.has(b.tradition)) err(c, "tradition", `${b.id} uses unknown tradition ${b.tradition}`);
    if (b.kit.split(".")[0] !== prefix) err(c, "kit-prefix", `${b.id} kit ${b.kit} does not start with "${prefix}."`);
    if (!b.story.trim() || !b.name.trim()) err(c, "building-text", `${b.id} needs a name and a story`);
    let edge = Infinity;
    for (const m of b.masses) {
      if ((m.baseOffset ?? 0) >= 2.5) continue;
      edge = Math.min(edge, distanceToPolygonEdge(b.entrance.position, massPolygon(m)));
    }
    if (edge > 1.6) err(c, "entrance-edge", `${b.id} entrance is ${edge.toFixed(1)} m from its walls`);
    if (b.district !== "G" && b.appearsAtHallTier === undefined) {
      let best = Infinity;
      for (const r of bp.routes) best = Math.min(best, distanceToPolyline(b.entrance.position, r.points) - r.width / 2);
      if (best > ENTRANCE_REACH) err(c, "entrance-route", `${b.id} entrance is ${best.toFixed(1)} m from the nearest route`);
    }
  }
  const dwellings = bp.buildings.filter((b) => b.district === "C" && DWELLINGS.has(b.function));
  if (dwellings.length < 6) err(c, "residential-count", `only ${dwellings.length} dwellings in the residential quarter`);
  if (new Set(dwellings.map((b) => b.quality)).size < 2) err(c, "residential-class", "residential quarter shows a single material quality");
  if (new Set(dwellings.map((b) => b.age.condition)).size < 3) err(c, "residential-age", "residential quarter needs at least three conditions of age and repair");
  if (new Set(dwellings.map((b) => b.age.era)).size < 2) err(c, "residential-age", "residential quarter was all built in one era");
  const signatures = new Map<string, string>();
  for (const b of dwellings) {
    const m = b.masses[0];
    const key = [m.width, m.depth, m.storeys, m.eaveHeight, m.ridgeHeight, m.roof.form, b.masses.length].join("|");
    const prev = signatures.get(key);
    if (prev) err(c, "residential-repeat", `${b.id} repeats the massing of ${prev}`);
    else signatures.set(key, b.id);
  }
  const grades = new Set(bp.buildings.filter((b) => b.district !== "G").map((b) => b.quality));
  if (!(grades.has("noble") || grades.has("fine")) || !grades.has("poor")) err(c, "class-spread", "the holding must show both fine and poor construction");
}

function segmentsIntersect(a: Vec2, b: Vec2, p: Vec2, q: Vec2): Vec2 | null {
  const r0 = b[0] - a[0];
  const r1 = b[1] - a[1];
  const s0 = q[0] - p[0];
  const s1 = q[1] - p[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p[0] - a[0]) * s1 - (p[1] - a[1]) * s0) / den;
  const u = ((p[0] - a[0]) * r1 - (p[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r0 * t, a[1] + r1 * t];
}

function checkFortifications(c: Ctx): void {
  const bp = c.bp;
  const wallIds = new Set(bp.walls.map((w) => w.id));
  const routeIds = new Set(bp.routes.map((r) => r.id));
  let weathered = 0;
  for (const w of bp.walls) {
    if (w.points.length < 2) err(c, "wall-points", `${w.id} needs two points`);
    if (!(w.height > 0 && w.thickness > 0)) err(c, "wall-size", `${w.id} has no height or thickness`);
    const segs = w.closed ? w.points.length : w.points.length - 1;
    for (const s of w.segments) {
      if (s.from < 0 || s.to > segs || s.from >= s.to) err(c, "wall-segment", `${w.id} segment range ${s.from}-${s.to} is invalid`);
      if (s.condition === "weathered" || s.condition === "damaged" || s.condition === "ruinous") weathered++;
    }
    for (const p of w.points) if (!inExtents(c, p)) err(c, "wall-extents", `${w.id} leaves the terrain`);
  }
  if (weathered === 0) err(c, "story-weathered", "no weathered fortification segment");
  const repaired = bp.towers.filter((t) => t.storyRole === "repaired-watchtower");
  if (repaired.length !== 1) err(c, "story-watchtower", `expected one repaired watchtower, found ${repaired.length}`);
  for (const t of repaired) if (t.repairs.length === 0) err(c, "story-watchtower", `${t.id} has no recorded repairs`);
  for (const t of bp.towers) {
    if (t.wallId !== null && !wallIds.has(t.wallId)) err(c, "tower-wall", `${t.id} references unknown wall ${t.wallId}`);
    if (!inExtents(c, t.center)) err(c, "tower-extents", `${t.id} leaves the terrain`);
  }
  const mains = bp.gates.filter((g) => g.kind === "main-gate");
  if (mains.length !== 1) err(c, "main-gate", `expected one main gate, found ${mains.length}`);
  for (const g of bp.gates) {
    if (!wallIds.has(g.wallId)) err(c, "gate-wall", `${g.id} references unknown wall ${g.wallId}`);
    if (!routeIds.has(g.routeId)) err(c, "gate-route", `${g.id} references unknown route ${g.routeId}`);
  }
  for (const g of mains) {
    const wall = bp.walls.find((w) => w.id === g.wallId);
    if (wall && distanceToPolyline(g.position, wall.points) > 3) err(c, "main-gate", `${g.id} is not on its wall`);
    const road = bp.routes.find((r) => r.id === g.routeId);
    if (!road || road.hierarchy !== "national" || !road.outer) err(c, "main-gate-road", `${g.id} must open onto a national outer road`);
    else {
      let far = 0;
      for (const p of road.points) far = Math.max(far, Math.sqrt(p[0] * p[0] + p[1] * p[1]));
      if (far < 400) err(c, "main-gate-road", `${road.id} does not lead toward the greater nation (reaches ${far.toFixed(0)} m)`);
    }
  }
  // Ground routes may cross barrier walls only at a gate on that wall.
  for (const rt of bp.routes) {
    if (rt.grade === "elevated") continue;
    for (const w of bp.walls) {
      if (!BARRIER_WALLS.has(w.kind) || allows(w, rt.id)) continue;
      const n = w.points.length;
      const segs = w.closed ? n : n - 1;
      for (let i = 1; i < rt.points.length; i++) {
        for (let s = 0; s < segs; s++) {
          const x = segmentsIntersect(rt.points[i - 1], rt.points[i], w.points[s], w.points[(s + 1) % n]);
          if (!x) continue;
          const ok = bp.gates.some((g) => g.wallId === w.id && dist2(g.position, x) <= g.width / 2 + 2);
          if (!ok) err(c, "route-wall", `${rt.id} crosses ${w.id} at [${x[0].toFixed(1)}, ${x[1].toFixed(1)}] without a gate`);
        }
      }
    }
  }
}

function checkRoutes(c: Ctx): void {
  const bp = c.bp;
  for (const r of bp.routes) {
    if (r.points.length < 2) err(c, "route-points", `${r.id} needs two points`);
    if (!(r.width > 0)) err(c, "route-width", `${r.id} has no width`);
    if (r.grade === "elevated" && (!r.deckY || r.deckY.length !== r.points.length)) err(c, "route-deck", `${r.id} is elevated without a deck height per point`);
    if (!r.outer) for (const p of r.points) if (!inExtents(c, p)) err(c, "route-extents", `${r.id} leaves the terrain but is not an outer route`);
  }
  // Junction graph: route A joins route B where an endpoint of one lies on the other.
  const n = bp.routes.length;
  const adj: number[][] = bp.routes.map(() => []);
  const canJoin = (a: Route, b: Route): boolean => a.grade === b.grade || a.kind === "stair" || a.kind === "ramp" || b.kind === "stair" || b.kind === "ramp";
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = bp.routes[i];
      const b = bp.routes[j];
      if (!canJoin(a, b)) continue;
      const tol = Math.max(a.width, b.width) / 2 + 0.75;
      const ends = [a.points[0], a.points[a.points.length - 1]];
      if (ends.some((p) => distanceToPolyline(p, b.points) <= tol)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const main = bp.gates.find((g) => g.kind === "main-gate");
  if (!main) return;
  const start = bp.routes.findIndex((r) => r.id === main.routeId);
  if (start < 0) return;
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.shift() as number;
    for (const j of adj[i]) if (!seen.has(j)) {
      seen.add(j);
      queue.push(j);
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) err(c, "route-orphan", `${bp.routes[i].id} is not connected to the main gate network`);
  const required = ["gate", "manor", "muster", "residential", "artisan", "archive", "herald"];
  for (const id of required) {
    const d = bp.destinations.find((x) => x.id === id);
    if (!d) {
      err(c, "destination-missing", `destination ${id} missing`);
      continue;
    }
    let ok = false;
    seen.forEach((i) => {
      const r = bp.routes[i];
      if (distanceToPolyline(d.position, r.points) <= r.width / 2 + 6) ok = true;
    });
    if (!ok) err(c, "destination-unreached", `destination ${id} is not reached by the gate network`);
  }
}

function onGround(c: Ctx, p: Vec3, tolerance = 0.6): boolean {
  return Math.abs(p[1] - c.T.height(p[0], p[2])) <= tolerance;
}

function checkLandmarksAndSlots(c: Ctx): void {
  const bp = c.bp;
  const buildingIds = new Set(bp.buildings.map((b) => b.id));
  const cameraIds = new Set(bp.cameras.map((x) => x.id));
  const found = bp.landmarks.map((l) => l.id);
  for (const id of LEGACY_LANDMARKS) if (found.indexOf(id) < 0) err(c, "landmark-missing", `landmark ${id} missing`);
  if (bp.landmarks.length !== LEGACY_LANDMARKS.length) err(c, "landmark-count", `expected ${LEGACY_LANDMARKS.length} landmarks`);
  for (const l of bp.landmarks) {
    if (!(l.pickRadius >= 3 && l.pickRadius <= 25)) err(c, "pick-radius", `${l.id} pick radius ${l.pickRadius} m outside 3–25 m`);
    if (l.pickRadius * bp.vr.displayScale < bp.vr.reach.minTargetRadius)
      err(c, "pick-radius-vr", `${l.id} pick radius is ${(l.pickRadius * bp.vr.displayScale * 100).toFixed(1)} cm in VR (< ${bp.vr.reach.minTargetRadius * 100} cm)`);
    if (!inExtents(c, [l.anchor[0], l.anchor[2]])) err(c, "landmark-extents", `${l.id} anchor leaves the terrain`);
    if (l.buildingIds.length === 0) err(c, "landmark-buildings", `${l.id} names no buildings`);
    for (const id of l.buildingIds) if (!buildingIds.has(id)) err(c, "landmark-buildings", `${l.id} references unknown building ${id}`);
    if (!bp.buildings.some((b) => b.landmark === l.id && l.buildingIds.indexOf(b.id) >= 0)) err(c, "landmark-owner", `${l.id} has no building tagged with it`);
    if (!cameraIds.has(l.cameraId)) err(c, "landmark-camera", `${l.id} camera ${l.cameraId} missing`);
    if (l.anchor[1] < c.T.height(l.anchor[0], l.anchor[2])) err(c, "landmark-anchor", `${l.id} anchor is underground`);
  }
  for (let i = 0; i < bp.landmarks.length; i++) {
    for (let j = i + 1; j < bp.landmarks.length; j++) {
      const a = bp.landmarks[i];
      const b = bp.landmarks[j];
      const dx = a.pickCenter[0] - b.pickCenter[0];
      const dy = a.pickCenter[1] - b.pickCenter[1];
      const dz = a.pickCenter[2] - b.pickCenter[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < a.pickRadius + b.pickRadius) err(c, "pick-overlap", `${a.id} and ${b.id} pick volumes overlap`);
    }
  }
  // Muster layout
  const m = bp.muster;
  const B = districtPolygon(c, "B");
  const order = ["a", "b", "c", "d", "e", "f", "g", "h"];
  if (m.fileMarkers.length !== 8) err(c, "file-markers", `expected 8 file markers, found ${m.fileMarkers.length}`);
  m.fileMarkers.forEach((f, i) => {
    if (f.file !== order[i]) err(c, "file-markers", `file marker ${i} is ${f.file}, expected ${order[i]}`);
    if (B && !pointInPolygon([f.pose.position[0], f.pose.position[2]], B)) err(c, "file-markers", `file marker ${f.file} lies outside the Muster Grounds`);
    if (!onGround(c, f.pose.position)) err(c, "file-markers", `file marker ${f.file} floats or is buried`);
    if (i > 0) {
      const p = m.fileMarkers[i - 1].pose.position;
      const d = dist2([p[0], p[2]], [f.pose.position[0], f.pose.position[2]]);
      if (d < 1.5) err(c, "file-markers", `file markers ${m.fileMarkers[i - 1].file}/${f.file} are ${d.toFixed(2)} m apart (< 1.5 m)`);
    }
  });
  if (B && !pointInPolygon([m.pawnStand.position[0], m.pawnStand.position[2]], B)) err(c, "pawn-stand", "pawn stand lies outside the Muster Grounds");
  if (!onGround(c, m.pawnStand.position)) err(c, "pawn-stand", "pawn stand floats or is buried");
  if (m.levySlots.length < 2) err(c, "levy-slots", "fewer than two levy slots");
  for (const s of m.levySlots) if (!onGround(c, s.position)) err(c, "levy-slots", "a levy slot floats or is buried");
  if (!buildingIds.has(m.platformBuildingId)) err(c, "muster-platform", `unknown platform ${m.platformBuildingId}`);
  // Ceremonial place and unfinished structure
  const cer = shapePolygon(bp.ceremonial.shape);
  for (const p of cer) if (!pointInPolygon(p, bp.settlementBoundary)) err(c, "ceremonial", "ceremonial place leaves the settlement");
  const A = districtPolygon(c, "A");
  if (A && !pointInPolygon(bp.ceremonial.centrepiece, A)) err(c, "ceremonial", "ceremonial place is not in district A");
  if (bp.slots.honourNiches.length < 4) err(c, "honour-niches", "fewer than four honour niches");
  for (const n of bp.slots.honourNiches) {
    const p: Vec2 = [n.position[0], n.position[2]];
    if (!pointInPolygon(p, cer) && distanceToPolyline(p, cer.concat([cer[0]])) > 1.5) err(c, "honour-niches", "an honour niche lies away from the ceremonial place");
  }
  const unfinished = bp.buildings.find((b) => b.id === bp.unfinished.buildingId);
  if (!unfinished || !unfinished.unfinished) err(c, "unfinished", "unfinished structure reference is missing or not marked unfinished");
  // State slots
  const zoneIds = new Set(bp.expansion.map((e) => e.id));
  const tiered = new Set<string>();
  for (const t of bp.slots.hallTiers) {
    for (const id of t.buildings) {
      tiered.add(id);
      const b = bp.buildings.find((x) => x.id === id);
      if (!b) err(c, "hall-tier", `hall tier ${t.tier} references unknown building ${id}`);
      else if (!(b.appearsAtHallTier === t.tier || (b.unfinished && b.unfinished.completesAtHallTier === t.tier)))
        err(c, "hall-tier", `${id} is listed at hall tier ${t.tier} but neither appears nor completes there`);
    }
    for (const id of t.expansionZones) if (!zoneIds.has(id)) err(c, "hall-tier", `hall tier ${t.tier} references unknown zone ${id}`);
  }
  for (const b of bp.buildings) if ((b.appearsAtHallTier !== undefined || b.unfinished) && !tiered.has(b.id)) err(c, "hall-tier", `${b.id} develops with the hall but no hall tier lists it`);
  if (bp.slots.recordMarkers.length < 6) err(c, "record-markers", "fewer than six record markers");
  if (bp.slots.noticeBoard.length < 3) err(c, "notice-board", "fewer than three notice positions");
  const mountIds = new Set<string>();
  for (const mt of bp.slots.bannerMounts) {
    if (mountIds.has(mt.id)) err(c, "banner-mount", `duplicate banner mount ${mt.id}`);
    mountIds.add(mt.id);
  }
  if (!bp.slots.bannerMounts.some((mt) => mt.heraldry === "player" && mt.minHallTier === 0)) err(c, "banner-mount", "no player heraldry is visible at hall tier 0");
}

function checkStoryAndLife(c: Ctx): void {
  const bp = c.bp;
  const known = new Set<string>();
  const add = (ids: readonly string[]) => ids.forEach((i) => known.add(i));
  add(bp.buildings.map((b) => b.id));
  add(bp.walls.map((w) => w.id));
  add(bp.towers.map((t) => t.id));
  add(bp.routes.map((r) => r.id));
  add(bp.gates.map((g) => g.id));
  add(bp.dressing.map((d) => d.id));
  add(bp.outer.places.map((p) => p.id));
  add(bp.outer.outposts.map((o) => o.id));
  add(bp.vegetation.map((v) => v.id));
  known.add(bp.ceremonial.id);
  const kinds = new Set(bp.story.map((s) => s.kind));
  for (const k of REQUIRED_STORY_KINDS) if (!kinds.has(k)) err(c, "story-missing", `storytelling location ${k} missing`);
  for (const s of bp.story) for (const r of s.refs) if (!known.has(r)) err(c, "story-ref", `${s.id} references unknown ${r}`);
  const roles = new Set(bp.npcs.map((n) => n.role));
  for (const r of REQUIRED_NPC_ROLES) if (!roles.has(r)) err(c, "npc-role", `no ${r} agent`);
  const siteIds = new Set(bp.activitySites.map((s) => s.id));
  const wallIds = new Set(bp.walls.map((w) => w.id));
  for (const n of bp.npcs) {
    if (n.route.length === 0) {
      err(c, "npc-route", `${n.id} has no route`);
      continue;
    }
    for (const p of n.route) if (!inExtents(c, p)) err(c, "npc-extents", `${n.id} leaves the terrain`);
    let cur = 0;
    for (const st of n.steps) {
      if (st.kind === "walk") {
        if (st.to < 0 || st.to >= n.route.length) err(c, "npc-step", `${n.id} walks to missing waypoint ${st.to}`);
        cur = st.to;
      } else if (!(st.seconds > 0)) err(c, "npc-step", `${n.id} holds for no time`);
    }
    const end = n.route[Math.max(0, Math.min(cur, n.route.length - 1))];
    if (dist2(end, n.route[0]) > 0.01) err(c, "npc-loop", `${n.id} schedule does not return to its first waypoint`);
    const compiled = compileSchedule(n);
    if (!(compiled.cycleSeconds > 0)) err(c, "npc-cycle", `${n.id} has an empty cycle`);
    if (n.heightMode === "wall-walk" && (!n.wallId || !wallIds.has(n.wallId))) err(c, "npc-wall", `${n.id} walks an unknown wall`);
    if (n.heightMode === "elevated" && (!n.routeDeckY || n.routeDeckY.length !== n.route.length)) err(c, "npc-deck", `${n.id} needs a deck height per waypoint`);
    if (n.formation && n.formation.length !== n.count) err(c, "npc-formation", `${n.id} formation does not match its count`);
    for (const s of n.activitySiteIds) if (!siteIds.has(s)) err(c, "npc-site", `${n.id} references unknown site ${s}`);
  }
  for (const s of bp.activitySites) if (!inExtents(c, [s.position[0], s.position[2]])) err(c, "site-extents", `${s.id} leaves the terrain`);
  for (const d of bp.dressing) {
    if (!inExtents(c, d.position)) err(c, "dressing-extents", `${d.id} leaves the terrain`);
    const y = c.T.height(d.position[0], d.position[1]) + 0.5;
    const hit = solidAt(c, d.position[0], y, d.position[1], [], true);
    if (hit) err(c, "dressing-solid", `${d.id} is inside ${hit}`);
  }
}

function checkOuterAndViews(c: Ctx): void {
  const bp = c.bp;
  const o = bp.outer;
  for (const p of o.places) {
    const q = polar(p.bearingDeg, p.distance);
    if (dist2(q, p.position) > 1) err(c, "place-position", `${p.id} position does not match its bearing and distance`);
  }
  const kinds = new Set(o.places.map((p) => p.kind));
  if (!kinds.has("capital")) err(c, "outer-capital", "no distant capital");
  if (!o.places.some((p) => p.kind === "neighbour-estate" || p.kind === "village")) err(c, "outer-neighbours", "no neighbouring estate or village");
  if (!o.places.some((p) => p.stateSlot === "allied-house")) err(c, "outer-allied", "no place carries the allied house");
  const others = (["korvenia", "solforiz", "aethelgard", "kwind-09"] as const).filter((n) => n !== bp.nationId);
  for (const n of others) {
    const fr = o.places.filter((p) => p.kind === "frontier" && p.frontierNation === n);
    if (fr.length !== 1) err(c, "outer-frontier", `expected one frontier toward ${n}, found ${fr.length}`);
    for (const p of fr) if (p.stateSlot !== "rival-house") err(c, "outer-frontier", `${p.id} must carry the rival-house slot`);
  }
  for (const p of o.places) if ((p.kind === "frontier") !== (p.frontierNation !== undefined)) err(c, "outer-frontier", `${p.id} frontier kind and frontierNation disagree`);
  const capital = o.places.find((p) => p.kind === "capital");
  if (capital && capital.distance < 5000) err(c, "outer-capital", "the capital should be distant (≥ 5 km)");
  if (o.outposts.length < 2) err(c, "outer-outposts", "fewer than two outposts");
  if (o.fields.length < 2) err(c, "outer-fields", "fewer than two fields");
  if (!o.territories.some((t) => t.owner === "holding")) err(c, "outer-territory", "no territory belongs to the holding");
  for (const f of o.fields) for (const p of f.polygon) if (!inExtents(c, p)) err(c, "field-extents", `${f.id} leaves the terrain`);
  // View corridors stay clear of solids other than their framing elements.
  for (const v of bp.viewCorridors) {
    const dx = v.to[0] - v.from[0];
    const dy = v.to[1] - v.from[1];
    const dz = v.to[2] - v.from[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.ceil(Math.min(len, 400) / 0.75);
    for (let i = 1; i < steps; i++) {
      const t = (i * 0.75) / len;
      const x = v.from[0] + dx * t;
      const y = v.from[1] + dy * t;
      const z = v.from[2] + dz * t;
      if (!inExtents(c, [x, z])) break;
      if (y < c.T.height(x, z) + 0.2) {
        err(c, "corridor-terrain", `${v.id} is blocked by terrain at [${x.toFixed(1)}, ${z.toFixed(1)}]`);
        break;
      }
      const hit = solidAt(c, x, y, z, v.allow);
      if (hit) {
        err(c, "corridor-blocked", `${v.id} is blocked by ${hit} at [${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}]`);
        break;
      }
    }
  }
  for (const e of bp.expansion) {
    if (e.polygon.length < 3) err(c, "expansion-polygon", `${e.id} has no polygon`);
    for (const p of e.polygon) if (!inExtents(c, p)) err(c, "expansion-extents", `${e.id} leaves the terrain`);
    for (const b of bp.buildings) {
      if (b.appearsAtHallTier !== undefined) continue;
      for (const m of b.masses) {
        const pen = convexPenetration(e.polygon, massPolygon(m));
        if (pen > 0.05) err(c, "expansion-occupied", `${e.id} overlaps existing building ${b.id}`);
      }
    }
  }
}

function orbitPosition(cam: CameraFraming, yawDeg: number, pitchDeg: number, distance: number): Vec3 {
  const dx = cam.position[0] - cam.target[0];
  const dz = cam.position[2] - cam.target[2];
  const bearing = vectorBearing(dx, dz) + yawDeg;
  const h = distance * Math.cos((pitchDeg * Math.PI) / 180);
  const p = polar(bearing, h, [cam.target[0], cam.target[2]]);
  return [p[0], cam.target[1] + distance * Math.sin((pitchDeg * Math.PI) / 180), p[1]];
}

/** Narrowest window the desktop framings must hold their subject in (landscape, 3:2). */
const SUBJECT_ASPECT = 1.5;

/** Whether a world point falls inside a camera's view at SUBJECT_ASPECT, in front of it, with a margin. */
function inFrame(cam: CameraFraming, p: Vec3, margin = 0.92): boolean {
  const fx = cam.target[0] - cam.position[0];
  const fy = cam.target[1] - cam.position[1];
  const fz = cam.target[2] - cam.position[2];
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  const f0 = fx / fl, f1 = fy / fl, f2 = fz / fl;
  let rx = -f2;
  let rz = f0;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  rx /= rl;
  rz /= rl;
  const u0 = -rz * f1, u1 = rz * f0 - rx * f2, u2 = rx * f1;
  const d0 = p[0] - cam.position[0], d1 = p[1] - cam.position[1], d2 = p[2] - cam.position[2];
  const z = d0 * f0 + d1 * f1 + d2 * f2;
  if (z <= 0.3) return false;
  const x = d0 * rx + d2 * rz;
  const y = d0 * u0 + d1 * u1 + d2 * u2;
  const tv = Math.tan((cam.fovDeg * Math.PI) / 360);
  return Math.abs(x / z) <= tv * SUBJECT_ASPECT * margin && Math.abs(y / z) <= tv * margin;
}

function checkCameras(c: Ctx): void {
  const bp = c.bp;
  const ids = bp.cameras.map((x) => x.id);
  const required = ["establishing", "founding", "representative"].concat(LEGACY_LANDMARKS.map((l) => `landmark:${l}`));
  for (const id of required) if (ids.indexOf(id as CameraFraming["id"]) < 0) err(c, "camera-missing", `camera ${id} missing`);
  for (const cam of bp.cameras) {
    if (!(cam.fovDeg >= 20 && cam.fovDeg <= 75)) err(c, "camera-fov", `${cam.id} fov ${cam.fovDeg}° outside 20–75°`);
    const o = cam.orbit;
    if (o.yawDeg[0] > o.yawDeg[1] || o.pitchDeg[0] > o.pitchDeg[1] || o.distance[0] > o.distance[1]) err(c, "camera-orbit", `${cam.id} orbit ranges are inverted`);
    if (o.yawDeg[0] > 0 || o.yawDeg[1] < 0) err(c, "camera-orbit", `${cam.id} yaw range excludes the authored framing`);
    if (!inExtents(c, [cam.target[0], cam.target[2]])) err(c, "camera-target", `${cam.id} target leaves the terrain`);
    if (cam.target[1] < c.T.height(cam.target[0], cam.target[2]) - 0.5) err(c, "camera-target", `${cam.id} target is underground`);
    const dx = cam.position[0] - cam.target[0];
    const dy = cam.position[1] - cam.target[1];
    const dz = cam.position[2] - cam.target[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const pitch = (Math.asin(dy / dist) * 180) / Math.PI;
    if (dist < o.distance[0] - 0.5 || dist > o.distance[1] + 0.5) err(c, "camera-distance", `${cam.id} authored distance ${dist.toFixed(1)} m is outside its orbit range`);
    if (pitch < o.pitchDeg[0] - 1 || pitch > o.pitchDeg[1] + 1) err(c, "camera-pitch", `${cam.id} authored pitch ${pitch.toFixed(1)}° is outside its orbit range`);
    const probes: { label: string; p: Vec3 }[] = [{ label: "authored", p: cam.position }];
    for (const yaw of [o.yawDeg[0], 0, o.yawDeg[1]])
      for (const pt of [o.pitchDeg[0], o.pitchDeg[1]])
        for (const d of [o.distance[0], o.distance[1]]) probes.push({ label: `orbit(${yaw},${pt},${d})`, p: orbitPosition(cam, yaw, pt, d) });
    for (const pr of probes) {
      const p = pr.p;
      if (inExtents(c, [p[0], p[2]]) && p[1] < c.T.height(p[0], p[2]) + 1.0) err(c, "camera-clearance", `${cam.id} ${pr.label} position is within 1 m of the ground`);
      const hit = solidAt(c, p[0], p[1], p[2], []);
      if (hit) err(c, "camera-inside", `${cam.id} ${pr.label} position is inside ${hit}`);
    }
    // Line of sight from the authored position to the target (the last 3 m may touch the subject).
    const steps = Math.ceil(dist / 0.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (dist * (1 - t) < 3) break;
      const x = cam.position[0] - dx * t;
      const y = cam.position[1] - dy * t;
      const z = cam.position[2] - dz * t;
      if (inExtents(c, [x, z]) && y < c.T.height(x, z) + 0.2) {
        err(c, "camera-occluded", `${cam.id} line of sight hits terrain`);
        break;
      }
      const hit = solidAt(c, x, y, z, []);
      if (hit) {
        err(c, "camera-occluded", `${cam.id} line of sight is blocked by ${hit}`);
        break;
      }
    }
  }
  for (const l of bp.landmarks) {
    const cam = bp.cameras.find((x) => x.id === l.cameraId);
    if (!cam) continue;
    const dx = cam.target[0] - l.pickCenter[0];
    const dy = cam.target[1] - l.pickCenter[1];
    const dz = cam.target[2] - l.pickCenter[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > l.pickRadius + 8) err(c, "camera-subject", `${cam.id} does not look at ${l.id}`);
    if (!inFrame(cam, l.anchor)) err(c, "camera-subject", `${cam.id} leaves the ${l.id} label anchor out of frame`);
  }
  const rep = bp.cameras.find((x) => x.id === "representative");
  const stand = bp.muster.pawnStand.position;
  if (rep && dist2([rep.target[0], rep.target[2]], [stand[0], stand[2]]) > 2.5) err(c, "camera-subject", "representative camera does not look at the pawn stand");
  if (rep && !inFrame(rep, [stand[0], stand[1] + 1, stand[2]])) err(c, "camera-subject", "representative camera leaves the pawn stand out of frame");
  const founding = bp.cameras.find((x) => x.id === "founding");
  const fs = bp.slots.foundingStandard.position;
  if (founding && dist2([founding.target[0], founding.target[2]], [fs[0], fs[2]]) > 25) err(c, "camera-subject", "founding camera does not frame the founding standard");
  if (founding && !inFrame(founding, [fs[0], fs[1] + 3.5, fs[2]])) err(c, "camera-subject", "founding camera leaves the founding standard's cloth out of frame");
  const estCam = bp.cameras.find((x) => x.id === "establishing");
  if (estCam && !pointInPolygon([estCam.target[0], estCam.target[2]], bp.settlementBoundary)) err(c, "camera-subject", "establishing camera target lies outside the holding");
  const est = bp.cameras.find((x) => x.id === "establishing");
  if (est && dist2([est.position[0], est.position[2]], [bp.observation.position[0], bp.observation.position[2]]) > 0.01)
    err(c, "observation", "the initial observation position must match the establishing camera");
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function checkVrAndAtmosphere(c: Ctx): void {
  const bp = c.bp;
  const vr = bp.vr;
  if (!(vr.displayScale >= 1 / 250 && vr.displayScale <= 1 / 60)) err(c, "vr-scale", `display scale 1:${(1 / vr.displayScale).toFixed(0)} outside 1:60–1:250`);
  const w = vr.detailExtent.width * vr.displayScale;
  const d = vr.detailExtent.depth * vr.displayScale;
  if (w > 1.4 || d > 1.2) err(c, "vr-footprint", `miniature ${w.toFixed(2)} × ${d.toFixed(2)} m exceeds 1.4 × 1.2 m`);
  let top = -Infinity;
  for (const b of bp.buildings) {
    const f = c.floors.get(b.id);
    if (!f || b.district === "G") continue;
    top = Math.max(top, buildingTopY({ floorY: f.floorY, groundMin: f.groundMin, groundMax: f.floorY, relief: 0 }, b));
  }
  for (const posture of [vr.seated, vr.standing]) {
    const near = posture.viewerDistance - d / 2;
    if (near < 0.2) err(c, "vr-near-edge", `near table edge only ${near.toFixed(2)} m from the viewer`);
    const drop = posture.eyeHeight - posture.surfaceHeight;
    if (drop < 0.3) err(c, "vr-eye-drop", `eyes only ${drop.toFixed(2)} m above the miniature surface`);
    const towerTop = posture.surfaceHeight + (top - vr.datumY) * vr.displayScale;
    if (towerTop > posture.eyeHeight - 0.05) err(c, "vr-eyeline", `tallest structure (${towerTop.toFixed(2)} m) blocks the eyeline (${posture.eyeHeight} m)`);
    for (const l of bp.landmarks) {
      const lx = (l.pickCenter[0] - vr.displayCenter[0]) * vr.displayScale;
      const lz = (l.pickCenter[2] - vr.displayCenter[1]) * vr.displayScale;
      const ly = (l.pickCenter[1] - vr.datumY) * vr.displayScale + posture.surfaceHeight - posture.eyeHeight;
      const reach = Math.sqrt(lx * lx + (posture.viewerDistance + Math.abs(lz)) ** 2 + ly * ly);
      if (reach > vr.reach.rayMax) err(c, "vr-reach", `${l.id} lies beyond ray reach (${reach.toFixed(2)} m)`);
    }
  }
  if (!(vr.reach.pokeMax > 0.3 && vr.reach.pokeMax < 0.9)) err(c, "vr-reach", "poke reach should be an arm's length (0.3–0.9 m)");
  if (vr.rotation.yawLimitDeg < 0 || vr.rotation.yawLimitDeg > 180) err(c, "vr-rotation", "yaw limit outside 0–180°");
  const a = bp.atmosphere;
  const colours = [a.sun.colour, a.sky.zenith, a.sky.horizon, a.sky.ground, a.fog.colour].concat(a.accentLights.map((l) => l.colour));
  for (const k of Object.keys(a.palette)) colours.push(a.palette[k]);
  for (const col of colours) if (!HEX.test(col)) err(c, "atmosphere-colour", `colour ${col} is not #rrggbb`);
  if (!(a.sun.elevationDeg > 0 && a.sun.elevationDeg < 90)) err(c, "atmosphere-sun", "sun elevation outside 0–90°");
  if (!(a.fog.far > a.fog.near)) err(c, "atmosphere-fog", "fog far must exceed near");
  if (a.wind.speed < 0) err(c, "atmosphere-wind", "negative wind speed");
}

/** Validate one blueprint. Returns every issue found (errors and warnings). */
export function validateBlueprint(bp: BannerholdBlueprint): BlueprintIssue[] {
  const c: Ctx = { bp, T: createTerrainSampler(bp.terrain), issues: [], floors: new Map() };
  checkFinite(c, bp, "blueprint");
  checkIdsAndScale(c);
  checkBuildings(c);
  checkFortifications(c);
  checkRoutes(c);
  checkLandmarksAndSlots(c);
  checkStoryAndLife(c);
  checkCirculationAndHabitation(c);
  checkOuterAndViews(c);
  checkCameras(c);
  checkVrAndAtmosphere(c);
  if (polylineLength(bp.settlementBoundary.concat([bp.settlementBoundary[0]])) < 200) warn(c, "boundary-small", "settlement boundary is unusually small");
  return c.issues;
}

/** Errors only, formatted one per line (empty string when valid). */
export function formatBlueprintErrors(issues: readonly BlueprintIssue[]): string {
  return issues
    .filter((i) => i.severity === "error")
    .map((i) => `[${i.code}] ${i.message}`)
    .join("\n");
}
