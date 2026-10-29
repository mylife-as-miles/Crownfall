// Deterministic math for the Bannerhold geometry kernel. Matrices are column-major
// (three.js Matrix4.elements order) held in Float64Array for exact composition;
// mesh outputs are narrowed to Float32Array by the builder. Pure: no allocation in
// the hot helpers that take an `out` argument.

export type Mat4 = Float64Array;
export type V3 = [number, number, number];

export const DEG = Math.PI / 180;

export function mat4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/**
 * T * Ry(yaw) * Rx(pitch) * Rz(roll) * S. Angles in radians; yaw follows the
 * three.js rotation.y convention (positive turns counter-clockwise seen from above).
 */
export function mat4Compose(out: Mat4, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1): Mat4 {
  const cy = Math.cos(yaw), syw = Math.sin(yaw);
  const cx = Math.cos(pitch), sxp = Math.sin(pitch);
  const cz = Math.cos(roll), szr = Math.sin(roll);
  // Columns of Ry * Rx * Rz.
  const r00 = cy * cz + syw * sxp * szr, r01 = cx * szr, r02 = -syw * cz + cy * sxp * szr;
  const r10 = -cy * szr + syw * sxp * cz, r11 = cx * cz, r12 = syw * szr + cy * sxp * cz;
  const r20 = syw * cx, r21 = -sxp, r22 = cy * cx;
  out[0] = r00 * sx; out[1] = r01 * sx; out[2] = r02 * sx; out[3] = 0;
  out[4] = r10 * sy; out[5] = r11 * sy; out[6] = r12 * sy; out[7] = 0;
  out[8] = r20 * sz; out[9] = r21 * sz; out[10] = r22 * sz; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** Upper-left 3x3 inverse transpose (column-major, 9 floats) for transforming normals. */
export function normalMatrix(out: Float64Array, m: Mat4): Float64Array {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  const inv = det === 0 ? 0 : 1 / det;
  const i00 = b01 * inv, i01 = (-a22 * a01 + a02 * a21) * inv, i02 = (a12 * a01 - a02 * a11) * inv;
  const i10 = b11 * inv, i11 = (a22 * a00 - a02 * a20) * inv, i12 = (-a12 * a00 + a02 * a10) * inv;
  const i20 = b21 * inv, i21 = (-a21 * a00 + a01 * a20) * inv, i22 = (a11 * a00 - a01 * a10) * inv;
  out[0] = i00; out[1] = i10; out[2] = i20;
  out[3] = i01; out[4] = i11; out[5] = i21;
  out[6] = i02; out[7] = i12; out[8] = i22;
  return out;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/** sRGB hex ("#rrggbb") → linear rgb triple. */
export function hexToLinear(hex: string): V3 {
  const h = hex.charAt(0) === "#" ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** sRGB hex → sRGB 0..1 triple. */
export function hexToSrgb(hex: string): V3 {
  const h = hex.charAt(0) === "#" ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Rounds to 4 decimals: keeps derived layout numbers stable across platforms. */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
