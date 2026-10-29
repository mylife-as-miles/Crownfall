// Package: the four landmarks and the Banner Court's unfinished West Range. Registered under
// Korvenia's full kit ids: other nations use the architecture kit until their own landmark kits
// register here (so Gothic details never leak into another nation's buildings).
import type { KitPackage } from "../registry";
import { buildBannerHallKit, buildWestRangeKit } from "../landmarks/banner-hall";
import { buildMusterGroundsKit } from "../landmarks/muster-grounds";
import { buildWarRecordKit } from "../landmarks/war-record";
import { buildHeraldsStationKit } from "../landmarks/heralds-station";

export const LANDMARKS_PACKAGE: KitPackage = {
  id: "landmarks",
  buildingKits: {
    "kv.manor.banner-hall": buildBannerHallKit,
    "kv.manor.west-range": buildWestRangeKit,
    "kv.muster.dais": buildMusterGroundsKit,
    "kv.record.archive": buildWarRecordKit,
    "kv.herald.station": buildHeraldsStationKit,
  },
};
