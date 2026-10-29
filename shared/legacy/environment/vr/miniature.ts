// Quest miniature preparation (pure, runs in the Quest build worker). Turns the shared
// EnvironmentBuild (quest profile) into render-ready packed buffers for the table-top
// presentation described in docs/legacy/environment/BIBLE.md §10:
//
// - the near cut: nothing nearer to the viewer than the detail region's near edge
//   (geometry is clipped exactly at the cut so the edge is straight);
// - the mist hole: land beside the miniature and beside the viewer is dropped (presence 0);
//   the skirt's rim and the land beyond the far skirt fade in the shader instead;
// - a carved section along the near cut (soil, earth and rock strata with a bronze lip),
//   so the miniature reads as a relief model cut from the land rather than a floating sheet;
// - a baked key-light and relief term on the terrain (the shared bake leaves terrain to the
//   renderer's lights; Quest has none);
// - static meshes merged by material, motion and state gate (landmark ids per vertex);
// - instances culled to the footprint and reordered so any prefix is an even subset
//   (Quest medium/low show a prefix);
// - a forced-perspective skyline: distant places and ranges beyond 900 m are raised about
//   their own far-field ground (x2.1 / x1.5) so they still read on the horizon at 1:125;
//   plan positions are unchanged, so stereo depth and parallax stay true;
// - a height envelope for the panel solver.

import type { NationId } from "../../types";
import type { EnvironmentBuild } from "../build/buildBannerhold";
import type { Bounds3, InstanceSet, MeshBuffer, MeshMotion, StateGate } from "../kernel/mesh";
import { boundsOfPositions, emptyBounds, sampleField } from "../kernel/mesh";
import { bakeMesh } from "../kernel/bake";
import { hexToLinear } from "../kernel/math";
import { hash01, hashString } from "../kernel/prng";
import { createTerrainSampler, getBannerholdBlueprint } from "../blueprint";
import { createFarField } from "../kits/landscape/terrain";
import type { MiniatureFrame, VrPosture } from "./frame";
import { frameU, frameV, miniatureFrame, presence } from "./frame";
import type { HeightEnvelope, PanelLayout } from "./staging";
import { createEnvelope, raiseEnvelope, solvePanelLayout } from "./staging";

export const VR_SECTION_MATERIAL = "vr-section";
/** Offset of the cut from the authored near edge so it never coincides with terrain grid lines. */
const CUT_JITTER = 0.031;
/** Presence below which a vertex counts as lost in the mist. */
const LOST = 0.01;

export interface PackedGroup {
  key: string;
  material: string;
  part: string;
  motion: MeshMotion | null;
  gate: StateGate | null;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  motionWeights: Float32Array | null;
  landmarkIds: Uint8Array | null;
  indices: Uint16Array | Uint32Array;
  bounds: Bounds3;
  triangles: number;
}

export interface PackedPrototype {
  material: string;
  motion: MeshMotion | null;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  motionWeights: Float32Array | null;
  landmarkIds: Uint8Array | null;
  indices: Uint16Array | Uint32Array;
  triangles: number;
}

export type InstanceKind = "vegetation" | "clutter" | "agents" | "slot" | "other";

export interface PackedInstanceSet {
  name: string;
  part: string;
  kind: InstanceKind;
  prototypes: PackedPrototype[];
  transforms: Float32Array;
  tints: Float32Array | null;
  count: number;
  motion: InstanceSet["motion"];
  gate: StateGate | null;
}

export interface QuestMiniatureStats {
  groups: number;
  instanceDraws: number;
  staticTriangles: number;
  instanceTriangles: number;
  trianglesByPart: Record<string, number>;
  droppedTriangles: number;
  culledInstances: number;
  sectionEdges: number;
  prepMs: number;
}

export interface QuestMiniature {
  version: 1;
  nationId: NationId;
  groups: PackedGroup[];
  instances: PackedInstanceSet[];
  envelope: HeightEnvelope;
  /** User rotation (degrees) this miniature was prepared for; the cut and fades stay relative to the viewer. */
  userYawDeg: number;
  /** Comfortable, collision-free panel layout per posture at this rotation. */
  layouts: Record<VrPosture, PanelLayout>;
  stats: QuestMiniatureStats;
  agents: EnvironmentBuild["agents"];
  slots: EnvironmentBuild["slots"];
  initialSlots: EnvironmentBuild["initialSlots"];
  slotCapacities: EnvironmentBuild["slotCapacities"];
  landmarks: EnvironmentBuild["landmarks"];
  smoke: EnvironmentBuild["smoke"];
  fires: EnvironmentBuild["fires"];
  field: EnvironmentBuild["field"];
  /** Occluder boxes for the representative's occlusion reveal (blueprint metres). */
  colliders: EnvironmentBuild["colliders"];
  vr: EnvironmentBuild["staging"]["vr"];
  atmosphere: EnvironmentBuild["staging"]["atmosphere"];
  buildStats: EnvironmentBuild["stats"];
}

// ---------------------------------------------------------------------------
// Near cut and mist hole
// ---------------------------------------------------------------------------

interface Sink {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  mot: number[] | null;
  lm: number[] | null;
  idx: number[];
}

function copyVertex(m: MeshBuffer, s: Sink, i: number): void {
  s.pos.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
  s.nrm.push(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
  s.uv.push(m.uvs[i * 2], m.uvs[i * 2 + 1]);
  if (m.colors) s.col.push(m.colors[i * 3], m.colors[i * 3 + 1], m.colors[i * 3 + 2]);
  else s.col.push(1, 1, 1);
  if (s.mot) s.mot.push(m.motionWeights ? m.motionWeights[i] : 0);
  if (s.lm) s.lm.push(m.landmarkIds ? m.landmarkIds[i] : 0);
}

/** Appends the vertex at t along a→b (t from a) and returns its index. */
function lerpVertex(m: MeshBuffer, s: Sink, a: number, b: number, t: number): number {
  const P = m.positions, N = m.normals, U = m.uvs;
  s.pos.push(P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t);
  let nx = N[a * 3] + (N[b * 3] - N[a * 3]) * t, ny = N[a * 3 + 1] + (N[b * 3 + 1] - N[a * 3 + 1]) * t, nz = N[a * 3 + 2] + (N[b * 3 + 2] - N[a * 3 + 2]) * t;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l; ny /= l; nz /= l;
  s.nrm.push(nx, ny, nz);
  s.uv.push(U[a * 2] + (U[b * 2] - U[a * 2]) * t, U[a * 2 + 1] + (U[b * 2 + 1] - U[a * 2 + 1]) * t);
  const C = m.colors;
  if (C) s.col.push(C[a * 3] + (C[b * 3] - C[a * 3]) * t, C[a * 3 + 1] + (C[b * 3 + 1] - C[a * 3 + 1]) * t, C[a * 3 + 2] + (C[b * 3 + 2] - C[a * 3 + 2]) * t);
  else s.col.push(1, 1, 1);
  if (s.mot) {
    const W = m.motionWeights;
    s.mot.push(W ? W[a] + (W[b] - W[a]) * t : 0);
  }
  if (s.lm) s.lm.push(m.landmarkIds ? m.landmarkIds[a] : 0);
  return s.pos.length / 3 - 1;
}

function presenceAt(s: Sink, f: MiniatureFrame, i: number): number {
  const x = s.pos[i * 3], z = s.pos[i * 3 + 2];
  return presence(f, frameU(f, x, z), frameV(f, x, z));
}

/**
 * Clips a mesh at the near cut and drops triangles lost in the mist. Cut edges of the
 * terrain are appended to `edges` as x0,y0,z0,x1,y1,z1. Returns null when nothing remains.
 */
export function clipToMiniature(m: MeshBuffer, f: MiniatureFrame, edges: number[] | null): { mesh: MeshBuffer | null; dropped: number } {
  const n = m.positions.length / 3;
  const P = m.positions;
  const cut = f.nearCut + CUT_JITTER;
  const dv = new Float32Array(n);
  const alpha = new Float32Array(n);
  let anyOut = false;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], z = P[i * 3 + 2];
    const v = frameV(f, x, z);
    dv[i] = v - cut;
    alpha[i] = presence(f, frameU(f, x, z), v);
    if (dv[i] > 0 || alpha[i] < LOST) anyOut = true;
  }
  const I = m.indices;
  const tris = I.length / 3;
  if (!anyOut) return { mesh: m.colors ? m : { ...m, colors: new Float32Array(n * 3).fill(1) }, dropped: 0 };
  const s: Sink = { pos: [], nrm: [], uv: [], col: [], mot: m.motionWeights ? [] : null, lm: m.landmarkIds ? [] : null, idx: [] };
  for (let i = 0; i < n; i++) copyVertex(m, s, i);
  let dropped = 0;
  const poly: number[] = [];
  const cutPair: number[] = [];
  for (let t = 0; t < tris; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (alpha[a] < LOST && alpha[b] < LOST && alpha[c] < LOST) {
      dropped++;
      continue;
    }
    const ina = dv[a] <= 0, inb = dv[b] <= 0, inc = dv[c] <= 0;
    if (ina && inb && inc) {
      s.idx.push(a, b, c);
      continue;
    }
    if (!ina && !inb && !inc) {
      dropped++;
      continue;
    }
    poly.length = 0;
    cutPair.length = 0;
    const tri = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3];
      const pin = dv[p] <= 0, qin = dv[q] <= 0;
      if (pin) poly.push(p);
      if (pin !== qin) {
        const k = lerpVertex(m, s, p, q, dv[p] / (dv[p] - dv[q]));
        poly.push(k);
        cutPair.push(k);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      const a0 = poly[0], a1 = poly[k], a2 = poly[k + 1];
      // A clipped piece can land wholly in the mist even when its source triangle did not.
      if (presenceAt(s, f, a0) < LOST && presenceAt(s, f, a1) < LOST && presenceAt(s, f, a2) < LOST) {
        dropped++;
        continue;
      }
      s.idx.push(a0, a1, a2);
    }
    if (edges && cutPair.length === 2) {
      const i0 = cutPair[0], i1 = cutPair[1];
      edges.push(s.pos[i0 * 3], s.pos[i0 * 3 + 1], s.pos[i0 * 3 + 2], s.pos[i1 * 3], s.pos[i1 * 3 + 1], s.pos[i1 * 3 + 2]);
    }
  }
  if (s.idx.length === 0) return { mesh: null, dropped };
  // Compact away vertices no triangle uses.
  const vc = s.pos.length / 3;
  const remap = new Int32Array(vc).fill(-1);
  let next = 0;
  for (let i = 0; i < s.idx.length; i++) {
    const v = s.idx[i];
    if (remap[v] < 0) remap[v] = next++;
  }
  const positions = new Float32Array(next * 3), normals = new Float32Array(next * 3), uvs = new Float32Array(next * 2), colors = new Float32Array(next * 3);
  const motionWeights = s.mot ? new Float32Array(next) : null;
  const landmarkIds = s.lm ? new Uint8Array(next) : null;
  for (let i = 0; i < vc; i++) {
    const r = remap[i];
    if (r < 0) continue;
    positions[r * 3] = s.pos[i * 3]; positions[r * 3 + 1] = s.pos[i * 3 + 1]; positions[r * 3 + 2] = s.pos[i * 3 + 2];
    normals[r * 3] = s.nrm[i * 3]; normals[r * 3 + 1] = s.nrm[i * 3 + 1]; normals[r * 3 + 2] = s.nrm[i * 3 + 2];
    uvs[r * 2] = s.uv[i * 2]; uvs[r * 2 + 1] = s.uv[i * 2 + 1];
    colors[r * 3] = s.col[i * 3]; colors[r * 3 + 1] = s.col[i * 3 + 1]; colors[r * 3 + 2] = s.col[i * 3 + 2];
    if (motionWeights && s.mot) motionWeights[r] = s.mot[i];
    if (landmarkIds && s.lm) landmarkIds[r] = s.lm[i];
  }
  const indices = new Uint32Array(s.idx.length);
  for (let i = 0; i < s.idx.length; i++) indices[i] = remap[s.idx[i]];
  return {
    mesh: { ...m, positions, normals, uvs, colors, splat: null, motionWeights, landmarkIds, indices, bounds: boundsOfPositions(positions) },
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Carved section along the near cut
// ---------------------------------------------------------------------------

/** Strata tones of the carved section per nation (sRGB): topsoil, earth, rock. Placeholder art values. */
export const VR_SECTION_TONES: Readonly<Record<NationId, { soil: string; earth: string; rock: string }>> = {
  korvenia: { soil: "#3b3428", earth: "#4a3d31", rock: "#37353c" },
  solforiz: { soil: "#6b5236", earth: "#8a6a47", rock: "#7a5e44" },
  aethelgard: { soil: "#2f3324", earth: "#45392c", rock: "#3a3833" },
  "kwind-09": { soil: "#3a3633", earth: "#4b4642", rock: "#4d4d50" },
};

function meshFrom(part: string, material: string, pos: number[], nrm: number[], uv: number[], col: number[], idx: number[]): MeshBuffer {
  const positions = new Float32Array(pos);
  return {
    name: `${part}|${material}`,
    part,
    material,
    positions,
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    splat: null,
    motionWeights: null,
    landmarkIds: null,
    indices: new Uint32Array(idx),
    castShadow: false,
    receiveShadow: false,
    lod: 0,
    landmark: null,
    motion: null,
    gate: null,
    bounds: boundsOfPositions(positions),
  };
}

/**
 * Builds the carved section (strata) and its bronze lip from the terrain's cut edges.
 * The section faces the viewer; its foot sinks below the datum, where the Quest shader
 * dissolves it into the mist.
 */
export function buildSection(edges: readonly number[], f: MiniatureFrame, nationId: NationId): MeshBuffer[] {
  if (edges.length === 0) return [];
  const tones = VR_SECTION_TONES[nationId];
  const soil = hexToLinear(tones.soil), earth = hexToLinear(tones.earth), rock = hexToLinear(tones.rock);
  const nx = -f.sin, nz = f.cos;
  const wall = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] };
  const lip = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] };
  const rowColor = (r: number, x: number, z: number, y: number): readonly [number, number, number] => {
    const k = 0.9 + 0.2 * hash01(Math.floor(x * 0.7), Math.floor(y * 1.3), Math.floor(z * 0.7), 41);
    const c = r === 0 ? soil : r === 1 ? soil : r === 2 ? earth : rock;
    const dark = r === 4 ? 0.62 : r === 3 ? 0.85 : 1;
    return [c[0] * k * dark, c[1] * k * dark, c[2] * k * dark];
  };
  for (let e = 0; e + 5 < edges.length; e += 6) {
    let ax = edges[e], ay = edges[e + 1], az = edges[e + 2], bx = edges[e + 3], by = edges[e + 4], bz = edges[e + 5];
    if (frameU(f, ax, az) > frameU(f, bx, bz)) {
      const tx = ax, ty = ay, tz = az;
      ax = bx; ay = by; az = bz; bx = tx; by = ty; bz = tz;
    }
    const ua = frameU(f, ax, az), ub = frameU(f, bx, bz);
    if (ub - ua < 1e-4) continue;
    // Nothing to carve where the cut runs through the mist beside the miniature.
    if (presence(f, ua, frameV(f, ax, az)) < LOST && presence(f, ub, frameV(f, bx, bz)) < LOST) continue;
    const rowsA = sectionRows(ay, f.datumY), rowsB = sectionRows(by, f.datumY);
    const base = wall.pos.length / 3;
    for (let r = 0; r < rowsA.length; r++) {
      const ca = rowColor(r, ax, az, rowsA[r]), cb = rowColor(r, bx, bz, rowsB[r]);
      wall.pos.push(ax, rowsA[r], az, bx, rowsB[r], bz);
      wall.nrm.push(nx, 0, nz, nx, 0, nz);
      wall.uv.push(ua, rowsA[r], ub, rowsB[r]);
      wall.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
    }
    for (let r = 0; r + 1 < rowsA.length; r++) {
      const a0 = base + r * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      wall.idx.push(a1, b1, b0, a1, b0, a0);
    }
    // Bronze lip: a narrow bevelled strip standing just proud of the cut.
    const ox = nx * 0.32, oz = nz * 0.32;
    const lb = lip.pos.length / 3;
    const lipRows = [0.5, -0.15, -0.95];
    const lipTone = [1.4, 1.0, 0.6];
    for (let r = 0; r < 3; r++) {
      lip.pos.push(ax + ox, ay + lipRows[r], az + oz, bx + ox, by + lipRows[r], bz + oz);
      lip.nrm.push(nx, 0, nz, nx, 0, nz);
      lip.uv.push(ua, ay + lipRows[r], ub, by + lipRows[r]);
      lip.col.push(lipTone[r], lipTone[r], lipTone[r], lipTone[r], lipTone[r], lipTone[r]);
    }
    for (let r = 0; r < 2; r++) {
      const a0 = lb + r * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      lip.idx.push(a1, b1, b0, a1, b0, a0);
    }
  }
  const out: MeshBuffer[] = [];
  if (wall.idx.length) out.push(meshFrom("vr-section", VR_SECTION_MATERIAL, wall.pos, wall.nrm, wall.uv, wall.col, wall.idx));
  if (lip.idx.length) out.push(meshFrom("vr-section", "bronze", lip.pos, lip.nrm, lip.uv, lip.col, lip.idx));
  return out;
}

function sectionRows(top: number, datum: number): number[] {
  const bottom = Math.min(datum - 34, top - 8);
  const r2 = top - 3.2;
  return [top, top - 0.9, r2, r2 + (bottom - r2) * 0.42, bottom];
}

// ---------------------------------------------------------------------------
// Quest light bake for terrain
// ---------------------------------------------------------------------------

export function sunDirection(atmosphere: EnvironmentBuild["staging"]["atmosphere"]): [number, number, number] {
  const b = (atmosphere.sun.bearingDeg * Math.PI) / 180;
  const e = (atmosphere.sun.elevationDeg * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
}

/** Key light, sky shading and a relief term (ridges lighter, hollows darker) baked into terrain colours. */
export function bakeTerrainForQuest(m: MeshBuffer, field: EnvironmentBuild["field"], sun: readonly [number, number, number], near: boolean): void {
  bakeMesh(m, { ground: () => -1e4, directional: { dir: sun, strength: 0.62, ambient: 0.64 } });
  const C = m.colors;
  if (!C || !near) return;
  const P = m.positions;
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const avg = (sampleField(field, x + 6, z) + sampleField(field, x - 6, z) + sampleField(field, x, z + 6) + sampleField(field, x, z - 6)) * 0.25;
    const k = Math.min(1.12, Math.max(0.74, 1 + (y - avg) * 0.05));
    // Unlit Quest shading shows vertex colour as is: temper saturated moss and bracken patches.
    const l = 0.2126 * C[i * 3] + 0.7152 * C[i * 3 + 1] + 0.0722 * C[i * 3 + 2];
    C[i * 3] = (C[i * 3] + (l - C[i * 3]) * 0.22) * k;
    C[i * 3 + 1] = (C[i * 3 + 1] + (l - C[i * 3 + 1]) * 0.22) * k;
    C[i * 3 + 2] = (C[i * 3 + 2] + (l - C[i * 3 + 2]) * 0.22) * k;
  }
}

// ---------------------------------------------------------------------------
// Forced perspective for the skyline
// ---------------------------------------------------------------------------

/** Plan distance (blueprint m) beyond which distant places and ranges are exaggerated. */
const SKYLINE_FROM = 900;
/** Vertical exaggeration of distant places and of mountain ranges about their own ground. */
export const VR_SKYLINE_EXAGGERATION = { places: 2.1, ranges: 1.5 } as const;

/**
 * Art direction for VR fields of view: true-scale distant places subtend well under a degree from
 * the Quest vantage, so the allied seat, the capital, towns and ranges are raised about their own
 * ground (forced perspective). The land itself and everything in the holding stay true to scale.
 */
export function exaggerateSkyline(m: MeshBuffer, f: MiniatureFrame, ground: (x: number, z: number) => number): MeshBuffer {
  if (m.part !== "outer" && m.part !== "skyline") return m;
  const k = m.part === "skyline" ? VR_SKYLINE_EXAGGERATION.ranges : VR_SKYLINE_EXAGGERATION.places;
  const P = m.positions.slice();
  let changed = false;
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - f.centerX, dz = P[i + 2] - f.centerZ;
    if (dx * dx + dz * dz < SKYLINE_FROM * SKYLINE_FROM) continue;
    const g = ground(P[i], P[i + 2]);
    P[i + 1] = g + (P[i + 1] - g) * k;
    changed = true;
  }
  return changed ? { ...m, positions: P, bounds: boundsOfPositions(P) } : m;
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

function gateKey(g: StateGate | null): string {
  return g ? `${g.minHallTier ?? "_"}:${g.maxHallTier ?? "_"}:${g.flag ?? "_"}` : "-";
}

function indexArray(values: ArrayLike<number>, vertexCount: number): Uint16Array | Uint32Array {
  const out = vertexCount > 65535 ? new Uint32Array(values.length) : new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i];
  return out;
}

/** Merges meshes by material, motion and state gate; landmark identity survives per vertex. */
export function packGroups(meshes: readonly MeshBuffer[]): PackedGroup[] {
  const groups = new Map<string, MeshBuffer[]>();
  for (const m of meshes) {
    const key = `${m.material}|${m.motion ? JSON.stringify(m.motion) : "-"}|${gateKey(m.gate)}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const out: PackedGroup[] = [];
  const keys = Array.from(groups.keys()).sort();
  for (const key of keys) {
    const list = groups.get(key) as MeshBuffer[];
    let vc = 0, ic = 0;
    let hasMotion = false, hasLandmark = false;
    for (const m of list) {
      vc += m.positions.length / 3;
      ic += m.indices.length;
      if (m.motionWeights) hasMotion = true;
      if (m.landmark || m.landmarkIds) hasLandmark = true;
    }
    const positions = new Float32Array(vc * 3), normals = new Float32Array(vc * 3), uvs = new Float32Array(vc * 2), colors = new Float32Array(vc * 3);
    const motionWeights = hasMotion ? new Float32Array(vc) : null;
    const landmarkIds = hasLandmark ? new Uint8Array(vc) : null;
    const indices = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
    let vo = 0, io = 0;
    let bounds = emptyBounds();
    const LM = ["banner-hall", "muster-grounds", "war-record", "heralds-station"];
    for (const m of list) {
      const n = m.positions.length / 3;
      positions.set(m.positions, vo * 3);
      normals.set(m.normals, vo * 3);
      uvs.set(m.uvs, vo * 2);
      if (m.colors) colors.set(m.colors, vo * 3);
      else colors.fill(1, vo * 3, (vo + n) * 3);
      if (motionWeights && m.motionWeights) motionWeights.set(m.motionWeights, vo);
      if (landmarkIds) {
        if (m.landmarkIds) landmarkIds.set(m.landmarkIds, vo);
        else if (m.landmark) landmarkIds.fill(LM.indexOf(m.landmark) + 1, vo, vo + n);
      }
      for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
      bounds = {
        min: [Math.min(bounds.min[0], m.bounds.min[0]), Math.min(bounds.min[1], m.bounds.min[1]), Math.min(bounds.min[2], m.bounds.min[2])],
        max: [Math.max(bounds.max[0], m.bounds.max[0]), Math.max(bounds.max[1], m.bounds.max[1]), Math.max(bounds.max[2], m.bounds.max[2])],
      };
      vo += n;
      io += m.indices.length;
    }
    const first = list[0];
    out.push({ key, material: first.material, part: first.part, motion: first.motion, gate: first.gate, positions, normals, uvs, colors, motionWeights, landmarkIds, indices, bounds, triangles: ic / 3 });
  }
  return out;
}

function packPrototype(p: MeshBuffer): PackedPrototype {
  const n = p.positions.length / 3;
  return {
    material: p.material,
    motion: p.motion,
    positions: p.positions.slice(),
    normals: p.normals.slice(),
    uvs: p.uvs.slice(),
    colors: p.colors ? p.colors.slice() : new Float32Array(n * 3).fill(1),
    motionWeights: p.motionWeights ? p.motionWeights.slice() : null,
    landmarkIds: p.landmarkIds ? p.landmarkIds.slice() : null,
    indices: indexArray(p.indices, n),
    triangles: p.indices.length / 3,
  };
}

function kindOf(name: string): InstanceKind {
  if (name.indexOf("veg:") === 0) return "vegetation";
  if (name.indexOf("clutter:") === 0) return "clutter";
  if (name.indexOf("agents:") === 0) return "agents";
  if (name.indexOf("slot:") === 0) return "slot";
  return "other";
}

function prototypeExtent(set: InstanceSet): { radius: number; top: number } {
  let radius = 0, top = 0;
  for (const p of set.prototypes) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) {
      const r = Math.sqrt(P[i] * P[i] + P[i + 2] * P[i + 2]);
      if (r > radius) radius = r;
      if (P[i + 1] > top) top = P[i + 1];
    }
  }
  return { radius, top };
}

/** Culls scattered instances to the miniature and reorders them so every prefix is an even subset. */
export function prepareInstances(sets: readonly InstanceSet[], f: MiniatureFrame): { sets: PackedInstanceSet[]; culled: number } {
  const out: PackedInstanceSet[] = [];
  let culled = 0;
  const cut = f.nearCut + CUT_JITTER;
  for (const set of sets) {
    const kind = kindOf(set.name);
    const prototypes = set.prototypes.map(packPrototype);
    if (kind === "agents" || kind === "slot") {
      out.push({ name: set.name, part: set.part, kind, prototypes, transforms: set.transforms.slice(), tints: set.tints ? set.tints.slice() : null, count: set.count, motion: set.motion, gate: set.gate });
      continue;
    }
    const ext = prototypeExtent(set);
    const seed = hashString(set.name);
    const keep: { i: number; key: number }[] = [];
    const T = set.transforms;
    for (let i = 0; i < set.count; i++) {
      const o = i * 16;
      const sx = Math.sqrt(T[o] * T[o] + T[o + 1] * T[o + 1] + T[o + 2] * T[o + 2]);
      const sz = Math.sqrt(T[o + 8] * T[o + 8] + T[o + 9] * T[o + 9] + T[o + 10] * T[o + 10]);
      const x = T[o + 12], z = T[o + 14];
      const v = frameV(f, x, z);
      const u = frameU(f, x, z);
      if (v + ext.radius * Math.max(sx, sz) > cut || presence(f, u, v) < 0.03) {
        culled++;
        continue;
      }
      keep.push({ i, key: hash01(i, 17, 3, seed) });
    }
    keep.sort((a, b) => a.key - b.key || a.i - b.i);
    const transforms = new Float32Array(keep.length * 16);
    const tints = set.tints ? new Float32Array(keep.length * 3) : null;
    for (let k = 0; k < keep.length; k++) {
      transforms.set(T.subarray(keep[k].i * 16, keep[k].i * 16 + 16), k * 16);
      if (tints && set.tints) tints.set(set.tints.subarray(keep[k].i * 3, keep[k].i * 3 + 3), k * 3);
    }
    if (keep.length === 0) continue;
    out.push({ name: set.name, part: set.part, kind, prototypes, transforms, tints, count: keep.length, motion: set.motion, gate: set.gate });
  }
  return { sets: out, culled };
}

// ---------------------------------------------------------------------------
// Height envelope and the entry point
// ---------------------------------------------------------------------------

/** Max height of everything standing on the miniature, in the authored viewer frame (3 m cells). */
export function buildEnvelope(f: MiniatureFrame, field: EnvironmentBuild["field"], groups: readonly PackedGroup[], sets: readonly PackedInstanceSet[]): HeightEnvelope {
  const W = f.halfWidth + f.lateral + 40;
  const env = createEnvelope(-W, -(f.halfDepth + f.far + 40), W, f.nearCut + 40, 3);
  for (let r = 0; r < env.rows; r++) {
    for (let c = 0; c < env.cols; c++) {
      const u = env.u0 + (c + 0.5) * env.cell, v = env.v0 + (r + 0.5) * env.cell;
      const x = f.centerX + u * f.cos - v * f.sin, z = f.centerZ + u * f.sin + v * f.cos;
      env.heights[r * env.cols + c] = sampleField(field, x, z);
    }
  }
  for (const g of groups) {
    if (g.material === "far-terrain" || g.material === "silhouette" || g.material === "skyline") continue;
    const P = g.positions;
    for (let i = 0; i < P.length; i += 3) raiseEnvelope(env, frameU(f, P[i], P[i + 2]), frameV(f, P[i], P[i + 2]), P[i + 1], 1.5);
  }
  for (const s of sets) {
    if (s.kind === "agents") continue;
    let radius = 0, top = 0;
    for (const p of s.prototypes) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const rr = Math.sqrt(p.positions[i] * p.positions[i] + p.positions[i + 2] * p.positions[i + 2]);
        if (rr > radius) radius = rr;
        if (p.positions[i + 1] > top) top = p.positions[i + 1];
      }
    }
    const T = s.transforms;
    for (let i = 0; i < s.count; i++) {
      const o = i * 16;
      const sy = Math.sqrt(T[o + 4] * T[o + 4] + T[o + 5] * T[o + 5] + T[o + 6] * T[o + 6]);
      const sx = Math.sqrt(T[o] * T[o] + T[o + 1] * T[o + 1] + T[o + 2] * T[o + 2]);
      raiseEnvelope(env, frameU(f, T[o + 12], T[o + 14]), frameV(f, T[o + 12], T[o + 14]), T[o + 13] + top * sy, radius * sx);
    }
  }
  return env;
}

/** Panel layouts for both postures at the rotation the envelope was built for. */
export function solveLayouts(vr: EnvironmentBuild["staging"]["vr"], env: HeightEnvelope, userYawDeg: number): Record<VrPosture, PanelLayout> {
  const seated = miniatureFrame(vr, "seated", userYawDeg);
  const standing = miniatureFrame(vr, "standing", userYawDeg);
  return { seated: solvePanelLayout(seated, env, seated.yaw), standing: solvePanelLayout(standing, env, standing.yaw) };
}

/**
 * Prepares a quest-profile build for the Quest table-top presentation at a user rotation
 * (degrees, snapped by the caller). Pure and deterministic; never mutates `build`, so a
 * worker may keep the build and prepare it again for another rotation.
 */
export function prepareQuestMiniature(build: EnvironmentBuild, userYawDeg = 0): QuestMiniature {
  const vr = build.staging.vr;
  const f = miniatureFrame(vr, "seated", userYawDeg);
  const sun = sunDirection(build.staging.atmosphere);
  const bp = getBannerholdBlueprint(build.nationId);
  const farGround = createFarField(bp, createTerrainSampler(bp.terrain));
  const kept: MeshBuffer[] = [];
  const edges: number[] = [];
  let dropped = 0;
  const byPart: Record<string, number> = {};
  for (const source of build.meshes) {
    const terrain = source.part === "terrain" || source.part === "far-terrain";
    const r = clipToMiniature(source, f, terrain ? edges : null);
    dropped += r.dropped;
    if (!r.mesh) continue;
    // Bake on the miniature's own colours (never the build's), so the build can be prepared again.
    if (terrain) {
      const own = r.mesh.colors === source.colors && r.mesh.colors ? { ...r.mesh, colors: r.mesh.colors.slice() } : r.mesh;
      bakeTerrainForQuest(own, build.field, sun, source.part === "terrain");
      kept.push(own);
    } else kept.push(exaggerateSkyline(r.mesh, f, farGround));
  }
  for (const m of buildSection(edges, f, build.nationId)) kept.push(m);
  for (const m of kept) byPart[m.part] = (byPart[m.part] ?? 0) + m.indices.length / 3;
  const groups = packGroups(kept);
  const inst = prepareInstances(build.instances, f);
  let staticTriangles = 0, instanceTriangles = 0, instanceDraws = 0;
  for (const g of groups) staticTriangles += g.triangles;
  for (const s of inst.sets) {
    for (const p of s.prototypes) {
      instanceDraws++;
      instanceTriangles += p.triangles * s.count;
      byPart[s.part] = (byPart[s.part] ?? 0) + p.triangles * s.count;
    }
  }
  const envelope = buildEnvelope(f, build.field, groups, inst.sets);
  return {
    version: 1,
    nationId: build.nationId,
    groups,
    instances: inst.sets,
    envelope,
    userYawDeg,
    layouts: solveLayouts(vr, envelope, userYawDeg),
    stats: { groups: groups.length, instanceDraws, staticTriangles, instanceTriangles, trianglesByPart: byPart, droppedTriangles: dropped, culledInstances: inst.culled, sectionEdges: edges.length / 6, prepMs: 0 },
    agents: build.agents,
    slots: build.slots,
    initialSlots: build.initialSlots,
    slotCapacities: build.slotCapacities,
    landmarks: build.landmarks,
    smoke: build.smoke,
    fires: build.fires,
    field: { ...build.field, heights: build.field.heights.slice() },
    colliders: build.colliders.filter((c) => c.blocksCamera).map((c) => ({ ...c })),
    vr,
    atmosphere: build.staging.atmosphere,
    buildStats: build.stats,
  };
}

/** Transferable buffers of a prepared miniature (for postMessage). */
export function miniatureTransferables(m: QuestMiniature): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null | undefined): void => {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  };
  for (const g of m.groups) {
    add(g.positions); add(g.normals); add(g.uvs); add(g.colors); add(g.motionWeights); add(g.landmarkIds); add(g.indices);
  }
  for (const s of m.instances) {
    add(s.transforms); add(s.tints);
    for (const p of s.prototypes) {
      add(p.positions); add(p.normals); add(p.uvs); add(p.colors); add(p.motionWeights); add(p.landmarkIds); add(p.indices);
    }
  }
  add(m.envelope.heights);
  add(m.field.heights);
  return Array.from(set);
}
