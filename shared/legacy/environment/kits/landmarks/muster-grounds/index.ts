// Muster Grounds kit (district B): the dais through the architecture kit, the eight
// file posts of the formation, the nominated representative's marked stone and the
// drill square's edging stones.

import type { Building } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, prism, rectOutline } from "../../../kernel";
import { buildArchitecture } from "../../architecture";
import type { KitContext } from "../../context";

export function buildMusterGroundsKit(ctx: KitContext, building: Building): void {
  buildArchitecture(ctx, building, { landmark: "muster-grounds" });
  const { bp, b } = ctx;
  const m = bp.muster;
  b.part("landmark:muster-grounds", "muster-grounds").shadows(true, true).gate(null);
  b.uvMode = "world";
  // File posts a–h: squat basalt posts with gilt caps (they belong to the formation, not the house).
  for (const fm of m.fileMarkers) {
    const [x, y, z] = fm.pose.position;
    b.push();
    b.transform(x, y, z, (fm.pose.yawDeg * Math.PI) / 180);
    b.material(ctx.mat("kv-basalt-ashlar"));
    chamferBox(b, 0, -0.3, 0, 0.32, 1.25, 0.32, 0.05);
    b.material(ctx.mat("bronze"));
    bevelPrism(b, rectOutline(0.4, 0.4), 0.95, 1.05, 0.03);
    b.pop();
  }
  // The representative's marked stone.
  {
    const [x, y, z] = m.pawnStand.position;
    b.push();
    b.translate(x, y, z);
    b.material(ctx.mat("kv-limestone"));
    bevelPrism(b, circleOutline(0.75, 14), -0.3, 0.12, 0.04);
    b.material(ctx.mat("gilt"));
    prism(b, circleOutline(0.5, 14), 0.12, 0.14, { smooth: true, top: true });
    b.pop();
  }
  // Drill square edging.
  const d = m.drillSquare;
  const hw = d.width / 2, hd = d.depth / 2;
  b.material(ctx.mat("stone-generic"));
  for (let i = 0; i <= 8; i++) {
    for (const zz of [-hd, hd]) {
      const x = d.center[0] - hw + (i / 8) * d.width, z = d.center[1] + zz;
      b.push();
      b.translate(x, ctx.ground(x, z), z);
      chamferBox(b, 0, -0.2, 0, 0.3, 0.32, 0.3, 0.05);
      b.pop();
    }
  }
  void box;
}
