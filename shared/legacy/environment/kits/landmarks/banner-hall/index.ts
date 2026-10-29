// Banner Hall kit (district A): the hall, its keep and flèche through the
// architecture kit, plus dormers on the great roof, the Honour Court's raised court,
// candle niches and eclipse dial, and the unfinished West Range with the form it
// takes once recognition completes it. Replace freely; the registry maps kit ids here.

import type { Building, BuildingMass } from "../../../blueprint";
import { archOutline, bevelPrism, box, chamferBox, lathe, opening, prism, rectOutline, roof, circleOutline } from "../../../kernel";
import { buildArchitecture, massFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { traditionStyle } from "../../nations/style";

function dormers(ctx: KitContext, building: Building, mass: BuildingMass, landmark: "banner-hall"): void {
  if (ctx.quality.detail < 1 || mass.roof.ridgeAxis !== "z") return;
  const b = ctx.b;
  const base = ctx.base(building);
  const f = massFrame(building, mass, base, traditionStyle(ctx.style, building.tradition));
  const a = f.w / 2;
  const e = mass.eaveHeight, r = mass.ridgeHeight;
  const k = (r - e) / a;
  b.part(`landmark:${landmark}`, landmark).shadows(true, true);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  const count = Math.max(2, Math.floor(f.d / 8));
  for (const side of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const z = -f.d / 2 + ((i + 0.5) * f.d) / count;
      const xf = side * (a - 0.9);
      const yRoof = e + k * 0.9;
      b.push();
      b.transform(xf, yRoof - 0.3, z, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      b.material(ctx.mat(mass.wallMaterial));
      b.uvMode = "world";
      box(b, 0, 0, -1.3, 1.7, 2.3, 2.6);
      b.push();
      b.translate(0, 0.35, 0);
      opening(b, { outline: archOutline(0.8, 0.9, 0.9, 4), glassMaterial: ctx.mat(i % 2 === 0 ? "glass-lit" : "glass-dark"), frameMaterial: ctx.mat("kv-limestone"), frame: 0.12, proud: 0.12, glassTint: [0.85, 0.85, 0.85] });
      b.pop();
      roof(b, { form: "steep-gable", axis: "z", w: 1.7, d: 2.6, eaveY: 2.3, ridgeY: 3.7, plan: "rect", overhang: 0.12, verge: 0.15, thickness: 0.1, roofMaterial: ctx.mat(mass.roof.material), gableMaterial: ctx.mat(mass.wallMaterial), trimMaterial: ctx.mat("kv-lead") });
      b.pop();
    }
  }
  b.pop();
}

function honourCourt(ctx: KitContext): void {
  const { bp, b } = ctx;
  const c = bp.ceremonial;
  const shape = c.shape;
  const g = ctx.ground(shape.center[0], shape.center[1]);
  b.part("landmark:banner-hall", "banner-hall").shadows(true, true).gate(null);
  b.uvMode = "world";
  b.push();
  b.transform(shape.center[0], g, shape.center[1], ((shape.rotationDeg ?? 0) * Math.PI) / 180);
  b.material(ctx.mat("road-flagstone"));
  bevelPrism(b, rectOutline(shape.width, shape.depth), -0.3, 0.45, 0.05);
  // Low walls with niches on the east and north sides.
  b.material(ctx.mat("kv-basalt-ashlar"));
  box(b, shape.width / 2 - 0.2, 0.45, 0, 0.45, 1.25, shape.depth);
  box(b, 0, 0.45, -shape.depth / 2 + 0.2, shape.width, 1.25, 0.45);
  b.material(ctx.mat("kv-limestone"));
  bevelPrism(b, rectOutline(0.6, shape.depth + 0.1, shape.width / 2 - 0.2, 0), 1.7, 1.86, 0.05);
  bevelPrism(b, rectOutline(shape.width + 0.1, 0.6, 0, -shape.depth / 2 + 0.2), 1.7, 1.86, 0.05);
  // The eclipse dial: a basalt disc on a column with a gilt ring.
  b.material(ctx.mat("black-marble"));
  b.push();
  b.translate(c.centrepiece[0] - shape.center[0], 0.45, c.centrepiece[1] - shape.center[1]);
  prism(b, circleOutline(0.32, 10), 0, 1.0, { smooth: true, top: true });
  b.transform(0, 1.55, 0, 0.4, Math.PI / 2 - 0.35, 0);
  lathe(b, [[0.62, -0.06], [0.62, 0.06]], 20, { smooth: true, capTop: true, capBottom: true });
  b.material(ctx.mat("gilt"));
  lathe(b, [[0.66, -0.035], [0.7, 0], [0.66, 0.035]], 24, { smooth: true });
  b.pop();
  b.pop();
}

export function buildBannerHallKit(ctx: KitContext, building: Building): void {
  buildArchitecture(ctx, building, { landmark: "banner-hall" });
  for (const m of building.masses) if (m.role === "hall") dormers(ctx, building, m, "banner-hall");
  honourCourt(ctx);
}

/** The unfinished West Range: walls to the blueprint height now; its completed form appears at the tier that completes it. */
export function buildWestRangeKit(ctx: KitContext, building: Building): void {
  const u = building.unfinished;
  if (!u) {
    buildArchitecture(ctx, building, { landmark: "banner-hall" });
    return;
  }
  const done = u.completesAtHallTier;
  buildArchitecture(ctx, building, { landmark: "banner-hall", gate: { maxHallTier: (done - 1) as 0 | 1 | 2 } });
  const walls = building.masses.find((m) => m.role !== "scaffold");
  if (!walls) return;
  const completed: BuildingMass = { ...walls, storeys: 2, eaveHeight: 8.4, ridgeHeight: 15, roof: { form: "steep-gable", ridgeAxis: walls.roof.ridgeAxis, material: "kv-slate" } };
  buildArchitecture(ctx, building, { landmark: "banner-hall", masses: [completed], condition: "new", gate: { minHallTier: done } });
  void chamferBox;
}
