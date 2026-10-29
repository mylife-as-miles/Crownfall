// Base figure kit: palette-parameterised low-poly people (~1.75 m) built from a
// small skeleton (hips, knees, shoulders, elbows) with lofted torso, tapered limbs,
// tunic skirts, cloaks, helmets and carried props. Poses: standing, walking
// (two stride frames), working, carrying, guard, salute, herald and resting.

import { atlasUv } from "../../heraldry/atlas";
import { box, chamferBox, hexToLinear, lathe, loft, MeshBuilder } from "../../kernel";
import type { MeshBuffer, V3 } from "../../kernel";

export interface FigurePalette {
  skin: string;
  hair: string;
  tunic: string;
  hose: string;
  boots: string;
  belt: string;
  cloak: string | null;
  metal: string;
  /** Tabard in the player's heraldry (atlas cloth). */
  tabard: boolean;
  helmet: boolean;
  hood: boolean;
}

export type FigurePose = "stand" | "walk-a" | "walk-b" | "work" | "carry" | "guard" | "salute" | "herald" | "rest";

export const FIGURE_PALETTES: Readonly<Record<string, FigurePalette>> = {
  guard: { skin: "#b08a74", hair: "#2a211c", tunic: "#3a3640", hose: "#2a2830", boots: "#1f1a17", belt: "#3b2a1e", cloak: "#3d2f4e", metal: "#6d6f76", tabard: false, helmet: true, hood: false },
  levy: { skin: "#b9937a", hair: "#3a2c22", tunic: "#4d4639", hose: "#3a352d", boots: "#2a211b", belt: "#4a3424", cloak: null, metal: "#707278", tabard: true, helmet: true, hood: false },
  civilian: { skin: "#c29c82", hair: "#3b2d24", tunic: "#6a5a45", hose: "#4a4236", boots: "#2e251e", belt: "#4b3726", cloak: null, metal: "#5a5a5e", tabard: false, helmet: false, hood: false },
  smith: { skin: "#b48a70", hair: "#221a15", tunic: "#4e3a2a", hose: "#3a3128", boots: "#241d18", belt: "#5b3e26", cloak: null, metal: "#4c4c50", tabard: false, helmet: false, hood: false },
  herald: { skin: "#c09a80", hair: "#2a201a", tunic: "#2f2a38", hose: "#26222c", boots: "#1c1815", belt: "#8a6a2a", cloak: "#4a3560", metal: "#a8873a", tabard: false, helmet: false, hood: true },
};

interface Joints {
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  shoulderL: [number, number]; shoulderR: [number, number];
  elbowL: number; elbowR: number;
  lean: number;
}

const POSES: Readonly<Record<FigurePose, Joints>> = {
  stand: { hipL: 0, hipR: 0, kneeL: 0.05, kneeR: 0.05, shoulderL: [0.05, -0.12], shoulderR: [0.05, 0.12], elbowL: -0.15, elbowR: -0.15, lean: 0 },
  "walk-a": { hipL: -0.42, hipR: 0.34, kneeL: 0.12, kneeR: 0.55, shoulderL: [0.38, -0.1], shoulderR: [-0.42, 0.1], elbowL: -0.35, elbowR: -0.2, lean: 0.05 },
  "walk-b": { hipL: 0.34, hipR: -0.42, kneeL: 0.55, kneeR: 0.12, shoulderL: [-0.42, -0.1], shoulderR: [0.38, 0.1], elbowL: -0.2, elbowR: -0.35, lean: 0.05 },
  work: { hipL: -0.15, hipR: 0.12, kneeL: 0.2, kneeR: 0.1, shoulderL: [-0.9, -0.15], shoulderR: [-2.3, 0.2], elbowL: -0.9, elbowR: -0.5, lean: 0.18 },
  carry: { hipL: -0.2, hipR: 0.18, kneeL: 0.15, kneeR: 0.3, shoulderL: [-0.8, -0.25], shoulderR: [-0.8, 0.25], elbowL: -1.2, elbowR: -1.2, lean: 0.06 },
  guard: { hipL: 0.04, hipR: -0.04, kneeL: 0.05, kneeR: 0.05, shoulderL: [-0.35, -0.25], shoulderR: [-0.25, 0.2], elbowL: -1.1, elbowR: -1.25, lean: 0 },
  salute: { hipL: 0, hipR: 0, kneeL: 0.04, kneeR: 0.04, shoulderL: [0.05, -0.12], shoulderR: [-1.15, 0.45], elbowL: -0.1, elbowR: -2.0, lean: -0.02 },
  herald: { hipL: 0.02, hipR: -0.02, kneeL: 0.05, kneeR: 0.05, shoulderL: [-0.65, -0.2], shoulderR: [0.05, 0.12], elbowL: -1.4, elbowR: -0.15, lean: 0 },
  rest: { hipL: -1.5, hipR: -1.5, kneeL: 0.2, kneeR: 0.25, shoulderL: [0.1, -0.2], shoulderR: [0.1, 0.2], elbowL: -0.2, elbowR: -0.3, lean: 0 },
};

function ellipseRing(y: number, a: number, c: number, seg: number, z = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    out.push(Math.sin(t) * a, y, Math.cos(t) * c + z);
  }
  return out;
}

/** Current level of detail while a prototype is being built (0 = desktop, 1 = Quest miniature). */
let LOD: 0 | 1 = 0;

function limb(b: MeshBuilder, len: number, r0: number, r1: number): void {
  if (LOD >= 1) lathe(b, [[r1, -len], [r0, 0]], 4, { smooth: true, phase: Math.PI / 4 });
  else lathe(b, [[r1, -len], [r0 * 0.96, -len * 0.5], [r0, 0]], 6, { smooth: true });
}

function col(b: MeshBuilder, hex: string, k = 1): void {
  const c: V3 = hexToLinear(hex);
  b.color(c[0] * k, c[1] * k, c[2] * k);
}

/**
 * Builds one figure prototype; heraldic tabards use the cloth-heraldry atlas material.
 * `lod` 1 is the Quest miniature representation (fewer segments, no facial planes): at
 * 1:125 a figure is under 1.5 cm tall, so silhouette and palette carry it.
 */
export function buildFigure(paletteId: string, pose: FigurePose, lod: 0 | 1 = 0): MeshBuffer[] {
  const p = FIGURE_PALETTES[paletteId] ?? FIGURE_PALETTES.civilian;
  const j = POSES[pose];
  LOD = lod;
  const b = new MeshBuilder();
  b.part("figures").material("figure").shadows(true, true);
  b.uvMode = "explicit";
  if (pose === "rest") {
    // Resting on a cot: the figure lies along +Z on a low frame.
    col(b, "#4a3a2c");
    box(b, 0, 0, 0.2, 0.75, 0.38, 2.0);
    col(b, "#8a8070");
    box(b, 0, 0.38, 0.2, 0.7, 0.08, 1.95);
    b.push();
    b.transform(0, 0.55, 1.0, 0, -Math.PI / 2, 0);
    bodyAt(b, p, POSES.stand, false);
    b.pop();
    return b.finish();
  }
  bodyAt(b, p, j, pose === "guard" || pose === "salute" ? p.helmet : p.helmet && pose !== "work");
  // Props.
  if (pose === "guard" || ((pose === "walk-a" || pose === "walk-b" || pose === "stand") && paletteId === "guard")) {
    col(b, "#3b2c20");
    box(b, 0.3, 0, 0.12, 0.04, 2.3, 0.04);
    col(b, p.metal, 1.2);
    b.push();
    b.translate(0.32, 2.3, 0.14);
    lathe(b, [[0.035, 0], [0.012, 0.22]], 4, { smooth: false });
    b.pop();
    // Heater shield on the left forearm.
    col(b, "#3d2f4e");
    b.push();
    b.transform(-0.3, 1.0, 0.12, 0.25);
    chamferBox(b, 0, -0.25, 0, 0.42, 0.55, 0.05, 0.08);
    b.pop();
  }
  if (paletteId === "levy" && pose === "stand") {
    col(b, "#3b2c20");
    box(b, -0.3, 0, 0.1, 0.035, 2.05, 0.035);
    col(b, p.metal, 1.15);
    b.push();
    b.translate(-0.3, 2.05, 0.1);
    lathe(b, [[0.032, 0], [0.01, 0.24]], 4, { smooth: false });
    b.pop();
  }
  if (pose === "work") {
    col(b, "#3b2c20");
    b.push();
    b.transform(0.22, 1.95, 0.32, 0, 0.4, 0);
    box(b, 0, -0.45, 0, 0.035, 0.5, 0.035);
    col(b, "#3c3c40");
    box(b, 0, 0, 0, 0.09, 0.1, 0.16);
    b.pop();
  }
  if (pose === "carry") {
    col(b, "#7a6448");
    chamferBox(b, 0, 1.05, 0.34, 0.42, 0.32, 0.3, 0.05);
  }
  if (pose === "herald") {
    col(b, "#d8cfb8");
    b.push();
    b.transform(-0.12, 1.22, 0.36, 0, 0, Math.PI / 2);
    lathe(b, [[0.03, -0.14], [0.03, 0.14]], 6, { smooth: true, capTop: true, capBottom: true });
    b.pop();
  }
  return b.finish();
}

function bodyAt(b: MeshBuilder, p: FigurePalette, j: Joints, helmet: boolean): void {
  const legLen = [0.42, 0.42];
  // Legs (hip at y 0.92).
  for (const side of [-1, 1]) {
    const hip = side < 0 ? j.hipL : j.hipR;
    const knee = side < 0 ? j.kneeL : j.kneeR;
    b.push();
    b.transform(side * 0.095, 0.92, 0, 0, hip, 0);
    col(b, p.hose);
    limb(b, legLen[0], 0.082, 0.062);
    b.transform(0, -legLen[0], 0, 0, knee, 0);
    limb(b, legLen[1], 0.064, 0.046);
    col(b, p.boots);
    b.translate(0, -legLen[1], 0);
    chamferBox(b, 0, -0.07, 0.05, 0.1, 0.1, 0.24, 0.025);
    b.pop();
  }
  b.push();
  b.transform(0, 0, 0, 0, j.lean, 0);
  // Torso loft.
  col(b, p.tunic);
  if (LOD >= 1) loft(b, [ellipseRing(0.88, 0.165, 0.11, 6), ellipseRing(1.3, 0.2, 0.12, 6), ellipseRing(1.47, 0.13, 0.09, 6)]);
  else loft(b, [
    ellipseRing(0.88, 0.165, 0.11, 8),
    ellipseRing(1.04, 0.15, 0.1, 8),
    ellipseRing(1.24, 0.19, 0.12, 8),
    ellipseRing(1.4, 0.21, 0.11, 8),
    ellipseRing(1.47, 0.13, 0.09, 8),
  ]);
  // Tunic skirt flaring to the knees.
  col(b, p.tunic, 0.92);
  if (LOD >= 1) loft(b, [ellipseRing(0.5, 0.25, 0.19, 6), ellipseRing(1.0, 0.163, 0.112, 6)]);
  else loft(b, [ellipseRing(0.5, 0.25, 0.19, 8), ellipseRing(0.78, 0.2, 0.14, 8), ellipseRing(1.0, 0.163, 0.112, 8)]);
  if (LOD < 1) {
    col(b, p.belt);
    loft(b, [ellipseRing(0.98, 0.168, 0.116, 8), ellipseRing(1.04, 0.158, 0.108, 8)]);
    // Buckle.
    col(b, p.metal, 1.1);
    box(b, 0, 0.985, 0.112, 0.05, 0.05, 0.02);
  }
  if (p.tabard) {
    const uv = atlasUv("player", "banner");
    b.material("cloth-heraldry");
    b.color(1, 1, 1);
    if (LOD >= 1) {
      for (const s of [1, -1]) {
        const z = s * 0.135;
        const a = b.vertex(-0.15, 0.52, z + s * 0.06, 0, 0, s, s > 0 ? uv[0] : uv[2], uv[1]);
        const c = b.vertex(0.15, 0.52, z + s * 0.06, 0, 0, s, s > 0 ? uv[2] : uv[0], uv[1]);
        const d = b.vertex(0.15, 1.42, z, 0, 0, s, s > 0 ? uv[2] : uv[0], uv[3]);
        const e = b.vertex(-0.15, 1.42, z, 0, 0, s, s > 0 ? uv[0] : uv[2], uv[3]);
        if (s > 0) b.quad(a, c, d, e);
        else b.quad(c, a, e, d);
      }
    } else {
      // Draped panels that follow the torso and fall straight over the skirt to the hem.
      const xs = [-0.165, -0.07, 0.07, 0.165];
      const rows: [number, number, number][] = [[0.52, 0.205, 0.17], [1.0, 0.132, 0.05], [1.42, 0.128, 0.06]];
      for (const s of [1, -1]) {
        const grid: number[][] = [];
        for (const [y, zc, ze] of rows) {
          const line: number[] = [];
          for (const x of xs) {
            const t = Math.abs(x) / 0.165;
            const z = s * (zc + (ze - zc) * t * t);
            const u = s > 0 ? uv[0] + ((x + 0.165) / 0.33) * (uv[2] - uv[0]) : uv[2] - ((x + 0.165) / 0.33) * (uv[2] - uv[0]);
            const v = uv[1] + ((y - 0.52) / 0.9) * (uv[3] - uv[1]);
            const nx = x * 2.2, nz = s;
            const nl = Math.hypot(nx, nz);
            line.push(b.vertex(x, y, z, nx / nl, 0, nz / nl, u, v));
          }
          grid.push(line);
        }
        for (let r = 0; r < rows.length - 1; r++) {
          for (let c = 0; c < xs.length - 1; c++) {
            const a = grid[r][c], c1 = grid[r][c + 1], d = grid[r + 1][c + 1], e = grid[r + 1][c];
            if (s > 0) b.quad(a, c1, d, e);
            else b.quad(c1, a, e, d);
          }
        }
      }
    }
    b.material("figure");
    if (LOD < 1) {
      // Belt cinching the tabard.
      col(b, p.belt);
      for (const s of [1, -1]) box(b, 0, 0.975, s * 0.14, 0.31, 0.055, 0.02);
    }
  }
  if (p.cloak) {
    col(b, p.cloak);
    if (LOD >= 1) loft(b, [ellipseRing(0.35, 0.3, 0.06, 5, -0.17), ellipseRing(1.44, 0.22, 0.05, 5, -0.11)]);
    else loft(b, [ellipseRing(0.35, 0.3, 0.06, 6, -0.17), ellipseRing(0.95, 0.26, 0.05, 6, -0.15), ellipseRing(1.44, 0.22, 0.05, 6, -0.11)]);
  }
  // Neck and head.
  col(b, p.skin);
  b.push();
  b.translate(0, 1.47, 0.01);
  lathe(b, [[0.05, 0], [0.048, 0.08]], LOD >= 1 ? 4 : 6, { smooth: true });
  b.translate(0, 0.17, 0.01);
  b.push();
  b.transform(0, 0, 0, 0, 0, 0, 0.095, 0.118, 0.105);
  lathe(b, [[0.02, -1], [0.75, -0.72], [1, -0.05], [0.9, 0.55], [0.02, 1]], LOD >= 1 ? 5 : 8, { smooth: true });
  b.pop();
  if (LOD < 1) {
    // Facial planes: nose, brow and eye shadows so a face reads at inspection distance.
    col(b, p.skin, 0.9);
    chamferBox(b, 0, -0.035, 0.1, 0.032, 0.06, 0.04, 0.01);
    col(b, p.hair, 0.8);
    b.flatQuad(-0.05, 0.03, 0.104, 0.05, 0.03, 0.104, 0.05, 0.045, 0.1, -0.05, 0.045, 0.1);
    col(b, "#1a1412");
    for (const sx of [-1, 1]) b.flatQuad(sx * 0.034 - 0.013, 0.008, 0.106, sx * 0.034 + 0.013, 0.008, 0.106, sx * 0.034 + 0.013, 0.02, 0.104, sx * 0.034 - 0.013, 0.02, 0.104);
  }
  if (helmet) {
    // Conical nasal helm on the brow and a mail collar: reads as a soldier at any distance.
    col(b, p.metal, 0.62);
    lathe(b, [[0.105, -0.23], [0.085, -0.16], [0.06, -0.115]], LOD >= 1 ? 5 : 8, { smooth: true });
    col(b, p.metal, 0.85);
    lathe(b, [[0.112, 0.035], [0.114, 0.07], [0.09, 0.135], [0.05, 0.185], [0.012, 0.225]], LOD >= 1 ? 5 : 8, { smooth: false });
    box(b, 0, -0.035, 0.112, 0.02, 0.075, 0.014);
  } else if (p.hood) {
    col(b, p.cloak ?? p.tunic, 0.9);
    lathe(b, [[0.13, -0.16], [0.13, 0.04], [0.1, 0.12], [0.02, 0.15]], LOD >= 1 ? 5 : 7, { smooth: true });
  } else {
    col(b, p.hair);
    b.push();
    b.transform(0, 0.03, -0.01, 0, 0, 0, 0.1, 0.1, 0.11);
    lathe(b, [[0.6, -0.2], [1, 0.25], [0.6, 0.85], [0.02, 1]], LOD >= 1 ? 5 : 7, { smooth: true });
    b.pop();
  }
  b.pop();
  // Arms from the shoulders.
  for (const side of [-1, 1]) {
    const sh = side < 0 ? j.shoulderL : j.shoulderR;
    const el = side < 0 ? j.elbowL : j.elbowR;
    b.push();
    b.transform(side * 0.215, 1.41, 0, 0, sh[0], sh[1]);
    col(b, p.tunic, 0.96);
    limb(b, 0.29, 0.056, 0.045);
    b.transform(0, -0.29, 0, 0, el, 0);
    limb(b, 0.25, 0.044, 0.034);
    col(b, p.skin);
    b.translate(0, -0.27, 0);
    chamferBox(b, 0, -0.04, 0, 0.06, 0.1, 0.07, 0.015);
    b.pop();
  }
  b.pop();
}
