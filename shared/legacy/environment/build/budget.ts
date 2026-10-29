// Budget estimates for a build after the standard renderer merge rule (static
// meshes merged by material, shadow flags, motion and state gate; one draw per
// instanced prototype). Agent pools count only the figures that can be visible.

import type { EnvironmentBuild } from "./buildBannerhold";
import { gateVisible } from "./state";
import type { EnvironmentQuality } from "../quality";

export interface BudgetEstimate {
  drawCalls: number;
  triangles: number;
  shadowCasterDraws: number;
}

/** docs/legacy/PERFORMANCE.md budgets (draw calls, triangles in view). */
export const PLATFORM_BUDGETS: Readonly<Record<EnvironmentQuality, { drawCalls: number; triangles: number }>> = {
  "desktop-low": { drawCalls: 120, triangles: 300000 },
  "desktop-medium": { drawCalls: 200, triangles: 800000 },
  "desktop-high": { drawCalls: 400, triangles: 1500000 },
  quest: { drawCalls: 120, triangles: 250000 },
};

export function estimateBudget(build: EnvironmentBuild): BudgetEstimate {
  const groups = new Map<string, boolean>();
  let tris = 0;
  for (const m of build.meshes) {
    if (!gateVisible(m.gate, build.initialSlots)) continue;
    const g = m.gate ? `${m.gate.minHallTier ?? "_"}:${m.gate.maxHallTier ?? "_"}:${m.gate.flag ?? "_"}` : "-";
    const big = m.part === "terrain" || m.part === "far-terrain";
    const key = `${m.material}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.motion ? JSON.stringify(m.motion) : "-"}|${g}|${big ? m.part : "*"}`;
    groups.set(key, groups.get(key) || m.castShadow);
    tris += m.indices.length / 3;
  }
  let draws = groups.size;
  let casters = 0;
  groups.forEach((cast) => {
    if (cast) casters++;
  });
  const visibleAgents = new Map<string, number>();
  for (const a of build.agents) for (const p of Object.values(a.poses)) if (p) visibleAgents.set(p.set, (visibleAgents.get(p.set) ?? 0) + a.figures);
  for (const s of build.instances) {
    if (!gateVisible(s.gate, build.initialSlots)) continue;
    const count = s.motion?.kind === "agents" ? Math.min(s.count, Math.ceil((visibleAgents.get(s.name) ?? 0) * 0.6)) : s.count;
    for (const p of s.prototypes) {
      draws++;
      if (s.castShadow) casters++;
      tris += (p.indices.length / 3) * count;
    }
  }
  return { drawCalls: draws, triangles: tris, shadowCasterDraws: casters };
}
