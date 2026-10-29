// The one coordinate system every Bannerhold consumer shares: blueprint data,
// both renderers, the VR staging transform, the map generator and the tests.
// Documented in docs/legacy/environment/TECHNICAL_SPEC.md §2.

import type { NationId } from "../../types";

export const BLUEPRINT_COORDINATES = {
  handedness: "right-handed",
  up: "+Y",
  units: "metres",
  /** Plan axes: +X points east, +Z points south, so -Z is north (three.js default camera forward). */
  east: "+X",
  north: "-Z",
  /** Plan positions are written [x, z]; world positions [x, y, z]. */
  planOrder: "[x, z]",
  origin:
    "The settlement datum: the centre of the holding's core rectangle at elevation 0. Each nation places it on its main circulation spine; heights are absolute elevations relative to it.",
  compass: "Bearings are degrees clockwise from north: 0 north, 90 east, 180 south, 270 west.",
  yaw: "rotationDeg / yawDeg rotate about +Y, three.js convention: positive turns counter-clockwise seen from above. At yaw 0 a building's front (local +Z) faces south.",
} as const;

/** Kit-id prefix per nation: blueprint `kit` hints and material keys of a nation start with it. */
export const NATION_KIT_PREFIX: Readonly<Record<NationId, string>> = {
  korvenia: "kv",
  solforiz: "sf",
  aethelgard: "ag",
  "kwind-09": "kw",
};
