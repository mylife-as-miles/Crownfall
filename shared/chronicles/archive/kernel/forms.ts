// The archive's built forms, composed from the kernel primitives: piers,
// arcade arches, mouldings that wrap the chamber, the gallery, the vault with
// its ribs and oculus, bays, the floor, lamps, the rings, the dial, the dais,
// the stelae and the monument's plinth. Each is a generator that writes into a
// MeshWriter and yields between its parts, so a platform can build within a
// frame budget. Frames are documented per form; slots map to the blueprint
// element's material ids in order.

import type { ArchiveQuality, MechanismRing, Vec2 } from "../types";
import { MeshWriter } from "./mesh";
import { MOULDINGS, ProfileBuilder, scaleProfile } from "./profiles";
import {
  annulus, archCurve, archHeightAt, bevelBox, face, lathe, prism, rod, sweepFrames, sweepPolygon, type ArchShape, type P2, type P3, type SweepFrame,
} from "./primitives";
import { arcSegments, TESSELLATION } from "./quality";
import { meridianAt, vaultMeridian, vaultRadiusAt, type VaultShape } from "./vault-profile";

/** Numbers the forms read from the blueprint's geometry (ARCHIVE_GEOMETRY). */
export interface FormGeometry {
  sides: number;
  pierRadius: number;
  apothem: number;
  sideLength: number;
  span: number;
  pier: { width: number; inner: number; outer: number };
  levels: { floor: number; impost: number; springing: number; string: number; gallery: number; cornice: number; vault: number; arcadeCrown: number; crown: number; landing: number };
  arch: { radiusFactor: number; wallInner: number; wallOuter: number; voussoirDepth: number; voussoirs: number; radius: number; rise: number; stilt: number };
  vault: VaultShape;
  entrance: { steps: number; rise: number; run: number; start: number };
  lampHeight: number;
}

export interface FormContext {
  writer: MeshWriter;
  quality: ArchiveQuality;
  geometry: FormGeometry;
  /** Registers one copy of a small prototype for instanced drawing, in the form's local frame. */
  instance?: (prototype: string, position: P3, yaw: number) => void;
}

type Matrix = readonly number[];
const rotX = (a: number): Matrix => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number): Matrix => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const cutJoints = (quality: ArchiveQuality) => TESSELLATION[quality].cutJoints;

/**
 * The pier plan (local -Z toward the chamber centre, local +X toward lower
 * bearings): a kite whose jamb faces stand square to the two arcade sides.
 */
export function pierPlanFor(g: FormGeometry): P2[] {
  const half = Math.PI / g.sides;
  const jt = (g.pier.width / 2) * Math.cos(half), jr = -(g.pier.width / 2) * Math.sin(half);
  const along = (r: number) => jt + (Math.sin(half) * (r - jr)) / Math.cos(half);
  const inner = along(-g.pier.inner), outer = along(g.pier.outer);
  return [[inner, -g.pier.inner], [outer, g.pier.outer], [-outer, g.pier.outer], [-inner, -g.pier.inner]];
}

const ARCADE = (g: FormGeometry): ArchShape => ({ kind: "pointed", span: g.span, radiusFactor: g.arch.radiusFactor });

// ---------------------------------------------------------------------------
// Pier: local frame at its octagon corner. Slots: 0 body, 1 mouldings and capitals, 2 bronze, 3 niche back.

export function* pierForm(ctx: FormContext, niche: boolean): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const plan = pierPlanFor(g);
  sweepPolygon(w, 1, MOULDINGS.base(q), plan, 0, false);
  prism(w, 0, plan, 0.66, g.levels.vault, { top: false, bottom: false });
  yield;
  sweepPolygon(w, 1, MOULDINGS.impost(q), plan, g.levels.impost - 0.35, false);
  yield;
  // The engaged shaft on the inner face rises into the vault rib.
  const shaftBottom = niche ? 3.55 : 0.66;
  const shaft = new ProfileBuilder(q, niche ? 0.02 : 0.44, shaftBottom);
  if (niche) shaft.to(0.12, shaftBottom).cavetto(0.32, 0.26).fillet(0.04, 0.04).in(0.04);
  else shaft.up(0.12).chamfer(0.02).in(0.02).torus(0.045).in(0.02).scotia(0.025).fillet(0.01).in(0.025);
  shaft.to(0.34, shaft.y).up(g.levels.cornice - 0.1 - shaft.y).astragal(0.025, 0.02).cavetto(0.36, 0.17).fillet(0.03).out(0.05).up(0.16).chamfer(0.025).in(0.55);
  lathe(w, 1, q, shaft.build(), { arc: Math.PI, phase: -Math.PI / 2, center: [0, 0, -g.pier.inner] });
  yield;
  if (niche) {
    // An aedicule framing an empty niche: back panel, pilasters, sill and a round head.
    const z = -g.pier.inner, depth = 0.2, width = 1.1, bottom = 0.6, top = 3.1;
    face(w, 3, [[-width / 2, bottom, z - 0.02], [width / 2, bottom, z - 0.02], [width / 2, top - width / 2, z - 0.02], [-width / 2, top - width / 2, z - 0.02]], [0, 0, -1]);
    for (const side of [-1, 1]) bevelBox(w, 0, side * (width / 2 + 0.08), (bottom + top) / 2 - 0.25, z - depth / 2, 0.16, top - bottom - 0.5, depth, 0.02);
    bevelBox(w, 1, 0, bottom - 0.06, z - depth / 2 - 0.02, width + 0.42, 0.12, depth + 0.06, 0.02);
    const head: SweepFrame[] = [];
    const segments = arcSegments(q, Math.PI, width / 2);
    for (let index = 0; index <= segments; index++) {
      const a = Math.PI - (Math.PI * index) / segments;
      head.push({ p: [Math.cos(a) * (width / 2 + 0.08), top - width / 2 + Math.sin(a) * (width / 2 + 0.08), z], n: [0, 0, -1], b: [Math.cos(a), Math.sin(a), 0] });
    }
    sweepFrames(w, 1, new ProfileBuilder(q, 0, -0.08).up(0.02).out(0.12).ovolo(0.06, 0.06).up(0.04).in(0.18).build(), head);
    // The niche's curved back under its head.
    const back: [number, number][] = [];
    for (let index = 0; index <= segments; index++) {
      const a = Math.PI - (Math.PI * index) / segments;
      back.push([Math.cos(a) * width / 2, top - width / 2 + Math.sin(a) * width / 2]);
    }
    for (let index = 0; index < back.length - 1; index++) {
      face(w, 3, [[back[index][0], top - width / 2, z - 0.02], [back[index + 1][0], top - width / 2, z - 0.02], [back[index + 1][0], back[index + 1][1], z - 0.02], [back[index][0], back[index][1], z - 0.02]], [0, 0, -1]);
    }
  }
}

// ---------------------------------------------------------------------------
// Arcade arch: side frame (x along the side, +Z outward, the chamber at -Z).
// Slots: 0 wall and voussoirs, 1 accent (keystone), 2 mouldings.

export function* arcadeArchForm(ctx: FormContext): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const shape = ARCADE(g), half = g.span / 2, ys = g.levels.springing, top = g.levels.string;
  const zf = -g.arch.wallInner, zb = g.arch.wallOuter, depth = g.arch.voussoirDepth;
  const intrados = archCurve(q, shape), extrados = archCurve(q, shape, depth);
  // Voussoirs: equal arcs along the intrados, joints radial from each half's centre.
  const lengths = [0];
  for (let index = 1; index < intrados.points.length; index++) {
    lengths.push(lengths[index - 1] + Math.hypot(intrados.points[index][0] - intrados.points[index - 1][0], intrados.points[index][1] - intrados.points[index - 1][1]));
  }
  const total = lengths[lengths.length - 1], count = g.arch.voussoirs, gap = cutJoints(q) ? 0.012 : 0;
  const at = (s: number): { p: [number, number]; c: [number, number] } => {
    let index = 1;
    while (index < lengths.length - 1 && lengths[index] < s) index++;
    const t = (s - lengths[index - 1]) / Math.max(1e-9, lengths[index] - lengths[index - 1]);
    const a = intrados.points[index - 1], b = intrados.points[index];
    const c = s <= total / 2 ? intrados.centres[0] : intrados.centres[intrados.centres.length - 1];
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], c };
  };
  const outward = (p: [number, number], c: [number, number]): [number, number] => {
    const dx = p[0] - c[0], dy = p[1] - c[1], length = Math.hypot(dx, dy) || 1;
    return [dx / length, dy / length];
  };
  for (let index = 0; index < count; index++) {
    // The keystone is a little wider than the rest.
    const weight = (k: number) => (k === (count - 1) / 2 ? 1.35 : 1);
    let before = 0, sum = 0;
    for (let k = 0; k < count; k++) { if (k < index) before += weight(k); sum += weight(k); }
    const s0 = (before / sum) * total + gap / 2, s1 = ((before + weight(index)) / sum) * total - gap / 2;
    const steps = Math.max(1, Math.round(((s1 - s0) / total) * (intrados.points.length - 1)));
    const inner: [number, number][] = [], outer: [number, number][] = [];
    for (let step = 0; step <= steps; step++) {
      const { p, c } = at(s0 + ((s1 - s0) * step) / steps);
      const n = outward(p, c);
      inner.push([p[0], ys + p[1]]);
      outer.push([p[0] + n[0] * depth, ys + p[1] + n[1] * depth]);
    }
    const slot = index === (count - 1) / 2 ? 1 : 0;
    const proud = slot === 1 ? 0.05 : 0;
    for (let step = 0; step < steps; step++) {
      // Front, back and soffit of the voussoir.
      face(w, slot, [[inner[step][0], inner[step][1], zf - proud], [inner[step + 1][0], inner[step + 1][1], zf - proud], [outer[step + 1][0], outer[step + 1][1], zf - proud], [outer[step][0], outer[step][1], zf - proud]], [0, 0, -1]);
      face(w, slot, [[inner[step][0], inner[step][1], zb], [inner[step + 1][0], inner[step + 1][1], zb], [outer[step + 1][0], outer[step + 1][1], zb], [outer[step][0], outer[step][1], zb]], [0, 0, 1]);
      const mx = (inner[step][0] + inner[step + 1][0]) / 2, my = (inner[step][1] + inner[step + 1][1]) / 2;
      const c = at(s0 + ((s1 - s0) * (step + 0.5)) / steps).c;
      const n = outward([mx, my - ys], c);
      face(w, slot, [[inner[step][0], inner[step][1], zf - proud], [inner[step + 1][0], inner[step + 1][1], zf - proud], [inner[step + 1][0], inner[step + 1][1], zb], [inner[step][0], inner[step][1], zb]], [-n[0], -n[1], 0]);
      if (proud > 0) face(w, slot, [[outer[step][0], outer[step][1], zf - proud], [outer[step + 1][0], outer[step + 1][1], zf - proud], [outer[step + 1][0], outer[step + 1][1], zf], [outer[step][0], outer[step][1], zf]], [n[0], n[1], 0]);
      // The extrados, closed where no spandrel covers it (beyond the jambs, inside the piers).
      if (Math.max(Math.abs(outer[step][0]), Math.abs(outer[step + 1][0])) > half - 1e-6) {
        face(w, slot, [[outer[step][0], outer[step][1], zf - proud], [outer[step + 1][0], outer[step + 1][1], zf - proud], [outer[step + 1][0], outer[step + 1][1], zb], [outer[step][0], outer[step][1], zb]], [n[0], n[1], 0]);
      }
    }
    // Joint faces show only where the joints are cut.
    if (gap > 0 || proud > 0) {
      for (const [k, sign] of [[0, -1], [steps, 1]] as const) {
        const tx = outer[k][0] - inner[k][0], ty = outer[k][1] - inner[k][1];
        face(w, slot, [[inner[k][0], inner[k][1], zf - proud], [outer[k][0], outer[k][1], zf - proud], [outer[k][0], outer[k][1], zb], [inner[k][0], inner[k][1], zb]], [sign * ty, -sign * tx, 0]);
      }
    }
  }
  yield;
  // Spandrels front and back: vertical strips from the extrados (or the springing) up to the string course.
  const columns: [number, number][] = [[-half, ys + archHeightAt(shape, -half, depth)]];
  for (const point of extrados.points) if (Math.abs(point[0]) < half) columns.push([point[0], ys + point[1]]);
  columns.push([half, ys + archHeightAt(shape, half, depth)]);
  for (let index = 0; index < columns.length - 1; index++) {
    const [x0, y0] = columns[index], [x1, y1] = columns[index + 1];
    face(w, 0, [[x0, y0, zf], [x1, y1, zf], [x1, top, zf], [x0, top, zf]], [0, 0, -1]);
    face(w, 0, [[x0, y0, zb], [x1, y1, zb], [x1, top, zb], [x0, top, zb]], [0, 0, 1]);
  }
  // Between the impost and the springing the jambs continue as the stilt.
  for (const side of [-1, 1]) {
    face(w, 0, [[side * half, g.levels.impost, zf], [side * half, ys, zf], [side * half, ys, zb], [side * half, g.levels.impost, zb]], [-side, 0, 0]);
  }
  yield;
  // An arris roll along the front edge of the intrados, and a hood over the extrados.
  const roll = new ProfileBuilder(q, 0, -0.075).torus(0.075).build();
  sweepFrames(w, 2, roll, intrados.points.map((point, index) => {
    const n = outward(point, intrados.centres[index]);
    return { p: [point[0], ys + point[1], zf], n: [-n[0] * 0.7071, -n[1] * 0.7071, -0.7071], b: [n[0] * 0.7071, n[1] * 0.7071, -0.7071] } as SweepFrame;
  }));
  const hoodPoints = extrados.points.map((point, index) => ({ point, centre: extrados.centres[index] })).filter(({ point }) => Math.abs(point[0]) <= half + 0.12);
  sweepFrames(w, 2, MOULDINGS.hood(q, 0.2), hoodPoints.map(({ point, centre }) => {
    const n = outward(point, centre);
    return { p: [point[0], ys + point[1], zf], n: [0, 0, -1], b: [n[0], n[1], 0] } as SweepFrame;
  }));
}

// ---------------------------------------------------------------------------
// Mouldings that wrap the chamber's inner outline, around every pier. World frame. Slot 0.

/** The chamber's inner outline at the wall face, wrapping each pier, by increasing bearing. */
export function chamberOutline(g: FormGeometry): Vec2[] {
  const plan = pierPlanFor(g), step = (Math.PI * 2) / g.sides, half = Math.PI / g.sides, out: Vec2[] = [];
  // Each jamb face runs square to its side, so the wall face (wallInner inside the arcade plane) meets it this far in from the springer.
  const jt = (g.pier.width / 2) * Math.cos(half), jr = -(g.pier.width / 2) * Math.sin(half);
  const wx = jt - Math.sin(half) * g.arch.wallInner, wz = jr - Math.cos(half) * g.arch.wallInner;
  for (let vertex = 0; vertex < g.sides; vertex++) {
    const bearing = vertex * step + step / 2;
    const vx = Math.sin(bearing) * g.pierRadius, vz = -Math.cos(bearing) * g.pierRadius;
    const yaw = -(bearing + Math.PI), c = Math.cos(yaw), s = Math.sin(yaw);
    const world = (x: number, z: number): Vec2 => [vx + x * c + z * s, vz - x * s + z * c];
    out.push(world(wx, wz), world(plan[0][0], plan[0][1]), world(plan[3][0], plan[3][1]), world(-wx, wz));
  }
  return out;
}

export function* chamberMouldingForm(ctx: FormContext, kind: "string" | "cornice", y: number, height: number): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const profile = kind === "string" ? MOULDINGS.string(q, height) : MOULDINGS.cornice(q, height);
  sweepPolygon(w, 0, profile, chamberOutline(g), y, true);
  yield;
}

// ---------------------------------------------------------------------------
// Gallery: side frame. A ledge, an arcade of three openings with balustrades,
// and the dark passage behind. Slots: 0 wall, 1 passage, 2 bronze, 3 mouldings.

export function* galleryForm(ctx: FormContext): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const half = g.span / 2, y0 = g.levels.gallery, y1 = g.levels.cornice;
  const zf = -g.arch.wallInner, zb = 0.3, passage = 1.6;
  const openings = [-1.95, 0, 1.95], width = 1.36, spring = 11.72, shape: ArchShape = { kind: "segmental", span: width, rise: 0.36 };
  const curve = archCurve(q, shape);
  // Ledge in front of the arcade.
  bevelBox(w, 3, 0, y0 - 0.07, zf - 0.17, g.span, 0.14, 0.34, 0.03);
  // Front and back faces around the openings, as columns of quads.
  const edges = [-half, ...openings.flatMap((x) => [x - width / 2, x + width / 2]), half];
  for (const z of [zf, zb]) {
    const normal: P3 = [0, 0, z === zf ? -1 : 1];
    for (let index = 0; index < edges.length - 1; index += 2) face(w, 0, [[edges[index], y0, z], [edges[index + 1], y0, z], [edges[index + 1], y1, z], [edges[index], y1, z]], normal);
    for (const x of openings) {
      for (let index = 0; index < curve.points.length - 1; index++) {
        const [ax, ay] = curve.points[index], [bx, by] = curve.points[index + 1];
        face(w, 0, [[x + ax, spring + ay, z], [x + bx, spring + by, z], [x + bx, y1, z], [x + ax, y1, z]], normal);
      }
    }
  }
  // Reveals: jambs and the arched soffit of each opening.
  for (const x of openings) {
    for (const side of [-1, 1]) face(w, 0, [[x + side * width / 2, y0, zf], [x + side * width / 2, spring, zf], [x + side * width / 2, spring, zb], [x + side * width / 2, y0, zb]], [-side, 0, 0]);
    for (let index = 0; index < curve.points.length - 1; index++) {
      const [ax, ay] = curve.points[index], [bx, by] = curve.points[index + 1];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, c = curve.centres[index];
      const nx = c[0] - mx, ny = c[1] - my, length = Math.hypot(nx, ny) || 1;
      face(w, 0, [[x + ax, spring + ay, zf], [x + bx, spring + by, zf], [x + bx, spring + by, zb], [x + ax, spring + ay, zb]], [nx / length, ny / length, 0]);
    }
  }
  yield;
  // The passage behind: floor, back wall and ceiling, unlit and dark.
  face(w, 1, [[-half, y0, zb], [half, y0, zb], [half, y0, passage], [-half, y0, passage]], [0, 1, 0]);
  face(w, 1, [[-half, y0, passage], [half, y0, passage], [half, y1, passage], [-half, y1, passage]], [0, 0, -1]);
  face(w, 1, [[-half, y1, zb], [half, y1, zb], [half, y1, passage], [-half, y1, passage]], [0, -1, 0]);
  for (const side of [-1, 1]) face(w, 1, [[side * half, y0, zb], [side * half, y0, passage], [side * half, y1, passage], [side * half, y1, zb]], [-side, 0, 0]);
  yield;
  // Balustrades inside each opening: a base, balusters (instanced where the tier has them) and a rail.
  const density = TESSELLATION[q].balusterDensity, zm = (zf + zb) / 2 - 0.15;
  for (const x of openings) {
    bevelBox(w, 3, x, y0 + 0.06, zm, width, 0.12, 0.26, 0.015);
    bevelBox(w, 2, x, y0 + 0.92, zm, width, 0.07, 0.2, 0.015);
    if (density > 0 && ctx.instance) {
      const count = Math.max(3, Math.round(width * density));
      for (let k = 0; k < count; k++) ctx.instance("baluster", [x - width / 2 + (width * (k + 0.5)) / count, y0 + 0.12, zm], 0);
    } else {
      bevelBox(w, 3, x, y0 + 0.5, zm, width - 0.04, 0.68, 0.12, 0.01);
    }
  }
}

/** One baluster, its foot at the origin: a turned vase between two blocks. Slot 0. */
export function balusterForm(writer: MeshWriter, quality: ArchiveQuality): void {
  const profile = new ProfileBuilder(quality, 0, 0).to(0.05, 0).up(0.05).in(0.012).ovolo(0.2, 0.02).cavetto(0.26, -0.035).up(0.06).torus(0.012).in(0.008).cavetto(0.08, 0.025).up(0.04).to(0, 0.76).build();
  lathe(writer, 0, quality, profile, { caps: true, segments: quality === "high" ? 8 : 6 });
}

// ---------------------------------------------------------------------------
// Vault: shell, ribs, oculus ring, tracery and sky. World frame.

export function* vaultShellForm(ctx: FormContext): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const t = TESSELLATION[q], meridian = vaultMeridian(g.vault);
  const rings = t.vaultRings, around = g.sides * t.vaultWebSegments;
  const point = (k: number, s: number, out: number[]) => {
    const bearing = (k / around) * Math.PI * 2;
    const radius = vaultRadiusAt(g.vault, meridian, bearing, s), [, y] = meridianAt(meridian, s, [0, 0]);
    out[0] = Math.sin(bearing) * radius; out[1] = y; out[2] = -Math.cos(bearing) * radius;
    return out;
  };
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const base = w.vertexCount;
  let along = 0;
  for (let ring = 0; ring <= rings; ring++) {
    const s = ring / rings;
    if (ring > 0) {
      point(0, (ring - 1) / rings, a);
      point(0, s, b);
      along += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    for (let k = 0; k <= around; k++) {
      point(k, s, a);
      // Normal from the surface's two tangents, turned to face the chamber.
      point(k + 0.25, s, b);
      point(k, Math.min(1, s + 0.01), c);
      const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      let ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      if (s >= 1) { point(k, s - 0.01, c); ux = a[0] - c[0]; uy = a[1] - c[1]; uz = a[2] - c[2]; }
      let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      if (nx * a[0] + nz * a[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
      const bearing = (k / around) * Math.PI * 2, radius = Math.hypot(a[0], a[2]);
      w.vertex(a[0], a[1], a[2], nx, ny, nz, bearing * radius, along);
    }
    if (ring % 4 === 3) yield;
  }
  const frieze = Math.max(1, Math.round(rings * 0.14));
  for (let ring = 0; ring < rings; ring++) {
    for (let k = 0; k < around; k++) {
      const v0 = base + ring * (around + 1) + k;
      w.orientQuad(ring < frieze ? 1 : 0, v0, v0 + 1, v0 + around + 2, v0 + around + 1);
    }
  }
  yield;
  yield* vaultCoffers(ctx, meridian);
}

/**
 * The vault's coffering: over each web between two ribs, a stepped grid of
 * dressed-stone bands (slot 2) divides the shell into coffers, three across, that diminish
 * toward the oculus, from above the carved frieze to where the oculus ring's
 * soffit takes over; a small bronze star boss (slot 3) sits in each coffer.
 * The bands stand proud of the shell, so each coffer reads as recessed.
 */
function* vaultCoffers(ctx: FormContext, meridian: ReturnType<typeof vaultMeridian>): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const quest = q === "quest";
  const rows = quest ? 3 : 4, step = (Math.PI * 2) / g.sides;
  const ribHalf = 0.2;
  // Where the oculus ring's soffit (out to the oculus radius plus 0.9 m) gives way to the shell, with the top band clear of it.
  const soffit = g.vault.oculusRadius + 1.25;
  let lo = 0, hi = 1;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (lo + hi) / 2;
    if (vaultRadiusAt(g.vault, meridian, 0, mid) > soffit) lo = mid; else hi = mid;
  }
  const sStart = 0.16, sEnd = lo;
  // Row boundaries shrink by a constant ratio toward the top, so the coffers diminish.
  const ratio = 0.82, weights = Array.from({ length: rows }, (_, row) => ratio ** row), total = weights.reduce((sum, value) => sum + value, 0);
  const bounds = [sStart];
  for (const weight of weights) bounds.push(bounds[bounds.length - 1] + ((sEnd - sStart) * weight) / total);
  // The shell surface, its inward normal and its tangents at a bearing and share.
  type V3 = [number, number, number];
  const surface = (bearing: number, share: number): V3 => {
    const radius = vaultRadiusAt(g.vault, meridian, bearing, share), [, y] = meridianAt(meridian, share, [0, 0]);
    return [Math.sin(bearing) * radius, y, -Math.cos(bearing) * radius];
  };
  const frame = (bearing: number, share: number): { p: V3; n: V3; tb: V3; ts: V3 } => {
    const p = surface(bearing, share);
    const pb = surface(bearing + 0.002, share), pm = surface(bearing - 0.002, share);
    const ps = surface(bearing, Math.min(1, share + 0.002)), pn = surface(bearing, Math.max(0, share - 0.002));
    const tb: V3 = [pb[0] - pm[0], pb[1] - pm[1], pb[2] - pm[2]], ts: V3 = [ps[0] - pn[0], ps[1] - pn[1], ps[2] - pn[2]];
    const lb = Math.hypot(tb[0], tb[1], tb[2]) || 1, ls = Math.hypot(ts[0], ts[1], ts[2]) || 1;
    for (let k = 0; k < 3; k++) { tb[k] /= lb; ts[k] /= ls; }
    // Inward: the cross product of the two tangents, turned toward the axis.
    const n: V3 = [tb[1] * ts[2] - tb[2] * ts[1], tb[2] * ts[0] - tb[0] * ts[2], tb[0] * ts[1] - tb[1] * ts[0]];
    const ln = (Math.hypot(n[0], n[1], n[2]) || 1) * (n[0] * p[0] + n[2] * p[2] > 0 ? -1 : 1);
    for (let k = 0; k < 3; k++) n[k] /= ln;
    return { p, n, tb, ts };
  };
  const band = quest
    ? new ProfileBuilder(q, 0, -0.18).to(0.13, -0.12).to(0.13, 0.12).to(0, 0.18).build()
    : new ProfileBuilder(q, 0, -0.19).to(0.06, -0.19).to(0.06, -0.13).to(0.15, -0.11).to(0.15, 0.11).to(0.06, 0.13).to(0.06, 0.19).to(0, 0.19).build();
  const cell = TESSELLATION[q].cell * (quest ? 1.4 : 1.6);
  for (let web = 0; web < g.sides; web++) {
    const centre = web * step;
    // Bands run between the ribs, which stand at the octagon's corners (half a step either side).
    const edge = (share: number) => (step / 2) - ribHalf / vaultRadiusAt(g.vault, meridian, centre + step / 2, share);
    // Horizontal bands at each row boundary.
    for (const share of bounds) {
      const half = edge(share), radius = vaultRadiusAt(g.vault, meridian, centre, share);
      const count = Math.max(3, Math.ceil((2 * half * radius) / cell));
      const frames: SweepFrame[] = [];
      for (let index = 0; index <= count; index++) {
        const f = frame(centre - half + (2 * half * index) / count, share);
        frames.push({ p: f.p, n: f.n, b: f.ts });
      }
      sweepFrames(w, 2, band, frames);
    }
    // Two bands up the web divide each row into three coffers; they follow the web as it narrows.
    for (const third of [-1 / 3, 1 / 3]) {
      const count = Math.max(4, Math.ceil(((sEnd - sStart) * meridian.radius * Math.abs(meridian.t1 - meridian.t0)) / cell));
      const frames: SweepFrame[] = [];
      for (let index = 0; index <= count; index++) {
        const share = sStart + ((sEnd - sStart) * index) / count;
        const f = frame(centre + third * edge(share), share);
        frames.push({ p: f.p, n: f.n, b: f.tb });
      }
      sweepFrames(w, 2, band, frames);
    }
    // A bronze star boss at the heart of each coffer.
    const boss = new ProfileBuilder(q, 0.15, 0).up(0.015).to(0.09, 0.05).to(0.035, 0.07).to(0, 0.078).build();
    const segments = quest ? 8 : q === "high" ? 16 : 12;
    for (let row = 0; row < rows; row++) {
      const share = (bounds[row] + bounds[row + 1]) / 2, half = edge(share);
      for (const column of [-2 / 3, 0, 2 / 3]) {
        const f = frame(centre + column * half, share);
        const start = w.vertexCount;
        lathe(w, 3, q, boss, { segments, caps: false });
        // Local y along the inward normal, x along the bearing tangent and z down the meridian (a right-handed frame, so faces keep their winding).
        const m = [f.tb[0], f.n[0], -f.ts[0], f.tb[1], f.n[1], -f.ts[1], f.tb[2], f.n[2], -f.ts[2]];
        w.transformFrom(start, m, [f.p[0] - f.n[0] * 0.005, f.p[1] - f.n[1] * 0.005, f.p[2] - f.n[2] * 0.005]);
      }
    }
    if (web % 2 === 1) yield;
  }
}

export function* vaultRibsForm(ctx: FormContext): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const meridian = vaultMeridian(g.vault), t = TESSELLATION[q];
  const steps = Math.max(8, t.vaultRings);
  // Symmetric about the rib's centre plane: x runs into the chamber, y across the rib.
  const rib = new ProfileBuilder(q, 0, -0.2).to(0.08, -0.2).to(0.3, -0.06).torus(0.06).to(0.08, 0.2).to(0, 0.2).build();
  const springRadius = g.pierRadius - g.pier.inner - 0.17;
  for (let vertex = 0; vertex < g.sides; vertex++) {
    const bearing = ((vertex + 0.5) / g.sides) * Math.PI * 2;
    const ox = Math.sin(bearing), oz = -Math.cos(bearing);
    const frames: SweepFrame[] = [];
    for (let step = 0; step <= steps; step++) {
      const s = step / steps;
      const shell = vaultRadiusAt(g.vault, meridian, bearing, s), [, y] = meridianAt(meridian, s, [0, 0]);
      const inset = (shell - springRadius) * (1 - s) + 0.18 * s;
      const radius = shell - inset;
      // Tangent along the rib from neighbouring samples; the profile's x points into the chamber.
      const s2 = Math.min(1, s + 0.02), s1 = Math.max(0, s - 0.02);
      const r2 = vaultRadiusAt(g.vault, meridian, bearing, s2) - ((vaultRadiusAt(g.vault, meridian, bearing, s2) - springRadius) * (1 - s2) + 0.18 * s2);
      const r1 = vaultRadiusAt(g.vault, meridian, bearing, s1) - ((vaultRadiusAt(g.vault, meridian, bearing, s1) - springRadius) * (1 - s1) + 0.18 * s1);
      const dy = meridianAt(meridian, s2, [0, 0])[1] - meridianAt(meridian, s1, [0, 0])[1], dr = r2 - r1;
      const length = Math.hypot(dy, dr) || 1;
      // Inward normal in the rib's vertical plane: perpendicular to the tangent, toward the axis and down.
      const nr = -dy / length, ny = dr / length;
      const n: P3 = ny > 0 ? [-ox * nr, -ny, -oz * nr] : [ox * nr, ny, oz * nr];
      frames.push({ p: [ox * radius, y - 0.06, oz * radius], n: [n[0], n[1], n[2]], b: [Math.cos(bearing), 0, Math.sin(bearing)] });
    }
    sweepFrames(w, 0, rib, frames);
    if (vertex % 2 === 1) yield;
  }
}

export function* oculusRingForm(ctx: FormContext, radius: number): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  // In the element's frame y = 0 is the crown. Travelled inward over the top, down the inner face
  // (a bronze band between two rolls) and outward along the soffit to meet the shell, so every face looks the right way.
  const r = radius, roll = 0.035;
  const stone = new ProfileBuilder(q, r + 0.9, 0.2).to(r + 0.06, 0.2).to(r, 0.14).build();
  lathe(w, 0, q, stone);
  const band: [number, number][] = [[r, 0.14], [r, 0.06]];
  for (let k = 1; k <= 4; k++) { const a = (Math.PI * k) / 4; band.push([r - Math.sin(a) * roll, 0.06 - (1 - Math.cos(a)) * roll]); }
  band.push([r, -0.14]);
  for (let k = 1; k <= 4; k++) { const a = (Math.PI * k) / 4; band.push([r - Math.sin(a) * roll, -0.14 - (1 - Math.cos(a)) * roll]); }
  const bronze = { points: band.flatMap((point) => [point[0], point[1]]), smooth: band.map((_, index) => (index >= 2 && index <= 4) || (index >= 7 && index <= 9)) };
  lathe(w, 1, q, bronze);
  const soffit = new ProfileBuilder(q, r, -0.21).to(r + 0.08, -0.25).to(r + 0.42, -0.25).to(r + 0.52, -0.34).to(r + 0.9, -0.42).build();
  lathe(w, 0, q, soffit);
  yield;
}

/** The pierced screen: a dappled outer band (alpha-tested, slot 0, polar UVs) and radial bars of dressed stone (slot 1, metre UVs) around an open centre. */
export function* oculusTraceryForm(ctx: FormContext, radius: number, tracery: { open: number; band: readonly [number, number]; bars: number; barWidth: number }): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  const segments = Math.max(24, Math.round(arcSegments(q, Math.PI * 2, radius * 0.5)));
  const inner = radius * tracery.band[0], outer = radius * tracery.band[1] + 0.12, thickness = 0.1;
  // Polar UVs so the screen's alpha pattern follows the band: u around, v across.
  const ring = (y: number, up: 1 | -1) => {
    const base = w.vertexCount;
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      for (const [r, v] of [[inner, 0], [outer, 1]] as const) w.vertex(Math.sin(a) * r, y, -Math.cos(a) * r, 0, up, 0, k / segments, v);
    }
    for (let k = 0; k < segments; k++) w.orientQuad(0, base + k * 2, base + k * 2 + 2, base + k * 2 + 3, base + k * 2 + 1);
  };
  ring(-thickness / 2, -1);
  ring(thickness / 2, 1);
  yield;
  const width = tracery.barWidth * radius;
  for (let bar = 0; bar < tracery.bars; bar++) {
    const a = ((bar + 0.5) / tracery.bars) * Math.PI * 2, start = w.vertexCount;
    const r0 = radius * tracery.open, r1 = inner + 0.05;
    bevelBox(w, 1, 0, 0, -(r0 + r1) / 2, width, thickness * 0.9, r1 - r0, 0.012);
    w.transformFrom(start, rotY(-a));
  }
}

export function* skyDiscForm(ctx: FormContext, radius: number): Generator<void, void, void> {
  annulus(ctx.writer, 0, 0, radius, 0, -1, Math.max(24, arcSegments(ctx.quality, Math.PI * 2, radius * 0.4)), 4);
  yield;
}

// ---------------------------------------------------------------------------
// Bays, the vestibule and the blind recesses: side frame.
// Slots: 0 walls and vault, 1 floor (steps and landing), 2 carved panels, 3 basalt bands, 4 bronze, 5 dressed ribs and frames.

export function* bayForm(ctx: FormContext, depth: number, back: string, floor: string, ribs: number): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const t = TESSELLATION[q], half = g.span / 2, ys = g.levels.springing, z0 = g.arch.wallOuter;
  const shape = ARCADE(g), curve = archCurve(q, shape);
  const low = floor === "steps-down" ? g.levels.landing : 0;
  const cells = Math.max(1, Math.ceil((depth - z0) / t.cell));
  // Side walls, split into cells along the bay for the vertex bake.
  for (const side of [-1, 1]) {
    const x = side * half;
    for (let cell = 0; cell < cells; cell++) {
      const za = z0 + ((depth - z0) * cell) / cells, zb = z0 + ((depth - z0) * (cell + 1)) / cells;
      const rows = Math.max(1, Math.ceil((ys - low) / (t.cell * 1.5)));
      for (let row = 0; row < rows; row++) {
        const ya = low + ((ys - low) * row) / rows, yb = low + ((ys - low) * (row + 1)) / rows;
        face(w, 0, [[x, ya, za], [x, ya, zb], [x, yb, zb], [x, yb, za]], [-side, 0, 0]);
      }
    }
    // A basalt dado along the foot of each wall.
    bevelBox(w, 3, x - side * 0.045, low + 0.16, (z0 + depth) / 2, 0.09, 0.32, depth - z0, 0.02);
  }
  yield;
  // The pointed barrel vault over the bay.
  for (let cell = 0; cell < cells; cell++) {
    const za = z0 + ((depth - z0) * cell) / cells, zb = z0 + ((depth - z0) * (cell + 1)) / cells;
    for (let index = 0; index < curve.points.length - 1; index++) {
      const [ax, ay] = curve.points[index], [bx, by] = curve.points[index + 1];
      const c = curve.centres[index], mx = (ax + bx) / 2, my = (ay + by) / 2;
      const nx = c[0] - mx, ny = c[1] - my, length = Math.hypot(nx, ny) || 1;
      face(w, 0, [[ax, ys + ay, za], [bx, ys + by, za], [bx, ys + by, zb], [ax, ys + ay, zb]], [nx / length, ny / length, 0]);
    }
  }
  yield;
  // Transverse ribs.
  const ribProfile = new ProfileBuilder(q, 0, -0.16).to(0.05, -0.16).ovolo(0.08, 0.07).up(0.16).ovolo(0.08, -0.07).to(0, 0.16).build();
  for (let k = 1; k <= ribs; k++) {
    const z = z0 + ((depth - z0) * k) / (ribs + 1);
    sweepFrames(w, 5, ribProfile, curve.points.map((point, index) => {
      const c = curve.centres[index], nx = c[0] - point[0], ny = c[1] - point[1], length = Math.hypot(nx, ny) || 1;
      return { p: [point[0], ys + point[1], z], n: [nx / length, ny / length, 0], b: [0, 0, 1] } as SweepFrame;
    }));
  }
  // The back wall up to the vault, split into vertical strips under the arch.
  const columns: [number, number][] = curve.points.map((point) => [point[0], ys + point[1]]);
  for (let index = 0; index < columns.length - 1; index++) {
    const [x0, y0] = columns[index], [x1, y1] = columns[index + 1];
    face(w, 0, [[x0, ys, depth], [x1, ys, depth], [x1, y1, depth], [x0, y0, depth]], [0, 0, -1]);
  }
  const rows = Math.max(1, Math.ceil((ys - low) / (t.cell * 1.5))), strips = Math.max(2, Math.ceil(g.span / t.cell));
  for (let row = 0; row < rows; row++) for (let strip = 0; strip < strips; strip++) {
    const xa = -half + (g.span * strip) / strips, xb = -half + (g.span * (strip + 1)) / strips;
    const ya = low + ((ys - low) * row) / rows, yb = low + ((ys - low) * (row + 1)) / rows;
    face(w, 0, [[xa, ya, depth], [xb, ya, depth], [xb, yb, depth], [xa, yb, depth]], [0, 0, -1]);
  }
  yield;
  const frameProfile = new ProfileBuilder(q, 0, 0).fillet(0.03).cavetto(0.07, 0.06).fillet(0.03, 0.02).ovolo(0.06, 0.05).up(0.03).build();
  const rectangleFrame = (cx: number, cy: number, wide: number, high: number) => {
    const plan: P2[] = [[cx - wide / 2, cy - high / 2], [cx + wide / 2, cy - high / 2], [cx + wide / 2, cy + high / 2], [cx - wide / 2, cy + high / 2]];
    const start = w.vertexCount;
    sweepPolygon(w, 5, scaleProfile(frameProfile, 1, 1), plan, 0, false);
    // Laid flat in plan, then stood up onto the back wall: plan z becomes height and the moulding projects toward the chamber.
    w.transformFrom(start, rotX(-Math.PI / 2), [0, 0, depth - 0.005]);
  };
  const roundFrame = (cy: number, radius: number) => {
    const segments = arcSegments(q, Math.PI * 2, radius);
    const frames: SweepFrame[] = [];
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      frames.push({ p: [Math.cos(a) * radius, cy + Math.sin(a) * radius, depth], n: [0, 0, -1], b: [Math.cos(a), Math.sin(a), 0] });
    }
    sweepFrames(w, 5, new ProfileBuilder(q, 0, -0.1).up(0.03).out(0.06).torus(0.05).in(0.06).up(0.03).build(), frames, true);
  };
  if (back === "panel") {
    // A tall carved panel in a moulded frame.
    face(w, 2, [[-1.7, 1.2, depth - 0.01], [1.7, 1.2, depth - 0.01], [1.7, 4.6, depth - 0.01], [-1.7, 4.6, depth - 0.01]], [0, 0, -1]);
    rectangleFrame(0, 2.9, 3.6, 3.6);
  } else if (back === "roundel") {
    // A carved roundel stood up on the back wall, facing the chamber.
    const start = w.vertexCount;
    annulus(w, 2, 0, 1.5, 0, 1, Math.max(24, arcSegments(q, Math.PI * 2, 1.2)), 3);
    w.transformFrom(start, rotX(-Math.PI / 2), [0, 3.0, depth - 0.01]);
    roundFrame(3.0, 1.62);
  } else if (back === "dial-wall") {
    roundFrame(3.15, 1.95);
  } else if (back === "door") {
    // A closed bronze door in a basalt frame: no view beyond.
    for (const side of [-1, 1]) bevelBox(w, 4, side * 0.6, low + 1.65, depth - 0.06, 1.16, 3.3, 0.1, 0.02);
    bevelBox(w, 3, 0, low + 3.45, depth - 0.12, 2.9, 0.3, 0.24, 0.03);
    for (const side of [-1, 1]) bevelBox(w, 3, side * 1.32, low + 1.65, depth - 0.12, 0.26, 3.3, 0.24, 0.03);
  }
  yield;
  if (floor === "steps-down") {
    // Steps descend from the chamber floor to the landing, then the landing runs to the back wall.
    const { steps, rise, run, start } = g.entrance;
    for (let step = 0; step < steps; step++) {
      const za = start + step * run, yTop = -step * rise;
      bevelBox(w, 1, 0, yTop - rise / 2 - 0.0, za + run / 2, g.span, rise, run, 0.012);
    }
    const landing = start + steps * run;
    const cellsL = Math.max(1, Math.ceil((depth - landing) / t.cell));
    for (let cell = 0; cell < cellsL; cell++) {
      const za = landing + ((depth - landing) * cell) / cellsL, zb = landing + ((depth - landing) * (cell + 1)) / cellsL;
      face(w, 1, [[-half, low, za], [half, low, za], [half, low, zb], [-half, low, zb]], [0, 1, 0]);
    }
    // The step faces' sides against the walls are hidden; the floor between the arch and the first step belongs to the chamber floor.
  }
}

// ---------------------------------------------------------------------------
// Floor: world frame. The octagon as subdivided fan triangles, plus each side's floor out to its depth.
// Slots: 0 floor stone, 1 basalt border.

export function* floorForm(ctx: FormContext, sides: readonly { depth: number; kind: string }[]): Generator<void, void, void> {
  const { writer: w, quality: q, geometry: g } = ctx;
  const t = TESSELLATION[q], step = (Math.PI * 2) / g.sides;
  const n = Math.max(2, Math.ceil(g.pierRadius / t.cell));
  for (let sector = 0; sector < g.sides; sector++) {
    const a0 = sector * step - step / 2, a1 = a0 + step;
    const A: P3 = [Math.sin(a0) * g.pierRadius, 0, -Math.cos(a0) * g.pierRadius], B: P3 = [Math.sin(a1) * g.pierRadius, 0, -Math.cos(a1) * g.pierRadius];
    // Barycentric grid from the centre: row i has i + 1 points.
    const index = (i: number, j: number) => base + (i * (i + 1)) / 2 + j;
    const base = w.vertexCount;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= i; j++) {
      const u = i / n, v = i ? j / i : 0;
      const x = (A[0] + (B[0] - A[0]) * v) * u, z = (A[2] + (B[2] - A[2]) * v) * u;
      w.vertex(x, 0, z, 0, 1, 0, x, -z);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      w.orientTriangle(0, index(i, j), index(i + 1, j), index(i + 1, j + 1));
      if (j < i) w.orientTriangle(0, index(i, j), index(i + 1, j + 1), index(i, j + 1));
    }
    if (sector % 2 === 1) yield;
  }
  // Each side's floor from the arcade plane out to its depth (the vestibule only to its first step).
  for (let side = 0; side < g.sides; side++) {
    const plan = sides[side], b = side * step, depth = plan.kind === "entrance" ? g.entrance.start : plan.depth;
    const cx = Math.sin(b) * g.apothem, cz = -Math.cos(b) * g.apothem;
    const tx = Math.cos(b), tz = Math.sin(b), nx = Math.sin(b), nz = -Math.cos(b);
    const across = Math.max(2, Math.ceil(g.span / t.cell)), out = Math.max(1, Math.ceil(depth / t.cell));
    const base = w.vertexCount;
    for (let i = 0; i <= out; i++) for (let j = 0; j <= across; j++) {
      const s = -g.span / 2 + (g.span * j) / across, d = (depth * i) / out;
      const x = cx + tx * s + nx * d, z = cz + tz * s + nz * d;
      w.vertex(x, 0, z, 0, 1, 0, x, -z);
    }
    for (let i = 0; i < out; i++) for (let j = 0; j < across; j++) {
      const v0 = base + i * (across + 1) + j;
      w.orientQuad(0, v0, v0 + 1, v0 + across + 2, v0 + across + 1);
    }
  }
  yield;
}

// ---------------------------------------------------------------------------
// Lamps: local frame, foot at the origin. Slots: 0 bronze, 1 glowing core.

export function* lampStandForm(ctx: FormContext, height: number): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  const stand = new ProfileBuilder(q, 0, 0).to(0.26, 0).up(0.03).cavetto(0.06, -0.08).ovolo(0.05, -0.05).in(0.06).up(0.18)
    .torus(0.03).in(0.01).to(0.03, 0.48).up(height - 0.9).torus(0.025).to(0.035, height - 0.36).ovolo(0.1, 0.1).cavetto(0.12, 0.06).up(0.03).in(0.05).to(0.11, height - 0.16).build();
  lathe(w, 0, q, stand);
  for (let foot = 0; foot < 3; foot++) {
    const start = w.vertexCount;
    bevelBox(w, 0, 0, 0.03, -0.26, 0.07, 0.06, 0.18, 0.01);
    w.transformFrom(start, rotY((foot * Math.PI * 2) / 3));
  }
  // The glowing core sits in the bowl.
  const core = new ProfileBuilder(q, 0, height - 0.2).ovolo(0.09, 0.075).cavetto(0.0001, 0).ovolo(0.11, -0.075).build();
  lathe(w, 1, q, core, { segments: Math.max(8, Math.round(TESSELLATION[q].lathe * 0.5)) });
  yield;
}

export function* lampSconceForm(ctx: FormContext): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  // Local -Z faces the chamber; the bracket sits on the wall behind (+Z).
  bevelBox(w, 0, 0, 0, 0.05, 0.16, 0.34, 0.08, 0.015);
  rod(w, 0, [0, -0.04, 0.02], [0, 0.05, -0.28], 0.018, 6, false);
  const bowl = new ProfileBuilder(q, 0, 0).to(0.03, 0).ovolo(0.06, 0.07).up(0.02).in(0.01).build();
  lathe(w, 0, q, bowl, { center: [0, 0.02, -0.3] });
  lathe(w, 1, q, new ProfileBuilder(q, 0, 0.06).ovolo(0.05, 0.045).ovolo(0.06, -0.045).build(), { center: [0, 0.02, -0.3] });
  yield;
}

// ---------------------------------------------------------------------------
// Mechanism: a ring band in its own frame (horizontal, centred), and the rods. Slot 0 bronze.

/** Builds a ring band; the caller tilts and places it. Closed profile: watertight. */
export function ringBandForm(writer: MeshWriter, quality: ArchiveQuality, ring: Pick<MechanismRing, "radius" | "section">): void {
  const { radius: R } = ring, w = ring.section.width, h = ring.section.thickness, c = Math.min(0.02, w * 0.08);
  // Cross-section, travelled so the lathe's outward normals face out of the band: outer face up, top inward with two grooves, inner face down, bottom outward.
  const g = 0.012, inner = R - w / 2, outer = R + w / 2;
  const profile = new ProfileBuilder(quality, outer - c, -h / 2).to(outer, -h / 2 + c).to(outer, h / 2 - c).to(outer - c, h / 2)
    .to(R + w * 0.3, h / 2).to(R + w * 0.3, h / 2 - g).to(R + w * 0.22, h / 2 - g).to(R + w * 0.22, h / 2)
    .to(R - w * 0.22, h / 2).to(R - w * 0.22, h / 2 - g).to(R - w * 0.3, h / 2 - g).to(R - w * 0.3, h / 2)
    .to(inner + c, h / 2).to(inner, h / 2 - c).to(inner, -h / 2 + c).to(inner + c, -h / 2).to(outer - c, -h / 2).build();
  const segments = Math.max(48, Math.round(arcSegments(quality, Math.PI * 2, R) * 0.9));
  lathe(writer, 0, quality, profile, { segments });
  // Spokes across the band and graduation ticks along its outer edge (none reaching the centre).
  const ticks = quality === "quest" ? 24 : quality === "low" ? 36 : 72;
  for (let k = 0; k < ticks; k++) {
    const a = (k / ticks) * Math.PI * 2, start = writer.vertexCount;
    const spoke = k % (ticks / 12) === 0;
    const length = spoke ? w * 0.94 : w * 0.18, centre = spoke ? R : outer - length / 2 - 0.004;
    bevelBox(writer, 0, 0, h / 2 + 0.006, -centre, spoke ? 0.04 : 0.016, 0.012, length, 0.004);
    writer.transformFrom(start, rotY(-a));
  }
}

export function* suspensionRodsForm(ctx: FormContext, rings: readonly MechanismRing[], ringPoint: (ring: MechanismRing, angle: number) => number[], radius: number): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  for (const ring of rings) {
    for (const rodDef of ring.suspension) {
      const rim = ringPoint(ring, rodDef.angle);
      rod(w, 0, [rim[0], rim[1] + ring.section.thickness / 2 + 0.06, rim[2]], [rodDef.anchor[0], rodDef.anchor[1], rodDef.anchor[2]], radius, q === "quest" ? 5 : 6, false);
      // A cradle at the rim and a rose where the rod meets the vault.
      bevelBox(w, 0, rim[0], rim[1] + ring.section.thickness / 2 + 0.04, rim[2], 0.12, 0.08, 0.12, 0.012);
      lathe(w, 0, q, new ProfileBuilder(q, 0.02, 0).to(0.16, 0).ovolo(0.04, -0.06).to(0.02, 0.07).build(), { center: [rodDef.anchor[0], rodDef.anchor[1] - 0.07, rodDef.anchor[2]], segments: 12 });
    }
    yield;
  }
}

// ---------------------------------------------------------------------------
// Artifacts: local frames with local -Z toward the viewer side.

/** The Annals dial: a bronze disc of concentric bands and graduations on its wall; the base below is basalt. Slots: 0 bronze, 1 basalt. */
export function* dialForm(ctx: FormContext, radius: number, bands: number, ticks: number, wallOffset: number): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  // Built facing +Y with the lathe, then turned to face -Z.
  const dial = new ProfileBuilder(q, 0, 0.16).to(0.16, 0.16).ovolo(0.04, 0.05).to(0.21, 0.1);
  for (let band = bands; band >= 1; band--) {
    const r = 0.24 + ((radius - 0.3) * band) / bands;
    dial.to(r - 0.07, 0.07).torus(0.018).to(r, 0.07);
  }
  dial.to(radius - 0.04, 0.06).ovolo(0.03, 0.04).to(radius, 0).build();
  const start = w.vertexCount;
  lathe(w, 0, q, dial.build(), { caps: false });
  const turn = rotX(-Math.PI / 2);
  w.transformFrom(start, turn, [0, 0, wallOffset]);
  yield;
  for (let k = 0; k < ticks; k++) {
    const a = (k / ticks) * Math.PI * 2, long = k % 6 === 0, begin = w.vertexCount;
    const length = long ? 0.2 : 0.11;
    bevelBox(w, 0, 0, radius - 0.12 - length / 2, -0.075 + wallOffset, long ? 0.028 : 0.014, length, 0.02, 0.004);
    w.transformFrom(begin, [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]);
  }
  yield;
  // The stepped base under the dial.
  bevelBox(w, 1, 0, -3.15 + 0.6, wallOffset - 0.55, 2.6, 1.2, 1.1, 0.04);
  bevelBox(w, 1, 0, -3.15 + 1.25, wallOffset - 0.45, 2.2, 0.1, 0.9, 0.03);
}

/** The Laws dais: three steps up to a basalt top with a bronze-lined square. Slots: 0 basalt, 1 bronze, 2 floor stone. */
export function* daisForm(ctx: FormContext, width: number, depth: number, height: number, steps: number, grid: number): Generator<void, void, void> {
  const { writer: w } = ctx;
  const rise = height / steps, tread = 0.3;
  for (let step = 0; step < steps; step++) {
    const grow = (steps - 1 - step) * tread;
    bevelBox(w, 0, 0, rise * step + rise / 2, 0, width + grow * 2, rise, depth + grow * 2, 0.015);
  }
  yield;
  const board = Math.min(width, depth) - 0.5, cell = board / grid;
  face(w, 2, [[-board / 2, height + 0.002, -board / 2], [board / 2, height + 0.002, -board / 2], [board / 2, height + 0.002, board / 2], [-board / 2, height + 0.002, board / 2]], [0, 1, 0]);
  for (let line = 0; line <= grid; line++) {
    const o = -board / 2 + line * cell;
    bevelBox(w, 1, o, height + 0.005, 0, line % grid === 0 ? 0.05 : 0.018, 0.006, board + 0.05, 0.002);
    bevelBox(w, 1, 0, height + 0.005, o, board + 0.05, 0.006, line % grid === 0 ? 0.05 : 0.018, 0.002);
  }
}

/** A stele: base, a slab with a pointed head and a bronze edge band. Slots: 0 basalt, 1 bronze. */
export function* steleForm(ctx: FormContext, width: number, height: number, depth: number): Generator<void, void, void> {
  const { writer: w } = ctx;
  bevelBox(w, 0, 0, 0.12, 0, width + 0.22, 0.24, depth + 0.24, 0.03);
  // The slab outline in its front plane, extruded through its thickness.
  const outline: P2[] = [[-width / 2, 0.24], [width / 2, 0.24], [width / 2, height - 0.3], [0, height], [-width / 2, height - 0.3]];
  const start = w.vertexCount;
  prism(w, 0, outline.map(([x, y]) => [x, -y] as P2), -depth / 2, depth / 2, { bevel: 0.025 });
  // Plan (x, z) became (x, -y): turn so the prism's height runs along z and the outline stands up.
  w.transformFrom(start, rotX(Math.PI / 2));
  yield;
  for (const side of [-1, 1]) bevelBox(w, 1, side * (width / 2 + 0.006), (0.24 + height - 0.3) / 2, 0, 0.022, height - 0.54, depth * 0.6, 0.004);
}

// ---------------------------------------------------------------------------
// The monument's plinth, around a relief `width` wide whose rim plane is at `top`.
// Slots: 0 basalt body and step, 1 carved panels, 2 bronze frame, 3 dressed cap and top.

export interface PlinthSpec {
  reliefWidth: number;
  reliefDepth: number;
  /** Height of the slab's foot (the plinth's top). */
  footY: number;
  /** Chamfered slab half-extents beyond the painted surface. */
  slabMargin: number;
  margin: number;
  step: number;
  stepHeight: number;
  frameBand: number;
  frameRise: number;
  /** Moulding scale: 1 at desktop size. */
  scale: number;
}

export function* plinthForm(ctx: FormContext, spec: PlinthSpec): Generator<void, void, void> {
  const { writer: w, quality: q } = ctx;
  const s = spec.scale;
  const hw = spec.reliefWidth / 2 + spec.slabMargin + spec.margin, hd = spec.reliefDepth / 2 + spec.slabMargin + spec.margin;
  const capHeight = 0.16 * s, top = spec.footY;
  // The step around the foot.
  bevelBox(w, 0, 0, spec.stepHeight / 2, 0, (hw + spec.step) * 2, spec.stepHeight, (hd + spec.step) * 2, 0.02 * s);
  const plan: P2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  sweepPolygon(w, 0, MOULDINGS.base(q, 0.55 * s), plan, spec.stepHeight, false);
  prism(w, 0, plan, spec.stepHeight + 0.36 * s, top - capHeight, { top: false, bottom: false });
  yield;
  sweepPolygon(w, 3, MOULDINGS.plinthCap(q, capHeight), plan, top - capHeight, false);
  // The top surface between the cap and the bronze frame.
  const inner = spec.reliefWidth / 2 + spec.slabMargin + spec.frameBand, innerD = spec.reliefDepth / 2 + spec.slabMargin + spec.frameBand;
  const capOut = hw - 0.01 * s, capOutD = hd - 0.01 * s;
  for (const [a, b, c, d] of [
    [[-capOut, -capOutD], [capOut, -capOutD], [inner, -innerD], [-inner, -innerD]],
    [[capOut, -capOutD], [capOut, capOutD], [inner, innerD], [inner, -innerD]],
    [[capOut, capOutD], [-capOut, capOutD], [-inner, innerD], [inner, innerD]],
    [[-capOut, capOutD], [-capOut, -capOutD], [-inner, -innerD], [-inner, innerD]],
  ] as P2[][]) face(w, 3, [[a[0], top, a[1]], [b[0], top, b[1]], [c[0], top, c[1]], [d[0], top, d[1]]], [0, 1, 0]);
  // Recessed carved panels on the dado, one per face.
  const panelY = (spec.stepHeight + 0.36 * s + top - capHeight) / 2, panelH = Math.max(0.05, top - capHeight - spec.stepHeight - 0.5 * s);
  for (const [x, z, nx, nz, length] of [[0, -hd - 0.004, 0, -1, hw * 1.6], [0, hd + 0.004, 0, 1, hw * 1.6], [-hw - 0.004, 0, -1, 0, hd * 1.6], [hw + 0.004, 0, 1, 0, hd * 1.6]] as const) {
    const along: P3 = nz !== 0 ? [1, 0, 0] : [0, 0, 1];
    const p = (u: number, v: number): P3 => [x + along[0] * u, panelY + v, z + along[2] * u];
    face(w, 1, [p(-length / 2, -panelH / 2), p(length / 2, -panelH / 2), p(length / 2, panelH / 2), p(-length / 2, panelH / 2)], [nx, 0, nz]);
  }
  yield;
  // The bronze frame holding the slab's foot.
  const fx = spec.reliefWidth / 2 + spec.slabMargin, fz = spec.reliefDepth / 2 + spec.slabMargin, band = spec.frameBand, rise = spec.frameRise;
  bevelBox(w, 2, 0, top + rise / 2, -fz - band / 2, (fx + band) * 2, rise, band, Math.min(0.006, rise * 0.4));
  bevelBox(w, 2, 0, top + rise / 2, fz + band / 2, (fx + band) * 2, rise, band, Math.min(0.006, rise * 0.4));
  bevelBox(w, 2, -fx - band / 2, top + rise / 2, 0, band, rise, fz * 2, Math.min(0.006, rise * 0.4));
  bevelBox(w, 2, fx + band / 2, top + rise / 2, 0, band, rise, fz * 2, Math.min(0.006, rise * 0.4));
}
