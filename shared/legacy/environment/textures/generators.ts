// Procedural texture generators (pure, deterministic, tileable): ashlar, rubble,
// slate, lead, shingle, thatch, timber, oak frame and plaster, plaster, cobbles,
// setts, flagstones, earth, grass, heath, basalt rock, cloth, bark, foliage, iron
// and black marble. Each works in metres over one tile and returns texture fields
// that finishTexture() turns into albedo, normal and ORM images.

import { hash01, Rng } from "../kernel/prng";
import { tileFbm, tileNoise2 } from "../kernel/noise";
import type { TextureSetRecipe } from "../materials/types";
import { createFields, eachTexel, mixRgb, rgb, scaleRgb, setTexel } from "./field";
import type { RGB, TextureFields } from "./field";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Tileable fbm at `perMetre` lattice cells per metre over a tile of `T` metres. */
function tf(u: number, v: number, T: number, perMetre: number, seed: number, oct = 4): number {
  const P = Math.max(1, Math.round(T * perMetre));
  return tileFbm(u * P, v * P, P, seed, oct);
}

/** Sparse hairline cracks: thin ridges of fbm iso-lines, masked to a few patches. */
function crackAt(u: number, v: number, T: number, perMetre: number, seed: number): number {
  const line = 1 - Math.abs(tf(u, v, T, perMetre, seed, 3) - 0.5) * 2;
  const mask = smooth(0.58, 0.72, tf(u, v, T, perMetre * 0.4, seed + 41, 3));
  return smooth(0.982, 0.997, line) * mask;
}

/** Tileable anisotropic fbm (different cell counts along u and v). */
function tfa(u: number, v: number, T: number, perMetreU: number, perMetreV: number, seed: number, oct = 3): number {
  const PU = Math.max(1, Math.round(T * perMetreU));
  const PV = Math.max(1, Math.round(T * perMetreV));
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += tileNoise2Aniso(u * PU * f, v * PV * f, PU * f, PV * f, seed + o * 977) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function tileNoise2Aniso(x: number, y: number, pu: number, pv: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const mu = (q: number): number => ((q % pu) + pu) % pu;
  const mv = (q: number): number => ((q % pv) + pv) % pv;
  const a = hash01(mu(ix), mv(iy), 0, seed), b = hash01(mu(ix + 1), mv(iy), 0, seed);
  const c = hash01(mu(ix), mv(iy + 1), 0, seed), d = hash01(mu(ix + 1), mv(iy + 1), 0, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

interface Voro {
  f1: number;
  f2: number;
  id: number;
  cx: number;
  cy: number;
}

/** Tileable jittered-grid Voronoi; distances in cell units scaled by (sx, sy) metres per cell. */
function voronoi(u: number, v: number, cu: number, cv: number, seed: number, jitter: number, sx: number, sy: number, out: Voro): Voro {
  const x = u * cu, y = v * cv;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = Infinity, f2 = Infinity, id = 0, bx = 0, by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = ix + ox, gy = iy + oy;
      const wx = ((gx % cu) + cu) % cu, wy = ((gy % cv) + cv) % cv;
      const px = gx + 0.5 + (hash01(wx, wy, 1, seed) - 0.5) * jitter;
      const py = gy + 0.5 + (hash01(wx, wy, 2, seed) - 0.5) * jitter;
      const dx = (px - x) * sx, dy = (py - y) * sy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash01(wx, wy, 3, seed);
        bx = px / cu;
        by = py / cv;
      } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1; out.f2 = f2; out.id = id; out.cx = bx; out.cy = by;
  return out;
}

/** Course layout: rows of given heights, each cut into blocks of random length (wrapping). */
interface Courses {
  rows: { y0: number; y1: number; cuts: number[] }[];
}

function courses(T: number, heights: readonly number[], minLen: number, maxLen: number, rng: Rng): Courses {
  const total = heights.reduce((a, b) => a + b, 0);
  const k = T / total;
  const rows: Courses["rows"] = [];
  let y = 0;
  for (const h of heights) {
    const off = rng.next() * T;
    const cuts: number[] = [];
    let x = 0;
    while (x < T - minLen * 0.5) {
      cuts.push((off + x) % T);
      x += minLen + rng.next() * (maxLen - minLen);
    }
    cuts.sort((a, b) => a - b);
    rows.push({ y0: y, y1: y + h * k, cuts });
    y += h * k;
  }
  return { rows };
}

/** Block containing (X, Y): edge distances and a stable block hash. */
function blockAt(c: Courses, T: number, X: number, Y: number): { dx: number; dy: number; id: number; row: number; ty: number } {
  let r = 0;
  while (r < c.rows.length - 1 && Y >= c.rows[r].y1) r++;
  const row = c.rows[r];
  const cuts = row.cuts;
  let j = cuts.length - 1;
  for (let i = 0; i < cuts.length; i++) {
    if (cuts[i] > X) {
      j = i - 1;
      break;
    }
  }
  const left = j >= 0 ? cuts[j] : cuts[cuts.length - 1] - T;
  const right = j + 1 < cuts.length ? cuts[j + 1] : cuts[0] + T;
  const bi = j >= 0 ? j : cuts.length - 1;
  return { dx: Math.min(X - left, right - X), dy: Math.min(Y - row.y0, row.y1 - Y), id: hash01(r, bi, 7, 99), row: r, ty: (Y - row.y0) / (row.y1 - row.y0) };
}

type Gen = (size: number, r: TextureSetRecipe) => TextureFields;

const ashlar: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const stone = rgb(p.stone), stone2 = rgb(p.stone2), mortar = rgb(p.mortar), stain = rgb(p.stain);
  const f = createFields(size, 5, 3);
  const c = courses(T, [0.42, 0.36, 0.44, 0.38, 0.4, 0.4], 0.5, 1.15, new Rng(r.seed));
  eachTexel(size, (i, u, v) => {
    const X = u * T, Y = v * T;
    const b = blockAt(c, T, X, Y);
    const d = Math.min(b.dx, b.dy);
    const m = 0.011;
    const chisel = tf(u, v, T, 22, r.seed + 1, 3);
    const mottle = tf(u, v, T, 2.5, r.seed + 2, 4);
    const streak = tfa(u, v, T, 9, 0.7, r.seed + 3, 3);
    if (d < m) {
      const n = tf(u, v, T, 40, r.seed + 4, 2);
      setTexel(f, i, scaleRgb(mortar, 0.82 + 0.25 * n), 0.08 + 0.06 * n, 0.95);
      return;
    }
    const bevel = smooth(m, m + 0.035, d);
    const wear = (1 - smooth(m, m + 0.05, d)) * 0.06;
    const h = 0.35 + 0.45 * Math.sqrt(bevel) + (chisel - 0.5) * 0.12 + (b.id - 0.5) * 0.08;
    let col = mixRgb(stone, stone2, hash01(b.row, Math.floor(b.id * 997), 1, r.seed));
    col = scaleRgb(col, 0.86 + 0.26 * b.id + (mottle - 0.5) * 0.22 + (chisel - 0.5) * 0.1 + wear);
    // Streaks of weathering run down from the course joints.
    const st = clamp01((streak - 0.55) * 2.2) * (0.35 + 0.65 * (1 - b.ty));
    col = mixRgb(col, stain, st * 0.45);
    setTexel(f, i, col, h, clamp01(0.74 + (chisel - 0.5) * 0.18 + st * 0.08 - wear));
  });
  return f;
};

const rubble: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const stone = rgb(p.stone), stone2 = rgb(p.stone2), mortar = rgb(p.mortar), stain = rgb(p.stain);
  const f = createFields(size, 6, 3.5);
  const cu = Math.max(2, Math.round(T / 0.34)), cv = Math.max(2, Math.round(T / 0.24));
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cv, r.seed, 0.85, T / cu, T / cv, vo);
    const edge = vo.f2 - vo.f1;
    const n = tf(u, v, T, 18, r.seed + 1, 3);
    const mottle = tf(u, v, T, 3, r.seed + 2, 3);
    if (edge < 0.022 + n * 0.012) {
      setTexel(f, i, scaleRgb(mortar, 0.75 + 0.3 * n), 0.06 + 0.05 * n, 0.96);
      return;
    }
    const dome = Math.sqrt(smooth(0.02, 0.11, edge));
    let col = mixRgb(stone, stone2, vo.id);
    col = scaleRgb(col, 0.78 + 0.38 * hash01(Math.floor(vo.id * 9973), 0, 0, r.seed) + (mottle - 0.5) * 0.2 + (n - 0.5) * 0.12);
    const st = clamp01((tfa(u, v, T, 8, 0.6, r.seed + 3) - 0.6) * 2.5);
    col = mixRgb(col, stain, st * 0.4);
    setTexel(f, i, col, 0.25 + 0.6 * dome + (n - 0.5) * 0.1, clamp01(0.8 + (n - 0.5) * 0.15));
  });
  return f;
};

const slate: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const s1 = rgb(p.slate), s2 = rgb(p.slate2), edge = rgb(p.edge), moss = rgb(p.moss);
  const f = createFields(size, 7, 3);
  const heights = new Array(10).fill(1);
  const c = courses(T, heights, 0.22, 0.34, new Rng(r.seed));
  eachTexel(size, (i, u, v) => {
    const X = u * T, Y = v * T;
    const b = blockAt(c, T, X, Y);
    const n = tf(u, v, T, 30, r.seed + 1, 2);
    const grain = tfa(u, v, T, 4, 26, r.seed + 2, 3);
    const mossMask = clamp01((tf(u, v, T, 1.5, r.seed + 3, 4) - 0.6) * 4) * clamp01((tf(u, v, T, 14, r.seed + 4, 3) - 0.35) * 3);
    // Sawtooth: each slate is thickest at its lower edge, tucking under the course above.
    let h = 0.25 + 0.55 * (1 - b.ty) + (grain - 0.5) * 0.08;
    let col = mixRgb(s1, s2, b.id);
    col = scaleRgb(col, 0.82 + 0.32 * hash01(b.row, Math.floor(b.id * 991), 5, r.seed) + (n - 0.5) * 0.08 + (grain - 0.5) * 0.12);
    // Lower edge catches light; the gap above the lower course is dark.
    if (b.ty < 0.06) col = scaleRgb(col, 1.12);
    if (b.dx < 0.006) {
      h = 0.05;
      col = edge;
    }
    if (b.ty > 0.97) {
      h = 0.02;
      col = scaleRgb(edge, 0.7);
    }
    col = mixRgb(col, moss, mossMask * 0.85);
    setTexel(f, i, col, h + mossMask * 0.08, clamp01(0.5 + 0.22 * b.id + mossMask * 0.35 + (n - 0.5) * 0.1));
  });
  return f;
};

const lead: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const lead = rgb(p.lead), patina = rgb(p.patina), dark = rgb(p.dark);
  const f = createFields(size, 5, 2);
  f.metal = new Float32Array(size * size);
  const seams = 5;
  eachTexel(size, (i, u, v) => {
    const X = u * T, Y = v * T;
    const sp = T / seams;
    const ds = Math.abs(((X % sp) + sp) % sp - sp / 2);
    const roll = Math.sqrt(clamp01(1 - (ds / 0.035) ** 2));
    const lap = ((Y % (T / 2)) + T / 2) % (T / 2);
    const step = lap < 0.02 ? 0.85 : 1;
    const wave = tf(u, v, T, 3, r.seed + 1, 3);
    const pat = clamp01((tf(u, v, T, 2, r.seed + 2, 4) - 0.45) * 2.2);
    const streak = clamp01((tfa(u, v, T, 12, 0.8, r.seed + 3, 3) - 0.5) * 2.5);
    let col = mixRgb(lead, patina, pat * 0.7);
    col = mixRgb(col, dark, streak * 0.35);
    col = scaleRgb(col, (0.9 + wave * 0.15) * (roll > 0 ? 1.05 : 1) * step);
    const h = 0.4 + roll * 0.5 + (wave - 0.5) * 0.06 - (lap < 0.02 ? 0.2 : 0);
    setTexel(f, i, col, h, clamp01(0.42 + pat * 0.3 + streak * 0.1));
    (f.metal as Float32Array)[i] = 0.75 - pat * 0.55;
  });
  return f;
};

const shingle: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const w1 = rgb(p.wood), w2 = rgb(p.wood2), grey = rgb(p.grey), moss = rgb(p.moss);
  const f = createFields(size, 6, 3);
  const c = courses(T, new Array(12).fill(1), 0.09, 0.22, new Rng(r.seed));
  eachTexel(size, (i, u, v) => {
    const X = u * T, Y = v * T;
    const b = blockAt(c, T, X, Y);
    const grain = tfa(u, v, T, 60, 3, r.seed + 1, 3);
    const weather = tf(u, v, T, 1.2, r.seed + 2, 3);
    const mossMask = clamp01((tf(u, v, T, 1.4, r.seed + 3, 4) - 0.62) * 4);
    let h = 0.3 + 0.5 * (1 - b.ty) + (grain - 0.5) * 0.15;
    let col = mixRgb(w1, w2, b.id);
    col = mixRgb(col, grey, clamp01(weather * 1.2 - 0.2) * 0.6);
    col = scaleRgb(col, 0.8 + 0.3 * hash01(b.row, Math.floor(b.id * 991), 6, r.seed) + (grain - 0.5) * 0.25);
    if (b.dx < 0.008) {
      h = 0.05;
      col = scaleRgb(col, 0.35);
    }
    if (b.ty > 0.96) {
      h = 0.02;
      col = scaleRgb(col, 0.4);
    }
    col = mixRgb(col, moss, mossMask * 0.8);
    setTexel(f, i, col, h, clamp01(0.78 + mossMask * 0.15 + (grain - 0.5) * 0.1));
  });
  return f;
};

const thatch: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const straw = rgb(p.straw), dark = rgb(p.dark), moss = rgb(p.moss);
  const f = createFields(size, 6, 4);
  eachTexel(size, (i, u, v) => {
    const Y = v * T;
    const fib = tfa(u, v, T, 90, 2.4, r.seed + 1, 3);
    const fib2 = tfa(u, v, T, 30, 1.2, r.seed + 2, 2);
    const course = ((Y % 0.3) + 0.3) % 0.3 / 0.3;
    const mossMask = clamp01((tf(u, v, T, 1.1, r.seed + 3, 4) - 0.55) * 3.5);
    const h = 0.25 + 0.35 * fib + 0.2 * fib2 + 0.2 * (1 - course);
    let col = mixRgb(dark, straw, clamp01(fib * 0.9 + fib2 * 0.4 - 0.2));
    col = scaleRgb(col, 0.75 + 0.35 * (1 - course * 0.6));
    col = mixRgb(col, moss, mossMask * 0.75);
    setTexel(f, i, col, h, 0.96);
  });
  return f;
};

const timber: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const w1 = rgb(p.wood), w2 = rgb(p.wood2), dark = rgb(p.dark);
  const f = createFields(size, 5, 3);
  const rng = new Rng(r.seed);
  const cuts: number[] = [];
  for (let x = 0; x < T - 0.1; x += 0.17 + rng.next() * 0.12) cuts.push(x);
  eachTexel(size, (i, u, v) => {
    const X = u * T;
    let j = cuts.length - 1;
    for (let k = 0; k < cuts.length; k++) if (cuts[k] > X) { j = k - 1; break; }
    const left = j >= 0 ? cuts[j] : cuts[cuts.length - 1] - T;
    const right = j + 1 < cuts.length ? cuts[j + 1] : cuts[0] + T;
    const plank = j >= 0 ? j : cuts.length - 1;
    const dx = Math.min(X - left, right - X);
    const warp = tf(u, v, T, 1.5, r.seed + 1, 3);
    const rings = Math.sin((X * 38 + warp * 9 + plank * 3.1) * Math.PI) * 0.5 + 0.5;
    const grain = tfa(u, v, T, 70, 2.5, r.seed + 2, 3);
    const pid = hash01(plank, 0, 0, r.seed);
    let col = mixRgb(w1, w2, pid * 0.7 + rings * 0.3);
    col = scaleRgb(col, 0.82 + 0.25 * grain + (pid - 0.5) * 0.15);
    let h = 0.5 + rings * 0.1 + (grain - 0.5) * 0.2;
    if (dx < 0.006) {
      col = dark;
      h = 0.1;
    }
    setTexel(f, i, col, h, clamp01(0.72 + (grain - 0.5) * 0.15));
  });
  return f;
};

const framePlaster: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const pl = rgb(p.plaster), pl2 = rgb(p.plaster2), oak = rgb(p.oak), oak2 = rgb(p.oak2), grime = rgb(p.grime);
  const f = createFields(size, 6, 3);
  const post = 0.17;
  const studs = 4;
  const sole = 0.2, head = T - 0.2, rail0 = 1.02, rail1 = 1.15;
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const vx = bx - ax, vy = by - ay;
    const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
    return Math.hypot(ax + vx * t - px, ay + vy * t - py);
  };
  eachTexel(size, (i, u, v) => {
    const X = u * T, Y = v * T;
    const sp = T / studs;
    const xi = Math.floor(X / sp);
    const lx = X - xi * sp;
    const dPost = Math.min(lx, sp - lx);
    let wood = false;
    let grainAlongY = true;
    if (dPost < post / 2) wood = true;
    if (Y < sole || Y > head || (Y > rail0 && Y < rail1)) {
      wood = true;
      grainAlongY = false;
    }
    // Braces in alternating lower panels and a mirrored pair above the rail.
    if (!wood) {
      const x0 = xi * sp + post / 2, x1 = (xi + 1) * sp - post / 2;
      if (xi % 2 === 0 && Y < rail0 && segDist(X, Y, x0, sole, x1, rail0) < 0.075) wood = true;
      if (xi % 4 === 1 && Y > rail1 && segDist(X, Y, x1, rail1, x0, head) < 0.065) wood = true;
    }
    const n = tf(u, v, T, 16, r.seed + 1, 3);
    if (wood) {
      const g = grainAlongY ? tfa(u, v, T, 60, 2, r.seed + 2, 3) : tfa(u, v, T, 2, 60, r.seed + 3, 3);
      let col = mixRgb(oak, oak2, g);
      col = scaleRgb(col, 0.85 + 0.25 * n);
      setTexel(f, i, col, 0.75 + (g - 0.5) * 0.15, clamp01(0.72 + (g - 0.5) * 0.1));
      return;
    }
    const blot = tf(u, v, T, 1.8, r.seed + 4, 4);
    const crack = crackAt(u, v, T, 4, r.seed + 5);
    let col = mixRgb(pl, pl2, clamp01(blot * 1.3 - 0.15));
    col = scaleRgb(col, 0.9 + n * 0.14);
    // Grime: rising damp at the sill and drip stains under each beam.
    const underBeam = Math.max(clamp01(1 - (head - Y) / 0.5), clamp01(1 - (rail0 - Y) / 0.45) * (Y < rail0 ? 1 : 0));
    const damp = clamp01(1 - (Y - sole) / 0.55);
    const st = clamp01((tfa(u, v, T, 10, 0.8, r.seed + 6) - 0.4) * 1.8);
    col = mixRgb(col, grime, clamp01(underBeam * st * 0.7 + damp * 0.45 + crack * 0.5));
    setTexel(f, i, col, 0.3 + (blot - 0.5) * 0.1 + (n - 0.5) * 0.05 - crack * 0.1, clamp01(0.88 + (n - 0.5) * 0.08));
  });
  return f;
};

const plaster: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const pl = rgb(p.plaster), pl2 = rgb(p.plaster2), grime = rgb(p.grime);
  const f = createFields(size, 3, 2);
  eachTexel(size, (i, u, v) => {
    const blot = tf(u, v, T, 1.2, r.seed + 1, 4);
    const n = tf(u, v, T, 20, r.seed + 2, 3);
    const crack = crackAt(u, v, T, 3, r.seed + 3);
    const st = clamp01((tfa(u, v, T, 7, 0.6, r.seed + 4) - 0.55) * 2);
    let col = mixRgb(pl, pl2, clamp01(blot * 1.4 - 0.2));
    col = scaleRgb(col, 0.9 + n * 0.12);
    col = mixRgb(col, grime, clamp01(st * 0.5 + crack * 0.6));
    setTexel(f, i, col, 0.4 + (blot - 0.5) * 0.15 + (n - 0.5) * 0.06 - crack * 0.15, 0.9);
  });
  return f;
};

const cobble: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const s1 = rgb(p.stone), s2 = rgb(p.stone2), dirt = rgb(p.dirt);
  const f = createFields(size, 8, 4);
  const cu = Math.max(4, Math.round(T / 0.14)), cv = cu;
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cv, r.seed, 0.8, T / cu, T / cv, vo);
    const edge = vo.f2 - vo.f1;
    const n = tf(u, v, T, 24, r.seed + 1, 2);
    if (edge < 0.016) {
      setTexel(f, i, scaleRgb(dirt, 0.8 + 0.4 * n), 0.05 + n * 0.05, 1);
      return;
    }
    const dome = Math.sqrt(smooth(0.014, 0.07, edge));
    let col = mixRgb(s1, s2, vo.id);
    col = scaleRgb(col, 0.75 + 0.4 * hash01(Math.floor(vo.id * 7919), 1, 0, r.seed) + dome * 0.12 + (n - 0.5) * 0.1);
    setTexel(f, i, col, 0.2 + 0.7 * dome, clamp01(0.75 - dome * 0.22 + (n - 0.5) * 0.1));
  });
  return f;
};

const setts: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const s1 = rgb(p.stone), s2 = rgb(p.stone2), dirt = rgb(p.dirt);
  const f = createFields(size, 7, 4);
  const c = courses(T, new Array(Math.round(T / 0.12)).fill(1), 0.16, 0.27, new Rng(r.seed));
  eachTexel(size, (i, u, v) => {
    const b = blockAt(c, T, u * T, v * T);
    const d = Math.min(b.dx, b.dy);
    const n = tf(u, v, T, 30, r.seed + 1, 2);
    if (d < 0.009) {
      setTexel(f, i, scaleRgb(dirt, 0.8 + 0.4 * n), 0.05, 1);
      return;
    }
    const top = Math.sqrt(smooth(0.008, 0.03, d));
    let col = mixRgb(s1, s2, b.id);
    col = scaleRgb(col, 0.8 + 0.35 * hash01(b.row, Math.floor(b.id * 991), 9, r.seed) + (n - 0.5) * 0.12 + top * 0.06);
    setTexel(f, i, col, 0.25 + 0.6 * top + (n - 0.5) * 0.06, clamp01(0.72 - top * 0.12));
  });
  return f;
};

const flagstone: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const s1 = rgb(p.stone), s2 = rgb(p.stone2), joint = rgb(p.joint);
  const f = createFields(size, 5, 3);
  const c = courses(T, [0.8, 0.7, 0.75, 0.75], 0.55, 1.25, new Rng(r.seed));
  eachTexel(size, (i, u, v) => {
    const b = blockAt(c, T, u * T, v * T);
    const d = Math.min(b.dx, b.dy);
    const n = tf(u, v, T, 12, r.seed + 1, 3);
    const crack = crackAt(u, v, T, 2.5, r.seed + Math.floor(b.id * 13));
    if (d < 0.012) {
      setTexel(f, i, scaleRgb(joint, 0.8 + 0.4 * n), 0.04, 1);
      return;
    }
    const top = smooth(0.01, 0.04, d);
    let col = mixRgb(s1, s2, b.id);
    col = scaleRgb(col, 0.82 + 0.28 * hash01(b.row, Math.floor(b.id * 997), 4, r.seed) + (n - 0.5) * 0.14);
    col = scaleRgb(col, 1 - crack * 0.4);
    setTexel(f, i, col, 0.3 + 0.5 * top + (b.id - 0.5) * 0.1 - crack * 0.15, clamp01(0.74 + (n - 0.5) * 0.12));
  });
  return f;
};

const earth: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const e1 = rgb(p.earth), e2 = rgb(p.earth2), peb = rgb(p.pebble);
  const f = createFields(size, 5, 3);
  const cu = Math.max(4, Math.round(T / 0.06));
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    const m = tf(u, v, T, 1.5, r.seed + 1, 4);
    const n = tf(u, v, T, 18, r.seed + 2, 3);
    voronoi(u, v, cu, cu, r.seed + 3, 0.9, T / cu, T / cu, vo);
    const pebble = vo.id > 0.82 && vo.f1 < 0.018 ? Math.sqrt(1 - vo.f1 / 0.018) : 0;
    let col = mixRgb(e1, e2, clamp01(m * 1.3 - 0.15));
    col = scaleRgb(col, 0.85 + n * 0.25);
    col = mixRgb(col, peb, pebble * 0.8);
    setTexel(f, i, col, 0.3 + m * 0.2 + n * 0.1 + pebble * 0.4, 0.95 - pebble * 0.15);
  });
  return f;
};

const grass: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const g1 = rgb(p.grass), g2 = rgb(p.grass2), dry = rgb(p.dry);
  const f = createFields(size, 4, 3);
  eachTexel(size, (i, u, v) => {
    const blades = tfa(u, v, T, 70, 22, r.seed + 1, 3);
    const blades2 = tfa(u, v, T, 25, 80, r.seed + 2, 2);
    const clump = tf(u, v, T, 2.2, r.seed + 3, 4);
    const dryMask = clamp01((tf(u, v, T, 0.8, r.seed + 4, 3) - 0.5) * 2.5);
    let col = mixRgb(g2, g1, clamp01(blades * 0.7 + blades2 * 0.5 - 0.1));
    col = mixRgb(col, dry, dryMask * 0.55 * blades2);
    col = scaleRgb(col, 0.78 + clump * 0.4);
    setTexel(f, i, col, 0.3 + blades * 0.4 + clump * 0.2, 0.92);
  });
  return f;
};

const heath: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const h1 = rgb(p.heath), h2 = rgb(p.heath2), green = rgb(p.green), dry = rgb(p.dry);
  const f = createFields(size, 5, 3.5);
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  const cu = Math.max(4, Math.round(T / 0.22));
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cu, r.seed, 0.9, T / cu, T / cu, vo);
    const tuft = Math.sqrt(clamp01(1 - vo.f1 / 0.16));
    const fleck = tf(u, v, T, 60, r.seed + 1, 2);
    const patch = tf(u, v, T, 1.4, r.seed + 2, 4);
    let col = mixRgb(h2, h1, tuft);
    col = mixRgb(col, green, clamp01((patch - 0.55) * 2.5) * 0.7);
    col = mixRgb(col, dry, clamp01((fleck - 0.72) * 4) * 0.6);
    col = scaleRgb(col, 0.75 + 0.35 * tuft + (vo.id - 0.5) * 0.2);
    setTexel(f, i, col, 0.2 + tuft * 0.6 + fleck * 0.1, 0.95);
  });
  return f;
};

const rock: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const r1 = rgb(p.rock), r2 = rgb(p.rock2), light = rgb(p.light), lichen = rgb(p.lichen);
  const f = createFields(size, 8, 4);
  const cu = Math.max(2, Math.round(T / 0.85)), cv = Math.max(1, Math.round(T / 2.6));
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cv, r.seed, 0.7, T / cu, T / cv, vo);
    const joint = vo.f2 - vo.f1;
    const n = tf(u, v, T, 6, r.seed + 1, 5);
    const fine = tf(u, v, T, 30, r.seed + 2, 2);
    const frac = smooth(0.012, 0.004, Math.abs(((v * T + n * 0.35) % 0.8 + 0.8) % 0.8 - 0.4)) * smooth(0.45, 0.6, tf(u, v, T, 1.5, r.seed + 9, 3));
    const lich = clamp01((tf(u, v, T, 2, r.seed + 3, 4) - 0.62) * 4) * clamp01((fine - 0.3) * 2);
    let col = mixRgb(r2, r1, clamp01(n * 1.2 - 0.1));
    col = mixRgb(col, light, clamp01((n - 0.7) * 3) * 0.5);
    col = scaleRgb(col, 0.8 + 0.3 * vo.id + (fine - 0.5) * 0.15);
    let h = 0.3 + 0.5 * smooth(0.0, 0.12, joint) + (n - 0.5) * 0.3 + (fine - 0.5) * 0.08;
    if (joint < 0.03) {
      col = scaleRgb(col, 0.45);
      h *= 0.4;
    }
    if (frac) {
      col = scaleRgb(col, 0.55);
      h -= 0.1;
    }
    col = mixRgb(col, lichen, lich * 0.7);
    setTexel(f, i, col, h, clamp01(0.82 + (fine - 0.5) * 0.12 + lich * 0.1));
  });
  return f;
};

const cloth: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const c1 = rgb(p.cloth), c2 = rgb(p.thread);
  const f = createFields(size, 3, 2);
  const threads = Math.round(T * 96);
  eachTexel(size, (i, u, v) => {
    const a = Math.sin(u * threads * Math.PI * 2), b = Math.sin(v * threads * Math.PI * 2);
    const over = (Math.floor(u * threads) + Math.floor(v * threads)) % 2 === 0;
    const w = over ? a * 0.5 + 0.5 : b * 0.5 + 0.5;
    const n = tf(u, v, T, 8, r.seed + 1, 3);
    const col = scaleRgb(mixRgb(c2, c1, w * 0.6 + 0.4), 0.9 + n * 0.15);
    setTexel(f, i, col, 0.4 + w * 0.3, 0.92);
  });
  return f;
};

const bark: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const b1 = rgb(p.bark), b2 = rgb(p.bark2), light = rgb(p.light);
  const f = createFields(size, 7, 4);
  eachTexel(size, (i, u, v) => {
    const fur = tfa(u, v, T, 14, 1.6, r.seed + 1, 4);
    const ridge = 1 - Math.abs(fur - 0.5) * 2;
    const n = tf(u, v, T, 20, r.seed + 2, 2);
    let col = mixRgb(b2, b1, ridge);
    col = mixRgb(col, light, clamp01((ridge - 0.8) * 4) * 0.4);
    col = scaleRgb(col, 0.85 + n * 0.25);
    setTexel(f, i, col, 0.2 + ridge * 0.7, 0.92);
  });
  return f;
};

const foliage: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const l1 = rgb(p.leaf), l2 = rgb(p.leaf2), light = rgb(p.light);
  const f = createFields(size, 5, 4);
  const cu = Math.max(4, Math.round(T / 0.07));
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cu, r.seed, 1, T / cu, T / cu, vo);
    const leaf = Math.sqrt(clamp01(1 - vo.f1 / 0.05));
    const clump = tf(u, v, T, 3, r.seed + 1, 3);
    let col = mixRgb(l2, l1, leaf * 0.8 + clump * 0.3);
    col = mixRgb(col, light, clamp01((vo.id - 0.82) * 5) * leaf * 0.6);
    col = scaleRgb(col, 0.7 + leaf * 0.4);
    setTexel(f, i, col, 0.2 + leaf * 0.6 + clump * 0.2, 0.85);
  });
  return f;
};

const iron: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const ir = rgb(p.iron), rust = rgb(p.rust), bright = rgb(p.bright);
  const f = createFields(size, 4, 2);
  f.metal = new Float32Array(size * size);
  const cu = Math.max(4, Math.round(T / 0.05));
  const vo: Voro = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  eachTexel(size, (i, u, v) => {
    voronoi(u, v, cu, cu, r.seed, 0.9, T / cu, T / cu, vo);
    const dimple = vo.f1 / 0.04;
    const rm = clamp01((tf(u, v, T, 3, r.seed + 1, 4) - 0.55) * 3);
    const n = tf(u, v, T, 25, r.seed + 2, 2);
    let col = mixRgb(ir, bright, clamp01(dimple * 0.4) * 0.5);
    col = mixRgb(col, rust, rm * 0.85);
    col = scaleRgb(col, 0.85 + n * 0.25);
    setTexel(f, i, col, 0.4 + clamp01(dimple) * 0.3 + rm * 0.15, clamp01(0.5 + rm * 0.4));
    (f.metal as Float32Array)[i] = 0.85 - rm * 0.7;
  });
  return f;
};

const blackMarble: Gen = (size, r) => {
  const T = r.tileMetres;
  const p = r.palette;
  const base = rgb(p.base), vein = rgb(p.vein), gold = rgb(p.gold);
  const f = createFields(size, 1.5, 1);
  eachTexel(size, (i, u, v) => {
    const w = tf(u, v, T, 1.2, r.seed + 1, 4);
    const w2 = tf(u + w * 0.15, v + w * 0.1, T, 2.4, r.seed + 2, 5);
    const vline = Math.abs(w2 - 0.5);
    const veinA = smooth(0.02, 0.0, vline);
    const fine = Math.abs(tf(u, v, T, 6, r.seed + 3, 4) - 0.5);
    const veinB = smooth(0.012, 0.0, fine) * 0.5;
    const goldA = smooth(0.006, 0.0, Math.abs(tf(u, v, T, 0.9, r.seed + 4, 4) - 0.5));
    let col = scaleRgb(base, 0.85 + w * 0.3);
    col = mixRgb(col, vein, clamp01(veinA * 0.8 + veinB));
    col = mixRgb(col, gold, goldA * 0.45 * smooth(0.55, 0.75, tf(u, v, T, 0.8, r.seed + 5, 3)));
    setTexel(f, i, col, 0.5 + (w - 0.5) * 0.05, clamp01(0.16 + veinA * 0.1 + goldA * 0.1));
  });
  return f;
};

export const GENERATORS: Readonly<Record<string, Gen>> = {
  ashlar,
  rubble,
  slate,
  lead,
  shingle,
  thatch,
  timber,
  "frame-plaster": framePlaster,
  plaster,
  cobble,
  setts,
  flagstone,
  earth,
  grass,
  heath,
  rock,
  cloth,
  bark,
  foliage,
  iron,
  "black-marble": blackMarble,
};

/** Generates one texture set's fields at a resolution. */
export function generateTextureFields(recipe: TextureSetRecipe, size: number): TextureFields {
  const gen = GENERATORS[recipe.generator];
  if (!gen) throw new Error(`no generator for ${recipe.generator}`);
  return gen(size, recipe);
}
