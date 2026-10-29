// Adaptive quality for My Legacy (docs/legacy/PERFORMANCE.md): like the web
// game, one automatic step down when the current preset is clearly too heavy,
// announced once. It reads the contract's frame times, so it works with the
// stand-in and the environment renderer alike.

import type { DesktopEnvironmentQuality } from "./environment-contract";

export type QualityPreset = DesktopEnvironmentQuality["preset"];

const ORDER: readonly QualityPreset[] = ["low", "medium", "high"];

/** Checked every two seconds after an eight-second grace; a full half window over 25 ms (under 40 fps) is "sustained". */
export const ADAPTIVE_QUALITY = { checkMs: 2000, graceMs: 8000, minSamples: 60, budgetMs: 25 } as const;

/** The preset to step down to when recent frame times show the current one is too heavy, otherwise null. */
export function adaptivePresetFor(preset: QualityPreset, frameTimesMs: readonly number[]): QualityPreset | null {
  const index = ORDER.indexOf(preset);
  if (index <= 0 || frameTimesMs.length < ADAPTIVE_QUALITY.minSamples) return null;
  const sorted = frameTimesMs.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1] > ADAPTIVE_QUALITY.budgetMs ? ORDER[index - 1] : null;
}

/** The player's quality with the preset capped by an automatic step down. */
export function capQuality(quality: DesktopEnvironmentQuality, cap: QualityPreset | null): DesktopEnvironmentQuality {
  return cap !== null && ORDER.indexOf(cap) < ORDER.indexOf(quality.preset) ? { ...quality, preset: cap } : quality;
}
