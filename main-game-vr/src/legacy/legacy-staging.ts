// Default anchor-space staging for My Legacy, used by the gameplay stand-in and
// for placing the panels before an environment has published its own staging.
// The Legacy anchor sits at the viewer's eye, so every value is an offset from
// the eye: -Z is forward, +Y is up, in metres.

import type { QuestPosture, QuestStagingInfo } from './environment-contract.js';
import { LEGACY_UI_LAYOUT } from './legacy-ui-contract.js';

type Vec3 = readonly [number, number, number];

export const DEFAULT_LEGACY_STAGING = {
  /** Blueprint metres → anchor metres: the stand-in is laid out as a 1:40 miniature. */
  scale: 0.025,
  footprint: [0.96, 0.56] as const,
  surfaceDepth: -1.0,
  /**
   * A seated viewer looks down onto a table-height miniature; standing puts the table lower. Low enough that
   * a hand ray from about 0.3 m below the eye to the dock passes over the landmark proxies (0.13 m tall) and
   * the hall's standard (0.17 m) stays below the dock in view.
   */
  surfaceHeight: { seated: -0.58, standing: -0.64 } satisfies Record<QuestPosture, number>,
  /**
   * The panel floats behind the miniature with its centre just above eye level and the dock just beneath it:
   * panel top +18.5 degrees, front of the holding -39 (seated) to -42 (standing).
   */
  panelAnchors: { primary: [0, 0.1, -1.4] as Vec3, dock: [0, -0.36, -1.4] as Vec3 },
} as const;

/** Staging to use until an environment reports its own. */
export function fallbackLegacyStaging(posture: QuestPosture): QuestStagingInfo {
  const height = DEFAULT_LEGACY_STAGING.surfaceHeight[posture];
  return {
    scale: DEFAULT_LEGACY_STAGING.scale,
    footprint: DEFAULT_LEGACY_STAGING.footprint,
    surfaceCenter: [0, height, DEFAULT_LEGACY_STAGING.surfaceDepth],
    panelAnchors: DEFAULT_LEGACY_STAGING.panelAnchors,
    landmarks: [],
  };
}

/** Physical panel sizes in metres at 100% text size. */
export const LEGACY_PANEL_METRES = {
  panel: [
    LEGACY_UI_LAYOUT.panel.width / 100 * LEGACY_UI_LAYOUT.authoredScale,
    LEGACY_UI_LAYOUT.panel.height / 100 * LEGACY_UI_LAYOUT.authoredScale,
  ] as const,
  dock: [
    LEGACY_UI_LAYOUT.dock.width / 100 * LEGACY_UI_LAYOUT.authoredScale,
    LEGACY_UI_LAYOUT.dock.height / 100 * LEGACY_UI_LAYOUT.authoredScale,
  ] as const,
} as const;
