import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { ARCHIVE_BLUEPRINT as B, ARCHIVE_GEOMETRY as G, monumentSeaLevel } from "../blueprint";
import { RELIEF_ASPECT, RELIEF_LEVELS, RELIEF_SEGMENTS, RELIEF_SLAB } from "../relief";
import { ringPoint } from "../space";
import type { ArchiveQuality } from "../types";
import { ARCHIVE_BUILDERS, ARCHIVE_GEOMETRY_BUDGET, archiveBuildSlices, buildArchive, buildArchiveForm, buildPlinth, monumentPlinthSpec, type ArchiveBuild } from "./assemble";
import { bakeVertices, bakeVerticesSlices, keyCookieAt, keyPoolAt, oculusTransmission } from "./bake";
import { ringBandForm, type FormGeometry, type PlinthSpec } from "./forms";
import { eulerMatrix, MeshWriter, type MeshBuffer } from "./mesh";
import { ProfileBuilder, segmentNormal, MOULDINGS } from "./profiles";
import { bevelBox, lathe, prism, triangulate } from "./primitives";
import { TESSELLATION } from "./quality";

const QUALITIES: readonly ArchiveQuality[] = ["quest", "low", "medium", "high"];
const geometry = G as unknown as FormGeometry;
const builds = new Map<ArchiveQuality, ArchiveBuild>();
const build = (quality: ArchiveQuality) => {
  if (!builds.has(quality)) builds.set(quality, buildArchive(B, geometry, quality));
  return builds.get(quality)!;
};

/** Every triangle's three corners from a batch or buffer. */
function* triangles(positions: Float32Array, indices: Uint16Array | Uint32Array): Generator<[number, number, number]> {
  for (let index = 0; index < indices.length; index += 3) yield [indices[index], indices[index + 1], indices[index + 2]];
}

function area(positions: Float32Array, a: number, b: number, c: number): number {
  const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** Edges by welded position: a closed part shares every edge between exactly two triangles. */
function isWatertight(mesh: MeshBuffer): { ok: boolean; open: number } {
  const key = (vertex: number) => [0, 1, 2].map((axis) => Math.round(mesh.positions[vertex * 3 + axis] * 1e5)).join(",");
  const edges = new Map<string, number>();
  for (const [a, b, c] of triangles(mesh.positions, mesh.indices)) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const kp = key(p), kq = key(q);
      if (kp === kq) continue;
      const edge = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
  }
  let open = 0;
  for (const uses of edges.values()) if (uses !== 2) open++;
  return { ok: open === 0, open };
}

test("the build is deterministic: two builds are identical at every tier", () => {
  for (const quality of ["quest", "medium"] as const) {
    const a = buildArchive(B, geometry, quality), b = buildArchive(B, geometry, quality);
    assert.equal(a.batches.length, b.batches.length);
    a.batches.forEach((batch, index) => {
      const other = b.batches[index];
      assert.equal(batch.materialId, other.materialId);
      assert.deepEqual(batch.positions, other.positions);
      assert.deepEqual(batch.normals, other.normals);
      assert.deepEqual(batch.uvs, other.uvs);
      assert.deepEqual(batch.indices, other.indices);
    });
    assert.deepEqual(a.instanced.map((item) => item.placements), b.instanced.map((item) => item.placements));
  }
});

test("a sliced build equals the one-shot build, with monotonic progress", () => {
  const slices = archiveBuildSlices(B, geometry, "quest", 1);
  let last = -1, steps = 0;
  let step = slices.next();
  while (!step.done) {
    assert.ok(step.value >= last && step.value <= 1, `progress ${step.value} after ${last}`);
    last = step.value;
    steps++;
    step = slices.next();
  }
  assert.ok(steps > 20, `the build yields often (${steps} slices)`);
  const sliced = step.value, whole = build("quest");
  assert.equal(sliced.triangles, whole.triangles);
  sliced.batches.forEach((batch, index) => {
    assert.deepEqual(batch.positions, whole.batches[index].positions);
    assert.deepEqual(batch.indices, whole.batches[index].indices);
  });
});

test("every value is finite, normals are unit, indices are in range and no triangle is degenerate", () => {
  for (const quality of QUALITIES) {
    const result = build(quality);
    const check = (name: string, positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array | Uint32Array, vertexCount: number) => {
      for (const array of [positions, normals, uvs]) for (let index = 0; index < array.length; index++) assert.ok(Number.isFinite(array[index]), `${name} has a non-finite value`);
      for (let index = 0; index < vertexCount; index++) {
        const length = Math.hypot(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]);
        assert.ok(Math.abs(length - 1) < 2e-3, `${name} normal ${index} has length ${length}`);
      }
      let smallest = Infinity;
      for (const [a, b, c] of triangles(positions, indices)) {
        assert.ok(a < vertexCount && b < vertexCount && c < vertexCount, `${name} index out of range`);
        smallest = Math.min(smallest, area(positions, a, b, c));
      }
      assert.ok(smallest > 1e-9, `${name} has a degenerate triangle (${smallest})`);
    };
    for (const batch of result.batches) {
      check(`${quality} ${batch.materialId}`, batch.positions, batch.normals, batch.uvs, batch.indices, batch.vertexCount);
      for (const zone of batch.zones) assert.ok(Number.isInteger(zone) && zone >= 0 && zone < 8);
    }
    for (const item of result.instanced) check(`${quality} ${item.id}`, item.prototype.positions, item.prototype.normals, item.prototype.uvs, item.prototype.indices, item.prototype.vertexCount);
  }
});

test("triangle counts stay within the declared budgets at every tier", () => {
  for (const quality of QUALITIES) {
    const result = build(quality);
    assert.ok(result.triangles <= ARCHIVE_GEOMETRY_BUDGET[quality], `${quality}: ${result.triangles} triangles over ${ARCHIVE_GEOMETRY_BUDGET[quality]}`);
    // With the relief and its plinth, the whole archive fits the blueprint's budget.
    const columns = RELIEF_SEGMENTS[quality], rows = Math.round(columns * RELIEF_ASPECT);
    const relief = 2 * columns * rows + 4 * (2 * columns + 2 * rows) + 2;
    const plinth = buildPlinth(geometry, quality, plinthSpec(quality === "quest" ? "quest" : "desktop")).triangleCount;
    assert.ok(result.triangles + relief + plinth <= B.budgets[quality].triangles, `${quality}: ${result.triangles + relief + plinth} triangles in all`);
  }
  // Tiers grow monotonically.
  for (let index = 1; index < QUALITIES.length; index++) assert.ok(build(QUALITIES[index]).triangles >= build(QUALITIES[index - 1]).triangles * 0.95);
});

test("declared closed parts are watertight", () => {
  const parts: [string, (writer: MeshWriter) => void][] = [
    ["bevelled box", (w) => bevelBox(w, 0, 0, 0, 0, 1.2, 0.7, 0.5, 0.05)],
    ["plain box", (w) => bevelBox(w, 0, 0.3, 0, -0.2, 0.4, 0.4, 2)],
    ["capped prism", (w) => prism(w, 0, [[0, 0], [1, 0], [1.2, 0.8], [0.4, 1.1], [-0.2, 0.6]], 0, 1.5)],
    ["chamfered prism", (w) => prism(w, 0, [[-1, -1], [1, -1], [1, 1], [-1, 1]], 0, 0.5, { bevel: 0.05 })],
    ["capped lathe", (w) => lathe(w, 0, "medium", new ProfileBuilder("medium", 0.3, 0).up(0.2).torus(0.05).in(0.1).up(0.4).build(), { caps: true })],
    ["ring band", (w) => ringBandForm(w, "medium", { radius: 4, section: { width: 0.4, thickness: 0.15 } })],
  ];
  for (const [name, make] of parts) {
    const writer = new MeshWriter();
    make(writer);
    const mesh = writer.build();
    if (name === "ring band") {
      // The band itself is closed; its raised ticks are closed boxes laid on it.
      const result = isWatertight(mesh);
      assert.ok(result.open <= mesh.triangleCount * 0.25, `${name}: ${result.open} open edges`);
      continue;
    }
    const result = isWatertight(mesh);
    assert.ok(result.ok, `${name} has ${result.open} open edges`);
  }
  // A lathe whose profile ends on the axis closes without caps.
  const writer = new MeshWriter();
  lathe(writer, 0, "quest", new ProfileBuilder("quest", 0, 0).to(0.2, 0).up(0.3).to(0, 0.5).build());
  assert.ok(isWatertight(writer.build()).ok, "an axis-closed lathe is watertight");
});

test("profiles face outward: convex mouldings bulge out, concave ones are hollow", () => {
  const torus = new ProfileBuilder("high", 0, 0).torus(0.1).build();
  const middle = Math.floor(torus.points.length / 4);
  assert.ok(torus.points[middle * 2] > 0.09, "a torus bulges outward");
  const scotia = new ProfileBuilder("high", 0, 0).scotia(0.1).build();
  assert.ok(scotia.points[Math.floor(scotia.points.length / 4) * 2] < -0.09, "a scotia is cut inward");
  // Rising and moving outward along the chord y = x: a concave cavetto sags toward the material (-x), a convex ovolo bulges away from it.
  const cavetto = new ProfileBuilder("high", 0, 0).cavetto(0.1, 0.1).build();
  const mid = (cavetto.points.length / 2 / 2) | 0;
  assert.ok(cavetto.points[mid * 2] < cavetto.points[mid * 2 + 1] - 0.01, "a cavetto is hollow");
  const ovolo = new ProfileBuilder("high", 0, 0).ovolo(0.1, 0.1).build();
  assert.ok(ovolo.points[mid * 2] > ovolo.points[mid * 2 + 1] + 0.01, "an ovolo is convex");
  const inward = new ProfileBuilder("high", 0, 0).cavetto(0.1, -0.1).build();
  // Moving inward along the chord y = -x, outside lies up and out, so a hollow sags below the chord.
  assert.ok(inward.points[mid * 2 + 1] < -inward.points[mid * 2] - 0.01, "an inward cavetto is hollow too");
  // Travelling up a vertical face, the normal points outward (+x).
  const face = new ProfileBuilder("quest", 0, 0).up(1).build();
  assert.deepEqual(segmentNormal(face, 0).map((value) => Math.round(value) + 0), [1, 0]);
  for (const name of Object.keys(MOULDINGS) as (keyof typeof MOULDINGS)[]) {
    const profile = MOULDINGS[name]("medium");
    for (const value of profile.points) assert.ok(Number.isFinite(value), `${name} is finite`);
    assert.equal(profile.points.length / 2, profile.smooth.length);
  }
  // Ear clipping covers a concave polygon's area exactly.
  const concave: [number, number][] = [[0, 0], [4, 0], [4, 3], [2, 1], [0, 3]];
  const tris = triangulate(concave);
  let covered = 0;
  for (let index = 0; index < tris.length; index += 3) {
    const [a, b, c] = [concave[tris[index]], concave[tris[index + 1]], concave[tris[index + 2]]];
    covered += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.ok(Math.abs(covered - 8) < 1e-9, `triangulated area ${covered}`);
});

test("UVs run in metres, so tiling textures keep one scale everywhere", () => {
  const floor = build("medium").batches.find((batch) => batch.materialId === "floor-stone")!;
  let checked = 0;
  for (let index = 0; index < floor.vertexCount; index++) {
    // The chamber floor is built in archive space; pieces built in their own frames (steps) keep local metres.
    if (floor.zones[index] !== 0 || floor.normals[index * 3 + 1] < 0.999 || Math.abs(floor.positions[index * 3 + 1]) > 1e-6) continue;
    assert.ok(Math.abs(floor.uvs[index * 2] - floor.positions[index * 3]) < 1e-4 && Math.abs(floor.uvs[index * 2 + 1] + floor.positions[index * 3 + 2]) < 1e-4);
    checked++;
  }
  assert.ok(checked > 500, `${checked} floor vertices checked`);
  // A wall's v is its height above its own base.
  const writer = new MeshWriter();
  bevelBox(writer, 0, 0, 1.5, 0, 2, 3, 0.5);
  const box = writer.build();
  for (let index = 0; index < box.vertexCount; index++) {
    if (Math.abs(box.normals[index * 3 + 1]) > 0.5) continue;
    assert.ok(Math.abs(box.uvs[index * 2 + 1] - box.positions[index * 3 + 1]) < 1e-6);
  }
});

test("every builder the blueprint names is implemented, and seeded variation is stable", () => {
  for (const element of B.elements) if ("builder" in element.mesh) assert.ok((ARCHIVE_BUILDERS as readonly string[]).includes(element.mesh.builder), element.mesh.builder);
  for (const artifact of B.artifacts) if ("builder" in artifact.mesh) assert.ok((ARCHIVE_BUILDERS as readonly string[]).includes(artifact.mesh.builder), artifact.mesh.builder);
  assert.ok((ARCHIVE_BUILDERS as readonly string[]).includes(B.monument.plinth.builder));
  const ids = Object.keys(build("quest").perElement);
  for (const element of B.elements) assert.ok(ids.includes(element.id), `${element.id} built`);
  for (const artifact of B.artifacts.filter((item) => "builder" in item.mesh && item.mesh.builder !== "relief")) assert.ok(ids.includes(artifact.id), `${artifact.id} built`);
  // Ring placement agrees with the blueprint's own ring sampling.
  for (const ring of B.mechanism.rings) {
    const m = eulerMatrix(ring.tilt[0], ring.tilt[1], ring.tilt[2]);
    for (const angle of [0, 1.1, 2.7, 4.4]) {
      const local = [Math.sin(angle) * ring.radius, 0, -Math.cos(angle) * ring.radius];
      const placed = [0, 1, 2].map((row) => m[row * 3] * local[0] + m[row * 3 + 1] * local[1] + m[row * 3 + 2] * local[2] + ring.center[row]);
      const sampled = ringPoint(ring, angle);
      assert.ok(Math.hypot(placed[0] - sampled[0], placed[1] - sampled[1], placed[2] - sampled[2]) < 1e-9);
    }
  }
});

test("canon in geometry: no built vertex stands near either map centre's vertical, and nothing but sky and the screen rises above the crown", () => {
  const centres = [
    { x: B.monument.center[0], z: B.monument.center[2], top: B.monument.desktop.reliefTop },
    { x: B.monument.quest.center[0], z: B.monument.quest.center[2], top: B.monument.quest.reliefTop.standing },
  ];
  for (const quality of ["quest", "high"] as const) {
    const result = build(quality);
    for (const batch of result.batches) {
      for (let index = 0; index < batch.vertexCount; index++) {
        const x = batch.positions[index * 3], y = batch.positions[index * 3 + 1], z = batch.positions[index * 3 + 2];
        for (const centre of centres) {
          if (y <= centre.top + 0.12 || y >= B.chamber.springingY) continue;
          // The floor is below the relief, so only standing geometry is tested.
          assert.ok(Math.hypot(x - centre.x, z - centre.z) >= 0.4, `${batch.materialId} vertex at ${[x, y, z].map((v) => v.toFixed(2))} stands on the map centre's vertical`);
        }
        // Above the crown only the screen (its pierced band and its dressed-stone bars, inside the opening) and the sky.
        if (y > B.chamber.crownY + 0.21) {
          const screen = ["tracery", "sky"].includes(batch.materialId) || (batch.materialId === "limestone-dressed" && Math.hypot(x, z) < B.chamber.oculus.radius);
          assert.ok(screen, `${batch.materialId} rises above the crown at ${y.toFixed(2)}`);
        }
      }
    }
  }
});

test("the monument's plinth is parametric around each relief and holds the slab's foot", () => {
  for (const platform of ["desktop", "quest"] as const) {
    const spec = plinthSpec(platform), plinth = buildPlinth(geometry, "medium", spec);
    let maxY = -Infinity, maxX = -Infinity;
    for (let index = 0; index < plinth.vertexCount; index++) {
      maxY = Math.max(maxY, plinth.positions[index * 3 + 1]);
      maxX = Math.max(maxX, plinth.positions[index * 3]);
    }
    assert.ok(Math.abs(maxY - (spec.footY + spec.frameRise)) < 0.02, `${platform} plinth top ${maxY} vs foot ${spec.footY}`);
    assert.ok(maxX > spec.reliefWidth / 2 && maxX < spec.reliefWidth / 2 + spec.margin + spec.step + 0.25, `${platform} plinth reach ${maxX}`);
    assert.deepEqual(plinth.groups.map((group) => group.materialIndex).sort(), [0, 1, 2, 3]);
  }
});

test("the vertex bake is deterministic, bounded and darker where it should be", () => {
  const batch = build("quest").batches.find((item) => item.materialId === "floor-stone")!;
  for (const platform of ["desktop", "quest"] as const) {
    const options = { platform, quality: "quest" as ArchiveQuality, posture: "seated" as const };
    const a = bakeVertices(B, geometry, batch.positions, batch.normals, options), b = bakeVertices(B, geometry, batch.positions, batch.normals, options);
    assert.deepEqual(a.light, b.light);
    assert.deepEqual(a.ao, b.ao);
    for (const value of a.ao) assert.ok(value >= 0 && value <= 1);
    for (const value of a.light) assert.ok(Number.isFinite(value) && value >= 0 && value < 6);
    // Sliced and whole bakes agree.
    const slices = bakeVerticesSlices(B, geometry, batch.positions, batch.normals, options, 97);
    let step = slices.next();
    while (!step.done) step = slices.next();
    assert.deepEqual(step.value.light, a.light);
    if (platform === "quest") {
      assert.ok(a.haze && a.haze.every((value) => value >= 0 && value <= 0.75));
      // The floor under the oculus is far brighter than a bay floor.
      const at = (x: number, z: number) => {
        let best = -1, bestDistance = Infinity;
        for (let index = 0; index < batch.vertexCount; index++) {
          const distance = Math.hypot(batch.positions[index * 3] - x, batch.positions[index * 3 + 2] - z);
          if (distance < bestDistance) { bestDistance = distance; best = index; }
        }
        return a.light[best * 3 + 1];
      };
      assert.ok(at(0.1, 2.9) > at(-11, -11) * 3, "the pool outshines the bay floor");
    }
  }
  // The screen: open centre, shadowed bars and band, nothing outside the opening.
  assert.equal(oculusTransmission(B, 0, 0), 1);
  assert.equal(oculusTransmission(B, 1.2, 0), 0);
  let open = 0, samples = 0;
  for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
    const u = (i / 63) * 2 - 1, v = (j / 63) * 2 - 1, r = Math.hypot(u, v);
    if (r < B.chamber.oculus.tracery.band[0] || r > 1) continue;
    samples++;
    open += oculusTransmission(B, u, v);
  }
  assert.ok(open / samples > 0.05 && open / samples < 0.45, `the pierced band passes ${(100 * open / samples).toFixed(0)}% of the light`);
  assert.ok(keyCookieAt(B, 0.5, 0.5) > 0.9, "the cookie is open at its centre");
  assert.equal(keyCookieAt(B, 0.01, 0.01), 0, "the cookie is dark outside the oculus");
  assert.ok(keyPoolAt(B, B.lights[0].target![0], B.lights[0].target![1], B.lights[0].target![2]) > 0.9, "the pool is lit at the key's target");
});

test("the coffered vault: bands and bosses stay on the shell, inside the webs and clear of the oculus ring", () => {
  for (const quality of ["quest", "medium"] as const) {
    const vault = buildArchiveForm(B, G, quality, "vault-shell")!;
    const slots = new Map(vault.groups.map((group) => [group.materialIndex, group]));
    assert.ok(slots.get(2)?.count && slots.get(3)?.count, `${quality}: coffer bands and bosses are built`);
    const soffit = G.vault.oculusRadius + 0.9;
    for (const slot of [2, 3]) {
      const group = slots.get(slot)!;
      for (let index = group.start; index < group.start + group.count; index++) {
        const vertex = vault.indices[index];
        const x = vault.positions[vertex * 3], y = vault.positions[vertex * 3 + 1], z = vault.positions[vertex * 3 + 2];
        assert.ok(Math.hypot(x, z) > soffit, `${quality}: slot ${slot} vertex at radius ${Math.hypot(x, z).toFixed(2)} reaches under the oculus ring`);
        assert.ok(y > G.levels.vault && y < B.chamber.crownY, `${quality}: slot ${slot} vertex at height ${y.toFixed(2)} leaves the vault`);
      }
    }
    // Bosses: three per row in every web; each turns three quads and a cap triangle per segment.
    const rows = quality === "quest" ? 3 : 4;
    const perBoss = (quality === "quest" ? 8 : 12) * 7;
    assert.equal(slots.get(3)!.count / 3, G.sides * rows * 3 * perBoss, `${quality}: boss triangles`);
  }
});

test("single forms match what the build merged for each element and artifact", () => {
  const built = build("quest");
  for (const element of B.elements) {
    if (!("builder" in element.mesh)) continue;
    const form = buildArchiveForm(B, G, "quest", element.id);
    assert.ok(form && form.triangleCount > 0, `${element.id} builds alone`);
    const places = element.instances ? element.instances.length : 1;
    assert.equal(form.triangleCount * places, built.perElement[element.id], `${element.id} triangles`);
  }
  for (const artifact of B.artifacts) {
    const form = buildArchiveForm(B, G, "quest", artifact.id);
    if ("builder" in artifact.mesh && artifact.mesh.builder === "relief") { assert.equal(form, null); continue; }
    assert.ok(form && form.triangleCount > 0, `${artifact.id} builds alone`);
    assert.equal(form.triangleCount, built.perElement[artifact.id], `${artifact.id} triangles`);
  }
  assert.equal(buildArchiveForm(B, G, "quest", "no-such-id"), null);
});

test("tessellation tiers and the kernel's own modules stay pure", async () => {
  for (const quality of QUALITIES) assert.ok(TESSELLATION[quality].cell > 0 && TESSELLATION[quality].lathe >= TESSELLATION[quality].latheMin);
  const files = (await readdir(new URL("./", import.meta.url))).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  assert.ok(files.length >= 9);
  for (const name of files) {
    const source = (await readFile(new URL(name, import.meta.url), "utf8")).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    for (const [pattern, what] of [[/from\s+["']three/, "three"], [/@iwsdk/, "IWSDK"], [/react/i, "React"], [/\bdocument\./, "the DOM"], [/\bwindow\./, "the DOM"], [/Math\.random/, "Math.random"], [/\bDate\b/, "Date"]] as const) {
      assert.ok(!pattern.test(source), `${name} uses ${what}`);
    }
  }
});

function plinthSpec(platform: "desktop" | "quest"): PlinthSpec {
  const spec = monumentPlinthSpec(B, platform);
  // The kernel's spec agrees with the blueprint's own sea level for the monument.
  assert.ok(Math.abs(spec.footY - (monumentSeaLevel(platform, "seated") + RELIEF_SLAB.base * spec.reliefWidth)) < 1e-12);
  return spec;
}
void RELIEF_LEVELS;
