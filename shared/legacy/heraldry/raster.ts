// rasterizeHeraldry: exact-area coverage rasterization (accumulation buffer)
// of heraldryShapes into straight-alpha sRGB RGBA. Layers composite in linear
// light for clean anti-aliased edges; pixels outside the silhouette keep the
// colour beneath them so mip-mapped cloth never shows dark fringes. Each layer
// is resolved only inside the rows and columns its edges touch, and blending is
// fused into that pass. HeraldryRasterizer reuses its working buffers between
// calls, so rebuilding standards on a heraldry change does not churn memory.

import type { Heraldry } from "../types";
import { outer, signedArea, transformRing } from "./geometry";
import type { Ring } from "./geometry";
import { heraldryShapes } from "./shapes";
import type { HeraldryAspect } from "./shapes";

export interface HeraldryRasterOptions {
  width: number;
  height: number;
  aspect: HeraldryAspect;
  swallowtail?: boolean;
  /** Subtle darkened rim inside the silhouette (default true). */
  border?: boolean;
  /** Fimbriate charges that break the rule of tincture (default true). */
  fimbriation?: boolean;
}

export interface HeraldryRaster {
  width: number;
  height: number;
  /** Straight (non-premultiplied) RGBA, sRGB, row-major from the top-left. */
  data: Uint8ClampedArray;
}

export const HERALDRY_RASTER_MAX = 4096;

const SRGB_TO_LINEAR = new Float32Array(256);
for (let index = 0; index < 256; index++) {
  const c = index / 255;
  SRGB_TO_LINEAR[index] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LINEAR_STEPS = 4096;
const LINEAR_TO_SRGB = new Uint8Array(LINEAR_STEPS + 2);
for (let index = 0; index <= LINEAR_STEPS + 1; index++) {
  const c = Math.min(1, index / LINEAR_STEPS);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[index] = Math.round(Math.min(1, Math.max(0, s)) * 255);
}

/** Packed 32-bit pixel writes are byte-identical only on little-endian hosts; others write bytes. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function hexToLinear(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [SRGB_TO_LINEAR[(value >> 16) & 255], SRGB_TO_LINEAR[(value >> 8) & 255], SRGB_TO_LINEAR[value & 255]];
}

/** Accumulation-buffer coverage rasterizer (after Raph Levien's font-rs) that tracks the cells it touches. */
class CoverageAccumulator {
  width = 0;
  height = 0;
  private stride = 0;
  private acc = new Float32Array(0);
  private minCol = 0;
  private maxCol = -1;
  private minRow = 0;
  private maxRow = -1;

  /** Sizes the buffer for a raster, growing it only when needed. The buffer is left zeroed between fills. */
  reset(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.stride = width + 2;
    const needed = this.stride * height;
    if (this.acc.length < needed) this.acc = new Float32Array(needed);
    else this.acc.fill(0, 0, needed);
    this.clearBounds();
  }

  release(): void {
    this.acc = new Float32Array(0);
    this.width = 0;
    this.height = 0;
  }

  private clearBounds(): void {
    this.minCol = Number.POSITIVE_INFINITY;
    this.maxCol = -1;
    this.minRow = Number.POSITIVE_INFINITY;
    this.maxRow = -1;
  }

  /** Adds rings already in pixel space (nonzero winding). */
  add(rings: readonly Ring[]): void {
    for (const ring of rings) {
      const count = ring.length;
      for (let index = 0; index < count; index += 2) {
        const next = (index + 2) % count;
        this.clippedLine(ring[index], ring[index + 1], ring[next], ring[next + 1]);
      }
    }
  }

  /** Composites the accumulated coverage over `color` (linear RGB) and clears what it read. */
  blendInto(color: Float32Array, rgb: readonly [number, number, number], opacity: number): void {
    const [r, g, b] = rgb;
    const { width, stride, acc } = this;
    const lastCol = Math.min(this.maxCol, width - 1);
    for (let y = this.minRow; y <= this.maxRow; y++) {
      const row = y * stride;
      let sum = 0;
      let p = (y * width + this.minCol) * 3;
      for (let x = this.minCol; x <= lastCol; x++, p += 3) {
        sum += acc[row + x];
        const value = sum < 0 ? -sum : sum;
        if (value <= 0) continue;
        const a = Math.fround(value > 1 ? 1 : value) * opacity;
        color[p] += (r - color[p]) * a;
        color[p + 1] += (g - color[p + 1]) * a;
        color[p + 2] += (b - color[p + 2]) * a;
      }
      acc.fill(0, row + this.minCol, row + this.maxCol + 1);
    }
    this.clearBounds();
  }

  /**
   * Encodes `color` (linear RGB) to sRGB and writes the accumulated coverage as
   * alpha, in one pass over every pixel, then clears what it read.
   */
  encodeInto(data: Uint8ClampedArray, color: Float32Array): void {
    const { width, height, stride, acc } = this;
    const packed = LITTLE_ENDIAN && data.byteOffset % 4 === 0 ? new Uint32Array(data.buffer, data.byteOffset, width * height) : null;
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      const touched = y >= this.minRow && y <= this.maxRow;
      let sum = 0;
      for (let x = 0, index = y * width, p = index * 3; x < width; x++, index++, p += 3) {
        let alpha = 0;
        if (touched) {
          sum += acc[row + x];
          const value = sum < 0 ? -sum : sum;
          alpha = (Math.fround(value > 1 ? 1 : value) * 255 + 0.5) | 0;
        }
        const r = LINEAR_TO_SRGB[(color[p] * LINEAR_STEPS + 0.5) | 0];
        const g = LINEAR_TO_SRGB[(color[p + 1] * LINEAR_STEPS + 0.5) | 0];
        const b = LINEAR_TO_SRGB[(color[p + 2] * LINEAR_STEPS + 0.5) | 0];
        if (packed) {
          packed[index] = r | (g << 8) | (b << 16) | (alpha << 24);
        } else {
          const q = index * 4;
          data[q] = r;
          data[q + 1] = g;
          data[q + 2] = b;
          data[q + 3] = alpha;
        }
      }
      if (touched) acc.fill(0, row + this.minCol, row + this.maxCol + 1);
    }
    this.clearBounds();
  }

  /** Splits a segment at x = 0 and x = width so off-canvas parts become boundary verticals (area-preserving). */
  private clippedLine(x0: number, y0: number, x1: number, y1: number): void {
    const w = this.width;
    if (x0 >= 0 && x0 <= w && x1 >= 0 && x1 <= w) {
      this.line(x0, y0, x1, y1);
      return;
    }
    let cutA = 2;
    let cutB = 2;
    if ((x0 < 0) !== (x1 < 0)) cutA = (0 - x0) / (x1 - x0);
    if ((x0 > w) !== (x1 > w)) cutB = (w - x0) / (x1 - x0);
    const first = cutA < cutB ? cutA : cutB;
    const second = cutA < cutB ? cutB : cutA;
    let t0 = 0;
    if (first <= 1) t0 = this.clippedPiece(x0, y0, x1, y1, t0, first);
    if (second <= 1) t0 = this.clippedPiece(x0, y0, x1, y1, t0, second);
    this.clippedPiece(x0, y0, x1, y1, t0, 1);
  }

  /** One piece of a segment between parameters t0 and t1, clamped to the canvas columns. Returns t1. */
  private clippedPiece(x0: number, y0: number, x1: number, y1: number, t0: number, t1: number): number {
    const w = this.width;
    const ax = x0 + (x1 - x0) * t0, ay = y0 + (y1 - y0) * t0;
    const bx = x0 + (x1 - x0) * t1, by = y0 + (y1 - y0) * t1;
    this.line(Math.min(w, Math.max(0, ax)), ay, Math.min(w, Math.max(0, bx)), by);
    return t1;
  }

  private line(ax: number, ay: number, bx: number, by: number): void {
    if (ay === by) return;
    const dir = ay < by ? 1 : -1;
    const x0 = dir > 0 ? ax : bx, y0 = dir > 0 ? ay : by;
    const x1 = dir > 0 ? bx : ax, y1 = dir > 0 ? by : ay;
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0;
    if (y0 < 0) x -= y0 * dxdy;
    const rowStart = Math.max(0, Math.floor(y0));
    const rowEnd = Math.min(this.height, Math.ceil(y1));
    if (rowStart >= rowEnd) return;
    if (rowStart < this.minRow) this.minRow = rowStart;
    if (rowEnd - 1 > this.maxRow) this.maxRow = rowEnd - 1;
    const acc = this.acc;
    const stride = this.stride;
    const maxX = this.width;
    for (let y = rowStart; y < rowEnd; y++) {
      const lineStart = y * stride;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xnext = x + dxdy * dy;
      const d = dy * dir;
      // Clamp float drift so a boundary vertical never lands in column -1 or beyond the guard column.
      const xc = x < 0 ? 0 : x > maxX ? maxX : x;
      const xn = xnext < 0 ? 0 : xnext > maxX ? maxX : xnext;
      const xa = xc < xn ? xc : xn;
      const xb = xc < xn ? xn : xc;
      const x0i = Math.floor(xa);
      const x1i = Math.ceil(xb);
      if (x0i < this.minCol) this.minCol = x0i;
      if (x1i + 1 > this.maxCol) this.maxCol = x1i + 1;
      if (x1i <= x0i + 1) {
        const xmf = 0.5 * (xc + xn) - x0i;
        acc[lineStart + x0i] += d - d * xmf;
        acc[lineStart + x0i + 1] += d * xmf;
      } else {
        const s = 1 / (xb - xa);
        const x0f = xa - x0i;
        const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
        const x1f = xb - x1i + 1;
        const am = 0.5 * s * x1f * x1f;
        acc[lineStart + x0i] += d * a0;
        if (x1i === x0i + 2) {
          acc[lineStart + x0i + 1] += d * (1 - a0 - am);
        } else {
          const a1 = s * (1.5 - x0f);
          acc[lineStart + x0i + 1] += d * (a1 - a0);
          for (let xi = x0i + 2; xi < x1i - 1; xi++) acc[lineStart + xi] += d * s;
          const a2 = a1 + (x1i - x0i - 3) * s;
          acc[lineStart + x1i - 1] += d * (1 - a2 - am);
        }
        acc[lineStart + x1i] += d * am;
      }
      x = xnext;
    }
  }
}

/** Stroke outlines for every ring edge (segment quads plus round joins), as positive rings. */
function strokeRings(rings: readonly Ring[], radius: number): Ring[] {
  const out: Ring[] = [];
  const joinSegments = 10;
  for (const ring of rings) {
    const count = ring.length;
    for (let index = 0; index < count; index += 2) {
      const next = (index + 2) % count;
      const ax = ring[index], ay = ring[index + 1];
      const bx = ring[next], by = ring[next + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length > 1e-6) {
        const nx = (-(by - ay) / length) * radius;
        const ny = ((bx - ax) / length) * radius;
        const quad = [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
        out.push(signedArea(quad) >= 0 ? Float32Array.from(quad) : outer(quad));
      }
      const join = new Float32Array(joinSegments * 2);
      for (let s = 0; s < joinSegments; s++) {
        const angle = (s / joinSegments) * Math.PI * 2;
        join[s * 2] = ax + Math.cos(angle) * radius;
        join[s * 2 + 1] = ay + Math.sin(angle) * radius;
      }
      out.push(signedArea(join) >= 0 ? join : outer(Array.from(join)));
    }
  }
  return out;
}

function checkedSize(options: HeraldryRasterOptions): { width: number; height: number } {
  const width = Math.floor(options.width);
  const height = Math.floor(options.height);
  if (!(width >= 1 && height >= 1 && width <= HERALDRY_RASTER_MAX && height <= HERALDRY_RASTER_MAX)) {
    throw new RangeError(`Heraldry rasters must be between 1 and ${HERALDRY_RASTER_MAX} pixels on each side.`);
  }
  return { width, height };
}

/**
 * Renders heraldry rasters while keeping its working buffers between calls.
 * Use one per renderer (or worker) that rebuilds standards and shields often;
 * call release() to drop the buffers. Output is identical to rasterizeHeraldry.
 */
export class HeraldryRasterizer {
  private readonly coverage = new CoverageAccumulator();
  private color = new Float32Array(0);

  /**
   * Renders into `target` when given (it must hold width × height × 4 bytes),
   * otherwise into a new buffer. The aspect is fitted uniformly and centred, so
   * a request that does not match the aspect's proportions gets transparent
   * margins; use heraldryPixelHeight for an exact fit.
   */
  rasterize(heraldry: Heraldry, options: HeraldryRasterOptions, target?: Uint8ClampedArray): HeraldryRaster {
    const { width, height } = checkedSize(options);
    const pixels = width * height;
    if (target && target.length !== pixels * 4) throw new RangeError("The raster target must hold width × height × 4 bytes.");
    const data = target ?? new Uint8ClampedArray(pixels * 4);
    const shapes = heraldryShapes(heraldry, options.aspect, { swallowtail: options.swallowtail });
    const scale = Math.min(width / shapes.width, height / shapes.height);
    const offsetX = (width - shapes.width * scale) / 2;
    const offsetY = (height - shapes.height * scale) / 2;
    const toPixels = (rings: readonly Ring[]): Ring[] => rings.map((ring) => transformRing(ring, scale, offsetX, offsetY));
    const coverage = this.coverage;
    coverage.reset(width, height);
    if (this.color.length < pixels * 3) this.color = new Float32Array(pixels * 3);
    const color = this.color;
    const drawBorder = options.border !== false;
    const fimbriation = options.fimbriation !== false ? shapes.fimbriation : null;

    for (const layer of shapes.layers) {
      if (layer.role === "border" && !drawBorder) continue;
      const rgb = hexToLinear(layer.color);
      if (layer.role === "field") {
        for (let p = 0; p < pixels * 3; p += 3) {
          color[p] = rgb[0];
          color[p + 1] = rgb[1];
          color[p + 2] = rgb[2];
        }
        continue;
      }
      if (layer.role === "charge" && fimbriation) {
        // Stroke in pixel space so the outline stays legible (≥ ~1.6 px) on small rasters and fine on large ones.
        const radius = Math.min(3, Math.max(0.8, (fimbriation.width / 2) * scale));
        coverage.add(strokeRings(toPixels(layer.rings), radius));
        coverage.blendInto(color, hexToLinear(fimbriation.color), 1);
      }
      coverage.add(toPixels(layer.rings));
      coverage.blendInto(color, rgb, layer.opacity);
    }

    // The silhouette's coverage becomes alpha while the composite is encoded to sRGB.
    coverage.add(toPixels(shapes.outline));
    coverage.encodeInto(data, color);
    return { width, height, data };
  }

  /** Drops the working buffers; the next rasterize() allocates again. */
  release(): void {
    this.coverage.release();
    this.color = new Float32Array(0);
  }
}

/** Renders heraldry to a new RGBA raster (see HeraldryRasterizer.rasterize). Pure and deterministic. */
export function rasterizeHeraldry(heraldry: Heraldry, options: HeraldryRasterOptions): HeraldryRaster {
  return new HeraldryRasterizer().rasterize(heraldry, options);
}
