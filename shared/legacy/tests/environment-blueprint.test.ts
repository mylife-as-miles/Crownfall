// Bannerhold spatial blueprint: the single layout source both renderers, the map generator and
// these tests read. Run: cd main-game-vr && npx tsx --test ../shared/legacy/tests/environment-*.test.ts
// (or `npm run test:legacy` from the repository root).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEGACY_LANDMARKS } from "../environment-contract";
import {
  BANNERHOLD_BLUEPRINTS,
  BLUEPRINT_COORDINATES,
  NATION_KIT_PREFIX,
  PRODUCTION_DEFAULT_NATION,
  REQUIRED_NPC_ROLES,
  REQUIRED_STORY_KINDS,
  bearingOfYaw,
  bearingVector,
  buildingTopY,
  compileSchedule,
  convexPenetration,
  createAgentPose,
  createTerrainSampler,
  distanceToPolyline,
  formatBlueprintErrors,
  getBannerholdBlueprint,
  landmarkDescriptors,
  massPolygon,
  pointInPolygon,
  polar,
  resolveBuildingBase,
  rotateLocal,
  sampleAgent,
  toLocal,
  validateBlueprint,
  vectorBearing,
  yawFacingBearing,
} from "../environment/blueprint";
import type { BannerholdBlueprint, BlueprintIssue, Route, Vec2 } from "../environment/blueprint";
import type { NationId } from "../types";

const NATIONS: readonly NationId[] = ["korvenia", "solforiz", "aethelgard", "kwind-09"];
const HERE = dirname(fileURLToPath(import.meta.url));
const ENVIRONMENT_DIR = join(HERE, "..", "environment");

function blueprintOf(nation: NationId): BannerholdBlueprint {
  const bp = BANNERHOLD_BLUEPRINTS[nation];
  assert.ok(bp, `${nation} has a blueprint`);
  return bp;
}

const issueCache = new Map<NationId, BlueprintIssue[]>();
function issuesOf(nation: NationId): BlueprintIssue[] {
  let issues = issueCache.get(nation);
  if (!issues) {
    issues = validateBlueprint(blueprintOf(nation));
    issueCache.set(nation, issues);
  }
  return issues;
}

function errorCodes(nation: NationId, prefix: string): string {
  return formatBlueprintErrors(issuesOf(nation).filter((i) => i.code.startsWith(prefix)));
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

test("the registry holds a layout for each of the four nations, with Korvenia as the reversible production default", () => {
  assert.equal(PRODUCTION_DEFAULT_NATION, "korvenia");
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    assert.equal(bp.nationId, nation);
    assert.equal(bp.schema, 1);
    assert.equal(getBannerholdBlueprint(nation), bp);
    assert.equal(bp.status, nation === PRODUCTION_DEFAULT_NATION ? "production-default" : "first-pass");
    assert.ok(bp.summary.length > 120 && bp.siteName.length > 0, `${nation} documents its layout`);
  }
  assert.deepEqual(Object.keys(BANNERHOLD_BLUEPRINTS).sort(), [...NATIONS].sort());
});

test("every nation layout validates without errors", () => {
  for (const nation of NATIONS) {
    const issues = issuesOf(nation);
    const errors = issues.filter((i) => i.severity === "error");
    assert.equal(errors.length, 0, `${nation}:\n${formatBlueprintErrors(issues)}`);
  }
});

test("one coordinate system: right-handed, Y-up metres, north is -Z and yaw follows three.js", () => {
  assert.equal(BLUEPRINT_COORDINATES.handedness, "right-handed");
  assert.equal(BLUEPRINT_COORDINATES.up, "+Y");
  assert.equal(BLUEPRINT_COORDINATES.units, "metres");
  assert.equal(BLUEPRINT_COORDINATES.north, "-Z");
  assert.equal(BLUEPRINT_COORDINATES.east, "+X");
  const n = bearingVector(0);
  const e = bearingVector(90);
  assert.ok(near(n[0], 0) && near(n[1], -1), "bearing 0 points to -Z");
  assert.ok(near(e[0], 1) && near(e[1], 0), "bearing 90 points to +X");
  assert.ok(near(vectorBearing(0, 1), 180), "+Z is south");
  assert.equal(yawFacingBearing(180), 0, "an unrotated front faces south");
  for (const b of [0, 37, 90, 145, 180, 233, 270, 359]) assert.ok(near(bearingOfYaw(yawFacingBearing(b)), b, 1e-6), `yaw round-trips bearing ${b}`);
  const local = toLocal(rotateLocal(3, -7, 41) as Vec2, [0, 0], 41);
  assert.ok(near(local[0], 3, 1e-9) && near(local[1], -7, 1e-9), "toLocal inverts rotateLocal");
  const p = polar(90, 100);
  assert.ok(near(p[0], 100) && near(p[1], 0));
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const e2 = bp.terrain.extents;
    assert.ok(e2.minX < 0 && e2.maxX > 0 && e2.minZ < 0 && e2.maxZ > 0, `${nation} terrain surrounds the datum`);
    assert.ok(pointInPolygon([0, 0], bp.settlementBoundary) || distanceToPolyline([0, 0], bp.settlementBoundary.concat([bp.settlementBoundary[0]])) < 30, `${nation} datum lies in or beside the holding`);
  }
});

test("building footprints never overlap unless the overlap is declared", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const declared = (a: { allowOverlapWith?: readonly string[] }, id: string) => (a.allowOverlapWith ?? []).indexOf(id) >= 0;
    for (let i = 0; i < bp.buildings.length; i++) {
      for (let j = i + 1; j < bp.buildings.length; j++) {
        const a = bp.buildings[i];
        const b = bp.buildings[j];
        if (declared(a, b.id) || declared(b, a.id)) continue;
        for (const ma of a.masses) {
          for (const mb of b.masses) {
            const pen = convexPenetration(massPolygon(ma), massPolygon(mb));
            assert.ok(pen <= 0.05, `${nation}: ${a.id}/${ma.id} overlaps ${b.id}/${mb.id} by ${pen.toFixed(2)} m`);
          }
        }
      }
    }
    assert.equal(errorCodes(nation, "building-wall") + errorCodes(nation, "building-tower") + errorCodes(nation, "building-route"), "", `${nation} buildings clear walls, towers and routes`);
  }
});

test("every building sits on its terrain: inside the extents, the holding and its district, on plausible ground, out of the water", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const T = createTerrainSampler(bp.terrain);
    const e = bp.terrain.extents;
    const districts = new Map(bp.districts.map((d) => [d.id, d.polygon] as const));
    for (const b of bp.buildings) {
      const base = resolveBuildingBase(T, b);
      assert.ok(base.relief <= b.foundation.maxRelief + 1e-6, `${nation}: ${b.id} stands on ${base.relief.toFixed(2)} m relief (${b.foundation.kind} allows ${b.foundation.maxRelief} m)`);
      assert.ok(base.floorY >= base.groundMax - 0.05, `${nation}: ${b.id} floor is not buried`);
      assert.ok(buildingTopY(base, b) > base.floorY, `${nation}: ${b.id} has height`);
      for (const m of b.masses) {
        assert.ok(m.ridgeHeight >= m.eaveHeight && m.eaveHeight > 0, `${nation}: ${b.id}/${m.id} eave and ridge are ordered`);
        for (const p of massPolygon(m)) {
          assert.ok(p[0] >= e.minX && p[0] <= e.maxX && p[1] >= e.minZ && p[1] <= e.maxZ, `${nation}: ${b.id} stays on the modelled terrain`);
          if (b.district !== "G") assert.ok(pointInPolygon(p, bp.settlementBoundary), `${nation}: ${b.id}/${m.id} stays inside the settlement boundary`);
        }
      }
      if (b.district !== "G") {
        const poly = districts.get(b.district);
        assert.ok(poly && pointInPolygon(b.masses[0].center, poly), `${nation}: ${b.id} lies in district ${b.district}`);
      }
      assert.ok(b.name.trim() && b.story.trim(), `${nation}: ${b.id} has a name and a story`);
      assert.equal(b.kit.split(".")[0], NATION_KIT_PREFIX[nation], `${nation}: ${b.id} uses the nation's kit prefix`);
    }
    assert.equal(errorCodes(nation, "building-water") + errorCodes(nation, "foundation"), "", `${nation} foundations and water`);
    for (const id of ["A", "B", "C", "D", "E", "F"] as const) assert.ok(districts.has(id), `${nation} defines district ${id}`);
  }
});

/** Route junctions: an endpoint of one route lies on the other (stairs and ramps join any grade). */
function connectedRoutes(bp: BannerholdBlueprint, startId: string): Set<string> {
  const joins = (a: Route, b: Route) => a.grade === b.grade || a.kind === "stair" || a.kind === "ramp" || b.kind === "stair" || b.kind === "ramp";
  const touches = (a: Route, b: Route) => {
    const tol = Math.max(a.width, b.width) / 2 + 0.75;
    return [a.points[0], a.points[a.points.length - 1]].some((p) => distanceToPolyline(p, b.points) <= tol);
  };
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift() as string;
    const a = bp.routes.find((r) => r.id === id) as Route;
    for (const b of bp.routes) {
      if (seen.has(b.id) || !joins(a, b)) continue;
      if (touches(a, b) || touches(b, a)) {
        seen.add(b.id);
        queue.push(b.id);
      }
    }
  }
  return seen;
}

test("roads connect the main gate to the manor, muster grounds, quarters, workshops, archive and herald", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const gates = bp.gates.filter((g) => g.kind === "main-gate");
    assert.equal(gates.length, 1, `${nation} has one main gate`);
    const road = bp.routes.find((r) => r.id === gates[0].routeId);
    assert.ok(road && road.hierarchy === "national" && road.outer, `${nation}: the main gate opens onto the national road`);
    const reach = Math.max(...road.points.map((p) => Math.hypot(p[0], p[1])));
    assert.ok(reach >= 5000, `${nation}: the national road leaves toward the greater nation (${reach.toFixed(0)} m)`);
    const network = connectedRoutes(bp, road.id);
    for (const r of bp.routes) assert.ok(network.has(r.id), `${nation}: ${r.id} joins the gate network`);
    for (const id of ["gate", "manor", "muster", "residential", "artisan", "archive", "herald"] as const) {
      const d = bp.destinations.find((x) => x.id === id);
      assert.ok(d, `${nation}: destination ${id}`);
      const reached = bp.routes.some((r) => network.has(r.id) && distanceToPolyline(d.position, r.points) <= r.width / 2 + 6);
      assert.ok(reached, `${nation}: ${id} (${d.label}) is reached from the gate`);
    }
    assert.equal(errorCodes(nation, "route") + errorCodes(nation, "entrance"), "", `${nation} routes and entrances`);
  }
});

test("landmarks: the four contract landmarks with valid, separate pick volumes reachable on desktop and in VR", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const T = createTerrainSampler(bp.terrain);
    assert.deepEqual(bp.landmarks.map((l) => l.id).sort(), [...LEGACY_LANDMARKS].sort(), `${nation} landmarks`);
    const descriptors = landmarkDescriptors(bp);
    assert.equal(descriptors.length, LEGACY_LANDMARKS.length);
    for (const l of bp.landmarks) {
      assert.ok(l.pickRadius >= 3 && l.pickRadius <= 25, `${nation}: ${l.id} pick radius ${l.pickRadius} m`);
      assert.ok(l.pickRadius * bp.vr.displayScale >= bp.vr.reach.minTargetRadius, `${nation}: ${l.id} is a large enough VR target`);
      assert.ok(l.anchor[1] > T.height(l.anchor[0], l.anchor[2]), `${nation}: ${l.id} label anchor is above ground`);
      assert.ok(l.label.length > 0 && l.buildingIds.length > 0);
      assert.ok(bp.buildings.some((b) => b.landmark === l.id && l.buildingIds.indexOf(b.id) >= 0), `${nation}: a building carries ${l.id}`);
      const d = descriptors.find((x) => x.id === l.id);
      assert.ok(d && d.position === l.anchor, `${nation}: ${l.id} descriptor publishes its anchor`);
      assert.ok(bp.cameras.some((c) => c.id === l.cameraId), `${nation}: ${l.id} has its framing`);
    }
    for (let i = 0; i < bp.landmarks.length; i++) {
      for (let j = i + 1; j < bp.landmarks.length; j++) {
        const a = bp.landmarks[i];
        const b = bp.landmarks[j];
        const dist = Math.hypot(a.pickCenter[0] - b.pickCenter[0], a.pickCenter[1] - b.pickCenter[1], a.pickCenter[2] - b.pickCenter[2]);
        assert.ok(dist >= a.pickRadius + b.pickRadius, `${nation}: ${a.id} and ${b.id} pick volumes stay apart`);
      }
    }
  }
});

test("the muster line: eight file markers a–h in order on the Muster Grounds, the nominated Pawn's stand and levy places beside them", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const T = createTerrainSampler(bp.terrain);
    const B = bp.districts.find((d) => d.id === "B");
    assert.ok(B);
    const m = bp.muster;
    assert.deepEqual(m.fileMarkers.map((f) => f.file), ["a", "b", "c", "d", "e", "f", "g", "h"], `${nation} file order`);
    const onGround = (p: readonly [number, number, number]) => Math.abs(p[1] - T.height(p[0], p[2])) <= 0.6;
    for (const f of m.fileMarkers) {
      assert.ok(pointInPolygon([f.pose.position[0], f.pose.position[2]], B.polygon), `${nation}: file ${f.file} lies on the Muster Grounds`);
      assert.ok(onGround(f.pose.position), `${nation}: file ${f.file} stands on the ground`);
    }
    for (let i = 1; i < 8; i++) {
      const a = m.fileMarkers[i - 1].pose.position;
      const b = m.fileMarkers[i].pose.position;
      assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) >= 1.5, `${nation}: files ${m.fileMarkers[i - 1].file}/${m.fileMarkers[i].file} are spaced`);
    }
    assert.ok(pointInPolygon([m.pawnStand.position[0], m.pawnStand.position[2]], B.polygon) && onGround(m.pawnStand.position), `${nation}: the Pawn's stand`);
    const nearestFile = Math.min(...m.fileMarkers.map((f) => Math.hypot(f.pose.position[0] - m.pawnStand.position[0], f.pose.position[2] - m.pawnStand.position[2])));
    assert.ok(nearestFile <= 6, `${nation}: the Pawn stands with the file line`);
    assert.ok(m.levySlots.length >= 2 && m.levySlots.every((s) => onGround(s.position)), `${nation}: levy places`);
    assert.ok(bp.buildings.some((b) => b.id === m.platformBuildingId && b.function === "muster-platform"), `${nation}: muster platform`);
    const captive = bp.slots.captiveMarker.position;
    assert.ok(Math.hypot(captive[0] - m.pawnStand.position[0], captive[2] - m.pawnStand.position[2]) <= 3, `${nation}: the captive marker sits at the empty stand`);
  }
});

test("cameras look at valid targets: every required framing, clear of terrain and buildings, the establishing view is the observation point", () => {
  const required = ["establishing", "founding", "representative", ...LEGACY_LANDMARKS.map((l) => `landmark:${l}`)];
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const T = createTerrainSampler(bp.terrain);
    assert.deepEqual(bp.cameras.map((c) => c.id as string).sort(), [...required].sort(), `${nation} framings`);
    for (const cam of bp.cameras) {
      const e = bp.terrain.extents;
      assert.ok(cam.target[0] >= e.minX && cam.target[0] <= e.maxX && cam.target[2] >= e.minZ && cam.target[2] <= e.maxZ, `${nation}: ${cam.id} target is on the terrain`);
      assert.ok(cam.target[1] >= T.height(cam.target[0], cam.target[2]) - 0.5, `${nation}: ${cam.id} target is not underground`);
      assert.ok(cam.fovDeg >= 20 && cam.fovDeg <= 75, `${nation}: ${cam.id} field of view`);
      assert.ok(cam.orbit.yawDeg[0] <= 0 && cam.orbit.yawDeg[1] >= 0, `${nation}: ${cam.id} orbit contains its framing`);
      assert.ok(cam.composition.length > 40, `${nation}: ${cam.id} documents its composition`);
    }
    const est = bp.cameras.find((c) => c.id === "establishing");
    assert.ok(est && est.position === bp.observation.position, `${nation}: initial observation position`);
    assert.ok(pointInPolygon([est.target[0], est.target[2]], bp.settlementBoundary), `${nation}: the establishing view looks at the holding`);
    assert.equal(errorCodes(nation, "camera") + errorCodes(nation, "observation"), "", `${nation} camera checks`);
  }
});

test("life: deterministic schedules loop seamlessly, sample without allocating and cover the required roles", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const roles = new Set(bp.npcs.map((n) => n.role));
    for (const role of REQUIRED_NPC_ROLES) assert.ok(roles.has(role), `${nation}: a ${role} agent`);
    const pose = createAgentPose();
    for (const npc of bp.npcs) {
      const c = compileSchedule(npc);
      assert.ok(c.cycleSeconds > 0, `${nation}: ${npc.id} has a cycle`);
      const start = sampleAgent(c, -npc.phaseSeconds, pose);
      assert.equal(start, pose, "sampling reuses the caller's pose object");
      const x0 = start.x;
      const z0 = start.z;
      sampleAgent(c, c.cycleSeconds - npc.phaseSeconds - 1e-4, pose);
      assert.ok(Math.hypot(pose.x - x0, pose.z - z0) < 0.01, `${nation}: ${npc.id} loops back to its first waypoint`);
      sampleAgent(c, 1234.5, pose);
      const x1 = pose.x;
      const z1 = pose.z;
      sampleAgent(c, 1234.5, createAgentPose());
      sampleAgent(c, 1234.5, pose);
      assert.ok(pose.x === x1 && pose.z === z1, `${nation}: ${npc.id} samples deterministically`);
      assert.ok(npc.lod.fullRateWithin <= npc.lod.reducedRateWithin && npc.lod.reducedRateWithin <= npc.lod.hiddenBeyond, `${nation}: ${npc.id} distance-based update rates`);
    }
    assert.equal(errorCodes(nation, "npc"), "", `${nation} schedules`);
  }
});

test("the holding tells its story: repaired watchtower, weathered walls, unfinished structure, ceremonial place, empty stand, merchant road, levy yard below noble architecture", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const kinds = new Set(bp.story.map((s) => s.kind));
    for (const k of REQUIRED_STORY_KINDS) assert.ok(kinds.has(k), `${nation}: storytelling location ${k}`);
    const watch = bp.towers.filter((t) => t.storyRole === "repaired-watchtower");
    assert.equal(watch.length, 1, `${nation}: one repaired watchtower`);
    assert.ok(watch[0].repairs.length > 0, `${nation}: its repairs are recorded`);
    assert.ok(bp.walls.some((w) => w.segments.some((s) => s.condition === "weathered" || s.condition === "damaged" || s.condition === "ruinous")), `${nation}: weathered fortifications`);
    const unfinished = bp.buildings.find((b) => b.id === bp.unfinished.buildingId);
    assert.ok(unfinished && unfinished.unfinished && unfinished.age.condition === "under-construction", `${nation}: the unfinished structure`);
    const A = bp.districts.find((d) => d.id === "A");
    assert.ok(A && pointInPolygon(bp.ceremonial.centrepiece, A.polygon), `${nation}: the ceremonial place belongs to the manor`);
    assert.ok(bp.slots.honourNiches.length >= 4, `${nation}: honour places wait to be filled`);
    const qualities = new Set(bp.buildings.filter((b) => b.district !== "G").map((b) => b.quality));
    assert.ok(qualities.has("poor") && (qualities.has("noble") || qualities.has("fine")), `${nation}: class differences are built in`);
    assert.equal(errorCodes(nation, "story") + errorCodes(nation, "residential") + errorCodes(nation, "class"), "", `${nation} story and habitation`);
  }
});

test("the greater nation: a distant unnamed capital, the allied seat, a frontier toward every other nation, neighbours, outposts and fields", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const o = bp.outer;
    const capitals = o.places.filter((p) => p.kind === "capital");
    assert.equal(capitals.length, 1, `${nation}: one capital`);
    assert.equal(capitals[0].name, "The capital", `${nation}: the capital stays unnamed`);
    assert.ok(capitals[0].distance >= 5000, `${nation}: the capital is distant`);
    assert.ok(o.places.some((p) => p.stateSlot === "allied-house" && p.kind === "allied-seat"), `${nation}: the allied Great House's seat`);
    for (const other of NATIONS.filter((x) => x !== nation)) {
      const fr = o.places.filter((p) => p.kind === "frontier" && p.frontierNation === other);
      assert.equal(fr.length, 1, `${nation}: one frontier toward ${other}`);
      assert.equal(fr[0].stateSlot, "rival-house", `${nation}: the ${other} frontier can carry the rival house`);
    }
    for (const p of o.places) {
      const q = polar(p.bearingDeg, p.distance);
      assert.ok(Math.hypot(q[0] - p.position[0], q[1] - p.position[1]) <= 1, `${nation}: ${p.id} position matches its bearing and distance`);
    }
    assert.ok(o.places.some((p) => p.kind === "neighbour-estate"), `${nation}: a neighbouring estate`);
    assert.ok(o.outposts.length >= 2 && o.fields.length >= 2, `${nation}: outposts and fields`);
    assert.ok(o.territories.some((t) => t.owner === "holding") && o.territories.some((t) => t.owner !== "holding"), `${nation}: the holding among other territories`);
    assert.ok(o.skyline.length >= 3, `${nation}: a layered skyline`);
    assert.ok(bp.viewCorridors.some((v) => v.id.endsWith("-capital")), `${nation}: a view corridor toward the capital`);
    assert.equal(errorCodes(nation, "outer") + errorCodes(nation, "corridor") + errorCodes(nation, "place"), "", `${nation} outer territory`);
  }
});

test("VR staging: a table-sized miniature that keeps the eyeline clear and every landmark within reach, seated and standing", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const vr = bp.vr;
    const T = createTerrainSampler(bp.terrain);
    assert.ok(vr.displayScale >= 1 / 250 && vr.displayScale <= 1 / 60, `${nation}: display scale`);
    const w = vr.detailExtent.width * vr.displayScale;
    const d = vr.detailExtent.depth * vr.displayScale;
    assert.ok(w <= 1.4 && d <= 1.2 && w >= 0.6 && d >= 0.6, `${nation}: miniature ${w.toFixed(2)} × ${d.toFixed(2)} m`);
    let top = -Infinity;
    for (const b of bp.buildings) if (b.district !== "G" && b.appearsAtHallTier === undefined) top = Math.max(top, buildingTopY(resolveBuildingBase(T, b), b));
    for (const posture of [vr.seated, vr.standing]) {
      assert.ok(posture.viewerDistance - d / 2 >= 0.2, `${nation}: near edge clears the head`);
      assert.ok(posture.surfaceHeight + (top - vr.datumY) * vr.displayScale < posture.eyeHeight - 0.05, `${nation}: tallest structure stays below the eyes`);
      for (const l of bp.landmarks) {
        const lx = (l.pickCenter[0] - vr.displayCenter[0]) * vr.displayScale;
        const lz = (l.pickCenter[2] - vr.displayCenter[1]) * vr.displayScale;
        const ly = (l.pickCenter[1] - vr.datumY) * vr.displayScale + posture.surfaceHeight - posture.eyeHeight;
        assert.ok(Math.hypot(lx, posture.viewerDistance + Math.abs(lz), ly) <= vr.reach.rayMax, `${nation}: ${l.id} within ray reach`);
      }
    }
    assert.ok(vr.reach.pokeMax > 0.3 && vr.reach.pokeMax < 0.9, `${nation}: poke reach is an arm's length`);
    assert.ok(vr.recentre.keepsScale && vr.recentre.description.length > 40, `${nation}: recentring behaviour`);
    assert.equal(vr.skirtMargins.near, 0, `${nation}: no terrain skirt toward the viewer`);
    assert.equal(errorCodes(nation, "vr"), "", `${nation} VR checks`);
  }
});

test("the four nations differ in terrain logic, organisation and construction, not in colour", () => {
  const traditions = new Set<string>();
  const materials = new Map<string, NationId>();
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const prefix = NATION_KIT_PREFIX[nation];
    for (const t of bp.traditions) {
      assert.ok(t.key.startsWith(`${prefix}-`), `${nation}: tradition ${t.key} is the nation's own`);
      assert.ok(!traditions.has(t.key));
      traditions.add(t.key);
      for (const m of t.materials) {
        assert.ok(m.startsWith(`${prefix}-`), `${nation}: material ${m} belongs to the nation's library`);
        const owner = materials.get(m);
        assert.ok(!owner || owner === nation, `${m} is not shared between nations`);
        materials.set(m, nation);
      }
    }
    for (const b of bp.buildings) for (const m of b.masses) assert.ok(m.wallMaterial.startsWith(`${prefix}-`) && m.roof.material.startsWith(`${prefix}-`), `${nation}: ${b.id}/${m.id} uses the nation's materials`);
  }
  const T = (n: NationId) => createTerrainSampler(blueprintOf(n).terrain);
  const floor = (n: NationId, id: string) => resolveBuildingBase(T(n), blueprintOf(n).buildings.find((b) => b.id === id) ?? assert.fail(`${n}: ${id}`)).floorY;
  const hall = (n: NationId) => blueprintOf(n).buildings.find((b) => b.function === "banner-hall") ?? assert.fail(`${n}: banner hall`);
  const platform = (n: NationId) => blueprintOf(n).muster.platformBuildingId;
  // Korvenia: vertical Gothic manor on the rock high above the levy, steep roofs and spires.
  assert.ok(floor("korvenia", hall("korvenia").id) - floor("korvenia", platform("korvenia")) >= 8, "Korvenia's hall stands on the rock above the Muster Terrace");
  assert.ok(hall("korvenia").masses.some((m) => m.roof.form === "spire"), "Korvenia's manor carries a spire");
  // Solforiz: an engineered cascade of terraces with managed water.
  const sfTerraces = blueprintOf("solforiz").terrain.features.filter((f) => f.kind === "platform" && f.id.indexOf("terrace") >= 0);
  assert.ok(sfTerraces.length >= 3, "Solforiz is organised on terraces");
  assert.ok(blueprintOf("solforiz").terrain.water.some((w) => w.kind === "cistern") && blueprintOf("solforiz").terrain.water.some((w) => w.kind === "rill"), "Solforiz manages its water");
  assert.ok(blueprintOf("solforiz").buildings.some((b) => b.masses.some((m) => m.role === "windcatcher")), "Solforiz ventilates with windcatchers");
  assert.ok(blueprintOf("solforiz").routes.some((r) => r.covered), "Solforiz shades its market street");
  // Aethelgard: a ring-palisaded clan compound around an ancestral longhall, bound to stones in the wild.
  assert.ok(blueprintOf("aethelgard").walls.some((w) => w.kind === "palisade" && w.closed), "Aethelgard rings its compound with a palisade");
  assert.ok(hall("aethelgard").masses.some((m) => m.roof.form === "curved-ridge" && m.width >= 30), "Aethelgard's Banner Hall is a longhall");
  assert.ok(blueprintOf("aethelgard").dressing.filter((d) => d.kind === "standing-stone").length >= 6, "Aethelgard keeps a ring of standing stones");
  // Kwind-09: a chartered enclave with a privileged deck over a lower yard, elevated roads and towers beyond.
  assert.ok(floor("kwind-09", hall("kwind-09").id) - floor("kwind-09", platform("kwind-09")) >= 7, "Kwind-09's charter deck stands above the muster yard");
  assert.ok(blueprintOf("kwind-09").routes.some((r) => r.grade === "elevated" && r.kind === "elevated-road" && (r.deckY ?? [0]).every((y) => y >= 15)), "Kwind-09 has an elevated road");
  assert.ok(blueprintOf("kwind-09").outer.places.some((p) => (p.kind === "capital" || p.kind === "arcology") && p.silhouetteHeight >= 300), "corporate towers stand beyond Kwind-09");
  assert.ok(blueprintOf("kwind-09").buildings.filter((b) => b.district === "C").some((b) => b.masses[0].storeys >= 5), "Kwind-09 houses its workers in blocks");
  const roofs = new Set(NATIONS.map((n) => hall(n).masses[0].roof.form + "/" + hall(n).masses[0].roof.material));
  assert.equal(roofs.size, NATIONS.length, "every nation's Banner Hall has its own roof");
});

/** Prose fields of a blueprint (names, stories, notes, compositions), never ids or enum values. */
const PROSE_KEYS = new Set([
  "name", "label", "story", "description", "note", "composition", "purpose", "role", "summary", "logic", "siteName", "intendedUse",
  "timeOfDay", "notes", "species", "crop", "anchorConvention", "comfortNotes",
]);

function proseOf(value: unknown, key: string, out: string[], depth = 0): void {
  if (depth > 12) return;
  if (typeof value === "string") {
    if (PROSE_KEYS.has(key)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) proseOf(item, key, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) proseOf((value as Record<string, unknown>)[k], k, out, depth + 1);
  }
}

test("blueprint prose stays public-safe placeholder text: unnamed capitals, no death, no reactions to who commands, no numbered districts", () => {
  for (const nation of NATIONS) {
    const texts: string[] = [];
    proseOf(blueprintOf(nation), "", texts);
    assert.ok(texts.length > 200, `${nation}: collected ${texts.length} strings`);
    for (const text of texts) {
      assert.doesNotMatch(text, /\bcommand(s|ed|er|ing)?\b/i, `${nation}: ${text}`);
      assert.doesNotMatch(text, /\b(die|dies|died|dying|death|dead|slain|slay|killed|perish(ed)?|corpse|grave|graves|tomb|burial|buried)\b/i, `${nation}: ${text}`);
      assert.doesNotMatch(text, /\b(district|sector)\s+(\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i, `${nation}: ${text}`);
      assert.doesNotMatch(text, /\bplayers?\b/i, `${nation}: ${text}`);
      assert.doesNotMatch(text, /\b(patron|patrons|patronise|patronize|mortals?)\b/i, `${nation}: ${text}`);
      assert.doesNotMatch(text, /chronicle/i, `${nation}: the archive is always the War Record: ${text}`);
      const capitals = text.match(/\b\w*\s?capital\b/gi) ?? [];
      for (const mention of capitals) assert.match(mention, /^the capital$/i, `${nation}: capitals stay unnamed: ${text}`);
    }
    const record = blueprintOf(nation).landmarks.find((l) => l.id === "war-record");
    assert.equal(record?.label, "War Record");
  }
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

test("shared environment code stays platform-neutral, deterministic and ES2020-safe", () => {
  const files = sourceFiles(ENVIRONMENT_DIR);
  assert.ok(files.length >= 10, `scanned ${files.length} files`);
  for (const file of files) {
    const name = relative(ENVIRONMENT_DIR, file);
    // Comments may name what the code avoids; scan the code only.
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /from\s+["'](three|@iwsdk\/[^"']*|react|react-dom)["']/, `${name} imports no renderer, IWSDK or React`);
    assert.doesNotMatch(src, /\b(Math\.random|Date\.now|performance\.now|localStorage|sessionStorage|requestAnimationFrame)\b|(?<![.\w$])(window|document)\./, `${name} uses no clock, randomness, storage or DOM`);
    assert.doesNotMatch(src, /\.at\(|\.findLast\(|\.findLastIndex\(|Object\.hasOwn\(|\.replaceAll\(/, `${name} avoids APIs missing from the Quest ES2020 lib`);
  }
});

test("terrain sampling is deterministic and every blueprint number is finite", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const a = createTerrainSampler(bp.terrain);
    const b = createTerrainSampler(bp.terrain);
    const e = bp.terrain.extents;
    for (let i = 0; i <= 20; i++) {
      const x = e.minX + ((e.maxX - e.minX) * i) / 20;
      const z = e.minZ + ((e.maxZ - e.minZ) * ((i * 7) % 21)) / 20;
      const h = a.height(x, z);
      assert.ok(Number.isFinite(h), `${nation}: finite ground at [${x}, ${z}]`);
      assert.equal(h, b.height(x, z), `${nation}: identical ground from two samplers`);
      assert.equal(a.surface(x, z), b.surface(x, z));
    }
    assert.equal(errorCodes(nation, "non-finite"), "", `${nation} numbers are finite`);
    assert.equal(JSON.stringify(bp), JSON.stringify(blueprintOf(nation)), `${nation} blueprint is plain serialisable data`);
  }
});

test("development is earned: hall-tier buildings, honours and expansion zones are slots for real recognition, never pre-filled", () => {
  for (const nation of NATIONS) {
    const bp = blueprintOf(nation);
    const listed = new Set(bp.slots.hallTiers.flatMap((t) => t.buildings));
    for (const b of bp.buildings) {
      if (b.appearsAtHallTier !== undefined || b.unfinished) assert.ok(listed.has(b.id), `${nation}: ${b.id} develops with a hall tier`);
    }
    assert.ok(bp.slots.hallTiers.length === 3 && bp.slots.hallTiers.every((t, i) => t.tier === i + 1), `${nation}: tiers 1–3`);
    assert.ok(bp.slots.bannerMounts.some((m) => m.heraldry === "player" && m.minHallTier === 0), `${nation}: the banner's own heraldry shows from the founding`);
    assert.ok(bp.slots.recordMarkers.length >= 6 && bp.slots.noticeBoard.length >= 3, `${nation}: record and notice places`);
    const zones = new Set(bp.expansion.map((z) => z.id));
    for (const t of bp.slots.hallTiers) for (const z of t.expansionZones) assert.ok(zones.has(z), `${nation}: tier ${t.tier} zone ${z}`);
    assert.ok(bp.expansion.some((z) => z.unlocksAtHallTier === null), `${nation}: room reserved beyond v1`);
    assert.equal(errorCodes(nation, "hall-tier") + errorCodes(nation, "expansion"), "", `${nation} development slots`);
  }
});
