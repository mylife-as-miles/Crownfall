// Public entry point of the Bannerhold spatial blueprint (single source of truth for
// layout on desktop and Quest). See docs/legacy/environment/TECHNICAL_SPEC.md.

import type { LandmarkDescriptor } from "../../environment-contract";
import type { NationId } from "../../types";
import { AETHELGARD_BLUEPRINT } from "./nations/aethelgard";
import { KORVENIA_BLUEPRINT } from "./nations/korvenia";
import { KWIND09_BLUEPRINT } from "./nations/kwind-09";
import { SOLFORIZ_BLUEPRINT } from "./nations/solforiz";
import type { BannerholdBlueprint } from "./types";

export * from "./types";
export * from "./math2d";
export { BLUEPRINT_COORDINATES, NATION_KIT_PREFIX } from "./coordinates";
export { buildHeightfield, createTerrainSampler, valueNoise } from "./terrain";
export type { TerrainSampler } from "./terrain";
export { buildingTopY, massPolygon, pointInMass, pointInTower, resolveBuildingBase } from "./buildings";
export type { ResolvedBase } from "./buildings";
export { compileSchedule, createAgentPose, sampleAgent } from "./schedule";
export type { AgentPose, CompiledSchedule } from "./schedule";
export { formatBlueprintErrors, REQUIRED_NPC_ROLES, REQUIRED_STORY_KINDS, validateBlueprint } from "./validate";
export type { BlueprintIssue } from "./validate";

/**
 * Reversible production default: the benchmark nation the first production-quality
 * environment is built for. Not a canonical or launch choice (BIBLE.md §1).
 */
export const PRODUCTION_DEFAULT_NATION: NationId = "korvenia";

export const BANNERHOLD_BLUEPRINTS: Partial<Record<NationId, BannerholdBlueprint>> = {
  korvenia: KORVENIA_BLUEPRINT,
  solforiz: SOLFORIZ_BLUEPRINT,
  aethelgard: AETHELGARD_BLUEPRINT,
  "kwind-09": KWIND09_BLUEPRINT,
};

export function getBannerholdBlueprint(nation: NationId): BannerholdBlueprint {
  return BANNERHOLD_BLUEPRINTS[nation] ?? KORVENIA_BLUEPRINT;
}

/** Landmark descriptors in blueprint metres, as published through LegacyEnvironmentBase.getLandmarks(). */
export function landmarkDescriptors(bp: BannerholdBlueprint): LandmarkDescriptor[] {
  return bp.landmarks.map((l) => ({ id: l.id, label: l.label, position: l.anchor }));
}
