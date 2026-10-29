// Quest Bannerhold constants shared by the renderer, its worker and the harness.

/** Heraldry atlas edge on Quest (the shared 1024² layout, box-filtered; banners are ~1–2 cm on the table). */
export const QUEST_ATLAS_SIZE = 512;
/** Public folder of the mirrored environment assets (scripts/sync-legacy-environment-assets.mjs). */
export const QUEST_TEXTURE_BASE = 'assets/legacy/environment/textures/';
/** Instance density per Quest quality (prefix of the even subset the worker ordered). */
export const QUEST_DENSITY = { low: 0.5, medium: 0.75, high: 1 } as const;
/** Animated NPC figures per Quest quality (TECHNICAL_SPEC.md §9). */
export const QUEST_AGENTS = { low: 4, medium: 5, high: 6 } as const;
/** Landmark proxy target names, shared with the gameplay stand-in so verification scripts find them. */
export const landmarkTargetName = (id: string): string => `Landmark_${id}`;
