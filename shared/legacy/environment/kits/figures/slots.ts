// State slots and life: instance sets for the places LegacySceneState fills (the
// nominated representative's stand, the injured representative's rest, levy
// positions, honour niches, War Record markers, notices) and figure bindings for the
// blueprint's NPC schedules. Slots are places, never results: the scene state
// decides how many instances show (build/state.ts).

import type { NpcAgent, Pose } from "../../blueprint";
import { box, chamferBox, lathe, prism, circleOutline, MeshBuilder } from "../../kernel";
import type { MeshBuffer } from "../../kernel";
import type { KitContext } from "../context";
import { wallTop } from "../settlement/fortifications";
import { buildFigure } from "./figure";
import type { FigurePose } from "./figure";

export type AgentPoseKey = "stand" | "walkA" | "walkB" | "work" | "carry" | "salute" | "guard" | "herald";

export interface AgentBinding {
  id: string;
  /** Index into blueprint.npcs. */
  npcIndex: number;
  /** The schedule itself (plain blueprint data), so renderers need not load the blueprint. */
  npc: NpcAgent;
  /** Walkway or deck elevation per route point for wall-walk/elevated agents; null follows the terrain. */
  routeY: number[] | null;
  figures: number;
  scale: number;
  /** Instance set name and first instance index per pose. */
  poses: Partial<Record<AgentPoseKey, { set: string; offset: number }>>;
}

export interface SlotLayout {
  pawn: string;
  injured: string;
  levy: string;
  honours: string;
  recordMarkers: string;
  notices: string;
}

export const SLOT_SETS: SlotLayout = {
  pawn: "slot:pawn",
  injured: "slot:injured",
  levy: "slot:levy",
  honours: "slot:honours",
  recordMarkers: "slot:record-markers",
  notices: "slot:notices",
};

function figureSpec(ctx: KitContext, key: string, palette: string, pose: FigurePose, agents: boolean): void {
  ctx.instances.define({
    key,
    part: "figures",
    castShadow: ctx.quality.detail >= 1,
    receiveShadow: true,
    lod: 0,
    motion: agents ? { kind: "agents" } : null,
    gate: null,
    build: () => buildFigure(palette, pose, ctx.quality.id === "quest" ? 1 : 0),
  });
}

function placeAtPose(ctx: KitContext, key: string, p: Pose, scale = 1): void {
  ctx.instances.add(key, p.position[0], p.position[1], p.position[2], (p.yawDeg * Math.PI) / 180, scale);
}

function honourPrototype(): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("slots").shadows(false, true);
  b.material("figure");
  b.color(0.55, 0.53, 0.5);
  chamferBox(b, 0, -0.32, -0.06, 0.38, 0.5, 0.08, 0.03);
  b.color(0.75, 0.56, 0.18);
  chamferBox(b, 0, -0.22, 0, 0.26, 0.3, 0.03, 0.02);
  b.color(0.92, 0.88, 0.8);
  prism(b, circleOutline(0.035, 6), 0, 0.14, { smooth: true, top: true });
  b.material("candle");
  b.motion({ kind: "flicker", rate: 9, depth: 0.3 });
  b.push();
  b.translate(0, 0.14, 0);
  lathe(b, [[0.018, 0], [0.012, 0.03], [0.001, 0.07]], 5, { smooth: false });
  b.pop();
  return b.finish();
}

function markerPrototype(): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("slots").shadows(false, true);
  b.material("figure");
  b.color(0.85, 0.82, 0.78);
  lathe(b, [[0.07, 0], [0.06, 0.03], [0.03, 0.06], [0.045, 0.12], [0.012, 0.16]], 7, { smooth: true });
  return b.finish();
}

function noticePrototype(): MeshBuffer[] {
  const b = new MeshBuilder();
  b.part("slots").shadows(false, true);
  b.material("figure");
  b.color(0.86, 0.82, 0.72);
  box(b, 0, -0.22, 0.03, 0.42, 0.52, 0.01);
  b.color(0.45, 0.08, 0.08);
  prism(b, circleOutline(0.04, 8), -0.2, -0.19, { top: true });
  return b.finish();
}

export function buildSlots(ctx: KitContext): void {
  const { bp, instances } = ctx;
  const s = bp.slots;
  figureSpec(ctx, SLOT_SETS.pawn, "levy", "stand", false);
  placeAtPose(ctx, SLOT_SETS.pawn, bp.muster.pawnStand);
  figureSpec(ctx, SLOT_SETS.injured, "levy", "rest", false);
  placeAtPose(ctx, SLOT_SETS.injured, s.injuredRest);
  figureSpec(ctx, SLOT_SETS.levy, "levy", "stand", false);
  for (const p of bp.muster.levySlots) placeAtPose(ctx, SLOT_SETS.levy, p);
  instances.define({ key: SLOT_SETS.honours, part: "slots", castShadow: false, receiveShadow: true, lod: 0, motion: null, gate: null, build: honourPrototype });
  for (const p of s.honourNiches) placeAtPose(ctx, SLOT_SETS.honours, p);
  instances.define({ key: SLOT_SETS.recordMarkers, part: "slots", castShadow: false, receiveShadow: true, lod: 0, motion: null, gate: null, build: markerPrototype });
  for (const p of s.recordMarkers) instances.add(SLOT_SETS.recordMarkers, p.position[0], p.position[1], p.position[2], 0, 1, [1, 1, 1]);
  instances.define({ key: SLOT_SETS.notices, part: "slots", castShadow: false, receiveShadow: true, lod: 0, motion: null, gate: null, build: noticePrototype });
  for (const p of s.noticeBoard) placeAtPose(ctx, SLOT_SETS.notices, p);
  buildStaticMarkers(ctx);
}

/** Flag-gated static props: the sealed writ at the empty stand and the rival's sealed challenge. */
function buildStaticMarkers(ctx: KitContext): void {
  const { bp, b } = ctx;
  const s = bp.slots;
  b.part("slots", "muster-grounds").shadows(true, true).gate({ flag: "representative-captive" });
  b.uvMode = "world";
  {
    const [x, y, z] = s.captiveMarker.position;
    b.push();
    b.transform(x, y, z, (s.captiveMarker.yawDeg * Math.PI) / 180);
    b.material(ctx.mat("timber-dark"));
    box(b, 0, 0, 0, 0.1, 1.25, 0.1);
    b.material(ctx.mat("plaster-lime"));
    b.color(1.3, 1.25, 1.1);
    box(b, 0, 0.75, 0.07, 0.36, 0.44, 0.02);
    b.color(1, 1, 1);
    b.material(ctx.mat("figure"));
    b.color(0.42, 0.06, 0.06);
    prism(b, circleOutline(0.05, 8), 0.7, 0.72, { top: true });
    b.color(1, 1, 1);
    b.pop();
  }
  b.part("slots", "heralds-station").gate({ flag: "rival-challenge" });
  {
    const [x, y, z] = s.rivalCorrespondence.position;
    b.push();
    b.transform(x, y, z, (s.rivalCorrespondence.yawDeg * Math.PI) / 180);
    b.material(ctx.mat("figure"));
    b.color(0.3, 0.08, 0.07);
    b.push();
    b.transform(0, 0, 0.06, 0, 0, Math.PI / 2);
    lathe(b, [[0.045, -0.2], [0.045, 0.2]], 8, { smooth: true, capTop: true, capBottom: true });
    b.pop();
    b.color(1, 1, 1);
    b.pop();
  }
  b.gate(null);
}

/** Figure bindings for the blueprint NPC schedules (capped by quality). */
export function buildAgents(ctx: KitContext): AgentBinding[] {
  const { bp, quality } = ctx;
  if (quality.agents <= 0) return [];
  const priority: Record<NpcAgent["role"], number> = { sentry: 0, smith: 0, messenger: 1, drill: 0, resident: 1, herald: 1, guard: 1, carter: 2, worker: 2, scribe: 2, child: 2, farmer: 3, "beast-handler": 3, priest: 3 };
  const order = bp.npcs.map((n, i) => ({ n, i })).sort((a, b) => priority[a.n.role] - priority[b.n.role] || a.i - b.i);
  const bindings: AgentBinding[] = [];
  const counts = new Map<string, number>();
  let total = 0;
  const use = (palette: string, pose: FigurePose, n: number): { set: string; offset: number } => {
    const key = `agents:${palette}:${pose}`;
    figureSpec(ctx, key, palette, pose, true);
    const offset = counts.get(key) ?? 0;
    counts.set(key, offset + n);
    return { set: key, offset };
  };
  for (const { n, i } of order) {
    if (total + n.count > quality.agents) continue;
    const palette = n.role === "sentry" || n.role === "guard" ? "guard" : n.role === "drill" ? "levy" : n.role === "smith" ? "smith" : n.role === "herald" || n.role === "messenger" || n.role === "scribe" || n.role === "priest" ? "herald" : "civilian";
    const poses: AgentBinding["poses"] = {
      stand: use(palette, palette === "guard" ? "guard" : palette === "herald" ? "herald" : "stand", n.count),
      walkA: use(palette, "walk-a", n.count),
      walkB: use(palette, "walk-b", n.count),
    };
    const acts = n.steps.filter((st) => st.kind === "hold").map((st) => (st.kind === "hold" ? st.activity : "rest"));
    if (acts.some((a) => a === "forge-strike" || a === "repair" || a === "chop-wood" || a === "bellows" || a === "sweep")) poses.work = use(palette, "work", n.count);
    if (acts.some((a) => a === "carry" || a === "load" || a === "draw-water" || a === "hang-laundry")) poses.carry = use(palette, "carry", n.count);
    if (acts.some((a) => a === "salute" || a === "drill")) poses.salute = use(palette, "salute", n.count);
    let routeY: number[] | null = null;
    if (n.heightMode === "elevated" && n.routeDeckY) routeY = n.routeDeckY.slice();
    else if (n.heightMode === "wall-walk") {
      const wall = bp.walls.find((w) => w.id === n.wallId);
      if (wall) {
        routeY = n.route.map((p) => {
          // Tangent of the nearest wall segment.
          let best = Infinity, tx = 1, tz = 0;
          for (let k = 0; k < wall.points.length - 1; k++) {
            const a = wall.points[k], c = wall.points[k + 1];
            const dx = c[0] - a[0], dz = c[1] - a[1];
            const len = Math.hypot(dx, dz) || 1;
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (len * len)));
            const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
            if (d < best) { best = d; tx = dx / len; tz = dz / len; }
          }
          return wallTop(ctx, wall, p[0], p[1], tx, tz).top;
        });
      }
    }
    bindings.push({ id: n.id, npcIndex: i, npc: n, routeY, figures: n.count, scale: n.role === "child" ? 0.62 : 1, poses });
    total += n.count;
  }
  // Every pose slot starts hidden far below the ground; the renderer places them each frame.
  counts.forEach((count, key) => {
    for (let k = 0; k < count; k++) ctx.instances.add(key, 0, -1000, 0, 0, 0.0001);
  });
  return bindings;
}
