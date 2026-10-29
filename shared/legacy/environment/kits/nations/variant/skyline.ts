// Silhouette primitives for the nation-variant outer territories: distant places are placed
// like the generic kit (moved in along their bearing and scaled so angular size and elevation
// hold, see outer/distant.ts), but each nation composes its own shapes. Parts stay "outer" and
// "skyline" so the Quest miniature's forced perspective applies unchanged.

import type { DistantPlace, SkylineLayer } from "../../../blueprint";
import { box, circleOutline, lathe, prism, rectOutline, Rng } from "../../../kernel";
import type { MeshBuilder } from "../../../kernel";
import type { KitContext } from "../../context";
import { silhouettePlacement } from "../../outer/distant";

export interface PlaceFrame {
  H: number;
  R: number;
  rng: Rng;
  /** World position of the place origin and its placement scale. */
  x: number;
  y: number;
  z: number;
  s: number;
}

/** Pushes the frame of a distant place (scaled, facing the holding) and returns its measures. */
export function beginPlace(ctx: KitContext, p: DistantPlace, tone = 1): PlaceFrame {
  const b = ctx.b;
  const { d, s } = silhouettePlacement(p.distance);
  const bearing = (p.bearingDeg * Math.PI) / 180;
  const x = Math.sin(bearing) * d, z = -Math.cos(bearing) * d;
  const y = Math.max(ctx.ground(x, z) - 1, p.groundElevation * s - 2);
  b.part("outer", null).gate(null).shadows(false, false).material(ctx.mat("silhouette"));
  b.uvMode = "world";
  b.color(tone, tone, tone * 1.03);
  b.push();
  b.transform(x, y, z, -bearing, 0, 0, s, s, s);
  return { H: p.silhouetteHeight, R: Math.min(p.radius, p.silhouetteHeight * 4), rng: ctx.rng(`place:${p.id}`), x, y, z, s };
}

export function endPlace(ctx: KitContext): void {
  ctx.b.pop();
  ctx.b.color(1, 1, 1);
}

/** A block with optional setbacks (tower crowns step back by `step` every `stage` metres). */
export function setbackTower(b: MeshBuilder, x: number, z: number, w: number, d: number, h: number, stages: number, step: number): void {
  let y = -3, cw = w, cd = d;
  const stageH = (h + 3) / Math.max(1, stages);
  for (let i = 0; i < stages; i++) {
    prism(b, rectOutline(cw, cd, x, z), y, y + stageH, { top: true });
    y += stageH;
    cw = Math.max(w * 0.3, cw - step * 2);
    cd = Math.max(d * 0.3, cd - step * 2);
  }
}

/** Lit window specks over a footprint (glass-lit material). */
export function litSpecks(ctx: KitContext, rng: Rng, count: number, radius: number, y0: number, y1: number, size: number, material = "glass-lit"): void {
  const b = ctx.b;
  b.material(ctx.mat(material));
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = radius * Math.sqrt(rng.next());
    const k = 0.6 + rng.next() * 0.6;
    b.color(k, k, k);
    b.push();
    b.transform(Math.sin(a) * r, y0 + rng.next() * (y1 - y0), Math.cos(a) * r, a);
    box(b, 0, 0, 0, size, size * 1.4, size * 0.3);
    b.pop();
  }
  b.color(1, 1, 1);
  b.material(ctx.mat("silhouette"));
}

/** Low flat-topped mesa with talus slopes. */
export function mesa(b: MeshBuilder, x: number, z: number, w: number, h: number, seg = 9): void {
  b.push();
  b.translate(x, 0, z);
  lathe(b, [[w * 0.62, -3], [w * 0.5, h * 0.35], [w * 0.4, h * 0.92], [w * 0.36, h]], seg, { smooth: false, capTop: true });
  b.pop();
}

export type BandProfile = (t: number, rng: Rng) => number;

/** A skyline band between two bearings on the silhouette ring (heights from a profile). */
export function skylineBand(ctx: KitContext, layer: SkylineLayer, profile: BandProfile, opts: { snow?: boolean; tone?: number; material?: string; part?: string } = {}): void {
  const b = ctx.b;
  const { d, s } = silhouettePlacement(layer.distance);
  const rng = new Rng(layer.id.length * 977 + layer.bearingFromDeg * 13 + 31);
  b.part(opts.part ?? "skyline", null).gate(null).shadows(false, false).material(ctx.mat(opts.material ?? "skyline"));
  b.uvMode = "world";
  let from = layer.bearingFromDeg, to = layer.bearingToDeg;
  if (to < from) to += 360;
  const n = Math.max(16, Math.round((to - from) / 1.0));
  const H = layer.height * s;
  const tone = opts.tone ?? 1;
  let pb = -1, pt = -1, ps = -1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bd = ((from + (to - from) * t) * Math.PI) / 180;
    const x = Math.sin(bd) * d, z = -Math.cos(bd) * d;
    const base = ctx.ground(x, z) - 30;
    const hh = Math.max(0, H * profile(t, rng));
    const nx = -Math.sin(bd), nz = Math.cos(bd);
    b.color(0.9 * tone, 0.9 * tone, 0.95 * tone);
    const vb = b.vertex(x, base, z, nx, 0.2, nz, x, base);
    b.color(1.08 * tone, 1.08 * tone, 1.12 * tone);
    const vt = b.vertex(x, base + 30 + hh * (opts.snow ? 0.82 : 1), z, nx, 0.4, nz, x, base + hh);
    let vs = vt;
    if (opts.snow) {
      b.color(2.1, 2.1, 2.3);
      vs = b.vertex(x, base + 30 + hh, z, nx, 0.6, nz, x, base + hh + 1);
    }
    if (pb >= 0) {
      b.quad(pb, vb, vt, pt);
      if (opts.snow) b.quad(pt, vt, vs, ps);
    }
    pb = vb; pt = vt; ps = vs;
  }
  b.color(1, 1, 1);
}

/** Envelope that rises from the band's ends to its middle. */
export function envelope(t: number): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.1 - 0.05)));
}

/** A smoke column source at a world position (renderers draw the billboards). */
export function smokeAt(ctx: KitContext, id: string, x: number, y: number, z: number, strength: number, color: string): void {
  ctx.smoke.push({ id, position: [x, y, z], strength, color, gate: null });
}

/** Round stack with a flame cap (flare stacks), place-local. */
export function flareStack(ctx: KitContext, x: number, z: number, r: number, h: number): void {
  const b = ctx.b;
  b.material(ctx.mat("silhouette"));
  prism(b, circleOutline(r, 6, 0, x, z), -2, h, { top: true });
  b.material(ctx.mat("fire"));
  b.push();
  b.translate(x, h, z);
  lathe(b, [[r * 1.6, 0], [r * 0.9, r * 3], [0.01, r * 7]], 5, { smooth: false });
  b.pop();
  b.material(ctx.mat("silhouette"));
}
