// Terrain kit: one variable-resolution heightfield over a large square around the
// holding. Inside the blueprint extents heights come from the blueprint sampler;
// outside, a far field built from the blueprint's distant places, skyline ridges and
// outer roads takes over, blended so near and far meshes share their boundary
// vertices exactly. Near terrain carries splat weights and painted paths/fields.

import type { BannerholdBlueprint, TerrainSampler, Vec2 } from "../../blueprint";
import { distanceToPolyline, pointInPolygon, shapePolygon } from "../../blueprint";
import { boundsOfPositions, clamp, fbm2, hexToLinear, noise2, smoothstep } from "../../kernel";
import type { MeshBuffer } from "../../kernel";
import type { KitContext } from "../context";
import { FIELD_HEX, SURFACE_LAYER, surfaceColor } from "./surfaces";

/** Grid coordinates: fine inside [-half, half] around `center`, growing geometrically to `limit`. */
export function gradedAxis(min: number, max: number, center: number, half: number, cell: number, growth: number, maxCell: number): number[] {
  const set = new Set<number>();
  const push = (v: number): void => {
    set.add(Math.round(v * 1000) / 1000);
  };
  let lo = Math.max(min, center - half);
  let hi = Math.min(max, center + half);
  lo = Math.ceil(lo / cell) * cell;
  hi = Math.floor(hi / cell) * cell;
  for (let v = lo; v <= hi + 1e-6; v += cell) push(v);
  let step = cell;
  for (let v = lo; v > min; ) {
    step = Math.min(maxCell, step * growth);
    v -= step;
    push(Math.max(min, v));
  }
  step = cell;
  for (let v = hi; v < max; ) {
    step = Math.min(maxCell, step * growth);
    v += step;
    push(Math.min(max, v));
  }
  push(min);
  push(max);
  return Array.from(set).sort((a, b) => a - b);
}

/** Extends a graded axis beyond its ends to ±R with geometrically growing steps. */
export function extendAxis(inner: readonly number[], R: number, growth = 1.28): number[] {
  const n = inner.length;
  const low: number[] = [];
  let cur = inner[0];
  let step = inner[1] - inner[0];
  while (cur > -R) {
    step = Math.min(step * growth, R * 0.08);
    cur = Math.max(-R, cur - step);
    low.push(cur);
  }
  const high: number[] = [];
  cur = inner[n - 1];
  step = inner[n - 1] - inner[n - 2];
  while (cur < R) {
    step = Math.min(step * growth, R * 0.08);
    cur = Math.min(R, cur + step);
    high.push(cur);
  }
  return low.reverse().concat(inner as number[], high);
}

interface FarControl {
  x: number;
  z: number;
  h: number;
  r: number;
}

/** Far-field height model derived from the blueprint's outer territory. */
export function createFarField(bp: BannerholdBlueprint, sampler: TerrainSampler): (x: number, z: number) => number {
  const e = sampler.model.extents;
  const controls: FarControl[] = [];
  for (const p of bp.outer.places) {
    if (p.distance > 12000) continue;
    controls.push({ x: p.position[0], z: p.position[1], h: p.groundElevation, r: Math.max(p.radius * 2.2, p.distance * 0.12) });
  }
  for (const s of bp.outer.skyline) {
    if (s.kind !== "ridge" && s.kind !== "forest" && s.kind !== "mesa" && s.kind !== "dunes") continue;
    if (s.distance > 9000) continue;
    let from = s.bearingFromDeg, to = s.bearingToDeg;
    if (to < from) to += 360;
    const n = Math.max(3, Math.round((to - from) / 12));
    for (let i = 0; i <= n; i++) {
      const b = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      const d = Math.max(s.distance, 240);
      controls.push({ x: Math.sin(b) * d, z: -Math.cos(b) * d, h: s.kind === "forest" ? s.height * 0.5 : s.height, r: Math.max(90, d * 0.25) });
    }
  }
  // Outer roads run along valley floors: pull the land toward the road level.
  const roads = bp.routes.filter((r) => r.outer && r.hierarchy === "national");
  const edge = (x: number, z: number): number => sampler.height(clamp(x, e.minX, e.maxX), clamp(z, e.minZ, e.maxZ));
  const base = (x: number, z: number): number => {
    let wsum = 0.0002, hsum = 0.0002 * edge(x, z) * 0.5;
    for (const c of controls) {
      const dx = x - c.x, dz = z - c.z;
      const w = 1 / (dx * dx + dz * dz + c.r * c.r);
      wsum += w;
      hsum += w * c.h;
    }
    return hsum / wsum;
  };
  const seed = bp.terrain.features.length * 31 + 7;
  return (x: number, z: number): number => {
    const ox = x < e.minX ? e.minX - x : x > e.maxX ? x - e.maxX : 0;
    const oz = z < e.minZ ? e.minZ - z : z > e.maxZ ? z - e.maxZ : 0;
    const out = Math.sqrt(ox * ox + oz * oz);
    const near = edge(x, z);
    if (out <= 0) return sampler.height(x, z);
    let h = base(x, z);
    const dist = Math.sqrt(x * x + z * z);
    const amp = Math.min(70, 4 + dist * 0.018);
    h += (fbm2(x / 420, z / 420, seed, 4) * 2 - 1) * amp + (fbm2(x / 90, z / 90, seed + 9, 3) * 2 - 1) * Math.min(8, 1 + dist * 0.004);
    for (const r of roads) {
      const d = distanceToPolyline([x, z], r.points);
      if (d < 260) {
        const roadLevel = Math.min(h, near * 0.3 + h * 0.4);
        h += (roadLevel - h) * (1 - smoothstep(30, 260, d));
      }
    }
    const w = smoothstep(0, 260, out);
    return near + (h - near) * w;
  };
}

export interface TerrainBuild {
  near: MeshBuffer;
  far: MeshBuffer;
}

interface PaintPath {
  points: readonly Vec2[];
  half: number;
  color: readonly [number, number, number];
  layer: 0 | 1 | 2 | 3;
}

export function buildTerrain(ctx: KitContext): TerrainBuild {
  const { bp, terrain, quality } = ctx;
  const e = terrain.model.extents;
  const q = quality.terrain;
  const center: Vec2 = [bp.vr.displayCenter[0], bp.vr.displayCenter[1]];
  const R = quality.farTerrain.radius;
  const fg = quality.farTerrain.growth;
  const gx = extendAxis(gradedAxis(e.minX, e.maxX, center[0], q.coreHalfX, q.coreCell, q.growth, q.maxCell), R, fg);
  const gz = extendAxis(gradedAxis(e.minZ, e.maxZ, center[1], q.coreHalfZ, q.coreCell, q.growth, q.maxCell), R, fg);
  const far = createFarField(bp, terrain);
  const nx = gx.length, nz = gz.length;
  const H = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = far(gx[i], gz[j]);

  // Painted paths (unpaved routes) and paved-route underlay.
  const paths: PaintPath[] = [];
  for (const r of bp.routes) {
    if (r.grade === "elevated" || r.kind === "stair") continue;
    const paved = r.surface === "cobble" || r.surface === "setts" || r.surface === "flagstone" || r.surface === "sandstone-paving" || r.surface === "concrete" || r.surface === "asphalt";
    const col = paved ? surfaceColor("cobble") : r.surface === "gravel" ? surfaceColor("gravel") : surfaceColor("earth");
    paths.push({ points: r.points, half: r.width / 2 + (paved ? 0.6 : 0.35), color: col, layer: paved ? 3 : 1 });
  }
  const fields = bp.outer.fields.map((f) => ({ poly: f.polygon, color: hexToLinear(FIELD_HEX[f.condition] ?? FIELD_HEX.tended), bearing: (f.furrowBearingDeg * Math.PI) / 180 }));
  const zones = bp.terrain.surfaces.map((s) => ({ s, poly: shapePolygon(s.shape) }));
  const forestPolys = bp.vegetation.filter((v) => v.kind === "forest" || v.kind === "woodland").map((v) => shapePolygon(v.shape));

  const nearIdx: number[] = [];
  const farIdx: number[] = [];
  // Shared vertex arrays (both meshes index the same grid; split later).
  const P = new Float32Array(nx * nz * 3);
  const N = new Float32Array(nx * nz * 3);
  const UV = new Float32Array(nx * nz * 2);
  const C = new Float32Array(nx * nz * 3);
  const S = new Float32Array(nx * nz * 4);
  const seed = 4211;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = gx[i], z = gz[j], y = H[k];
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      UV[k * 2] = x; UV[k * 2 + 1] = z;
      const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1);
      const jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
      const dhdx = (H[j * nx + ir] - H[j * nx + il]) / Math.max(1e-6, gx[ir] - gx[il]);
      const dhdz = (H[ju * nx + i] - H[jd * nx + i]) / Math.max(1e-6, gz[ju] - gz[jd]);
      let ux = -dhdx, uy = 1, uz = -dhdz;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= l; uy /= l; uz /= l;
      N[k * 3] = ux; N[k * 3 + 1] = uy; N[k * 3 + 2] = uz;
      const slope = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
      const inside = x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ;
      let col: readonly [number, number, number];
      let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
      if (inside) {
        const surf = terrain.surface(x, z);
        col = surfaceColor(surf);
        const layer = SURFACE_LAYER[surf];
        if (layer === 0) w0 = 1; else if (layer === 1) w1 = 1; else if (layer === 2) w2 = 1; else w3 = 1;
        if (layer === 0 && surf !== "snow" && surf !== "field") col = groundPatches(col, x, z, seed, surf === "heath", 1);
        for (const zf of zones) if (zf.s.surface === "field" && pointInPolygon([x, z], zf.poly)) col = surfaceColor("field");
        for (const f of fields) {
          if (pointInPolygon([x, z], f.poly)) {
            const stripe = Math.sin((x * Math.cos(f.bearing) + z * Math.sin(f.bearing)) * 2.1) * 0.12;
            col = [f.color[0] * (1 + stripe), f.color[1] * (1 + stripe), f.color[2] * (1 + stripe)];
            w0 = 0.4; w1 = 0.6; w2 = 0; w3 = 0;
          }
        }
        // Painted paths.
        for (const p of paths) {
          const d = distanceToPolyline([x, z], p.points);
          if (d < p.half + 0.8) {
            const t = 1 - smoothstep(p.half - 0.4, p.half + 0.8, d);
            col = [col[0] + (p.color[0] - col[0]) * t, col[1] + (p.color[1] - col[1]) * t, col[2] + (p.color[2] - col[2]) * t];
            const lt = [0, 0, 0, 0];
            lt[p.layer] = t;
            w0 = w0 * (1 - t) + lt[0]; w1 = w1 * (1 - t) + lt[1]; w2 = w2 * (1 - t) + lt[2]; w3 = w3 * (1 - t) + lt[3];
          }
        }
        // Forest floor darkening under the woods.
        for (const fp of forestPolys) {
          if (pointInPolygon([x, z], fp)) {
            const fc = surfaceColor("forest-floor");
            col = [col[0] * 0.5 + fc[0] * 0.5, col[1] * 0.5 + fc[1] * 0.5, col[2] * 0.5 + fc[2] * 0.5];
            break;
          }
        }
      } else {
        // Far land: heath and dark woods, rock on steep ground.
        const wood = fbm2(x / 650, z / 650, seed + 3, 3);
        const heath = surfaceColor("heath"), grass = surfaceColor("grass"), forest = surfaceColor("forest-floor");
        const t = smoothstep(0.45, 0.62, wood);
        const m = noise2(x / 300, z / 300, seed + 5);
        col = groundPatches([
          (heath[0] * m + grass[0] * (1 - m)) * (1 - t) + forest[0] * 0.8 * t,
          (heath[1] * m + grass[1] * (1 - m)) * (1 - t) + forest[1] * 0.8 * t,
          (heath[2] * m + grass[2] * (1 - m)) * (1 - t) + forest[2] * 0.8 * t,
        ], x, z, seed, m > 0.5, 3);
        w0 = 1;
      }
      // Steep ground shows rock.
      const rockT = smoothstep(0.75, 1.35, slope);
      if (rockT > 0 && w3 < 0.5) {
        const rc = surfaceColor("rock");
        col = [col[0] + (rc[0] - col[0]) * rockT, col[1] + (rc[1] - col[1]) * rockT, col[2] + (rc[2] - col[2]) * rockT];
        w0 *= 1 - rockT; w1 *= 1 - rockT; w3 *= 1 - rockT; w2 = w2 * (1 - rockT) + rockT;
      }
      // Low-frequency tonal variation.
      const v = 0.82 + 0.34 * fbm2(x / 28, z / 28, seed, 3);
      C[k * 3] = col[0] * v; C[k * 3 + 1] = col[1] * v; C[k * 3 + 2] = col[2] * v;
      const ws = w0 + w1 + w2 + w3 || 1;
      S[k * 4] = w0 / ws; S[k * 4 + 1] = w1 / ws; S[k * 4 + 2] = w2 / ws; S[k * 4 + 3] = w3 / ws;
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      const cxm = (gx[i] + gx[i + 1]) / 2, czm = (gz[j] + gz[j + 1]) / 2;
      const inside = cxm >= e.minX && cxm <= e.maxX && czm >= e.minZ && czm <= e.maxZ;
      const list = inside ? nearIdx : farIdx;
      // Split along the diagonal with the smaller height difference.
      // Triangles wind counter-clockwise seen from above (+Y): a(i,j) -> d(i,j+1) -> c -> b.
      if (Math.abs(H[a] - H[c]) <= Math.abs(H[b] - H[d])) list.push(a, d, c, a, c, b);
      else list.push(a, d, b, b, d, c);
    }
  }
  return { near: compact(P, N, UV, C, S, nearIdx, "terrain", "terrain", true), far: compact(P, N, UV, C, null, farIdx, "far-terrain", "far-terrain", false) };
}

const MOSS_PATCH = hexToLinear("#4a5934");
const BRACKEN_PATCH = hexToLinear("#5e4b31");
const HEATHER_PATCH = hexToLinear("#4c3d47");

/**
 * Vegetated ground breaks into patches: greener moss and grass in some stretches, dry
 * bracken in others and heather clumps on heath, so open land never reads as one flat
 * colour. `scale` stretches the pattern for the far land.
 */
function groundPatches(col: readonly [number, number, number], x: number, z: number, seed: number, heath: boolean, scale: number): [number, number, number] {
  const patch = fbm2(x / (46 * scale), z / (46 * scale), seed + 11, 3);
  const fine = fbm2(x / (11 * scale), z / (11 * scale), seed + 13, 2);
  const green = smoothstep(0.52, 0.7, patch) * 0.6;
  const dry = (1 - smoothstep(0.3, 0.44, patch)) * 0.55;
  const heather = heath ? smoothstep(0.5, 0.66, fine) * 0.55 : 0;
  let r = col[0], g = col[1], b = col[2];
  r += (MOSS_PATCH[0] - r) * green; g += (MOSS_PATCH[1] - g) * green; b += (MOSS_PATCH[2] - b) * green;
  r += (BRACKEN_PATCH[0] - r) * dry; g += (BRACKEN_PATCH[1] - g) * dry; b += (BRACKEN_PATCH[2] - b) * dry;
  r += (HEATHER_PATCH[0] - r) * heather; g += (HEATHER_PATCH[1] - g) * heather; b += (HEATHER_PATCH[2] - b) * heather;
  return [r, g, b];
}

function compact(P: Float32Array, N: Float32Array, UV: Float32Array, C: Float32Array, S: Float32Array | null, idx: number[], part: string, material: string, receive: boolean): MeshBuffer {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const indices = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let r = remap.get(idx[i]);
    if (r === undefined) {
      r = order.length;
      remap.set(idx[i], r);
      order.push(idx[i]);
    }
    indices[i] = r;
  }
  const n = order.length;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2), colors = new Float32Array(n * 3);
  const splat = S ? new Float32Array(n * 4) : null;
  for (let i = 0; i < n; i++) {
    const k = order[i];
    positions.set(P.subarray(k * 3, k * 3 + 3), i * 3);
    normals.set(N.subarray(k * 3, k * 3 + 3), i * 3);
    uvs.set(UV.subarray(k * 2, k * 2 + 2), i * 2);
    colors.set(C.subarray(k * 3, k * 3 + 3), i * 3);
    if (splat && S) splat.set(S.subarray(k * 4, k * 4 + 4), i * 4);
  }
  return {
    name: `${part}|${material}`,
    part,
    material,
    positions,
    normals,
    uvs,
    colors,
    splat,
    motionWeights: null,
    landmarkIds: null,
    indices,
    castShadow: false,
    receiveShadow: receive,
    lod: 0,
    landmark: null,
    motion: null,
    gate: null,
    bounds: boundsOfPositions(positions),
  };
}
