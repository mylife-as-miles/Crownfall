// Structural detail: stepped buttresses, chimney stacks with caps (and smoke
// sources), keep parapets with machicolation and corner bartizans, scaffolding,
// open canopies, platforms with steps, corbelled oriels, gallery struts, iron
// strapping and raking shores.

import { band, bevelPrism, box, chamferBox, circleOutline, crenellate, extrudeXY, lathe, prism, rectOutline, roof } from "../../kernel";
import type { MeshBuilder, P2 } from "../../kernel";
import type { KitContext } from "../context";
import { rectFaces, toWorld } from "./frame";
import type { MassFrame } from "./frame";

/** Stepped Gothic buttresses on the long faces between bays (and at the corners). */
export function buttresses(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string, bay = 3.4): void {
  const m = f.mass;
  const eave = m.eaveHeight;
  b.material(ctx.mat(wallKey));
  const faces = rectFaces(f.w, f.d);
  const depth = Math.min(1.1, 0.45 + eave * 0.05);
  const width = 0.8;
  for (const face of faces) {
    if (!face.long && f.mass.role !== "keep") continue;
    const len = face.length;
    const margin = Math.min(0.9, len * 0.18);
    const n = Math.max(1, Math.floor((len - 2 * margin) / bay));
    for (let i = 0; i <= n; i++) {
      const along = -len / 2 + margin + (i * (len - 2 * margin)) / n;
      const rx = face.nz !== 0 ? face.nz : 0;
      const rz = face.nx !== 0 ? -face.nx : 0;
      const lx = face.cx + rx * along, lz = face.cz + rz * along;
      const probe = toWorld(f, lx + face.nx * (depth + 0.3), lz + face.nz * (depth + 0.3));
      if (ctx.masses.occupied(probe[0], f.y0 + 1.5, probe[1], (bid, mm) => bid === f.building.id && mm === m)) continue;
      b.push();
      b.transform(lx, 0, lz, face.yaw - Math.PI / 2);
      const h1 = eave * 0.45, h2 = eave * 0.82;
      const d2 = depth * 0.62;
      const profile: P2[] = [[-0.05, f.footY], [depth, f.footY], [depth, h1], [d2, h1 + (depth - d2) * 1.3], [d2, h2], [-0.05, h2 + d2 * 1.5]];
      extrudeXY(b, profile, -width / 2, width / 2);
      b.pop();
    }
  }
}

/** Chimney stack: shaft, corbelled cap, dark flue, and a smoke source. */
export function chimney(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string, smoke: boolean): void {
  const m = f.mass;
  b.material(ctx.mat(wallKey));
  const top = m.ridgeHeight;
  chamferBox(b, 0, f.footY, 0, f.w, top - f.footY, f.d, 0.05, { top: false });
  b.material(ctx.mat(f.style.plinthMaterial));
  band(b, rectOutline(f.w, f.d), top - 0.35, 0.18, 0.08);
  bevelPrism(b, rectOutline(f.w + 0.12, f.d + 0.12), top - 0.17, top + 0.08, 0.05);
  // Flue pots.
  const pots = f.d > 1.6 || f.w > 1.6 ? 2 : 1;
  const prev = b.getColor();
  b.color(prev[0] * 0.55, prev[1] * 0.5, prev[2] * 0.48);
  for (let i = 0; i < pots; i++) {
    const off = pots === 1 ? 0 : (i - 0.5) * Math.min(f.w, f.d) * 0.5;
    b.push();
    b.translate(f.w >= f.d ? off : 0, top + 0.08, f.w >= f.d ? 0 : off);
    prism(b, circleOutline(0.16, 8), 0, 0.45, { smooth: true, top: true });
    b.pop();
  }
  b.color(prev[0], prev[1], prev[2]);
  if (smoke) {
    const p = toWorld(f, 0, 0);
    ctx.smoke.push({ id: `${f.building.id}:${m.id}`, position: [p[0], f.y0 + top + 0.6, p[1]], strength: f.building.function === "forge" ? 1 : f.building.function === "kitchen" ? 0.8 : 0.45, color: "#857c88", gate: null });
  }
}

/** Keep crown: corbel table, crenellated parapet and corner bartizans with cones. */
export function keepCrown(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string, roofKey: string): void {
  const m = f.mass;
  const eave = m.eaveHeight;
  const wall = ctx.mat(wallKey);
  b.material(wall);
  const proj = 0.45;
  const outer = rectOutline(f.w + proj * 2, f.d + proj * 2);
  // Corbel table (stepped).
  bevelPrism(b, rectOutline(f.w + proj, f.d + proj), eave - 0.9, eave - 0.45, 0.2, { bottom: true });
  prism(b, outer, eave - 0.45, eave + 1.1, { top: false, bottom: true });
  // Inner face of the parapet.
  prism(b, rectOutline(f.w + proj * 2 - 0.7, f.d + proj * 2 - 0.7), eave - 0.45, eave + 1.1, { top: false, inward: true });
  // Walkway.
  prism(b, rectOutline(f.w + proj * 2 - 0.6, f.d + proj * 2 - 0.6), eave - 0.1, eave + 0.05, { top: true });
  // Merlons.
  const hw = f.w / 2 + proj - 0.17, hd = f.d / 2 + proj - 0.17;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const rng = ctx.rng(`crenel:${f.building.id}`);
  const weathered = f.building.age.condition === "weathered" || f.building.age.condition === "damaged";
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    crenellate(b, a[0], a[1], c[0], c[1], eave + 1.1, 0.34, 0.8, 0.85, 0.65, () => !weathered || rng.chance(0.82));
  }
  // Bartizans at the corners.
  const roofMat = ctx.mat(roofKey);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    b.push();
    b.translate(sx * (f.w / 2 + proj * 0.6), 0, sz * (f.d / 2 + proj * 0.6));
    b.material(wall);
    lathe(b, [[0.15, eave - 2.6], [0.95, eave - 1.2], [0.95, eave + 1.9]], 10, { smooth: false });
    roof(b, { form: "conical", axis: "z", w: 1.9, d: 1.9, eaveY: eave + 1.9, ridgeY: eave + 4.6, plan: "round", overhang: 0.12, verge: 0, thickness: 0.1, roofMaterial: roofMat, gableMaterial: wall, trimMaterial: ctx.mat(ctx.style.keys.trim), segments: 10 });
    b.pop();
  }
}

/** Scaffold of poles, ledgers and planks around an unfinished mass. */
export function scaffold(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  b.material(ctx.mat("timber-raw"));
  const m = f.mass;
  const h = m.eaveHeight;
  const along = f.d >= f.w ? "z" : "x";
  const L = along === "z" ? f.d : f.w;
  const W = along === "z" ? f.w : f.d;
  const n = Math.max(2, Math.round(L / 2));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (i * L) / (n - 1);
    for (const s of [-1, 1]) {
      const x = along === "z" ? s * W * 0.45 : t;
      const z = along === "z" ? t : s * W * 0.45;
      box(b, x, f.footY, z, 0.1, h - f.footY + 0.6, 0.1);
    }
  }
  for (let y = 1.8; y < h; y += 1.8) {
    for (const s of [-1, 1]) {
      if (along === "z") box(b, s * W * 0.45, y, 0, 0.08, 0.08, L);
      else box(b, 0, y, s * W * 0.45, L, 0.08, 0.08);
    }
    // Plank deck.
    if (along === "z") box(b, 0, y + 0.06, 0, W * 0.9, 0.05, L);
    else box(b, 0, y + 0.06, 0, L, 0.05, W * 0.9);
  }
}

/** Open canopy (forge front): corner posts under a lean-to roof. */
export function canopyPosts(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  b.material(ctx.mat("timber-dark"));
  const h = f.mass.eaveHeight;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, sx * (f.w / 2 - 0.12), f.footY, sz * (f.d / 2 - 0.12), 0.18, h - f.footY, 0.18);
  box(b, 0, h - 0.2, f.d / 2 - 0.12, f.w, 0.2, 0.18);
  box(b, 0, h - 0.2, -f.d / 2 + 0.12, f.w, 0.2, 0.18);
}

/** Raised stone platform with moulded edge and steps on its front (+Z) face. */
export function platform(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string): void {
  const m = f.mass;
  const h = m.eaveHeight;
  b.material(ctx.mat(wallKey));
  prism(b, rectOutline(f.w, f.d), f.footY, h - 0.18, { top: false });
  bevelPrism(b, rectOutline(f.w + 0.16, f.d + 0.16), h - 0.18, h, 0.06);
  const steps = Math.max(2, Math.round(h / 0.32));
  const rise = h / steps;
  for (let i = 0; i < steps - 1; i++) {
    const depth = (steps - 1 - i) * 0.38;
    box(b, 0, f.footY + 0, f.d / 2 + depth / 2, Math.min(f.w * 0.55, 8), (i + 1) * rise - f.footY, depth, { top: true });
  }
}

/** Corbelled support under an oriel or elevated annex. */
export function corbel(ctx: KitContext, b: MeshBuilder, f: MassFrame, wallKey: string): void {
  b.material(ctx.mat(wallKey));
  lathe(b, [[0.12, -1.6], [Math.min(f.w, f.d) * 0.62, 0]], 4, { smooth: false, phase: Math.PI / 4, capTop: true });
}

/** Timber struts under an elevated gallery bridge. */
export function galleryStruts(ctx: KitContext, b: MeshBuilder, f: MassFrame): void {
  b.material(ctx.mat("timber-dark"));
  const n = Math.max(2, Math.round(f.w / 2));
  for (let i = 0; i < n; i++) {
    const x = -f.w / 2 + 0.3 + (i * (f.w - 0.6)) / (n - 1);
    box(b, x, -0.35, 0, 0.18, 0.35, f.d + 0.1);
  }
  box(b, 0, -0.5, f.d / 2, f.w, 0.18, 0.2);
  box(b, 0, -0.5, -f.d / 2, f.w, 0.18, 0.2);
}

/** Iron bands around a mass (frost-split quoins). */
export function ironBands(ctx: KitContext, b: MeshBuilder, f: MassFrame, count: number): void {
  b.material(ctx.mat("iron"));
  const h = f.mass.eaveHeight;
  for (let i = 0; i < count; i++) {
    const y = h * (0.35 + (i * 0.5) / Math.max(1, count));
    if (f.round) prism(b, circleOutline(f.w / 2 + 0.04, 16), y, y + 0.12, { smooth: true, top: true, bottom: true });
    else prism(b, rectOutline(f.w + 0.08, f.d + 0.08), y, y + 0.12, { top: true, bottom: true });
  }
}

/** Raking timber shore propped against a leaning wall. */
export function rakingShore(ctx: KitContext, b: MeshBuilder, f: MassFrame, side: 1 | -1): void {
  b.material(ctx.mat("timber-raw"));
  const h = f.mass.eaveHeight * 0.7;
  const x = side * (f.w / 2 + h * 0.32);
  const ang = Math.atan2(h, h * 0.32 * 2);
  b.push();
  b.transform(x - side * h * 0.16, h * 0.5, 0, 0, 0, side > 0 ? ang : -ang);
  box(b, 0, -0.1, 0, Math.sqrt(h * h + (h * 0.32) ** 2) * 1.0, 0.22, 0.22);
  b.pop();
  box(b, x, f.footY, 0, 0.5, 0.25 - f.footY, 0.5);
}
