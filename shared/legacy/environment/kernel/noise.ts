// Deterministic lattice noise for vertex baking, scatter and texture generation.

import { hash01 } from "./prng";

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0, 1]. */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash01(ix, iy, 0, seed), b = hash01(ix + 1, iy, 0, seed);
  const c = hash01(ix, iy + 1, 0, seed), d = hash01(ix + 1, iy + 1, 0, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 3D value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (dx: number, dy: number, dz: number): number => hash01(ix + dx, iy + dy, iz + dz, seed);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * fx;
  const x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * fx;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * fx;
  const x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Fractal 2D noise in [0, 1]. */
export function fbm2(x: number, y: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, y * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Tileable 2D value noise over a period (texture generation). */
export function tileNoise2(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const m = (v: number): number => ((v % period) + period) % period;
  const a = hash01(m(ix), m(iy), 0, seed), b = hash01(m(ix + 1), m(iy), 0, seed);
  const c = hash01(m(ix), m(iy + 1), 0, seed), d = hash01(m(ix + 1), m(iy + 1), 0, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise in [0, 1]; `period` is the base lattice period (power of two works best). */
export function tileFbm(x: number, y: number, period: number, seed: number, octaves = 4, gain = 0.5): number {
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise2(x * f, y * f, period * f, seed + o * 977) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
