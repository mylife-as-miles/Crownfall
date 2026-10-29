// Outer territory kit: distant places (the allied Great House's seat, the capital,
// towns, abbey, neighbouring estates, villages, frontier forts) as authored
// silhouettes, outposts on the holding's land, and skyline layers (far mountains).
// Places beyond the far-terrain ring are moved in along their bearing and scaled
// so their angular size and elevation are preserved (matte-painting depth).

import type { DistantPlace, Outpost, SkylineLayer } from "../../blueprint";
import { box, chamferBox, circleOutline, lathe, prism, rectOutline, roof, Rng } from "../../kernel";
import type { MeshBuilder } from "../../kernel";
import type { KitContext } from "../context";

/** Ring distance where far silhouettes are placed when they lie beyond it. */
export const SILHOUETTE_RING = 5200;

export function silhouettePlacement(distance: number): { d: number; s: number } {
  if (distance <= SILHOUETTE_RING) return { d: distance, s: 1 };
  const d = SILHOUETTE_RING + (distance - SILHOUETTE_RING) * 0.09;
  return { d, s: d / distance };
}

function spire(b: MeshBuilder, x: number, z: number, y: number, w: number, h: number, spireH: number, round: boolean): void {
  b.push();
  b.translate(x, y, z);
  if (round) prism(b, circleOutline(w / 2, 8), -2, h, { top: false });
  else chamferBox(b, 0, -2, 0, w, h + 2, w, w * 0.1, { top: false });
  lathe(b, [[w * 0.62, h], [w * 0.08, h + spireH]], round ? 8 : 4, { smooth: false, phase: Math.PI / 4 });
  b.pop();
}

function hall(b: MeshBuilder, x: number, z: number, y: number, w: number, d: number, eave: number, ridge: number, yaw: number): void {
  b.push();
  b.transform(x, y, z, yaw);
  prism(b, rectOutline(w, d), -2, eave, { top: false });
  roof(b, { form: "steep-gable", axis: "z", w, d, eaveY: eave, ridgeY: ridge, plan: "rect", overhang: 0.3, verge: 0.2, thickness: 0.3, roofMaterial: "silhouette", gableMaterial: "silhouette", trimMaterial: "silhouette" });
  b.pop();
}

function windowsSpecks(ctx: KitContext, b: MeshBuilder, rng: Rng, count: number, radius: number, y0: number, y1: number, size: number): void {
  b.material(ctx.mat("glass-lit"));
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = radius * Math.sqrt(rng.next());
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const y = y0 + rng.next() * (y1 - y0);
    const k = 0.6 + rng.next() * 0.6;
    b.color(k, k, k);
    b.push();
    b.transform(x, y, z, a);
    box(b, 0, 0, 0, size, size * 1.4, size * 0.3);
    b.pop();
  }
  b.color(1, 1, 1);
  b.material(ctx.mat("silhouette"));
}

function buildPlace(ctx: KitContext, p: DistantPlace): void {
  const b = ctx.b;
  const { d, s } = silhouettePlacement(p.distance);
  const bearing = (p.bearingDeg * Math.PI) / 180;
  const x = Math.sin(bearing) * d, z = -Math.cos(bearing) * d;
  const groundHere = ctx.ground(x, z);
  const y = Math.max(groundHere - 1, p.groundElevation * s - 2);
  const rng = ctx.rng(`place:${p.id}`);
  const H = p.silhouetteHeight;
  const R = Math.min(p.radius, H * 4);
  b.part("outer", null).gate(null).shadows(false, false).material(ctx.mat("silhouette"));
  b.uvMode = "world";
  const tone = p.kind === "monastery" ? 1.5 : p.kind === "capital" ? 0.7 : 1;
  b.color(tone, tone, tone * 1.04);
  b.push();
  b.transform(x, y, z, -bearing, 0, 0, s, s, s);
  switch (p.kind) {
    case "allied-seat":
    case "citadel": {
      // Curtain ring with towers, a palace hall, and a crown of spires around a tall keep.
      const ring = R * 0.45;
      const towers = 9;
      for (let i = 0; i < towers; i++) {
        const a = (i / towers) * Math.PI * 2;
        spire(b, Math.sin(a) * ring, Math.cos(a) * ring, 0, H * 0.09, H * (0.28 + rng.next() * 0.12), H * (0.18 + rng.next() * 0.08), true);
        const a2 = ((i + 1) / towers) * Math.PI * 2;
        b.push();
        const mx = (Math.sin(a) + Math.sin(a2)) * ring * 0.5, mz = (Math.cos(a) + Math.cos(a2)) * ring * 0.5;
        b.transform(mx, 0, mz, (a + a2) / 2);
        box(b, 0, -2, 0, ring * 0.72, H * 0.16, H * 0.04);
        b.pop();
      }
      hall(b, 0, ring * 0.1, 0, H * 0.22, H * 0.55, H * 0.3, H * 0.52, 0.2);
      spire(b, -H * 0.1, -ring * 0.25, 0, H * 0.14, H * 0.55, H * 0.45, false);
      for (let i = 0; i < 7; i++) {
        const a = rng.next() * Math.PI * 2, r = ring * (0.15 + rng.next() * 0.5);
        spire(b, Math.sin(a) * r, Math.cos(a) * r, 0, H * 0.06, H * (0.25 + rng.next() * 0.2), H * (0.2 + rng.next() * 0.15), rng.chance(0.5));
      }
      windowsSpecks(ctx, b, rng, 26, ring * 0.8, H * 0.05, H * 0.35, H * 0.012);
      break;
    }
    case "capital": {
      // A forest of black spires: dense low city mass, then many spires of varied height.
      const city = R * 0.35;
      for (let i = 0; i < 60; i++) {
        const a = rng.next() * Math.PI * 2, r = city * Math.sqrt(rng.next());
        const bw = H * (0.04 + rng.next() * 0.05);
        b.push();
        b.transform(Math.sin(a) * r, 0, Math.cos(a) * r, rng.next() * 3);
        box(b, 0, -4, 0, bw * 2.2, H * (0.08 + rng.next() * 0.08), bw * 1.4);
        b.pop();
      }
      for (let i = 0; i < 44; i++) {
        const a = rng.next() * Math.PI * 2, r = city * Math.pow(rng.next(), 0.8);
        const tall = 1 - r / city;
        spire(b, Math.sin(a) * r, Math.cos(a) * r, 0, H * (0.025 + rng.next() * 0.03), H * (0.18 + tall * 0.42 * rng.next()), H * (0.12 + tall * 0.35), rng.chance(0.4));
      }
      spire(b, 0, 0, 0, H * 0.07, H * 0.62, H * 0.38, false);
      windowsSpecks(ctx, b, rng, 70, city, H * 0.02, H * 0.25, H * 0.006);
      break;
    }
    case "town":
    case "port":
    case "industrial": {
      const town = Math.min(R * 0.4, H * 6);
      for (let i = 0; i < 46; i++) {
        const a = rng.next() * Math.PI * 2, r = town * Math.sqrt(rng.next());
        const w = H * (0.12 + rng.next() * 0.1);
        hall(b, Math.sin(a) * r, Math.cos(a) * r, 0, w, w * 1.6, H * 0.18, H * 0.34, rng.next() * 3);
      }
      spire(b, town * 0.1, 0, 0, H * 0.16, H * 0.62, H * 0.4, false);
      hall(b, town * 0.1, H * 0.5, 0, H * 0.28, H * 0.8, H * 0.38, H * 0.62, 0);
      windowsSpecks(ctx, b, rng, 34, town, H * 0.04, H * 0.2, H * 0.03);
      break;
    }
    case "monastery": {
      hall(b, 0, 0, 0, H * 0.22, H * 0.85, H * 0.34, H * 0.6, 0.3);
      spire(b, 0, -H * 0.5, 0, H * 0.2, H * 0.6, H * 0.4, false);
      hall(b, H * 0.35, H * 0.1, 0, H * 0.16, H * 0.5, H * 0.18, H * 0.32, 0.3 + Math.PI / 2);
      windowsSpecks(ctx, b, rng, 6, H * 0.4, H * 0.1, H * 0.3, H * 0.03);
      break;
    }
    case "neighbour-estate": {
      if (/tower/i.test(p.name)) {
        spire(b, 0, 0, 0, H * 0.3, H * 0.75, H * 0.25, false);
        hall(b, H * 0.35, 0, 0, H * 0.25, H * 0.5, H * 0.3, H * 0.5, 0.4);
      } else {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.5;
          spire(b, Math.sin(a) * H * 0.9, Math.cos(a) * H * 0.9, 0, H * 0.16, H * 0.5, H * 0.3, true);
        }
        hall(b, 0, 0, 0, H * 0.4, H * 1.0, H * 0.42, H * 0.8, 0.3);
      }
      windowsSpecks(ctx, b, rng, 8, H * 0.8, H * 0.1, H * 0.4, H * 0.04);
      break;
    }
    case "village": {
      for (let i = 0; i < 16; i++) {
        const a = rng.next() * Math.PI * 2, r = R * 0.45 * Math.sqrt(rng.next());
        const w = 5 + rng.next() * 3;
        hall(b, Math.sin(a) * r, Math.cos(a) * r, 0, w, w * 1.5, 3.2, 7.5, rng.next() * 3);
      }
      spire(b, 0, 0, 0, 5, H * 0.75, H * 0.35, false);
      windowsSpecks(ctx, b, rng, 14, R * 0.4, 1, 3, 0.6);
      ctx.smoke.push({ id: `${p.id}:smoke`, position: [x, y + 10 * s, z], strength: 2.5, color: "#7c7480", gate: null });
      break;
    }
    case "frontier":
    default: {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.785;
        spire(b, Math.sin(a) * H * 0.9, Math.cos(a) * H * 0.9, 0, H * 0.24, H * 0.8, H * 0.18, false);
      }
      box(b, 0, -2, 0, H * 1.8, H * 0.5, H * 1.8);
      spire(b, 0, 0, 0, H * 0.4, H * 1.0, H * 0.25, false);
      break;
    }
  }
  b.pop();
  b.color(1, 1, 1);
}

function buildOutpost(ctx: KitContext, o: Outpost): void {
  const b = ctx.b;
  const g = ctx.ground(o.position[0], o.position[1]);
  b.part("outer", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  b.push();
  b.translate(o.position[0], g, o.position[1]);
  switch (o.kind) {
    case "toll":
    case "border-tower": {
      const k = ctx.style.keys;
      b.material(ctx.mat(k.rubble));
      chamferBox(b, 0, -1, 0, 5, o.height + 1, 5, 0.1, { top: false });
      roof(b, { form: "pyramid", axis: "z", w: 5, d: 5, eaveY: o.height, ridgeY: o.height + 5, plan: "rect", overhang: 0.4, verge: 0.3, thickness: 0.15, roofMaterial: ctx.mat(k.roof), gableMaterial: ctx.mat(k.rubble), trimMaterial: ctx.mat(k.trim) });
      break;
    }
    case "beacon": {
      b.material(ctx.mat("stone-generic"));
      prism(b, circleOutline(1.4, 10), -0.5, 1.2, { top: true });
      b.material(ctx.mat("iron"));
      box(b, 0, 1.2, 0, 0.18, o.height - 1.6, 0.18);
      lathe(b, [[0.2, o.height - 0.6], [0.9, o.height], [1.0, o.height + 0.5]], 8, { smooth: false });
      break;
    }
    case "shrine": {
      const k = ctx.style.keys;
      b.material(ctx.mat(k.ashlar));
      chamferBox(b, 0, -0.3, 0, 1.2, o.height * 0.7 + 0.3, 0.9, 0.08, { top: false });
      roof(b, { form: "steep-gable", axis: "z", w: 1.3, d: 1.0, eaveY: o.height * 0.7, ridgeY: o.height, plan: "rect", overhang: 0.12, verge: 0.1, thickness: 0.1, roofMaterial: ctx.mat(k.roof), gableMaterial: ctx.mat(k.ashlar), trimMaterial: ctx.mat(k.trim) });
      break;
    }
    default: {
      b.material(ctx.mat("stone-generic"));
      chamferBox(b, 0, -0.3, 0, 0.5, o.height + 0.3, 0.32, 0.06);
    }
  }
  b.pop();
}

/** Far mountain ranges as a jagged silhouette band (snowy crests) on the silhouette ring. */
function buildSkyline(ctx: KitContext, layer: SkylineLayer): void {
  if (layer.kind !== "mountains" && layer.kind !== "glacier" && layer.kind !== "mesa") return;
  const b = ctx.b;
  const { d, s } = silhouettePlacement(layer.distance);
  const rng = new Rng(layer.id.length * 977 + 31);
  b.part("skyline", null).gate(null).shadows(false, false).material(ctx.mat("skyline"));
  b.uvMode = "world";
  let from = layer.bearingFromDeg, to = layer.bearingToDeg;
  if (to < from) to += 360;
  const n = Math.max(24, Math.round((to - from) / 1.2));
  const H = layer.height * s;
  const peaks: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.15 - 0.075)));
    const ridged = 1 - Math.abs(Math.sin(t * 37.1 + rng.next() * 0.5) * 0.6 + Math.sin(t * 91.7) * 0.3);
    peaks.push(H * (0.35 + 0.65 * env * (0.55 + 0.45 * ridged)) + rng.jitter(H * 0.04));
  }
  let prevBottom = -1, prevTop = -1, prevSnow = -1;
  for (let i = 0; i <= n; i++) {
    const bd = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    const dd = d * (1 + 0.04 * Math.sin(i * 0.7));
    const x = Math.sin(bd) * dd, z = -Math.cos(bd) * dd;
    const base = ctx.ground(x, z) - 30;
    const top = base + 30 + peaks[i];
    const nx = -Math.sin(bd), nz = Math.cos(bd);
    b.color(0.9, 0.9, 0.95);
    const vb = b.vertex(x, base, z, nx, 0.2, nz, x, base);
    b.color(1.1, 1.1, 1.16);
    const vt = b.vertex(x, top - peaks[i] * 0.18, z, nx, 0.4, nz, x, top);
    b.color(2.2, 2.2, 2.4);
    const vs = b.vertex(x, top, z, nx, 0.6, nz, x, top + 1);
    if (prevBottom >= 0) {
      b.quad(prevBottom, vb, vt, prevTop);
      b.quad(prevTop, vt, vs, prevSnow);
    }
    prevBottom = vb;
    prevTop = vt;
    prevSnow = vs;
  }
  b.color(1, 1, 1);
}

export function buildOuter(ctx: KitContext): void {
  const { bp } = ctx;
  for (const p of bp.outer.places) buildPlace(ctx, p);
  for (const o of bp.outer.outposts) buildOutpost(ctx, o);
  for (const l of bp.outer.skyline) buildSkyline(ctx, l);
  ctx.b.color(1, 1, 1);
}
