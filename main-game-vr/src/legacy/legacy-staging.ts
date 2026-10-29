// Anchor-space staging for My Legacy. The Legacy anchor sits at the viewer's
// eye, so every value is an offset from the eye: -Z is forward, +Y is up, in
// metres. The default staging serves the gameplay stand-in and places the
// panels before an environment has published its own. placeLegacyPanels turns
// a published staging plus the viewer's comfort settings into the reading
// panel's and the touch tray's placement; it is pure so the comfort rules are
// tested without a headset.

import { LEGACY_LANDMARKS } from '../../../shared/legacy/environment-contract';
import type { LandmarkId } from '../../../shared/legacy/types';
import type { QuestPosture, QuestStagingInfo } from './environment-contract.js';
import { LEGACY_UI_LAYOUT } from './legacy-ui-contract.js';

type Vec3 = readonly [number, number, number];

export const DEFAULT_LEGACY_STAGING = {
  /** Blueprint metres → anchor metres: the stand-in is laid out as a 1:40 miniature. */
  scale: 0.025,
  footprint: [0.96, 0.56] as const,
  surfaceDepth: -1.05,
  /** A seated viewer looks down onto a table-height miniature; standing puts the table lower. */
  surfaceHeight: { seated: -0.64, standing: -0.7 } satisfies Record<QuestPosture, number>,
  /**
   * The reading panel floats behind the miniature with its centre a little below eye level (about -4 degrees,
   * like the Home menu); the dock anchor reports where the touch tray sits for a seated viewer.
   */
  panelAnchors: { primary: [0, -0.1, -1.4] as Vec3, dock: [0, -0.44, -0.41] as Vec3 },
} as const;

/**
 * Stand-in landmark marker positions, in anchor metres relative to the surface centre: one shallow arc in
 * landmark-list order, spaced so a hand ray from either side reaches each marker without first crossing a
 * neighbour's pick volume.
 */
export const STAND_IN_LANDMARK_OFFSETS: Readonly<Record<LandmarkId, Vec3>> = {
  'banner-hall': [-0.36, 0, 0],
  'muster-grounds': [-0.12, 0, -0.05],
  'war-record': [0.12, 0, -0.05],
  'heralds-station': [0.36, 0, 0],
};

/** The staging the gameplay stand-in publishes for a posture: the default staging plus its landmarks. */
export function standInStaging(posture: QuestPosture): QuestStagingInfo {
  const height = DEFAULT_LEGACY_STAGING.surfaceHeight[posture];
  const depth = DEFAULT_LEGACY_STAGING.surfaceDepth;
  return {
    ...fallbackLegacyStaging(posture),
    landmarks: LEGACY_LANDMARKS.map((id) => {
      const offset = STAND_IN_LANDMARK_OFFSETS[id];
      return { id, position: [offset[0], height + offset[1], depth + offset[2]] as const };
    }),
  };
}

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
  tray: [
    LEGACY_UI_LAYOUT.tray.width / 100 * LEGACY_UI_LAYOUT.trayScale,
    LEGACY_UI_LAYOUT.tray.height / 100 * LEGACY_UI_LAYOUT.trayScale,
  ] as const,
} as const;

/** The viewer's comfort settings that move or size the Legacy panels. */
export interface LegacyStagingComfort {
  posture: QuestPosture;
  /** Text Size, 100, 125 or 150 (percent). */
  textScale: number;
  /** Home's Menu Distance in metres (1.2, 1.5 or 1.8); 1.5 keeps the published distance. */
  panelDistance: number;
  /** Panel Height offset in metres; 0 keeps the published height. */
  panelHeight: number;
}

export interface LegacyPlacement {
  position: [number, number, number];
  /** Uniform Object3D scale of the UIKitML asset. */
  scale: number;
}

export interface LegacyPanelPlacements {
  panel: LegacyPlacement;
  tray: LegacyPlacement;
  /** Lowest elevation, in degrees, the reading panel's bottom edge may take before it overlaps the holding. */
  panelFloorDegrees: number;
  /** Head pitch, in degrees, at or below which the tray takes fingertip presses (see trayTouchActive). */
  trayTouchGateDegrees: number;
}

/**
 * Whether the tray should take fingertip presses for a head pitch (degrees, negative below the horizon):
 * on once the head looks down past the gate, off again only once it has risen the hysteresis above it.
 */
export function trayTouchActive(headPitchDegrees: number, active: boolean, gateDegrees: number): boolean {
  return active
    ? headPitchDegrees < gateDegrees + LEGACY_STAGING_RULES.trayTouchGate.hysteresisDegrees
    : headPitchDegrees <= gateDegrees;
}

export const LEGACY_STAGING_RULES = {
  /** Menu Distance that keeps an environment's published panel distance unchanged. */
  defaultMenuDistance: 1.5,
  /** Height above a landmark's published position that its architecture or pick volume may reach. */
  landmarkAllowance: 0.15,
  /** Clearance, in degrees, between the holding and the panel or tray above or below it. */
  clearanceDegrees: 1.5,
  /** The reading panel's top edge stays below this elevation; a panel too tall to fit moves farther away instead. */
  panelCeilingDegrees: 24,
  /** The tray stays within arm's reach of a seated or standing viewer, centred below the line of sight. */
  trayDistance: { seated: 0.6, standing: 0.6 } satisfies Record<QuestPosture, number>,
  /** The tray's elevation range, in degrees below the eye. */
  trayElevation: { highest: -36, lowest: -60 },
  /**
   * The tray takes fingertip presses only while the head looks down towards it. IWSDK gives a fingertip within
   * 15 cm of a pokeable surface priority over that hand's ray, so a hand resting near an always-pokeable tray
   * would swallow every pinch aimed at the reading panel. The gate sits this far below the panel's bottom edge
   * (or midway to the tray when they are closer), with this much hysteresis on the way back up.
   */
  trayTouchGate: { belowPanelDegrees: 6, hysteresisDegrees: 4 },
} as const;

const degrees = (radians: number): number => radians * 180 / Math.PI;
const radians = (value: number): number => value * Math.PI / 180;
const elevation = (y: number, x: number, z: number): number => degrees(Math.atan2(y, Math.hypot(x, z)));

/** The highest point of the holding as seen from the eye, in degrees: its landmarks, or its surface edges. */
function holdingTopDegrees(staging: QuestStagingInfo): number {
  const allowance = LEGACY_STAGING_RULES.landmarkAllowance;
  let top = Number.NEGATIVE_INFINITY;
  for (const landmark of staging.landmarks) {
    top = Math.max(top, elevation(landmark.position[1] + allowance, landmark.position[0], landmark.position[2]));
  }
  if (top === Number.NEGATIVE_INFINITY) {
    const [cx, cy, cz] = staging.surfaceCenter;
    const halfDepth = staging.footprint[1] / 2;
    // Without landmarks, assume features near the middle of the surface reach the allowance.
    top = elevation(cy + allowance, cx, Math.min(-0.05, cz));
    top = Math.max(top, elevation(cy, cx, Math.min(-0.05, cz - halfDepth)));
  }
  return top;
}

/** The elevation, in degrees, of the holding's front edge, the edge nearest the viewer. */
function holdingFrontDegrees(staging: QuestStagingInfo): number {
  const [cx, cy, cz] = staging.surfaceCenter;
  return elevation(cy, cx, Math.min(-0.05, cz + staging.footprint[1] / 2));
}

/**
 * Places the reading panel and the touch tray for a published staging and the viewer's comfort settings.
 * Menu Distance moves the panel along its line of sight and Panel Height raises or lowers it. Larger text
 * grows the panel about its centre; the panel rises only as far as it must to keep its bottom edge above
 * the holding, so rays to its lowest controls never cross a landmark. The tray sits within reach, centred
 * below the line of sight and below the holding's front edge, so it never hides the holding.
 */
export function placeLegacyPanels(staging: QuestStagingInfo, comfort: LegacyStagingComfort): LegacyPanelPlacements {
  const textScale = Math.max(0.5, comfort.textScale / 100);
  const factor = comfort.panelDistance > 0 ? comfort.panelDistance / LEGACY_STAGING_RULES.defaultMenuDistance : 1;
  const [ax, ay, az] = staging.panelAnchors.primary;
  let x = ax * factor;
  let z = az * factor;
  let horizontal = Math.max(0.2, Math.hypot(x, z));
  let y = ay * factor + comfort.panelHeight;
  const halfHeight = LEGACY_PANEL_METRES.panel[1] * textScale / 2;
  const panelFloorDegrees = holdingTopDegrees(staging) + LEGACY_STAGING_RULES.clearanceDegrees;
  const floor = Math.tan(radians(panelFloorDegrees));
  const ceiling = Math.tan(radians(LEGACY_STAGING_RULES.panelCeilingDegrees));
  if (Math.atan2(y - halfHeight, horizontal) < radians(panelFloorDegrees)) {
    // Too low: rise just enough to clear the holding. Too tall to fit under the ceiling as well: step back too.
    const needed = (halfHeight * 2) / Math.max(0.05, ceiling - floor);
    if (horizontal * floor + halfHeight * 2 > horizontal * ceiling && needed > horizontal) {
      const stretch = needed / horizontal;
      x *= stretch;
      z *= stretch;
      horizontal = needed;
    }
    y = horizontal * floor + halfHeight;
  }

  const trayDistance = LEGACY_STAGING_RULES.trayDistance[comfort.posture];
  const trayHalf = degrees(Math.atan2(LEGACY_PANEL_METRES.tray[1] * textScale / 2, trayDistance));
  const rules = LEGACY_STAGING_RULES.trayElevation;
  const trayElevation = Math.max(rules.lowest, Math.min(rules.highest, holdingFrontDegrees(staging) - LEGACY_STAGING_RULES.clearanceDegrees - trayHalf));
  const trayAngle = radians(trayElevation);
  const panelBottomDegrees = degrees(Math.atan2(y - halfHeight, horizontal));
  const trayTouchGateDegrees = Math.max(
    panelBottomDegrees - LEGACY_STAGING_RULES.trayTouchGate.belowPanelDegrees,
    (panelBottomDegrees + trayElevation) / 2,
  );
  return {
    panel: { position: [x, y, z], scale: LEGACY_UI_LAYOUT.authoredScale * textScale },
    tray: {
      position: [0, trayDistance * Math.sin(trayAngle), -trayDistance * Math.cos(trayAngle)],
      scale: LEGACY_UI_LAYOUT.trayScale * textScale,
    },
    panelFloorDegrees,
    trayTouchGateDegrees,
  };
}
