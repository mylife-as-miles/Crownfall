// Layout of the gameplay stand-in Bannerhold: four landmark plinths on a
// neutral ground, with authored camera framings for the overview, each
// landmark and the representative. Stand-in metres only; the environment
// workflow's blueprint defines the real Bannerhold.

import type { LandmarkId } from "../../../../shared/legacy/types";

export interface StandInFraming {
  /** Look-at point in metres. */
  target: readonly [number, number, number];
  /** Camera direction around the target, radians; 0 looks from +z towards -z. */
  azimuth: number;
  /** Angle from straight down, radians. */
  polar: number;
  radius: number;
  /** Horizontal screen offset of the subject, as a fraction of half the view width (positive moves it left). */
  shift: number;
}

export interface StandInLandmark {
  id: LandmarkId;
  position: readonly [number, number, number];
  /** Height of the HTML label anchor above the ground. */
  labelHeight: number;
  framing: StandInFraming;
}

export const STAND_IN_OVERVIEW: StandInFraming = { target: [0, 1.5, 0.4], azimuth: 0, polar: 0.98, radius: 31, shift: 0 };

/** Where the representative stands, relative to the Muster Grounds plinth centre. */
export const REPRESENTATIVE_OFFSET: readonly [number, number, number] = [0, 0.43, 0.85];

export const STAND_IN_LANDMARKS: Readonly<Record<LandmarkId, StandInLandmark>> = {
  "banner-hall": {
    id: "banner-hall",
    position: [0, 0, -7.5],
    labelHeight: 5.2,
    framing: { target: [0.4, 2.3, -7.5], azimuth: 0.22, polar: 1.1, radius: 15.5, shift: 0.36 },
  },
  "muster-grounds": {
    id: "muster-grounds",
    position: [-9.5, 0, 0.5],
    labelHeight: 2.9,
    framing: { target: [-9.5, 1, 0.5], azimuth: -0.42, polar: 1.04, radius: 13.5, shift: 0.38 },
  },
  "war-record": {
    id: "war-record",
    position: [9.5, 0, 0],
    labelHeight: 3,
    framing: { target: [9.5, 1.1, 0], azimuth: 0.42, polar: 1.0, radius: 13, shift: 0.38 },
  },
  "heralds-station": {
    id: "heralds-station",
    position: [2.5, 0, 8.5],
    labelHeight: 3.7,
    framing: { target: [2.5, 1.6, 8.5], azimuth: 0.12, polar: 1.08, radius: 13, shift: 0.38 },
  },
};

/** Close framing of the representative, or of their empty place. */
export function representativeFraming(): StandInFraming {
  const grounds = STAND_IN_LANDMARKS["muster-grounds"].position;
  return {
    target: [grounds[0] + REPRESENTATIVE_OFFSET[0], 0.95, grounds[2] + REPRESENTATIVE_OFFSET[2]],
    azimuth: -0.3,
    polar: 1.2,
    radius: 4.6,
    shift: 0.38,
  };
}

/** How far the camera may orbit away from its current framing. */
export const ORBIT_LIMITS = {
  yaw: 0.55,
  pitchUp: 0.26,
  pitchDown: 0.22,
  zoomIn: 0.72,
  zoomOut: 1.3,
  /** Absolute polar clamp so the camera never dips under the ground or looks straight down. */
  polarMin: 0.5,
  polarMax: 1.36,
} as const;
