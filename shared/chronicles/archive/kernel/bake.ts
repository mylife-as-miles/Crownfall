// The shared vertex bake. Both platforms bake the same light into vertex data:
// ambient occlusion from the blueprint's volumes and walls, the oculus's sky
// visibility, warm bounce from the sunlit pool, and the practical lamps each
// platform does not light dynamically. Quest also bakes the key's dappled pool
// through the oculus screen and the haze between the stationary eye and each
// surface. The oculus screen's transmission is one function, so the desktop
// light cookie (rasterised by scripts/chronicles/textures) and the Quest bake
// dapple identically.

import type { ArchiveBlueprint, ArchiveLight, ArchiveQuality, Vec2 } from "../types";
import { distanceToOccluder, distanceToPolygonEdge } from "../space";
import type { FormGeometry } from "./forms";
import { noise3, seededRandom } from "./noise";

export interface BakeOptions {
  platform: "desktop" | "quest";
  quality: ArchiveQuality;
  /** Quest: the stationary eye the haze is measured from. */
  posture?: "seated" | "standing";
}

export interface BakedVertices {
  /** Linear RGB irradiance from baked sources. Desktop: practicals and bounce, added over the albedo. Quest: every source, the albedo's full multiplier. */
  light: Float32Array;
  /** Ambient occlusion with sky visibility folded in, 0 to 1 (desktop: scales the dynamic fill). */
  ao: Float32Array;
  /** Quest: the share of haze between the eye and the vertex, 0 to 1. */
  haze: Float32Array | null;
}

/** sRGB hex to linear RGB. */
export function linearColor(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  const channel = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return [channel((value >> 16) & 255), channel((value >> 8) & 255), channel(value & 255)];
}

// ---------------------------------------------------------------------------
// The oculus screen

interface Hole { x: number; z: number; spin: number }
const holeCache = new Map<string, Hole[]>();

/** Star-shaped holes scattered through the screen's outer band, deterministic from the tracery seed. */
function holes(blueprint: ArchiveBlueprint): Hole[] {
  const t = blueprint.chamber.oculus.tracery, key = `${t.seed}:${t.holes}:${t.band[0]}:${t.band[1]}`;
  let list = holeCache.get(key);
  if (list) return list;
  list = [];
  const random = seededRandom(t.seed);
  const rings = 3, perRing = Math.ceil(t.holes / rings);
  for (let ring = 0; ring < rings; ring++) {
    const r = t.band[0] + ((t.band[1] - t.band[0]) * (ring + 0.5)) / rings;
    for (let k = 0; k < perRing && list.length < t.holes; k++) {
      const a = ((k + (ring % 2) * 0.5 + (random() - 0.5) * 0.35) / perRing) * Math.PI * 2;
      const jitter = (random() - 0.5) * (t.band[1] - t.band[0]) * 0.18;
      list.push({ x: Math.sin(a) * (r + jitter), z: -Math.cos(a) * (r + jitter), spin: random() * Math.PI * 2 });
    }
  }
  holeCache.set(key, list);
  return list;
}

/**
 * Light passing the oculus screen at a point of its plane, in units of the
 * oculus radius from its centre: 1 through the open centre and the holes, 0 on
 * the bars, the pierced band and outside the opening. Edges soften over `soft`.
 */
export function oculusTransmission(blueprint: ArchiveBlueprint, u: number, v: number, soft = 0.012): number {
  const t = blueprint.chamber.oculus.tracery, r = Math.hypot(u, v);
  const edge = (distance: number) => Math.max(0, Math.min(1, 0.5 + distance / soft));
  if (r >= 1 + soft) return 0;
  const rim = edge(1 - r);
  if (r < t.open) return rim;
  if (r < t.band[0]) {
    // Radial bars between the open centre and the band.
    const step = (Math.PI * 2) / t.bars, angle = Math.atan2(u, -v);
    const offset = angle - step * (Math.round(angle / step - 0.5) + 0.5);
    return rim * edge(Math.abs(offset) * r - t.barWidth / 2);
  }
  // The pierced band: open only through the star holes.
  let open = 0;
  for (const hole of holes(blueprint)) {
    const dx = u - hole.x, dz = v - hole.z;
    if (Math.abs(dx) > t.holeRadius * 1.5 || Math.abs(dz) > t.holeRadius * 1.5) continue;
    const a = Math.atan2(dx, dz) + hole.spin, d = Math.hypot(dx, dz);
    const star = t.holeRadius * (0.62 + 0.38 * Math.cos(5 * a));
    open = Math.max(open, edge(star - d));
  }
  return rim * open;
}

/** The key light's geometry, shared by the bake and the cookie generator. */
export function keyGeometry(blueprint: ArchiveBlueprint) {
  const key = blueprint.lights.find((light) => light.kind === "key")!;
  const p = key.position, t = key.target!;
  const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2], length = Math.hypot(dx, dy, dz);
  const dir: [number, number, number] = [dx / length, dy / length, dz / length];
  const plane = blueprint.chamber.oculus.center[1] + 0.32;
  /** Half the width of the cookie's square at the screen's plane. */
  const halfAtScreen = ((plane - p[1]) / dir[1]) * Math.tan(key.cone!.angle);
  return { key, position: p, dir, plane, halfAtScreen: Math.abs(halfAtScreen) };
}

/**
 * The cookie texel at (u, v) in [0, 1]: what the screen passes along that ray
 * from the key. The renderer orients the spot's projection with north up, so v
 * runs toward -Z and u toward +X across the screen's plane.
 */
export function keyCookieAt(blueprint: ArchiveBlueprint, u: number, v: number): number {
  const geometry = keyGeometry(blueprint), radius = blueprint.chamber.oculus.radius, centre = blueprint.chamber.oculus.center;
  const x = (u - 0.5) * 2 * geometry.halfAtScreen, z = -(v - 0.5) * 2 * geometry.halfAtScreen;
  // The cone's axis meets the screen's plane slightly off the oculus centre.
  const along = (geometry.plane - geometry.position[1]) / geometry.dir[1];
  const ax = geometry.position[0] + geometry.dir[0] * along, az = geometry.position[2] + geometry.dir[2] * along;
  return oculusTransmission(blueprint, (ax + x - centre[0]) / radius, (az + z - centre[2]) / radius, 0.02);
}

/** The key's dappled pool at a point: the screen's transmission along the ray to the key. */
export function keyPoolAt(blueprint: ArchiveBlueprint, x: number, y: number, z: number): number {
  const g = keyGeometry(blueprint), radius = blueprint.chamber.oculus.radius, centre = blueprint.chamber.oculus.center;
  if (y >= g.plane) return 0;
  // Walk from the point toward the key until the screen's plane.
  const tx = g.position[0] - x, ty = g.position[1] - y, tz = g.position[2] - z;
  const s = (g.plane - y) / ty;
  return oculusTransmission(blueprint, (x + tx * s - centre[0]) / radius, (z + tz * s - centre[2]) / radius, 0.03);
}

// ---------------------------------------------------------------------------
// Regions of the plan

function sideOf(g: FormGeometry, x: number, z: number): { side: number; s: number; d: number } {
  const step = (Math.PI * 2) / g.sides;
  const side = ((Math.round(Math.atan2(x, -z) / step) % g.sides) + g.sides) % g.sides;
  const b = side * step, cx = Math.sin(b) * g.apothem, cz = -Math.cos(b) * g.apothem;
  const dx = x - cx, dz = z - cz;
  return { side, s: dx * Math.cos(b) + dz * Math.sin(b), d: dx * Math.sin(b) - dz * Math.cos(b) };
}

/** How much of the chamber's open volume (and so the oculus) a point sees: 1 in the chamber, falling into the bays, near 0 in the gallery passage. */
function chamberVisibility(g: FormGeometry, x: number, y: number, z: number, depths: readonly number[]): number {
  const { side, d } = sideOf(g, x, z);
  if (y > g.levels.gallery - 0.05 && y < g.levels.cornice + 0.05 && d > 0.25) return 0.05;
  if (d <= -g.arch.wallInner) return 1;
  if (d <= g.arch.wallOuter) return 0.85;
  const depth = depths[side] || 1;
  return 0.12 + 0.6 * (1 - Math.min(1, (d - g.arch.wallOuter) / Math.max(1, depth - g.arch.wallOuter)));
}

// ---------------------------------------------------------------------------

/**
 * Bakes vertex data in slices of `perSlice` vertices; yields the share done.
 * Pure and deterministic for the same inputs.
 */
export function* bakeVerticesSlices(blueprint: ArchiveBlueprint, g: FormGeometry, positions: Float32Array, normals: Float32Array, options: BakeOptions, perSlice = 4096): Generator<number, BakedVertices, void> {
  const count = positions.length / 3;
  const light = new Float32Array(count * 3), ao = new Float32Array(count), haze = options.platform === "quest" ? new Float32Array(count) : null;
  const depths = blueprint.chamber.sides.map((side) => side.depth);
  const footprint: readonly Vec2[] = blueprint.chamber.footprint;
  const floorOccluders = blueprint.occluders.filter((volume) => volume.center[1] - volume.size[1] / 2 < 0.2 && (options.platform === "desktop" || volume.id !== "monument-desktop"));
  const treatment = (light: ArchiveLight) => (options.platform === "quest" ? light.quest : light.desktop[options.quality === "quest" ? "low" : options.quality]);
  const baked = blueprint.lights.filter((item) => item.kind === "practical" && !item.dormant && treatment(item) === "baked");
  const bakedColors = baked.map((item) => linearColor(item.color));
  const bounce = blueprint.lights.find((item) => item.id === "fill-bounce")!, bounceColor = linearColor(bounce.color);
  const fill = blueprint.lights.find((item) => item.id === "fill-sky")!, sky = linearColor(fill.color), ground = linearColor(fill.groundColor || "#000000");
  const keyColor = linearColor(blueprint.lights.find((item) => item.kind === "key")!.color);
  const oculus = blueprint.chamber.oculus.center;
  const vantage = blueprint.viewpoints.quest.find((item) => item.posture === (options.posture || "seated"))!;
  const eye = [vantage.floor[0], vantage.eyeHeight, vantage.floor[2]];
  const hazeVolume = blueprint.atmosphere.find((volume) => volume.kind === "haze")!;
  const keyDir = keyGeometry(blueprint).dir;
  const point: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < count; index++) {
    const x = positions[index * 3], y = positions[index * 3 + 1], z = positions[index * 3 + 2];
    const nx = normals[index * 3], ny = normals[index * 3 + 1], nz = normals[index * 3 + 2];
    const visible = chamberVisibility(g, x, y, z, depths);
    const { side, d } = sideOf(g, x, z);
    const floorY = blueprint.chamber.sides[side].kind === "entrance" && d > g.entrance.start ? g.levels.landing : 0;
    // Ambient occlusion.
    let occlusion = 1;
    if (Math.abs(ny) < 0.6) occlusion *= 1 - 0.3 * (1 - smooth(0, 1.4, y - floorY));
    if (ny > 0.6 && y < floorY + 0.06) {
      occlusion *= 1 - 0.34 * (1 - smooth(0, 1.6, distanceToPolygonEdge(x, z, footprint)));
      point[0] = x; point[1] = 0.05; point[2] = z;
      let nearest = Infinity;
      for (const volume of floorOccluders) nearest = Math.min(nearest, distanceToOccluder(volume, point));
      occlusion *= 1 - 0.4 * (1 - smooth(0, 1.1, nearest));
    }
    if (ny < 0) occlusion *= 1 - 0.3 * -ny;
    if (d > g.arch.wallOuter) occlusion *= 1 - 0.22 * smooth(1, depths[side] || 1, d);
    // Soot and wear low on the walls, broken by noise.
    occlusion *= 1 - 0.1 * (1 - smooth(0, 2.6, y - floorY)) * (0.6 + 0.4 * noise3(x * 0.8, y * 0.6, z * 0.8, 77));
    // The oculus as a broad disc of sky above.
    const ox = oculus[0] - x, oy = oculus[1] - y, oz = oculus[2] - z, od = Math.hypot(ox, oy, oz) || 1;
    const facing = Math.max(0, (nx * ox + ny * oy + nz * oz) / od);
    const skyLight = (0.3 + 0.7 * facing) * visible / (1 + (od / 15) ** 2);
    // Bounce from the sunlit pool: a warm upward-facing source on the monument.
    const bx = bounce.position[0] - x, by = bounce.position[1] - y, bz = bounce.position[2] - z, bd = Math.hypot(bx, by, bz) || 1;
    const bounceTerm = bounce.intensity * 0.18 * Math.max(0, (nx * bx + ny * by + nz * bz) / bd) * (0.35 + 0.65 * Math.max(0, -by / bd)) / (1 + (bd / 7) ** 2) * Math.min(1, visible * 1.1);
    let r = bounceColor[0] * bounceTerm, gg = bounceColor[1] * bounceTerm, b = bounceColor[2] * bounceTerm;
    // Baked practical lamps; a lamp in a bay lights its own bay and only a little of the chamber.
    for (let k = 0; k < baked.length; k++) {
      const lamp = baked[k];
      const lx = lamp.position[0] - x, ly = lamp.position[1] - y, lz = lamp.position[2] - z, ld = Math.hypot(lx, ly, lz) || 1;
      const range = lamp.range || 7;
      if (ld > range) continue;
      const lampSide = sideOf(g, lamp.position[0], lamp.position[2]);
      let through = 1;
      if (lampSide.d > g.arch.wallOuter) through = side === lampSide.side ? 1 : d < -g.arch.wallInner ? 0.3 : 0.04;
      const falloff = (1 - (ld / range) ** 2) ** 2 / (1 + ld * ld * 0.35);
      const wrap = Math.max(0, ((nx * lx + ny * ly + nz * lz) / ld + 0.25) / 1.25);
      const term = lamp.intensity * 0.55 * falloff * wrap * through;
      r += bakedColors[k][0] * term; gg += bakedColors[k][1] * term; b += bakedColors[k][2] * term;
    }
    if (options.platform === "desktop") {
      light[index * 3] = r; light[index * 3 + 1] = gg; light[index * 3 + 2] = b;
      ao[index] = occlusion * (0.3 + 0.7 * Math.min(1, skyLight * 1.6));
    } else {
      // Quest bakes everything: hemisphere fill, oculus sky, bounce, lamps and the key's dappled pool.
      const hemi = 0.5 + 0.5 * ny, fillTerm = fill.intensity * occlusion * (0.35 + 0.65 * Math.min(1, skyLight * 1.5));
      r += (ground[0] + (sky[0] - ground[0]) * hemi) * fillTerm + sky[0] * skyLight * 0.5;
      gg += (ground[1] + (sky[1] - ground[1]) * hemi) * fillTerm + sky[1] * skyLight * 0.5;
      b += (ground[2] + (sky[2] - ground[2]) * hemi) * fillTerm + sky[2] * skyLight * 0.5;
      const lambert = Math.max(0, -(nx * keyDir[0] + ny * keyDir[1] + nz * keyDir[2]));
      if (lambert > 0) {
        const pool = keyPoolAt(blueprint, x, y, z) * lambert * 1.25;
        r += keyColor[0] * pool; gg += keyColor[1] * pool; b += keyColor[2] * pool;
      }
      light[index * 3] = r * occlusion + 0.012; light[index * 3 + 1] = gg * occlusion + 0.01; light[index * 3 + 2] = b * occlusion + 0.009;
      ao[index] = occlusion;
      const ex = x - eye[0], ey = y - eye[1], ez = z - eye[2], distance = Math.hypot(ex, ey, ez);
      const height = 1 - 0.35 * smooth(4, 16, y);
      haze![index] = Math.min(0.75, 1 - Math.exp(-hazeVolume.density * distance * height));
    }
    if ((index + 1) % perSlice === 0) yield (index + 1) / count;
  }
  yield 1;
  return { light, ao, haze };
}

export function bakeVertices(blueprint: ArchiveBlueprint, g: FormGeometry, positions: Float32Array, normals: Float32Array, options: BakeOptions): BakedVertices {
  const slices = bakeVerticesSlices(blueprint, g, positions, normals, options, Infinity);
  let step = slices.next();
  while (!step.done) step = slices.next();
  return step.value;
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
