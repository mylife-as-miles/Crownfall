// Generates the archive's textures and its provenance manifest, deterministically,
// from seeded periodic noise and the shared oculus-screen function. Nothing is
// downloaded and nothing is drawn from third-party sources.
//
//   cd main-game-vr && npx tsx ../scripts/chronicles/textures/generate-archive-textures.ts          # write
//   cd main-game-vr && npx tsx ../scripts/chronicles/textures/generate-archive-textures.ts --check  # regenerate in memory, compare hashes
//
// Outputs: main game/public/assets/chronicles/textures/*.webp and
// main game/public/assets/chronicles/provenance.json (every file under
// assets/chronicles, the creator's map included).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE_BLUEPRINT } from "../../../shared/chronicles/archive/blueprint.ts";
import { keyCookieAt, oculusTransmission } from "../../../shared/chronicles/archive/kernel/bake.ts";
import { hash4 } from "../../../shared/chronicles/archive/kernel/noise.ts";
import { ARCHIVE_MATERIALS, ARCHIVE_TEXTURES, textureFile, type TextureDescriptor } from "../../../shared/chronicles/archive/materials.ts";
import { CHRONICLES_MAP } from "../../../shared/chronicles/content.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sharp = createRequire(join(root, "main-game-vr/package.json"))("sharp") as typeof import("sharp");
const ASSETS = join(root, "main game/public/assets/chronicles");
const OUT = join(ASSETS, "textures");
const GENERATOR = "scripts/chronicles/textures/generate-archive-textures.ts";
const COMMAND = "cd main-game-vr && npx tsx ../scripts/chronicles/textures/generate-archive-textures.ts";
const BASE = 1024;

// ---------------------------------------------------------------------------
// Periodic noise: every field tiles seamlessly across the texture. Lattice
// cells per axis are integers, so u = 1 meets u = 0 exactly; anisotropy comes
// from different cell counts per axis, never from scaling the coordinates.

const TAU = Math.PI * 2;
const GRAD = Array.from({ length: 16 }, (_, index) => [Math.cos((index * Math.PI) / 8), Math.sin((index * Math.PI) / 8)]);
function pnoise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const wx = (value: number) => ((value % periodX) + periodX) % periodX, wy = (value: number) => ((value % periodY) + periodY) % periodY;
  const corner = (cx: number, cy: number, dx: number, dy: number) => { const g = GRAD[hash4(wx(cx), wy(cy), seed) & 15]; return g[0] * dx + g[1] * dy; };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(fx), v = fade(fy);
  const a = corner(ix, iy, fx, fy), b = corner(ix + 1, iy, fx - 1, fy), c = corner(ix, iy + 1, fx, fy - 1), d = corner(ix + 1, iy + 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}
/** Fractal periodic noise on the unit square: `cellsU` by `cellsV` lattice cells, doubling per octave; roughly in [-1, 1]. */
function fbm(u: number, v: number, cellsU: number, cellsV: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0, amplitude = 1, total = 0, pu = cellsU, pv = cellsV;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * pnoise(u * pu, v * pv, pu, pv, seed + octave * 101);
    total += amplitude;
    amplitude *= gain;
    pu *= 2;
    pv *= 2;
  }
  return sum / total;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const unit = (h: number, shift = 0) => ((h >>> shift) & 1023) / 1023;
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = (hex: string): [number, number, number] => { const v = parseInt(hex.slice(1), 16); return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)]; };

/** A material's fields at one resolution: linear albedo, height in metres, roughness, ambient occlusion and metalness. */
interface Fields {
  size: number;
  albedo: Float32Array;
  height: Float32Array;
  rough: Float32Array;
  ao: Float32Array;
  metal: Float32Array;
}

function fields(size: number): Fields {
  const n = size * size;
  return { size, albedo: new Float32Array(n * 3), height: new Float32Array(n), rough: new Float32Array(n), ao: new Float32Array(n), metal: new Float32Array(n) };
}

/** Course layout for coursed ashlar: per row, block joints as fractions of the tile (tiling horizontally). */
function courses(rows: number, seed: number): number[][] {
  const out: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const joints: number[] = [];
    let at = unit(hash4(row, 3, seed)) * 0.3;
    const start = at;
    while (at < start + 1 - 0.18) {
      joints.push(at % 1);
      at += 0.22 + unit(hash4(row, joints.length, seed)) * 0.26;
    }
    out.push(joints.sort((a, b) => a - b));
  }
  return out;
}

/** Distance (in tile fractions) to the nearest joint in a sorted, wrapping list, and the block index. */
function nearestJoint(u: number, joints: number[]): { distance: number; block: number } {
  let best = 1, block = 0;
  for (let index = 0; index < joints.length; index++) {
    const d = Math.abs(u - joints[index]);
    const wrapped = Math.min(d, 1 - d);
    if (wrapped < best) best = wrapped;
    if (u >= joints[index]) block = index + 1;
  }
  return { distance: best, block: block % joints.length };
}

// ---------------------------------------------------------------------------
// Materials

function limestone(size: number): Fields {
  // Coursed ashlar, 2.4 m per tile: six courses of 0.4 m, blocks 0.5 to 1.2 m long.
  const f = fields(size), tile = 2.4, rows = 6, joint = 0.007 / tile, pillow = 0.035 / tile;
  const layout = courses(rows, 11);
  const grey = rgb("#bdb09a"), warm = rgb("#d8bd8c"), soot = rgb("#4b3f31"), mortar = rgb("#c7b79a");
  for (let y = 0; y < size; y++) {
    const v = y / size, rowF = v * rows, row = Math.floor(rowF), inRow = rowF - row;
    const rowJoint = Math.min(inRow, 1 - inRow) / rows;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const { distance, block } = nearestJoint(u, layout[row]);
      const edge = Math.min(distance, rowJoint);
      const id = hash4(row, block, 5);
      const tone = (unit(id) - 0.5) * 0.18, hue = unit(id, 10), lean = (id >>> 20) & 1 ? 1 : -1;
      // Faint bedding layers through each block, and claw tooling in diagonal strokes that lean per block.
      const bedding = (0.5 + 0.5 * Math.sin(TAU * (v * rows * 7 + fbm(u, v, 6, 6, 2, 27) * 1.2 + hue * 3))) * smooth(-0.2, 0.4, fbm(u, v, 5, 5, 2, 28));
      const tooling = Math.sin(TAU * (u * 256 + lean * v * 256 + fbm(u, v, 24, 24, 2, 23) * 1.5)) * 0.00025 + fbm(u, v, 48, 48, 3, 21) * 0.0009;
      const chip = Math.max(0, fbm(u, v, 40, 40, 3, 25) - 0.3) * smooth(pillow * 1.8, 0, edge) * 0.007;
      const fleck = smooth(0.45, 0.75, fbm(u, v, 192, 192, 1, 29));
      const pit = smooth(0.5, 0.8, fbm(u, v, 256, 256, 1, 39));
      const inJoint = edge < joint / 2;
      const h = inJoint ? -0.006 : -smooth(pillow, 0, edge) * 0.004 + tooling - chip - pit * 0.0008;
      // Soot and dust: broad clouds, and streaks that run down the wall.
      const stain = Math.max(0, fbm(u, v, 3, 3, 4, 31)) * 0.55 + Math.max(0, fbm(u, v, 2, 6, 3, 33) - 0.1) * 0.5;
      const streak = Math.max(0, fbm(u, v, 12, 2, 3, 35) - 0.2) * 0.6;
      const t = Math.max(0, Math.min(1, stain * 0.55 + streak * 0.45));
      const mottle = fbm(u, v, 10, 10, 3, 34) * 0.06;
      for (let k = 0; k < 3; k++) {
        let c = mix(grey[k], warm[k], 0.35 + hue * 0.55) * (1 + tone + mottle) * (1 - bedding * 0.022) * (1 + fleck * 0.06) * (1 - pit * 0.25);
        c = mix(c, soot[k], t * 0.42);
        if (inJoint) c = mix(c, mortar[k] * 0.86, 0.75);
        c *= 1 - chip * 35;
        f.albedo[i * 3 + k] = c;
      }
      f.height[i] = h;
      f.rough[i] = inJoint ? 0.95 : 0.84 + fbm(u, v, 16, 16, 2, 37) * 0.05 - t * 0.05 + pit * 0.05;
      f.ao[i] = inJoint ? 0.6 : (1 - smooth(pillow * 0.6, 0, edge) * 0.2) * (1 - pit * 0.2);
      f.metal[i] = 0;
    }
  }
  return f;
}

function limestoneDressed(size: number): Fields {
  // Finely dressed stone for mouldings and ribs: no joints, a fine drag of the comb, a light grain.
  const f = fields(size), base = rgb("#cfbb96"), cool = rgb("#c2b49c"), soot = rgb("#625240");
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const grain = fbm(u, v, 24, 24, 4, 41), fine = fbm(u, v, 96, 96, 2, 43);
      const drag = Math.sin(TAU * (u * 384 + v * 128 + fbm(u, v, 16, 16, 2, 47) * 1.2)) * 0.5 + 0.5;
      const cloud = fbm(u, v, 4, 4, 3, 49);
      const stain = Math.max(0, fbm(u, v, 3, 3, 4, 45) + 0.1) * 0.5;
      const pit = smooth(0.55, 0.8, fbm(u, v, 160, 160, 1, 48));
      for (let k = 0; k < 3; k++) f.albedo[i * 3 + k] = mix(mix(base[k], cool[k], 0.5 + cloud * 0.6) * (1 + grain * 0.05) * (1 - pit * 0.2), soot[k], stain * 0.32);
      f.height[i] = grain * 0.001 + fine * 0.0003 + drag * 0.00012 - pit * 0.0005;
      f.rough[i] = 0.76 + fine * 0.05 + pit * 0.06;
      f.ao[i] = (1 - Math.max(0, -grain) * 0.15) * (1 - pit * 0.18);
      f.metal[i] = 0;
    }
  }
  return f;
}

function limestoneCarved(size: number): Fields {
  // One square panel per tile: a framed field holding an abstract astronomical rosette (no text, no emblems).
  const f = fields(size), base = rgb("#d2bf9c"), recess = rgb("#86735a");
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const cx = u - 0.5, cy = v - 0.5, r = Math.hypot(cx, cy), a = Math.atan2(cy, cx);
      const border = Math.min(u, 1 - u, v, 1 - v);
      let h = 0;
      // Bead frame around the panel, then a sunk margin.
      h += border < 0.035 ? 0.004 * Math.sin((border / 0.035) * Math.PI) : 0;
      h -= border >= 0.035 && border < 0.05 ? 0.004 : 0;
      // Concentric bands.
      for (const [radius, width, depth] of [[0.43, 0.012, 0.004], [0.36, 0.008, -0.003], [0.24, 0.01, 0.0035], [0.11, 0.009, 0.003]] as const) {
        h += depth * smooth(width, 0, Math.abs(r - radius));
      }
      // Graduations between two bands.
      if (r > 0.37 && r < 0.42) h += 0.0025 * smooth(0.18, 0.08, Math.abs(Math.sin(a * 36)));
      // An eight-pointed star in the centre.
      const star = 0.2 * (0.42 + 0.58 * Math.abs(Math.cos(a * 4)) ** 6);
      if (r < star) h += 0.0045 * smooth(star, star - 0.02, r) * (1 - (r / star) * 0.4);
      // Small four-pointed stars in the field's corners.
      for (const [sx, sy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]] as const) {
        const dx = u - sx, dy = v - sy, rr = Math.hypot(dx, dy), aa = Math.atan2(dy, dx);
        const s = 0.055 * (0.3 + 0.7 * Math.abs(Math.cos(aa * 2)) ** 8);
        if (rr < s) h += 0.003 * smooth(s, s - 0.01, rr);
      }
      const grain = fbm(u, v, 32, 32, 3, 51) * 0.0006;
      h += grain;
      const deep = Math.max(0, -h) / 0.004, raised = Math.max(0, h) / 0.005;
      const wear = Math.max(0, fbm(u, v, 4, 4, 3, 53)) * 0.4;
      const cloud = fbm(u, v, 5, 5, 3, 55);
      for (let k = 0; k < 3; k++) f.albedo[i * 3 + k] = mix(mix(base[k] * (1 + cloud * 0.04), recess[k], Math.min(1, deep * 0.55 + (1 - raised) * 0.08)), recess[k], wear * 0.28);
      f.height[i] = h;
      f.rough[i] = 0.8 + deep * 0.1;
      f.ao[i] = 1 - Math.min(0.45, deep * 0.4 + (raised < 0.1 ? 0.05 : 0));
      f.metal[i] = 0;
    }
  }
  return f;
}

function floorStone(size: number): Fields {
  // Dark polished slabs, 0.8 m square, with thin pale veins and polish worn by feet.
  const f = fields(size), slabs = 4, joint = 0.0025 / 3.2;
  const dark = rgb("#2e2a26"), warm = rgb("#4b4137"), vein = rgb("#9a8f7a");
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const su = u * slabs, sv = v * slabs, slab = hash4(Math.floor(su) % slabs, Math.floor(sv) % slabs, 61);
      const edge = Math.min(su - Math.floor(su), Math.ceil(su) - su, sv - Math.floor(sv), Math.ceil(sv) - sv) / slabs;
      const inJoint = edge < joint;
      const tone = (unit(slab) - 0.5) * 0.22, hue = unit(slab, 10);
      const wu = fbm(u, v, 4, 4, 3, 62) * 0.06, wv = fbm(u, v, 4, 4, 3, 64) * 0.06;
      const ridge = 1 - Math.abs(fbm(u + wu, v + wv, 3, 5, 3, 63));
      const ridgeFine = 1 - Math.abs(fbm(u - wv, v + wu, 7, 4, 3, 66));
      const veinMask = Math.min(1, smooth(0.978, 0.996, ridge) + smooth(0.988, 0.998, ridgeFine) * 0.5) * (0.35 + 0.65 * smooth(-0.35, 0.35, fbm(u, v, 5, 5, 3, 65)));
      const cloud = fbm(u, v, 8, 8, 4, 67);
      const scuff = Math.max(0, fbm(u, v, 20, 20, 3, 69) - 0.15);
      for (let k = 0; k < 3; k++) {
        let c = mix(dark[k], warm[k], Math.max(0, Math.min(1, 0.25 + hue * 0.35 + cloud * 0.35))) * (1 + tone);
        c = mix(c, vein[k], veinMask * 0.32);
        if (inJoint) c *= 0.5;
        f.albedo[i * 3 + k] = c;
      }
      f.height[i] = inJoint ? -0.0025 : cloud * 0.0003 - veinMask * 0.00015;
      f.rough[i] = inJoint ? 0.85 : 0.22 + scuff * 0.38 + veinMask * 0.06;
      f.ao[i] = inJoint ? 0.68 : 1;
      f.metal[i] = 0;
    }
  }
  return f;
}

function basalt(size: number): Fields {
  // Fine dark basalt dressed with a point chisel: patches of parallel strokes, a few pale crystals and pits.
  const f = fields(size), base = rgb("#353331"), light = rgb("#5a554f"), crystal = rgb("#8a857c"), patches = 6;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const patch = hash4(Math.floor(u * patches), Math.floor(v * patches), 79), angle = unit(patch) * Math.PI;
      const along = u * Math.cos(angle) + v * Math.sin(angle);
      const stroke = Math.sin(TAU * (along * 150 + fbm(u, v, 10, 10, 2, 75) * 1.5)) * 0.5 + 0.5;
      const grain = fbm(u, v, 64, 64, 3, 71), cloud = fbm(u, v, 6, 6, 4, 73);
      const pit = smooth(0.58, 0.75, fbm(u, v, 80, 80, 2, 77));
      const speck = smooth(0.6, 0.78, fbm(u, v, 200, 200, 1, 78));
      for (let k = 0; k < 3; k++) f.albedo[i * 3 + k] = mix(mix(base[k], light[k], 0.3 + cloud * 0.35 + grain * 0.15) * (1 - pit * 0.4) * (1 - stroke * 0.04), crystal[k], speck * 0.35);
      f.height[i] = grain * 0.0005 + stroke * 0.0006 - pit * 0.0015;
      f.rough[i] = 0.68 + grain * 0.06 + pit * 0.1 - speck * 0.1;
      f.ao[i] = 1 - pit * 0.35;
      f.metal[i] = 0;
    }
  }
  return f;
}

function bronze(size: number): Fields {
  // Cast bronze: a fine cast skin with faint hammer dimples, bright where hands and cloths have worn it,
  // and patina gathered in a few crusted spots. The engraving is in the geometry, not the texture.
  const f = fields(size), metal = rgb("#b48b56"), dark = rgb("#7a5631"), patina = rgb("#5a8c78"), bright = rgb("#e4b874");
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const crust = smooth(0.15, 0.5, fbm(u, v, 3, 3, 4, 89));
      const spots = smooth(0.3, 0.6, fbm(u, v, 7, 7, 5, 81));
      const patinaShare = Math.min(1, spots * crust);
      const wear = smooth(0.15, 0.6, fbm(u, v, 9, 9, 3, 83));
      const cast = fbm(u, v, 64, 64, 2, 85);
      const dimple = Math.max(0, fbm(u, v, 24, 24, 1, 84)) ** 2;
      for (let k = 0; k < 3; k++) {
        let c = mix(metal[k], dark[k], 0.25 + fbm(u, v, 12, 12, 3, 86) * 0.25 + dimple * 0.3);
        c = mix(c, bright[k], wear * 0.35);
        f.albedo[i * 3 + k] = mix(c, patina[k], patinaShare * 0.9);
      }
      f.height[i] = cast * 0.00012 - dimple * 0.0004 + patinaShare * 0.0002;
      f.rough[i] = mix(0.3, 0.78, patinaShare) - wear * 0.08 + cast * 0.03 + dimple * 0.06;
      f.ao[i] = 1 - dimple * 0.15 - patinaShare * 0.1;
      f.metal[i] = mix(0.95, 0.2, patinaShare);
    }
  }
  return f;
}

const MATERIAL_FIELDS: Record<string, { make: (size: number) => Fields; tile: number }> = {
  limestone: { make: limestone, tile: 2.4 },
  "limestone-dressed": { make: limestoneDressed, tile: 1.2 },
  "limestone-carved": { make: limestoneCarved, tile: 1.2 },
  "floor-stone": { make: floorStone, tile: 3.2 },
  basalt: { make: basalt, tile: 1.6 },
  bronze: { make: bronze, tile: 0.8 },
};

/** A 2x box-filtered copy, so every size derives from the same base fields. */
function halve(source: Fields): Fields {
  const size = source.size / 2, out = fields(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, s = [(2 * y) * source.size + 2 * x, (2 * y) * source.size + 2 * x + 1, (2 * y + 1) * source.size + 2 * x, (2 * y + 1) * source.size + 2 * x + 1];
    for (let k = 0; k < 3; k++) out.albedo[i * 3 + k] = s.reduce((sum, j) => sum + source.albedo[j * 3 + k], 0) / 4;
    out.height[i] = s.reduce((sum, j) => sum + source.height[j], 0) / 4;
    out.rough[i] = s.reduce((sum, j) => sum + source.rough[j], 0) / 4;
    out.ao[i] = s.reduce((sum, j) => sum + source.ao[j], 0) / 4;
    out.metal[i] = s.reduce((sum, j) => sum + source.metal[j], 0) / 4;
  }
  return out;
}

/** Tangent-space normals from the height field (wrapping), at the material's metres per texel. */
function normals(f: Fields, tile: number): Float32Array {
  const size = f.size, out = new Float32Array(size * size * 3), texel = tile / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (xx: number, yy: number) => f.height[(((yy + size) % size) * size) + ((xx + size) % size)];
    const dx = (h(x + 1, y) - h(x - 1, y)) / (2 * texel), dy = (h(x, y + 1) - h(x, y - 1)) / (2 * texel);
    // Image rows run down while v runs up, so the y slope flips.
    let nx = -dx, ny = dy, nz = 1;
    const length = Math.hypot(nx, ny, nz);
    nx /= length; ny /= length; nz /= length;
    const i = (y * size + x) * 3;
    out[i] = nx; out[i + 1] = ny; out[i + 2] = nz;
  }
  return out;
}

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

function encodeAlbedo(f: Fields): Buffer {
  const out = Buffer.alloc(f.size * f.size * 3);
  for (let i = 0; i < f.size * f.size * 3; i++) out[i] = byte(linearToSrgb(Math.max(0, Math.min(1, f.albedo[i]))));
  return out;
}
function encodeNormal(n: Float32Array): Buffer {
  const out = Buffer.alloc(n.length);
  for (let i = 0; i < n.length; i++) out[i] = byte(n[i] * 0.5 + 0.5);
  return out;
}
function encodeOrm(f: Fields): Buffer {
  const out = Buffer.alloc(f.size * f.size * 3);
  for (let i = 0; i < f.size * f.size; i++) { out[i * 3] = byte(f.ao[i]); out[i * 3 + 1] = byte(f.rough[i]); out[i * 3 + 2] = byte(f.metal[i]); }
  return out;
}
/** Quest's baked lit albedo: the albedo under a soft light from above, with the cavity occlusion and a little sheen on metal. */
function encodeQuest(f: Fields, n: Float32Array): Buffer {
  const out = Buffer.alloc(f.size * f.size * 3), lx = 0, ly = 0.55, lz = 0.835;
  for (let i = 0; i < f.size * f.size; i++) {
    const diffuse = 0.62 + 0.38 * Math.max(0, n[i * 3] * lx + n[i * 3 + 1] * ly + n[i * 3 + 2] * lz);
    const sheen = f.metal[i] * (1 - f.rough[i]) * 0.35;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = byte(linearToSrgb(Math.min(1, f.albedo[i * 3 + k] * diffuse * f.ao[i] * (1 + f.metal[i] * 0.25) + sheen * f.albedo[i * 3 + k])));
  }
  return out;
}

async function webp(raw: Buffer, width: number, height: number, quality: number, lossless = false): Promise<Buffer> {
  return sharp(raw, { raw: { width, height, channels: 3 } }).webp(lossless ? { lossless: true, effort: 6 } : { quality, effort: 6, smartSubsample: true }).toBuffer();
}

// ---------------------------------------------------------------------------

async function generate(): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const [id, { make, tile }] of Object.entries(MATERIAL_FIELDS)) {
    const full = make(BASE), half = halve(full), quarter = halve(half);
    for (const [size, f] of [[1024, full], [512, half]] as const) {
      files.set(textureFile(`${id}-albedo`, size), await webp(encodeAlbedo(f), size, size, 86));
      files.set(textureFile(`${id}-normal`, size), await webp(encodeNormal(normals(f, tile)), size, size, 90));
      files.set(textureFile(`${id}-orm`, size), await webp(encodeOrm(f), size, size, 88));
    }
    for (const [size, f] of [[512, half], [256, quarter]] as const) files.set(textureFile(`${id}-quest`, size), await webp(encodeQuest(f, normals(f, tile)), size, size, 86));
    console.log(`  ${id}`);
  }
  // The key's cookie, rows from the top (v = 1) down.
  const cookieSize = 512, cookie = Buffer.alloc(cookieSize * cookieSize * 3);
  for (let y = 0; y < cookieSize; y++) for (let x = 0; x < cookieSize; x++) {
    const value = byte(keyCookieAt(ARCHIVE_BLUEPRINT, (x + 0.5) / cookieSize, 1 - (y + 0.5) / cookieSize));
    cookie.fill(value, (y * cookieSize + x) * 3, (y * cookieSize + x) * 3 + 3);
  }
  files.set(textureFile("oculus-cookie", 512), await webp(cookie, cookieSize, cookieSize, 0, true));
  // The screen's alpha in polar coordinates: u around from north toward east, v across the band from its inner edge.
  const oculus = ARCHIVE_BLUEPRINT.chamber.oculus, inner = oculus.radius * oculus.tracery.band[0], outer = oculus.radius * oculus.tracery.band[1] + 0.12;
  const mw = 1024, mh = 256, mask = Buffer.alloc(mw * mh * 3);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const a = ((x + 0.5) / mw) * Math.PI * 2, r = (inner + (outer - inner) * (1 - (y + 0.5) / mh)) / oculus.radius;
    const solid = r > 1 ? 1 : 1 - oculusTransmission(ARCHIVE_BLUEPRINT, Math.sin(a) * r, -Math.cos(a) * r, 0.004);
    mask.fill(byte(solid), (y * mw + x) * 3, (y * mw + x) * 3 + 3);
  }
  files.set(textureFile("tracery-mask", [mw, mh]), await webp(mask, mw, mh, 0, true));
  return files;
}

interface ProvenanceEntry {
  path: string;
  bytes: number;
  sha256: string;
  kind: string;
  source: string;
  generator: string | null;
  command: string | null;
  licence: string;
}

function describe(file: string): string {
  const texture = ARCHIVE_TEXTURES.find((item) => item.sizes.some((size) => textureFile(item.id, size) === file)) as TextureDescriptor | undefined;
  if (!texture) return "generated texture";
  const material = ARCHIVE_MATERIALS.find((item) => Object.values(item.textures).includes(texture.id));
  const what: Record<string, string> = { albedo: "albedo (sRGB)", normal: "tangent-space normal map", orm: "occlusion, roughness and metalness (R, G, B)", quest: "Quest baked lit albedo (sRGB)", mask: "light mask" };
  return `${what[texture.kind]}${material ? ` for ${material.id}: ${material.description}` : texture.id === "oculus-cookie" ? ": what the oculus screen passes from the key light" : ""}`;
}

function provenance(files: Map<string, Buffer>): { schema: 1; note: string; files: ProvenanceEntry[] } {
  const entries: ProvenanceEntry[] = [];
  const map = readFileSync(join(root, "main game/public", CHRONICLES_MAP.src));
  entries.push({
    path: CHRONICLES_MAP.src.replace("/assets/chronicles/", ""),
    bytes: map.length,
    sha256: createHash("sha256").update(map).digest("hex"),
    kind: "painting",
    source: "The creator's painted map of the four nations (2048 x 1529), supplied for Brief E and first delivered as assets/home/chronicles.webp. The central tower was removed by orchestrator inpainting (creator decision, 29 October 2026; working choice). Used unmodified as the relief's albedo; never redrawn.",
    generator: null,
    command: null,
    licence: "Creator-owned artwork for Crownfall",
  });
  for (const [file, buffer] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    entries.push({
      path: `textures/${file}`,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      kind: "texture",
      source: describe(file),
      generator: GENERATOR,
      command: COMMAND,
      licence: "Original work generated for Crownfall from seeded noise and the archive blueprint; no third-party sources",
    });
  }
  return {
    schema: 1,
    note: "Every file under main game/public/assets/chronicles. Textures are regenerated deterministically by the command shown; the Quest copies are mirrored by syncMenuAssets during the Quest build and are not committed.",
    files: entries,
  };
}

/** Every file under assets/chronicles, relative to it. */
function listAssets(directory = ASSETS): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...listAssets(path));
    else out.push(relative(ASSETS, path).split("\\").join("/"));
  }
  return out.sort();
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "Regenerating textures in memory..." : "Generating textures...");
  const files = await generate();
  const manifest = provenance(files);
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  if (check) {
    const problems: string[] = [];
    const committed = existsSync(join(ASSETS, "provenance.json")) ? readFileSync(join(ASSETS, "provenance.json"), "utf8") : "";
    if (committed !== manifestText) problems.push("provenance.json differs from a fresh generation");
    for (const [file, buffer] of files) {
      const path = join(OUT, file);
      if (!existsSync(path)) problems.push(`textures/${file} is missing`);
      else if (!readFileSync(path).equals(buffer)) problems.push(`textures/${file} differs from a fresh generation`);
    }
    const listed = new Set(manifest.files.map((entry) => entry.path));
    for (const file of listAssets()) if (file !== "provenance.json" && !listed.has(file)) problems.push(`${file} is not in provenance.json`);
    if (problems.length) {
      console.error(`FAIL archive textures:\n  ${problems.join("\n  ")}`);
      process.exitCode = 1;
      return;
    }
    const total = [...files.values()].reduce((sum, buffer) => sum + buffer.length, 0);
    console.log(`PASS archive textures: ${files.size} files reproduce their hashes (${(total / 1048576).toFixed(2)} MB), provenance lists ${manifest.files.length} files`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const [file, buffer] of files) writeFileSync(join(OUT, file), buffer);
  writeFileSync(join(ASSETS, "provenance.json"), manifestText);
  const total = [...files.values()].reduce((sum, buffer) => sum + buffer.length, 0);
  console.log(`Wrote ${files.size} textures (${(total / 1048576).toFixed(2)} MB) and provenance.json (${manifest.files.length} files)`);
}

await main();
