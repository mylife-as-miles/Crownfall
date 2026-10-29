// Texture fields: tileable scalar/colour buffers in texture space (u right, v up,
// both wrapping), plus the finishing steps every generator shares: normal map from
// height, cavity ambient occlusion, ORM packing and 8-bit RGBA output.

import { hexToSrgb } from "../kernel/math";

export interface TextureFields {
  size: number;
  /** sRGB 0..1, rgb per texel, row-major from v = 0 (bottom) upward. */
  albedo: Float32Array;
  /** 0..1 height. */
  height: Float32Array;
  /** 0..1 roughness. */
  rough: Float32Array;
  /** 0..1 metalness. */
  metal: Float32Array | null;
  /** Height-to-normal strength (bigger = deeper relief). */
  normalStrength: number;
  /** Cavity occlusion strength. */
  aoStrength: number;
}

export interface TextureImages {
  size: number;
  /** RGBA8, row 0 = top of the image (v = 1), ready for PNG/WebP encoding. */
  albedo: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  orm: Uint8ClampedArray;
  /** Mean linear luminance of the albedo (terrain detail gain). */
  meanLuminance: number;
}

export function createFields(size: number, normalStrength = 4, aoStrength = 2.5): TextureFields {
  return {
    size,
    albedo: new Float32Array(size * size * 3),
    height: new Float32Array(size * size),
    rough: new Float32Array(size * size),
    metal: null,
    normalStrength,
    aoStrength,
  };
}

export type RGB = [number, number, number];

export function rgb(hex: string): RGB {
  const c = hexToSrgb(hex);
  return [c[0], c[1], c[2]];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRgb(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Calls fn for every texel with u, v in [0, 1) (texel centres). */
export function eachTexel(size: number, fn: (i: number, u: number, v: number, x: number, y: number) => void): void {
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) fn(y * size + x, (x + 0.5) / size, v, x, y);
  }
}

export function setTexel(f: TextureFields, i: number, c: RGB, h: number, r: number): void {
  f.albedo[i * 3] = c[0];
  f.albedo[i * 3 + 1] = c[1];
  f.albedo[i * 3 + 2] = c[2];
  f.height[i] = h;
  f.rough[i] = r;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function boxBlurWrap(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[y * size + ((k + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc / w;
      acc += src[y * size + ((x + radius + 1) % size)] - src[y * size + ((x - radius + size) % size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[((k + size) % size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / w;
      acc += tmp[((y + radius + 1) % size) * size + x] - tmp[((y - radius + size) % size) * size + x];
    }
  }
  return out;
}

/** Normal map, cavity AO, ORM packing and 8-bit output (image rows flipped so row 0 is v = 1). */
export function finishTexture(f: TextureFields): TextureImages {
  const n = f.size;
  const albedo = new Uint8ClampedArray(n * n * 4);
  const normal = new Uint8ClampedArray(n * n * 4);
  const orm = new Uint8ClampedArray(n * n * 4);
  const blurred = boxBlurWrap(f.height, n, Math.max(2, Math.round(n / 96)));
  const k = f.normalStrength * (n / 512);
  let lum = 0;
  for (let y = 0; y < n; y++) {
    const row = n - 1 - y;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const o = (row * n + x) * 4;
      const r = f.albedo[i * 3], g = f.albedo[i * 3 + 1], b = f.albedo[i * 3 + 2];
      albedo[o] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      albedo[o + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      albedo[o + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      albedo[o + 3] = 255;
      lum += 0.2126 * srgbToLinear(Math.min(1, r)) + 0.7152 * srgbToLinear(Math.min(1, g)) + 0.0722 * srgbToLinear(Math.min(1, b));
      // Height gradients in texture space (u right, v up), wrapping.
      const hl = f.height[y * n + ((x - 1 + n) % n)], hr = f.height[y * n + ((x + 1) % n)];
      const hd = f.height[((y - 1 + n) % n) * n + x], hu = f.height[((y + 1) % n) * n + x];
      let nx = -(hr - hl) * k, ny = -(hu - hd) * k, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
      const cavity = Math.max(0, blurred[i] - f.height[i]);
      const ao = Math.min(1, Math.max(0.35, 1 - cavity * f.aoStrength));
      orm[o] = Math.round(ao * 255);
      orm[o + 1] = Math.round(Math.min(1, Math.max(0.02, f.rough[i])) * 255);
      orm[o + 2] = Math.round(Math.min(1, Math.max(0, f.metal ? f.metal[i] : 0)) * 255);
      orm[o + 3] = 255;
    }
  }
  return { size: n, albedo, normal, orm, meanLuminance: lum / (n * n) };
}

/** Box downsample by 2 of an RGBA8 image (mip-like 512 variants). */
export function downsample2(src: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const h = size / 2;
  const out = new Uint8ClampedArray(h * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      for (let c = 0; c < 4; c++) {
        const a = src[((y * 2) * size + x * 2) * 4 + c], b = src[((y * 2) * size + x * 2 + 1) * 4 + c];
        const d = src[((y * 2 + 1) * size + x * 2) * 4 + c], e = src[((y * 2 + 1) * size + x * 2 + 1) * 4 + c];
        out[(y * h + x) * 4 + c] = (a + b + d + e + 2) >> 2;
      }
    }
  }
  return out;
}

/** Normal maps need renormalising after downsampling. */
export function downsampleNormal2(src: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const out = downsample2(src, size);
  for (let i = 0; i < out.length; i += 4) {
    let x = out[i] / 127.5 - 1, y = out[i + 1] / 127.5 - 1, z = out[i + 2] / 127.5 - 1;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    out[i] = Math.round((x * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((y * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
  }
  return out;
}
