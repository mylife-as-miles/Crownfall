// Quest table-top staging tests: the blueprint → anchor transform, the presence fade, the
// prepared miniature for every nation (near cut, mist hole, carved section, determinism,
// Quest budgets), comfortable collision-free panel anchors and rotation re-preparation that
// never mutates the cached build. Pure: no three, IWSDK or DOM.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { buildBannerhold, environmentFixture, PLATFORM_BUDGETS } from "../environment";
import type { EnvironmentBuild } from "../environment";
import { BANNERHOLD_BLUEPRINTS } from "../environment/blueprint";
import type { NationId } from "../types";
import {
  anchorToBlueprint, blueprintToAnchor, CLEAR_CONE_DEG, envelopeAt, frameU, frameV, miniatureFrame, prepareQuestMiniature,
  presence, QUEST_LEGACY_PANELS, stagingNumbers, VR_SIDE_SOLID,
} from "../environment/vr";
import type { QuestMiniature } from "../environment/vr";

const NATIONS = Object.keys(BANNERHOLD_BLUEPRINTS) as NationId[];
const builds = new Map<NationId, EnvironmentBuild>();
const minis = new Map<NationId, QuestMiniature>();
function build(n: NationId): EnvironmentBuild {
  let b = builds.get(n);
  if (!b) {
    b = buildBannerhold({ state: environmentFixture("founded", n), quality: "quest" });
    builds.set(n, b);
  }
  return b;
}
function mini(n: NationId): QuestMiniature {
  let m = minis.get(n);
  if (!m) {
    m = prepareQuestMiniature(build(n));
    minis.set(n, m);
  }
  return m;
}
function digest(m: QuestMiniature): string {
  const h = createHash("sha256");
  for (const g of m.groups) for (const a of [g.positions, g.normals, g.uvs, g.colors, g.indices]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  for (const s of m.instances) h.update(Buffer.from(s.transforms.buffer, s.transforms.byteOffset, s.transforms.byteLength));
  return h.digest("hex");
}
function buildDigest(b: EnvironmentBuild): string {
  const h = createHash("sha256");
  for (const m of b.meshes) for (const a of [m.positions, m.colors ?? new Float32Array(0), m.indices]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  for (const s of b.instances) h.update(Buffer.from(s.transforms.buffer, s.transforms.byteOffset, s.transforms.byteLength));
  return h.digest("hex");
}

test("the miniature frame maps the viewer-facing bearing to -Z and round-trips anchor space", () => {
  for (const n of NATIONS) {
    const vr = build(n).staging.vr;
    for (const posture of ["seated", "standing"] as const) {
      const f = miniatureFrame(vr, posture);
      const p = posture === "seated" ? vr.seated : vr.standing;
      assert.ok(Math.abs(f.surfaceY - (p.surfaceHeight - p.eyeHeight)) < 1e-9);
      // A point 10 m along the facing bearing from the display centre lies straight ahead (-Z).
      const b = (vr.viewerFacingBearingDeg * Math.PI) / 180;
      const a = blueprintToAnchor(f, vr.displayCenter[0] + Math.sin(b) * 10, vr.datumY, vr.displayCenter[1] - Math.cos(b) * 10);
      assert.ok(Math.abs(a[0]) < 1e-6, `${n}: ahead point x ${a[0]}`);
      assert.ok(a[2] < -f.distance, `${n}: ahead point z`);
      const back = anchorToBlueprint(f, 0.13, -0.2, -0.7);
      const again = blueprintToAnchor(f, back[0], back[1], back[2]);
      assert.ok(Math.abs(again[0] - 0.13) < 1e-6 && Math.abs(again[1] + 0.2) < 1e-6 && Math.abs(again[2] + 0.7) < 1e-6);
    }
  }
});

test("presence is solid inside the miniature, mist beside it and land again ahead", () => {
  const f = miniatureFrame(build("korvenia").staging.vr, "seated");
  assert.equal(presence(f, 0, 0), 1);
  assert.equal(presence(f, f.halfWidth + VR_SIDE_SOLID * f.lateral - 1, 0), 1);
  assert.equal(presence(f, f.halfWidth + f.lateral + 5, 0), 0);
  assert.equal(presence(f, -(f.halfWidth + f.lateral + 50), f.halfDepth), 0);
  assert.equal(presence(f, f.halfWidth + f.lateral + 500, -(f.halfDepth + f.far) - 200), 1);
});

test("every nation's miniature stops at the near cut, drops the mist hole and carves a section", () => {
  for (const n of NATIONS) {
    const m = mini(n);
    const f = miniatureFrame(m.vr, "seated");
    let worstV = -Infinity;
    for (const g of m.groups) {
      const P = g.positions;
      for (let i = 0; i < P.length; i += 3) {
        const v = frameV(f, P[i], P[i + 2]);
        if (v > worstV) worstV = v;
      }
      for (let t = 0; t < g.indices.length; t += 3) {
        let lost = 0;
        for (let k = 0; k < 3; k++) {
          const i = g.indices[t + k] * 3;
          if (presence(f, frameU(f, P[i], P[i + 2]), frameV(f, P[i], P[i + 2])) < 0.01) lost++;
        }
        assert.ok(lost < 3, `${n}: a triangle of ${g.key} is entirely in the mist`);
      }
    }
    // Section strata and the bronze lip stand a fraction of a metre proud of the cut.
    assert.ok(worstV <= f.nearCut + 0.5, `${n}: geometry reaches ${worstV.toFixed(2)} m past the near cut`);
    assert.ok(m.stats.sectionEdges > 10, `${n}: carved section has ${m.stats.sectionEdges} edges`);
    assert.ok(m.groups.some((g) => g.material === "vr-section"), `${n}: no carved section group`);
    for (const s of m.instances) {
      if (s.kind !== "vegetation" && s.kind !== "clutter") continue;
      for (let i = 0; i < s.count; i++) assert.ok(frameV(f, s.transforms[i * 16 + 12], s.transforms[i * 16 + 14]) < f.nearCut + 0.1, `${n}: ${s.name} instance past the cut`);
    }
  }
});

test("the Quest miniature is deterministic and within the Quest budgets", () => {
  const budget = PLATFORM_BUDGETS.quest;
  for (const n of NATIONS) {
    const m = mini(n);
    assert.equal(digest(prepareQuestMiniature(build(n))), digest(m), `${n}: not deterministic`);
    const draws = m.stats.groups + m.stats.instanceDraws;
    const tris = m.stats.staticTriangles + m.stats.instanceTriangles;
    // Upper bounds before state gating, quality thinning and agent pose packing reduce them further.
    assert.ok(draws + 4 <= budget.drawCalls, `${n}: ${draws} draws (+ sky, smoke, emphasis) over ${budget.drawCalls}`);
    assert.ok(tris <= budget.triangles, `${n}: ${tris} triangles over ${budget.triangles}`);
  }
});

test("landmark pick volumes are comfortable hand targets at the display scale", () => {
  for (const n of NATIONS) {
    const m = mini(n);
    for (const l of m.landmarks) assert.ok(l.pickRadius * m.vr.displayScale >= m.vr.reach.minTargetRadius, `${n}: ${l.id} radius ${(l.pickRadius * m.vr.displayScale).toFixed(3)} m`);
    const st = stagingNumbers(miniatureFrame(m.vr, "seated"), m.layouts.seated, m.landmarks, m.vr.detailExtent);
    for (const l of st.landmarks) assert.ok(l.position[1] < -0.1, `${n}: ${l.id} is not below eye level`);
    for (const l of st.landmarks) assert.ok(Math.hypot(l.position[0], l.position[2]) <= m.vr.reach.rayMax, `${n}: ${l.id} beyond ray reach`);
  }
});

test("the holding stays below eye level in both postures", () => {
  for (const n of NATIONS) {
    const m = mini(n);
    const f0 = miniatureFrame(m.vr, "seated");
    const inside = (x: number, z: number) => Math.abs(frameU(f0, x, z)) <= f0.halfWidth && Math.abs(frameV(f0, x, z)) <= f0.halfDepth;
    // Highest point of the detail region over every hall tier: merged geometry and instance tops.
    let top = -Infinity;
    for (const g of m.groups) {
      const P = g.positions;
      for (let i = 0; i < P.length; i += 3) if (P[i + 1] > top && inside(P[i], P[i + 2])) top = P[i + 1];
    }
    for (const s of m.instances) {
      if (s.kind === "agents") continue;
      let protoTop = 0;
      for (const p of s.prototypes) for (let i = 1; i < p.positions.length; i += 3) if (p.positions[i] > protoTop) protoTop = p.positions[i];
      const T = s.transforms;
      for (let i = 0; i < s.count; i++) {
        const o = i * 16;
        if (!inside(T[o + 12], T[o + 14])) continue;
        top = Math.max(top, T[o + 13] + protoTop * Math.hypot(T[o + 4], T[o + 5], T[o + 6]));
      }
    }
    for (const posture of ["seated", "standing"] as const) {
      const f = miniatureFrame(m.vr, posture);
      const y = f.surfaceY + (top - f.datumY) * f.scale;
      assert.ok(y <= -0.03, `${n} ${posture}: the holding reaches ${y.toFixed(3)} m relative to the eyes`);
    }
  }
});

test("panel anchors clear every structure, keep the central view open and stay comfortable", () => {
  for (const n of NATIONS) {
    const m = mini(n);
    for (const posture of ["seated", "standing"] as const) {
      const L = m.layouts[posture];
      for (const [name, p, size] of [["primary", L.primary, QUEST_LEGACY_PANELS.primary], ["dock", L.dock, QUEST_LEGACY_PANELS.dock]] as const) {
        assert.ok(p.clearance >= 0.03, `${n} ${posture} ${name}: clearance ${p.clearance.toFixed(3)} m`);
        const inner = Math.abs(p.yawDeg) - (Math.atan2(size.width / 2, p.distance) * 180) / Math.PI;
        assert.ok(inner >= CLEAR_CONE_DEG - 1e-6, `${n} ${posture} ${name}: covers the central view (${inner.toFixed(1)}°)`);
        assert.ok(p.distance >= 1 && p.distance <= 1.46, `${n} ${posture} ${name}: distance ${p.distance}`);
        assert.ok(Math.abs(p.pitchDeg) <= 16, `${n} ${posture} ${name}: pitch ${p.pitchDeg.toFixed(1)}°`);
        assert.ok(Math.abs(p.yawDeg) <= 60, `${n} ${posture} ${name}: yaw ${p.yawDeg}°`);
      }
      assert.ok(L.primary.yawDeg < 0 && L.dock.yawDeg > 0, `${n}: panel left, dock right`);
    }
    assert.ok(envelopeAt(m.envelope, 0, 0) > -1e8, `${n}: envelope covers the centre`);
  }
});

test("re-preparing for a user rotation keeps the cut relative to the viewer and never mutates the build", () => {
  const b = build("korvenia");
  const before = buildDigest(b);
  const turned = prepareQuestMiniature(b, 30);
  assert.equal(buildDigest(b), before, "the cached build changed");
  assert.equal(digest(prepareQuestMiniature(b)), digest(mini("korvenia")), "rest preparation changed after a rotation");
  const f = miniatureFrame(b.staging.vr, "seated", 30);
  assert.equal(turned.userYawDeg, 30);
  for (const g of turned.groups) {
    for (let i = 0; i < g.positions.length; i += 3) assert.ok(frameV(f, g.positions[i], g.positions[i + 2]) <= f.nearCut + 0.5);
  }
  assert.ok(turned.layouts.seated.primary.clearance >= 0.03 && turned.layouts.seated.dock.clearance >= 0.03);
});

test("the occlusion sweep finds the nearest inflated oriented box and reports clear lines", async () => {
  const { sweepOccluders } = await import("../environment/vr");
  const out = new Float64Array(3);
  const box = { center: [0, 0, 0] as const, halfExtents: [2, 1, 0.5] as const, yaw: 0, landmark: null, blocksCamera: true };
  // Along +X through a 2 m half-extent box inflated by 0.5 m: hit at x = -2.5.
  const t = sweepOccluders([box], -10, 0, 0, 10, 0, 0, 0.5, out);
  assert.ok(Math.abs(t - 7.5 / 20) < 1e-9 && Math.abs(out[0] + 2.5) < 1e-9);
  // Turned a quarter: the box is now 0.5 m deep along X.
  const turned = { ...box, yaw: Math.PI / 2 };
  const t2 = sweepOccluders([turned], -10, 0, 0, 10, 0, 0, 0.5, out);
  assert.ok(Math.abs(out[0] + 1) < 1e-6, `turned hit at ${out[0]} (t ${t2})`);
  // A line passing above the inflated box is clear; the nearer of two boxes wins.
  assert.equal(sweepOccluders([box], -10, 2, 0, 10, 2, 0, 0.5, out), -1);
  const far = { ...box, center: [6, 0, 0] as const };
  const t3 = sweepOccluders([far, box], -10, 0, 0, 10, 0, 0, 0.5, out);
  assert.ok(Math.abs(t3 - t) < 1e-9);
});
