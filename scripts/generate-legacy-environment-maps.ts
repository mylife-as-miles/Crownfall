// Renders the Bannerhold maps and camera previews FROM THE BLUEPRINT DATA
// (shared/legacy/environment/blueprint), so they can never drift from what the renderers build.
// For every nation, into docs/legacy/environment/maps/:
//   <nation>-plan.svg/.png       annotated settlement plan: 10 m grid, scale bar, north arrow,
//                                districts, shaded roof plan with heights, roads and paths, walls,
//                                landmarks + pick radii, file markers, NPC routes, cameras + view
//                                cones, VR viewer, expansion zones, view corridors, story locations
//   <nation>-site.svg/.png       the whole modelled terrain: hillshade, contours, water, fields,
//                                roads, vegetation, cameras, VR detail/skirt, bearings outward
//   <nation>-elevation.svg/.png  hypsometric elevation plan with floor spot heights + two sections
//   <nation>-region.svg/.png     the greater nation on a logarithmic radial scale
//   <nation>-views.png           massing previews rendered from every authored camera and the
//                                seated VR eye point (software z-buffer, sun shadows, fog)
//   <nation>-schedule.md         building, landmark, camera and VR tables
//
// Run: cd main-game-vr && npx tsx ../scripts/generate-legacy-environment-maps.ts [--no-png] [--nation=korvenia]
// PNGs need Playwright's Chromium at /opt/pw-browsers/chromium (from "main game/node_modules");
// sharp (when installed) palette-compresses them. Previews are blueprint massing, not final art.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import {
  BANNERHOLD_BLUEPRINTS,
  DISTRICT_NAMES,
  PRODUCTION_DEFAULT_NATION,
  bearingVector,
  buildingTopY,
  createTerrainSampler,
  distanceToPolyline,
  massPolygon,
  pointInPolygon,
  polar,
  rectCorners,
  resolveBuildingBase,
  rotateLocal,
  shapePolygon,
  validateBlueprint,
  vectorBearing,
} from "../shared/legacy/environment/blueprint";
import type { BannerholdBlueprint, Building, BuildingMass, CameraFraming, TerrainSampler, Vec2, Vec3 } from "../shared/legacy/environment/blueprint";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/legacy/environment/maps");

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, no dependencies)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", new Uint8Array(0))]);
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

const FONT = "'Inter', 'DejaVu Sans', Arial, sans-serif";
const SERIF = "'DejaVu Serif', Georgia, serif";
const PAPER = "#f4efe4";
const INK = "#1d1b20";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function f1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

interface View {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  scale: number;
  ox: number;
  oy: number;
}

function makeView(minX: number, minZ: number, maxX: number, maxZ: number, pixelWidth: number, ox: number, oy: number): View {
  return { minX, minZ, maxX, maxZ, scale: pixelWidth / (maxX - minX), ox, oy };
}

const px = (v: View, x: number): number => v.ox + (x - v.minX) * v.scale;
const py = (v: View, z: number): number => v.oy + (z - v.minZ) * v.scale;
const pt = (v: View, p: Vec2): string => `${f1(px(v, p[0]))},${f1(py(v, p[1]))}`;
const viewW = (v: View): number => (v.maxX - v.minX) * v.scale;
const viewH = (v: View): number => (v.maxZ - v.minZ) * v.scale;
const inView = (v: View, p: Vec2, m = 0): boolean => p[0] > v.minX + m && p[0] < v.maxX - m && p[1] > v.minZ + m && p[1] < v.maxZ - m;

function polyPath(v: View, pts: readonly Vec2[], closed: boolean): string {
  if (pts.length === 0) return "";
  return `M${pts.map((p) => pt(v, p)).join("L")}${closed ? "Z" : ""}`;
}

interface TextOpts {
  fill?: string;
  anchor?: string;
  weight?: string;
  family?: string;
  halo?: boolean | string;
  rotate?: number;
  italic?: boolean;
  opacity?: number;
}

function text(x: number, y: number, s: string, size: number, opts: TextOpts = {}): string {
  const fill = opts.fill ?? INK;
  const haloColour = typeof opts.halo === "string" ? opts.halo : PAPER;
  const halo = opts.halo === false ? "" : ` paint-order="stroke" stroke="${haloColour}" stroke-width="${f1(Math.max(2, size * 0.3))}" stroke-linejoin="round"`;
  const rot = opts.rotate ? ` transform="rotate(${f1(opts.rotate)} ${f1(x)} ${f1(y)})"` : "";
  const style = opts.italic ? ` font-style="italic"` : "";
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : "";
  return `<text x="${f1(x)}" y="${f1(y)}" font-family="${opts.family ?? FONT}" font-size="${size}" fill="${fill}" text-anchor="${opts.anchor ?? "start"}" font-weight="${opts.weight ?? "normal"}"${style}${halo}${rot}${op}>${esc(s)}</text>`;
}

function clipRect(id: string, v: View): string {
  return `<clipPath id="${id}"><rect x="${f1(v.ox)}" y="${f1(v.oy)}" width="${f1(viewW(v))}" height="${f1(viewH(v))}"/></clipPath>`;
}

/** Deterministic PRNG for map symbols and preview scatter (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Colours: materials, surfaces, roles
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

/** sRGB albedo per material key (TECHNICAL_SPEC.md material library); unknown keys fall back by keyword. */
const MATERIAL_HEX: Record<string, string> = {
  "kv-basalt-ashlar": "#4b4850",
  "kv-basalt-rubble": "#5a5550",
  "kv-oak-frame-plaster": "#b8ad99",
  "kv-slate": "#3a3f48",
  "kv-lead": "#6f737a",
  "kv-shingle": "#685848",
  "kv-thatch-dark": "#6e5e3e",
  "kv-timber-raw": "#a28763",
};

const KEYWORD_HEX: readonly [string, string][] = [
  ["slate", "#3a3f48"], ["lead", "#6f737a"], ["thatch", "#76663f"], ["shingle", "#685848"], ["sod", "#5b6a3c"], ["turf", "#5b6a3c"],
  ["glaze", "#2f6f6a"], ["tile", "#9c5c3c"], ["copper", "#5f8a7a"], ["glass", "#6f828c"], ["steel", "#6b737b"], ["concrete", "#9a9893"],
  ["asphalt", "#48484a"], ["sandstone", "#c8a678"], ["adobe", "#b98c62"], ["limestone", "#c9c1ae"], ["plaster", "#cfc4ae"], ["frame", "#b8ad99"],
  ["log", "#6e5236"], ["timber", "#8a6a48"], ["wood", "#8a6a48"], ["megalith", "#7b7a72"], ["granite", "#7f7c76"], ["stone", "#8a857c"],
  ["ashlar", "#5a565c"], ["rubble", "#6a645e"], ["basalt", "#4b4850"], ["brick", "#8a4a3a"], ["iron", "#4a4e54"], ["canvas", "#cfc2a0"],
  ["cloth", "#b9a27c"], ["bone", "#d8d0bc"], ["neon", "#3fd0e0"], ["pipe", "#7b6a5a"], ["rust", "#8a4f32"], ["sulfur", "#d6c25a"],
];

function materialHex(key: string): string {
  const direct = MATERIAL_HEX[key];
  if (direct) return direct;
  for (const [kw, hex] of KEYWORD_HEX) if (key.indexOf(kw) >= 0) return hex;
  return "#8a8378";
}

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLinear(c: RGB): RGB {
  return [Math.pow(c[0] / 255, 2.2), Math.pow(c[1] / 255, 2.2), Math.pow(c[2] / 255, 2.2)];
}

function shadeHex(hex: string, k: number): string {
  const c = hexRgb(hex);
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

const SURFACE_HEX: Record<string, string> = {
  grass: "#9ba878", meadow: "#a7b07e", heath: "#8f8282", earth: "#a08b6c", mud: "#7d6f5c", rock: "#77736f", scree: "#8d8882", moss: "#6f7d55",
  "forest-floor": "#6c7254", sand: "#d2bc8a", dune: "#d9c08e", "sulfur-crust": "#cdbf82", "salt-flat": "#ddd7c6", gravel: "#a39f96", paving: "#a69f93",
  cobble: "#948c80", field: "#b9aa72", concrete: "#9d9c98", asphalt: "#56565a", slag: "#5e5753", snow: "#e8eaee",
};

const ROUTE_HEX: Record<string, string> = {
  cobble: "#9a8f80", setts: "#8c8072", flagstone: "#b3aa98", "packed-earth": "#b49d7c", gravel: "#b3ad9f", timber: "#8d6f4f", sand: "#d7c294",
  "sandstone-paving": "#d1b48a", "log-corduroy": "#7c5f40", turf: "#8fa070", asphalt: "#55555a", concrete: "#a4a4a0", "steel-grate": "#737a82", ballast: "#837d76",
};

const DISTRICT_COLOUR: Record<string, string> = { A: "#6f4f96", B: "#a8702e", C: "#4e7a5c", D: "#86602e", E: "#2f5f94", F: "#94374f", G: "#76766e" };
const ROLE_COLOUR: Record<string, string> = {
  sentry: "#b3261e", guard: "#b3261e", smith: "#d9661a", messenger: "#1f6fb2", drill: "#7b3fa0", resident: "#2e7d4f", herald: "#1f6fb2",
  carter: "#8a5a2b", farmer: "#6b8e23", worker: "#5a6a7a", "beast-handler": "#6d4c41", scribe: "#94374f", child: "#2f9a86", priest: "#555555",
};
const CONDITION_HEX: Record<string, string> = { new: "#2a2730", sound: "#2a2730", worn: "#4a4640", weathered: "#7a5532", damaged: "#b3261e", ruinous: "#b3261e", "under-construction": "#c07a1a" };

// ---------------------------------------------------------------------------
// Terrain rasters and contours
// ---------------------------------------------------------------------------

interface Grid {
  cols: number;
  rows: number;
  x0: number;
  z0: number;
  step: number;
  h: Float32Array;
}

function sampleGrid(T: TerrainSampler, v: View, step: number): Grid {
  const cols = Math.ceil((v.maxX - v.minX) / step) + 1;
  const rows = Math.ceil((v.maxZ - v.minZ) / step) + 1;
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = T.height(v.minX + c * step, v.minZ + r * step);
  return { cols, rows, x0: v.minX, z0: v.minZ, step, h };
}

function hypso(t: number): RGB {
  const stops: [number, RGB][] = [
    [0, [58, 96, 110]], [0.18, [96, 142, 120]], [0.38, [170, 186, 128]], [0.58, [214, 196, 132]], [0.78, [190, 140, 100]], [1, [236, 230, 224]],
  ];
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const u = (c - a[0]) / (b[0] - a[0]);
      return [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u, a[1][2] + (b[1][2] - a[1][2]) * u];
    }
  }
  return stops[stops.length - 1][1];
}

/** Hillshaded terrain image: "surface" tints by painted surface (and routes), "hypsometric" by elevation. Light from the north-west, the cartographic convention. */
function terrainImage(bp: BannerholdBlueprint, T: TerrainSampler, v: View, step: number, mode: "surface" | "hypsometric", range?: [number, number]): string {
  const g = sampleGrid(T, v, step);
  const rgba = new Uint8ClampedArray(g.cols * g.rows * 4);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < g.h.length; i++) {
    lo = Math.min(lo, g.h[i]);
    hi = Math.max(hi, g.h[i]);
  }
  if (range) [lo, hi] = range;
  const L = [-0.5, 0.7071, -0.5];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const surfaceRgb: Record<string, RGB> = {};
  for (const k of Object.keys(SURFACE_HEX)) surfaceRgb[k] = hexRgb(SURFACE_HEX[k]);
  const fieldRgb = hexRgb("#c2b27a");
  const fallowRgb = hexRgb("#b6a98c");
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      const hl = g.h[r * g.cols + Math.max(0, c - 1)];
      const hr = g.h[r * g.cols + Math.min(g.cols - 1, c + 1)];
      const hu = g.h[Math.max(0, r - 1) * g.cols + c];
      const hd = g.h[Math.min(g.rows - 1, r + 1) * g.cols + c];
      const nx = -(hr - hl) / (2 * step);
      const nz = -(hd - hu) / (2 * step);
      const nl = Math.hypot(nx, 1, nz);
      const shade = Math.max(0, (nx * L[0] + L[1] + nz * L[2]) / (nl * ll));
      const x = g.x0 + c * step;
      const z = g.z0 + r * step;
      let base: RGB;
      const wl = T.waterLevel(x, z);
      if (wl === wl && wl >= g.h[i] - 0.05) base = [118, 152, 172];
      else if (mode === "surface") {
        base = surfaceRgb[T.surface(x, z)] ?? [190, 186, 170];
        for (const f of bp.outer.fields) if (pointInPolygon([x, z], f.polygon)) base = f.condition === "fallow" ? fallowRgb : fieldRgb;
      } else base = hypso((g.h[i] - lo) / Math.max(1e-6, hi - lo));
      const k = 0.62 + 0.5 * shade;
      rgba[i * 4] = base[0] * k;
      rgba[i * 4 + 1] = base[1] * k;
      rgba[i * 4 + 2] = base[2] * k;
      rgba[i * 4 + 3] = 255;
    }
  }
  const png = encodePng(g.cols, g.rows, rgba).toString("base64");
  const w = (g.cols - 1) * step * v.scale;
  const h = (g.rows - 1) * step * v.scale;
  return `<image x="${f1(v.ox)}" y="${f1(v.oy)}" width="${f1(w)}" height="${f1(h)}" preserveAspectRatio="none" href="data:image/png;base64,${png}"/>`;
}

/** Contour polylines by marching squares, chained into continuous paths. */
function contourPaths(g: Grid, v: View, level: number): string {
  const segs: [number, number, number, number][] = [];
  const X = (c: number) => px(v, g.x0 + c * g.step);
  const Y = (r: number) => py(v, g.z0 + r * g.step);
  for (let r = 0; r < g.rows - 1; r++) {
    for (let c = 0; c < g.cols - 1; c++) {
      const a = g.h[r * g.cols + c];
      const b = g.h[r * g.cols + c + 1];
      const d = g.h[(r + 1) * g.cols + c];
      const e = g.h[(r + 1) * g.cols + c + 1];
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (e > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const lerp = (p: number, q: number) => (level - p) / (q - p);
      const top: [number, number] = [X(c + lerp(a, b)), Y(r)];
      const right: [number, number] = [X(c + 1), Y(r + lerp(b, e))];
      const bottom: [number, number] = [X(c + lerp(d, e)), Y(r + 1)];
      const left: [number, number] = [X(c), Y(r + lerp(a, d))];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 5: add(left, top); add(bottom, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 10: add(left, bottom); add(top, right); break;
      }
    }
  }
  const key = (x: number, y: number) => `${Math.round(x * 20)},${Math.round(y * 20)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain: [number, number][] = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (const forward of [true, false]) {
      for (;;) {
        const tail = forward ? chain[chain.length - 1] : chain[0];
        const cand = (ends.get(key(tail[0], tail[1])) ?? []).find((j) => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand];
        const next: [number, number] = key(s[0], s[1]) === key(tail[0], tail[1]) ? [s[2], s[3]] : [s[0], s[1]];
        if (forward) chain.push(next);
        else chain.unshift(next);
      }
    }
    out.push(`M${chain.map((p) => `${f1(p[0])},${f1(p[1])}`).join("L")}`);
  }
  return out.join("");
}

function contours(T: TerrainSampler, v: View, step: number, interval: number, indexEvery: number, colour: string, opacity = 1): string {
  const g = sampleGrid(T, v, step);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < g.h.length; i++) {
    lo = Math.min(lo, g.h[i]);
    hi = Math.max(hi, g.h[i]);
  }
  const parts: string[] = [];
  for (let lv = Math.ceil(lo / interval) * interval; lv <= hi; lv += interval) {
    const major = Math.abs(lv / (interval * indexEvery) - Math.round(lv / (interval * indexEvery))) < 1e-6;
    const d = contourPaths(g, v, lv + 1e-4);
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-opacity="${(major ? 0.7 : 0.3) * opacity}" stroke-width="${major ? 1.0 : 0.5}"/>`);
  }
  return `<g>${parts.join("")}</g>`;
}

// ---------------------------------------------------------------------------
// Massing preview renderer (software z-buffer, sun shadow map, fog). It shows
// the blueprint's volumes from the authored cameras so framings, silhouettes
// and layering can be judged without a GPU. Not final art.
// ---------------------------------------------------------------------------

type V3 = [number, number, number];

class Soup {
  pos: number[] = [];
  col: number[] = [];
  emit: number[] = [];
  /** 1 for triangles that may cast and receive sun shadow (the modelled site), 0 for far scenery. */
  local: number[] = [];
  tri(a: V3, b: V3, c: V3, col: RGB, emit = 0, local = 1): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(col[0], col[1], col[2]);
    this.emit.push(emit);
    this.local.push(local);
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, emit = 0, local = 1): void {
    this.tri(a, b, c, col, emit, local);
    this.tri(a, c, d, col, emit, local);
  }
  get count(): number {
    return this.emit.length;
  }
}

const lin = (hex: string): RGB => toLinear(hexRgb(hex));
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hash01(x: number, z: number): number {
  let h = Math.imul(Math.floor(x * 7.31) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(z * 5.17) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

interface RouteSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  col: RGB;
}

function routeSegments(bp: BannerholdBlueprint): RouteSeg[] {
  const out: RouteSeg[] = [];
  for (const r of bp.routes) {
    if (r.grade === "elevated") continue;
    const col = lin(ROUTE_HEX[r.surface] ?? "#a59d8e");
    for (let i = 1; i < r.points.length; i++) out.push({ ax: r.points[i - 1][0], az: r.points[i - 1][1], bx: r.points[i][0], bz: r.points[i][1], hw: r.width / 2, col });
  }
  return out;
}

function routeColourAt(segs: RouteSeg[], x: number, z: number): RGB | null {
  for (const s of segs) {
    const minX = Math.min(s.ax, s.bx) - s.hw;
    const maxX = Math.max(s.ax, s.bx) + s.hw;
    const minZ = Math.min(s.az, s.bz) - s.hw;
    const maxZ = Math.max(s.az, s.bz) + s.hw;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const abx = s.bx - s.ax;
    const abz = s.bz - s.az;
    const l2 = abx * abx + abz * abz;
    let t = l2 > 0 ? ((x - s.ax) * abx + (z - s.az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = s.ax + abx * t - x;
    const dz = s.az + abz * t - z;
    if (dx * dx + dz * dz <= s.hw * s.hw) return s.col;
  }
  return null;
}

/** Terrain mesh over the modelled extents (optionally clipped to a plan polygon), with surface, field, route and water colours. */
function addTerrain(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler, step: number, clip: Vec2[] | null): void {
  const e = bp.terrain.extents;
  const cols = Math.floor((e.maxX - e.minX) / step);
  const rows = Math.floor((e.maxZ - e.minZ) / step);
  const H = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) H[r * (cols + 1) + c] = T.height(e.minX + c * step, e.minZ + r * step);
  const segs = routeSegments(bp);
  const surf: Record<string, RGB> = {};
  for (const k of Object.keys(SURFACE_HEX)) surf[k] = lin(SURFACE_HEX[k]);
  const rock = lin(SURFACE_HEX.rock);
  const field = lin("#b5a46a");
  const fallow = lin("#a89b7c");
  const water = lin("#5d7f8e");
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = e.minX + c * step;
      const z0 = e.minZ + r * step;
      const cx = x0 + step / 2;
      const cz = z0 + step / 2;
      if (clip && !pointInPolygon([cx, cz], clip)) continue;
      const h00 = H[r * (cols + 1) + c];
      const h10 = H[r * (cols + 1) + c + 1];
      const h01 = H[(r + 1) * (cols + 1) + c];
      const h11 = H[(r + 1) * (cols + 1) + c + 1];
      const slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h10), Math.abs(h11 - h01)) / step;
      let col: RGB = surf[T.surface(cx, cz)] ?? surf.grass;
      for (const f of bp.outer.fields) if (pointInPolygon([cx, cz], f.polygon)) col = f.condition === "fallow" ? fallow : mul(field, 0.92 + 0.16 * (Math.floor((cx * Math.cos(f.furrowBearingDeg) + cz * Math.sin(f.furrowBearingDeg)) / 2) & 1));
      const rc = routeColourAt(segs, cx, cz);
      if (rc) col = rc;
      else if (slope > 0.85) col = mix3(col, rock, Math.min(1, (slope - 0.85) * 1.5));
      col = mul(col, 0.9 + 0.2 * hash01(cx, cz));
      soup.quad([x0, h00, z0], [x0, h01, z0 + step], [x0 + step, h11, z0 + step], [x0 + step, h10, z0], col);
      const wl = T.waterLevel(cx, cz);
      if (wl === wl && wl > Math.min(h00, h10, h01, h11) - 0.05) soup.quad([x0, wl, z0], [x0, wl, z0 + step], [x0 + step, wl, z0 + step], [x0 + step, wl, z0], water, 0.05);
    }
  }
}

/** World point of a local mass coordinate. */
function massWorld(m: BuildingMass, lx: number, y: number, lz: number): V3 {
  const r = rotateLocal(lx, lz, m.rotationDeg);
  return [m.center[0] + r[0], y, m.center[1] + r[1]];
}

function addPrismWalls(soup: Soup, outline: Vec2[], bottom: number, top: number, col: RGB, local = 1): void {
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    soup.quad([a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], col, 0, local);
  }
}

function addCap(soup: Soup, outline: Vec2[], y: number, col: RGB, local = 1): void {
  for (let i = 1; i < outline.length - 1; i++) soup.tri([outline[0][0], y, outline[0][1]], [outline[i][0], y, outline[i][1]], [outline[i + 1][0], y, outline[i + 1][1]], col, 0, local);
}

/** Walls, plinth and roof of one mass. */
function addMass(soup: Soup, b: Building, m: BuildingMass, floorY: number, groundMin: number): void {
  const elevated = (m.baseOffset ?? 0) >= 2.5;
  const base = floorY + (m.baseOffset ?? 0);
  const bottom = elevated ? base : groundMin - 0.3;
  const eave = base + m.eaveHeight;
  const ridge = base + m.ridgeHeight;
  const wall = lin(materialHex(m.wallMaterial));
  const roofCol = lin(materialHex(m.roof.material));
  const plinthCol = mul(wall, 0.72);
  const outline = massPolygon(m);
  const ruin = b.age.condition === "ruinous";
  const open = m.role === "scaffold" || m.role === "canopy";
  if (m.role === "scaffold") {
    // A few poles and two plank levels read as scaffold at preview scale.
    const hw = m.width / 2;
    const hd = m.depth / 2;
    const timber = lin("#9a7d58");
    for (let i = 0; i <= 4; i++) {
      const lz = -hd + (i * 2 * hd) / 4;
      for (const lx of [-hw + 0.1, hw - 0.1]) {
        const p = massWorld(m, lx, 0, lz);
        addPrismWalls(soup, [[p[0] - 0.08, p[2] - 0.08], [p[0] + 0.08, p[2] - 0.08], [p[0] + 0.08, p[2] + 0.08], [p[0] - 0.08, p[2] + 0.08]], groundMin, eave, timber);
      }
    }
    for (const y of [base + m.eaveHeight * 0.45, eave]) addCap(soup, outline, y, timber);
    return;
  }
  if (!open) {
    if (!elevated && floorY > bottom + 0.05) addPrismWalls(soup, outline, bottom, floorY, plinthCol);
    addPrismWalls(soup, outline, elevated ? base : floorY, eave, wall);
  } else {
    // Canopies stand on corner posts.
    const timber = lin("#7d6446");
    for (const p of outline) addPrismWalls(soup, [[p[0] - 0.1, p[1] - 0.1], [p[0] + 0.1, p[1] - 0.1], [p[0] + 0.1, p[1] + 0.1], [p[0] - 0.1, p[1] + 0.1]], floorY, eave, timber);
  }
  if (ruin || m.roof.form === "open-frame") {
    addCap(soup, outline, base + 0.05, lin("#5d5446"));
    return;
  }
  addRoof(soup, m, base, eave, ridge, roofCol, wall);
}

function addRoof(soup: Soup, m: BuildingMass, base: number, eave: number, ridge: number, roof: RGB, wall: RGB): void {
  const hw = m.width / 2;
  const hd = m.depth / 2;
  const W = (lx: number, y: number, lz: number) => massWorld(m, lx, y, lz);
  const plan = m.plan ?? "rect";
  const form = m.roof.form;
  if (plan !== "rect") {
    const ring = massPolygon(m);
    if (form === "conical" || form === "spire" || form === "pyramid") {
      const apex: V3 = [m.center[0], ridge, m.center[1]];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        soup.tri([a[0], eave, a[1]], [b[0], eave, b[1]], apex, roof);
      }
    } else if (form === "dome") {
      const rise = ridge - eave;
      const mid = ring.map((p): Vec2 => [m.center[0] + (p[0] - m.center[0]) * 0.72, m.center[1] + (p[1] - m.center[1]) * 0.72]);
      const ym = eave + rise * 0.7;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        soup.quad([ring[i][0], eave, ring[i][1]], [ring[j][0], eave, ring[j][1]], [mid[j][0], ym, mid[j][1]], [mid[i][0], ym, mid[i][1]], roof);
        soup.tri([mid[i][0], ym, mid[i][1]], [mid[j][0], ym, mid[j][1]], [m.center[0], ridge, m.center[1]], roof);
      }
    } else addCap(soup, ring, eave, roof);
    return;
  }
  const alongZ = m.roof.ridgeAxis === "z";
  // Local helper with axes swapped so "u" runs across the ridge and "v" along it.
  const P = (u: number, y: number, v: number) => (alongZ ? W(u, y, v) : W(v, y, u));
  const hu = alongZ ? hw : hd;
  const hv = alongZ ? hd : hw;
  switch (form) {
    case "gable":
    case "steep-gable":
    case "sod-gable":
    case "curved-ridge": {
      soup.quad(P(-hu, eave, -hv), P(-hu, eave, hv), P(0, ridge, hv), P(0, ridge, -hv), roof);
      soup.quad(P(hu, eave, -hv), P(0, ridge, -hv), P(0, ridge, hv), P(hu, eave, hv), roof);
      soup.tri(P(-hu, eave, -hv), P(0, ridge, -hv), P(hu, eave, -hv), wall);
      soup.tri(P(-hu, eave, hv), P(hu, eave, hv), P(0, ridge, hv), wall);
      return;
    }
    case "hip":
    case "half-hip": {
      const inset = Math.min(hv, form === "hip" ? hu : hu * 0.45);
      soup.quad(P(-hu, eave, -hv), P(-hu, eave, hv), P(0, ridge, hv - inset), P(0, ridge, -hv + inset), roof);
      soup.quad(P(hu, eave, -hv), P(0, ridge, -hv + inset), P(0, ridge, hv - inset), P(hu, eave, hv), roof);
      soup.tri(P(-hu, eave, -hv), P(0, ridge, -hv + inset), P(hu, eave, -hv), roof);
      soup.tri(P(-hu, eave, hv), P(hu, eave, hv), P(0, ridge, hv - inset), roof);
      return;
    }
    case "pyramid":
    case "spire":
    case "conical": {
      const apex = W(0, ridge, 0);
      const c = [W(-hw, eave, -hd), W(hw, eave, -hd), W(hw, eave, hd), W(-hw, eave, hd)];
      for (let i = 0; i < 4; i++) soup.tri(c[i], c[(i + 1) % 4], apex, roof);
      return;
    }
    case "lean-to": {
      // Rises toward local -Z (ridgeAxis "x") or local -X (ridgeAxis "z"); in (u, v) terms toward -u.
      soup.quad(P(-hu, ridge, -hv), P(-hu, ridge, hv), P(hu, eave, hv), P(hu, eave, -hv), roof);
      soup.quad(P(-hu, eave, -hv), P(-hu, eave, hv), P(-hu, ridge, hv), P(-hu, ridge, -hv), wall);
      soup.tri(P(-hu, eave, -hv), P(-hu, ridge, -hv), P(hu, eave, -hv), wall);
      soup.tri(P(-hu, eave, hv), P(hu, eave, hv), P(-hu, ridge, hv), wall);
      return;
    }
    case "barrel-vault": {
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const a0 = Math.PI * (i / segs);
        const a1 = Math.PI * ((i + 1) / segs);
        const u0 = -Math.cos(a0) * hu;
        const u1 = -Math.cos(a1) * hu;
        const y0 = eave + Math.sin(a0) * (ridge - eave);
        const y1 = eave + Math.sin(a1) * (ridge - eave);
        soup.quad(P(u0, y0, -hv), P(u0, y0, hv), P(u1, y1, hv), P(u1, y1, -hv), roof);
      }
      return;
    }
    case "dome": {
      const mid = 0.62;
      const ym = eave + (ridge - eave) * 0.72;
      soup.quad(W(-hw, eave, -hd), W(hw, eave, -hd), W(hw * mid, ym, -hd * mid), W(-hw * mid, ym, -hd * mid), roof);
      soup.quad(W(hw, eave, -hd), W(hw, eave, hd), W(hw * mid, ym, hd * mid), W(hw * mid, ym, -hd * mid), roof);
      soup.quad(W(hw, eave, hd), W(-hw, eave, hd), W(-hw * mid, ym, hd * mid), W(hw * mid, ym, hd * mid), roof);
      soup.quad(W(-hw, eave, hd), W(-hw, eave, -hd), W(-hw * mid, ym, -hd * mid), W(-hw * mid, ym, hd * mid), roof);
      soup.quad(W(-hw * mid, ym, -hd * mid), W(hw * mid, ym, -hd * mid), W(0, ridge, 0), W(0, ridge, 0), roof);
      soup.quad(W(hw * mid, ym, -hd * mid), W(hw * mid, ym, hd * mid), W(0, ridge, 0), W(0, ridge, 0), roof);
      soup.quad(W(hw * mid, ym, hd * mid), W(-hw * mid, ym, hd * mid), W(0, ridge, 0), W(0, ridge, 0), roof);
      soup.quad(W(-hw * mid, ym, hd * mid), W(-hw * mid, ym, -hd * mid), W(0, ridge, 0), W(0, ridge, 0), roof);
      return;
    }
    case "sawtooth": {
      const n = Math.max(2, Math.round(hv / 3));
      for (let i = 0; i < n; i++) {
        const v0 = -hv + (2 * hv * i) / n;
        const v1 = -hv + (2 * hv * (i + 1)) / n;
        soup.quad(P(-hu, eave, v0), P(hu, eave, v0), P(hu, ridge, v1), P(-hu, ridge, v1), roof);
        soup.quad(P(-hu, eave, v1), P(-hu, ridge, v1), P(hu, ridge, v1), P(hu, eave, v1), lin("#8fa0a8"));
      }
      return;
    }
    case "setback-crown": {
      addCap(soup, rectCorners(m.center, m.width, m.depth, m.rotationDeg), eave, roof);
      const inner = rectCorners(m.center, m.width * 0.7, m.depth * 0.7, m.rotationDeg);
      addPrismWalls(soup, inner, eave, ridge, wall);
      addCap(soup, inner, ridge, roof);
      return;
    }
    case "flat-parapet":
    case "terrace": {
      const outer = rectCorners(m.center, m.width, m.depth, m.rotationDeg);
      addCap(soup, outer, eave, roof);
      if (ridge > eave + 0.05) {
        const inner = rectCorners(m.center, Math.max(0.2, m.width - 0.6), Math.max(0.2, m.depth - 0.6), m.rotationDeg);
        for (let i = 0; i < 4; i++) {
          const a = outer[i];
          const b = outer[(i + 1) % 4];
          const c2 = inner[(i + 1) % 4];
          const d = inner[i];
          soup.quad([a[0], ridge, a[1]], [b[0], ridge, b[1]], [c2[0], ridge, c2[1]], [d[0], ridge, d[1]], wall);
        }
        addPrismWalls(soup, outer, eave, ridge, wall);
      }
      return;
    }
    default:
      addCap(soup, rectCorners(m.center, m.width, m.depth, m.rotationDeg), Math.max(eave, ridge), roof);
  }
}

function addWalls(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler): void {
  for (const w of bp.walls) {
    const col = lin(materialHex(w.material));
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const cond = w.segments.find((g) => s >= g.from && s < g.to)?.condition ?? "sound";
      const a = w.points[s];
      const b = w.points[(s + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const dx = (b[0] - a[0]) / len;
      const dz = (b[1] - a[1]) / len;
      const nx = -dz * (w.thickness / 2);
      const nz = dx * (w.thickness / 2);
      const pieces = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i < pieces; i++) {
        const t0 = i / pieces;
        const t1 = (i + 1) / pieces;
        const x0 = a[0] + (b[0] - a[0]) * t0;
        const z0 = a[1] + (b[1] - a[1]) * t0;
        const x1 = a[0] + (b[0] - a[0]) * t1;
        const z1 = a[1] + (b[1] - a[1]) * t1;
        const g = Math.min(T.height(x0, z0), T.height(x1, z1));
        // Damaged and ruinous stretches lose height unevenly; weathered ones lose their crenels.
        const lossy = cond === "damaged" || cond === "ruinous";
        const top = g + w.height * (lossy ? 0.55 + 0.35 * hash01(x0, z0) : 1);
        addPrismWalls(soup, [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], g - 0.6, top, col);
        addCap(soup, [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], top, mul(col, 1.1));
        if (w.walkway && !lossy && cond !== "weathered" && i % 2 === 0) {
          // Merlons on the outer face.
          const mx = x0 + (x1 - x0) * 0.25;
          const mz = z0 + (z1 - z0) * 0.25;
          const ox = nx * 0.6;
          const oz = nz * 0.6;
          addPrismWalls(soup, [[mx + nx, mz + nz], [mx + dx * 0.8 + nx, mz + dz * 0.8 + nz], [mx + dx * 0.8 + ox, mz + dz * 0.8 + oz], [mx + ox, mz + oz]], top, top + 0.8, col);
        }
      }
    }
  }
}

function roofRise(form: string, width: number): number {
  return form === "spire" ? width * 1.6 : form === "conical" ? width * 0.9 : form === "pyramid" ? width * 0.7 : form === "dome" ? width * 0.5 : 0;
}

function addTowers(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler): void {
  for (const t of bp.towers) {
    const g = T.height(t.center[0], t.center[1]);
    const col = lin(materialHex(t.material));
    const r = t.width / 2;
    const sides = t.shape === "square" ? 4 : t.shape === "polygonal" ? 8 : 16;
    const ring: Vec2[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (sides === 4 ? Math.PI / 4 : 0) + (i * 2 * Math.PI) / sides;
      const rr = sides === 4 ? r * Math.SQRT2 : r;
      ring.push([t.center[0] + rr * Math.cos(a), t.center[1] + rr * Math.sin(a)]);
    }
    const top = g + t.height * (t.condition === "ruinous" ? 0.8 : 1);
    addPrismWalls(soup, ring, g - 1, top, col);
    if (t.storyRole === "repaired-watchtower") addPrismWalls(soup, ring.map((p): Vec2 => [t.center[0] + (p[0] - t.center[0]) * 1.01, t.center[1] + (p[1] - t.center[1]) * 1.01]), g + t.height * 0.66, top, lin("#b9b1a0"));
    const rise = t.condition === "ruinous" ? 0 : roofRise(t.roof, t.width);
    if (rise > 0) {
      const roof = lin(t.roof === "spire" ? "#6f737a" : "#3a3f48");
      for (let i = 0; i < sides; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % sides];
        soup.tri([a[0], top, a[1]], [b[0], top, b[1]], [t.center[0], top + rise, t.center[1]], roof);
      }
    } else addCap(soup, ring, top, mul(col, t.condition === "ruinous" ? 0.6 : 1.1));
  }
}

const TREE_STYLE: Record<string, { h: [number, number]; r: [number, number]; shape: "cone" | "round" | "hedge" | "palm" | "none"; hex: string; cap: number }> = {
  forest: { h: [10, 16], r: [1.8, 2.8], shape: "cone", hex: "#2f3b2c", cap: 1600 },
  woodland: { h: [8, 13], r: [2.4, 3.6], shape: "round", hex: "#45563a", cap: 900 },
  orchard: { h: [3.5, 5], r: [1.6, 2.2], shape: "round", hex: "#56653d", cap: 300 },
  hedgerow: { h: [1.4, 2], r: [0.7, 0.9], shape: "hedge", hex: "#3f5233", cap: 600 },
  scrub: { h: [1, 2.2], r: [0.8, 1.4], shape: "round", hex: "#5a5e3e", cap: 700 },
  "lone-tree": { h: [9, 11], r: [3.8, 4.4], shape: "round", hex: "#34402d", cap: 1 },
  "palm-grove": { h: [8, 12], r: [2.2, 3], shape: "palm", hex: "#4f6a33", cap: 400 },
  planter: { h: [1, 1.6], r: [0.6, 0.9], shape: "round", hex: "#4d6a3a", cap: 200 },
  garden: { h: [0.4, 0.8], r: [0.4, 0.6], shape: "none", hex: "#5d7a40", cap: 0 },
  heath: { h: [0.3, 0.6], r: [0.4, 0.6], shape: "none", hex: "#7a6a72", cap: 0 },
  reeds: { h: [1, 1.6], r: [0.3, 0.5], shape: "none", hex: "#8a8a5a", cap: 0 },
  "vine-terrace": { h: [1, 1.5], r: [0.5, 0.7], shape: "hedge", hex: "#5a7a3a", cap: 300 },
  "moss-bank": { h: [0.2, 0.4], r: [0.4, 0.6], shape: "none", hex: "#6a7a4a", cap: 0 },
};

function addVegetation(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler, clip: Vec2[] | null): void {
  const trunk = lin("#3d3024");
  for (const z of bp.vegetation) {
    const st = TREE_STYLE[z.kind];
    if (!st || st.shape === "none") continue;
    const poly = shapePolygon(z.shape);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    const e = bp.terrain.extents;
    minX = Math.max(minX, e.minX); maxX = Math.min(maxX, e.maxX);
    minZ = Math.max(minZ, e.minZ); maxZ = Math.min(maxZ, e.maxZ);
    if (minX >= maxX || minZ >= maxZ) continue;
    const rnd = rng(z.seed * 7919 + 13);
    const target = z.kind === "lone-tree" ? 1 : Math.min(st.cap, Math.round(((maxX - minX) * (maxZ - minZ) * z.density) / 100));
    const base = lin(st.hex);
    for (let i = 0, placed = 0; i < target * 4 && placed < target; i++) {
      const p: Vec2 = z.kind === "lone-tree" ? [(minX + maxX) / 2, (minZ + maxZ) / 2] : [minX + rnd() * (maxX - minX), minZ + rnd() * (maxZ - minZ)];
      if (!pointInPolygon(p, poly)) continue;
      if (clip && !pointInPolygon(p, clip)) continue;
      if (T.waterLevel(p[0], p[1]) === T.waterLevel(p[0], p[1])) continue;
      placed++;
      const g = T.height(p[0], p[1]);
      const h = st.h[0] + rnd() * (st.h[1] - st.h[0]);
      const r = st.r[0] + rnd() * (st.r[1] - st.r[0]);
      const col = mul(base, 0.8 + 0.4 * rnd());
      if (st.shape === "hedge") {
        addPrismWalls(soup, [[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]], g - 0.2, g + h, col);
        addCap(soup, [[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]], g + h, col);
        continue;
      }
      const sides = 6;
      const tr = st.shape === "palm" ? 0.25 : 0.18;
      const trunkTop = st.shape === "cone" ? g + h * 0.25 : st.shape === "palm" ? g + h * 0.9 : g + h * 0.42;
      addPrismWalls(soup, [[p[0] - tr, p[1] - tr], [p[0] + tr, p[1] - tr], [p[0] + tr, p[1] + tr], [p[0] - tr, p[1] + tr]], g - 0.2, trunkTop, trunk);
      const ring: V3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k * 2 * Math.PI) / sides + rnd() * 0.3;
        ring.push([p[0] + r * Math.cos(a), 0, p[1] + r * Math.sin(a)]);
      }
      if (st.shape === "cone") {
        const apex: V3 = [p[0], g + h, p[1]];
        for (let k = 0; k < sides; k++) {
          const a = ring[k];
          const b = ring[(k + 1) % sides];
          soup.tri([a[0], trunkTop, a[2]], [b[0], trunkTop, b[2]], apex, col);
        }
      } else {
        const mid = st.shape === "palm" ? g + h * 0.95 : g + h * 0.62;
        const lo = st.shape === "palm" ? g + h * 0.82 : trunkTop;
        const hi = st.shape === "palm" ? g + h : g + h;
        const bot: V3 = [p[0], lo, p[1]];
        const top: V3 = [p[0], hi, p[1]];
        for (let k = 0; k < sides; k++) {
          const a = ring[k];
          const b = ring[(k + 1) % sides];
          soup.tri([a[0], mid, a[2]], [b[0], mid, b[2]], top, col);
          soup.tri([b[0], mid, b[2]], [a[0], mid, a[2]], bot, mul(col, 0.8));
        }
      }
    }
  }
}

/** Elevated routes (stairs along walls, bridges, viaducts) as solid decks following their deck heights. */
function addElevatedRoutes(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler): void {
  for (const r of bp.routes) {
    if (r.grade !== "elevated" || !r.deckY) continue;
    const col = lin(ROUTE_HEX[r.surface] ?? "#a59d8e");
    const body = mul(lin("#6a645e"), 1);
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const nx = (-(b[1] - a[1]) / len) * (r.width / 2);
      const nz = ((b[0] - a[0]) / len) * (r.width / 2);
      const pieces = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k < pieces; k++) {
        const t0 = k / pieces;
        const t1 = (k + 1) / pieces;
        const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0;
        const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
        const y0 = r.deckY[i - 1] + (r.deckY[i] - r.deckY[i - 1]) * t0;
        const y1 = r.deckY[i - 1] + (r.deckY[i] - r.deckY[i - 1]) * t1;
        const y = r.kind === "stair" ? y0 : (y0 + y1) / 2;
        const quad: Vec2[] = [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]];
        const g = Math.min(T.height(x0, z0), T.height(x1, z1));
        addPrismWalls(soup, quad, r.kind === "stair" ? g - 0.3 : y - 1.2, y, body);
        addCap(soup, quad, y, col);
      }
    }
  }
}

const HERALDRY_PREVIEW: Record<string, [string, string]> = {
  player: ["#c9a23a", "#5e3a78"],
  ally: ["#2b4f8c", "#dcd8cc"],
  rival: ["#9e2a24", "#c9a23a"],
  crown: ["#1b1a1d", "#c9a23a"],
  veiled: ["#3a3640", "#2a2730"],
};

/** Standards, shields and pennants of hall tier 0 (preview colours stand in for real heraldry). */
function addBanners(soup: Soup, bp: BannerholdBlueprint): void {
  // The founding standard (draft heraldry during the ceremony, the banner's own afterwards) is drawn like a 7 m standard.
  const founding: BannerholdBlueprint["slots"]["bannerMounts"][number] = { id: "founding-standard", kind: "standard", heraldry: "player", pose: bp.slots.foundingStandard, height: 7, minHallTier: 0 };
  for (const m of [founding, ...bp.slots.bannerMounts]) {
    if (m.minHallTier > 0) continue;
    const [a, b] = HERALDRY_PREVIEW[m.heraldry] ?? HERALDRY_PREVIEW.player;
    const p = m.pose.position;
    const yaw = (m.pose.yawDeg * Math.PI) / 180;
    // Cloth hangs across local x of the mount.
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    if (m.kind === "standard" || m.kind === "veiled-standard" || m.kind === "pennant" || m.kind === "signal-flag") {
      const pole = lin("#2a2522");
      addPrismWalls(soup, [[p[0] - 0.07, p[2] - 0.07], [p[0] + 0.07, p[2] - 0.07], [p[0] + 0.07, p[2] + 0.07], [p[0] - 0.07, p[2] + 0.07]], p[1], p[1] + m.height, pole);
      const w = Math.max(0.8, m.height * 0.32);
      const top = p[1] + m.height - 0.2;
      const bot = top - Math.max(1.2, m.height * 0.45);
      soup.quad([p[0], bot, p[2]], [p[0] + ux * w, bot, p[2] + uz * w], [p[0] + ux * w, top, p[2] + uz * w], [p[0], top, p[2]], lin(a), 0.08);
      soup.quad([p[0], bot, p[2]], [p[0] + ux * w * 0.5, bot - 0.01, p[2] + uz * w * 0.5], [p[0] + ux * w * 0.5, top, p[2] + uz * w * 0.5], [p[0], top, p[2]], lin(b), 0.08);
    } else {
      const w = m.height * 0.5;
      soup.quad([p[0] - ux * w, p[1], p[2] - uz * w], [p[0] + ux * w, p[1], p[2] + uz * w], [p[0] + ux * w, p[1] + m.height, p[2] + uz * w], [p[0] - ux * w, p[1] + m.height, p[2] - uz * w], lin(a), 0.08);
    }
  }
}

/** Pawn stand plinth with a pale figure envelope (scale only, not a figure) and the eight file posts. */
function addMusterMarkers(soup: Soup, bp: BannerholdBlueprint): void {
  const box = (x: number, z: number, hw: number, hd: number, yaw: number): Vec2[] => {
    const c = Math.cos((yaw * Math.PI) / 180);
    const s = Math.sin((yaw * Math.PI) / 180);
    return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c] as Vec2);
  };
  const st = bp.muster.pawnStand;
  const [x, y, z] = st.position;
  const stone = lin("#8d8678");
  const plinth = box(x, z, 0.6, 0.6, st.yawDeg);
  addPrismWalls(soup, plinth, y - 0.3, y + 0.32, stone);
  addCap(soup, plinth, y + 0.32, mul(stone, 1.1));
  const env = box(x, z, 0.24, 0.16, st.yawDeg);
  const pale = lin("#e9e4da");
  addPrismWalls(soup, env, y + 0.32, y + 2.12, pale);
  addCap(soup, env, y + 2.12, pale);
  const post = lin("#4a4038");
  for (const f of bp.muster.fileMarkers) {
    const [fx, fy, fz] = f.pose.position;
    const o = box(fx, fz, 0.09, 0.09, f.pose.yawDeg);
    addPrismWalls(soup, o, fy - 0.2, fy + 1.05, post);
    addCap(soup, o, fy + 1.05, mul(post, 1.2));
  }
}

/** Outward rings of the far ground (metres beyond the modelled edge) and how far each sinks below the edge's broad landform. */
const FAR_RINGS = [0, 600, 1500, 3500, 8000, 18000, 40000];
const FAR_DROP = [0, 1, 4, 10, 25, 60, 140];

/**
 * Far ground that starts exactly on the terrain mesh's border vertices and carries the site's broad
 * landform outward (smoothed edge heights, sinking gently toward the horizon), so the basin, scarp or
 * plateau continues instead of meeting a flat disc. Tagged 2: no shadows, and fog may reach the sky.
 */
function addFarGround(soup: Soup, bp: BannerholdBlueprint, T: TerrainSampler, step: number): void {
  const e = bp.terrain.extents;
  const cols = Math.floor((e.maxX - e.minX) / step);
  const rows = Math.floor((e.maxZ - e.minZ) / step);
  const x1 = e.minX + cols * step;
  const z1 = e.minZ + rows * step;
  const border: Vec2[] = [];
  for (let c = 0; c < cols; c++) border.push([e.minX + c * step, e.minZ]);
  for (let r = 0; r < rows; r++) border.push([x1, e.minZ + r * step]);
  for (let c = cols; c > 0; c--) border.push([e.minX + c * step, z1]);
  for (let r = rows; r > 0; r--) border.push([e.minX, e.minZ + r * step]);
  const n = border.length;
  const h = border.map(([x, z]) => T.height(x, z));
  const win = Math.max(2, Math.round(120 / step));
  const hs = h.map((_, i) => {
    let s = 0;
    for (let k = -win; k <= win; k++) s += h[(i + k + n * 4) % n];
    return s / (2 * win + 1);
  });
  const cx = (e.minX + x1) / 2;
  const cz = (e.minZ + z1) / 2;
  const base = lin(SURFACE_HEX[bp.terrain.baseSurface] ?? "#8a8a70");
  const edgeCol = border.map(([x, z]) => lin(SURFACE_HEX[T.surface(x, z)] ?? SURFACE_HEX[bp.terrain.baseSurface] ?? "#8a8a70"));
  // Only the base surface continues outward; a patch that touches the edge (crust, field) stops there.
  const edgeIsBase = border.map(([x, z]) => T.surface(x, z) === bp.terrain.baseSurface);
  const point = (i: number, k: number): V3 => {
    const [bx, bz] = border[i];
    const l = Math.hypot(bx - cx, bz - cz) || 1;
    const d = FAR_RINGS[k];
    return [bx + ((bx - cx) / l) * d, k === 0 ? h[i] : hs[i] - FAR_DROP[k], bz + ((bz - cz) / l) * d];
  };
  // Outer bands need far fewer segments. Each band's inner edge passes through every vertex of the
  // previous band's outer edge (a fan), so the rings stay watertight without T-junction cracks.
  const strides = [1, 1, 4, 4, 12, 12];
  for (let k = 0; k < FAR_RINGS.length - 1; k++) {
    const s = strides[k];
    const inner = k === 0 ? 1 : strides[k - 1];
    for (let i = 0; i < n; i += s) {
      const jEnd = Math.min(i + s, n);
      const t = Math.min(1, k / 2);
      const col = mix3(edgeCol[i], base, t < 1 ? Math.max(t, edgeIsBase[i] ? 0 : 1) : 1);
      const c = point(jEnd % n, k + 1);
      const d = point(i, k + 1);
      let prev = point(i, k);
      const first = prev;
      for (let q = i + inner; ; q += inner) {
        const cur = point(Math.min(q, jEnd) % n, k);
        soup.tri(prev, cur, c, col, 0, 2);
        prev = cur;
        if (q >= jEnd) break;
      }
      soup.tri(first, c, d, col, 0, 2);
    }
  }
}

/** Distant places and skyline layers, so previews show the greater nation. */
function addFarWorld(soup: Soup, bp: BannerholdBlueprint): void {
  for (const s of bp.outer.skyline) {
    if (s.distance < 300) continue;
    const kind = s.kind;
    const col = lin(kind === "forest" ? "#2f3a2c" : kind === "smoke" ? "#8a8590" : kind === "glacier" ? "#c9ccd2" : kind === "dunes" ? "#c9a878" : kind === "mesa" ? "#a8775a" : kind === "viaduct" ? "#8f7a62" : "#5a5866");
    let from = s.bearingFromDeg;
    let to = s.bearingToDeg;
    if (to < from) to += 360;
    const steps = kind === "viaduct" ? Math.max(8, Math.round((((to - from) * Math.PI) / 180) * s.distance / 24)) : Math.max(4, Math.round((to - from) / 1.5));
    const rnd = rng(Math.round(s.distance) + s.id.length * 97);
    let prevTop = 0;
    for (let i = 0; i <= steps; i++) {
      const b = from + ((to - from) * i) / steps;
      const top = kind === "smoke" ? s.height : s.height * (kind === "mountains" || kind === "glacier" ? 0.55 + 0.45 * Math.abs(Math.sin(i * 0.9 + rnd() * 2)) : kind === "spires" || kind === "towers" ? (i % 2 === 0 ? 1 : 0.45 + 0.3 * rnd()) : 0.7 + 0.3 * rnd());
      if (i > 0) {
        const pa = polar(b - (to - from) / steps, s.distance);
        const pb = polar(b, s.distance);
        if (kind === "viaduct") {
          // A deck on piers: the arches read as gaps against the sky and the land behind.
          const deck = s.height * 0.8;
          soup.quad([pa[0], deck, pa[1]], [pb[0], deck, pb[1]], [pb[0], s.height, pb[1]], [pa[0], s.height, pa[1]], col, 0, 0);
          const pm: Vec2 = [pa[0] + (pb[0] - pa[0]) * 0.28, pa[1] + (pb[1] - pa[1]) * 0.28];
          soup.quad([pa[0], -320, pa[1]], [pm[0], -320, pm[1]], [pm[0], deck, pm[1]], [pa[0], deck, pa[1]], col, 0, 0);
        } else soup.quad([pa[0], -320, pa[1]], [pb[0], -320, pb[1]], [pb[0], top, pb[1]], [pa[0], prevTop, pa[1]], col, 0, 0);
      }
      prevTop = top;
    }
  }
  for (const p of bp.outer.places) {
    const rnd = rng(Math.round(p.distance * 3) + p.id.length * 131);
    const col = lin(p.kind === "monastery" ? "#9a958c" : p.kind === "frontier" ? "#4a4650" : "#3f3c46");
    const n = p.kind === "capital" ? 26 : p.kind === "town" ? 14 : p.kind === "village" ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = (i === 0 ? 0 : 0.2 + 0.8 * rnd()) * p.radius;
      const x = p.position[0] + Math.cos(ang) * rad;
      const z = p.position[1] + Math.sin(ang) * rad;
      const tall = i === 0 ? p.silhouetteHeight : p.silhouetteHeight * (0.25 + 0.5 * rnd());
      const w = Math.max(6, p.radius * (p.kind === "capital" ? 0.05 : 0.12) * (0.6 + rnd()));
      const y0 = p.groundElevation - 160;
      const body = p.kind === "capital" || p.kind === "allied-seat" || p.kind === "monastery" || p.kind === "citadel" ? tall * 0.6 : tall;
      addPrismWalls(soup, [[x - w, z - w], [x + w, z - w], [x + w, z + w], [x - w, z + w]], y0, p.groundElevation + body, col, 0);
      const apex: V3 = [x, p.groundElevation + tall, z];
      const ring: Vec2[] = [[x - w, z - w], [x + w, z - w], [x + w, z + w], [x - w, z + w]];
      for (let k = 0; k < 4; k++) soup.tri([ring[k][0], p.groundElevation + body, ring[k][1]], [ring[(k + 1) % 4][0], p.groundElevation + body, ring[(k + 1) % 4][1]], apex, mul(col, 0.85), 0, 0);
    }
  }
}

export interface PreviewCamera {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
}

interface Basis {
  o: V3;
  r: V3;
  u: V3;
  f: V3;
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function lookBasis(pos: Vec3, target: Vec3): Basis {
  const f = norm([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  return { o: [pos[0], pos[1], pos[2]], r, u: cross(r, f), f };
}

/** Rasterise screen-space triangles into a depth (1/z) buffer and a triangle-id buffer. */
function rasterTriangle(
  W: number, H: number, depth: Float32Array, ids: Int32Array, id: number,
  x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, x2: number, y2: number, w2: number,
  closerIsLarger: boolean,
): void {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) return;
  let minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  let maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  let minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  let maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const pyc = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const pxc = x + 0.5;
      const l0 = ((x1 - pxc) * (y2 - pyc) - (x2 - pxc) * (y1 - pyc)) * inv;
      const l1 = ((x2 - pxc) * (y0 - pyc) - (x0 - pxc) * (y2 - pyc)) * inv;
      const l2 = 1 - l0 - l1;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const d = l0 * w0 + l1 * w1 + l2 * w2;
      const i = y * W + x;
      if (closerIsLarger ? d > depth[i] : d < depth[i]) {
        depth[i] = d;
        ids[i] = id;
      }
    }
  }
}

interface ShadowMap {
  size: number;
  basis: Basis;
  minX: number;
  maxY: number;
  scale: number;
  depth: Float32Array;
}

function buildShadowMap(soup: Soup, bp: BannerholdBlueprint, sun: V3, size: number): ShadowMap {
  const f: V3 = [-sun[0], -sun[1], -sun[2]];
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const basis: Basis = { o: [0, 0, 0], r, u, f };
  const e = bp.terrain.extents;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [e.minX, e.maxX]) for (const z of [e.minZ, e.maxZ]) for (const y of [-30, 120]) {
    const sx = x * r[0] + y * r[1] + z * r[2];
    const sy = x * u[0] + y * u[1] + z * u[2];
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  const scale = (size - 1) / Math.max(maxX - minX, maxY - minY);
  const depth = new Float32Array(size * size).fill(Infinity);
  const ids = new Int32Array(size * size);
  const P = soup.pos;
  for (let t = 0; t < soup.count; t++) {
    if (soup.local[t] !== 1) continue;
    const s: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = P[t * 9 + k * 3], y = P[t * 9 + k * 3 + 1], z = P[t * 9 + k * 3 + 2];
      s.push((x * r[0] + y * r[1] + z * r[2] - minX) * scale, (maxY - (x * u[0] + y * u[1] + z * u[2])) * scale, x * f[0] + y * f[1] + z * f[2]);
    }
    rasterTriangle(size, size, depth, ids, t, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], false);
  }
  return { size, basis, minX, maxY, scale, depth };
}

function shadowAt(sm: ShadowMap, x: number, y: number, z: number, bias: number): number {
  const b = sm.basis;
  const sx = (x * b.r[0] + y * b.r[1] + z * b.r[2] - sm.minX) * sm.scale;
  const sy = (sm.maxY - (x * b.u[0] + y * b.u[1] + z * b.u[2])) * sm.scale;
  const d = x * b.f[0] + y * b.f[1] + z * b.f[2];
  let lit = 0;
  let n = 0;
  for (const ox of [-0.5, 0.5]) for (const oy of [-0.5, 0.5]) {
    const ix = Math.floor(sx + ox);
    const iy = Math.floor(sy + oy);
    n++;
    if (ix < 0 || iy < 0 || ix >= sm.size || iy >= sm.size) {
      lit++;
      continue;
    }
    if (d <= sm.depth[iy * sm.size + ix] + bias) lit++;
  }
  return lit / n;
}

interface Lighting {
  sun: V3;
  sunCol: RGB;
  sunIntensity: number;
  sky: RGB;
  ground: RGB;
  ambient: number;
  zenith: RGB;
  horizon: RGB;
  fog: RGB;
  fogNear: number;
  fogFar: number;
  disc: string;
  exposure: number;
}

function lightingOf(bp: BannerholdBlueprint): Lighting {
  const a = bp.atmosphere;
  const b = (a.sun.bearingDeg * Math.PI) / 180;
  const e = (a.sun.elevationDeg * Math.PI) / 180;
  return {
    sun: norm([Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)]),
    sunCol: lin(a.sun.colour),
    sunIntensity: a.sun.intensity,
    sky: lin(a.sky.horizon),
    ground: lin(a.sky.ground),
    ambient: a.sky.ambientIntensity,
    zenith: lin(a.sky.zenith),
    horizon: lin(a.sky.horizon),
    fog: lin(a.fog.colour),
    fogNear: a.fog.near,
    fogFar: a.fog.far,
    disc: a.sun.disc,
    exposure: a.exposure,
  };
}

/**
 * Render the soup from a camera. Clips at the near plane, supersamples 2×,
 * shades each visible pixel once (deferred) and returns sRGB RGBA.
 */
function renderSoup(soup: Soup, cam: PreviewCamera, lightingIn: Lighting, sm: ShadowMap | null, W: number, H: number, background?: RGB): Uint8ClampedArray {
  const SS = 2;
  const w = W * SS;
  const h = H * SS;
  const B = lookBasis(cam.position, cam.target);
  const tanH = Math.tan((cam.fovDeg * Math.PI) / 360);
  const aspect = W / H;
  const near = 0.3;
  const depth = new Float32Array(w * h);
  const ids = new Int32Array(w * h).fill(-1);
  const P = soup.pos;
  const cs = new Float64Array(9);
  const proj = (xc: number, yc: number, zc: number, out: number[]) => {
    out.push(((xc / (zc * tanH * aspect)) + 1) * 0.5 * w, (1 - yc / (zc * tanH)) * 0.5 * h, 1 / zc);
  };
  for (let t = 0; t < soup.count; t++) {
    let behind = 0;
    for (let k = 0; k < 3; k++) {
      const dx = P[t * 9 + k * 3] - B.o[0], dy = P[t * 9 + k * 3 + 1] - B.o[1], dz = P[t * 9 + k * 3 + 2] - B.o[2];
      cs[k * 3] = dx * B.r[0] + dy * B.r[1] + dz * B.r[2];
      cs[k * 3 + 1] = dx * B.u[0] + dy * B.u[1] + dz * B.u[2];
      cs[k * 3 + 2] = dx * B.f[0] + dy * B.f[1] + dz * B.f[2];
      if (cs[k * 3 + 2] < near) behind++;
    }
    if (behind === 3) continue;
    const poly: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const a = [cs[k * 3], cs[k * 3 + 1], cs[k * 3 + 2]];
      const bIdx = (k + 1) % 3;
      const b = [cs[bIdx * 3], cs[bIdx * 3 + 1], cs[bIdx * 3 + 2]];
      if (a[2] >= near) poly.push(a);
      if ((a[2] >= near) !== (b[2] >= near)) {
        const s = (near - a[2]) / (b[2] - a[2]);
        poly.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, near]);
      }
    }
    if (poly.length < 3) continue;
    const sp: number[] = [];
    for (const p of poly) proj(p[0], p[1], p[2], sp);
    for (let k = 1; k < poly.length - 1; k++) rasterTriangle(w, h, depth, ids, t, sp[0], sp[1], sp[2], sp[k * 3], sp[k * 3 + 1], sp[k * 3 + 2], sp[(k + 1) * 3], sp[(k + 1) * 3 + 1], sp[(k + 1) * 3 + 2], true);
  }
  // Per-triangle normals.
  const normals = new Float32Array(soup.count * 3);
  for (let t = 0; t < soup.count; t++) {
    const ax = P[t * 9], ay = P[t * 9 + 1], az = P[t * 9 + 2];
    const n = norm(cross([P[t * 9 + 3] - ax, P[t * 9 + 4] - ay, P[t * 9 + 5] - az], [P[t * 9 + 6] - ax, P[t * 9 + 7] - ay, P[t * 9 + 8] - az]));
    normals[t * 3] = n[0];
    normals[t * 3 + 1] = n[1];
    normals[t * 3 + 2] = n[2];
  }
  const L = lightingIn;
  const hdr = new Float32Array(w * h * 3);
  const discCos = Math.cos((1.6 * Math.PI) / 180);
  const ringCos = Math.cos((3.2 * Math.PI) / 180);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ndcX = ((x + 0.5) / w) * 2 - 1;
      const ndcY = 1 - ((y + 0.5) / h) * 2;
      const rd = norm([
        B.f[0] + B.r[0] * ndcX * tanH * aspect + B.u[0] * ndcY * tanH,
        B.f[1] + B.r[1] * ndcX * tanH * aspect + B.u[1] * ndcY * tanH,
        B.f[2] + B.r[2] * ndcX * tanH * aspect + B.u[2] * ndcY * tanH,
      ]);
      let c: RGB;
      const t = ids[i];
      if (t < 0) {
        if (background && rd[1] < 0.02) c = background;
        else {
          const k = Math.max(0, Math.min(1, rd[1] * 3));
          c = mix3(L.horizon, L.zenith, Math.pow(k, 0.6));
          if (rd[1] < 0) c = mix3(L.fog, L.ground, Math.min(1, -rd[1] * 4));
          const cosS = rd[0] * L.sun[0] + rd[1] * L.sun[1] + rd[2] * L.sun[2];
          if (L.disc === "eclipse-corona") {
            if (cosS > discCos) c = [0.004, 0.003, 0.006];
            else if (cosS > ringCos) c = mix3(c, mul(L.sunCol, 2.4), 0.85);
            else if (cosS > 0.985) c = mix3(c, mul(L.sunCol, 1.2), (cosS - 0.985) / (ringCos - 0.985) * 0.6);
          } else if (cosS > 0.9995) c = mul(L.sunCol, L.disc === "smog-disc" ? 1.2 : 3);
          else if (cosS > 0.99) c = mix3(c, mul(L.sunCol, 1.4), (cosS - 0.99) / 0.0095 * (L.disc === "veiled-sun" ? 0.6 : 0.35));
        }
      } else {
        const zc = 1 / depth[i];
        const dist = zc / (rd[0] * B.f[0] + rd[1] * B.f[1] + rd[2] * B.f[2]);
        const wx = B.o[0] + rd[0] * dist, wy = B.o[1] + rd[1] * dist, wz = B.o[2] + rd[2] * dist;
        let nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
        if (nx * rd[0] + ny * rd[1] + nz * rd[2] > 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const ndl = Math.max(0, nx * L.sun[0] + ny * L.sun[1] + nz * L.sun[2]);
        const sh = sm && soup.local[t] === 1 && ndl > 0 ? shadowAt(sm, wx + nx * 0.15, wy + ny * 0.15, wz + nz * 0.15, 0.35) : 1;
        const hemi = mix3(L.ground, L.sky, ny * 0.5 + 0.5);
        const amb = L.ambient * 1.3;
        const al = [soup.col[t * 3], soup.col[t * 3 + 1], soup.col[t * 3 + 2]];
        const e = soup.emit[t];
        c = [
          al[0] * (hemi[0] * amb + L.sunCol[0] * L.sunIntensity * ndl * sh + e),
          al[1] * (hemi[1] * amb + L.sunCol[1] * L.sunIntensity * ndl * sh + e),
          al[2] * (hemi[2] * amb + L.sunCol[2] * L.sunIntensity * ndl * sh + e),
        ];
        // Aerial perspective: near fog follows the atmosphere; far silhouettes keep some contrast against the sky.
        const fogCap = soup.local[t] === 1 ? 0.92 : soup.local[t] === 2 ? 1 : 0.78;
        const fogK = Math.min(fogCap, Math.max(0, 1 - Math.exp(-Math.max(0, dist - L.fogNear) / Math.max(1, L.fogFar - L.fogNear) * 1.4)));
        c = mix3(c, L.fog, fogK);
      }
      hdr[i * 3] = c[0] * L.exposure;
      hdr[i * 3 + 1] = c[1] * L.exposure;
      hdr[i * 3 + 2] = c[2] * L.exposure;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * w + (x * SS + sx)) * 3;
        r += hdr[i];
        g += hdr[i + 1];
        b += hdr[i + 2];
      }
      const n = SS * SS;
      const tone = (v: number) => Math.pow(v / (1 + v * 0.35), 1 / 2.2) * 255;
      out[(y * W + x) * 4] = tone(r / n);
      out[(y * W + x) * 4 + 1] = tone(g / n);
      out[(y * W + x) * 4 + 2] = tone(b / n);
      out[(y * W + x) * 4 + 3] = 255;
    }
  }
  return out;
}

/** Plan polygon of what the VR miniature renders: the detail region plus its far and lateral skirt. */
function vrRegion(bp: BannerholdBlueprint): Vec2[] {
  const vr = bp.vr;
  const fwd = bearingVector(vr.viewerFacingBearingDeg);
  const right: Vec2 = [-fwd[1], fwd[0]];
  const far = vr.detailExtent.depth / 2 + vr.skirtMargins.far;
  const lat = vr.detailExtent.width / 2 + vr.skirtMargins.lateral;
  const back = vr.detailExtent.depth / 2 + vr.skirtMargins.near;
  const corner = (a: number, b: number): Vec2 => [vr.displayCenter[0] + right[0] * a + fwd[0] * b, vr.displayCenter[1] + right[1] * a + fwd[1] * b];
  return [corner(-lat, -back), corner(lat, -back), corner(lat, far), corner(-lat, far)];
}

function vrDetailRect(bp: BannerholdBlueprint): Vec2[] {
  const vr = bp.vr;
  return rectCorners(vr.displayCenter, vr.detailExtent.width, vr.detailExtent.depth, 180 - vr.viewerFacingBearingDeg);
}

function buildPreviewSoup(bp: BannerholdBlueprint, T: TerrainSampler, mode: "world" | "vr"): Soup {
  const soup = new Soup();
  const clip = mode === "vr" ? vrRegion(bp) : null;
  const detail = mode === "vr" ? vrDetailRect(bp) : null;
  const e = bp.terrain.extents;
  const step = Math.max(1.5, Math.sqrt(((e.maxX - e.minX) * (e.maxZ - e.minZ)) / 60000));
  addTerrain(soup, bp, T, step, clip);
  for (const b of bp.buildings) {
    if (b.appearsAtHallTier !== undefined) continue;
    if (detail && !pointInPolygon(b.masses[0].center, detail)) continue;
    const base = resolveBuildingBase(T, b);
    for (const m of b.masses) addMass(soup, b, m, base.floorY, base.groundMin);
  }
  addWalls(soup, bp, T);
  addTowers(soup, bp, T);
  addElevatedRoutes(soup, bp, T);
  addVegetation(soup, bp, T, clip);
  addBanners(soup, bp);
  addMusterMarkers(soup, bp);
  if (mode === "world") addFarGround(soup, bp, T, step);
  addFarWorld(soup, bp);
  return soup;
}

interface PreviewShot {
  label: string;
  note: string;
  cam: PreviewCamera;
  w: number;
  h: number;
  vr?: boolean;
}

function vrSeatedCamera(bp: BannerholdBlueprint): PreviewCamera {
  const vr = bp.vr;
  const fwd = bearingVector(vr.viewerFacingBearingDeg);
  const d = vr.seated.viewerDistance / vr.displayScale;
  const eyeY = vr.datumY + (vr.seated.eyeHeight - vr.seated.surfaceHeight) / vr.displayScale;
  return {
    position: [vr.displayCenter[0] - fwd[0] * d, eyeY, vr.displayCenter[1] - fwd[1] * d],
    target: [vr.displayCenter[0] + fwd[0] * 12, vr.datumY, vr.displayCenter[1] + fwd[1] * 12],
    fovDeg: 76,
  };
}

function previewShots(bp: BannerholdBlueprint): PreviewShot[] {
  const byId = (id: string): CameraFraming | undefined => bp.cameras.find((c) => c.id === id);
  const shots: PreviewShot[] = [];
  const add = (id: string, w: number, h: number) => {
    const c = byId(id);
    if (c) shots.push({ label: c.label, note: `${c.id} · fov ${c.fovDeg}° · from [${c.position.map((v) => v.toFixed(1)).join(", ")}]`, cam: { position: c.position, target: c.target, fovDeg: c.fovDeg }, w, h });
  };
  add("establishing", 1440, 810);
  for (const id of ["founding", "landmark:banner-hall", "landmark:muster-grounds", "landmark:war-record", "landmark:heralds-station", "representative"]) add(id, 704, 396);
  const vrCam = vrSeatedCamera(bp);
  shots.push({
    label: "VR — seated eye point at rest",
    note: `1:${Math.round(1 / bp.vr.displayScale)} miniature, eye ${bp.vr.seated.eyeHeight} m, ${bp.vr.seated.viewerDistance} m from its centre, looking ${bp.vr.viewerFacingBearingDeg}° · only the detail region and skirt are drawn`,
    cam: vrCam,
    w: 1440,
    h: 600,
    vr: true,
  });
  return shots;
}

async function renderViewsSheet(bp: BannerholdBlueprint, T: TerrainSampler, file: string): Promise<void> {
  const L = lightingOf(bp);
  const t0 = Date.now();
  const world = buildPreviewSoup(bp, T, "world");
  const sm = buildShadowMap(world, bp, L.sun, 2048);
  const vrSoup = buildPreviewSoup(bp, T, "vr");
  const vrSm = buildShadowMap(vrSoup, bp, L.sun, 2048);
  const images: { shot: PreviewShot; b64: string }[] = [];
  for (const shot of previewShots(bp)) {
    const rgba = shot.vr ? renderSoup(vrSoup, shot.cam, L, vrSm, shot.w, shot.h, lin("#1c1b1f")) : renderSoup(world, shot.cam, L, sm, shot.w, shot.h);
    images.push({ shot, b64: encodePng(shot.w, shot.h, rgba).toString("base64") });
  }
  const cell = (im: { shot: PreviewShot; b64: string }, wide: boolean) =>
    `<figure style="margin:0;${wide ? "grid-column:1 / span 2;" : ""}"><img src="data:image/png;base64,${im.b64}" style="width:100%;display:block;border-radius:3px"/><figcaption style="font:600 14px ${FONT};color:${INK};margin:6px 2px 0">${esc(im.shot.label)}</figcaption><div style="font:12px ${FONT};color:#5a554c;margin:2px 2px 0">${esc(im.shot.note)}</div></figure>`;
  const [est, ...rest] = images;
  const vrImg = rest.pop();
  const status = bp.status === "production-default" ? "Reversible production default — not a canonical or launch choice" : "First-pass layout";
  const html = `<!doctype html><html><body style="margin:0;background:${PAPER}"><div id="sheet" style="width:1480px;padding:20px;box-sizing:content-box">
<div style="background:${INK};color:#f4efe4;padding:16px 22px;border-radius:4px;margin-bottom:16px"><div style="font:700 26px ${SERIF};letter-spacing:.5px">THE BANNERHOLD · ${esc(bp.nationId.toUpperCase())}</div><div style="font:15px ${FONT};margin-top:4px">${esc(bp.siteName)} — massing previews from every authored camera</div><div style="font:13px ${FONT};color:#d9b55a;margin-top:4px">${esc(status)}</div><div style="font:12px ${FONT};color:#cfc6b6;margin-top:6px">Blueprint volumes only (no kits, textures or figures; the pawn stand carries a pale 1.8 m figure envelope for scale and the file posts a–h are marked), rendered in software with the nation's sun, a shadow map and fog. Placeholder colours stand in for heraldry. Not final art; not a performance measurement.</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 20px">${cell(est, true)}${rest.map((im) => cell(im, false)).join("")}${vrImg ? cell(vrImg, true) : ""}</div></div></body></html>`;
  const tmp = file.replace(/\.png$/, ".tmp.html");
  writeFileSync(tmp, html);
  await screenshotHtml(tmp, file, "#sheet");
  const { unlinkSync } = await import("node:fs");
  unlinkSync(tmp);
  console.log(`  png ${file.replace(ROOT + "/", "")} (${world.count + vrSoup.count} triangles, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// ---------------------------------------------------------------------------
// Plan layers
// ---------------------------------------------------------------------------

function hull(points: Vec2[]): Vec2[] {
  const p = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (p.length < 3) return p;
  const crossZ = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

interface Numbered {
  n: number;
  b: Building;
  floorY: number;
  topY: number;
  relief: number;
}

function numberBuildings(bp: BannerholdBlueprint, T: TerrainSampler): Numbered[] {
  const order = ["A", "F", "B", "E", "D", "C", "G"];
  return bp.buildings
    .slice()
    .sort((a, b) => order.indexOf(a.district) - order.indexOf(b.district))
    .map((b, i) => {
      const base = resolveBuildingBase(T, b);
      return { n: i + 1, b, floorY: base.floorY, topY: buildingTopY(base, b), relief: base.relief };
    });
}

/** Cast shadows and lit roof tops of every volume, projected to plan from the 3D massing. */
function planMassing(bp: BannerholdBlueprint, T: TerrainSampler, v: View, opts: { showDevelopment: boolean }): { shadows: string; tops: string; development: string } {
  const sb = (bp.atmosphere.sun.bearingDeg * Math.PI) / 180;
  const away: Vec2 = [-Math.sin(sb), Math.cos(sb)];
  // Schematic plan shadows: direction from the nation's sun, length shortened for legibility.
  const k = 0.55;
  const shadowParts: string[] = [];
  const shadowOf = (poly: Vec2[], rise: number) => {
    if (rise <= 0.2) return;
    const off: Vec2 = [away[0] * rise * k, away[1] * rise * k];
    const h = hull(poly.concat(poly.map((p): Vec2 => [p[0] + off[0], p[1] + off[1]])));
    shadowParts.push(`<path d="${polyPath(v, h, true)}"/>`);
  };
  const soup = new Soup();
  const dev: string[] = [];
  for (const b of bp.buildings) {
    const base = resolveBuildingBase(T, b);
    if (b.appearsAtHallTier !== undefined) {
      for (const m of b.masses) dev.push(`<path d="${polyPath(v, massPolygon(m), true)}" fill="none" stroke="#6f4f96" stroke-width="1.4" stroke-dasharray="5 3"/>`);
      continue;
    }
    for (const m of b.masses) {
      addMass(soup, b, m, base.floorY, base.groundMin);
      if (m.role === "scaffold") continue;
      const g = T.height(m.center[0], m.center[1]);
      shadowOf(massPolygon(m), base.floorY + (m.baseOffset ?? 0) + m.ridgeHeight * (m.roof.form === "spire" || m.roof.form === "conical" || m.roof.form === "pyramid" ? 0.75 : 0.92) - g);
    }
  }
  for (const t of bp.towers) {
    const r = t.width / 2;
    const ring: Vec2[] = [];
    for (let i = 0; i < 12; i++) ring.push([t.center[0] + r * Math.cos((i * Math.PI) / 6), t.center[1] + r * Math.sin((i * Math.PI) / 6)]);
    shadowOf(ring, t.height + roofRise(t.roof, t.width) * 0.6);
  }
  for (const w of bp.walls) {
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const a = w.points[s];
      const b = w.points[(s + 1) % n];
      shadowOf([a, b], w.height);
    }
  }
  addWalls(soup, bp, T);
  addTowers(soup, bp, T);
  addElevatedRoutes(soup, bp, T);
  const Lp = norm([Math.sin(sb) * Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), -Math.cos(sb) * Math.cos(Math.PI / 4)]);
  const order: number[] = [];
  for (let t = 0; t < soup.count; t++) order.push(t);
  const meanY = (t: number) => (soup.pos[t * 9 + 1] + soup.pos[t * 9 + 4] + soup.pos[t * 9 + 7]) / 3;
  order.sort((a, b) => meanY(a) - meanY(b));
  const tops: string[] = [];
  const P = soup.pos;
  for (const t of order) {
    const ax = P[t * 9], ay = P[t * 9 + 1], az = P[t * 9 + 2];
    let n = norm(cross([P[t * 9 + 3] - ax, P[t * 9 + 4] - ay, P[t * 9 + 5] - az], [P[t * 9 + 6] - ax, P[t * 9 + 7] - ay, P[t * 9 + 8] - az]));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    if (n[1] < 0.12) continue;
    const albedo = [soup.col[t * 3], soup.col[t * 3 + 1], soup.col[t * 3 + 2]].map((c) => Math.pow(c, 1 / 2.2) * 255);
    const shade = Math.min(1.18, 0.62 + 0.62 * Math.max(0, n[0] * Lp[0] + n[1] * Lp[1] + n[2] * Lp[2]));
    const col = albedo.map((c) => Math.max(0, Math.min(255, Math.round(c * shade * 0.9 + 255 * 0.1))));
    const fill = `rgb(${col[0]},${col[1]},${col[2]})`;
    tops.push(`<path d="M${pt(v, [ax, az])}L${pt(v, [P[t * 9 + 3], P[t * 9 + 5]])}L${pt(v, [P[t * 9 + 6], P[t * 9 + 8]])}Z" fill="${fill}" stroke="${fill}" stroke-width="0.35"/>`);
  }
  return {
    shadows: `<g fill="#1d1b20" opacity="0.17">${shadowParts.join("")}</g>`,
    tops: `<g>${tops.join("")}</g>`,
    development: opts.showDevelopment ? `<g>${dev.join("")}</g>` : "",
  };
}

function vegetationLayer(bp: BannerholdBlueprint, v: View, maxPerZone: number): string {
  const shade: string[] = [];
  const crown: string[] = [];
  const sb = (bp.atmosphere.sun.bearingDeg * Math.PI) / 180;
  const away: Vec2 = [-Math.sin(sb), Math.cos(sb)];
  for (const z of bp.vegetation) {
    const st = TREE_STYLE[z.kind];
    const poly = shapePolygon(z.shape);
    if (!st || st.shape === "none") {
      const fill = z.kind === "garden" ? "#6f8a4a" : z.kind === "heath" ? "#8a7280" : z.kind === "reeds" ? "#9a9a62" : "#7a8a5a";
      crown.push(`<path d="${polyPath(v, poly, true)}" fill="${fill}" fill-opacity="0.32" stroke="${fill}" stroke-opacity="0.5" stroke-width="0.6"/>`);
      continue;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    minX = Math.max(minX, v.minX - 10); maxX = Math.min(maxX, v.maxX + 10);
    minZ = Math.max(minZ, v.minZ - 10); maxZ = Math.min(maxZ, v.maxZ + 10);
    if (minX >= maxX || minZ >= maxZ) continue;
    const rnd = rng(z.seed * 7919 + 13);
    const n = z.kind === "lone-tree" ? 1 : Math.min(maxPerZone, Math.round(((maxX - minX) * (maxZ - minZ) * z.density) / 100));
    for (let i = 0, placed = 0; i < n * 4 && placed < n; i++) {
      const p: Vec2 = z.kind === "lone-tree" ? [(minX + maxX) / 2, (minZ + maxZ) / 2] : [minX + rnd() * (maxX - minX), minZ + rnd() * (maxZ - minZ)];
      if (!pointInPolygon(p, poly)) continue;
      placed++;
      const r = (st.r[0] + rnd() * (st.r[1] - st.r[0])) * (st.shape === "cone" ? 0.9 : 1);
      const hgt = st.h[0] + rnd() * (st.h[1] - st.h[0]);
      const rr = Math.max(0.9, r * v.scale);
      const off = Math.min(2.2, hgt * 0.18) * v.scale;
      shade.push(`<circle cx="${f1(px(v, p[0]) + away[0] * off)}" cy="${f1(py(v, p[1]) + away[1] * off)}" r="${f1(rr)}"/>`);
      crown.push(`<circle cx="${f1(px(v, p[0]))}" cy="${f1(py(v, p[1]))}" r="${f1(rr)}" fill="${shadeHex(st.hex, 1.25 + 0.25 * rnd())}" fill-opacity="0.92"/>`);
    }
  }
  return `<g fill="#1d1b20" opacity="0.15">${shade.join("")}</g><g>${crown.join("")}</g>`;
}

function waterLayer(bp: BannerholdBlueprint, v: View): string {
  return bp.terrain.water
    .map((w) =>
      w.shape.kind === "area"
        ? `<path d="${polyPath(v, w.shape.points, true)}" fill="#7d9fb4" fill-opacity="0.9" stroke="#3f6a8a" stroke-width="0.8"/>`
        : `<path d="${polyPath(v, w.shape.points, false)}" fill="none" stroke="#6a92ab" stroke-width="${f1(Math.max(1.5, w.shape.width * v.scale))}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>`,
    )
    .join("");
}

function fieldsLayer(bp: BannerholdBlueprint, v: View): string {
  return bp.outer.fields
    .map((fl) => {
      const d = polyPath(v, fl.polygon, true);
      const dir = bearingVector(fl.furrowBearingDeg);
      const nrm: Vec2 = [-dir[1], dir[0]];
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of fl.polygon) {
        const s = p[0] * nrm[0] + p[1] * nrm[1];
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      const c = fl.polygon.reduce((a, p) => [a[0] + p[0] / fl.polygon.length, a[1] + p[1] / fl.polygon.length] as Vec2, [0, 0] as Vec2);
      const lines: string[] = [];
      for (let s = lo + 2; s < hi; s += 3) {
        const o = s - (c[0] * nrm[0] + c[1] * nrm[1]);
        lines.push(`M${pt(v, [c[0] + nrm[0] * o - dir[0] * 300, c[1] + nrm[1] * o - dir[1] * 300])}L${pt(v, [c[0] + nrm[0] * o + dir[0] * 300, c[1] + nrm[1] * o + dir[1] * 300])}`);
      }
      const id = `clip-${fl.id}`;
      return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="none" stroke="#7a6a3a" stroke-width="0.8"/><path d="${lines.join("")}" clip-path="url(#${id})" stroke="#7a6a3a" stroke-opacity="0.3" stroke-width="0.6"/>`;
    })
    .join("");
}

function districtsLayer(bp: BannerholdBlueprint, v: View): string {
  const parts: string[] = [];
  for (const d of bp.districts) {
    const col = DISTRICT_COLOUR[d.id];
    parts.push(`<path d="${polyPath(v, d.polygon, true)}" fill="${col}" fill-opacity="0.05" stroke="${col}" stroke-opacity="0.85" stroke-width="1.5" stroke-dasharray="8 5"/>`);
  }
  parts.push(`<path d="${polyPath(v, bp.settlementBoundary, true)}" fill="none" stroke="${INK}" stroke-opacity="0.6" stroke-width="1.1" stroke-dasharray="2 4"/>`);
  return parts.join("");
}

function polygonLabelPoint(poly: readonly Vec2[]): Vec2 {
  // Centroid nudged inside by sampling a coarse grid for the point farthest from the edges.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  let best: Vec2 = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  let bestD = -1;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p: Vec2 = [minX + ((maxX - minX) * i) / 12, minZ + ((maxZ - minZ) * j) / 12];
    if (!pointInPolygon(p, poly)) continue;
    let d = Infinity;
    for (let k = 0; k < poly.length; k++) d = Math.min(d, distanceToPolyline(p, [poly[k], poly[(k + 1) % poly.length]]));
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function districtLabels(bp: BannerholdBlueprint, v: View, anchors?: Partial<Record<string, Vec2>>): string {
  return bp.districts
    .map((d) => {
      const p = anchors?.[d.id] ?? polygonLabelPoint(d.polygon);
      return text(px(v, p[0]), py(v, p[1]), `${d.id} · ${d.name.toUpperCase()}`, 12, { fill: DISTRICT_COLOUR[d.id], weight: "bold", anchor: "middle", halo: "#f7f2e8" });
    })
    .join("");
}

function routesLayer(bp: BannerholdBlueprint, v: View, labels: boolean): string {
  const order = ["national", "primary", "secondary", "service", "pedestrian"];
  const sorted = bp.routes.filter((r) => r.grade !== "elevated").sort((a, b) => order.indexOf(a.hierarchy) - order.indexOf(b.hierarchy));
  const under: string[] = [];
  const over: string[] = [];
  for (const r of sorted) {
    const d = polyPath(v, r.points, false);
    const w = Math.max(1.2, r.width * v.scale);
    const fill = ROUTE_HEX[r.surface] ?? "#b0a898";
    under.push(`<path d="${d}" fill="none" stroke="#3e352c" stroke-opacity="0.55" stroke-width="${f1(w + 1.6)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    over.push(`<path d="${d}" fill="none" stroke="${shadeHex(fill, 1.12)}" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (r.kind === "stair") over.push(`<path d="${d}" fill="none" stroke="#3e352c" stroke-opacity="0.55" stroke-width="${f1(w)}" stroke-dasharray="0.8 ${f1(Math.max(2, 0.32 * v.scale))}"/>`);
    if (r.covered) over.push(`<path d="${d}" fill="none" stroke="#2a2730" stroke-opacity="0.45" stroke-width="${f1(w * 0.35)}" stroke-dasharray="2 3"/>`);
  }
  return `<g>${under.join("")}${over.join("")}</g>${labels ? routeLabels(bp, v) : ""}`;
}

function routeLabels(bp: BannerholdBlueprint, v: View): string {
  const lab: string[] = [];
  {
    for (const r of bp.routes) {
      let best = -1;
      let bi = 1;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        if (!inView(v, a, 2) || !inView(v, b, 2)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > best) {
          best = len;
          bi = i;
        }
      }
      if (best * v.scale < 90) continue;
      const a = r.points[bi - 1];
      const b = r.points[bi];
      let ang = (Math.atan2(py(v, b[1]) - py(v, a[1]), px(v, b[0]) - px(v, a[0])) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      lab.push(text((px(v, a[0]) + px(v, b[0])) / 2, (py(v, a[1]) + py(v, b[1])) / 2 + 3.5, `${r.name} · ${r.width} m${r.grade === "elevated" ? " (elevated)" : ""}`, 9.5, { anchor: "middle", rotate: ang, fill: "#3a2f26", italic: true }));
    }
  }
  return `<g>${lab.join("")}</g>`;
}

/** Condition overlays, tower and gate labels on top of the massing. */
function fortificationNotes(bp: BannerholdBlueprint, v: View): string {
  const parts: string[] = [];
  for (const w of bp.walls) {
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const cond = w.segments.find((g) => s >= g.from && s < g.to)?.condition ?? "sound";
      if (cond === "sound" || cond === "new" || cond === "worn") continue;
      const a = w.points[s];
      const b = w.points[(s + 1) % n];
      parts.push(`<path d="M${pt(v, a)}L${pt(v, b)}" stroke="${CONDITION_HEX[cond]}" stroke-width="2.4" stroke-dasharray="${cond === "weathered" ? "7 4" : "3 3"}" stroke-linecap="butt"/>`);
    }
  }
  for (const t of bp.towers) {
    const cx = px(v, t.center[0]);
    const cy = py(v, t.center[1]);
    const r = Math.max(3, (t.width / 2) * v.scale);
    if (t.storyRole === "repaired-watchtower") parts.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r + 4)}" fill="none" stroke="#9a3f55" stroke-width="1.6" stroke-dasharray="4 2"/>`);
    parts.push(text(cx, cy - r - 6, `${t.name} · ${t.height} m${t.storyRole ? " · repaired" : ""}${t.condition === "ruinous" ? " · ruin" : ""}`, 9.5, { anchor: "middle", fill: "#3d3842" }));
  }
  for (const g of bp.gates) {
    const dir = bearingVector(g.outwardBearingDeg);
    const a: Vec2 = [g.position[0] - dir[1] * (g.width / 2), g.position[1] + dir[0] * (g.width / 2)];
    const b: Vec2 = [g.position[0] + dir[1] * (g.width / 2), g.position[1] - dir[0] * (g.width / 2)];
    parts.push(`<path d="M${pt(v, a)}L${pt(v, b)}" stroke="#c9a23a" stroke-width="3.2"/>`);
    const lp: Vec2 = [g.position[0] + dir[0] * 7, g.position[1] + dir[1] * 7];
    parts.push(text(px(v, lp[0]), py(v, lp[1]) + 4, g.name.toUpperCase(), 10, { anchor: "middle", weight: "bold", fill: "#6b4f10" }));
  }
  return parts.join("");
}

function buildingLabels(v: View, numbered: Numbered[]): string {
  const out: string[] = [];
  for (const nb of numbered) {
    const b = nb.b;
    const big = b.masses.reduce((a, m) => (m.width * m.depth > a.width * a.depth ? m : a), b.masses[0]);
    if (!inView(v, big.center)) continue;
    const cx = px(v, big.center[0]);
    const cy = py(v, big.center[1]);
    const label = `${nb.n}`;
    const hgt = `▲${f1(nb.topY - nb.floorY)}`;
    const w = 8 + label.length * 6;
    out.push(`<rect x="${f1(cx - w / 2)}" y="${f1(cy - 8)}" width="${f1(w)}" height="12" rx="3" fill="#f7f2e8" fill-opacity="0.9" stroke="${b.appearsAtHallTier !== undefined ? "#6f4f96" : INK}" stroke-width="0.7"/>`);
    out.push(text(cx, cy + 1.5, label, 9.5, { anchor: "middle", weight: "bold", halo: false }));
    out.push(text(cx, cy + 13, hgt, 8.5, { anchor: "middle", fill: "#2a2520" }));
  }
  return out.join("");
}

function landmarksLayer(bp: BannerholdBlueprint, v: View): string {
  const parts: string[] = [];
  for (const l of bp.landmarks) {
    const cx = px(v, l.pickCenter[0]);
    const cy = py(v, l.pickCenter[2]);
    parts.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(l.pickRadius * v.scale)}" fill="#c9a23a" fill-opacity="0.06" stroke="#9a7414" stroke-width="1.8" stroke-dasharray="9 5"/>`);
    parts.push(`<circle cx="${f1(px(v, l.anchor[0]))}" cy="${f1(py(v, l.anchor[2]))}" r="4" fill="#c9a23a" stroke="#4a3a10" stroke-width="1.2"/>`);
    const ly = cy - l.pickRadius * v.scale - 9;
    parts.push(text(cx, ly, `◆ ${l.label.toUpperCase()}`, 13, { anchor: "middle", weight: "bold", fill: "#5e4410" }));
    parts.push(text(cx, ly + 12, `pick r ${l.pickRadius} m · VR ${(l.pickRadius * bp.vr.displayScale * 100).toFixed(1)} cm · label y ${f1(l.anchor[1])}`, 9, { anchor: "middle", fill: "#5e4410" }));
  }
  return parts.join("");
}

function musterLayer(bp: BannerholdBlueprint, v: View): string {
  const m = bp.muster;
  const parts: string[] = [];
  parts.push(`<path d="${polyPath(v, shapePolygon(m.drillSquare), true)}" fill="none" stroke="#7b3fa0" stroke-width="1" stroke-dasharray="4 3"/>`);
  parts.push(text(px(v, m.drillSquare.center[0]), py(v, m.drillSquare.center[1] + m.drillSquare.depth / 2) + 11, "drill square", 9, { anchor: "middle", fill: "#7b3fa0" }));
  for (const fm of m.fileMarkers) {
    const x = px(v, fm.pose.position[0]);
    const y = py(v, fm.pose.position[2]);
    parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="5.2" fill="#f7f2e8" stroke="${INK}" stroke-width="1.1"/>`);
    parts.push(text(x, y + 3.3, fm.file, 8.5, { anchor: "middle", weight: "bold", halo: false }));
  }
  for (const s of m.levySlots) parts.push(`<circle cx="${f1(px(v, s.position[0]))}" cy="${f1(py(v, s.position[2]))}" r="2.6" fill="none" stroke="#7b3fa0" stroke-width="1.1"/>`);
  const sx = px(v, m.pawnStand.position[0]);
  const sy = py(v, m.pawnStand.position[2]);
  const star: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 8.5 : 3.8;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    star.push(`${f1(sx + r * Math.cos(a))},${f1(sy + r * Math.sin(a))}`);
  }
  parts.push(`<polygon points="${star.join(" ")}" fill="#c9a23a" stroke="${INK}" stroke-width="1"/>`);
  parts.push(text(sx + 11, sy + 14, "nominated Pawn stand", 9.5, { weight: "bold" }));
  const inj = bp.slots.injuredRest.position;
  parts.push(`<rect x="${f1(px(v, inj[0]) - 3)}" y="${f1(py(v, inj[2]) - 3)}" width="6" height="6" fill="#fff" stroke="#b3261e" stroke-width="1.2"/>`);
  parts.push(text(px(v, inj[0]) - 6, py(v, inj[2]) + 3, "injured rest", 8.5, { fill: "#b3261e", anchor: "end" }));
  const cap = bp.slots.captiveMarker.position;
  parts.push(`<path d="M${f1(px(v, cap[0]) - 3.5)},${f1(py(v, cap[2]) - 3.5)}l7,7m0,-7l-7,7" stroke="#9a3f55" stroke-width="1.6"/>`);
  return parts.join("");
}

function ceremonialLayer(bp: BannerholdBlueprint, v: View): string {
  const c = bp.ceremonial;
  const parts = [`<path d="${polyPath(v, shapePolygon(c.shape), true)}" fill="#c9a23a" fill-opacity="0.16" stroke="#9a7414" stroke-width="1.3"/>`];
  for (const n of bp.slots.honourNiches) parts.push(`<rect x="${f1(px(v, n.position[0]) - 2)}" y="${f1(py(v, n.position[2]) - 2)}" width="4" height="4" fill="#f7f2e8" stroke="#6b4f10" stroke-width="0.9"/>`);
  parts.push(text(px(v, c.centrepiece[0]), py(v, c.centrepiece[1] + c.shape.depth / 2) + 12, `${c.name} · ${bp.slots.honourNiches.length} honour niches`, 9, { anchor: "middle", fill: "#5e4410", weight: "bold" }));
  return parts.join("");
}

function expansionLayer(bp: BannerholdBlueprint, v: View): string {
  const parts: string[] = [];
  for (const e of bp.expansion) {
    parts.push(`<path d="${polyPath(v, e.polygon, true)}" fill="url(#hatch-exp)" stroke="#2f5f94" stroke-width="1.1" stroke-dasharray="6 3"/>`);
    const c = polygonLabelPoint(e.polygon);
    parts.push(text(px(v, c[0]), py(v, c[1]), `EXPANSION · ${e.unlocksAtHallTier === null ? "reserved" : `tier ${e.unlocksAtHallTier}`}`, 8.5, { anchor: "middle", fill: "#22497a", weight: "bold" }));
  }
  return parts.join("");
}

function corridorsLayer(bp: BannerholdBlueprint, v: View, labelSize = 9): string {
  const parts: string[] = [];
  for (const c of bp.viewCorridors) {
    const a: Vec2 = [c.from[0], c.from[2]];
    const b: Vec2 = [c.to[0], c.to[2]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Vec2 = [-dir[1], dir[0]];
    const poly: Vec2[] = [
      [a[0] + n[0] * c.halfWidth, a[1] + n[1] * c.halfWidth],
      [b[0] + n[0] * c.halfWidthFar, b[1] + n[1] * c.halfWidthFar],
      [b[0] - n[0] * c.halfWidthFar, b[1] - n[1] * c.halfWidthFar],
      [a[0] - n[0] * c.halfWidth, a[1] - n[1] * c.halfWidth],
    ];
    parts.push(`<path d="${polyPath(v, poly, true)}" fill="#2b88c9" fill-opacity="0.045" stroke="#2b88c9" stroke-opacity="0.35" stroke-width="0.7"/>`);
    parts.push(`<path d="M${pt(v, a)}L${pt(v, b)}" stroke="#1f6fb2" stroke-opacity="0.8" stroke-width="1.1" stroke-dasharray="10 4 2 4" marker-end="url(#arrow-blue)"/>`);
    // Label at the first in-view stretch.
    let s = 0;
    for (; s < len; s += 2) if (inView(v, [a[0] + dir[0] * s, a[1] + dir[1] * s], 20)) break;
    s = Math.min(len, s + 14);
    const lp: Vec2 = [a[0] + dir[0] * s, a[1] + dir[1] * s];
    if (!inView(v, lp, 4)) continue;
    let ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    parts.push(text(px(v, lp[0]), py(v, lp[1]) - 4, `view: ${c.name}`, labelSize, { anchor: "middle", rotate: ang, fill: "#1f5f9a", italic: true }));
  }
  return parts.join("");
}

function npcLayer(bp: BannerholdBlueprint, v: View): string {
  const parts: string[] = [];
  for (const a of bp.npcs) {
    const col = ROLE_COLOUR[a.role] ?? "#444";
    if (a.route.length === 1) {
      parts.push(`<circle cx="${f1(px(v, a.route[0][0]))}" cy="${f1(py(v, a.route[0][1]))}" r="3" fill="${col}"/>`);
      continue;
    }
    parts.push(`<path d="${polyPath(v, a.route, false)}" fill="none" stroke="${col}" stroke-opacity="0.85" stroke-width="1.7" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow-${a.role in ROLE_COLOUR ? a.role : "resident"})"/>`);
    parts.push(`<circle cx="${f1(px(v, a.route[0][0]))}" cy="${f1(py(v, a.route[0][1]))}" r="3" fill="${col}" stroke="#fff" stroke-width="0.8"/>`);
    let lab: Vec2 | null = null;
    for (let i = Math.floor(a.route.length / 2); i < a.route.length; i++) if (inView(v, a.route[i], 6)) {
      lab = a.route[i];
      break;
    }
    if (lab) parts.push(text(px(v, lab[0]) + 5, py(v, lab[1]) - 5, `${a.role}${a.count > 1 ? ` ×${a.count}` : ""}`, 8.5, { fill: col, weight: "bold" }));
  }
  return parts.join("");
}

function arrowDefs(): string {
  const roles = Object.keys(ROLE_COLOUR);
  return (
    `<pattern id="hatch-uc" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e9d9b8"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c07a1a" stroke-width="2"/></pattern>` +
    `<pattern id="hatch-exp" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#2f5f94" stroke-opacity="0.45" stroke-width="1.4"/></pattern>` +
    `<marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1f6fb2"/></marker>` +
    `<marker id="arrow-teal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#0f7a6a"/></marker>` +
    roles.map((r) => `<marker id="arrow-${r}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${ROLE_COLOUR[r]}"/></marker>`).join("")
  );
}

function hfov(vfovDeg: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI;
}

function camerasLayer(bp: BannerholdBlueprint, v: View, coneMax: number): string {
  const parts: string[] = [];
  for (const c of bp.cameras) {
    const p: Vec2 = [c.position[0], c.position[2]];
    const t: Vec2 = [c.target[0], c.target[2]];
    const bearing = vectorBearing(t[0] - p[0], t[1] - p[1]);
    const horiz = Math.hypot(t[0] - p[0], t[1] - p[1]);
    const half = hfov(c.fovDeg) / 2;
    const len = Math.min(horiz * 1.15, coneMax);
    const l = polar(bearing - half, len, p);
    const r = polar(bearing + half, len, p);
    const col = c.id === "establishing" ? "#b3261e" : c.id === "founding" ? "#9a7414" : c.id === "representative" ? "#7b3fa0" : "#2a2730";
    parts.push(`<path d="M${pt(v, p)}L${pt(v, l)}L${pt(v, r)}Z" fill="${col}" fill-opacity="0.06" stroke="${col}" stroke-opacity="0.55" stroke-width="0.9"/>`);
    parts.push(`<path d="M${pt(v, p)}L${pt(v, t)}" stroke="${col}" stroke-opacity="0.7" stroke-width="0.8" stroke-dasharray="2 3"/>`);
    parts.push(`<circle cx="${f1(px(v, t[0]))}" cy="${f1(py(v, t[1]))}" r="2.4" fill="none" stroke="${col}" stroke-width="1.1"/>`);
    let at: Vec2 | null = inView(v, p, 2) ? p : null;
    if (!at) {
      for (let i = 0; i <= 200; i++) {
        const q: Vec2 = [p[0] + ((t[0] - p[0]) * i) / 200, p[1] + ((t[1] - p[1]) * i) / 200];
        if (inView(v, q, 3)) {
          at = q;
          break;
        }
      }
    }
    if (!at) continue;
    parts.push(`<rect x="${f1(px(v, at[0]) - 5)}" y="${f1(py(v, at[1]) - 4)}" width="10" height="8" rx="1.5" fill="${col}"/>`);
    const tag = c.id.replace("landmark:", "");
    const where = at === p ? `y ${f1(c.position[1])}` : `from ${f1(horiz)} m, y ${f1(c.position[1])}`;
    parts.push(text(px(v, at[0]) + 8, py(v, at[1]) - 6, `CAM ${tag} · ${where} · ${c.fovDeg}°`, 9, { fill: col, weight: "bold" }));
  }
  return parts.join("");
}

function vrLayer(bp: BannerholdBlueprint, v: View, showViewer: boolean): string {
  const vr = bp.vr;
  const rect = vrDetailRect(bp);
  const parts = [`<path d="${polyPath(v, rect, true)}" fill="none" stroke="#0f7a6a" stroke-width="1.8" stroke-dasharray="12 4 3 4"/>`];
  parts.push(`<path d="${polyPath(v, vrRegion(bp), true)}" fill="none" stroke="#0f7a6a" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 5"/>`);
  const fwd = bearingVector(vr.viewerFacingBearingDeg);
  const right: Vec2 = [-fwd[1], fwd[0]];
  const la: Vec2 = [vr.displayCenter[0] + right[0] * (-vr.detailExtent.width / 2 + 2) + fwd[0] * (-vr.detailExtent.depth / 2 + 3), vr.displayCenter[1] + right[1] * (-vr.detailExtent.width / 2 + 2) + fwd[1] * (-vr.detailExtent.depth / 2 + 3)];
  if (inView(v, la)) parts.push(text(px(v, la[0]), py(v, la[1]), `VR detail ${vr.detailExtent.width} × ${vr.detailExtent.depth} m → ${(vr.detailExtent.width * vr.displayScale).toFixed(2)} × ${(vr.detailExtent.depth * vr.displayScale).toFixed(2)} m at 1:${Math.round(1 / vr.displayScale)}`, 9.5, { fill: "#0f7a6a", weight: "bold" }));
  if (showViewer) {
    const dist = vr.seated.viewerDistance / vr.displayScale;
    const eye: Vec2 = [vr.displayCenter[0] - fwd[0] * dist, vr.displayCenter[1] - fwd[1] * dist];
    let at = eye;
    if (!inView(v, eye, 8)) {
      for (let i = 0; i <= 200; i++) {
        const q: Vec2 = [eye[0] + (vr.displayCenter[0] - eye[0]) * (i / 200), eye[1] + (vr.displayCenter[1] - eye[1]) * (i / 200)];
        if (inView(v, q, 10)) {
          at = q;
          break;
        }
      }
    }
    parts.push(`<path d="M${pt(v, at)}L${pt(v, vr.displayCenter)}" stroke="#0f7a6a" stroke-width="1.3" marker-end="url(#arrow-teal)"/>`);
    parts.push(`<circle cx="${f1(px(v, at[0]))}" cy="${f1(py(v, at[1]))}" r="6.5" fill="#0f7a6a"/><circle cx="${f1(px(v, at[0]))}" cy="${f1(py(v, at[1]))}" r="2.3" fill="#fff"/>`);
    parts.push(text(px(v, at[0]) + 10, py(v, at[1]) + 4, `VR viewer${at === eye ? "" : ` (${f1(dist)} m out)`} · seated eye ${vr.seated.eyeHeight} m, ${vr.seated.viewerDistance} m from centre · facing ${vr.viewerFacingBearingDeg}°`, 9.5, { fill: "#0f7a6a", weight: "bold" }));
  }
  return parts.join("");
}

function storyLayer(bp: BannerholdBlueprint, v: View): string {
  return bp.story
    .map((s, i) => {
      if (!inView(v, s.position)) return "";
      const x = px(v, s.position[0]);
      const y = py(v, s.position[1]);
      return `<path d="M${f1(x)},${f1(y - 7)}L${f1(x + 7)},${f1(y)}L${f1(x)},${f1(y + 7)}L${f1(x - 7)},${f1(y)}Z" fill="#f7f2e8" stroke="#94374f" stroke-width="1.3"/>${text(x, y + 3.2, `S${i + 1}`, 7.5, { anchor: "middle", weight: "bold", fill: "#94374f", halo: false })}`;
    })
    .join("");
}

function dressingLayer(bp: BannerholdBlueprint, v: View): string {
  const colour: Record<string, string> = { well: "#2f5f94", "cooking-fire": "#d9661a", brazier: "#d9661a", anvil: "#2a2730", "quench-trough": "#2f5f94", "notice-board": "#9a7414", "boundary-stone": "#6b6b6b", crane: "#c07a1a", "standing-stone": "#5a5a5a" };
  return bp.dressing.map((d) => `<circle cx="${f1(px(v, d.position[0]))}" cy="${f1(py(v, d.position[1]))}" r="2.2" fill="${colour[d.kind] ?? "#7a6a5a"}" stroke="#fff" stroke-width="0.6"/>`).join("");
}

function gridLayer(v: View, step: number, majorEvery: number, labels: boolean): string {
  const parts: string[] = [];
  const x0 = Math.ceil(v.minX / step) * step;
  const z0 = Math.ceil(v.minZ / step) * step;
  for (let x = x0; x <= v.maxX; x += step) {
    const major = Math.round(x / step) % majorEvery === 0;
    parts.push(`<line x1="${f1(px(v, x))}" y1="${f1(v.oy)}" x2="${f1(px(v, x))}" y2="${f1(v.oy + viewH(v))}" stroke="#2a2730" stroke-opacity="${major ? 0.28 : 0.1}" stroke-width="${major ? 0.9 : 0.5}"/>`);
    if (labels && major) parts.push(text(px(v, x), v.oy + 12, `x ${x}`, 9, { anchor: "middle", fill: "#4a4640" }));
  }
  for (let z = z0; z <= v.maxZ; z += step) {
    const major = Math.round(z / step) % majorEvery === 0;
    parts.push(`<line x1="${f1(v.ox)}" y1="${f1(py(v, z))}" x2="${f1(v.ox + viewW(v))}" y2="${f1(py(v, z))}" stroke="#2a2730" stroke-opacity="${major ? 0.28 : 0.1}" stroke-width="${major ? 0.9 : 0.5}"/>`);
    if (labels && major) parts.push(text(v.ox + 4, py(v, z) - 3, `z ${z}`, 9, { fill: "#4a4640" }));
  }
  if (inView(v, [0, 0])) parts.push(`<path d="M${f1(px(v, 0) - 8)},${f1(py(v, 0))}h16M${f1(px(v, 0))},${f1(py(v, 0) - 8)}v16" stroke="#b3261e" stroke-width="1.4"/>${text(px(v, 0) + 6, py(v, 0) + 12, "datum (0,0,0)", 9, { fill: "#b3261e" })}`);
  return parts.join("");
}

function scaleBar(v: View, x: number, y: number, metres: number): string {
  const w = metres * v.scale;
  const seg = metres / 5;
  let s = "";
  for (let i = 0; i < 5; i++) s += `<rect x="${f1(x + i * seg * v.scale)}" y="${f1(y)}" width="${f1(seg * v.scale)}" height="7" fill="${i % 2 ? PAPER : INK}" stroke="${INK}" stroke-width="0.8"/>`;
  return `${s}${text(x, y - 4, "0", 9.5)}${text(x + w, y - 4, `${metres} m`, 9.5, { anchor: "middle" })}${text(x + w / 2, y + 20, "grid: 10 m squares", 9, { anchor: "middle", fill: "#4a4640" })}`;
}

function northArrow(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><circle r="26" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><path d="M0,-22L8,8L0,2L-8,8Z" fill="${INK}"/><path d="M0,22L8,8L0,2L-8,8Z" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/>${text(0, -31, "N (−Z)", 11, { anchor: "middle", weight: "bold" })}${text(31, 4, "E (+X)", 9, { fill: "#4a4640" })}</g>`;
}

// ---------------------------------------------------------------------------
// Side panel: title block, legend, schedule
// ---------------------------------------------------------------------------

function titleBlock(bp: BannerholdBlueprint, x: number, y: number, w: number, subtitle: string): string {
  const status = bp.status === "production-default" ? "Reversible production default — not a canonical or launch choice" : "First-pass layout for the shared pipeline";
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="112" rx="3" fill="${INK}"/>`,
    text(x + 18, y + 34, `THE BANNERHOLD · ${bp.nationId.toUpperCase()}`, 24, { fill: PAPER, weight: "bold", family: SERIF, halo: false }),
    text(x + 18, y + 58, `${bp.siteName} — ${subtitle}`, 14, { fill: "#e6dccb", halo: false }),
    text(x + 18, y + 80, status, 12, { fill: "#d9b55a", halo: false }),
    text(x + 18, y + 99, "Right-handed, Y-up, metres · +X east · +Z south · origin = settlement datum · drawn from the blueprint data · names are working placeholders", 10, { fill: "#cfc6b6", halo: false }),
  ].join("");
}

function legend(x: number, y: number): { svg: string; height: number } {
  const rows: [string, string][] = [
    ["massing", "roofs lit by the nation's sun; shadows cast schematically"],
    ["condition-weathered", "wall weathered (brown dashes)"],
    ["condition-damaged", "wall damaged / ruinous (red dashes)"],
    ["dev", "development building (appears at a hall tier)"],
    ["exp", "expansion zone (tier or reserved)"],
    ["pick", "landmark pick radius (gold) · label anchor"],
    ["file", "file marker a–h · levy slot · ✕ captive marker"],
    ["star", "nominated Pawn stand"],
    ["cam", "camera + horizontal view cone"],
    ["corr", "view corridor"],
    ["npc", "NPC route (colour = role), dot = loop start"],
    ["vr", "VR detail region · skirt · seated viewer"],
    ["story", "storytelling location S#"],
    ["label", "building number · ▲ height above floor (m)"],
  ];
  const parts: string[] = [text(x, y, "LEGEND", 12, { weight: "bold" })];
  rows.forEach(([k, label], i) => {
    const yy = y + 18 + i * 19;
    let sym = "";
    switch (k) {
      case "massing": sym = `<rect x="${x}" y="${yy - 9}" width="14" height="12" fill="#5b5f68"/><rect x="${x}" y="${yy - 9}" width="7" height="12" fill="#8a8e96"/>`; break;
      case "condition-weathered": sym = `<line x1="${x}" y1="${yy - 3}" x2="${x + 18}" y2="${yy - 3}" stroke="${CONDITION_HEX.weathered}" stroke-width="2.4" stroke-dasharray="7 4"/>`; break;
      case "condition-damaged": sym = `<line x1="${x}" y1="${yy - 3}" x2="${x + 18}" y2="${yy - 3}" stroke="${CONDITION_HEX.damaged}" stroke-width="2.4" stroke-dasharray="3 3"/>`; break;
      case "dev": sym = `<rect x="${x}" y="${yy - 9}" width="14" height="12" fill="none" stroke="#6f4f96" stroke-width="1.4" stroke-dasharray="4 2"/>`; break;
      case "exp": sym = `<rect x="${x}" y="${yy - 9}" width="14" height="12" fill="url(#hatch-exp)" stroke="#2f5f94"/>`; break;
      case "pick": sym = `<circle cx="${x + 7}" cy="${yy - 3}" r="6" fill="none" stroke="#9a7414" stroke-dasharray="3 2"/><circle cx="${x + 7}" cy="${yy - 3}" r="2" fill="#c9a23a"/>`; break;
      case "file": sym = `<circle cx="${x + 5}" cy="${yy - 3}" r="4.5" fill="${PAPER}" stroke="${INK}"/><circle cx="${x + 15}" cy="${yy - 3}" r="2.5" fill="none" stroke="#7b3fa0"/>`; break;
      case "star": sym = `<circle cx="${x + 7}" cy="${yy - 3}" r="5" fill="#c9a23a" stroke="${INK}"/>`; break;
      case "cam": sym = `<path d="M${x},${yy - 3}L${x + 18},${yy - 10}L${x + 18},${yy + 4}Z" fill="#2a2730" fill-opacity="0.1" stroke="#2a2730"/><rect x="${x - 2}" y="${yy - 7}" width="8" height="7" fill="#2a2730"/>`; break;
      case "corr": sym = `<line x1="${x}" y1="${yy - 3}" x2="${x + 18}" y2="${yy - 3}" stroke="#1f6fb2" stroke-dasharray="6 3 2 3"/>`; break;
      case "npc": sym = `<line x1="${x}" y1="${yy - 3}" x2="${x + 18}" y2="${yy - 3}" stroke="#b3261e" stroke-width="1.7" stroke-dasharray="5 3"/><circle cx="${x}" cy="${yy - 3}" r="2.6" fill="#b3261e"/>`; break;
      case "vr": sym = `<rect x="${x}" y="${yy - 9}" width="16" height="12" fill="none" stroke="#0f7a6a" stroke-dasharray="6 2 2 2"/><circle cx="${x + 8}" cy="${yy - 3}" r="3" fill="#0f7a6a"/>`; break;
      case "story": sym = `<path d="M${x + 7},${yy - 10}L${x + 14},${yy - 3}L${x + 7},${yy + 4}L${x},${yy - 3}Z" fill="${PAPER}" stroke="#94374f"/>`; break;
      case "label": sym = `<rect x="${x}" y="${yy - 10}" width="16" height="11" rx="3" fill="#f7f2e8" stroke="${INK}" stroke-width="0.7"/>`; break;
    }
    parts.push(sym, text(x + 28, yy + 1, label, 10.5, { halo: false }));
  });
  return { svg: parts.join(""), height: 22 + rows.length * 19 };
}

function scheduleTable(numbered: Numbered[], x: number, y: number, w: number, maxRows: number): { svg: string; height: number } {
  const cols = [0, 26, 270, 300, 340, 432, 486, 588];
  const head = ["#", "building", "dist", "st.", "eave / ridge", "floor y", "condition", "quality"];
  const parts: string[] = [text(x, y, "BUILDING SCHEDULE (numbers on the plan)", 12, { weight: "bold" })];
  head.forEach((h, i) => parts.push(text(x + cols[i], y + 20, h, 9.5, { weight: "bold", fill: "#4a4640", halo: false })));
  numbered.slice(0, maxRows).forEach((nb, r) => {
    const yy = y + 36 + r * 15;
    if (r % 2 === 0) parts.push(`<rect x="${x - 4}" y="${yy - 11}" width="${w}" height="15" fill="#e9e1d1" fill-opacity="0.6"/>`);
    const m = nb.b.masses[0];
    const tall = nb.b.masses.reduce((a, q) => Math.max(a, (q.baseOffset ?? 0) + q.ridgeHeight), 0);
    const cells = [`${nb.n}`, nb.b.name.length > 40 ? `${nb.b.name.slice(0, 39)}…` : nb.b.name, nb.b.district, `${m.storeys}`, `${f1(m.eaveHeight)} / ${f1(tall)}`, f1(nb.floorY), nb.b.age.condition, nb.b.quality];
    cells.forEach((c, i) => parts.push(text(x + cols[i], yy, c, 9.5, { halo: false })));
  });
  return { svg: parts.join(""), height: 44 + Math.min(maxRows, numbered.length) * 15 };
}

function wrapText(s: string, max: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if ((cur + " " + wd).trim().length > max) {
      lines.push(cur.trim());
      cur = wd;
    } else cur += " " + wd;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function storyList(bp: BannerholdBlueprint, x: number, y: number, maxChars: number): { svg: string; height: number } {
  const parts: string[] = [text(x, y, "STORYTELLING LOCATIONS", 12, { weight: "bold" })];
  let yy = y + 18;
  bp.story.forEach((s, i) => {
    wrapText(`S${i + 1} ${s.kind}: ${s.description}`, maxChars).forEach((ln, j) => {
      parts.push(text(x + (j ? 18 : 0), yy, ln, 10, { halo: false }));
      yy += 13;
    });
  });
  return { svg: parts.join(""), height: yy - y };
}

function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${PAPER}"/>${body}</svg>`;
}

function boundsOf(points: readonly Vec2[], margin: number): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  return [Math.floor((minX - margin) / 5) * 5, Math.floor((minZ - margin) / 5) * 5, Math.ceil((maxX + margin) / 5) * 5, Math.ceil((maxZ + margin) / 5) * 5];
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function planMap(bp: BannerholdBlueprint, T: TerrainSampler, numbered: Numbered[]): string {
  const [minX, minZ, maxX, maxZ] = boundsOf(bp.settlementBoundary, 14);
  const mapW = 1800;
  const v = makeView(minX, minZ, maxX, maxZ, mapW, 40, 40);
  const mapH = viewH(v);
  const massing = planMassing(bp, T, v, { showDevelopment: true });
  const sideX = 40 + mapW + 34;
  const leg = legend(sideX, 186);
  const sched = scheduleTable(numbered, sideX, 186 + leg.height + 22, 740, 60);
  const story = storyList(bp, sideX, 186 + leg.height + 22 + sched.height + 24, 118);
  const height = Math.max(mapH + 120, 186 + leg.height + sched.height + story.height + 90);
  const body = [
    `<defs>${arrowDefs()}${clipRect("clip-plan", v)}</defs>`,
    `<g clip-path="url(#clip-plan)">`,
    terrainImage(bp, T, v, 0.5, "surface"),
    contours(T, v, 1, 1, 5, "#2a2018", 0.75),
    fieldsLayer(bp, v),
    waterLayer(bp, v),
    routesLayer(bp, v, false),
    vegetationLayer(bp, v, 900),
    massing.shadows,
    massing.tops,
    massing.development,
    gridLayer(v, 10, 5, true),
    districtsLayer(bp, v),
    expansionLayer(bp, v),
    ceremonialLayer(bp, v),
    fortificationNotes(bp, v),
    routeLabels(bp, v),
    corridorsLayer(bp, v),
    npcLayer(bp, v),
    dressingLayer(bp, v),
    musterLayer(bp, v),
    landmarksLayer(bp, v),
    buildingLabels(v, numbered),
    camerasLayer(bp, v, 70),
    vrLayer(bp, v, true),
    storyLayer(bp, v),
    districtLabels(bp, v),
    `</g>`,
    `<rect x="${v.ox}" y="${v.oy}" width="${f1(mapW)}" height="${f1(mapH)}" fill="none" stroke="${INK}" stroke-width="2"/>`,
    scaleBar(v, v.ox + 20, v.oy + mapH + 30, 50),
    northArrow(v.ox + mapW - 48, v.oy + 58),
    titleBlock(bp, sideX, 40, 740, "annotated settlement plan (10 m grid)"),
    leg.svg,
    sched.svg,
    story.svg,
  ];
  return svgDoc(sideX + 740 + 40, Math.ceil(height), body.join(""));
}

function siteMap(bp: BannerholdBlueprint, T: TerrainSampler, numbered: Numbered[]): string {
  const e = bp.terrain.extents;
  const mapW = 1800;
  const v = makeView(e.minX, e.minZ, e.maxX, e.maxZ, mapW, 40, 40);
  const mapH = viewH(v);
  const massing = planMassing(bp, T, v, { showDevelopment: false });
  const arrows: string[] = [];
  for (const p of bp.outer.places) {
    const dir = bearingVector(p.bearingDeg);
    const cx = (e.minX + e.maxX) / 2;
    const cz = (e.minZ + e.maxZ) / 2;
    let tMax = Infinity;
    if (dir[0] > 1e-6) tMax = Math.min(tMax, (e.maxX - cx) / dir[0]);
    if (dir[0] < -1e-6) tMax = Math.min(tMax, (e.minX - cx) / dir[0]);
    if (dir[1] > 1e-6) tMax = Math.min(tMax, (e.maxZ - cz) / dir[1]);
    if (dir[1] < -1e-6) tMax = Math.min(tMax, (e.minZ - cz) / dir[1]);
    const tip: Vec2 = [cx + dir[0] * (tMax - 6), cz + dir[1] * (tMax - 6)];
    const tail: Vec2 = [cx + dir[0] * (tMax - 40), cz + dir[1] * (tMax - 40)];
    const col = p.kind === "capital" ? "#6f4f96" : p.kind === "frontier" ? "#94374f" : p.kind === "allied-seat" ? "#2f5f94" : "#4a4640";
    arrows.push(`<path d="M${pt(v, tail)}L${pt(v, tip)}" stroke="${col}" stroke-width="2.2" marker-end="url(#arrow-blue)"/>`);
    arrows.push(text(px(v, tail[0]) - dir[0] * 8, py(v, tail[1]) - dir[1] * 8 + 4, `${p.name} · ${(p.distance / 1000).toFixed(1)} km · ${f1(p.bearingDeg)}°`, 10, { anchor: dir[0] < -0.3 ? "start" : dir[0] > 0.3 ? "end" : "middle", fill: col, weight: "bold" }));
  }
  const outposts = bp.outer.outposts
    .filter((o) => inView(v, o.position))
    .map((o) => `<rect x="${f1(px(v, o.position[0]) - 4)}" y="${f1(py(v, o.position[1]) - 4)}" width="8" height="8" fill="#94374f"/>${text(px(v, o.position[0]) + 7, py(v, o.position[1]) + 4, o.name, 10, { fill: "#6a2338" })}`)
    .join("");
  const sideX = 40 + mapW + 34;
  const info: string[] = [titleBlock(bp, sideX, 40, 740, `site and outer territory (${e.maxX - e.minX} × ${e.maxZ - e.minZ} m modelled terrain)`)];
  let yy = 186;
  const para = (title: string, body: string) => {
    info.push(text(sideX, yy, title, 12, { weight: "bold" }));
    yy += 16;
    for (const ln of wrapText(body, 120)) {
      info.push(text(sideX, yy, ln, 10.5, { halo: false }));
      yy += 13.5;
    }
    yy += 10;
  };
  para("TERRAIN LOGIC", bp.terrain.logic);
  para("GREATER NATION (bearing from the datum, distance)", bp.outer.places.map((p) => `${p.name} — ${p.kind}${p.frontierNation ? ` toward ${p.frontierNation}` : ""}: ${f1(p.bearingDeg)}°, ${(p.distance / 1000).toFixed(1)} km, silhouette ${p.silhouetteHeight} m`).join(" · "));
  para("OUTPOSTS", bp.outer.outposts.map((o) => `${o.name} (${o.kind}, ${o.owner}) at [${o.position[0]}, ${o.position[1]}]`).join(" · "));
  para("ATMOSPHERE", `${bp.atmosphere.timeOfDay}. Key light from ${bp.atmosphere.sun.bearingDeg}° at ${bp.atmosphere.sun.elevationDeg}° (${bp.atmosphere.sun.disc}); fog ${bp.atmosphere.fog.near}–${bp.atmosphere.fog.far} m; wind toward ${bp.atmosphere.wind.towardBearingDeg}° at ${bp.atmosphere.wind.speed} m/s.`);
  para("VR STAGING", `Scale 1:${Math.round(1 / bp.vr.displayScale)}; detail ${bp.vr.detailExtent.width} × ${bp.vr.detailExtent.depth} m (${(bp.vr.detailExtent.width * bp.vr.displayScale).toFixed(2)} × ${(bp.vr.detailExtent.depth * bp.vr.displayScale).toFixed(2)} m); skirt far ${bp.vr.skirtMargins.far} m, lateral ${bp.vr.skirtMargins.lateral} m, near ${bp.vr.skirtMargins.near} m. Seated eye ${bp.vr.seated.eyeHeight} m, surface ${bp.vr.seated.surfaceHeight} m, ${bp.vr.seated.viewerDistance} m to centre; standing ${bp.vr.standing.eyeHeight} / ${bp.vr.standing.surfaceHeight} / ${bp.vr.standing.viewerDistance} m. Turntable ±${bp.vr.rotation.yawLimitDeg}° in ${bp.vr.rotation.snapStepDeg}° steps; poke ${bp.vr.reach.pokeMax} m, ray ${bp.vr.reach.rayMax} m, smallest target radius ${(bp.vr.reach.minTargetRadius * 100).toFixed(1)} cm.`);
  const body = [
    `<defs>${arrowDefs()}${clipRect("clip-site", v)}</defs>`,
    `<g clip-path="url(#clip-site)">`,
    terrainImage(bp, T, v, 1, "surface"),
    contours(T, v, 2, 2, 5, "#2a2018", 0.8),
    fieldsLayer(bp, v),
    waterLayer(bp, v),
    routesLayer(bp, v, true),
    vegetationLayer(bp, v, 2600),
    massing.shadows,
    massing.tops,
    gridLayer(v, 10, 5, true),
    districtsLayer(bp, v),
    camerasLayer(bp, v, 160),
    vrLayer(bp, v, true),
    outposts,
    arrows.join(""),
    `</g>`,
    `<rect x="${v.ox}" y="${v.oy}" width="${f1(mapW)}" height="${f1(mapH)}" fill="none" stroke="${INK}" stroke-width="2"/>`,
    scaleBar(v, v.ox + 20, v.oy + mapH + 30, 100),
    northArrow(v.ox + mapW - 48, v.oy + 58),
    info.join(""),
  ];
  void numbered;
  return svgDoc(sideX + 740 + 40, Math.ceil(Math.max(mapH + 110, yy + 40)), body.join(""));
}

interface Section {
  label: string;
  points: Vec2[];
}

/** A–A′ climbs from outside the main gate through the muster ground to the Banner Hall; B–B′ crosses the holding through the War Record. */
function sectionsFor(bp: BannerholdBlueprint): Section[] {
  const d = (id: string): Vec2 => bp.destinations.find((x) => x.id === id)?.position ?? [0, 0];
  const gate = d("gate");
  const muster: Vec2 = [bp.muster.pawnStand.position[0], bp.muster.pawnStand.position[2]];
  const hall = bp.buildings.find((b) => b.landmark === "banner-hall");
  const hallC = hall ? hall.masses[0].center : d("manor");
  const dir: Vec2 = [hallC[0] - muster[0], hallC[1] - muster[1]];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const beyond: Vec2 = [hallC[0] + (dir[0] / len) * 40, hallC[1] + (dir[1] / len) * 40];
  const out: Vec2 = [gate[0] - muster[0], gate[1] - muster[1]];
  const ol = Math.hypot(out[0], out[1]) || 1;
  const before: Vec2 = [gate[0] + (out[0] / ol) * 30, gate[1] + (out[1] / ol) * 30];
  const rec = bp.buildings.find((b) => b.landmark === "war-record");
  const rc = rec ? rec.masses[0].center : d("archive");
  const [minX, minZ, maxX, maxZ] = boundsOf(bp.settlementBoundary, 10);
  // B runs across the longer axis of the holding through the War Record.
  const across: Section = maxX - minX >= maxZ - minZ ? { label: "B", points: [[minX, rc[1]], [maxX, rc[1]]] } : { label: "B", points: [[rc[0], minZ], [rc[0], maxZ]] };
  return [{ label: "A", points: [before, gate, muster, hallC, beyond] }, across];
}

function sectionSvg(bp: BannerholdBlueprint, T: TerrainSampler, numbered: Numbered[], sec: Section, x0: number, y0: number, width: number, height: number): string {
  const samples: { s: number; p: Vec2 }[] = [];
  let acc = 0;
  for (let i = 1; i < sec.points.length; i++) {
    const a = sec.points[i - 1];
    const b = sec.points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) samples.push({ s: acc + (len * k) / n, p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] });
    acc += len;
  }
  const total = acc;
  let lo = Infinity;
  let hi = -Infinity;
  for (const sm of samples) {
    const h = T.height(sm.p[0], sm.p[1]);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  let top = hi;
  for (const nb of numbered) top = Math.max(top, nb.topY);
  lo = Math.floor(lo - 4);
  top = Math.ceil(top + 4);
  const scale = Math.min(width / total, height / (top - lo));
  const X = (s: number) => x0 + s * scale;
  const Y = (h: number) => y0 + height - (h - lo) * scale;
  const parts: string[] = [];
  parts.push(`<rect x="${x0}" y="${f1(Y(top))}" width="${f1(total * scale)}" height="${f1((top - lo) * scale)}" fill="#ece5d4" stroke="#bdb6a8"/>`);
  for (let h = Math.ceil(lo / 5) * 5; h <= top; h += 5) {
    parts.push(`<line x1="${x0}" y1="${f1(Y(h))}" x2="${f1(x0 + total * scale)}" y2="${f1(Y(h))}" stroke="#2a2730" stroke-opacity="${h === 0 ? 0.5 : 0.12}" stroke-width="${h === 0 ? 1.2 : 0.6}"/>`);
    parts.push(text(x0 - 6, Y(h) + 3, `${h} m`, 9, { anchor: "end", fill: "#4a4640", halo: false }));
  }
  for (const nb of numbered) {
    if (nb.b.appearsAtHallTier !== undefined) continue;
    for (const m of nb.b.masses) {
      let s0 = Infinity;
      let s1 = -Infinity;
      const poly = massPolygon(m);
      for (const sm of samples) {
        if (pointInPolygon(sm.p, poly)) {
          s0 = Math.min(s0, sm.s);
          s1 = Math.max(s1, sm.s);
        }
      }
      if (!(s1 > s0)) continue;
      const base = nb.floorY + (m.baseOffset ?? 0);
      const eave = base + m.eaveHeight;
      const ridge = base + m.ridgeHeight;
      const fill = nb.b.unfinished ? "url(#hatch-uc)" : shadeHex(materialHex(m.wallMaterial), 1.05);
      const foot = (m.baseOffset ?? 0) >= 2.5 ? base : Math.min(base, T.height(m.center[0], m.center[1]) - 0.5);
      const flat = m.roof.form === "flat" || m.roof.form === "flat-parapet" || m.roof.form === "terrace" || m.roof.form === "none" || m.roof.form === "open-frame" || m.roof.form === "setback-crown";
      const roofPath = flat ? `L${f1(X(s0))},${f1(Y(ridge))}L${f1(X(s1))},${f1(Y(ridge))}` : `L${f1(X(s0))},${f1(Y(eave))}L${f1(X((s0 + s1) / 2))},${f1(Y(ridge))}L${f1(X(s1))},${f1(Y(eave))}`;
      parts.push(`<path d="M${f1(X(s0))},${f1(Y(foot))}${roofPath}L${f1(X(s1))},${f1(Y(foot))}Z" fill="${fill}" fill-opacity="0.92" stroke="${CONDITION_HEX[nb.b.age.condition]}" stroke-width="1"/>`);
      if (m === nb.b.masses[0] || m.role === "keep" || m.role === "tower") parts.push(text(X((s0 + s1) / 2), Y(ridge) - 4, `${nb.n}`, 9.5, { anchor: "middle", weight: "bold" }));
    }
  }
  for (const w of bp.walls) {
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = w.points[k];
      const b = w.points[(k + 1) % n];
      for (let i = 1; i < samples.length; i++) {
        const p = samples[i - 1].p;
        const q = samples[i].p;
        const den = (b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - a[0]) * (q[1] - p[1]) - (p[1] - a[1]) * (q[0] - p[0])) / den;
        const u = ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const g = T.height(p[0], p[1]);
        parts.push(`<rect x="${f1(X(samples[i - 1].s) - Math.max(1.5, (w.thickness * scale) / 2))}" y="${f1(Y(g + w.height))}" width="${f1(Math.max(3, w.thickness * scale))}" height="${f1(w.height * scale)}" fill="#3d3842"/>`);
        break;
      }
    }
  }
  for (const r of bp.routes) {
    if (r.grade !== "elevated" || !r.deckY) continue;
    for (let i = 1; i < samples.length; i++) {
      const p = samples[i].p;
      if (distanceToPolyline(p, r.points) > r.width / 2) continue;
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < r.points.length; k++) {
        const dd = Math.hypot(r.points[k][0] - p[0], r.points[k][1] - p[1]);
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      parts.push(`<circle cx="${f1(X(samples[i].s))}" cy="${f1(Y(r.deckY[best]))}" r="1.6" fill="#6a5a3a"/>`);
    }
  }
  const prof = samples.map((sm) => `${f1(X(sm.s))},${f1(Y(T.height(sm.p[0], sm.p[1])))}`);
  parts.push(`<path d="M${f1(X(0))},${f1(Y(lo))}L${prof.join("L")}L${f1(X(total))},${f1(Y(lo))}Z" fill="#8a7a62" fill-opacity="0.88" stroke="#3a2f26" stroke-width="1.4"/>`);
  for (const sm of samples) {
    const wl = T.waterLevel(sm.p[0], sm.p[1]);
    if (wl === wl && wl > T.height(sm.p[0], sm.p[1])) parts.push(`<rect x="${f1(X(sm.s))}" y="${f1(Y(wl))}" width="${f1(0.5 * scale + 0.5)}" height="${f1((wl - T.height(sm.p[0], sm.p[1])) * scale)}" fill="#5f8fb8"/>`);
  }
  parts.push(text(x0, Y(top) - 8, `SECTION ${sec.label}–${sec.label}′ · true scale (no vertical exaggeration) · ${f1(total)} m long`, 12, { weight: "bold" }));
  parts.push(text(X(0), Y(lo) + 15, sec.label, 13, { weight: "bold", fill: "#b3261e" }));
  parts.push(text(X(total), Y(lo) + 15, `${sec.label}′`, 13, { weight: "bold", fill: "#b3261e", anchor: "end" }));
  return parts.join("");
}

function elevationMap(bp: BannerholdBlueprint, T: TerrainSampler, numbered: Numbered[]): string {
  const [minX, minZ, maxX, maxZ] = boundsOf(bp.settlementBoundary, 24);
  const mapW = 1700;
  const v = makeView(minX, minZ, maxX, maxZ, mapW, 40, 40);
  const mapH = viewH(v);
  const secs = sectionsFor(bp);
  const spots = numbered
    .filter((nb) => nb.b.district !== "G" && inView(v, nb.b.masses[0].center))
    .map((nb) => {
      const c = nb.b.masses[0].center;
      return `<circle cx="${f1(px(v, c[0]))}" cy="${f1(py(v, c[1]))}" r="2.4" fill="${INK}"/>${text(px(v, c[0]) + 4, py(v, c[1]) - 3, `${nb.n}: ${f1(nb.floorY)}`, 9.5, { weight: "bold" })}`;
    })
    .join("");
  const outlines = numbered
    .filter((nb) => nb.b.appearsAtHallTier === undefined)
    .map((nb) => nb.b.masses.map((m) => `<path d="${polyPath(v, massPolygon(m), true)}" fill="${PAPER}" fill-opacity="0.35" stroke="${INK}" stroke-width="0.8"/>`).join(""))
    .join("");
  const secLines = secs.map((s) => `<path d="${polyPath(v, s.points, false)}" fill="none" stroke="#b3261e" stroke-width="2" stroke-dasharray="14 5 3 5"/>${text(px(v, s.points[0][0]) + 6, py(v, s.points[0][1]) - 6, s.label, 14, { weight: "bold", fill: "#b3261e" })}${text(px(v, s.points[s.points.length - 1][0]) - 6, py(v, s.points[s.points.length - 1][1]) - 6, `${s.label}′`, 14, { weight: "bold", fill: "#b3261e", anchor: "end" })}`).join("");
  let lo = Infinity;
  let hi = -Infinity;
  for (let z = minZ; z <= maxZ; z += 2) for (let x = minX; x <= maxX; x += 2) {
    const h = T.height(x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const sideX = 40 + mapW + 34;
  const ramp: string[] = [text(sideX, 190, `ELEVATION (m) ${f1(lo)} … ${f1(hi)}`, 12, { weight: "bold" })];
  for (let i = 0; i <= 10; i++) {
    const c = hypso(i / 10);
    ramp.push(`<rect x="${sideX + i * 40}" y="200" width="40" height="16" fill="rgb(${c.map((q) => Math.round(q)).join(",")})"/>`);
    if (i % 2 === 0) ramp.push(text(sideX + i * 40, 232, f1(lo + ((hi - lo) * i) / 10), 9.5, { halo: false }));
  }
  ramp.push(text(sideX, 256, "Contours every 1 m (index every 5 m). Spot heights: resolved floor elevation per building (#: y).", 10.5, { halo: false }));
  const platformNotes = bp.terrain.features
    .filter((f) => f.kind === "platform" || f.kind === "ramp")
    .map((f) => (f.kind === "platform" ? `${f.id}: level ${f.elevation} m, ${f.edge} edge` : `${f.id}: graded ${f.startElevation} → ${f.endElevation} m`));
  let ny = 284;
  ramp.push(text(sideX, ny, "LEVELLED AND GRADED GROUND", 12, { weight: "bold" }));
  for (const nline of platformNotes) {
    ny += 15;
    ramp.push(text(sideX, ny, nline, 10.5, { halo: false }));
  }
  const secH = 300;
  const secY = 40 + mapH + 80;
  const body = [
    `<defs>${arrowDefs()}${clipRect("clip-elev", v)}</defs>`,
    `<g clip-path="url(#clip-elev)">`,
    terrainImage(bp, T, v, 0.5, "hypsometric", [lo, hi]),
    contours(T, v, 1, 1, 5, "#2a2018"),
    gridLayer(v, 10, 5, true),
    waterLayer(bp, v),
    outlines,
    fortificationNotes(bp, v),
    spots,
    secLines,
    `</g>`,
    `<rect x="${v.ox}" y="${v.oy}" width="${f1(mapW)}" height="${f1(mapH)}" fill="none" stroke="${INK}" stroke-width="2"/>`,
    scaleBar(v, v.ox + 20, v.oy + mapH + 30, 50),
    northArrow(v.ox + mapW - 48, v.oy + 58),
    titleBlock(bp, sideX, 40, 740, "elevation plan and sections"),
    ramp.join(""),
    sectionSvg(bp, T, numbered, secs[0], 90, secY, 2300, secH),
    sectionSvg(bp, T, numbered, secs[1], 90, secY + secH + 90, 2300, secH),
  ];
  return svgDoc(sideX + 740 + 40, Math.ceil(secY + 2 * secH + 160), body.join(""));
}

function regionMap(bp: BannerholdBlueprint): string {
  const W = 1900;
  const H = 1700;
  const cx = 860;
  const cy = 920;
  const R = 660;
  const dmax = Math.max(30000, ...bp.outer.places.map((p) => p.distance)) * 1.05;
  const rad = (d: number) => (R * Math.log10(1 + d / 50)) / Math.log10(1 + dmax / 50);
  const toXY = (p: Vec2): [number, number] => {
    const d = Math.hypot(p[0], p[1]);
    if (d < 1e-6) return [cx, cy];
    const r = rad(d);
    return [cx + (p[0] / d) * r, cy + (p[1] / d) * r];
  };
  const parts: string[] = [`<defs>${arrowDefs()}</defs>`];
  const terrCol: Record<string, string> = { holding: "#c9a23a", "allied-great-house": "#2f5f94", "rival-house": "#94374f", crown: "#6f4f96", "other-banner": "#4e7a5c", wilderness: "#8a8a7a", church: "#a89d84" };
  for (const t of bp.outer.territories) {
    const pts = t.polygon.map((p) => toXY(p).map(f1).join(",")).join(" ");
    parts.push(`<polygon points="${pts}" fill="${terrCol[t.owner]}" fill-opacity="0.15" stroke="${terrCol[t.owner]}" stroke-width="1.3"/>`);
    const c = t.polygon.reduce((a, p) => [a[0] + p[0] / t.polygon.length, a[1] + p[1] / t.polygon.length] as Vec2, [0, 0] as Vec2);
    const [lx, ly] = toXY(c);
    parts.push(text(lx, ly, t.name, 10.5, { anchor: "middle", fill: terrCol[t.owner], italic: true }));
  }
  for (const ring of [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000]) {
    if (ring > dmax) continue;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${f1(rad(ring))}" fill="none" stroke="#2a2730" stroke-opacity="0.22" stroke-dasharray="3 4"/>`);
    parts.push(text(cx + 4, cy - rad(ring) - 3, ring >= 1000 ? `${ring / 1000} km` : `${ring} m`, 9.5, { fill: "#4a4640" }));
  }
  for (let b = 0; b < 360; b += 30) {
    const d = bearingVector(b);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${f1(cx + d[0] * R)}" y2="${f1(cy + d[1] * R)}" stroke="#2a2730" stroke-opacity="0.1"/>`);
    const lab = b === 0 ? "N" : b === 90 ? "E" : b === 180 ? "S" : b === 270 ? "W" : `${b}°`;
    parts.push(text(cx + d[0] * (R + 18), cy + d[1] * (R + 18) + 4, lab, b % 90 === 0 ? 14 : 10, { anchor: "middle", weight: b % 90 === 0 ? "bold" : "normal" }));
  }
  for (const s of bp.outer.skyline) {
    const r = rad(s.distance);
    let b0 = s.bearingFromDeg;
    let b1 = s.bearingToDeg;
    if (b1 < b0) b1 += 360;
    const a0 = bearingVector(b0);
    const a1 = bearingVector(b1);
    const large = b1 - b0 > 180 ? 1 : 0;
    parts.push(`<path d="M${f1(cx + a0[0] * r)},${f1(cy + a0[1] * r)}A${f1(r)},${f1(r)} 0 ${large} 1 ${f1(cx + a1[0] * r)},${f1(cy + a1[1] * r)}" fill="none" stroke="#6b4a2a" stroke-opacity="0.5" stroke-width="${f1(2 + Math.min(10, s.height / 120))}" stroke-linecap="round"/>`);
    const am = bearingVector((b0 + b1) / 2);
    parts.push(text(cx + am[0] * (r + 14), cy + am[1] * (r + 14), `${s.kind} · ${s.height} m`, 9, { anchor: "middle", fill: "#6b4a2a" }));
  }
  for (const r of bp.routes.filter((x) => x.outer && x.hierarchy === "national")) {
    parts.push(`<polyline points="${r.points.map((p) => toXY(p).map(f1).join(",")).join(" ")}" fill="none" stroke="#8c8072" stroke-width="4" stroke-linecap="round"/>`);
    const last = r.points[r.points.length - 1];
    const [ex, ey] = toXY(last);
    parts.push(text(ex + 6, ey - 8, `${r.name}`, 11, { weight: "bold", fill: "#5a4e40" }));
  }
  const kindSym: Record<string, string> = { capital: "#6f4f96", "allied-seat": "#2f5f94", frontier: "#94374f", citadel: "#94374f", "neighbour-estate": "#4e7a5c", village: "#86602e", town: "#86602e", monastery: "#6b6b6b", necropolis: "#6b6b6b", industrial: "#5a6a7a", arcology: "#5a6a7a", port: "#2f5f94" };
  for (const p of bp.outer.places) {
    const [x, y] = toXY(p.position);
    const size = 5 + Math.min(16, Math.sqrt(p.radius) / 2.4);
    parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(size)}" fill="${kindSym[p.kind] ?? "#555"}" fill-opacity="0.85" stroke="${INK}"/>`);
    parts.push(text(x + size + 4, y - 2, p.name, 11.5, { weight: "bold" }));
    const slot = p.kind === "frontier" ? ` · toward ${p.frontierNation} · lit when the rival house is from there` : p.stateSlot ? ` · ${p.stateSlot}` : "";
    parts.push(text(x + size + 4, y + 11, `${p.kind} · ${(p.distance / 1000).toFixed(1)} km @ ${f1(p.bearingDeg)}° · ${p.silhouetteHeight} m${slot}`, 9.5, { fill: "#4a4640" }));
  }
  for (const o of bp.outer.outposts) {
    const [x, y] = toXY(o.position);
    parts.push(`<rect x="${f1(x - 3.5)}" y="${f1(y - 3.5)}" width="7" height="7" fill="#94374f"/>${text(x + 6, y + 4, o.name, 9.5, { fill: "#6a2338" })}`);
  }
  parts.push(`<path d="M${bp.settlementBoundary.map((p) => toXY(p).map(f1).join(",")).join("L")}Z" fill="${INK}" stroke="#c9a23a" stroke-width="1.5"/>`);
  parts.push(text(cx, cy + 28, "the holding", 12, { anchor: "middle", weight: "bold" }));
  parts.push(titleBlock(bp, 40, 30, 1100, "region and the greater nation (logarithmic radial scale)"));
  parts.push(text(40, H - 62, "Logarithmic radial scale: distance r ∝ log(1 + d / 50 m). Bearings are true. Renderers draw distant places as layered silhouettes at these bearings; heights and distances drive impostor scale and fog.", 11, { halo: false }));
  parts.push(text(40, H - 44, "Frontier keeps exist toward every neighbouring nation; the one toward the rival house's nation flies its colours (state-driven). Territories are indicative claims. Inter-nation bearings are working placeholders, not canon geography.", 11, { halo: false }));
  return svgDoc(W, H, parts.join(""));
}

// ---------------------------------------------------------------------------
// Generated schedule tables (Markdown) so documentation numbers never drift
// ---------------------------------------------------------------------------

function v3(p: Vec3): string {
  return `(${f1(p[0])}, ${f1(p[1])}, ${f1(p[2])})`;
}

function scheduleMarkdown(bp: BannerholdBlueprint, numbered: Numbered[]): string {
  const L: string[] = [];
  L.push(`# ${bp.nationId} — ${bp.siteName}: generated schedule`, "");
  L.push(`Generated by \`scripts/generate-legacy-environment-maps.ts\` from \`shared/legacy/environment/blueprint/nations/${bp.nationId}.ts\`. Do not edit by hand. Names and story lines are working placeholders pending creator approval.`, "");
  L.push(`Status: **${bp.status === "production-default" ? "reversible production default" : "first-pass layout"}**. ${bp.summary}`, "");
  const dev = bp.buildings.filter((b) => b.appearsAtHallTier !== undefined).length;
  L.push(`Walled extent ${bp.coreReference.width} × ${bp.coreReference.depth} m · terrain ${bp.terrain.extents.maxX - bp.terrain.extents.minX} × ${bp.terrain.extents.maxZ - bp.terrain.extents.minZ} m · ${bp.buildings.length} buildings (${dev} development) · ${bp.routes.length} routes · ${bp.walls.length} wall runs · ${bp.towers.length} towers · ${bp.npcs.length} NPC agents · ${bp.dressing.length} dressing clusters.`, "");
  L.push("## Districts", "", "| id | brief name | nation name | role |", "|---|---|---|---|");
  for (const d of bp.districts) L.push(`| ${d.id} | ${DISTRICT_NAMES[d.id]} | ${d.name} | ${d.role} |`);
  L.push(`| G | ${DISTRICT_NAMES.G} | outside the walls | Fields, outposts, roads and every distant place below. |`);
  L.push("", "## Buildings", "", "| # | id | name | dist | function | tradition | main mass centre / w × d / rot | storeys | eave / top (m above floor) | floor y | relief | foundation | era, age | condition (repairs) | quality | class | lod | kit |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const nb of numbered) {
    const b = nb.b;
    const m = b.masses[0];
    const flags = b.unfinished ? ` — unfinished (${b.unfinished.stage}, completes at tier ${b.unfinished.completesAtHallTier})` : b.appearsAtHallTier ? ` — appears at tier ${b.appearsAtHallTier}` : "";
    L.push(`| ${nb.n} | \`${b.id}\` | ${b.name}${flags} | ${b.district} | ${b.function} | ${b.tradition} | (${f1(m.center[0])}, ${f1(m.center[1])}) / ${m.width} × ${m.depth} / ${f1(m.rotationDeg)}° (+${b.masses.length - 1} masses) | ${m.storeys} | ${f1(m.eaveHeight)} / ${f1(nb.topY - nb.floorY)} | ${f1(nb.floorY)} | ${f1(nb.relief)} | ${b.foundation.kind} | ${b.age.era}, ${b.age.builtYearsAgo} y | ${b.age.condition} (${b.age.repairs.length}) | ${b.quality} | ${b.social} | ${b.lod} | \`${b.kit}\` |`);
  }
  L.push("", "## Landmarks", "", "| landmark | anchor | pick centre | pick radius | VR target radius | camera |", "|---|---|---|---|---|---|");
  for (const l of bp.landmarks) L.push(`| ${l.label} | ${v3(l.anchor)} | ${v3(l.pickCenter)} | ${l.pickRadius} m | ${(l.pickRadius * bp.vr.displayScale * 100).toFixed(1)} cm | \`${l.cameraId}\` |`);
  L.push("", "## Muster", "", `Pawn stand ${v3(bp.muster.pawnStand.position)}; injured rest ${v3(bp.slots.injuredRest.position)}; captive marker ${v3(bp.slots.captiveMarker.position)}; ${bp.muster.levySlots.length} levy slots.`, "", "| file | position |", "|---|---|");
  for (const f of bp.muster.fileMarkers) L.push(`| ${f.file} | ${v3(f.pose.position)} |`);
  L.push("", "## Desktop cameras", "", "| id | position | target | vfov | orbit yaw | orbit pitch | orbit distance | composition |", "|---|---|---|---|---|---|---|---|");
  for (const c of bp.cameras) L.push(`| \`${c.id}\` | ${v3(c.position)} | ${v3(c.target)} | ${c.fovDeg}° | ${c.orbit.yawDeg[0]}…${c.orbit.yawDeg[1]}° | ${c.orbit.pitchDeg[0]}…${c.orbit.pitchDeg[1]}° | ${c.orbit.distance[0]}…${c.orbit.distance[1]} m | ${c.composition} |`);
  const vr = bp.vr;
  L.push("", "## VR staging", "", `- Display scale 1:${Math.round(1 / vr.displayScale)} (${vr.displayScale} physical m per blueprint m); centre (${vr.displayCenter[0]}, ${vr.displayCenter[1]}); datum y ${vr.datumY}.`);
  L.push(`- Detail region ${vr.detailExtent.width} × ${vr.detailExtent.depth} m → ${(vr.detailExtent.width * vr.displayScale).toFixed(2)} × ${(vr.detailExtent.depth * vr.displayScale).toFixed(2)} m; skirt far ${vr.skirtMargins.far} m, lateral ${vr.skirtMargins.lateral} m, near ${vr.skirtMargins.near} m.`);
  L.push(`- Viewer faces bearing ${vr.viewerFacingBearingDeg}°. Seated: eye ${vr.seated.eyeHeight} m, surface ${vr.seated.surfaceHeight} m, ${vr.seated.viewerDistance} m to centre. Standing: eye ${vr.standing.eyeHeight} m, surface ${vr.standing.surfaceHeight} m, ${vr.standing.viewerDistance} m.`);
  L.push(`- Turntable ${vr.rotation.userRotatable ? `±${vr.rotation.yawLimitDeg}° in ${vr.rotation.snapStepDeg}° steps` : "disabled"}; resets on recentre: ${vr.rotation.resetsOnRecentre}. Poke ${vr.reach.pokeMax} m, ray ${vr.reach.rayMax} m, minimum target radius ${(vr.reach.minTargetRadius * 100).toFixed(1)} cm.`);
  L.push(`- Horizon ring radius ${vr.horizon.ringRadius} m, base ${vr.horizon.ringBaseHeight} m relative to the surface, height ${vr.horizon.ringHeight} m. Panel anchors (surface-centre space): primary ${v3(vr.panelAnchors.primary)}, dock ${v3(vr.panelAnchors.dock)}.`);
  L.push(`- ${vr.recentre.description}`, `- Anchor convention: ${vr.anchorConvention}`);
  for (const n of vr.comfortNotes) L.push(`- ${n}`);
  L.push("", "## NPC agents and schedules", "", "| id | role | count | route length | loop | steps | phase | label |", "|---|---|---|---|---|---|---|---|");
  for (const n of bp.npcs) {
    let len = 0;
    for (let i = 1; i < n.route.length; i++) len += Math.hypot(n.route[i][0] - n.route[i - 1][0], n.route[i][1] - n.route[i - 1][1]);
    let t = 0;
    let cur = 0;
    const steps: string[] = [];
    for (const st of n.steps) {
      if (st.kind === "walk") {
        let d = 0;
        const a = Math.min(cur, st.to);
        const b = Math.max(cur, st.to);
        for (let i = a + 1; i <= b; i++) d += Math.hypot(n.route[i][0] - n.route[i - 1][0], n.route[i][1] - n.route[i - 1][1]);
        t += d / (st.speed ?? n.speed);
        steps.push(`walk→${st.to}`);
        cur = st.to;
      } else {
        t += st.seconds;
        steps.push(`${st.activity} ${st.seconds}s`);
      }
    }
    L.push(`| \`${n.id}\` | ${n.role} | ${n.count} | ${f1(len)} m | ${f1(t)} s | ${steps.join(", ")} | ${n.phaseSeconds} s | ${n.label} |`);
  }
  L.push("", "## Greater nation", "", "| place | kind | bearing | distance | ground / silhouette | state slot |", "|---|---|---|---|---|---|");
  for (const p of bp.outer.places) L.push(`| ${p.name} | ${p.kind}${p.frontierNation ? ` (toward ${p.frontierNation})` : ""} | ${f1(p.bearingDeg)}° | ${(p.distance / 1000).toFixed(2)} km | ${p.groundElevation} / ${p.silhouetteHeight} m | ${p.stateSlot ?? "—"} |`);
  L.push("", "## View corridors", "", "| id | from | to | purpose |", "|---|---|---|---|");
  for (const c of bp.viewCorridors) L.push(`| \`${c.id}\` | ${v3(c.from)} | ${v3(c.to)} | ${c.purpose} |`);
  L.push("", "## Expansion zones", "", "| id | district | unlocks | intended use |", "|---|---|---|---|");
  for (const e of bp.expansion) L.push(`| \`${e.id}\` | ${e.district} | ${e.unlocksAtHallTier === null ? "reserved" : `hall tier ${e.unlocksAtHallTier}`} | ${e.intendedUse} |`);
  L.push("", "## Hall-tier development (gameplay-driven)", "", "| tier | buildings | expansion zones | dressing |", "|---|---|---|---|");
  for (const t of bp.slots.hallTiers) L.push(`| ${t.tier} | ${t.buildings.join(", ") || "—"} | ${t.expansionZones.join(", ") || "—"} | ${t.dressing.join(", ") || "—"} |`);
  L.push("", "## Atmosphere", "", `${bp.atmosphere.timeOfDay}. Key light bearing ${bp.atmosphere.sun.bearingDeg}°, elevation ${bp.atmosphere.sun.elevationDeg}°, ${bp.atmosphere.sun.colour}, intensity ${bp.atmosphere.sun.intensity}. Sky ${bp.atmosphere.sky.zenith} → ${bp.atmosphere.sky.horizon}, ground ${bp.atmosphere.sky.ground}. Fog ${bp.atmosphere.fog.colour} ${bp.atmosphere.fog.near}–${bp.atmosphere.fog.far} m. Wind toward ${bp.atmosphere.wind.towardBearingDeg}° at ${bp.atmosphere.wind.speed} m/s. ${bp.atmosphere.notes}`, "");
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Output: Playwright screenshots and optional palette compression
// ---------------------------------------------------------------------------

/** The slice of Playwright this script uses (Playwright is resolved from "main game" at run time). */
interface PwLocator {
  screenshot(o: { path: string; type: "png" }): Promise<unknown>;
}
interface PwPage {
  goto(url: string, o: { waitUntil: "load" }): Promise<unknown>;
  setContent(html: string, o: { waitUntil: "load" }): Promise<void>;
  locator(selector: string): PwLocator;
  screenshot(o: { path: string; type: "png"; clip: { x: number; y: number; width: number; height: number } }): Promise<unknown>;
  close(): Promise<void>;
}
interface Browser {
  newPage(o: { viewport: { width: number; height: number } }): Promise<PwPage>;
  close(): Promise<void>;
}
let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  if (!browserPromise) {
    const req = createRequire(join(ROOT, "main game", "package.json"));
    const { chromium } = req("playwright") as { chromium: { launch(o: { executablePath: string; args: string[] }): Promise<Browser> } };
    browserPromise = chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  }
  return browserPromise;
}

async function compressPng(file: string): Promise<void> {
  try {
    const req = createRequire(join(ROOT, "main-game-vr", "package.json"));
    const sharp = req("sharp") as (input: Buffer) => { png: (o: object) => { toBuffer: () => Promise<Buffer> } };
    const out = await sharp(readFileSync(file)).png({ palette: true, quality: 90, effort: 8, compressionLevel: 9 }).toBuffer();
    writeFileSync(file, out);
  } catch {
    // sharp is optional: keep the lossless Playwright PNG.
  }
}

async function screenshotHtml(htmlFile: string, pngFile: string, selector: string): Promise<void> {
  const b = await browser();
  const page = await b.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    await page.goto(`file://${htmlFile}`, { waitUntil: "load" });
    await page.locator(selector).screenshot({ path: pngFile, type: "png" });
  } finally {
    await page.close();
  }
  await compressPng(pngFile);
}

async function svgToPng(svgFile: string, pngFile: string): Promise<void> {
  const svg = readFileSync(svgFile, "utf8");
  const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 2000);
  const h = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 1500);
  const b = await browser();
  const page = await b.newPage({ viewport: { width: w, height: h } });
  try {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:${PAPER}">${svg}</body></html>`, { waitUntil: "load" });
    await page.screenshot({ path: pngFile, type: "png", clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await page.close();
  }
  await compressPng(pngFile);
  console.log(`  png ${pngFile.replace(ROOT + "/", "")}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Development tooling for framing trials: render massing frames of one nation from arbitrary
 * cameras (sharing one soup and shadow map) and return PNG buffers. Not used by the map run.
 */
export function renderPreviewFrames(nationId: string, cams: readonly PreviewCamera[], w = 960, h = 540): Buffer[] {
  const bp = BANNERHOLD_BLUEPRINTS[nationId as keyof typeof BANNERHOLD_BLUEPRINTS];
  if (!bp) throw new Error(`no blueprint for ${nationId}`);
  const T = createTerrainSampler(bp.terrain);
  const L = lightingOf(bp);
  const world = buildPreviewSoup(bp, T, "world");
  const sm = buildShadowMap(world, bp, L.sun, 2048);
  return cams.map((c) => encodePng(w, h, renderSoup(world, c, L, sm, w, h)));
}

export async function generateLegacyEnvironmentMaps(options: { png?: boolean; views?: boolean; nations?: string[] } = {}): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const nations = Object.keys(BANNERHOLD_BLUEPRINTS).filter((n) => !options.nations || options.nations.indexOf(n) >= 0);
  try {
    for (const id of nations) {
      const bp = BANNERHOLD_BLUEPRINTS[id as keyof typeof BANNERHOLD_BLUEPRINTS];
      if (!bp) continue;
      const errors = validateBlueprint(bp).filter((i) => i.severity === "error");
      if (errors.length) console.warn(`! ${id}: ${errors.length} validation errors (maps still generated)\n${errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")}`);
      const T = createTerrainSampler(bp.terrain);
      const numbered = numberBuildings(bp, T);
      const maps: [string, string][] = [
        ["plan", planMap(bp, T, numbered)],
        ["site", siteMap(bp, T, numbered)],
        ["elevation", elevationMap(bp, T, numbered)],
        ["region", regionMap(bp)],
      ];
      for (const [kind, svg] of maps) {
        const file = join(OUT, `${id}-${kind}.svg`);
        writeFileSync(file, svg);
        console.log(`  svg ${file.replace(ROOT + "/", "")} (${(svg.length / 1024).toFixed(0)} KB)`);
        if (options.png !== false) await svgToPng(file, file.replace(/\.svg$/, ".png"));
      }
      writeFileSync(join(OUT, `${id}-schedule.md`), scheduleMarkdown(bp, numbered));
      if (options.png !== false && options.views !== false) await renderViewsSheet(bp, T, join(OUT, `${id}-views.png`));
    }
  } finally {
    if (browserPromise) await (await browserPromise).close();
  }
  console.log(`maps written for ${nations.join(", ")} (production default: ${PRODUCTION_DEFAULT_NATION})`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const nationArg = process.argv.find((a) => a.startsWith("--nation="));
  generateLegacyEnvironmentMaps({ png: !process.argv.includes("--no-png"), views: !process.argv.includes("--no-views"), nations: nationArg ? nationArg.slice(9).split(",") : undefined }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
