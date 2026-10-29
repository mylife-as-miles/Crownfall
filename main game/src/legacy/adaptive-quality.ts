// Adaptive quality for My Legacy (docs/legacy/PERFORMANCE.md): like the web
// game, one automatic step down when the current preset is clearly too heavy,
// announced once. It reads the contract's frameTimesMs, which the stand-in
// fills with frame pacing (intervals between rendered frames while it renders
// continuously), so GPU-bound slowness counts as well as main-thread work.

import type { DesktopEnvironmentQuality } from "./environment-contract";

export type QualityPreset = DesktopEnvironmentQuality["preset"];

const ORDER: readonly QualityPreset[] = ["low", "medium", "high"];

/**
 * Checked every two seconds after an eight-second grace. "Sustained" means the
 * median of at least 60 recent frame intervals is over 25 ms (under 40 fps),
 * or over one and a half frame periods of the player's frame limit.
 */
export const ADAPTIVE_QUALITY = { checkMs: 2000, graceMs: 8000, minSamples: 60, budgetMs: 25 } as const;

/** The frame interval above which the current preset counts as too heavy. */
export function adaptiveBudgetMs(frameLimit: DesktopEnvironmentQuality["frameLimit"]): number {
  return frameLimit > 0 ? Math.max(ADAPTIVE_QUALITY.budgetMs, 1.5 * 1000 / frameLimit) : ADAPTIVE_QUALITY.budgetMs;
}

/** The preset to step down to when recent frame intervals show the current one is too heavy, otherwise null. */
export function adaptivePresetFor(quality: DesktopEnvironmentQuality, frameTimesMs: readonly number[]): QualityPreset | null {
  const index = ORDER.indexOf(quality.preset);
  if (index <= 0 || frameTimesMs.length < ADAPTIVE_QUALITY.minSamples) return null;
  const sorted = frameTimesMs.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1] > adaptiveBudgetMs(quality.frameLimit) ? ORDER[index - 1] : null;
}

/** The player's quality with the preset capped by an automatic step down. */
export function capQuality(quality: DesktopEnvironmentQuality, cap: QualityPreset | null): DesktopEnvironmentQuality {
  return cap !== null && ORDER.indexOf(cap) < ORDER.indexOf(quality.preset) ? { ...quality, preset: cap } : quality;
}
