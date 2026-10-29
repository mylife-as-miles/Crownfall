// Environment pipeline tests: the Korvenia build at every quality is deterministic,
// within the platform budgets, publishes the four landmarks, gates development by
// hall tier, and the state adapter shows exactly what the scene state says.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { LEGACY_LANDMARKS } from "../environment-contract";
import {
  atlasHeraldryFor, buildBannerhold, createDefaultRegistry, DEVELOPMENT_FIXTURE_CAPTION, ENVIRONMENT_FIXTURE_IDS,
  environmentFixture, estimateBudget, fillHeraldryAtlas, gateVisible, HERALDRY_ATLAS_SIZE, atlasTile, PLATFORM_BUDGETS,
  resolveSceneSlots, slotCapacities, TEXTURE_SETS, generateTextureFields, finishTexture,
} from "../environment";
import type { EnvironmentBuild } from "../environment";
import { getBannerholdBlueprint } from "../environment/blueprint";
import { MeshBuilder } from "../environment/kernel";
import { buildFlight } from "../environment/kits/settlement/routes";

const bp = getBannerholdBlueprint("korvenia");
const builds = new Map<string, EnvironmentBuild>();
function get(q: "desktop-low" | "desktop-medium" | "desktop-high" | "quest"): EnvironmentBuild {
  let b = builds.get(q);
  if (!b) {
    b = buildBannerhold({ state: environmentFixture("founded"), quality: q });
    builds.set(q, b);
  }
  return b;
}

function digest(b: EnvironmentBuild): string {
  const h = createHash("sha256");
  for (const m of b.meshes) {
    h.update(m.name);
    h.update(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
    h.update(Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
    if (m.colors) h.update(Buffer.from(m.colors.buffer, m.colors.byteOffset, m.colors.byteLength));
  }
  for (const s of b.instances) h.update(Buffer.from(s.transforms.buffer, s.transforms.byteOffset, s.transforms.byteLength));
  return h.digest("hex");
}

test("the build is deterministic (byte-identical buffers)", () => {
  const a = buildBannerhold({ state: environmentFixture("founded"), quality: "desktop-low" });
  const c = buildBannerhold({ state: environmentFixture("founded"), quality: "desktop-low" });
  assert.equal(digest(a), digest(c));
});

test("every quality profile stays within its platform budget", () => {
  for (const q of ["desktop-low", "desktop-medium", "desktop-high", "quest"] as const) {
    const b = get(q);
    const est = estimateBudget(b);
    const budget = PLATFORM_BUDGETS[q];
    // The shadow pass redraws casters; the sky and smoke add a few more draws.
    const draws = est.drawCalls + (b.quality.shadows.enabled ? est.shadowCasterDraws : 0) + 6;
    assert.ok(draws <= budget.drawCalls, `${q}: ${draws} draws including shadows`);
    assert.ok(est.triangles <= budget.triangles, `${q}: ${est.triangles} triangles`);
  }
});

test("buffers are valid typed arrays with unit normals", () => {
  const b = get("desktop-low");
  for (const m of b.meshes) {
    const n = m.positions.length / 3;
    assert.ok(m.positions instanceof Float32Array && m.indices instanceof Uint32Array);
    assert.equal(m.normals.length, n * 3);
    for (let i = 0; i < m.indices.length; i += 97) assert.ok(m.indices[i] < n);
    for (let i = 0; i < n; i += 31) {
      const l = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3);
    }
  }
  for (const s of b.instances) assert.equal(s.transforms.length, s.count * 16);
});

test("the four landmarks are published with pickable geometry and blueprint anchors", () => {
  const b = get("desktop-medium");
  assert.deepEqual(b.landmarks.map((l) => l.id), LEGACY_LANDMARKS.slice());
  for (const l of b.landmarks) {
    const anchor = bp.landmarks.find((x) => x.id === l.id);
    assert.ok(anchor);
    assert.deepEqual(l.anchor, anchor.anchor);
    assert.ok(b.meshes.some((m) => m.landmark === l.id), `${l.id} has no meshes`);
    assert.ok(b.colliders.some((c) => c.landmark === l.id) || l.pickRadius > 0);
  }
  for (const id of ["establishing", "landmark:banner-hall", "landmark:muster-grounds", "landmark:war-record", "landmark:heralds-station", "representative"]) {
    assert.ok(b.staging.cameras.some((c) => c.id === id), `missing framing ${id}`);
  }
});

test("development appears by hall tier and the unfinished range completes", () => {
  const b = get("desktop-medium");
  const caps = slotCapacities(bp);
  const tier = (t: 0 | 1 | 2 | 3) => resolveSceneSlots({ ...environmentFixture("founded"), hallTier: t }, caps);
  const gallery = b.meshes.filter((m) => m.gate?.minHallTier === 2);
  const unfinished = b.meshes.filter((m) => m.gate?.maxHallTier === 0);
  const completed = b.meshes.filter((m) => m.gate?.minHallTier === 1);
  assert.ok(gallery.length > 0 && unfinished.length > 0 && completed.length > 0);
  for (const m of unfinished) assert.ok(gateVisible(m.gate, tier(0)) && !gateVisible(m.gate, tier(1)));
  for (const m of completed) assert.ok(!gateVisible(m.gate, tier(0)) && gateVisible(m.gate, tier(1)));
  for (const m of gallery) assert.ok(!gateVisible(m.gate, tier(1)) && gateVisible(m.gate, tier(2)));
});

test("the state adapter shows only what the scene state says", () => {
  const caps = slotCapacities(bp);
  const un = resolveSceneSlots(environmentFixture("unfounded"), caps);
  assert.equal(un.pawn, 0);
  assert.equal(un.levy, 0);
  assert.equal(un.flags.has("founded"), false);
  const f = resolveSceneSlots(environmentFixture("founded"), caps);
  assert.equal(f.pawn, 1);
  assert.equal(f.injured, 0);
  assert.equal(f.levy, 2);
  assert.ok(f.flags.has("rival-challenge") && f.flags.has("allied-house"));
  assert.equal(f.recordMarkers.length, 0);
  const inj = resolveSceneSlots(environmentFixture("injured"), caps);
  assert.equal(inj.pawn, 0);
  assert.equal(inj.injured, 1);
  const cap = resolveSceneSlots(environmentFixture("captive"), caps);
  assert.equal(cap.pawn, 0);
  assert.ok(cap.flags.has("representative-captive"));
  assert.deepEqual(cap.recordMarkers, ["defeat"]);
  const rec = resolveSceneSlots(environmentFixture("recognised"), caps);
  assert.equal(rec.hallTier, 2);
  assert.equal(rec.honours, 3);
  assert.deepEqual(rec.recordMarkers, ["victory", "victory", "draw", "victory"]);
  assert.equal(resolveSceneSlots(null, caps).pawn, 0);
});

test("captive markers and rival correspondence are flag-gated, never fixed in the scene", () => {
  const b = get("desktop-medium");
  const flagged = b.meshes.filter((m) => m.gate?.flag);
  assert.ok(flagged.some((m) => m.gate?.flag === "representative-captive"));
  assert.ok(flagged.some((m) => m.gate?.flag === "rival-challenge"));
  const slotSets = b.instances.filter((s) => s.name.startsWith("slot:"));
  assert.ok(slotSets.length >= 6);
});

test("fixtures are labelled previews and never production", () => {
  assert.ok(/Development fixture/.test(DEVELOPMENT_FIXTURE_CAPTION));
  for (const id of ENVIRONMENT_FIXTURE_IDS) {
    const s = environmentFixture(id);
    assert.equal(s.mode, "preview");
    assert.ok(s.previewId && s.previewId.startsWith("environment-fixture:"));
  }
});

test("heraldry atlas fills banner tiles deterministically", () => {
  const a = new Uint8ClampedArray(HERALDRY_ATLAS_SIZE.width * HERALDRY_ATLAS_SIZE.height * 4);
  const c = new Uint8ClampedArray(a.length);
  fillHeraldryAtlas(a, atlasHeraldryFor(environmentFixture("founded"), bp.atmosphere));
  fillHeraldryAtlas(c, atlasHeraldryFor(environmentFixture("founded"), bp.atmosphere));
  assert.deepEqual(Array.from(a.subarray(0, 4096)), Array.from(c.subarray(0, 4096)));
  const t = atlasTile("player", "banner");
  const mid = ((t.y + t.h / 2) * HERALDRY_ATLAS_SIZE.width + t.x + t.w / 2) * 4;
  assert.equal(a[mid + 3], 255);
});

test("kit registry resolves blueprint kit ids to landmark kits or the architecture kit", () => {
  const r = createDefaultRegistry();
  assert.equal(r.resolvedKey("kv.manor.banner-hall"), "kv.manor.banner-hall");
  assert.equal(r.resolvedKey("kv.record.archive"), "kv.record.archive");
  assert.equal(r.resolvedKey("kv.house.jettied-tall"), "architecture");
  // Korvenia's Gothic landmark kits never build another nation's archive.
  assert.equal(r.resolvedKey("sf.record.archive"), "architecture");
});

test("texture generators are deterministic at small sizes", () => {
  for (const recipe of TEXTURE_SETS) {
    const a = finishTexture(generateTextureFields(recipe, 32));
    const b = finishTexture(generateTextureFields(recipe, 32));
    assert.deepEqual(Array.from(a.albedo), Array.from(b.albedo), recipe.id);
    assert.ok(a.meanLuminance > 0 && a.meanLuminance < 1);
  }
});

test("stair flights are single solids whose sides share every tread corner", () => {
  const b = new MeshBuilder();
  b.part("test").material("stone");
  const zs = [0, 0.3, 0.6, 0.9, 1.2, 1.5];
  const h = [0.19, 0.38, 0.57, 0.76, 0.95];
  const bot = [-0.5, -0.52, -0.55, -0.5, -0.47, -0.45];
  buildFlight(b, zs, h, bot, 0.8, true);
  const [m] = b.finish();
  const key = (z: number, y: number): string => `${z.toFixed(4)}|${y.toFixed(4)}`;
  const side = new Set<string>();
  let area = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    if (!v.every((i) => m.normals[i * 3] < -0.999)) continue;
    const p = v.map((i) => [m.positions[i * 3 + 2], m.positions[i * 3 + 1]] as const);
    for (const q of p) side.add(key(q[0], q[1]));
    // Front faces on -X wind counter-clockwise with z to the right: positive (z, y) area.
    const a2 = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    assert.ok(a2 >= -1e-9, "side triangles face outward");
    area += a2 / 2;
  }
  // The side polygon covers exactly the stepped profile above the sloped bottom.
  let expected = 0;
  for (let s = 0; s < h.length; s++) expected += (zs[s + 1] - zs[s]) * (h[s] - (bot[s] + bot[s + 1]) / 2);
  assert.ok(Math.abs(area - expected) < 1e-6, `side area ${area} vs ${expected}`);
  // Every tread corner is a vertex of the side, so no tread edge ends on a side face (no T-junctions).
  for (let s = 0; s < h.length; s++) {
    assert.ok(side.has(key(zs[s], h[s])) && side.has(key(zs[s + 1], h[s])), `tread ${s} corners on the side`);
  }
});
