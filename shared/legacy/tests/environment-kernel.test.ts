// Geometry kernel tests: determinism, valid buffers, outward winding of closed
// primitives, roof orientation, triangulation, noise tiling and baking.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archOutline, bakeMesh, bevelPrism, box, chamferBox, circleOutline, crenellate, hashString, lathe, loft, MeshBuilder,
  opening, prism, rectOutline, roof, Rng, stairs, tileFbm, triangulate, signedArea2, band,
} from "../environment/kernel";
import type { MeshBuffer } from "../environment/kernel";
import type { RoofShape } from "../environment/kernel/roofs";

function validate(meshes: MeshBuffer[]): void {
  assert.ok(meshes.length > 0, "no meshes");
  for (const m of meshes) {
    const n = m.positions.length / 3;
    assert.equal(m.normals.length, n * 3);
    assert.equal(m.uvs.length, n * 2);
    assert.ok(m.indices.length % 3 === 0 && m.indices.length > 0);
    for (let i = 0; i < m.indices.length; i++) assert.ok(m.indices[i] < n, "index out of range");
    for (let i = 0; i < m.positions.length; i++) assert.ok(Number.isFinite(m.positions[i]), "non-finite position");
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3, `normal length ${l}`);
    }
  }
}

/** Signed volume of a closed triangle mesh (positive when faces wind outward). */
function signedVolume(meshes: MeshBuffer[]): number {
  let v = 0;
  for (const m of meshes) {
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    }
  }
  return v;
}

function build(fn: (b: MeshBuilder) => void): MeshBuffer[] {
  const b = new MeshBuilder();
  b.material("test");
  fn(b);
  return b.finish();
}

test("closed primitives wind outward and have valid buffers", () => {
  const cases: [string, (b: MeshBuilder) => void, number][] = [
    ["box", (b) => box(b, 0, 0, 0, 2, 3, 4, { bottom: true }), 24],
    ["chamferBox", (b) => chamferBox(b, 1, 0, -2, 2, 3, 4, 0.2, { bottom: true }), 24],
    ["smooth prism", (b) => prism(b, circleOutline(1, 16), 0, 2, { smooth: true, bottom: true }), Math.PI * 2],
    ["bevelPrism", (b) => bevelPrism(b, rectOutline(2, 2), 0, 1, 0.1, { bottom: true }), 4],
    ["capped lathe", (b) => lathe(b, [[1, 0], [1, 2]], 24, { capTop: true, capBottom: true }), Math.PI * 2],
  ];
  for (const [name, fn, expected] of cases) {
    const meshes = build(fn);
    validate(meshes);
    const v = signedVolume(meshes);
    assert.ok(v > 0, `${name} winds inward (volume ${v})`);
    assert.ok(Math.abs(v - expected) / expected < 0.08, `${name} volume ${v} vs ${expected}`);
  }
});

test("transformed and mirrored primitives keep outward winding", () => {
  const meshes = build((b) => {
    b.push();
    b.transform(5, 2, -3, 0.7, 0.2, -0.1, 1, 1, -1);
    box(b, 0, 0, 0, 1, 1, 1, { bottom: true });
    b.pop();
  });
  validate(meshes);
  assert.ok(signedVolume(meshes) > 0);
});

test("every roof form builds valid geometry whose top surfaces face up", () => {
  const forms: RoofShape[] = ["gable", "steep-gable", "hip", "half-hip", "pyramid", "spire", "conical", "lean-to", "flat", "flat-parapet", "dome", "open-frame"];
  for (const form of forms) {
    for (const axis of ["x", "z"] as const) {
      const meshes = build((b) => roof(b, { form, axis, w: 8, d: 12, eaveY: 6, ridgeY: 12, plan: "rect", overhang: 0.4, verge: 0.3, thickness: 0.15, roofMaterial: "roof", gableMaterial: "wall", trimMaterial: "trim", soffitMaterial: "soffit", parapetGables: form === "steep-gable" }));
      validate(meshes);
      const roofMesh = meshes.find((m) => m.material === "roof");
      if (!roofMesh || form === "open-frame") continue;
      let up = 0;
      for (let i = 1; i < roofMesh.normals.length; i += 3) up += roofMesh.normals[i];
      assert.ok(up > 0, `${form}/${axis} roof surfaces face down`);
    }
  }
  validate(build((b) => roof(b, { form: "conical", axis: "z", w: 4, d: 4, eaveY: 8, ridgeY: 13, plan: "round", overhang: 0.3, verge: 0, thickness: 0.1, roofMaterial: "roof", gableMaterial: "wall", trimMaterial: "trim" })));
});

test("openings, stairs, crenellation, lofts and bands are valid", () => {
  validate(build((b) => opening(b, { outline: archOutline(1.2, 2, 0.88, 6), glassMaterial: "glass", frameMaterial: "stone", frame: 0.16, proud: 0.18, sill: true, mullion: true })));
  validate(build((b) => stairs(b, 3, 12, 0.18, 0.32)));
  const merlons = build((b) => {
    const n = crenellate(b, 0, 0, 10, 0, 5, 0.5, 0.8, 0.8, 0.6);
    assert.ok(n >= 6);
  });
  validate(merlons);
  validate(build((b) => loft(b, [[1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, -1], [1, 1, 0, 0, 1, 1, -1, 1, 0, 0, 1, -1]], { capStart: true, capEnd: true })));
  validate(build((b) => band(b, rectOutline(6, 4), 3, 0.2, 0.1)));
});

test("lancet outline is a closed counter-clockwise arch with the apex on the axis", () => {
  const pts = archOutline(1, 2, 1, 8);
  assert.ok(signedArea2(pts) > 0);
  let top = -Infinity, topX = 0;
  for (const p of pts) if (p[1] > top) { top = p[1]; topX = p[0]; }
  assert.ok(Math.abs(topX) < 1e-6);
  assert.ok(Math.abs(top - (2 + Math.sqrt(0.75))) < 1e-6);
});

test("triangulation covers simple polygons exactly", () => {
  const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
  for (const poly of [L, L.slice().reverse(), circleOutline(2, 12)]) {
    const tris = triangulate(poly);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) area += Math.abs(signedArea2([poly[tris[i]], poly[tris[i + 1]], poly[tris[i + 2]]]));
    assert.ok(Math.abs(area - Math.abs(signedArea2(poly))) < 1e-6);
  }
});

test("builder output and PRNG are deterministic", () => {
  const make = (): MeshBuffer[] => build((b) => {
    const r = new Rng(42);
    for (let i = 0; i < 20; i++) {
      b.push();
      b.transform(r.range(-10, 10), 0, r.range(-10, 10), r.next() * 6);
      chamferBox(b, 0, 0, 0, r.range(1, 3), r.range(1, 5), r.range(1, 3), 0.1);
      b.pop();
    }
  });
  const a = make(), c = make();
  assert.equal(a.length, c.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(Array.from(a[i].positions), Array.from(c[i].positions));
    assert.deepEqual(Array.from(a[i].indices), Array.from(c[i].indices));
  }
  assert.equal(hashString("bannerhold"), hashString("bannerhold"));
  assert.notEqual(new Rng(1).next(), new Rng(2).next());
});

test("tileable noise wraps exactly over its period", () => {
  for (let y = 0; y < 4; y += 0.37) {
    assert.ok(Math.abs(tileFbm(0, y, 8, 11, 4) - tileFbm(8, y, 8, 11, 4)) < 1e-12);
    assert.ok(Math.abs(tileFbm(y, 0, 8, 11, 4) - tileFbm(y, 8, 8, 11, 4)) < 1e-12);
  }
});

test("vertex baking darkens contact and keeps colours finite", () => {
  const meshes = build((b) => box(b, 0, 0, 0, 2, 6, 2));
  const m = meshes[0];
  bakeMesh(m, { ground: () => 0, contact: { strength: 0.5, height: 1.5 }, skyOcclusion: 0.2, grime: { strength: 0.2, height: 2, seed: 1 }, variation: { amount: 0.05, scale: 0.1, seed: 2 } });
  const C = m.colors as Float32Array;
  let low = 0, high = 0, nl = 0, nh = 0;
  for (let i = 0; i < m.positions.length / 3; i++) {
    assert.ok(Number.isFinite(C[i * 3]) && C[i * 3] >= 0);
    if (m.positions[i * 3 + 1] < 0.1) { low += C[i * 3]; nl++; }
    if (m.positions[i * 3 + 1] > 5.9) { high += C[i * 3]; nh++; }
  }
  assert.ok(low / nl < high / nh, "ground contact should be darker than the top");
});
