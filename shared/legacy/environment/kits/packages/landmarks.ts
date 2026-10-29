// Package: the four landmarks of the production nation and the buildings that belong to
// them: the Banner Hall with the Lodging, the unfinished West Range and the Court Gate; the
// Muster Grounds' dais, armoury and levy hall; the War Record and its tier-2 gallery; the
// Herald's Station and the West Gate. Registered under Korvenia's full kit ids: other nations
// use the architecture kit until their own landmark kits register here (so Gothic details
// never leak into another nation's buildings).
import type { KitPackage } from "../registry";
import { buildBannerHallKit, buildCourtGateKit, buildLodgingKit, buildWestRangeKit } from "../landmarks/banner-hall";
import { buildArmouryKit, buildLevyHallKit, buildMusterGroundsKit } from "../landmarks/muster-grounds";
import { buildRecordGalleryKit, buildWarRecordKit } from "../landmarks/war-record";
import { buildHeraldsStationKit, buildMainGateKit } from "../landmarks/heralds-station";

export const LANDMARKS_PACKAGE: KitPackage = {
  id: "landmarks",
  buildingKits: {
    "kv.manor.banner-hall": buildBannerHallKit,
    "kv.manor.lodging": buildLodgingKit,
    "kv.manor.west-range": buildWestRangeKit,
    "kv.fort.court-gate": buildCourtGateKit,
    "kv.muster.dais": buildMusterGroundsKit,
    "kv.muster.armoury": buildArmouryKit,
    "kv.muster.levy-hall": buildLevyHallKit,
    "kv.record.archive": buildWarRecordKit,
    "kv.record.gallery": buildRecordGalleryKit,
    "kv.herald.station": buildHeraldsStationKit,
    "kv.fort.gatehouse": buildMainGateKit,
  },
};
