// Vector charges drawn in a [-1, 1] box (y down). Each charge is a set of
// oriented rings: outer silhouettes union, holes cut detail (windows, jewels,
// eyes, fullers) so a single tincture still reads at 64 px and holds up at
// 512 px. A hole only ever lies inside exactly one outer ring, so the nonzero
// fill used by the rasterizer and SVG keeps it open.

import type { HeraldicCharge } from "../types";
import { circlePoints, cubicTo, hole, mirrorProfile, outer, radialUnionPoints, rectPoints } from "./geometry";
import type { Ring } from "./geometry";

function star(points: number, outerRadius: number, innerRadius: number, cx = 0, cy = 0): number[] {
  const out: number[] = [];
  for (let index = 0; index < points * 2; index++) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    out.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, segments: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    out.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
  }
  return out;
}

/** Maps local ray coordinates (u along the ray from the origin, v across it) into the charge box. */
function along(angle: number, u: number, v: number, out: number[]): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out.push(cos * u - sin * v, sin * u + cos * v);
}

function pawn(): Ring[] {
  const body: number[] = [0, -0.2, 0.13, -0.2];
  cubicTo(body, 0.15, 0.1, 0.29, 0.4, 0.46, 0.54);
  body.push(0.52, 0.57, 0.52, 0.68, 0.62, 0.71, 0.65, 0.75, 0.65, 0.88, 0, 0.88);
  return [
    outer(mirrorProfile(body)),
    outer(circlePoints(0, -0.53, 0.25, 40)),
    outer(ellipsePoints(0, -0.215, 0.32, 0.075, 32)),
  ];
}

function archPoints(x0: number, x1: number, springY: number, bottomY: number): number[] {
  const cx = (x0 + x1) / 2;
  const r = (x1 - x0) / 2;
  const out: number[] = [x0, bottomY, x0, springY];
  const steps = 14;
  for (let step = 1; step < steps; step++) {
    const angle = Math.PI + (step / steps) * Math.PI;
    out.push(cx + Math.cos(angle) * r, springY + Math.sin(angle) * r);
  }
  out.push(x1, springY, x1, bottomY);
  return out;
}

function tower(): Ring[] {
  return [
    outer([
      -0.56, 0.92, -0.56, 0.78, -0.42, 0.74, -0.42, -0.36, -0.56, -0.4, -0.56, -0.88, -0.32, -0.88, -0.32, -0.66,
      -0.12, -0.66, -0.12, -0.88, 0.12, -0.88, 0.12, -0.66, 0.32, -0.66, 0.32, -0.88, 0.56, -0.88, 0.56, -0.4,
      0.42, -0.36, 0.42, 0.74, 0.56, 0.78, 0.56, 0.92,
    ]),
    hole(archPoints(-0.16, 0.16, 0.32, 0.74)),
    hole(archPoints(-0.065, 0.065, -0.18, 0.08)),
  ];
}

function key(): Ring[] {
  // A quatrefoil bow with a round eye, a collar, the shank and a notched bit.
  const bow = radialUnionPoints([
    [0, -0.6, 0.23], [0, -0.83, 0.14], [0.23, -0.6, 0.14], [-0.23, -0.6, 0.14], [0, -0.37, 0.14],
  ], 0, -0.6, 160);
  return [
    outer(bow),
    hole(circlePoints(0, -0.6, 0.115, 40)),
    outer(rectPoints(-0.2, -0.26, 0.2, -0.16)),
    outer(rectPoints(-0.08, -0.2, 0.08, 0.93)),
    outer([0.06, 0.46, 0.46, 0.46, 0.46, 0.58, 0.32, 0.58, 0.32, 0.68, 0.46, 0.68, 0.46, 0.93, 0.06, 0.93]),
  ];
}

function sword(): Ring[] {
  return [
    // Blade with a long taper to the point, and its fuller.
    outer([0, -0.99, 0.095, -0.82, 0.125, -0.56, 0.135, 0.31, -0.135, 0.31, -0.125, -0.56, -0.095, -0.82]),
    hole([0.026, -0.64, 0.028, 0.2, -0.028, 0.2, -0.026, -0.64]),
    // Crossguard whose quillons sweep up toward the point.
    outer([-0.62, 0.23, -0.46, 0.3, 0.46, 0.3, 0.62, 0.23, 0.59, 0.34, 0.46, 0.41, -0.46, 0.41, -0.59, 0.34]),
    outer(rectPoints(-0.07, 0.4, 0.07, 0.72)),
    outer(circlePoints(0, 0.82, 0.125, 32)),
  ];
}

function sun(): Ring[] {
  // In splendour: straight rays alternate with wavy ones around a ring and a disc.
  const rays = 16;
  const base = 0.55;
  const outline: number[] = [];
  for (let index = 0; index < rays; index++) {
    const angle = -Math.PI / 2 + (index / rays) * Math.PI * 2;
    if (index % 2 === 0) {
      along(angle, base, -0.09, outline);
      along(angle, 0.99, 0, outline);
      along(angle, base, 0.09, outline);
      continue;
    }
    const steps = 12;
    const length = 0.34;
    const left: number[] = [];
    const right: number[] = [];
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const centre = 0.045 * Math.sin(t * Math.PI * 2.4) * (1 - 0.35 * t);
      const half = 0.072 * (1 - t);
      along(angle, base + length * t, centre - half, left);
      if (step < steps) along(angle, base + length * t, centre + half, right);
    }
    outline.push(...left);
    for (let point = right.length - 2; point >= 0; point -= 2) outline.push(right[point], right[point + 1]);
  }
  return [outer(outline), hole(circlePoints(0, 0, 0.47, 64)), outer(circlePoints(0, 0, 0.4, 64))];
}

function eclipse(): Ring[] {
  // The dark disc (a hole showing the field) sits off-centre in a corona of light,
  // which thickens into a crescent on the far side, with flares of alternating length.
  const rings: Ring[] = [outer(circlePoints(0, 0, 0.64, 112)), hole(circlePoints(0.09, -0.09, 0.42, 96))];
  const flares = 16;
  for (let index = 0; index < flares; index++) {
    const angle = -Math.PI / 2 + (index / flares) * Math.PI * 2;
    const long = index % 2 === 0;
    const flare: number[] = [];
    along(angle, 0.6, long ? -0.075 : -0.06, flare);
    along(angle, long ? 0.99 : 0.84, 0, flare);
    along(angle, 0.6, long ? 0.075 : 0.06, flare);
    rings.push(outer(flare));
  }
  return rings;
}

function mullet(): Ring[] {
  return [outer(star(5, 0.98, 0.4, 0, 0.09))];
}

function cog(): Ring[] {
  const teeth = 10;
  const points: number[] = [];
  const step = (Math.PI * 2) / teeth;
  const toothHalf = step * 0.2;
  const flank = step * 0.08;
  for (let index = 0; index < teeth; index++) {
    const centre = -Math.PI / 2 + index * step;
    const rootStart = centre - toothHalf - flank;
    points.push(Math.cos(rootStart) * 0.74, Math.sin(rootStart) * 0.74);
    points.push(Math.cos(centre - toothHalf) * 0.96, Math.sin(centre - toothHalf) * 0.96);
    points.push(Math.cos(centre + toothHalf) * 0.96, Math.sin(centre + toothHalf) * 0.96);
    const rootEnd = centre + toothHalf + flank;
    const nextStart = centre + step - toothHalf - flank;
    for (let s = 0; s <= 4; s++) {
      const angle = rootEnd + ((nextStart - rootEnd) * s) / 4;
      points.push(Math.cos(angle) * 0.74, Math.sin(angle) * 0.74);
    }
  }
  const rings: Ring[] = [outer(points), hole(circlePoints(0, 0, 0.29, 40))];
  for (let index = 0; index < 6; index++) {
    const angle = -Math.PI / 2 + (index / 6) * Math.PI * 2 + Math.PI / 6;
    rings.push(hole(circlePoints(Math.cos(angle) * 0.52, Math.sin(angle) * 0.52, 0.085, 20)));
  }
  return rings;
}

function flame(): Ring[] {
  const shape: number[] = [0, 0.92];
  cubicTo(shape, 0.42, 0.92, 0.66, 0.62, 0.6, 0.28);
  cubicTo(shape, 0.56, 0.04, 0.44, -0.1, 0.5, -0.44);
  cubicTo(shape, 0.3, -0.26, 0.24, -0.12, 0.22, 0.02);
  cubicTo(shape, 0.2, -0.3, 0.1, -0.56, 0, -0.98);
  cubicTo(shape, -0.1, -0.56, -0.2, -0.3, -0.22, 0.02);
  cubicTo(shape, -0.24, -0.12, -0.3, -0.26, -0.5, -0.44);
  cubicTo(shape, -0.44, -0.1, -0.56, 0.04, -0.6, 0.28);
  cubicTo(shape, -0.66, 0.62, -0.42, 0.92, 0, 0.92);
  shape.length -= 2;
  const inner: number[] = [0, 0.78];
  cubicTo(inner, 0.26, 0.78, 0.36, 0.56, 0.3, 0.36);
  cubicTo(inner, 0.24, 0.16, 0.08, 0.06, 0, -0.3);
  cubicTo(inner, -0.08, 0.06, -0.24, 0.16, -0.3, 0.36);
  cubicTo(inner, -0.36, 0.56, -0.26, 0.78, 0, 0.78);
  inner.length -= 2;
  const core: number[] = [0, 0.66];
  cubicTo(core, 0.16, 0.66, 0.22, 0.52, 0.18, 0.4);
  cubicTo(core, 0.14, 0.28, 0.05, 0.2, 0, -0.04);
  cubicTo(core, -0.05, 0.2, -0.14, 0.28, -0.18, 0.4);
  cubicTo(core, -0.22, 0.52, -0.16, 0.66, 0, 0.66);
  core.length -= 2;
  return [outer(shape), hole(inner), outer(core)];
}

function tree(): Ring[] {
  // A broad lobed crown over a trunk whose roots spread at the foot.
  const crown = radialUnionPoints([
    [0, -0.44, 0.38], [-0.34, -0.58, 0.25], [0.34, -0.58, 0.25], [-0.15, -0.8, 0.2], [0.15, -0.8, 0.2],
    [-0.52, -0.3, 0.22], [0.52, -0.3, 0.22], [-0.3, -0.1, 0.24], [0.3, -0.1, 0.24], [0, -0.06, 0.26],
  ], 0, -0.42, 192);
  return [
    outer(crown),
    outer([
      -0.11, -0.12, 0.11, -0.12, 0.09, 0.5, 0.18, 0.66, 0.42, 0.8, 0.5, 0.9, 0.3, 0.88, 0.12, 0.76, 0.06, 0.93,
      -0.06, 0.93, -0.12, 0.76, -0.3, 0.88, -0.5, 0.9, -0.42, 0.8, -0.18, 0.66, -0.09, 0.5,
    ]),
  ];
}

function crown(): Ring[] {
  const tips: [number, number][] = [[-0.8, -0.4], [-0.42, -0.56], [0, -0.74], [0.42, -0.56], [0.8, -0.4]];
  const rings: Ring[] = [
    outer([
      -0.72, 0.64, -0.8, -0.4, -0.58, 0.0, -0.42, -0.56, -0.2, -0.04, 0, -0.74, 0.2, -0.04,
      0.42, -0.56, 0.58, 0.0, 0.8, -0.4, 0.72, 0.64,
    ]),
    hole(rectPoints(-0.7, 0.24, 0.7, 0.31)),
    hole(circlePoints(-0.4, 0.475, 0.07, 18)),
    hole([0, 0.38, 0.09, 0.475, 0, 0.57, -0.09, 0.475]),
    hole(circlePoints(0.4, 0.475, 0.07, 18)),
  ];
  for (const [x, y] of tips) rings.push(outer(circlePoints(x, y - 0.06, 0.1, 22)));
  return rings;
}

const CHARGE_BUILDERS: Readonly<Record<Exclude<HeraldicCharge, "none">, () => Ring[]>> = {
  crown, tower, key, sword, sun, eclipse, mullet, cog, flame, tree, pawn,
};

const cache = new Map<HeraldicCharge, readonly Ring[]>();

/** The charge's rings in its [-1, 1] box. Built once per charge and shared read-only. */
export function chargeRings(charge: HeraldicCharge): readonly Ring[] {
  if (charge === "none") return [];
  let rings = cache.get(charge);
  if (!rings) {
    rings = CHARGE_BUILDERS[charge]();
    cache.set(charge, rings);
  }
  return rings;
}
