import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getHotspotRecords } from "../content";
import {
  RELIEF_ASPECT, RELIEF_CAMERA_LIMITS, RELIEF_DETAILS, RELIEF_FOV, RELIEF_LANDFORMS, RELIEF_LEVELS, RELIEF_MARKER,
  RELIEF_SEGMENTS, RELIEF_SLAB, RELIEF_VIEWS, blendReliefViews, buildReliefMesh, clampReliefView, fitReliefDistance,
  getReliefMarkers, getReliefViewPose, imageToRelief, intersectRelief, reliefHeightAt, reliefHotspotAt, reliefMeshSlices,
  reliefToImage, sampleReliefSurface,
} from "./relief";
import type { ReliefMesh, ReliefQuality, ReliefView } from "./relief";

const QUALITIES = Object.keys(RELIEF_SEGMENTS) as ReliefQuality[];
const BUDGETS: Record<ReliefQuality, number> = { quest: 60_000, low: 60_000, medium: 250_000, high: 320_000 };
const meshes = new Map<string, ReliefMesh>();
const meshFor = (segments: number, width = 1.2) => {
  const key = `${segments}@${width}`;
  if (!meshes.has(key)) meshes.set(key, buildReliefMesh(width, segments));
  return meshes.get(key)!;
};

// A seeded generator keeps the sampled cases identical on every run.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function bruteForceRay(mesh: ReliefMesh, origin: number[], direction: number[]): number {
  const p = mesh.positions, index = mesh.indices;
  let best = -1;
  for (let i = 0; i < mesh.groups[0].count; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
    const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const h = [direction[1] * e2[2] - direction[2] * e2[1], direction[2] * e2[0] - direction[0] * e2[2], direction[0] * e2[1] - direction[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-14) continue;
    const s = [origin[0] - p[a * 3], origin[1] - p[a * 3 + 1], origin[2] - p[a * 3 + 2]];
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

test("the relief is deterministic and never draws on Math.random", () => {
  const random = Math.random;
  Math.random = () => { throw new Error("relief must not use Math.random"); };
  try {
    const first = buildReliefMesh(1.2, RELIEF_SEGMENTS.quest);
    const second = buildReliefMesh(1.2, RELIEF_SEGMENTS.quest);
    for (const key of ["heights", "positions", "normals", "uvs", "indices"] as const) {
      assert.deepEqual(Buffer.from(first[key].buffer), Buffer.from(second[key].buffer), key);
    }
    const sliced = reliefMeshSlices(1.2, RELIEF_SEGMENTS.quest, 5);
    const progress: number[] = [];
    let slice = sliced.next();
    while (!slice.done) {
      progress.push(slice.value);
      slice = sliced.next();
    }
    assert.ok(progress.length > 20, "the sliced build yields between rows");
    assert.ok(progress.every((share, index) => share > 0 && share < 1 && (index === 0 || share > progress[index - 1])));
    for (const key of ["positions", "normals", "uvs", "indices"] as const) {
      assert.deepEqual(Buffer.from(slice.value[key].buffer), Buffer.from(first[key].buffer), `sliced ${key}`);
    }
    for (const [x, y] of [[0.5, 0.5], [0.15, 0.17], [0.92, 0.625], [0.03, 0.97]]) assert.equal(reliefHeightAt(x, y), reliefHeightAt(x, y));
  } finally {
    Math.random = random;
  }
});

test("every quality stays inside its triangle budget and index range", () => {
  for (const quality of QUALITIES) {
    const mesh = meshFor(RELIEF_SEGMENTS[quality]);
    assert.ok(mesh.triangleCount <= BUDGETS[quality], `${quality}: ${mesh.triangleCount} triangles`);
    assert.equal(mesh.indices.length, mesh.triangleCount * 3);
    assert.equal(mesh.positions.length, mesh.vertexCount * 3);
    assert.equal(mesh.groups[0].start, 0);
    assert.equal(mesh.groups[1].start, mesh.groups[0].count);
    assert.equal(mesh.groups[0].count + mesh.groups[1].count, mesh.indices.length);
    assert.equal(mesh.groups[0].count, mesh.columns * mesh.rows * 6, `${quality}: the painted surface is group 0`);
    assert.equal(mesh.rows, Math.round(mesh.columns * RELIEF_ASPECT));
    assert.ok(mesh.indices.every((index) => index < mesh.vertexCount));
  }
  assert.ok(meshFor(RELIEF_SEGMENTS.medium).groups[0].count / 3 <= 250_000, "desktop medium terrain");
  assert.ok(meshFor(RELIEF_SEGMENTS.quest).triangleCount <= 60_000, "Quest terrain and slab");
  assert.ok(meshFor(RELIEF_SEGMENTS.quest).indices instanceof Uint16Array, "Quest indices fit 16 bits");
  assert.throws(() => buildReliefMesh(0, 64), RangeError);
  assert.throws(() => buildReliefMesh(NaN, 64), RangeError);
});

test("geometry is finite, normals are unit length and every face points outward", () => {
  for (const segments of [RELIEF_SEGMENTS.quest, RELIEF_SEGMENTS.medium]) {
    const mesh = meshFor(segments);
    for (const values of [mesh.positions, mesh.normals, mesh.uvs, mesh.heights]) assert.ok(values.every(Number.isFinite));
    for (let i = 0; i < mesh.vertexCount; i++) {
      const length = Math.hypot(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
      assert.ok(Math.abs(length - 1) < 1e-5, `normal ${i} has length ${length}`);
    }
    const { positions: p, normals: n, indices } = mesh;
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const facing = [a, b, c].reduce((sum, v) => sum + face[0] * n[v * 3] + face[1] * n[v * 3 + 1] + face[2] * n[v * 3 + 2], 0);
      assert.ok(facing > 0, `triangle ${i / 3} winds against its normals`);
    }
  }
});

test("the painted surface maps exactly onto the painting with v up", () => {
  const mesh = meshFor(RELIEF_SEGMENTS.quest);
  const stride = mesh.columns + 1, surface = stride * (mesh.rows + 1);
  for (let i = 0; i < surface; i++) {
    const [x, , z] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
    const [u, v] = [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]];
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1);
    assert.ok(Math.abs(u - (x / mesh.width + 0.5)) < 1e-6 && Math.abs(v - (0.5 - z / mesh.depth)) < 1e-6, `vertex ${i}`);
  }
  assert.deepEqual([mesh.uvs[0], mesh.uvs[1]], [0, 1], "the north-west corner shows the painting's top-left");
  assert.deepEqual([mesh.uvs[(surface - 1) * 2], mesh.uvs[(surface - 1) * 2 + 1]], [1, 0]);
  assert.ok(Math.abs(mesh.depth - mesh.width * 1529 / 2048) < 1e-9);
  const [fx, fy] = reliefToImage(...imageToRelief(0.15, 0.17, 1.2), 1.2);
  assert.ok(Math.abs(fx - 0.15) < 1e-12 && Math.abs(fy - 0.17) < 1e-12);
});

test("the slab is closed: the rim is level and the chamfer meets it exactly", () => {
  const mesh = meshFor(RELIEF_SEGMENTS.quest);
  const stride = mesh.columns + 1, rim = RELIEF_LEVELS.rim * mesh.width;
  const edges: number[] = [];
  for (let c = 0; c <= mesh.columns; c++) edges.push(c, mesh.rows * stride + c);
  for (let r = 0; r <= mesh.rows; r++) edges.push(r * stride, r * stride + mesh.columns);
  for (const vertex of edges) assert.ok(Math.abs(mesh.heights[vertex] - rim) < 1e-6, `edge vertex ${vertex}`);
  const surface = stride * (mesh.rows + 1);
  const key = (i: number) => [0, 1, 2].map((axis) => mesh.positions[i * 3 + axis].toFixed(6)).join();
  const edgeKeys = new Set(edges.map(key));
  const sides = 2 * mesh.columns + 2 * mesh.rows + 4;
  for (let i = 0; i < sides; i++) assert.ok(edgeKeys.has(key(surface + i * 4)), `chamfer vertex ${i} sits on the rim`);
  const lowest = Math.min(...Array.from({ length: mesh.vertexCount }, (_, i) => mesh.positions[i * 3 + 1]));
  assert.ok(Math.abs(lowest - RELIEF_SLAB.base * mesh.width) < 1e-6, "the underside is the slab base");
  assert.ok(mesh.minHeight > RELIEF_SLAB.base * mesh.width);
});

test("sampling and rays follow the drawn triangles", () => {
  const mesh = meshFor(40, 1);
  const random = seeded(7);
  for (let i = 0; i < 160; i++) {
    const x = (random() - 0.5) * mesh.width * 0.98, z = (random() - 0.5) * mesh.depth * 0.98;
    const height = sampleReliefSurface(mesh, x, z);
    const drop = intersectRelief(mesh, x, 1, z, 0, -1, 0);
    assert.ok(Math.abs(1 - drop - height) < 1e-6, `a vertical ray lands on the sampled surface at ${x}, ${z}`);
    const origin = [x + (random() - 0.5) * 2, 0.6 + random(), z + 0.4 + random()];
    const direction = [x - origin[0], height - origin[1], z - origin[2]];
    const expected = bruteForceRay(mesh, origin, direction);
    const found = intersectRelief(mesh, origin[0], origin[1], origin[2], direction[0], direction[1], direction[2]);
    assert.ok(expected >= 0 && Math.abs(found - expected) < 1e-6, `ray ${i}: ${found} against ${expected}`);
  }
  assert.equal(intersectRelief(mesh, 0, 1, 0, 0, 1, 0), -1, "a ray pointing away misses");
  assert.equal(intersectRelief(mesh, 5, 1, 0, 0, -1, 0), -1, "a ray beside the map misses");
  assert.ok(Number.isNaN(sampleReliefSurface(mesh, mesh.width, 0)), "off the painting there is no surface");
  const pose = getReliefViewPose(RELIEF_VIEWS.overview, 1);
  const hit = intersectRelief(mesh, ...pose.position, pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]);
  assert.ok(hit > 0.95 && hit < 1.05, "the overview's gaze meets the ground at its target");
});

test("markers sit on the surface at every quality and share the hotspot order", () => {
  const records = getHotspotRecords();
  for (const quality of QUALITIES) {
    const mesh = meshFor(RELIEF_SEGMENTS[quality]);
    const markers = getReliefMarkers(mesh);
    assert.deepEqual(markers.map((marker) => marker.record), records);
    for (const marker of markers) {
      const [x, z] = imageToRelief(marker.record.hotspot.x, marker.record.hotspot.y, mesh.width);
      assert.equal(marker.x, x);
      assert.equal(marker.z, z);
      assert.equal(marker.y, sampleReliefSurface(mesh, marker.x, marker.z));
      const shared = reliefHeightAt(marker.record.hotspot.x, marker.record.hotspot.y) * mesh.width;
      assert.ok(Math.abs(marker.y - shared) < 0.001 * mesh.width, `${quality} ${marker.record.id}: ${marker.y} against ${shared}`);
      assert.ok(marker.radius >= 0.06 * mesh.width && marker.ring >= 0.03 * mesh.width);
      assert.ok(marker.clearance >= marker.y);
      for (let spoke = 0; spoke < 16; spoke++) {
        const angle = (spoke / 16) * Math.PI * 2;
        assert.ok(sampleReliefSurface(mesh, x + Math.cos(angle) * marker.ring, z + Math.sin(angle) * marker.ring) <= marker.clearance + 1e-6);
      }
    }
  }
  for (const marker of getReliefMarkers(meshFor(RELIEF_SEGMENTS.medium))) {
    assert.ok(marker.y > RELIEF_LEVELS.lowland * 1.2, `${marker.record.id} stands on raised ground`);
  }
});

test("only hotspots answer: the centre and empty ground do nothing", () => {
  const width = 1.2, mesh = meshFor(RELIEF_SEGMENTS.quest, width), markers = getReliefMarkers(mesh);
  assert.equal(reliefHotspotAt(0, 0, width), null);
  for (const marker of markers) {
    assert.equal(reliefHotspotAt(marker.x, marker.z, width), marker.record);
    assert.equal(reliefHotspotAt(marker.x + marker.radius * 0.98, marker.z, width), marker.record);
    assert.equal(reliefHotspotAt(marker.x, marker.z - marker.radius * 1.02, width), null);
  }
  for (let fx = 0; fx <= 1; fx += 0.02) {
    for (let fy = 0; fy <= 1; fy += 0.02) {
      const [x, z] = imageToRelief(fx, fy, width);
      const found = reliefHotspotAt(x, z, width);
      if (Math.hypot(fx - 0.5, (fy - 0.5) * RELIEF_ASPECT) < 0.2) assert.equal(found, null, `the centre answers at ${fx}, ${fy}`);
      if (!found) continue;
      const marker = markers.find((item) => item.record === found)!;
      assert.ok(Math.hypot(x - marker.x, z - marker.z) <= marker.radius + 1e-9);
    }
  }
  for (const [x, z, w] of [[NaN, 0, width], [0, Infinity, width], [0, 0, 0], [0, 0, -1]]) assert.equal(reliefHotspotAt(x, z, w), null);
});

test("painted mountains rise while the lowland and the seas stay low", () => {
  const summits = [[0.903, 0.04], [0.735, 0.1], [0.625, 0.125], [0.8, 0.075], [0.215, 0.07], [0.3, 0.025]];
  for (const [x, y] of summits) assert.ok(reliefHeightAt(x, y) > 0.05, `summit at ${x}, ${y}: ${reliefHeightAt(x, y)}`);
  for (const [x, y] of [[0.18, 0.18], [0.2, 0.3], [0.81, 0.25], [0.635, 0.205]]) assert.ok(reliefHeightAt(x, y) > 0.04, `terrace at ${x}, ${y}`);
  assert.ok(reliefHeightAt(0.92, 0.66) > 0.05, "the great cone stands above Solforiz");
  assert.ok(reliefHeightAt(0.5, 0.5) < 0.012, "the centre is open lowland");
  for (let x = 0.51; x <= 0.54; x += 0.01) for (let y = 0.5; y <= 0.6; y += 0.02) assert.ok(reliefHeightAt(x, y) < 0.014, `lowland at ${x}, ${y}`);
  for (const [x, y] of [[0.42, 0.76], [0.05, 0.96], [0.25, 0.965], [0.94, 0.94], [0.88, 0.965]]) {
    assert.ok(reliefHeightAt(x, y) < 0, `sea at ${x}, ${y}: ${reliefHeightAt(x, y)}`);
  }
  for (const form of RELIEF_LANDFORMS) {
    if (form.kind === "cone") {
      const rim = reliefHeightAt(form.at[0] + form.crater * 1.2, form.at[1]);
      assert.ok(reliefHeightAt(form.at[0], form.at[1]) < rim, `${form.id} has a crater`);
    }
    if (form.kind === "basin" && form.fill === "lava") {
      const bank = reliefHeightAt(form.at[0] + form.radius * 1.3, form.at[1]);
      assert.ok(reliefHeightAt(form.at[0], form.at[1]) < bank, `${form.id} is a hollow`);
    }
    if (form.kind === "channel") {
      for (const [x, y] of form.path.slice(1, -1)) {
        if (Math.min(x, 1 - x, y, 1 - y) < 0.05) continue;
        assert.ok(reliefHeightAt(x, y) >= RELIEF_LEVELS.dry - 1e-9, `${form.id} stays above the sea at ${x}, ${y}`);
      }
    }
  }
  const mesh = meshFor(RELIEF_SEGMENTS.medium, 1);
  assert.ok(mesh.maxHeight < 0.1, `relief stays modest: ${mesh.maxHeight}`);
  assert.ok(mesh.minHeight >= RELIEF_LEVELS.seabed - 0.001);
});

test("painted lettering sits on flat, dry plates", () => {
  // Each plate's lettering spans up to 0.68 of its reach along and 0.44 across.
  for (const form of RELIEF_LANDFORMS) {
    if (form.kind !== "plate") continue;
    const turn = (form.angle * Math.PI) / 180;
    const heights: number[] = [];
    for (let a = -0.68; a <= 0.6801; a += 0.085) {
      for (let b = -0.44; b <= 0.4401; b += 0.11) {
        const along = a * form.reach[0], across = b * form.reach[1];
        const x = form.at[0] + along * Math.cos(turn) - across * Math.sin(turn);
        const y = form.at[1] + (along * Math.sin(turn) + across * Math.cos(turn)) / RELIEF_ASPECT;
        heights.push(reliefHeightAt(x, y));
      }
    }
    const spread = Math.max(...heights) - Math.min(...heights);
    assert.ok(spread < 0.0006, `${form.id} varies by ${spread}`);
    assert.ok(Math.min(...heights) >= RELIEF_LEVELS.dry - 1e-9, `${form.id} is dry`);
  }
});

test("landforms are named once and placed on the painting", () => {
  const ids = RELIEF_LANDFORMS.map((form) => form.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const form of RELIEF_LANDFORMS) {
    assert.match(form.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    const points = "at" in form ? [form.at] : form.kind === "ridge" ? form.crest.map(([x, y]) => [x, y] as const) : form.kind === "channel" ? form.path : form.coast;
    for (const [x, y] of points) assert.ok(x >= -0.06 && x <= 1.06 && y >= -0.06 && y <= 1.06, `${form.id} at ${x}, ${y}`);
    if ("rise" in form) assert.ok(form.rise > 0 && form.rise < 0.1, form.id);
    if ("reach" in form) assert.ok(form.reach.every((value) => value > 0), form.id);
  }
});

test("views frame the slab inside the camera limits", () => {
  const limits = RELIEF_CAMERA_LIMITS;
  for (const [name, view] of Object.entries(RELIEF_VIEWS)) {
    assert.deepEqual(clampReliefView(view), { ...view, target: [...view.target] }, `${name} is within the limits`);
  }
  const hotspots = getHotspotRecords();
  for (const record of hotspots) {
    const view = RELIEF_VIEWS[record.nation];
    assert.ok(Math.hypot(view.target[0] - record.hotspot.x, view.target[1] - record.hotspot.y) < 0.16, `${record.nation} looks at its nation`);
    assert.ok(view.distance < RELIEF_VIEWS.overview.distance);
  }
  for (const aspect of [16 / 9, 4 / 3, 844 / 390, 1]) {
    const view: ReliefView = { ...RELIEF_VIEWS.overview, distance: fitReliefDistance(RELIEF_VIEWS.overview, RELIEF_FOV, aspect) };
    assert.ok(view.distance > limits.distance[0] && view.distance <= limits.distance[1], `fit at ${aspect}: ${view.distance}`);
    if (aspect >= 16 / 9) assert.ok(Math.abs(view.distance - RELIEF_VIEWS.overview.distance) < 0.01, "the overview is authored at its 16:9 fit");
    const pose = getReliefViewPose(view, 1);
    const forward = pose.target.map((value, axis) => value - pose.position[axis]);
    const length = Math.hypot(...forward);
    assert.ok(Math.abs(length - view.distance) < 1e-9);
    const f = forward.map((value) => value / length);
    const right = [-f[2], 0, f[0]].map((value, _, all) => value / Math.hypot(...all));
    const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const tanV = Math.tan((RELIEF_FOV * Math.PI) / 360);
    for (const cx of [-0.5, 0.5]) for (const cz of [-RELIEF_ASPECT / 2, RELIEF_ASPECT / 2]) for (const cy of [RELIEF_SLAB.base, 0.09]) {
      const q = [cx - pose.position[0], cy - pose.position[1], cz - pose.position[2]];
      const depth = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
      const sx = (q[0] * right[0] + q[1] * right[1] + q[2] * right[2]) / (depth * tanV * aspect);
      const sy = (q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) / (depth * tanV);
      assert.ok(Math.abs(sx) <= 1 && Math.abs(sy) <= 1, `corner ${cx}, ${cy}, ${cz} is in frame at ${aspect}`);
    }
    assert.ok(pose.position[1] > 0.1, "the eye stays above every peak");
  }
});

test("view helpers clamp and blend without leaving the limits", () => {
  const limits = RELIEF_CAMERA_LIMITS;
  const wild = clampReliefView({ target: [-3, 9], distance: 99, azimuth: -4, elevation: 0 });
  assert.deepEqual(wild, { target: [limits.target.x[0], limits.target.y[1]], distance: limits.distance[1], azimuth: limits.azimuth[0], elevation: limits.elevation[0] });
  const lost = clampReliefView({ target: [NaN, NaN], distance: NaN, azimuth: NaN, elevation: Infinity });
  assert.deepEqual(lost, clampReliefView(RELIEF_VIEWS.overview));
  const from = RELIEF_VIEWS.overview, to = RELIEF_VIEWS.korvenia;
  assert.deepEqual(blendReliefViews(from, to, 0), { ...from, target: [...from.target] });
  assert.deepEqual(blendReliefViews(from, to, 1), { ...to, target: [...to.target] });
  assert.ok(Math.abs(blendReliefViews(from, to, 0.5).distance - Math.sqrt(from.distance * to.distance)) < 1e-12);
  assert.deepEqual(blendReliefViews(from, to, NaN), blendReliefViews(from, to, 1), "an unknown amount lands on the destination");
  const out = blendReliefViews(from, to, 0.3);
  assert.equal(blendReliefViews(from, to, 0.6, out), out, "blending writes in place");
});

test("living details sit where the painting shows them", () => {
  const { eclipse, embers, mist, water } = RELIEF_DETAILS;
  assert.ok(eclipse.at[0] < 0.2 && eclipse.at[1] < 0.15 && eclipse.radius > 0.02);
  assert.ok(eclipse.light[0] < 0.3 && eclipse.light[1] < 0.3 && eclipse.lift > 0.08, "the violet light hangs over Korvenia");
  assert.ok(embers.length >= 8 && embers.every(({ at }) => at[0] > 0.5 && at[1] > 0.45), "embers stay in Solforiz");
  assert.ok(Math.hypot(mist[0].at[0] - 0.5, mist[0].at[1] - 0.5) < 0.05, "the first mist bank fills the centre");
  assert.equal(water.seas.length, RELIEF_LANDFORMS.filter((form) => form.kind === "sea").length);
  assert.ok(water.rivers.length > 0 && water.pools.length > 0 && water.falls.length > 0);
  for (const anchor of [eclipse.at, eclipse.light, ...eclipse.fires.map((fire) => fire.at), ...mist.map((bank) => bank.at), ...embers.map((glow) => glow.at)]) {
    assert.ok(anchor[0] >= 0 && anchor[0] <= 1 && anchor[1] >= 0 && anchor[1] <= 1);
  }
  assert.ok(RELIEF_MARKER.radius >= 0.06 && RELIEF_MARKER.ring * 2 >= 0.06);
});

test("the relief module stays pure", async () => {
  const source = await readFile(new URL("./relief.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import[^;]*from "([^"]+)";/gm)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["../content", "../types"]);
  for (const token of ["three", "@iwsdk", "react", "window.", "document.", "Math.random", "performance.", "Date."]) {
    assert.ok(!source.includes(token), `relief.ts mentions ${token}`);
  }
});
