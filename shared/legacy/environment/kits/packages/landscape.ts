// Package: terrain, retaining walls, water and vegetation.
import type { KitPackage } from "../registry";
import { buildTerrain } from "../landscape/terrain";
import { buildRetainingWalls } from "../landscape/retaining";
import { buildWater } from "../landscape/water";
import { buildVegetation } from "../landscape/vegetation";
import { buildClutter } from "../landscape/clutter";

export const LANDSCAPE_PACKAGE: KitPackage = {
  id: "landscape",
  siteKits: [
    {
      id: "terrain",
      order: 0,
      build: (ctx) => {
        const t = buildTerrain(ctx);
        return [t.near, t.far];
      },
    },
    { id: "retaining-walls", order: 15, build: buildRetainingWalls },
    { id: "water", order: 16, build: buildWater },
    { id: "vegetation", order: 50, build: buildVegetation },
    { id: "ground-clutter", order: 51, build: buildClutter },
  ],
};
