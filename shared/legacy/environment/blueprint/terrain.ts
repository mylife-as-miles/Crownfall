// Deterministic terrain elevation model. Both renderers, the map generator and the
// tests sample the same function, so the ground under every building, road and
// camera is identical everywhere. No randomness: noise is a seeded lattice hash.

import { distanceToPolygonEdge, distanceToPolyline, pointInPolygon, shapePolygon, toLocal, polylineLength, dist2 } from "./math2d";
import type { TerrainFeature, TerrainModel, TerrainSurface, Vec2, WaterBody } from "./types";

type PlatformFeature = Extract<TerrainFeature, { kind: "platform" }>;
type RampFeature = Extract<TerrainFeature, { kind: "ramp" }>;

interface CompiledPlatform {
  feature: PlatformFeature | RampFeature;
  /** Platform outline; empty for ramps. */
  polygon: Vec2[];
  rampLength: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainSampler {
  readonly model: TerrainModel;
  /** Ground elevation (metres) at plan point (x, z). */
  height(x: number, z: number): number;
  /** Painted surface category at (x, z) (renderers may add slope-based rock on top). */
  surface(x: number, z: number): TerrainSurface;
  /** Water-surface elevation at (x, z), or NaN when the point is not in water. */
  waterLevel(x: number, z: number): number;
  /** Ground gradient magnitude (rise over run) by central differences. */
  slope(x: number, z: number): number;
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 2D value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const v = a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  return v * 2 - 1;
}

type NoiseFeature = Extract<TerrainFeature, { kind: "noise" }>;

interface CompiledNoise {
  feature: NoiseFeature;
  /** Region outline, or null for global noise. Bounds include the falloff. */
  polygon: Vec2[] | null;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function compileNoise(feature: NoiseFeature): CompiledNoise {
  if (!feature.region) return { feature, polygon: null, minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
  const polygon = shapePolygon(feature.region);
  const f = feature.regionFalloff ?? 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p[0] - f);
    maxX = Math.max(maxX, p[0] + f);
    minZ = Math.min(minZ, p[1] - f);
    maxZ = Math.max(maxZ, p[1] + f);
  }
  return { feature, polygon, minX, maxX, minZ, maxZ };
}

function compilePlatform(feature: PlatformFeature | RampFeature): CompiledPlatform {
  const outline = feature.kind === "platform" ? shapePolygon(feature.shape) : feature.points.slice();
  const pad = feature.kind === "ramp" ? feature.width / 2 : 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p[0] - pad);
    maxX = Math.max(maxX, p[0] + pad);
    minZ = Math.min(minZ, p[1] - pad);
    maxZ = Math.max(maxZ, p[1] + pad);
  }
  return {
    feature,
    polygon: feature.kind === "platform" ? outline : [],
    rampLength: feature.kind === "ramp" ? polylineLength(feature.points) : 0,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

/** Nearest point on a polyline: distance and arc length. */
function nearestOnPolyline(points: readonly Vec2[], x: number, z: number): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - a[0]) * abx + (z - a[1]) * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a[0] + abx * t - x;
    const cz = a[1] + abz * t - z;
    const d = cx * cx + cz * cz;
    const len = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestS = acc + len * t;
    }
    acc += len;
  }
  return { d: Math.sqrt(best), s: bestS };
}

/** Blend weight and target elevation of a platform or ramp at (x, z). */
function platformInfluence(p: CompiledPlatform, x: number, z: number, out: { w: number; e: number }): void {
  out.w = 0;
  const f = p.feature.falloff;
  if (x < p.minX - f || x > p.maxX + f || z < p.minZ - f || z > p.maxZ + f) return;
  if (p.feature.kind === "platform") {
    out.e = p.feature.elevation;
    const pt: Vec2 = [x, z];
    if (pointInPolygon(pt, p.polygon)) {
      out.w = 1;
      return;
    }
    if (f <= 0) return;
    const d = distanceToPolygonEdge(pt, p.polygon);
    if (d < f) out.w = smoothstep01(1 - d / f);
    return;
  }
  const r = p.feature;
  const n = nearestOnPolyline(r.points, x, z);
  const u = p.rampLength > 0 ? n.s / p.rampLength : 0;
  out.e = r.startElevation + (r.endElevation - r.startElevation) * u;
  const hw = r.width / 2;
  if (n.d <= hw) out.w = 1;
  else if (f > 0 && n.d < hw + f) out.w = smoothstep01(1 - (n.d - hw) / f);
}

function waterLineLevel(w: WaterBody, points: readonly Vec2[], x: number, z: number): number {
  const levels = w.pointLevels;
  if (!levels || levels.length !== points.length) return w.level;
  const n = nearestOnPolyline(points, x, z);
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const len = dist2(points[i - 1], points[i]);
    if (n.s <= acc + len || i === points.length - 1) {
      const t = len > 0 ? Math.min(Math.max((n.s - acc) / len, 0), 1) : 0;
      return levels[i - 1] + (levels[i] - levels[i - 1]) * t;
    }
    acc += len;
  }
  return w.level;
}

/** Build a sampler for a terrain model. Cheap to call; cache one per blueprint. */
export function createTerrainSampler(model: TerrainModel): TerrainSampler {
  const slopes: Extract<TerrainFeature, { kind: "slope" }>[] = [];
  const mounds: Extract<TerrainFeature, { kind: "mound" }>[] = [];
  const ridges: Extract<TerrainFeature, { kind: "ridge" }>[] = [];
  const noises: CompiledNoise[] = [];
  const channels: Extract<TerrainFeature, { kind: "channel" }>[] = [];
  const platforms: CompiledPlatform[] = [];
  for (const f of model.features) {
    if (f.kind === "slope") slopes.push(f);
    else if (f.kind === "mound") mounds.push(f);
    else if (f.kind === "ridge") ridges.push(f);
    else if (f.kind === "noise") noises.push(compileNoise(f));
    else if (f.kind === "channel") channels.push(f);
    else platforms.push(compilePlatform(f));
  }
  // Scratch for platformInfluence: reused so sampling never allocates per platform.
  const influence = { w: 0, e: 0 };
  const areaWater = model.water.filter((w) => w.shape.kind === "area");
  const lineWater = model.water.filter((w) => w.shape.kind === "line");
  const surfaceZones = model.surfaces.map((s) => ({ zone: s, polygon: shapePolygon(s.shape) }));

  function natural(x: number, z: number): number {
    let h = model.baseElevation;
    for (const s of slopes) h += s.gradient[0] * x + s.gradient[1] * z;
    for (const m of mounds) {
      const l = toLocal([x, z], m.center, m.rotationDeg ?? 0);
      const u = l[0] / m.radiusX;
      const v = l[1] / m.radiusZ;
      const r = Math.sqrt(u * u + v * v);
      if (r < 1) h += m.height * 0.5 * (1 + Math.cos(Math.PI * r));
    }
    for (const r of ridges) {
      const d = distanceToPolyline([x, z], r.points);
      const hw = r.width / 2;
      if (d < hw) h += r.height * 0.5 * (1 + Math.cos((Math.PI * d) / hw));
    }
    for (const n of noises) {
      let weight = 1;
      if (n.polygon) {
        if (x < n.minX || x > n.maxX || z < n.minZ || z > n.maxZ) continue;
        const pt: Vec2 = [x, z];
        if (!pointInPolygon(pt, n.polygon)) {
          const f = n.feature.regionFalloff ?? 0;
          const d = f > 0 ? distanceToPolygonEdge(pt, n.polygon) : Infinity;
          if (d >= f) continue;
          weight = smoothstep01(1 - d / f);
        }
      }
      const f = n.feature;
      let amp = f.amplitude;
      let freq = 1 / f.wavelength;
      let sum = 0;
      for (let o = 0; o < f.octaves; o++) {
        const v = valueNoise(x * freq, z * freq, f.seed + o * 101);
        // Ridged noise: 1 - |v| folds the field into crests, re-centred on 0.
        sum += (f.style === "ridged" ? (1 - Math.abs(v)) * 2 - 1 : v) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      h += sum * weight;
    }
    for (const c of channels) {
      const d = distanceToPolyline([x, z], c.points);
      const core = c.width / 2;
      if (d <= core) h -= c.depth;
      else if (d < core + c.bankWidth) h -= c.depth * smoothstep01(1 - (d - core) / c.bankWidth);
    }
    return h;
  }

  function height(x: number, z: number): number {
    let h = natural(x, z);
    for (const p of platforms) {
      platformInfluence(p, x, z, influence);
      if (influence.w > 0) h += (influence.e - h) * influence.w;
    }
    return h;
  }

  function surface(x: number, z: number): TerrainSurface {
    let s: TerrainSurface = model.baseSurface;
    const pt: Vec2 = [x, z];
    for (const m of mounds) {
      if (!m.surface) continue;
      const l = toLocal(pt, m.center, m.rotationDeg ?? 0);
      const u = l[0] / m.radiusX;
      const v = l[1] / m.radiusZ;
      if (u * u + v * v < 0.5) s = m.surface;
    }
    for (const r of ridges) if (r.surface && distanceToPolyline(pt, r.points) < r.width * 0.3) s = r.surface;
    for (const c of channels) if (c.surface && distanceToPolyline(pt, c.points) < c.width / 2 + c.bankWidth * 0.4) s = c.surface;
    for (const p of platforms) {
      platformInfluence(p, x, z, influence);
      if (influence.w >= 1) s = p.feature.surface;
    }
    for (const z0 of surfaceZones) if (pointInPolygon(pt, z0.polygon)) s = z0.zone.surface;
    return s;
  }

  function waterLevel(x: number, z: number): number {
    const pt: Vec2 = [x, z];
    for (const w of areaWater) {
      if (w.shape.kind === "area" && pointInPolygon(pt, w.shape.points)) return w.level;
    }
    for (const w of lineWater) {
      if (w.shape.kind !== "line") continue;
      if (distanceToPolyline(pt, w.shape.points) <= w.shape.width / 2) return waterLineLevel(w, w.shape.points, x, z);
    }
    return NaN;
  }

  function slope(x: number, z: number): number {
    const e = 0.5;
    const gx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  }

  return { model, height, surface, waterLevel, slope };
}

/**
 * Regular heightfield over the terrain extents (row-major, rows along +Z).
 * Renderers convert it to a mesh; resolution is chosen per quality profile.
 */
export function buildHeightfield(sampler: TerrainSampler, columns: number, rows: number): { heights: Float32Array; columns: number; rows: number; cellX: number; cellZ: number } {
  const e = sampler.model.extents;
  const heights = new Float32Array(columns * rows);
  const cellX = (e.maxX - e.minX) / (columns - 1);
  const cellZ = (e.maxZ - e.minZ) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    const z = e.minZ + r * cellZ;
    for (let c = 0; c < columns; c++) heights[r * columns + c] = sampler.height(e.minX + c * cellX, z);
  }
  return { heights, columns, rows, cellX, cellZ };
}
