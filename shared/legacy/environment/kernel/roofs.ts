// Roof generators with real thickness, eaves and verge overhangs, soffits, fascias,
// ridge caps and gable ends: gable (verge or Gothic parapet gable), hip, half-hip,
// pyramid, spire, conical (bellcast), lean-to, flat with parapet, dome, barrel vault
// and open rafter frames. Coordinates are local to a mass: centred on the plan,
// width along local X, depth along local Z, heights absolute in local Y.

import type { MeshBuilder } from "./builder";
import { box, chamferBox, lathe, panel, prism, rectOutline, bevelPrism } from "./primitives";
import { offsetPolygon } from "./triangulate";
import type { P2 } from "./triangulate";

export type RoofShape =
  | "gable" | "steep-gable" | "hip" | "half-hip" | "pyramid" | "spire" | "conical" | "lean-to"
  | "flat" | "flat-parapet" | "terrace" | "dome" | "barrel-vault" | "sod-gable" | "curved-ridge"
  | "sawtooth" | "setback-crown" | "open-frame" | "none";

export interface RoofParams {
  form: RoofShape;
  axis: "x" | "z";
  w: number;
  d: number;
  eaveY: number;
  ridgeY: number;
  plan: "rect" | "round" | "octagon";
  overhang: number;
  verge: number;
  thickness: number;
  roofMaterial: string;
  gableMaterial: string;
  trimMaterial: string;
  /** Underside material (timber boarding); defaults to roofMaterial darkened. */
  soffitMaterial?: string;
  /** Gothic parapet gables with coping and finials instead of verge overhangs. */
  parapetGables?: boolean;
  /** Round/cone segments. */
  segments?: number;
  /** Colour multiplier per slope (patched roofs): index 0 = +X/front slope, 1 = -X/back slope. */
  slopeTints?: readonly (readonly [number, number, number])[];
}

const SOFFIT_SHADE = 0.5;

function tinted(b: MeshBuilder, base: readonly [number, number, number], k: readonly [number, number, number] | undefined, fn: () => void): void {
  if (k) b.color(base[0] * k[0], base[1] * k[1], base[2] * k[2]);
  fn();
  b.color(base[0], base[1], base[2]);
}

/** Extrusion along local Z of a polygon in the X-Y plane (gable walls, copings). */
export function extrudeXY(b: MeshBuilder, outline: readonly P2[], z0: number, z1: number): void {
  const pts = outline.slice();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (area < 0) pts.reverse();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    // CCW in (x, y): outward edge normal is (dy, -dx).
    b.flatQuad(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
  }
  panel(b, pts, [0, 0, z1], [1, 0, 0], [0, 1, 0]);
  panel(b, pts.map((p) => [-p[0], p[1]] as P2), [0, 0, z0], [-1, 0, 0], [0, 1, 0]);
}

function gableZ(b: MeshBuilder, p: RoofParams, a: number, L: number): void {
  const e = p.eaveY, r = p.ridgeY, h = r - e;
  const k = h / a;
  const oE = p.overhang;
  const parapet = p.parapetGables === true;
  const oV = parapet ? -0.02 : p.verge;
  const t = p.thickness * Math.sqrt(1 + k * k);
  const xE = a + oE, yE = e - oE * k;
  const zF = L / 2 + oV, zB = -(L / 2 + oV);
  const base = b.getColor();
  const roofMat = p.roofMaterial;
  b.material(roofMat);
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const slope = Math.sqrt(xE * xE + (r - yE) * (r - yE));
  const len = zF - zB;
  // Top surfaces (u along the ridge, v up the slope).
  tinted(b, base, p.slopeTints?.[0], () => b.flatQuad(xE, yE, zF, xE, yE, zB, 0, r, zB, 0, r, zF, [len, 0, 0, 0, 0, slope, len, slope]));
  tinted(b, base, p.slopeTints?.[1], () => b.flatQuad(-xE, yE, zB, -xE, yE, zF, 0, r, zF, 0, r, zB, [0, 0, len, 0, len, slope, 0, slope]));
  // Soffits.
  b.material(p.soffitMaterial ?? roofMat);
  b.color(base[0] * SOFFIT_SHADE, base[1] * SOFFIT_SHADE, base[2] * SOFFIT_SHADE);
  b.flatQuad(0, r - t, zF, 0, r - t, zB, xE, yE - t, zB, xE, yE - t, zF);
  b.flatQuad(0, r - t, zB, 0, r - t, zF, -xE, yE - t, zF, -xE, yE - t, zB);
  b.color(base[0], base[1], base[2]);
  b.material(roofMat);
  // Fascias.
  b.flatQuad(xE, yE, zB, xE, yE, zF, xE, yE - t, zF, xE, yE - t, zB);
  b.flatQuad(-xE, yE, zF, -xE, yE, zB, -xE, yE - t, zB, -xE, yE - t, zF);
  // Verges (front +Z, back -Z).
  b.flatQuad(0, r - t, zF, xE, yE - t, zF, xE, yE, zF, 0, r, zF);
  b.flatQuad(-xE, yE - t, zF, 0, r - t, zF, 0, r, zF, -xE, yE, zF);
  b.flatQuad(xE, yE - t, zB, 0, r - t, zB, 0, r, zB, xE, yE, zB);
  b.flatQuad(0, r - t, zB, -xE, yE - t, zB, -xE, yE, zB, 0, r, zB);
  b.uvMode = "world";
  // Ridge cap.
  b.material(p.trimMaterial);
  b.push();
  b.transform(0, r - 0.05, 0, 0, 0, Math.PI / 4);
  box(b, 0, -0.11, 0, 0.22, 0.22, len + 0.04, { top: true, bottom: false });
  b.pop();
  // Gable ends.
  b.material(p.gableMaterial);
  if (parapet) {
    const c = 0.45; // coping rise above the roof plane
    const ext = 0.12;
    const poly: P2[] = [[-a - ext, e - 0.4], [a + ext, e - 0.4], [a + ext, e + c * 0.6], [0, r + c], [-a - ext, e + c * 0.6]];
    extrudeXY(b, poly, L / 2 - 0.55, L / 2 + 0.06);
    extrudeXY(b, poly, -L / 2 - 0.06, -L / 2 + 0.55);
    // Finials at the apexes.
    for (const z of [L / 2 - 0.24, -L / 2 + 0.24]) {
      b.push();
      b.transform(0, r + c, z);
      chamferBox(b, 0, 0, 0, 0.42, 0.9, 0.42, 0.06);
      b.transform(0, 0.9, 0);
      lathe(b, [[0.2, 0], [0.12, 0.35], [0.02, 1.1]], 4, { smooth: false, phase: Math.PI / 4 });
      b.pop();
    }
  } else {
    b.flatTri(-a, e, L / 2, a, e, L / 2, 0, r - t, L / 2);
    b.flatTri(a, e, -L / 2, -a, e, -L / 2, 0, r - t, -L / 2);
  }
  b.uvMode = prevMode;
}

function hipZ(b: MeshBuilder, p: RoofParams, a: number, L: number, pyramid: boolean): void {
  const e = p.eaveY, r = p.ridgeY, h = r - e;
  const k = h / Math.min(a, L / 2);
  const oE = p.overhang;
  const t = p.thickness * Math.sqrt(1 + k * k);
  const xE = a + oE, yE = e - oE * k;
  const zE = L / 2 + oE;
  const rl = pyramid ? 0 : Math.max(0, L / 2 - a);
  const base = b.getColor();
  b.material(p.roofMaterial);
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const sl = Math.sqrt(xE * xE + (r - yE) ** 2);
  tinted(b, base, p.slopeTints?.[0], () => b.flatQuad(xE, yE, zE, xE, yE, -zE, 0, r, -rl, 0, r, rl, [2 * zE, 0, 0, 0, zE - rl, sl, zE + rl, sl]));
  tinted(b, base, p.slopeTints?.[1], () => b.flatQuad(-xE, yE, -zE, -xE, yE, zE, 0, r, rl, 0, r, -rl, [0, 0, 2 * zE, 0, zE + rl, sl, zE - rl, sl]));
  const sz = Math.sqrt((zE - rl) ** 2 + (r - yE) ** 2);
  b.flatTri(-xE, yE, zE, xE, yE, zE, 0, r, rl, [0, 0, 2 * xE, 0, xE, sz]);
  b.flatTri(xE, yE, -zE, -xE, yE, -zE, 0, r, -rl, [0, 0, 2 * xE, 0, xE, sz]);
  // Soffit ring as a flat ceiling under the overhang and fascias.
  b.uvMode = "world";
  b.material(p.soffitMaterial ?? p.roofMaterial);
  b.color(base[0] * SOFFIT_SHADE, base[1] * SOFFIT_SHADE, base[2] * SOFFIT_SHADE);
  const outer: P2[] = [[-xE, -zE], [xE, -zE], [xE, zE], [-xE, zE]];
  const inner: P2[] = [[-a, -L / 2], [a, -L / 2], [a, L / 2], [-a, L / 2]];
  for (let i = 0; i < 4; i++) {
    const o0 = outer[i], o1 = outer[(i + 1) % 4], i0 = inner[i], i1 = inner[(i + 1) % 4];
    b.flatQuad(o0[0], yE - t, o0[1], o1[0], yE - t, o1[1], i1[0], e - t * 0.5, i1[1], i0[0], e - t * 0.5, i0[1]);
  }
  b.color(base[0], base[1], base[2]);
  b.material(p.roofMaterial);
  prism(b, outer, yE - t, yE, { top: false });
  b.material(p.trimMaterial);
  if (rl > 0.05) {
    b.push();
    b.transform(0, r - 0.05, 0, 0, 0, Math.PI / 4);
    box(b, 0, -0.11, 0, 0.22, 0.22, rl * 2 + 0.1, { top: true });
    b.pop();
  }
  b.push();
  b.transform(0, r, 0);
  lathe(b, [[0.12, -0.05], [0.07, 0.4], [0.015, 1.2]], 6, { smooth: false });
  b.pop();
  b.uvMode = prevMode;
}

function halfHipZ(b: MeshBuilder, p: RoofParams, a: number, L: number): void {
  const e = p.eaveY, r = p.ridgeY, h = r - e;
  const k = h / a;
  const yc = e + h * 0.58;
  const xc = (r - yc) / k;
  const oE = p.overhang, oV = p.verge;
  const t = p.thickness * Math.sqrt(1 + k * k);
  const xE = a + oE, yE = e - oE * k;
  const zF = L / 2 + oV;
  const rl = Math.max(0.2, L / 2 - xc);
  const base = b.getColor();
  b.material(p.roofMaterial);
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  // Main slopes as planar hexagons (u along the ridge, v up the slope).
  const nrm = Math.sqrt(1 + k * k);
  const vAxisR: [number, number, number] = [-1 / nrm, k / nrm, 0];
  const s0 = Math.sqrt(xE * xE + (r - yE) ** 2);
  const ptsR: P2[] = [[-zF, 0], [zF, 0], [zF, s0 - xc * nrm], [rl, s0], [-rl, s0], [-zF, s0 - xc * nrm]];
  tinted(b, base, p.slopeTints?.[0], () => panel(b, ptsR, [xE, yE, 0], [0, 0, -1], vAxisR));
  const vAxisL: [number, number, number] = [1 / nrm, k / nrm, 0];
  tinted(b, base, p.slopeTints?.[1], () => panel(b, ptsR, [-xE, yE, 0], [0, 0, 1], vAxisL));
  // Hip triangles at each end.
  const kz = (r - yc) / Math.max(zF - rl, 0.1);
  void kz;
  b.flatTri(-xc, yc, zF, xc, yc, zF, 0, r, rl);
  b.flatTri(xc, yc, -zF, -xc, yc, -zF, 0, r, -rl);
  b.uvMode = "world";
  b.material(p.soffitMaterial ?? p.roofMaterial);
  b.color(base[0] * SOFFIT_SHADE, base[1] * SOFFIT_SHADE, base[2] * SOFFIT_SHADE);
  b.flatQuad(0, r - t, zF, 0, r - t, -zF, xE, yE - t, -zF, xE, yE - t, zF);
  b.flatQuad(0, r - t, -zF, 0, r - t, zF, -xE, yE - t, zF, -xE, yE - t, -zF);
  b.color(base[0], base[1], base[2]);
  b.material(p.roofMaterial);
  b.flatQuad(xE, yE, -zF, xE, yE, zF, xE, yE - t, zF, xE, yE - t, -zF);
  b.flatQuad(-xE, yE, zF, -xE, yE, -zF, -xE, yE - t, -zF, -xE, yE - t, zF);
  b.material(p.trimMaterial);
  b.push();
  b.transform(0, r - 0.05, 0, 0, 0, Math.PI / 4);
  box(b, 0, -0.11, 0, 0.22, 0.22, rl * 2 + 0.1, { top: true });
  b.pop();
  // Gable walls below the hips.
  b.material(p.gableMaterial);
  panel(b, [[-a, e], [a, e], [xc, yc - t], [-xc, yc - t]], [0, 0, L / 2], [1, 0, 0], [0, 1, 0]);
  panel(b, [[-a, e], [a, e], [xc, yc - t], [-xc, yc - t]], [0, 0, -L / 2], [-1, 0, 0], [0, 1, 0]);
  b.uvMode = prevMode;
}

function leanTo(b: MeshBuilder, p: RoofParams, w: number, d: number): void {
  // Rises toward local -Z.
  const e = p.eaveY, r = p.ridgeY, h = Math.max(r - e, 0.05);
  const k = h / d;
  const oE = p.overhang, oV = p.verge;
  const t = p.thickness * Math.sqrt(1 + k * k);
  const xV = w / 2 + oV;
  const zLow = d / 2 + oE, yLow = e - oE * k;
  const zHigh = -d / 2 - 0.08, yHigh = r + 0.08 * k;
  const base = b.getColor();
  b.material(p.roofMaterial);
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const sl = Math.sqrt((zLow - zHigh) ** 2 + (yHigh - yLow) ** 2);
  tinted(b, base, p.slopeTints?.[0], () => b.flatQuad(-xV, yLow, zLow, xV, yLow, zLow, xV, yHigh, zHigh, -xV, yHigh, zHigh, [0, 0, 2 * xV, 0, 2 * xV, sl, 0, sl]));
  b.uvMode = "world";
  b.material(p.soffitMaterial ?? p.roofMaterial);
  b.color(base[0] * SOFFIT_SHADE, base[1] * SOFFIT_SHADE, base[2] * SOFFIT_SHADE);
  b.flatQuad(-xV, yHigh - t, zHigh, xV, yHigh - t, zHigh, xV, yLow - t, zLow, -xV, yLow - t, zLow);
  b.color(base[0], base[1], base[2]);
  b.material(p.roofMaterial);
  b.flatQuad(-xV, yLow - t, zLow, xV, yLow - t, zLow, xV, yLow, zLow, -xV, yLow, zLow);
  b.flatQuad(xV, yLow - t, zLow, xV, yHigh - t, zHigh, xV, yHigh, zHigh, xV, yLow, zLow);
  b.flatQuad(-xV, yHigh - t, zHigh, -xV, yLow - t, zLow, -xV, yLow, zLow, -xV, yHigh, zHigh);
  // Side triangles and the high back wall.
  b.material(p.gableMaterial);
  const hw = w / 2;
  b.flatTri(hw, e, d / 2, hw, e, -d / 2, hw, r - t, -d / 2);
  b.flatTri(-hw, e, -d / 2, -hw, e, d / 2, -hw, r - t, -d / 2);
  b.flatQuad(hw, e, -d / 2, -hw, e, -d / 2, -hw, r, -d / 2, hw, r, -d / 2);
  b.uvMode = prevMode;
}

function flatRoof(b: MeshBuilder, p: RoofParams, outline: readonly P2[], parapet: boolean): void {
  const e = p.eaveY, r = p.ridgeY;
  b.material(p.trimMaterial);
  const prevMode = b.uvMode;
  b.uvMode = "world";
  if (parapet && r > e + 0.2) {
    b.material(p.gableMaterial);
    const inner = offsetPolygon(outline, -0.35);
    prism(b, outline, e, r, { top: false });
    // Inner face of the parapet (reverse orientation by swapping to the inset ring).
    prism(b, inner, e, r, { top: false, inward: true });
    b.material(p.trimMaterial);
    const coping = offsetPolygon(outline, 0.06);
    bevelPrism(b, coping, r, r + 0.18, 0.06);
    b.material(p.roofMaterial);
    prism(b, inner, e - 0.1, e + 0.05, { top: true });
  } else {
    b.material(p.roofMaterial);
    const grown = offsetPolygon(outline, 0.12);
    bevelPrism(b, grown, e, e + 0.25, 0.08, { bottom: true });
  }
  b.uvMode = prevMode;
}

function cone(b: MeshBuilder, p: RoofParams, radius: number, bellcast: boolean): void {
  const e = p.eaveY, r = p.ridgeY;
  const seg = p.segments ?? 14;
  const oE = p.overhang;
  b.material(p.roofMaterial);
  const prof: P2[] = bellcast
    ? [[radius + oE, e - oE * 0.35], [radius * 0.9, e + (r - e) * 0.16], [radius * 0.5, e + (r - e) * 0.55], [0.03, r]]
    : [[radius + oE, e - oE * 0.6], [0.03, r]];
  lathe(b, prof, seg, { smooth: true });
  const base = b.getColor();
  b.color(base[0] * SOFFIT_SHADE, base[1] * SOFFIT_SHADE, base[2] * SOFFIT_SHADE);
  lathe(b, [[radius * 0.98, e - 0.05], [radius + oE, prof[0][1] - 0.04]], seg, { smooth: true });
  b.color(base[0], base[1], base[2]);
  b.material(p.trimMaterial);
  b.push();
  b.transform(0, r - 0.05, 0);
  lathe(b, [[0.09, 0], [0.12, 0.25], [0.05, 0.4], [0.015, 1.4]], 6, { smooth: false });
  b.pop();
}

function spire(b: MeshBuilder, p: RoofParams, radius: number, sides: number): void {
  const e = p.eaveY, r = p.ridgeY;
  b.material(p.roofMaterial);
  const phase = Math.PI / sides;
  lathe(b, [[radius * 1.04, e - 0.05], [radius * 0.94, e + (r - e) * 0.06], [radius * 0.12, e + (r - e) * 0.86], [0.02, r]], sides, { smooth: false, phase });
  b.material(p.trimMaterial);
  // Lucarnes: small gabled openings on alternate faces low on the spire.
  const ly = e + (r - e) * 0.22;
  const lr = radius * 0.78;
  for (let i = 0; i < sides; i += 2) {
    const a = phase + ((i + 0.5) / sides) * Math.PI * 2;
    b.push();
    b.transform(Math.sin(a) * lr, ly, Math.cos(a) * lr, a);
    box(b, 0, 0, 0.1, 0.5, 0.9, 0.5);
    b.transform(0, 0.9, 0.1);
    lathe(b, [[0.36, 0], [0.02, 0.55]], 4, { smooth: false, phase: Math.PI / 4 });
    b.pop();
  }
  b.push();
  b.transform(0, r - 0.1, 0);
  lathe(b, [[0.1, 0], [0.16, 0.3], [0.06, 0.5], [0.08, 0.9], [0.015, 2.0]], 6, { smooth: false });
  b.pop();
}

function openFrame(b: MeshBuilder, p: RoofParams, a: number, L: number): void {
  const e = p.eaveY, r = Math.max(p.ridgeY, e + a * 1.4);
  b.material(p.trimMaterial);
  const prevMode = b.uvMode;
  b.uvMode = "world";
  const count = Math.max(2, Math.floor(L / 1.4));
  const k = (r - e) / a;
  const rafterLen = Math.sqrt(a * a + (r - e) ** 2);
  const ang = Math.atan2(r - e, a);
  // Only the first part of the frame is raised: the rest waits for the next stage.
  const raised = Math.max(2, Math.floor(count * 0.45));
  for (let i = 0; i < raised; i++) {
    const z = -L / 2 + 0.3 + (i * (L - 0.6)) / (count - 1);
    for (const s of [1, -1]) {
      b.push();
      b.transform(s * a * 0.5, e + (r - e) * 0.5, z, 0, 0, -s * ang);
      box(b, 0, -0.08, 0, rafterLen + 0.3, 0.16, 0.14);
      b.pop();
    }
    // Collar tie.
    box(b, 0, e + (r - e) * 0.55, z, a * 0.9, 0.14, 0.12);
  }
  void k;
  // Wall plates and part of the ridge beam.
  box(b, a - 0.1, e, 0, 0.22, 0.2, L);
  box(b, -a + 0.1, e, 0, 0.22, 0.2, L);
  const zr = -L / 2 + 0.3 + ((raised - 1) * (L - 0.6)) / (count - 1);
  box(b, 0, r - 0.12, (-L / 2 + zr) / 2, 0.18, 0.2, zr + L / 2 + 0.2);
  b.uvMode = prevMode;
}

/** Builds a roof in the mass's local frame. */
export function roof(b: MeshBuilder, p: RoofParams): void {
  const form = p.form;
  if (form === "none") return;
  if (p.plan !== "rect") {
    const radius = p.w / 2;
    if (form === "conical" || form === "spire" || form === "pyramid") {
      if (form === "spire" && p.plan === "octagon") spire(b, p, radius, 8);
      else cone(b, p, radius, form !== "spire");
      return;
    }
    if (form === "dome") {
      b.material(p.roofMaterial);
      const prof: P2[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        prof.push([radius * 1.02 * Math.cos(a), p.eaveY + (p.ridgeY - p.eaveY) * Math.sin(a)]);
      }
      prof[prof.length - 1] = [0.02, p.ridgeY];
      lathe(b, prof, p.segments ?? 16, { smooth: true });
      return;
    }
    flatRoof(b, p, p.plan === "octagon" ? octagon(radius) : circle(radius, p.segments ?? 16), form === "flat-parapet" || form === "terrace");
    return;
  }
  const alongZ = p.axis === "z";
  const a = (alongZ ? p.w : p.d) / 2;
  const L = alongZ ? p.d : p.w;
  b.push();
  if (!alongZ) b.rotateY(Math.PI / 2);
  switch (form) {
    case "gable":
    case "steep-gable":
    case "sod-gable":
    case "curved-ridge":
      gableZ(b, p, a, L);
      break;
    case "hip":
      hipZ(b, p, a, L, false);
      break;
    case "pyramid":
      hipZ(b, p, a, L, true);
      break;
    case "half-hip":
      halfHipZ(b, p, a, L);
      break;
    case "spire":
      b.pop();
      spire(b, p, Math.min(p.w, p.d) / 2 - 0.15, 8);
      return;
    case "conical":
      b.pop();
      cone(b, p, Math.min(p.w, p.d) / 2, true);
      return;
    case "lean-to":
      b.pop();
      b.push();
      if (p.axis === "z") b.rotateY(Math.PI / 2);
      leanTo(b, p, p.axis === "z" ? p.d : p.w, p.axis === "z" ? p.w : p.d);
      break;
    case "open-frame":
      openFrame(b, p, a, L);
      break;
    case "dome":
    case "barrel-vault":
    case "flat":
    case "flat-parapet":
    case "terrace":
    case "sawtooth":
    case "setback-crown":
      b.pop();
      flatRoof(b, p, rectOutline(p.w, p.d), form !== "flat");
      return;
  }
  b.pop();
}

function octagon(radius: number): P2[] {
  const out: P2[] = [];
  const r = radius / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    out.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  return out;
}

function circle(radius: number, seg: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push([Math.sin(a) * radius, Math.cos(a) * radius]);
  }
  return out;
}
