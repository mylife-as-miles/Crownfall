// The chamber vault's shape as pure functions. The shell springs from an
// octagon above the main cornice and rises along a circular meridian to a
// round oculus; its horizontal sections morph from the octagon to the circle,
// so the eight ribs at the octagon's corners converge on the oculus ring.

export interface VaultShape {
  sides: number;
  /** Octagon apothem and height at the springing. */
  springApothem: number;
  springY: number;
  /** Tangent of the meridian at the springing, radians above horizontal. */
  springAngle: number;
  /** Radius of the round oculus and the meridian's parameter there (radians). */
  oculusRadius: number;
  oculusAngle: number;
}

export interface VaultMeridian {
  radius: number;
  /** Centre of the meridian circle: apothem and height. */
  centerA: number;
  centerY: number;
  /** Meridian parameters at the springing and at the oculus. */
  t0: number;
  t1: number;
  crownY: number;
}

/** The meridian circle through the springing (with its tangent) and the oculus. */
export function vaultMeridian(shape: VaultShape): VaultMeridian {
  const { springApothem: a0, springY: y0, springAngle: alpha, oculusRadius: ao, oculusAngle: t1 } = shape;
  const radius = (a0 - ao) / (Math.sin(alpha) - Math.cos(t1));
  const centerA = a0 - radius * Math.sin(alpha);
  const centerY = y0 - radius * Math.cos(alpha);
  return { radius, centerA, centerY, t0: Math.PI / 2 - alpha, t1, crownY: centerY + radius * Math.sin(t1) };
}

/** Meridian apothem and height at a share `s` (0 springing, 1 oculus) of the way up. */
export function meridianAt(meridian: VaultMeridian, s: number, out: [number, number] = [0, 0]): [number, number] {
  const t = meridian.t0 + (meridian.t1 - meridian.t0) * s;
  out[0] = meridian.centerA + meridian.radius * Math.cos(t);
  out[1] = meridian.centerY + meridian.radius * Math.sin(t);
  return out;
}

/** How far the section has turned from octagon (0) to circle (1) at share `s`. */
export function vaultRoundness(s: number): number {
  const t = Math.max(0, Math.min(1, s));
  return t * t * (3 - 2 * t);
}

/** Angular distance from the nearest side centre (sides face bearings k * 2PI / sides). */
export function sideDeviation(bearing: number, sides: number): number {
  const step = (Math.PI * 2) / sides;
  return bearing - step * Math.round(bearing / step);
}

const meridianScratch: [number, number] = [0, 0];

/** Plan radius of the shell at a bearing and share `s` up the meridian. */
export function vaultRadiusAt(shape: VaultShape, meridian: VaultMeridian, bearing: number, s: number): number {
  const [apothem] = meridianAt(meridian, s, meridianScratch);
  const m = vaultRoundness(s);
  const octagon = apothem / Math.cos(sideDeviation(bearing, shape.sides));
  return octagon * (1 - m) + apothem * m;
}

/**
 * Height of the shell's inner surface above a plan point at `radius` and
 * `bearing`, or NaN outside the shell's reach (beyond the springing octagon or
 * inside the oculus).
 */
export function vaultHeightAt(shape: VaultShape, meridian: VaultMeridian, radius: number, bearing: number): number {
  let lo = 0, hi = 1;
  const outer = vaultRadiusAt(shape, meridian, bearing, 0), inner = vaultRadiusAt(shape, meridian, bearing, 1);
  if (radius > outer + 1e-9 || radius < inner - 1e-9) return NaN;
  for (let step = 0; step < 48; step++) {
    const mid = (lo + hi) / 2;
    if (vaultRadiusAt(shape, meridian, bearing, mid) > radius) lo = mid;
    else hi = mid;
  }
  return meridianAt(meridian, (lo + hi) / 2, meridianScratch)[1];
}
