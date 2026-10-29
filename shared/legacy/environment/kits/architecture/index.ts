// The architecture kit: turns any blueprint Building (masses, roof forms, tradition,
// foundation, age, repairs) into authored geometry. Landmark and district kits call
// it and add their own storytelling detail; nations differ through NationStyle.

import type { LandmarkId } from "../../../types";
import type { Building, BuildingMass } from "../../blueprint";
import { roof } from "../../kernel";
import type { MeshBuilder, StateGate } from "../../kernel";
import type { RoofShape } from "../../kernel/roofs";
import type { KitContext } from "../context";
import { traditionStyle } from "../nations/style";
import { buttresses, canopyPosts, chimney, corbel, galleryStruts, ironBands, keepCrown, platform, rakingShore, scaffold } from "./details";
import { massFrame } from "./frame";
import type { MassFrame } from "./frame";
import { rectOpenings, roundOpenings } from "./openings";
import { brokenShell, plinth, staddles, wallShell } from "./walls";

export { massFrame, toWorld, toMassLocal, rectFaces } from "./frame";
export type { MassFrame, Face } from "./frame";
export { massOutline } from "./walls";

export interface ArchitectureOptions {
  part?: string;
  landmark?: LandmarkId | null;
  /** Mass ids whose roof the calling kit builds itself. */
  skipRoof?: readonly string[];
  /** Mass ids skipped entirely. */
  skipMass?: readonly string[];
  /** Override masses (e.g. the completed form of an unfinished structure). */
  masses?: readonly BuildingMass[];
  /** Force a condition (completed variant of an unfinished structure). */
  condition?: Building["age"]["condition"];
  gate?: StateGate | null;
}

export function partFor(building: Building): string {
  if (building.landmark) return `landmark:${building.landmark}`;
  return building.district === "G" ? "outer" : "settlement";
}

/** Per-building colour: condition, quality and a small deterministic jitter. */
export function buildingTint(ctx: KitContext, building: Building, condition = building.age.condition): [number, number, number] {
  const rng = ctx.rng(`tint:${building.id}`);
  const cond: Record<string, number> = { new: 1.06, sound: 1.0, worn: 0.95, weathered: 0.88, damaged: 0.84, ruinous: 0.72, "under-construction": 1.03 };
  const qual: Record<string, number> = { noble: 1.0, fine: 1.0, common: 0.97, poor: 0.92 };
  const k = (cond[condition] ?? 1) * (qual[building.quality] ?? 1) * (1 + rng.jitter(0.05));
  const warm = rng.jitter(0.035);
  return [k * (1 + warm), k, k * (1 - warm)];
}

function repairOn(building: Building, massId: string, kind: string): boolean {
  for (const r of building.age.repairs) if (r.kind === kind && (r.mass === undefined || r.mass === massId)) return true;
  return false;
}

function roofKeyFor(ctx: KitContext, key: string): string {
  return ctx.mat(key);
}

/** Builds one standing mass in its local frame (the caller has pushed the mass transform). */
export function buildMass(ctx: KitContext, b: MeshBuilder, f: MassFrame, opts: ArchitectureOptions, condition: Building["age"]["condition"]): void {
  const m = f.mass;
  const building = f.building;
  const st = f.style;
  const role = m.role;
  const wallKey = m.wallMaterial;
  const tint = b.getColor();
  const limeWash = repairOn(building, m.id, "lime-wash") || repairOn(building, m.id, "fresh-render");
  if (limeWash) b.color(tint[0] * 1.12, tint[1] * 1.12, tint[2] * 1.1);
  b.uvMode = "world";
  if (role === "chimney") {
    chimney(ctx, b, f, wallKey, building.tags.indexOf("smoke") >= 0 || building.tags.indexOf("chimney") >= 0 || building.function === "kitchen" || building.function === "forge");
    b.color(tint[0], tint[1], tint[2]);
    return;
  }
  if (role === "scaffold") {
    scaffold(ctx, b, f);
    return;
  }
  if (role === "platform") {
    platform(ctx, b, f, wallKey);
    return;
  }
  const ruin = condition === "ruinous";
  const unfinished = condition === "under-construction";
  if (!f.elevated && role !== "canopy") {
    if (building.foundation.kind === "stilts") staddles(ctx, b, f);
    else plinth(ctx, b, f);
  }
  if (f.elevated && role === "annex") corbel(ctx, b, f, st.plinthMaterial);
  if (f.elevated && role === "gallery") galleryStruts(ctx, b, f);
  if (role === "canopy") {
    canopyPosts(ctx, b, f);
  } else if (ruin || unfinished) {
    brokenShell(ctx, b, f, wallKey, ruin ? "ruin" : "unfinished");
  } else {
    const shell = wallShell(ctx, b, f, wallKey);
    if (f.round || f.octagon) roundOpenings(ctx, b, f);
    else {
      const tallHall = st.kind === "gothic" && role === "hall" && m.eaveHeight >= 8;
      rectOpenings(ctx, b, f, shell, {
        boarded: repairOn(building, m.id, "boarded-opening") ? 2 : 0,
        tallHall,
        allowDoor: role !== "annex" && role !== "gallery",
        voids: false,
      });
      if (st.buttresses && ctx.quality.detail >= 0 && (role === "hall" || role === "keep" || (role === "wing" && m.eaveHeight > 8) || (role === "tower" && f.w >= 5))) {
        buttresses(ctx, b, f, wallKey, tallHall ? 3.4 : 3.2);
      }
    }
    if (repairOn(building, m.id, "iron-strapping")) ironBands(ctx, b, f, 3);
    if (repairOn(building, m.id, "buttress") && !f.round) rakingShore(ctx, b, f, 1);
    if (role === "keep") {
      const crownMat = repairOn(building, m.id, "rebuilt-courses") ? ctx.style.keys.repair : wallKey;
      keepCrown(ctx, b, f, crownMat, m.roof.material);
    }
    // Roof.
    if (!(opts.skipRoof && opts.skipRoof.indexOf(m.id) >= 0)) {
      const roofMat = roofKeyFor(ctx, m.roof.material);
      const patched = repairOn(building, m.id, "patched-roof") || repairOn(building, m.id, "re-thatched") || repairOn(building, m.id, "re-shingled");
      const thatch = /thatch/.test(roofMat);
      const gableMat = st.kind === "jettied" ? ctx.mat(wallKey) : ctx.mat(wallKey);
      const keepSpire = role === "keep" && m.roof.form === "spire";
      roof(b, {
        form: m.roof.form as RoofShape,
        axis: m.roof.ridgeAxis,
        w: f.w,
        d: role === "keep" ? f.d : shell.topDepth,
        eaveY: keepSpire ? m.eaveHeight + 0.1 : m.eaveHeight,
        ridgeY: m.ridgeHeight,
        plan: f.round ? "round" : f.octagon ? "octagon" : "rect",
        overhang: f.round ? 0.28 : st.overhang + (thatch ? 0.15 : 0),
        verge: st.verge + (thatch ? 0.1 : 0),
        thickness: ctx.style.roofThickness[m.roof.material] ?? 0.15,
        roofMaterial: roofMat,
        gableMaterial: gableMat,
        trimMaterial: ctx.mat(ctx.style.roofTrim[m.roof.material] ?? m.roof.material),
        soffitMaterial: ctx.mat("timber-dark"),
        parapetGables: st.parapetGables && (m.roof.form === "steep-gable" || m.roof.form === "gable") && f.w >= 6 && f.d >= 6,
        segments: ctx.quality.detail >= 2 ? 18 : 14,
        slopeTints: patched ? [[1.2, 1.18, 1.14], [1, 1, 1]] : undefined,
      });
    }
  }
  if (unfinished && m.roof.form === "open-frame") {
    roof(b, {
      form: "open-frame",
      axis: m.roof.ridgeAxis,
      w: f.w,
      d: f.d,
      eaveY: m.eaveHeight,
      ridgeY: m.eaveHeight + f.w * 0.75,
      plan: "rect",
      overhang: 0,
      verge: 0,
      thickness: 0.1,
      roofMaterial: ctx.mat("timber-raw"),
      gableMaterial: ctx.mat(wallKey),
      trimMaterial: ctx.mat("timber-raw"),
    });
  }
  b.color(tint[0], tint[1], tint[2]);
}

/** Default building kit. */
export function buildArchitecture(ctx: KitContext, building: Building, opts: ArchitectureOptions = {}): void {
  const b = ctx.b;
  const style = traditionStyle(ctx.style, building.tradition);
  const base = ctx.base(building);
  const condition = opts.condition ?? building.age.condition;
  const landmark = opts.landmark !== undefined ? opts.landmark : building.landmark ?? null;
  b.part(opts.part ?? partFor(building), landmark);
  let gate: StateGate | null = opts.gate ?? null;
  if (!gate && building.appearsAtHallTier) gate = { minHallTier: building.appearsAtHallTier };
  b.gate(gate);
  b.shadows(true, true);
  const tint = buildingTint(ctx, building, condition);
  b.color(tint[0], tint[1], tint[2]);
  const masses = opts.masses ?? building.masses;
  for (const m of masses) {
    if (opts.skipMass && opts.skipMass.indexOf(m.id) >= 0) continue;
    const f = massFrame(building, m, base, style);
    b.push();
    b.transform(f.cx, f.y0, f.cz, f.yaw);
    buildMass(ctx, b, f, opts, condition);
    b.pop();
    // Camera/picking collider over the whole mass including its roof.
    const bottom = f.elevated ? f.y0 : base.groundMin;
    const top = f.y0 + m.ridgeHeight;
    ctx.collider([f.cx, (bottom + top) / 2, f.cz], [f.w / 2 + 0.3, (top - bottom) / 2, f.d / 2 + 0.3], f.yaw, landmark, m.role !== "chimney" && m.role !== "scaffold");
  }
  b.gate(null);
  b.color(1, 1, 1);
}
