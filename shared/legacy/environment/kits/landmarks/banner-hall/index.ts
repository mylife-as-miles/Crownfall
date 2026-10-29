// Banner Hall kit (district A): the hall, porch, keep, stair turret and flèche as
// authored Korvenia Gothic (hall.ts), the Honour Court, the court standard's socle and
// hall-tier development (court.ts), and the unfinished West Range with the form it takes
// once recognition completes it (ranges.ts). The registry maps kit ids here.

import type { Building } from "../../../blueprint";
import type { KitContext } from "../../context";
import { buildArchitecture } from "../../architecture";
import { landmarkLod, landmarkMaterials } from "../gothic";
import { buildFleche, buildHallMass, buildKeep, buildPorch, buildRoundTurret } from "./hall";
import { buildHonourCourt, buildStandardSocle, gatedBrazier } from "./court";

export { buildWestRangeKit, buildLodgingKit, buildCourtGateKit } from "./ranges";

export function buildBannerHallKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:banner-hall", "banner-hall").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const base = ctx.base(building);
  const emblem = ctx.bp.slots.bannerMounts.find((mt) => mt.kind === "emblem");
  const emblemY = emblem ? emblem.pose.position[1] - base.floorY : 7.4;
  const others: string[] = [];
  for (const mass of building.masses) {
    b.part("landmark:banner-hall", "banner-hall").gate(null).shadows(true, true);
    b.color(1, 1, 1);
    if (mass.role === "hall") buildHallMass(ctx, building, mass, lod, m);
    else if (mass.role === "porch") buildPorch(ctx, building, mass, lod, m, emblemY);
    else if (mass.role === "keep") buildKeep(ctx, building, mass, lod, m);
    else if (mass.role === "stair-tower") buildRoundTurret(ctx, building, mass, lod, m, "banner-hall");
    else if (mass.role === "tower" && (mass.baseOffset ?? 0) > 2) buildFleche(ctx, building, mass, lod, m);
    else others.push(mass.id);
  }
  if (others.length) buildArchitecture(ctx, building, { landmark: "banner-hall", masses: building.masses.filter((mm) => others.indexOf(mm.id) >= 0) });
  b.part("landmark:banner-hall", "banner-hall").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  buildHonourCourt(ctx, lod, m);
  const standard = ctx.bp.slots.bannerMounts.find((mt) => mt.kind === "standard" && mt.minHallTier === 0 && mt.height >= 10);
  if (standard) buildStandardSocle(ctx, m, standard.pose.position[0], standard.pose.position[2]);
  // Tier 1 ("court braziers lit"): the approach from the Court Gate is lit.
  const gate = ctx.bp.buildings.find((x) => x.kit === "kv.fort.court-gate");
  if (gate) {
    const gm = gate.masses[0];
    const gx = gm.center[0], gz = gm.center[1] - gm.depth / 2 - 1.6;
    const gy = ctx.ground(gx, gz);
    // Priority 1: the desktop light rig takes its top lights by priority without reading gates,
    // so a gated light ranked above the always-on ones would shine at tier 0 with no fire.
    gatedBrazier(ctx, m, "kv-court-brazier-tier1-w", gx - 2.6, gy, gz, { minHallTier: 1 }, 1);
    gatedBrazier(ctx, m, "kv-court-brazier-tier1-e", gx + 2.6, gy, gz, { minHallTier: 1 }, 1);
  }
  b.gate(null);
  b.color(1, 1, 1);
}
