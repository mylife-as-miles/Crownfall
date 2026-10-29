// Package: heraldic props and state slots (figures for NPC schedules are bound by
// the build entry through buildAgents).
import type { KitPackage } from "../registry";
import { buildBannerMounts } from "../props/heraldry";
import { buildSlots } from "../figures/slots";

export const FIGURES_PACKAGE: KitPackage = {
  id: "figures",
  siteKits: [
    { id: "banner-mounts", order: 70, build: buildBannerMounts },
    { id: "state-slots", order: 71, build: buildSlots },
  ],
};
