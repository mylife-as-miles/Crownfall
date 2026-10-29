// Public entry of the shared Bannerhold environment pipeline: pure TypeScript that
// turns the blueprint and a LegacySceneState into typed-array geometry, textures and
// staging for both renderers. See docs/legacy/environment/TECHNICAL_SPEC.md.

export * from "./kernel";
export * from "./materials";
export * from "./quality";
export * from "./heraldry";
export * from "./textures";
export * from "./fixtures";
export { buildBannerhold } from "./build/buildBannerhold";
export type { BuildInput, BuildStats, EnvironmentBuild, LandmarkBuild } from "./build/buildBannerhold";
export { atlasHeraldryFor, gateVisible, heraldryKey, markerTint, resolveSceneSlots, slotCapacities } from "./build/state";
export type { SceneSlotCounts, SlotCapacities } from "./build/state";
export { estimateBudget, PLATFORM_BUDGETS } from "./build/budget";
export type { BudgetEstimate } from "./build/budget";
export { KitRegistry } from "./kits/registry";
export type { BuildingKit, KitPackage, SiteKit } from "./kits/registry";
export { createDefaultRegistry, DEFAULT_PACKAGES } from "./kits/packages";
export type { KitContext, FireSource, SmokeSource, PrototypeSpec } from "./kits/context";
export type { AgentBinding, AgentPoseKey, SlotLayout } from "./kits/figures/slots";
export { SLOT_SETS } from "./kits/figures/slots";
export { wallTop } from "./kits/settlement/fortifications";
export { silhouettePlacement, SILHOUETTE_RING } from "./kits/outer/distant";
export { nationStyle, traditionStyle } from "./kits/nations/style";
export type { NationStyle, TraditionStyle } from "./kits/nations/style";
