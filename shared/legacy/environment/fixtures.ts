// Development fixtures for the environment harnesses and tests: LegacySceneState
// objects in preview mode, clearly labelled, never persisted and never shipped as
// production state. Names are neutral placeholders, not canon.

import type { LegacySceneState } from "../environment-contract";
import type { Heraldry, NationId } from "../types";

export const DEVELOPMENT_FIXTURE_CAPTION = "Development fixture · environment preview · not saved";

export type EnvironmentFixtureId = "unfounded" | "founded" | "injured" | "captive" | "returned" | "recognised";

export const ENVIRONMENT_FIXTURE_IDS: readonly EnvironmentFixtureId[] = ["unfounded", "founded", "injured", "captive", "returned", "recognised"];

const PLAYER_ARMS: Heraldry = { division: "per-pale", field: ["purpure", "argent"], ordinary: "chief", ordinaryTincture: "or", charge: "tower", chargeTincture: "sable" };
const ALLY_ARMS: Heraldry = { division: "plain", field: ["sable", "sable"], ordinary: "bordure", ordinaryTincture: "or", charge: "crown", chargeTincture: "or" };
const RIVAL_ARMS: Heraldry = { division: "per-fess", field: ["gules", "sable"], ordinary: "none", ordinaryTincture: "or", charge: "sword", chargeTincture: "argent" };

function base(nationId: NationId, id: EnvironmentFixtureId): LegacySceneState {
  return {
    mode: "preview",
    previewId: `environment-fixture:${id}`,
    founded: true,
    draft: false,
    nationId,
    bannerName: "Fixture Banner",
    heraldry: PLAYER_ARMS,
    rank: "minor-banner",
    hallTier: 0,
    honours: [],
    representative: { memberId: "fixture-member-1", name: "Fixture Representative", epithet: "development fixture", file: "c", status: "available", captorHouseId: null, captorName: null, promotedTo: null, recentlyReturned: false },
    levy: [
      { memberId: "fixture-member-1", name: "Fixture Representative", status: "available" },
      { memberId: "fixture-member-2", name: "Fixture Levy A", status: "available" },
      { memberId: "fixture-member-3", name: "Fixture Levy B", status: "available" },
    ],
    eligibleFiles: ["c", "f"],
    claimedFiles: [{ file: "d", houseId: "fixture-ally", label: "Allied Great House (fixture)" }],
    matchMarkers: [],
    chronicleCount: 1,
    unreadNotices: 2,
    noticeKinds: ["muster-summons", "rival-challenge"],
    unresolvedCount: 0,
    alliedHouse: { id: "fixture-ally", name: "Allied Great House (fixture)", heraldry: ALLY_ARMS, stance: "disdainful" },
    rivalHouse: { id: "fixture-rival", name: "Rival House (fixture)", nationId: nationId === "solforiz" ? "aethelgard" : "solforiz", heraldry: RIVAL_ARMS, stance: "wary", holdsCaptive: false },
  };
}

/** Builds a labelled development fixture state for a nation. */
export function environmentFixture(id: EnvironmentFixtureId, nationId: NationId = "korvenia"): LegacySceneState {
  const s = base(nationId, id);
  switch (id) {
    case "unfounded":
      return { ...s, founded: false, bannerName: null, heraldry: null, representative: null, levy: [], eligibleFiles: [], claimedFiles: [], chronicleCount: 0, unreadNotices: 0, noticeKinds: [], alliedHouse: null, rivalHouse: null };
    case "founded":
      return s;
    case "injured":
      return {
        ...s,
        representative: s.representative ? { ...s.representative, status: "injured" } : null,
        levy: s.levy.map((m) => (m.memberId === "fixture-member-1" ? { ...m, status: "injured" as const } : m)),
        matchMarkers: [{ matchId: "fixture-match-1", outcome: "victory", stakes: "muster" }],
        noticeKinds: ["muster-summons"],
        unreadNotices: 1,
      };
    case "captive":
      return {
        ...s,
        representative: s.representative ? { ...s.representative, status: "captive", captorHouseId: "fixture-rival", captorName: "Rival House (fixture)" } : null,
        levy: s.levy.map((m) => (m.memberId === "fixture-member-1" ? { ...m, status: "captive" as const } : m)),
        matchMarkers: [{ matchId: "fixture-match-1", outcome: "defeat", stakes: "muster" }],
        noticeKinds: ["captivity-notice", "rival-vow"],
        unreadNotices: 2,
        unresolvedCount: 1,
        rivalHouse: s.rivalHouse ? { ...s.rivalHouse, stance: "hostile", holdsCaptive: true } : null,
      };
    case "returned":
      return {
        ...s,
        representative: s.representative ? { ...s.representative, recentlyReturned: true } : null,
        honours: [{ id: "fixture-honour-1", kind: "return", label: "Returned from captivity (fixture)", matchId: "fixture-match-2" }],
        matchMarkers: [
          { matchId: "fixture-match-1", outcome: "defeat", stakes: "muster" },
          { matchId: "fixture-match-2", outcome: "victory", stakes: "muster" },
        ],
        noticeKinds: ["return-notice"],
        unreadNotices: 1,
      };
    case "recognised":
      return {
        ...s,
        hallTier: 2,
        honours: [
          { id: "fixture-honour-1", kind: "muster-victory", label: "Muster victory (fixture)", matchId: "fixture-match-1" },
          { id: "fixture-honour-2", kind: "muster-victory", label: "Muster victory (fixture)", matchId: "fixture-match-2" },
          { id: "fixture-honour-3", kind: "recognition", label: "Recognition (fixture)", matchId: null },
        ],
        matchMarkers: [
          { matchId: "fixture-match-1", outcome: "victory", stakes: "muster" },
          { matchId: "fixture-match-2", outcome: "victory", stakes: "muster" },
          { matchId: "fixture-match-3", outcome: "draw", stakes: "classic" },
          { matchId: "fixture-match-4", outcome: "victory", stakes: "muster" },
        ],
        noticeKinds: ["allied-demand"],
        unreadNotices: 1,
      };
  }
}
