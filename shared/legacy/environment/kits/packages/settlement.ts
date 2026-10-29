// Package: settlement architecture (all other buildings use the architecture kit by
// default), fortifications, circulation and dressing.
import type { KitPackage } from "../registry";
import { buildGates, buildTowers, buildWalls } from "../settlement/fortifications";
import { buildRoutes } from "../settlement/routes";
import { buildDressing } from "../settlement/dressing";

export const SETTLEMENT_PACKAGE: KitPackage = {
  id: "settlement",
  siteKits: [
    { id: "walls", order: 20, build: buildWalls },
    { id: "towers", order: 21, build: buildTowers },
    { id: "gates", order: 22, build: buildGates },
    { id: "routes", order: 30, build: buildRoutes },
    { id: "dressing", order: 40, build: buildDressing },
  ],
};
