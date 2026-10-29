// War Record kit (district F): the archive through the architecture kit, a great
// tracery window over its door, and the war table that carries the record markers.

import type { Building } from "../../../blueprint";
import { archOutline, box, chamferBox, opening } from "../../../kernel";
import { buildArchitecture, massFrame, rectFaces } from "../../architecture";
import type { KitContext } from "../../context";
import { traditionStyle } from "../../nations/style";

export function buildWarRecordKit(ctx: KitContext, building: Building): void {
  buildArchitecture(ctx, building, { landmark: "war-record" });
  const b = ctx.b;
  const house = building.masses.find((m) => m.role === "hall");
  if (house) {
    const f = massFrame(building, house, ctx.base(building), traditionStyle(ctx.style, building.tradition));
    const faces = rectFaces(f.w, f.d);
    const front = faces[0];
    b.part("landmark:war-record", "war-record").shadows(true, true).gate(null);
    b.push();
    b.transform(f.cx, f.y0, f.cz, f.yaw);
    b.push();
    b.transform(front.cx, house.eaveHeight * 0.48, front.cz, front.yaw);
    b.uvMode = "world";
    opening(b, { outline: archOutline(2.6, Math.max(1.5, house.eaveHeight * 0.52 - 2.2), 0.86, 8), glassMaterial: ctx.mat("glass-lit"), frameMaterial: ctx.mat("kv-limestone"), frame: 0.34, proud: 0.32, sill: true, mullion: true, glassTint: [0.9, 0.85, 0.8] });
    b.pop();
    b.pop();
  }
  // War table (inside; markers are slots).
  const site = ctx.bp.activitySites.find((s) => s.kind === "war-table");
  if (site) {
    b.part("landmark:war-record", "war-record").material(ctx.mat("timber-dark"));
    b.push();
    b.translate(site.position[0] + 0.5, site.position[1] - 0.95, site.position[2] - 0.6);
    chamferBox(b, 0, 0.82, 0, 2.6, 0.1, 2.0, 0.03);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, sx * 1.15, 0, sz * 0.85, 0.12, 0.82, 0.12);
    b.pop();
  }
}
