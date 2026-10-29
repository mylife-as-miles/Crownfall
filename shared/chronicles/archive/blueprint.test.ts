import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { CHRONICLE_RECORDS } from "../content";
import { canonClearance, clearance, framingSamples, overviewComposition, poolCoverage, questCheck, questEye, sweepFraming } from "./analysis";
import { ARCHIVE_BLUEPRINT as B, ARCHIVE_GEOMETRY as G, createArchiveBlueprint, getArchiveVantage, pierPlan } from "./blueprint";
import { DEG, distanceToOccluder, lookAngles, pointInPolygon, polygonArea, ringPoint, sweepHitsOccluder } from "./space";
import type { OccluderVolume, Vec3 } from "./types";

test("the blueprint is deterministic and its modules are pure", async () => {
  assert.deepEqual(createArchiveBlueprint(), createArchiveBlueprint());
  assert.deepEqual(createArchiveBlueprint(), B);
  assert.ok(Object.isFrozen(B) && Object.isFrozen(B.chamber.footprint) && Object.isFrozen(B.exhibits[0].framing.eye));
  const files: string[] = [];
  const walk = async (directory: URL): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, directory));
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(new URL(entry.name, directory).pathname);
    }
  };
  await walk(new URL("./", import.meta.url));
  for (const required of ["/archive/blueprint.ts", "/archive/types.ts", "/archive/space.ts", "/archive/analysis.ts", "/archive/kernel/mesh.ts"]) {
    assert.ok(files.some((file) => file.endsWith(required)), `the scan reaches ${required}`);
  }
  const banned: [RegExp, string][] = [
    [/from\s+["']three/, "three"], [/@iwsdk/, "IWSDK"], [/from\s+["']react/, "React"], [/\bdocument\s*\./, "the DOM"], [/\bwindow\s*\./, "the DOM"],
    [/\bnavigator\s*\./, "the DOM"], [/Math\.random/, "Math.random"], [/\bDate\b/, "Date"], [/performance\.now/, "a clock"],
    [/requestAnimationFrame|setTimeout|setInterval/, "a timer"], [/localStorage|sessionStorage/, "storage"],
  ];
  for (const file of files) {
    const source = (await readFile(file, "utf8")).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    for (const [pattern, what] of banned) assert.ok(!pattern.test(source), `${file.slice(file.indexOf("/archive/"))} uses ${what}`);
  }
});

test("every number in the blueprint is finite", () => {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is ${value}`);
    else if (value === null) assert.fail(`${path} is null`);
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  walk(B, "blueprint");
  walk(G, "geometry");
  assert.equal(B.schema, 1);
});

test("one exhibit per collection, presented as decided for M1, with its artifacts", () => {
  assert.deepEqual(B.exhibits.map((exhibit) => exhibit.collection).sort(), ["atlas", "contested", "interregnum", "laws"]);
  const presentation = Object.fromEntries(B.exhibits.map((exhibit) => [exhibit.collection, exhibit.presentation]));
  assert.deepEqual(presentation, { atlas: "interactive", interregnum: "framed", laws: "framed", contested: "dormant" });
  const artifactIds = new Set(B.artifacts.map((artifact) => artifact.id));
  assert.equal(artifactIds.size, B.artifacts.length, "artifact ids are unique");
  const approved = new Set(CHRONICLE_RECORDS.map((record) => record.id));
  for (const exhibit of B.exhibits) {
    for (const id of exhibit.artifactIds) {
      assert.ok(artifactIds.has(id), `${exhibit.id} lists missing artifact ${id}`);
      assert.equal(B.artifacts.find((artifact) => artifact.id === id)!.collection, exhibit.collection);
    }
  }
  for (const artifact of B.artifacts) for (const id of artifact.entryIds) assert.ok(approved.has(id), `${artifact.id} presents ${id}, which is not an approved record`);
  assert.deepEqual(B.artifacts.filter((artifact) => artifact.kind === "ring").map((artifact) => artifact.id), B.mechanism.rings.map((ring) => ring.id));
  for (const artifact of B.artifacts.filter((item) => item.collection === "contested")) assert.equal(artifact.selectable, false);
  for (const light of B.lights.filter((item) => item.zone === "contested")) assert.ok(light.dormant && light.intensity === 0 && light.quest === "omitted");
});

test("every exhibit and viewpoint lies inside the chamber", () => {
  const inside = (point: Vec3, what: string) => {
    assert.ok(pointInPolygon(point[0], point[2], B.chamber.footprint), `${what} is outside the footprint: ${point}`);
    assert.ok(point[1] >= G.levels.landing && point[1] <= B.chamber.crownY, `${what} is outside the chamber's height: ${point}`);
  };
  for (const exhibit of B.exhibits) {
    inside(exhibit.anchor, exhibit.id);
    inside(exhibit.pick.center, `${exhibit.id} pick`);
    inside(exhibit.framing.eye, `${exhibit.id} framing eye`);
  }
  for (const view of B.viewpoints.desktop) {
    inside(view.eye, `${view.id} eye`);
    inside(view.target, `${view.id} target`);
  }
  for (const vantage of B.viewpoints.quest) {
    inside(questEye(vantage), `${vantage.posture} eye`);
    inside(vantage.controlSurface.position, `${vantage.posture} control surface`);
  }
  for (const point of B.expansion) inside(point.position, point.id);
  for (const artifact of B.artifacts) if (artifact.placement) inside(artifact.placement.position, artifact.id);
  const ids = B.viewpoints.desktop.map((view) => view.id);
  for (const required of ["entrance", "overview", "collection:atlas", "collection:interregnum", "collection:laws", "nation:korvenia", "nation:solforiz", "nation:aethelgard", "nation:kwind-09", "review:contested"]) {
    assert.ok(ids.includes(required), `viewpoint ${required} is missing`);
  }
  assert.ok(!ids.includes("collection:contested"), "the dormant bay is absent from navigation");
});

test("no desktop eye sits inside an occluder or within 0.3 m of solid geometry", () => {
  for (const view of B.viewpoints.desktop) {
    for (const volume of B.occluders) assert.ok(distanceToOccluder(volume, view.eye) > 0, `${view.id} eye is inside ${volume.id}`);
    const gap = clearance(B, view.eye);
    assert.ok(gap >= 0.3, `${view.id} eye is ${gap.toFixed(3)} m from solid geometry`);
  }
});

test("each framing's orbit and zoom range is swept against the occluders (5 x 5 x 3) and stays clear or lists what it hits", () => {
  for (const view of B.viewpoints.desktop) {
    const sweep = sweepFraming(B, view);
    assert.ok(sweep.samples >= 75);
    assert.ok(sweep.minClearance >= 0.15, `${view.id} orbit reaches ${sweep.minClearance.toFixed(2)} m from solid geometry`);
    const listed = new Set(B.exhibits.find((exhibit) => exhibit.id === sweep.subject)!.occluders || []);
    for (const id of sweep.hits) assert.ok(listed.has(id), `${view.id}: ${id} can hide ${sweep.subject}; list it on the exhibit (occlusion reveal, D8) or narrow the limits`);
  }
  // The sweep itself catches a volume that does stand in the way.
  const overview = B.viewpoints.desktop.find((view) => view.id === "overview")!;
  const block: OccluderVolume = { id: "probe", kind: "prism", center: [0, 3, 5], size: [1, 6, 1], yaw: 0.3, plan: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] };
  assert.ok(framingSamples(overview).some((eye) => sweepHitsOccluder(block, [0, 1.1, 0], eye, 0.25)));
});

test("the overview at 16:9 holds the whole monument, most of the ring band and the light shaft", () => {
  const composition = overviewComposition(B);
  assert.ok(composition.monumentInside, "the monument leaves the overview");
  assert.ok(composition.ringShare >= 0.6, `only ${(composition.ringShare * 100).toFixed(0)}% of the ring band is in the overview`);
  assert.ok(composition.shaftInside, "the light shaft leaves the overview");
});

test("Quest: from both vantages every exhibit lies within the comfort cone and the relief sits low and near", () => {
  for (const posture of ["seated", "standing"] as const) {
    const vantage = getArchiveVantage(posture), check = questCheck(B, posture);
    assert.ok(vantage.comfortHalfAngle <= 60 * DEG);
    for (const [collection, off] of Object.entries(check.exhibits)) assert.ok(off <= vantage.comfortHalfAngle / DEG, `${collection} is ${off.toFixed(1)} deg off forward (${posture})`);
    assert.ok(check.reliefTop >= 0.65 && check.reliefTop <= 0.9, `${posture} relief top ${check.reliefTop}`);
    assert.ok(check.farEdge >= (posture === "seated" ? 22 : 28), `${posture} far edge is ${check.farEdge.toFixed(1)} deg below the eye`);
    assert.ok(check.nearEdge >= 0.3, `${posture} near edge is ${check.nearEdge.toFixed(3)} m ahead`);
    assert.ok(check.highestTerrain < check.eye[1], "the highest terrain stays below the eye");
    assert.ok(check.markerSize >= 0.04 && check.markerSize >= 0.06 * B.monument.quest.reliefWidth - 1e-9, `markers are ${(check.markerSize * 100).toFixed(1)} cm`);
  }
  // The recorded stations match the room from the seated eye.
  const eye = questEye(getArchiveVantage("seated"));
  for (const exhibit of B.exhibits) {
    const anchor: Vec3 = exhibit.collection === "atlas" ? [B.monument.quest.center[0], B.monument.quest.reliefTop.seated, B.monument.quest.center[2]] : exhibit.anchor;
    assert.ok(Math.abs(exhibit.station.bearing - lookAngles(eye, anchor).bearing) < 1e-3, `${exhibit.id} station bearing`);
  }
});

test("Quest: the mechanism's event band sits within the cone, 10-45 degrees above the eye line", () => {
  for (const posture of ["seated", "standing"] as const) {
    const band = questCheck(B, posture).eventBand;
    assert.ok(band.maxOff <= 60, `the event band reaches ${band.maxOff.toFixed(1)} deg off forward (${posture})`);
    assert.ok(band.minElevation >= 10 && band.maxElevation <= 45, `the event band spans ${band.minElevation.toFixed(1)}-${band.maxElevation.toFixed(1)} deg (${posture})`);
  }
  for (const ring of B.mechanism.rings) {
    assert.ok(ring.eventBand[1] > ring.eventBand[0], `${ring.id} band runs forward`);
    assert.ok(ring.radius >= 3 && ring.radius <= 6, `${ring.id} radius ${ring.radius}`);
    assert.ok(ring.center[1] >= 5 && ring.center[1] <= 9, `${ring.id} hangs at ${ring.center[1]}`);
    assert.ok(ring.suspension.length >= 2, `${ring.id} is held at its rim`);
    for (const rod of ring.suspension) assert.ok(rod.anchor[1] > G.levels.vault && rod.anchor[1] <= B.chamber.crownY, `${ring.id} rod reaches the vault`);
  }
});

test("Quest: the control surface stays clear of the monument's outline at 0 and -20 degrees of pitch", () => {
  for (const posture of ["seated", "standing"] as const) {
    const vantage = getArchiveVantage(posture), check = questCheck(B, posture);
    assert.ok(check.controlGap.upright >= 1, `the ${posture} control surface is ${check.controlGap.upright.toFixed(1)} deg from the monument upright`);
    assert.ok(check.controlGap.tilted >= 1, `the ${posture} control surface is ${check.controlGap.tilted.toFixed(1)} deg from the monument tilted`);
    const panel = vantage.controlSurface, eye = questEye(vantage);
    const facing = Math.sin(panel.yaw) * (eye[0] - panel.position[0]) + Math.cos(panel.yaw) * (eye[2] - panel.position[2]);
    assert.ok(facing > 0, "the panel's face turns toward the viewer");
    assert.ok(Math.abs(lookAngles(eye, panel.position).bearing) / DEG <= 60, "the control surface sits inside the comfort cone");
  }
});

test("canon: nothing stands near the vertical line above either map centre, and the oculus shows only sky", () => {
  const canon = canonClearance(B);
  assert.ok(canon.desktop >= 0.4, `something stands ${canon.desktop.toFixed(2)} m from the desktop map centre's vertical`);
  assert.ok(canon.quest >= 0.4, `something stands ${canon.quest.toFixed(2)} m from the Quest map centre's vertical`);
  for (const [cx, cz, top] of [[B.monument.center[0], B.monument.center[2], B.monument.desktop.reliefTop], [B.monument.quest.center[0], B.monument.quest.center[2], B.monument.quest.reliefTop.standing]]) {
    for (const element of B.elements) {
      for (const place of element.instances || [element.transform]) {
        const y = place.position[1];
        if (y <= top || y >= G.levels.vault) continue;
        assert.ok(Math.hypot(place.position[0] - cx, place.position[2] - cz) >= 0.4, `${element.id} is placed on the map centre's vertical`);
      }
    }
  }
  const above = B.elements.filter((element) => element.transform.position[1] > B.chamber.crownY).map((element) => element.id).sort();
  assert.deepEqual(above, ["oculus-tracery", "sky-disc"], "only the tracery and the sky disc sit above the crown");
  assert.deepEqual(B.elements.find((element) => element.id === "sky-disc")!.materialIds, ["sky"]);
  // The tracery keeps an open centre: nothing marks the axis even at the crown.
  assert.ok(B.chamber.oculus.tracery.open >= 0.3);
});

test("the bays open north-west, north and north-east inside the cone; the entrance lies behind the viewer", () => {
  const eye = questEye(getArchiveVantage("seated"));
  const bays = B.chamber.sides.filter((side) => side.kind === "bay").map((side) => Math.round(side.bearing / DEG));
  assert.deepEqual(bays.sort((a, b) => a - b), [0, 45, 315]);
  for (const side of B.chamber.sides.filter((item) => item.kind === "bay")) {
    const mouth: Vec3 = [Math.sin(side.bearing) * G.apothem, 1.5, -Math.cos(side.bearing) * G.apothem];
    assert.ok(Math.abs(lookAngles(eye, mouth).bearing) / DEG <= 60, `bay at ${(side.bearing / DEG).toFixed(0)} deg leaves the cone`);
  }
  assert.equal(Math.round(B.chamber.sides.find((side) => side.kind === "entrance")!.bearing / DEG), 180);
});

test("expansion points: at least two, one reserved for War Record exhibits, all visibly empty niches", () => {
  assert.ok(B.expansion.length >= 2);
  assert.ok(B.expansion.some((point) => point.reservedFor === "war-record"));
  const eye = questEye(getArchiveVantage("seated"));
  for (const point of B.expansion) {
    for (const artifact of B.artifacts) if (artifact.placement) assert.ok(Math.hypot(artifact.placement.position[0] - point.position[0], artifact.placement.position[2] - point.position[2]) > 1.5, `${artifact.id} fills ${point.id}`);
    for (const exhibit of B.exhibits) assert.ok(Math.hypot(exhibit.anchor[0] - point.position[0], exhibit.anchor[2] - point.position[2]) > 1.5, `${exhibit.id} fills ${point.id}`);
    assert.ok(Math.abs(lookAngles(eye, point.position).bearing) / DEG <= 60, `${point.id} lies outside the comfort cone`);
  }
  // The niches are cut into the piers flanking the outer bays.
  assert.ok(B.elements.some((element) => element.id === "piers-niche" && element.instances?.length === 2));
});

test("lights: one shadow key through the oculus covering the monument broadly, practicals within budget", () => {
  const keys = B.lights.filter((light) => light.kind === "key");
  assert.equal(keys.length, 1);
  assert.equal(B.lights.filter((light) => light.castsShadow).length, 1, "at most one shadow-casting light");
  const key = keys[0];
  assert.ok(key.castsShadow && key.cookie && key.target && key.cone);
  for (const quality of ["low", "medium", "high"] as const) {
    const dynamic = B.lights.filter((light) => light.kind === "practical" && light.desktop[quality] === "dynamic").length;
    assert.ok(dynamic <= 4, `${dynamic} dynamic practicals on ${quality}`);
  }
  const p = key.position, t = key.target!, o = B.chamber.oculus.center;
  const along = (o[1] - p[1]) / (t[1] - p[1]);
  assert.ok(Math.hypot(p[0] + (t[0] - p[0]) * along - o[0], p[2] + (t[2] - p[2]) * along - o[2]) < B.chamber.oculus.radius * 0.5, "the key falls through the oculus");
  const coverage = poolCoverage(B);
  assert.ok(coverage.desktop >= 0.85, `the pool covers ${(coverage.desktop * 100).toFixed(0)}% of the desktop relief`);
  assert.equal(coverage.quest, 1, "the pool covers the whole Quest relief");
  for (const light of B.lights) assert.match(light.color, /^#[0-9a-f]{6}$/);
});

test("camera paths: flights of at most 1.2 s, an entrance settle of at most 1.5 s, all clear of the room", () => {
  const ids = new Set(B.viewpoints.desktop.map((view) => view.id));
  for (const path of B.paths) {
    assert.ok(ids.has(path.from) && ids.has(path.to), `${path.from} -> ${path.to}`);
    const limit = path.from === "entrance" ? 1.5 : 1.2;
    assert.ok(path.seconds > 0 && path.seconds <= limit, `${path.from} -> ${path.to} takes ${path.seconds} s`);
    for (const via of path.via) assert.ok(clearance(B, via) >= 0.3, `${path.from} -> ${path.to} passes ${clearance(B, via).toFixed(2)} m from solid geometry`);
  }
  assert.ok(B.paths.some((path) => path.from === "entrance" && path.to === "overview"));
  for (const id of ["collection:atlas", "collection:interregnum", "collection:laws"]) {
    assert.ok(B.paths.some((path) => path.from === "overview" && path.to === id) && B.paths.some((path) => path.from === id && path.to === "overview"), id);
  }
});

test("budgets per quality hold the directive's limits", () => {
  assert.deepEqual(B.budgets.quest, { drawCalls: 120, triangles: 250000, textureMB: 64 });
  assert.ok(B.budgets.medium.drawCalls <= 250 && B.budgets.medium.triangles <= 1000000);
  assert.ok(B.budgets.low.drawCalls <= 120 && B.budgets.low.triangles <= 300000);
  assert.ok(B.budgets.high.drawCalls <= 400 && B.budgets.high.triangles <= 1500000);
});

test("ids are unique, every reference resolves and the plan is consistent", () => {
  const unique = (ids: string[], what: string) => assert.equal(new Set(ids).size, ids.length, `${what} ids are unique`);
  unique(B.elements.map((element) => element.id), "element");
  unique(B.occluders.map((volume) => volume.id), "occluder");
  unique(B.viewpoints.desktop.map((view) => view.id), "viewpoint");
  unique(B.lights.map((light) => light.id), "light");
  unique(B.zones.map((zone) => zone.id), "zone");
  const occluders = new Set(B.occluders.map((volume) => volume.id));
  for (const element of B.elements) {
    const listed = element.occluder === undefined ? [] : typeof element.occluder === "string" ? [element.occluder] : element.occluder;
    for (const id of listed) assert.ok(occluders.has(id), `${element.id} names missing occluder ${id}`);
    if (Array.isArray(element.occluder)) assert.equal(element.occluder.length, element.instances?.length, `${element.id} has one occluder per instance`);
  }
  for (const artifact of B.artifacts) if (artifact.occluder) assert.ok(occluders.has(artifact.occluder), artifact.id);
  for (const exhibit of B.exhibits) for (const id of exhibit.occluders || []) assert.ok(occluders.has(id), `${exhibit.id} lists ${id}`);
  // The footprint runs by increasing bearing (clockwise seen from above): positive signed area with z toward the south.
  assert.ok(polygonArea(B.chamber.footprint) > 0);
  // The pier plan is a convex kite whose jamb faces meet the arcade plane at the arch springers.
  const plan = pierPlan();
  assert.equal(plan.length, 4);
  const half = Math.PI / G.sides, jz = -(G.pier.width / 2) * Math.sin(half), jx = (G.pier.width / 2) * Math.cos(half);
  for (const [a, b, sign] of [[0, 1, 1], [3, 2, -1]] as const) {
    const u = (jz - plan[a][1]) / (plan[b][1] - plan[a][1]);
    assert.ok(Math.abs(plan[a][0] + (plan[b][0] - plan[a][0]) * u - sign * jx) < 1e-6, "a jamb face passes through its springer");
  }
  assert.ok(Math.abs(G.span - (G.sideLength - G.pier.width)) < 1e-6);
  // Ring sampling closes on itself.
  for (const ring of B.mechanism.rings) {
    const a = ringPoint(ring, 0), b = ringPoint(ring, Math.PI * 2);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9);
  }
});
