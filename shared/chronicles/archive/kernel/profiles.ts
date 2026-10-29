// Moulding profiles: 2D outlines that lathes and sweeps turn into stone. A
// profile runs from the bottom up; x is the offset outward from the reference
// face and y is the height. Each point records whether the surface is smooth
// across it (normals averaged) or creased (normals split).
//
// The classical elements are here: fillet, step, torus, scotia, cavetto,
// ovolo, cyma recta and reversa, astragal and chamfer (bevel). Curved
// elements take their segment counts from the quality tier.

import type { ArchiveQuality } from "../types";
import { profileSegments } from "./quality";

export interface Profile {
  /** x (outward offset) and y (height) pairs, bottom first. */
  points: number[];
  /** Per point: true where the surface continues smoothly across it. */
  smooth: boolean[];
}

export class ProfileBuilder {
  private readonly points: number[] = [];
  private readonly smooth: boolean[] = [];

  constructor(private readonly quality: ArchiveQuality, x = 0, y = 0) {
    this.points.push(x, y);
    this.smooth.push(false);
  }

  get x(): number { return this.points[this.points.length - 2]; }
  get y(): number { return this.points[this.points.length - 1]; }

  /** A straight run to an absolute point; creased at both ends. */
  to(x: number, y: number): this {
    this.crease();
    this.points.push(x, y);
    this.smooth.push(false);
    return this;
  }

  /** A vertical face rising `height` (a fillet when small). */
  up(height: number): this { return this.to(this.x, this.y + height); }
  /** Moves outward horizontally: an underside facing down. */
  out(depth: number): this { return this.to(this.x + depth, this.y); }
  /** Moves inward horizontally: a top surface facing up. */
  in(depth: number): this { return this.to(this.x - depth, this.y); }
  /** A fillet: a small flat band, optionally stepped out first. */
  fillet(height: number, step = 0): this { return (step ? this.out(step) : this).up(height); }
  /** A bevel at 45 degrees rising `size`, moving outward (or inward). */
  chamfer(size: number, outward = false): this { return this.to(this.x + (outward ? size : -size), this.y + size); }

  /** A convex half-round bulging outward by `radius`, rising 2 x radius. */
  torus(radius: number): this {
    const x = this.x, y = this.y;
    return this.curve(Math.PI * radius, (t) => { const a = -Math.PI / 2 + Math.PI * t; return [x + radius * Math.cos(a), y + radius + radius * Math.sin(a)]; });
  }

  /** A small torus with a fillet above it. */
  astragal(radius: number, fillet = radius * 0.5): this { return this.torus(radius).up(fillet); }

  /** A concave half-round hollow cut inward by `radius`, rising 2 x radius. */
  scotia(radius: number): this {
    const x = this.x, y = this.y;
    return this.curve(Math.PI * radius, (t) => { const a = -Math.PI / 2 + Math.PI * t; return [x - radius * Math.cos(a), y + radius + radius * Math.sin(a)]; });
  }

  /** A concave quarter round rising `height` and moving `depth` outward (negative: inward). */
  cavetto(height: number, depth = height): this { return this.quarter(depth, height, false); }

  /** A convex quarter round rising `height` and moving `depth` outward (negative: inward). */
  ovolo(height: number, depth = height): this { return this.quarter(depth, height, true); }

  /** An S-curve rising `height` and moving `depth` outward: concave below, convex above (negative depth runs inward). */
  cymaRecta(height: number, depth: number): this {
    return this.cavetto(height / 2, depth / 2).ovolo(height / 2, depth / 2);
  }

  /** An S-curve rising `height` and moving `depth` outward: convex below, concave above. */
  cymaReversa(height: number, depth: number): this {
    return this.ovolo(height / 2, depth / 2).cavetto(height / 2, depth / 2);
  }

  /**
   * A quarter ellipse from the current point to (x + dx, y + dy). Its centre
   * sits at one corner of their box: (x + dx, y) or (x, y + dy). With the
   * material on the -x side, a centre on the outer side makes the curve
   * concave and one on the inner side makes it convex.
   */
  private quarter(dx: number, dy: number, convex: boolean): this {
    const x = this.x, y = this.y;
    const centreBeside = convex ? dx < 0 : dx > 0;
    const length = (Math.PI / 2) * Math.sqrt((dx * dx + dy * dy) / 2);
    return this.curve(length, (t) => {
      const a = (Math.PI / 2) * t;
      return centreBeside ? [x + dx - dx * Math.cos(a), y + dy * Math.sin(a)] : [x + dx * Math.sin(a), y + dy - dy * Math.cos(a)];
    });
  }

  /** Appends a smooth curve sampled at `point(t)` for t in (0, 1], creased at both ends. */
  private curve(length: number, point: (t: number) => [number, number]): this {
    const segments = profileSegments(this.quality, length);
    this.crease();
    for (let index = 1; index <= segments; index++) {
      const [px, py] = point(index / segments);
      this.points.push(px, py);
      this.smooth.push(index < segments);
    }
    return this;
  }

  build(): Profile {
    return { points: this.points.slice(), smooth: this.smooth.slice() };
  }

  private crease(): void {
    this.smooth[this.smooth.length - 1] = false;
  }

}

/** The outward normal of a profile segment travelled upward: (dy, -dx), normalised. */
export function segmentNormal(profile: Profile, segment: number, out: [number, number] = [0, 0]): [number, number] {
  const p = profile.points, i = segment * 2;
  const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
  const length = Math.hypot(dx, dy) || 1;
  out[0] = dy / length;
  out[1] = -dx / length;
  return out;
}

/** Normals at each end of a segment, averaged with the neighbour across smooth points. */
export function segmentEndNormals(profile: Profile, segment: number): [number, number, number, number] {
  const count = profile.points.length / 2 - 1;
  const own = segmentNormal(profile, segment, [0, 0]);
  let [sx, sy] = own, [ex, ey] = own;
  if (segment > 0 && profile.smooth[segment]) {
    const previous = segmentNormal(profile, segment - 1, [0, 0]);
    sx += previous[0]; sy += previous[1];
    const length = Math.hypot(sx, sy) || 1;
    sx /= length; sy /= length;
  }
  if (segment < count - 1 && profile.smooth[segment + 1]) {
    const next = segmentNormal(profile, segment + 1, [0, 0]);
    ex += next[0]; ey += next[1];
    const length = Math.hypot(ex, ey) || 1;
    ex /= length; ey /= length;
  }
  return [sx, sy, ex, ey];
}

/** Cumulative length along a profile at each point. */
export function profileLengths(profile: Profile): number[] {
  const lengths = [0], p = profile.points;
  for (let index = 2; index < p.length; index += 2) lengths.push(lengths[lengths.length - 1] + Math.hypot(p[index] - p[index - 2], p[index + 1] - p[index - 1]));
  return lengths;
}

/** Scales a profile's offsets and heights. */
export function scaleProfile(profile: Profile, sx: number, sy = sx): Profile {
  return { points: profile.points.map((value, index) => value * (index % 2 ? sy : sx)), smooth: profile.smooth.slice() };
}

/** The named mouldings of the archive's language, built for a quality tier. Heights in metres. */
export const MOULDINGS = {
  /** Pier and wall base: plinth step, a large torus, a scotia and a small torus, then the face. */
  base(quality: ArchiveQuality, scale = 1): Profile {
    const s = scale;
    return new ProfileBuilder(quality, 0.16 * s, 0)
      .up(0.34 * s).chamfer(0.03 * s).in(0.02 * s)
      .torus(0.055 * s).fillet(0.012 * s, -0.0)
      .in(0.025 * s).scotia(0.03 * s).fillet(0.01 * s)
      .torus(0.035 * s).in(0.03 * s).to(0, 0.66 * s).build();
  },
  /** Impost band where the arches spring: a fillet, an ovolo and an abacus. */
  impost(quality: ArchiveQuality, scale = 1): Profile {
    const s = scale;
    return new ProfileBuilder(quality, 0, 0)
      .fillet(0.02 * s).cavetto(0.1 * s, 0.07 * s).fillet(0.02 * s).ovolo(0.08 * s, 0.05 * s).up(0.1 * s).chamfer(0.025 * s).to(0, 0.35 * s).build();
  },
  /** String course: a projecting band with a weathered top. */
  string(quality: ArchiveQuality, height = 0.3): Profile {
    return new ProfileBuilder(quality, 0, 0)
      .cavetto(height * 0.35, height * 0.35).up(height * 0.3).ovolo(height * 0.2, -height * 0.12).to(0, height).build();
  },
  /** Main cornice: bed mouldings, a corona with a drip, and a cyma crown. */
  cornice(quality: ArchiveQuality, height = 0.6): Profile {
    const h = height;
    return new ProfileBuilder(quality, 0, 0)
      .fillet(h * 0.05).cymaReversa(h * 0.16, h * 0.12).fillet(h * 0.04, h * 0.03).out(h * 0.18).up(h * 0.22)
      .fillet(h * 0.04, h * 0.03).cymaRecta(h * 0.26, h * 0.2).up(h * 0.05).to(0, h).build();
  },
  /** The roll along an arch's intrados edge. */
  archRoll(quality: ArchiveQuality, radius = 0.075): Profile {
    return new ProfileBuilder(quality, 0, 0).fillet(radius * 0.4).torus(radius).fillet(radius * 0.4).build();
  },
  /** The hood moulding over an arch's extrados. */
  hood(quality: ArchiveQuality, height = 0.2): Profile {
    return new ProfileBuilder(quality, 0, 0).cavetto(height * 0.4, height * 0.35).up(height * 0.25).ovolo(height * 0.35, -height * 0.35).build();
  },
  /** Plinth cornice for the monument. */
  plinthCap(quality: ArchiveQuality, height = 0.16): Profile {
    const h = height;
    return new ProfileBuilder(quality, 0, 0).fillet(h * 0.1).cymaRecta(h * 0.45, h * 0.4).up(h * 0.3).chamfer(h * 0.15).to(0, h).build();
  },
};
