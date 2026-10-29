// Herald's Station kit (district E): the herald tower and post room through the
// architecture kit, with a timber raven loft gallery under the tower roof and a
// signal lantern over the post-room door.

import type { Building } from "../../../blueprint";
import { box, prism, rectOutline } from "../../../kernel";
import { buildArchitecture, massFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { traditionStyle } from "../../nations/style";

export function buildHeraldsStationKit(ctx: KitContext, building: Building): void {
  buildArchitecture(ctx, building, { landmark: "heralds-station" });
  const b = ctx.b;
  const tower = building.masses.find((m) => m.role === "tower");
  if (tower && building.tags.indexOf("raven-loft") >= 0) {
    const f = massFrame(building, tower, ctx.base(building), traditionStyle(ctx.style, building.tradition));
    b.part("landmark:heralds-station", "heralds-station").shadows(true, true).gate(null);
    b.push();
    b.transform(f.cx, f.y0, f.cz, f.yaw);
    b.material(ctx.mat("timber-raw"));
    b.color(1.18, 1.12, 1.02);
    b.uvMode = "world";
    const e = tower.eaveHeight;
    // Gallery floor, posts and rails of the loft just under the eaves.
    prism(b, rectOutline(f.w + 1.0, f.d + 1.0), e - 1.9, e - 1.75, { top: true, bottom: true });
    const hw = f.w / 2 + 0.45, hd = f.d / 2 + 0.45;
    for (let i = 0; i <= 4; i++) {
      const t = -1 + i * 0.5;
      for (const [x, z] of [[t * hw, hd], [t * hw, -hd], [hw, t * hd], [-hw, t * hd]] as const) box(b, x, e - 1.75, z, 0.12, 1.75, 0.12);
    }
    box(b, 0, e - 0.95, hd, f.w + 0.9, 0.08, 0.08);
    box(b, 0, e - 0.95, -hd, f.w + 0.9, 0.08, 0.08);
    box(b, hw, e - 0.95, 0, 0.08, 0.08, f.d + 0.9);
    box(b, -hw, e - 0.95, 0, 0.08, 0.08, f.d + 0.9);
    b.color(1, 1, 1);
    b.pop();
  }
}
