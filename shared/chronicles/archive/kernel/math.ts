// Small numeric helpers shared by the archive kernel. Pure and allocation-light.

export const TAU = Math.PI * 2;

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Length of a 3-vector stored at `offset` in a flat array. */
export function length3(array: ArrayLike<number>, offset = 0): number {
  return Math.hypot(array[offset], array[offset + 1], array[offset + 2]);
}

export type Mutable3 = [number, number, number];

export function sub3(a: readonly number[], b: readonly number[], out: Mutable3 = [0, 0, 0]): Mutable3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function cross3(a: readonly number[], b: readonly number[], out: Mutable3 = [0, 0, 0]): Mutable3 {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function normalize3(v: Mutable3): Mutable3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length > 1e-12) {
    v[0] /= length;
    v[1] /= length;
    v[2] /= length;
  } else {
    v[0] = 0;
    v[1] = 1;
    v[2] = 0;
  }
  return v;
}

export function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rotates (x, z) about +Y by `yaw` as three.js does: counter-clockwise seen from above. */
export function rotateYaw(x: number, z: number, yaw: number, out: [number, number] = [0, 0]): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[0] = x * c + z * s;
  out[1] = -x * s + z * c;
  return out;
}
