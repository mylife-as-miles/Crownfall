// Package: outer territory (distant places, outposts, skyline).
import type { KitPackage } from "../registry";
import { buildOuter } from "../outer/distant";

export const OUTER_PACKAGE: KitPackage = {
  id: "outer",
  siteKits: [{ id: "outer-territory", order: 60, build: buildOuter }],
};
