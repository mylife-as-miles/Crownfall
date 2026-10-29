// Seeded randomness for the archive kernel: a small integer hash, a seeded
// generator and gradient noise in two and three dimensions. Identical on every
// platform and run; nothing here reads the clock or Math.random.

/** A 32-bit integer hash of up to four integers. */
export function hash4(a: number, b = 0, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** A unit-interval value from a hash of up to four integers. */
export function hashUnit(a: number, b = 0, c = 0, d = 0): number {
  return hash4(a, b, c, d) / 4294967296;
}

/** A seeded generator (mulberry32): each call returns the next value in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRADIENTS_2D = Float64Array.from({ length: 32 }, (_, index) =>
  index % 2 ? Math.sin(((index >> 1) * Math.PI) / 8) : Math.cos(((index >> 1) * Math.PI) / 8));

function corner2(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const g = (hash4(ix, iy, seed) & 15) * 2;
  return dx * GRADIENTS_2D[g] + dy * GRADIENTS_2D[g + 1];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Seeded 2D gradient noise, roughly in [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const a = corner2(ix, iy, seed, fx, fy), b = corner2(ix + 1, iy, seed, fx - 1, fy);
  const c = corner2(ix, iy + 1, seed, fx, fy - 1), d = corner2(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}

const GRADIENTS_3D = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];

function corner3(ix: number, iy: number, iz: number, seed: number, dx: number, dy: number, dz: number): number {
  const g = (hash4(ix, iy, iz, seed) % 12) * 3;
  return dx * GRADIENTS_3D[g] + dy * GRADIENTS_3D[g + 1] + dz * GRADIENTS_3D[g + 2];
}

/** Seeded 3D gradient noise, roughly in [-1, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const c000 = corner3(ix, iy, iz, seed, fx, fy, fz), c100 = corner3(ix + 1, iy, iz, seed, fx - 1, fy, fz);
  const c010 = corner3(ix, iy + 1, iz, seed, fx, fy - 1, fz), c110 = corner3(ix + 1, iy + 1, iz, seed, fx - 1, fy - 1, fz);
  const c001 = corner3(ix, iy, iz + 1, seed, fx, fy, fz - 1), c101 = corner3(ix + 1, iy, iz + 1, seed, fx - 1, fy, fz - 1);
  const c011 = corner3(ix, iy + 1, iz + 1, seed, fx, fy - 1, fz - 1), c111 = corner3(ix + 1, iy + 1, iz + 1, seed, fx - 1, fy - 1, fz - 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u, x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 1.1;
}

/** Fractal sum of 2D noise with `octaves` layers, roughly in [-1, 1]. */
export function fbm2(x: number, y: number, seed: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
  let sum = 0, amplitude = 1, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * noise2(x, y, seed + octave * 17);
    total += amplitude;
    x = x * lacunarity + 11.7;
    y = y * lacunarity + 5.3;
    amplitude *= gain;
  }
  return sum / total;
}
