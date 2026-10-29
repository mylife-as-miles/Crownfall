// Heraldic props: standards, gonfalons, wall shields, pennants, emblems, tapestries
// and veiled standards from the blueprint's banner mounts. Every cloth samples the
// shared heraldry atlas (one draw call), animates with wind through cloth motion
// weights, and is gated by the mount's minimum hall tier.

import type { BannerMount, Pose } from "../../blueprint";
import { atlasUv } from "../../heraldry/atlas";
import type { HeraldryAspectKind, HeraldrySlot } from "../../heraldry/atlas";
import { box, chamferBox, lathe, prism, circleOutline } from "../../kernel";
import type { MeshBuilder, StateGate } from "../../kernel";
import type { KitContext } from "../context";

/** Grid of cloth hanging from its top edge (local X across, -Y down), facing +Z. */
export function clothPanel(b: MeshBuilder, width: number, height: number, slot: HeraldrySlot, aspect: HeraldryAspectKind, cols = 4, rows = 6, sag = 0.06): void {
  const uv = atlasUv(slot, aspect);
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = (u - 0.5) * width;
      const y = -v * height;
      const z = Math.sin(u * Math.PI) * sag * v;
      b.motionWeight(Math.min(1, v * 1.1) * (0.6 + 0.4 * Math.abs(u - 0.5) * 2));
      idx.push(b.vertex(x, y, z, 0, 0, 1, uv[0] + (uv[2] - uv[0]) * u, uv[3] - (uv[3] - uv[1]) * v));
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = idx[r * (cols + 1) + c], d = idx[r * (cols + 1) + c + 1];
      const e = idx[(r + 1) * (cols + 1) + c], f = idx[(r + 1) * (cols + 1) + c + 1];
      b.quad(e, f, d, a);
    }
  }
  b.motionWeight(0);
  b.uvMode = prevMode;
}

/** Pennant flying from a pole along local +X (wind), tapering to the fly. */
export function pennantPanel(b: MeshBuilder, length: number, height: number, slot: HeraldrySlot): void {
  const uv = atlasUv(slot, "pennant");
  const prevMode = b.uvMode;
  b.uvMode = "explicit";
  const cols = 6;
  const top: number[] = [], bot: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const half = (height / 2) * (1 - u * 0.86);
    b.motionWeight(u);
    top.push(b.vertex(u * length, half, 0, 0, 0, 1, uv[0] + (uv[2] - uv[0]) * u, uv[1] + (uv[3] - uv[1]) * (0.5 + 0.5 * (1 - u * 0.86))));
    bot.push(b.vertex(u * length, -half, 0, 0, 0, 1, uv[0] + (uv[2] - uv[0]) * u, uv[1] + (uv[3] - uv[1]) * (0.5 - 0.5 * (1 - u * 0.86))));
  }
  for (let c = 0; c < cols; c++) b.quad(bot[c], bot[c + 1], top[c + 1], top[c]);
  b.motionWeight(0);
  b.uvMode = prevMode;
}

function slotFor(m: BannerMount): HeraldrySlot {
  return m.heraldry === "veiled" ? "veiled" : m.heraldry;
}

export function buildBannerMount(ctx: KitContext, m: BannerMount, part = "heraldry", gateExtra: StateGate | null = null): void {
  const b = ctx.b;
  const gate: StateGate | null = m.minHallTier > 0 || gateExtra ? { ...(gateExtra ?? {}), ...(m.minHallTier > 0 ? { minHallTier: m.minHallTier } : {}) } : null;
  b.part(part, null).gate(gate).shadows(true, true);
  const pose: Pose = m.pose;
  const yaw = (pose.yawDeg * Math.PI) / 180;
  const [x, y, z] = pose.position;
  const slot = slotFor(m);
  // Local +X maps to the wind direction (sin B, 0, -cos B) for yaw = pi/2 - B.
  const windYaw = Math.PI / 2 - (ctx.bp.atmosphere.wind.towardBearingDeg * Math.PI) / 180;
  b.push();
  b.transform(x, y, z, yaw);
  b.uvMode = "world";
  switch (m.kind) {
    case "standard":
    case "veiled-standard": {
      const h = m.height;
      const w = Math.max(0.8, Math.min(2.6, h * 0.2));
      const clothH = w * 1.5;
      b.material(ctx.mat("timber-dark"));
      prism(b, circleOutline(Math.max(0.06, h * 0.008), 6), -0.6, h + 0.5, { smooth: true, top: true });
      b.material(ctx.mat("gilt"));
      b.push();
      b.translate(0, h + 0.5, 0);
      lathe(b, [[0.09, 0], [0.12, 0.14], [0.02, 0.5]], 6, { smooth: false });
      b.pop();
      b.material(ctx.mat("timber-dark"));
      box(b, 0, h - 0.04, 0.08, w + 0.2, 0.07, 0.07);
      b.material(ctx.mat("cloth-heraldry"));
      b.motion({ kind: "cloth", amplitude: 0.16, frequency: 1.3 });
      b.push();
      b.translate(0, h - 0.05, 0.1);
      clothPanel(b, w, clothH, slot, "banner");
      b.pop();
      b.motion(null);
      break;
    }
    case "pennant":
    case "signal-flag": {
      const h = m.height;
      b.material(ctx.mat("timber-dark"));
      prism(b, circleOutline(0.05, 6), -0.3, h + 0.2, { smooth: true, top: true });
      b.material(ctx.mat("cloth-heraldry"));
      b.motion({ kind: "cloth", amplitude: 0.22, frequency: 1.6 });
      b.push();
      b.transform(0, h, 0, windYaw - yaw);
      pennantPanel(b, Math.max(1.2, h * 0.7), Math.max(0.4, h * 0.22), slot);
      b.pop();
      b.motion(null);
      break;
    }
    case "shield":
    case "emblem": {
      const h = m.height;
      const w = h / 1.2;
      b.material(ctx.mat(m.kind === "emblem" ? ctx.style.keys.repair : "timber-dark"));
      chamferBox(b, 0, -h * 0.55, -0.02, w * 1.18, h * 1.1, 0.12, 0.06);
      b.material(ctx.mat("cloth-heraldry"));
      b.uvMode = "explicit";
      const uv = atlasUv(slot, "shield");
      const zf = 0.05;
      const a = b.vertex(-w / 2, h * 0.5, zf, 0, 0, 1, uv[0], uv[3]);
      const c = b.vertex(w / 2, h * 0.5, zf, 0, 0, 1, uv[2], uv[3]);
      const d = b.vertex(w / 2, -h * 0.5, zf, 0, 0, 1, uv[2], uv[1]);
      const e = b.vertex(-w / 2, -h * 0.5, zf, 0, 0, 1, uv[0], uv[1]);
      b.quad(e, d, c, a);
      b.uvMode = "world";
      break;
    }
    case "tapestry": {
      const h = m.height;
      const w = h / 1.5;
      b.material(ctx.mat("cloth-heraldry"));
      b.motion({ kind: "cloth", amplitude: 0.03, frequency: 0.6 });
      b.push();
      b.translate(0, h, 0.05);
      clothPanel(b, w, h, slot, "banner", 3, 4, 0.02);
      b.pop();
      b.motion(null);
      break;
    }
  }
  b.pop();
  b.gate(null);
}

export function buildBannerMounts(ctx: KitContext): void {
  for (const m of ctx.bp.slots.bannerMounts) buildBannerMount(ctx, m);
}
