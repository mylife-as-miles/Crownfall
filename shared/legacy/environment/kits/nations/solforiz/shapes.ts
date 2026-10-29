// Solforiz roof and tower shapes: windcatcher vent heads, barrel vaults with light shafts,
// sawtooth north-light roofs, iron lean-tos and palm-timber shade frames.

import { box, prism, rectOutline } from "../../../kernel";
import type { MeshBuilder } from "../../../kernel";
import { rectFaces } from "../../architecture";
import type { KitContext } from "../../context";
import { faceWall, merlonRow, onFace, strip } from "../variant";
import type { BuildingScope, FaceMats, Opening } from "../variant";
import { SF } from "./common";

/**
 * Windcatcher head on a square shaft (mass-local): vertical vent slots on all four faces
 * between ventY and eave, a projecting cornice and a stepped crest.
 */
export function windcatcherHead(ctx: KitContext, s: BuildingScope, w: number, d: number, ventY: number, eave: number, ridge: number, mats: FaceMats, rebuilt: boolean): void {
  const b = ctx.b;
  const base = b.getColor();
  if (rebuilt) b.color(base[0] * 1.12, base[1] * 1.08, base[2] * 0.92);
  const faces = rectFaces(w, d);
  for (const face of faces) {
    const L = face.length;
    const slots = Math.max(2, Math.floor(L / 0.75));
    const sw = Math.min(0.42, (L / slots) * 0.5);
    const ops: Opening[] = [];
    for (let i = 0; i < slots; i++) ops.push({ u: -L / 2 + ((i + 0.5) * L) / slots, width: sw, sill: ventY + 0.25, height: eave - ventY - 0.6, shape: s.lod.detail >= 1 ? "pointed" : "rect", depth: Math.min(0.9, w * 0.3), fill: "void", archK: 0.9 });
    onFace(b, face, () => faceWall(b, { length: L, bottom: ventY, top: eave, openings: ops, mats, arch: Math.max(2, s.lod.arch - 2), detail: s.lod.detail }));
  }
  b.material(mats.wall);
  // Cornice: a stepped corbel band and the crest above.
  box(b, 0, eave - 0.05, 0, w + 0.24, 0.18, d + 0.24);
  box(b, 0, eave + 0.13, 0, w + 0.4, 0.16, d + 0.4);
  const crest = Math.max(0.3, ridge - eave - 0.29);
  prism(b, rectOutline(w + 0.2, d + 0.2), eave + 0.29, eave + 0.29 + crest * 0.5, { top: true });
  if (s.lod.detail >= 1) {
    for (const face of rectFaces(w + 0.2, d + 0.2)) {
      onFace(b, face, () => merlonRow(b, "stepped", face.length - 0.1, eave + 0.29 + crest * 0.5, 0.22, Math.min(0.42, face.length / 4), 0.42, 0.18));
    }
  }
  b.color(base[0], base[1], base[2]);
}

/** Barrel vault along local Z (half-cylinder shell with soffit), from y0 with the given rise. */
export function barrelVault(ctx: KitContext, b: MeshBuilder, w: number, len: number, y0: number, rise: number, mat: string, seg: number, shafts: number): void {
  const prevMode = b.uvMode;
  b.uvMode = "world";
  b.material(ctx.mat(mat));
  const hw = w / 2;
  const t = 0.25;
  const n = Math.max(6, seg);
  const ring = (r: number, h: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI - (Math.PI * i) / n;
      out.push([Math.cos(a) * r, y0 + Math.sin(a) * h]);
    }
    return out;
  };
  const outer = ring(hw + t, rise + t), inner = ring(hw, rise);
  const z0 = -len / 2, z1 = len / 2;
  const base = b.getColor();
  for (let i = 0; i < n; i++) {
    const p = outer[i], q = outer[i + 1];
    b.flatQuad(p[0], p[1], z1, q[0], q[1], z1, q[0], q[1], z0, p[0], p[1], z0);
    const pi = inner[i], qi = inner[i + 1];
    b.color(base[0] * 0.55, base[1] * 0.53, base[2] * 0.5);
    b.flatQuad(qi[0], qi[1], z1, pi[0], pi[1], z1, pi[0], pi[1], z0, qi[0], qi[1], z0);
    b.color(base[0], base[1], base[2]);
    // End rings.
    b.flatQuad(p[0], p[1], z1, pi[0], pi[1], z1, qi[0], qi[1], z1, q[0], q[1], z1);
    b.flatQuad(q[0], q[1], z0, qi[0], qi[1], z0, pi[0], pi[1], z0, p[0], p[1], z0);
  }
  // Light shafts: small lanterns on the crown.
  for (let i = 0; i < shafts; i++) {
    const z = -len / 2 + ((i + 0.5) * len) / shafts;
    box(b, 0, y0 + rise + t - 0.05, z, 0.9, 0.55, 0.9);
    b.material(ctx.mat("glass-dark"));
    box(b, 0, y0 + rise + t + 0.12, z, 0.92, 0.22, 0.6);
    b.material(ctx.mat(mat));
    box(b, 0, y0 + rise + t + 0.5, z, 1.05, 0.08, 1.05);
  }
  b.uvMode = prevMode;
}

/** Sawtooth roof with north lights along local Z (teeth rise toward -X). */
export function sawtooth(ctx: KitContext, b: MeshBuilder, w: number, d: number, eave: number, ridge: number, roofMat: string, glazed: boolean): void {
  const teeth = Math.max(2, Math.round(d / 3.4));
  const pitch = d / teeth;
  const hw = w / 2;
  const h = Math.max(0.8, ridge - eave);
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * pitch, z1 = z0 + pitch;
    b.material(ctx.mat(roofMat));
    // Sloped sheet from the low edge (z1) up to the high edge (z0).
    b.flatQuad(-hw, eave, z1, hw, eave, z1, hw, eave + h, z0, -hw, eave + h, z0);
    b.flatQuad(hw, eave, z1, -hw, eave, z1, -hw, eave + h, z0, hw, eave + h, z0);
    // Vertical light facing -Z.
    b.material(ctx.mat(glazed ? "glass-dark" : roofMat));
    b.flatQuad(hw, eave, z0, -hw, eave, z0, -hw, eave + h, z0, hw, eave + h, z0);
    // Gable triangles at the sides.
    b.material(ctx.mat(roofMat));
    b.flatTri(hw, eave, z1, hw, eave, z0, hw, eave + h, z0);
    b.flatTri(-hw, eave, z0, -hw, eave, z1, -hw, eave + h, z0);
  }
}

/** Palm-timber shade frame with matting on a roof terrace (mass-local, at deck height y). */
export function shadeFrame(ctx: KitContext, b: MeshBuilder, x: number, z: number, w: number, d: number, y: number, h: number, tint: readonly [number, number, number]): void {
  b.material(ctx.mat(SF.palm));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, x + sx * (w / 2 - 0.08), y, z + sz * (d / 2 - 0.08), 0.12, h, 0.12);
  box(b, x, y + h - 0.1, z + d / 2 - 0.08, w, 0.1, 0.1);
  box(b, x, y + h - 0.1, z - d / 2 + 0.08, w, 0.1, 0.1);
  b.material(ctx.mat(SF.cloth));
  const prev = b.getColor();
  b.color(tint[0], tint[1], tint[2]);
  b.shadows(true, true);
  // Cloth renders double-sided: one up-facing sheet.
  b.flatQuad(x - w / 2, y + h, z + d / 2, x + w / 2, y + h, z + d / 2, x + w / 2, y + h + 0.05, z - d / 2, x - w / 2, y + h + 0.05, z - d / 2);
  b.color(prev[0], prev[1], prev[2]);
}

/** Cloth awning sloping out from a wall face (face frame), above an opening. */
export function awning(ctx: KitContext, b: MeshBuilder, u: number, w: number, y: number, out: number, drop: number, tint: readonly [number, number, number]): void {
  b.material(ctx.mat(SF.palm));
  box(b, u - w / 2, y - drop - 0.05, out - 0.05, 0.06, 0.06, 0.06);
  strip(b, u - w / 2, y, u + w / 2, y, 0.06, 0.04);
  b.material(ctx.mat(SF.cloth));
  const prev = b.getColor();
  b.color(tint[0], tint[1], tint[2]);
  b.flatQuad(u - w / 2, y, 0.05, u - w / 2, y - drop, out, u + w / 2, y - drop, out, u + w / 2, y, 0.05);
  b.color(prev[0], prev[1], prev[2]);
}
