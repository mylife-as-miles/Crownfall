// Wall shells: plinths and water tables, storey bands, jettied timber-framed upper
// storeys with storey-aligned framing, round and octagonal towers, string courses,
// and the broken or unfinished tops of ruins and structures under construction.

import { band, bevelPrism, box, chamferRect, circleOutline, offsetPolygon, prism, rectOutline } from "../../kernel";
import type { MeshBuilder, P2 } from "../../kernel";
import type { KitContext } from "../context";
import type { MassFrame } from "./frame";

const FRAME_TILE = 3.2;

export function massOutline(f: MassFrame, grow = 0, segments = 16): P2[] {
  if (f.round) return circleOutline(f.w / 2 + grow, segments, Math.PI / segments);
  if (f.octagon) {
    const r = (f.w / 2) / Math.cos(Math.PI / 8) + grow;
    return circleOutline(r, 8, Math.PI / 8);
  }
  const base = chamferRect(f.w, f.d, f.style.chamfer);
  return grow !== 0 ? offsetPolygon(base, grow) : base;
}

/** Plinth (and Gothic water table) from below the ground to just above the floor. */
export function plinth(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  if (f.elevated) return;
  const st = f.style;
  b.material(ctx.mat(st.plinthMaterial));
  const seg = ctx.quality.detail >= 2 ? 20 : 16;
  const outline = massOutline(f, st.plinthOffset, seg);
  const kind = f.building.foundation.kind;
  const top = kind === "undercroft" ? 0.15 : st.waterTable ? 0.42 : 0.16;
  if (f.round) {
    prism(b, outline, f.footY, top, { smooth: true, top: true });
  } else if (st.waterTable) {
    bevelPrism(b, outline, f.footY, top, 0.16);
  } else {
    prism(b, outline, f.footY, top, { top: true });
  }
  if (kind === "undercroft" && ctx.quality.detail >= 1 && !f.round) {
    // Undercroft: a heavier battered base course where the ground falls away.
    const relief = f.base.floorY - f.base.groundMin;
    if (relief > 0.6) bevelPrism(b, massOutline(f, st.plinthOffset + 0.25), f.footY, Math.min(-0.2, -relief * 0.35), 0.2);
  }
}

/** Stilts: staddle stones under a raised timber floor (granaries). */
export function staddles(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  b.material(ctx.mat("stone-generic"));
  const nx = Math.max(2, Math.round(f.w / 2.4));
  const nz = Math.max(2, Math.round(f.d / 2.4));
  const lift = f.building.foundation.plinth;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      if (i > 0 && i < nx - 1 && k > 0 && k < nz - 1) continue;
      const x = -f.w / 2 + 0.35 + (i * (f.w - 0.7)) / (nx - 1);
      const z = -f.d / 2 + 0.35 + (k * (f.d - 0.7)) / (nz - 1);
      b.push();
      b.translate(x, 0, z);
      prism(b, circleOutline(0.18, 8), f.footY, -lift + 0.05, { smooth: true });
      prism(b, circleOutline(0.42, 10), -0.24, -0.04, { smooth: true, top: true, bottom: true });
      b.pop();
    }
  }
  b.material(ctx.mat("timber-dark"));
  box(b, 0, -0.04, 0, f.w + 0.1, 0.12, f.d + 0.1, { bottom: true });
}

/** World-space UV continuity is fine for masonry; framed storeys use explicit storey-aligned UVs. */
function framedStorey(b: MeshBuilder, w: number, d: number, y0: number, y1: number, uOffset: number): void {
  const prev = b.uvMode;
  b.uvMode = "explicit";
  const hw = w / 2, hd = d / 2;
  const v0 = 0, v1 = FRAME_TILE;
  // +Z, +X, -Z, -X faces, counter-clockwise from above so normals face outward.
  const faces: [number, number, number, number][] = [
    [-hw, hd, hw, hd],
    [hw, hd, hw, -hd],
    [hw, -hd, -hw, -hd],
    [-hw, -hd, -hw, hd],
  ];
  let u = uOffset;
  for (const [ax, az, bx, bz] of faces) {
    const len = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
    b.flatQuad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, [u, v0, u + len, v0, u + len, v1, u, v1]);
    u += len;
  }
  b.uvMode = prev;
}

export interface ShellInfo {
  /** Local half-depth of the top storey (roof footprint grows with jetties). */
  topDepth: number;
  topWidth: number;
  /** Jetty offset per storey index (0 for the ground storey). */
  jettyAt: (storey: number) => number;
}

/** Wall shell of a standing mass. */
export function wallShell(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string): ShellInfo {
  const m = f.mass;
  const st = f.style;
  const eave = m.eaveHeight;
  const storeys = Math.max(1, m.storeys);
  const sh = eave / storeys;
  const wallMat = ctx.mat(wallKey);
  const seg = ctx.quality.detail >= 2 ? 20 : ctx.quality.detail === 1 ? 16 : 12;
  const info: ShellInfo = { topDepth: f.d, topWidth: f.w, jettyAt: () => 0 };
  const isFrame = /frame-plaster/.test(wallMat);
  if (f.round || f.octagon) {
    b.material(wallMat);
    const outline = massOutline(f, 0, seg);
    const grime = Math.min(1.4, eave * 0.3);
    prism(b, outline, 0, grime, { smooth: f.round, top: false });
    for (let s = 0; s < storeys; s++) {
      const y0 = Math.max(grime, s * sh), y1 = (s + 1) * sh;
      if (y1 > y0) prism(b, outline, y0, y1, { smooth: f.round, top: false });
    }
    if (st.stringCourses && ctx.quality.detail >= 1) {
      b.material(ctx.mat(st.plinthMaterial));
      for (let s = 1; s < storeys; s++) bandRound(b, f.w / 2, s * sh, seg);
      bandRound(b, f.w / 2, eave - 0.28, seg, 0.14, 0.28);
    }
    return info;
  }
  const jetty = st.jetty > 0 && storeys >= 2 && m.role !== "tower" && m.role !== "keep" && f.d > 3 ? st.jetty : 0;
  info.jettyAt = (s: number) => Math.min(s, 2) * jetty;
  for (let s = 0; s < storeys; s++) {
    const y0 = s * sh, y1 = (s + 1) * sh;
    const dz = f.d + 2 * info.jettyAt(s);
    const groundMat = s === 0 && st.groundStoreyMaterial ? ctx.mat(st.groundStoreyMaterial) : wallMat;
    b.material(groundMat);
    if (/frame-plaster/.test(groundMat)) {
      framedStorey(b, f.w, dz, y0, y1, s * 1.7);
    } else {
      const outline = chamferRect(f.w, dz, st.chamfer);
      if (s === 0 && y1 > 1.6) {
        prism(b, outline, 0, 1.4, { top: false });
        prism(b, outline, 1.4, y1, { top: false });
      } else prism(b, outline, y0, y1, { top: false });
    }
    if (s > 0 && info.jettyAt(s) > info.jettyAt(s - 1)) jettySoffit(ctx, b, f.w, f.d + 2 * info.jettyAt(s - 1), dz, y0);
  }
  info.topDepth = f.d + 2 * info.jettyAt(storeys - 1);
  if (st.stringCourses && ctx.quality.detail >= 1 && !isFrame) {
    b.material(ctx.mat(st.plinthMaterial));
    for (let s = 1; s < storeys; s++) band(b, rectOutline(f.w, f.d), s * sh - 0.08, 0.17, 0.07);
    band(b, rectOutline(f.w, f.d), eave - 0.3, 0.3, 0.13);
  }
  return info;
}

function bandRound(b: MeshBuilder, r: number, y: number, seg: number, proj = 0.08, h = 0.18): void {
  prism(b, circleOutline(r + proj, seg, Math.PI / seg), y, y + h, { smooth: true, top: true, bottom: true });
}

/** Jetty underside: joist ends and a dark soffit where an upper storey oversails. */
function jettySoffit(ctx: KitContext, b: MeshBuilder, w: number, dLower: number, dUpper: number, y: number): void {
  b.material(ctx.mat("timber-dark"));
  const prev = b.getColor();
  b.color(prev[0] * 0.7, prev[1] * 0.7, prev[2] * 0.7);
  const over = (dUpper - dLower) / 2;
  for (const side of [1, -1]) {
    const zc = side * (dLower / 2 + over / 2);
    // Soffit board.
    b.flatQuad(-w / 2, y, zc + over / 2, w / 2, y, zc + over / 2, w / 2, y, zc - over / 2, -w / 2, y, zc - over / 2);
    // Bressumer beam along the jetty edge.
    box(b, 0, y - 0.05, side * (dUpper / 2 - 0.08), w + 0.04, 0.22, 0.2);
    if (ctx.quality.detail >= 1) {
      const n = Math.max(2, Math.round(w / 1.1));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.25 + (i * (w - 0.5)) / (n - 1);
        box(b, x, y - 0.32, side * (dLower / 2 + over * 0.45), 0.12, 0.3, over * 0.9);
      }
    }
  }
  b.color(prev[0], prev[1], prev[2]);
}

/**
 * Thick broken walls for ruins and unfinished structures: each face is cut into
 * strips whose tops step or break. Returns nothing; there is no roof.
 */
export function brokenShell(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string, mode: "ruin" | "unfinished"): void {
  const m = f.mass;
  const rng = ctx.rng(`broken:${f.building.id}:${m.id}`);
  b.material(ctx.mat(wallKey));
  const t = mode === "ruin" ? 0.55 : 0.7;
  const eave = m.eaveHeight;
  const prev = b.getColor();
  if (f.round || f.octagon) {
    const seg = 16;
    const r = f.w / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const h = eave * (mode === "ruin" ? 0.45 + 0.55 * Math.pow(Math.abs(Math.sin(i * 1.7 + rng.next())), 0.6) : 1);
      const am = (a0 + a1) / 2;
      b.push();
      b.transform(Math.sin(am) * (r - t / 2), 0, Math.cos(am) * (r - t / 2), am);
      box(b, 0, f.footY, 0, 2 * r * Math.sin(Math.PI / seg) + 0.05, h - f.footY, t);
      b.pop();
    }
    return;
  }
  const faces: [number, number, number, number][] = [
    [-f.w / 2, f.d / 2, f.w / 2, f.d / 2],
    [f.w / 2, f.d / 2, f.w / 2, -f.d / 2],
    [f.w / 2, -f.d / 2, -f.w / 2, -f.d / 2],
    [-f.w / 2, -f.d / 2, -f.w / 2, f.d / 2],
  ];
  for (const [ax, az, bx, bz] of faces) {
    const len = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
    const n = Math.max(2, Math.round(len / (mode === "ruin" ? 1.1 : 1.6)));
    const yaw = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    // Inward offset so the thick wall stays inside the footprint.
    const nx = (bz - az) / len, nz = -(bx - ax) / len;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const mid = (t0 + t1) / 2;
      const edge = Math.min(mid, 1 - mid);
      let h: number;
      if (mode === "ruin") h = eave * (0.4 + 0.6 * Math.pow(rng.next(), 0.7)) * (edge < 0.15 ? 1.05 : 1);
      else h = eave - Math.min(3, Math.floor(edge * n)) * 0.42 * (rng.chance(0.5) ? 1 : 0.6);
      const px = ax + (bx - ax) * mid + nx * t * 0.5;
      const pz = az + (bz - az) * mid + nz * t * 0.5;
      if (mode === "ruin") {
        const soot = 0.55 + 0.25 * rng.next();
        b.color(prev[0] * soot, prev[1] * soot, prev[2] * soot);
      }
      b.push();
      b.transform(px, 0, pz, yaw);
      box(b, 0, f.footY, 0, len / n + 0.02, Math.max(0.6, h - f.footY), t);
      b.pop();
    }
  }
  b.color(prev[0], prev[1], prev[2]);
}
