// Landmark package tests (Korvenia): the Banner Hall, Muster Grounds, War Record and
// Herald's Station kits honour the blueprint masses, keep the state slots visible and
// supported, gate hall-tier development correctly, stay within the platform budgets with a
// Quest representation of every asset, and build deterministic, valid geometry.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { buildBannerhold, createDefaultRegistry, createMaterialLibrary, environmentFixture, estimateBudget, gateVisible, MeshBuilder, nationStyle, PLATFORM_BUDGETS, qualityProfile, resolveSceneSlots, slotCapacities } from "../environment";
import type { EnvironmentBuild, EnvironmentQuality, MeshBuffer } from "../environment";
import { createTerrainSampler, getBannerholdBlueprint, resolveBuildingBase } from "../environment/blueprint";
import { buildTerrainField, createKitContext } from "../environment/kits/context";
import { createFarField } from "../environment/kits/landscape/terrain";
import { buildFigure } from "../environment/kits/figures/figure";
import { faceWall, quadSafe } from "../environment/kits/landmarks/gothic";
import { fileGlyph } from "../environment/kits/landmarks/muster-grounds";

const bp = getBannerholdBlueprint("korvenia");
const LANDMARK_KITS = [
  "kv.manor.banner-hall", "kv.manor.lodging", "kv.manor.west-range", "kv.fort.court-gate", "kv.muster.dais", "kv.muster.armoury",
  "kv.muster.levy-hall", "kv.record.archive", "kv.record.gallery", "kv.herald.station", "kv.fort.gatehouse",
];
const PROFILES: readonly EnvironmentQuality[] = ["desktop-low", "desktop-medium", "desktop-high", "quest"];

const builds = new Map<string, EnvironmentBuild>();
function build(q: EnvironmentQuality, fixture: "founded" | "recognised" = "founded"): EnvironmentBuild {
  const key = `${q}:${fixture}`;
  let b = builds.get(key);
  if (!b) {
    b = buildBannerhold({ state: environmentFixture(fixture), quality: q });
    builds.set(key, b);
  }
  return b;
}

/** Builds one building through its registered kit in isolation (fresh context). */
function isolated(buildingId: string, q: EnvironmentQuality = "desktop-medium"): { meshes: MeshBuffer[]; colliders: ReturnType<typeof createKitContext>["colliders"] } {
  const terrain = createTerrainSampler(bp.terrain);
  const field = buildTerrainField(terrain, 1);
  const ctx = createKitContext({ bp, quality: qualityProfile(q), style: nationStyle("korvenia"), terrain, field, lib: createMaterialLibrary("korvenia"), far: createFarField(bp, terrain) });
  const building = bp.buildings.find((x) => x.id === buildingId);
  assert.ok(building, buildingId);
  const lm = bp.landmarks.find((l) => l.buildingIds.indexOf(buildingId) >= 0);
  createDefaultRegistry().buildingKit(building.kit)(ctx, lm && !building.landmark ? { ...building, landmark: lm.id } : building);
  return { meshes: ctx.b.finish(), colliders: ctx.colliders };
}

function landmarkMeshes(b: EnvironmentBuild): MeshBuffer[] {
  return b.meshes.filter((m) => m.part.startsWith("landmark:"));
}

/** Möller–Trumbore: distance along the ray to the first triangle of the meshes, or Infinity. */
function rayHit(meshes: readonly MeshBuffer[], o: readonly number[], d: readonly number[], maxT: number): number {
  let best = Infinity;
  for (const m of meshes) {
    const bb = m.bounds;
    const lo = [Math.min(o[0], o[0] + d[0] * maxT), Math.min(o[1], o[1] + d[1] * maxT), Math.min(o[2], o[2] + d[2] * maxT)];
    const hi = [Math.max(o[0], o[0] + d[0] * maxT), Math.max(o[1], o[1] + d[1] * maxT), Math.max(o[2], o[2] + d[2] * maxT)];
    if (bb.max[0] < lo[0] || bb.min[0] > hi[0] || bb.max[1] < lo[1] || bb.min[1] > hi[1] || bb.max[2] < lo[2] || bb.min[2] > hi[2]) continue;
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1e-4 && dist < best && dist <= maxT) best = dist;
    }
  }
  return best;
}

function facing(yawDeg: number): [number, number, number] {
  const a = (yawDeg * Math.PI) / 180;
  return [Math.sin(a), 0, Math.cos(a)];
}

test("every Korvenia landmark building is built by an authored landmark kit", () => {
  const r = createDefaultRegistry();
  for (const id of LANDMARK_KITS) assert.equal(r.resolvedKey(id), id, id);
  for (const l of bp.landmarks) {
    for (const bid of l.buildingIds) {
      const bld = bp.buildings.find((x) => x.id === bid);
      assert.ok(bld && r.resolvedKey(bld.kit) !== "architecture", `${l.id}: ${bid} uses an authored kit`);
    }
  }
  // Gothic landmark kits never build another nation's buildings.
  assert.equal(r.resolvedKey("sf.manor.banner-hall"), "architecture");
  assert.equal(r.resolvedKey("kw.record.archive"), "architecture");
});

test("landmark masses keep the blueprint footprints and heights (colliders and geometry)", () => {
  const terrain = createTerrainSampler(bp.terrain);
  const ids = new Set<string>();
  for (const l of bp.landmarks) for (const id of l.buildingIds) ids.add(id);
  for (const id of ["kv-court-gatehouse", "kv-record-gallery"]) ids.add(id);
  for (const id of ids) {
    const bld = bp.buildings.find((x) => x.id === id);
    assert.ok(bld);
    const { meshes, colliders } = isolated(id);
    assert.ok(meshes.length > 0, `${id} builds geometry`);
    const base = resolveBuildingBase(terrain, bld);
    for (const mass of bld.masses) {
      if (mass.role === "chimney") continue;
      const y0 = base.floorY + (mass.baseOffset ?? 0);
      const match = colliders.find((c) => Math.abs(c.center[0] - mass.center[0]) < 0.05 && Math.abs(c.center[2] - mass.center[1]) < 0.05 && Math.abs(c.halfExtents[0] - (mass.width / 2 + 0.3)) < 0.05 && Math.abs(c.halfExtents[2] - (mass.depth / 2 + 0.3)) < 0.05);
      assert.ok(match, `${id}/${mass.id}: collider on the blueprint footprint`);
      // Geometry inside the footprint never rises above the ridge plus finial allowance, and the walls reach the eave.
      const shrink = 0.6;
      const c = Math.cos((mass.rotationDeg * Math.PI) / 180), s = Math.sin((mass.rotationDeg * Math.PI) / 180);
      const within = (mm: typeof mass, x: number, z: number, grow: number): boolean => {
        const cc = Math.cos((mm.rotationDeg * Math.PI) / 180), ss = Math.sin((mm.rotationDeg * Math.PI) / 180);
        const dx = x - mm.center[0], dz = z - mm.center[1];
        const lx = dx * cc - dz * ss, lz = dx * ss + dz * cc;
        return (mm.plan ?? "rect") === "rect" ? Math.abs(lx) < mm.width / 2 + grow && Math.abs(lz) < mm.depth / 2 + grow : lx * lx + lz * lz < (mm.width / 2 + grow) ** 2;
      };
      let worst = 0;
      for (const m of meshes) {
        const P = m.positions;
        for (let i = 0; i < P.length; i += 3) {
          if (!within(mass, P[i], P[i + 2], -shrink)) continue;
          // Allowed height: the tallest mass of this building standing over the point, plus finials.
          let allowed = y0 + mass.ridgeHeight;
          for (const other of bld.masses) if (within(other, P[i], P[i + 2], 0.5)) allowed = Math.max(allowed, base.floorY + (other.baseOffset ?? 0) + other.ridgeHeight);
          worst = Math.max(worst, P[i + 1] - (allowed + 2.8));
        }
      }
      if (!bld.unfinished && mass.role !== "platform") {
        assert.ok(worst <= 0.01, `${id}/${mass.id}: geometry exceeds the blueprint ridge plus finial by ${worst.toFixed(2)} m`);
        // Surface height over the footprint (rays from above): the mass is built up to its eave.
        let surface = -Infinity;
        for (const fx of [-0.3, 0, 0.3]) {
          for (const fz of [-0.3, 0, 0.3]) {
            const lx = fx * mass.width, lz = fz * mass.depth;
            const x = mass.center[0] + lx * c + lz * s, z = mass.center[1] - lx * s + lz * c;
            const from = y0 + mass.ridgeHeight + 6;
            const hit = rayHit(meshes, [x, from, z], [0, -1, 0], mass.ridgeHeight + 12);
            if (Number.isFinite(hit)) surface = Math.max(surface, from - hit);
          }
        }
        assert.ok(surface >= y0 + mass.eaveHeight - 0.5, `${id}/${mass.id}: built up to its eave (${surface.toFixed(2)} vs ${(y0 + mass.eaveHeight).toFixed(2)})`);
      }
    }
  }
});

test("state slots stay visible and supported by the landmark architecture", () => {
  const b = build("desktop-medium");
  const lm = landmarkMeshes(b);
  const s = bp.slots;
  // Honour niches: recessed, open toward the court (nothing in front of the candle).
  for (const n of s.honourNiches) {
    const f = facing(n.yawDeg);
    const o = [n.position[0] + f[0] * 0.02, n.position[1] + 0.1, n.position[2] + f[2] * 0.02];
    assert.equal(rayHit(lm, o, f, 0.9), Infinity, `honour niche at ${n.position.join(",")} is open`);
    // ... and the niche has a back behind it within 0.4 m.
    assert.ok(rayHit(lm, o, [-f[0], 0, -f[2]], 0.45) < 0.45, `honour niche at ${n.position.join(",")} has a back`);
  }
  // Notices and the rival's letter hang on a board, with open air in front.
  for (const p of s.noticeBoard.concat([s.rivalCorrespondence])) {
    const f = facing(p.yawDeg);
    const o = [p.position[0], p.position[1] - 0.05, p.position[2]];
    assert.equal(rayHit(lm, [o[0] + f[0] * 0.06, o[1], o[2] + f[2] * 0.06], f, 0.8), Infinity, `notice at ${p.position.join(",")} is visible`);
    assert.ok(rayHit(lm, o, [-f[0], 0, -f[2]], 0.3) < 0.3, `notice at ${p.position.join(",")} hangs on a board`);
  }
  // Record markers stand on the war table.
  for (const p of s.recordMarkers) {
    const hit = rayHit(lm, [p.position[0], p.position[1] + 0.02, p.position[2]], [0, -1, 0], 0.08);
    assert.ok(hit < 0.05, `record marker at ${p.position.join(",")} rests on the table`);
    assert.equal(rayHit(lm, [p.position[0], p.position[1] + 0.03, p.position[2]], [0, 1, 0], 0.5), Infinity, "nothing above a record marker");
  }
  // The representative's stand is clear to head height; its surface supports the figure.
  const ps = bp.muster.pawnStand.position;
  assert.equal(rayHit(lm, [ps[0], ps[1] + 0.3, ps[2]], [0, 1, 0], 1.6), Infinity, "pawn stand is clear");
  assert.ok(rayHit(lm, [ps[0], ps[1] + 0.25, ps[2]], [0, -1, 0], 0.3) < 0.3, "pawn stand has a surface");
  // File stones stand at every file marker.
  for (const fm of bp.muster.fileMarkers) assert.ok(rayHit(lm, [fm.pose.position[0], fm.pose.position[1] + 2, fm.pose.position[2]], [0, -1, 0], 2) < 1.2, `file stone ${fm.file}`);
});

test("hall-tier development: unfinished range, completed range, gallery, lit braziers and pegged plots", () => {
  const b = build("desktop-medium");
  const caps = slotCapacities(bp);
  const at = (t: 0 | 1 | 2 | 3) => resolveSceneSlots({ ...environmentFixture("founded"), hallTier: t }, caps);
  const lm = landmarkMeshes(b);
  const unfinished = lm.filter((m) => m.gate?.maxHallTier === 0);
  const completed = lm.filter((m) => m.gate?.minHallTier === 1);
  const gallery = lm.filter((m) => m.gate?.minHallTier === 2);
  assert.ok(unfinished.length > 0 && completed.length > 0 && gallery.length > 0);
  for (const m of unfinished) assert.ok(gateVisible(m.gate, at(0)) && !gateVisible(m.gate, at(1)));
  for (const m of completed) assert.ok(!gateVisible(m.gate, at(0)) && gateVisible(m.gate, at(1)));
  for (const m of gallery) assert.ok(!gateVisible(m.gate, at(1)) && gateVisible(m.gate, at(2)));
  // Tier-1 braziers: their fire and light appear with the tier.
  assert.ok(b.fires.some((f) => f.gate?.minHallTier === 1) && b.lights.some((l) => l.gate?.minHallTier === 1), "tier-1 braziers");
  // The desktop light rig turns the first quality.maxLights lights (sorted by priority) into
  // point lights and does not read gates: no gated light may be among them, or it would shine
  // before its tier.
  for (const q of ["desktop-medium", "desktop-high"] as const) {
    const bq = build(q);
    for (const l of bq.lights.slice(0, bq.quality.maxLights)) assert.equal(l.gate, null, `${q}: gated light ${l.name} takes a point light`);
  }
  // Expansion plots are pegged out until the tier that develops them.
  for (const plot of bp.expansion.filter((e) => e.unlocksAtHallTier)) {
    if (plot.district !== "F" && plot.district !== "E") continue;
    const stakes = lm.filter((m) => m.gate?.maxHallTier === (plot.unlocksAtHallTier as number) - 1 && m.material === "timber-raw");
    assert.ok(stakes.length > 0, `${plot.id} pegged out`);
  }
});

test("budgets hold at every profile and hall tier with the landmark package", () => {
  for (const q of PROFILES) {
    for (const fixture of ["founded", "recognised"] as const) {
      const b = build(q, fixture);
      const est = estimateBudget(b);
      const budget = PLATFORM_BUDGETS[q];
      const draws = est.drawCalls + (b.quality.shadows.enabled ? est.shadowCasterDraws : 0) + 6;
      assert.ok(draws <= budget.drawCalls, `${q}/${fixture}: ${draws} draws`);
      assert.ok(est.triangles <= budget.triangles, `${q}/${fixture}: ${est.triangles} triangles`);
    }
  }
  // Worst case: every tier's development visible at once (tier 3) on the founded state.
  for (const q of PROFILES) {
    const b = buildBannerhold({ state: { ...environmentFixture("recognised"), hallTier: 3 }, quality: q });
    const est = estimateBudget(b);
    const draws = est.drawCalls + (b.quality.shadows.enabled ? est.shadowCasterDraws : 0) + 6;
    assert.ok(draws <= PLATFORM_BUDGETS[q].drawCalls, `${q}/tier 3: ${draws} draws`);
    assert.ok(est.triangles <= PLATFORM_BUDGETS[q].triangles, `${q}/tier 3: ${est.triangles} triangles`);
  }
});

test("every landmark has a lighter Quest representation", () => {
  const sum = (b: EnvironmentBuild, part: string): number => b.stats.trianglesByPart[part] ?? 0;
  const med = build("desktop-medium"), quest = build("quest");
  for (const id of ["banner-hall", "muster-grounds", "war-record", "heralds-station"]) {
    const part = `landmark:${id}`;
    assert.ok(sum(quest, part) > 0, `${id} exists on Quest`);
    assert.ok(sum(quest, part) < sum(med, part), `${id}: Quest ${sum(quest, part)} < desktop ${sum(med, part)}`);
  }
  const total = ["banner-hall", "muster-grounds", "war-record", "heralds-station"].reduce((t, id) => t + sum(quest, `landmark:${id}`), 0);
  assert.ok(total <= 40000, `landmarks on Quest: ${total} triangles`);
  // Interiors are desktop-only (the miniature never shows them).
  assert.ok(!quest.meshes.some((m) => m.part === "landmark:war-record" && m.material === "plaster-lime"), "no archive interior on Quest");
});

test("landmark geometry is valid, finite and deterministic", () => {
  for (const q of PROFILES) {
    const b = build(q);
    for (const m of landmarkMeshes(b)) {
      for (let i = 0; i < m.positions.length; i += 3) {
        assert.ok(Number.isFinite(m.positions[i]) && Number.isFinite(m.positions[i + 1]) && Number.isFinite(m.positions[i + 2]), `${q} ${m.name}: finite position`);
        const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
        assert.ok(Math.abs(l - 1) < 1e-3, `${q} ${m.name}: unit normal`);
      }
      for (let i = 0; i < m.indices.length; i++) assert.ok(m.indices[i] < m.positions.length / 3);
    }
  }
  const digest = (b: EnvironmentBuild): string => {
    const h = createHash("sha256");
    for (const m of landmarkMeshes(b)) {
      h.update(m.name);
      h.update(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
      h.update(Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
    }
    return h.digest("hex");
  };
  const a = buildBannerhold({ state: environmentFixture("founded"), quality: "desktop-high" });
  const c = buildBannerhold({ state: environmentFixture("founded"), quality: "desktop-high" });
  assert.equal(digest(a), digest(c));
});

test("landmarks reuse the build's material groups (draw calls)", () => {
  const b = build("desktop-medium");
  const key = (m: MeshBuffer) => `${m.material}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.motion ? JSON.stringify(m.motion) : "-"}|${m.gate ? JSON.stringify(m.gate) : "-"}`;
  const others = new Set(b.meshes.filter((m) => !m.part.startsWith("landmark:")).map(key));
  const own = new Set(landmarkMeshes(b).filter((m) => !m.gate).map(key).filter((k) => !others.has(k)));
  assert.ok(own.size <= 4, `ungated landmark-only groups: ${Array.from(own).join(", ")}`);
  const lib = createMaterialLibrary("korvenia");
  for (const m of landmarkMeshes(b)) assert.ok(lib.definitions.has(m.material), `${m.material} is a library material`);
});

test("wall faces cut every opening, including a door under a wider window", () => {
  const b = new MeshBuilder();
  b.part("test").material("wall");
  const L = 10, bottom = 0, top = 9;
  faceWall(b, {
    length: L, bottom, top: () => top,
    openings: [
      { u: 0, width: 1.4, sill: 0, height: 2.4, shape: "rect", depth: 0.4, fill: "door" },
      { u: 0, width: 3.0, sill: 4.0, height: 4.0, shape: "pointed", depth: 0.4, splay: 0.2, fill: "lit", tracery: "two-light" },
      { u: 3.4, width: 1.0, sill: 2.0, height: 3.0, shape: "lancet", depth: 0.3, fill: "dark" },
    ],
    mats: { wall: "wall", dressing: "dress", glassLit: "lit", glassDark: "dark", door: "door", boards: "boards", iron: "iron" },
    cell: 1.2, segments: 5, detail: 1,
  });
  const meshes = b.finish();
  const area = (mat: string): number => {
    let a = 0;
    for (const m of meshes.filter((x) => x.material === mat)) {
      const P = m.positions, I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const i = I[t] * 3, j = I[t + 1] * 3, k = I[t + 2] * 3;
        const ux = P[j] - P[i], uy = P[j + 1] - P[i + 1], vx = P[k] - P[i], vy = P[k + 1] - P[i + 1];
        a += (ux * vy - uy * vx) / 2;
      }
    }
    return a;
  };
  const wall = area("wall");
  assert.ok(meshes.some((m) => m.material === "door") && meshes.some((m) => m.material === "lit") && meshes.some((m) => m.material === "dark"), "all three openings filled");
  // The wall plane covers the face minus the three holes (front-facing, no overlaps or gaps).
  assert.ok(wall > 0 && wall < L * (top - bottom) - 1.4 * 2.4 - 1.0 * 2.0 - 3.0 * 3.0, `wall area ${wall.toFixed(2)}`);
  assert.ok(wall > L * (top - bottom) - 1.4 * 2.4 - 1.0 * 3.0 - 3.4 * 4.6, `wall area ${wall.toFixed(2)} not over-cut`);
  // Degenerate quads are skipped (a zero normal would become NaN in the shader).
  const d = new MeshBuilder();
  d.part("t").material("m");
  quadSafe(d, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0);
  assert.equal(d.finish().length, 0);
});

test("figures keep their signature and have a lighter Quest level of detail", () => {
  for (const [palette, pose] of [["levy", "stand"], ["guard", "guard"], ["civilian", "walk-a"], ["herald", "herald"], ["smith", "work"]] as const) {
    const full = buildFigure(palette, pose);
    const quest = buildFigure(palette, pose, 1);
    const tris = (ms: MeshBuffer[]) => ms.reduce((t, m) => t + m.indices.length / 3, 0);
    assert.ok(full.length >= 1 && full.length <= 2, "figure material plus heraldic tabard at most");
    assert.ok(tris(quest) < tris(full) * 0.7, `${palette}/${pose}: ${tris(quest)} vs ${tris(full)}`);
    assert.ok(tris(quest) <= 360, `${palette}/${pose} Quest figure ${tris(quest)} triangles`);
  }
  const q = build("quest");
  const figureSets = q.instances.filter((s) => s.part === "figures");
  for (const s of figureSets) for (const p of s.prototypes) assert.ok(p.indices.length / 3 <= 360, `${s.name}: Quest LOD`);
});

test("file stones carry the chess file letters a–h", () => {
  for (const f of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    const strokes = fileGlyph(f);
    assert.ok(strokes.length >= 1, f);
    for (const st of strokes) for (const p of st) assert.ok(Math.abs(p[0]) <= 0.4 && p[1] >= -0.3 && p[1] <= 0.85, `${f} glyph inside its box`);
  }
  assert.equal(bp.muster.fileMarkers.length, 8);
});
