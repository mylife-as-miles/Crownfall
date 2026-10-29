// Presentation: LegacyState → LegacySceneState for both platform renderers and
// the environment workflow. Honours come only from recorded events (or from a
// labelled preview fixture that ran real records through reduceLegacy).

import { LEGACY_TEXT, PIECE_NAMES } from "../content/copy";
import type { RepresentativeCondition } from "../content/copy";
import { cloneHeraldry, defaultHeraldry, validateHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { eligibleMusterFiles, MUSTER_FILE_CLAIMS } from "../content/muster";
import { defaultLegacyNation, isNationId, LEGACY_NATION_AVAILABILITY, NATIONS } from "../content/nations";
import type { LegacySceneState } from "../environment-contract";
import { generateFoundingMembers } from "./founding";
import { houseDisplayName } from "./identity";
import { ALLIED_START_DISPOSITION, findRelation, hallTierForRecognition, RIVAL_START_DISPOSITION, stanceForDisposition } from "./politics";
import { findMember } from "./state";
import type {
  Heraldry, HouseMember, LegacyHonour, LegacyMode, LegacyState, NationAvailability, NationId, NoticeKind,
  RepresentativePresentation,
} from "../types";

export interface PresentationOptions {
  /** Used only to choose the staging nation of an unfounded holding. */
  availability?: Readonly<Record<NationId, NationAvailability>>;
}

function claimedFilesFor(nationId: NationId): LegacySceneState["claimedFiles"] {
  return MUSTER_FILE_CLAIMS[nationId].map((claim) => ({ file: claim.file, houseId: claim.houseId, label: claim.label }));
}

function representativeFor(state: LegacyState, member: HouseMember): RepresentativePresentation {
  const latest = member.battlefieldPromotions.length > 0 ? member.battlefieldPromotions[member.battlefieldPromotions.length - 1] : null;
  let recentlyReturned = false;
  if (member.status === "available") {
    for (const id of state.pendingAftermath) {
      for (const entry of state.chronicle) {
        if (entry.id === id && entry.kind === "return" && entry.refs.memberId === member.id) recentlyReturned = true;
      }
    }
  }
  return {
    memberId: member.id,
    name: member.name,
    epithet: member.epithet,
    file: state.nomination.file,
    status: member.status,
    captorHouseId: member.status === "captive" ? member.captiveOf : null,
    captorName: member.status === "captive" && member.captiveOf ? houseDisplayName(member.captiveOf) : null,
    promotedTo: latest ? latest.to : null,
    recentlyReturned,
  };
}

/** The condition label a renderer should show for a representative. */
export function representativeCondition(representative: RepresentativePresentation): RepresentativeCondition {
  if (representative.status !== "available") return representative.status;
  if (representative.recentlyReturned) return "returned";
  if (representative.promotedTo) return "promoted";
  return "available";
}

/** Honours derived from recorded Muster victories, returns, battlefield promotions and recognition thresholds. */
export function deriveHonours(state: LegacyState): LegacyHonour[] {
  const ranked: { order: number; honour: LegacyHonour }[] = [];
  const matchOrder = new Map<string, number>();
  state.matches.forEach((match, index) => matchOrder.set(match.matchId, index));
  state.matches.forEach((match, index) => {
    if (match.stakes !== "muster" || match.outcome !== "victory") return;
    ranked.push({
      order: index,
      honour: { id: `honour-victory-${match.matchId}`, kind: "muster-victory", label: LEGACY_TEXT.honours.musterVictory(NATIONS[match.opponentNationId].name), matchId: match.matchId },
    });
  });
  for (const entry of state.chronicle) {
    if (entry.kind !== "return") continue;
    const member = findMember(state, entry.refs.memberId ?? null);
    const matchId = entry.refs.matchId ?? null;
    ranked.push({
      order: matchId !== null ? matchOrder.get(matchId) ?? state.matches.length : state.matches.length,
      honour: { id: `honour-return-${entry.id}`, kind: "return", label: LEGACY_TEXT.honours.returned(member?.name ?? "A member of the house"), matchId },
    });
  }
  for (const member of state.members) {
    for (const promotion of member.battlefieldPromotions) {
      ranked.push({
        order: matchOrder.get(promotion.matchId) ?? state.matches.length,
        honour: {
          id: `honour-promotion-${member.id}-${promotion.matchId}`,
          kind: "battlefield-promotion",
          label: LEGACY_TEXT.honours.promotion(member.name, PIECE_NAMES[promotion.to]),
          matchId: promotion.matchId,
        },
      });
    }
  }
  ranked.sort((a, b) => a.order - b.order);
  const honours = ranked.map((item) => item.honour);
  const tier = hallTierForRecognition(state.standing.recognition);
  for (let level = 1; level <= tier; level++) {
    const t = level as 1 | 2 | 3;
    honours.push({ id: `honour-recognition-${t}`, kind: "recognition", label: LEGACY_TEXT.honours.recognition(t), matchId: null });
  }
  return honours;
}

/** The live Bannerhold scene state. `draft` is always false here. */
export function presentBannerhold(state: LegacyState, options: PresentationOptions = {}): LegacySceneState {
  const banner = state.banner;
  if (!banner) {
    const nationId = defaultLegacyNation(options.availability ?? LEGACY_NATION_AVAILABILITY);
    return {
      mode: state.mode,
      previewId: state.previewId,
      founded: false,
      draft: false,
      nationId,
      bannerName: null,
      heraldry: null,
      rank: state.standing.rank,
      hallTier: 0,
      honours: [],
      representative: null,
      levy: [],
      eligibleFiles: eligibleMusterFiles(nationId),
      claimedFiles: claimedFilesFor(nationId),
      matchMarkers: [],
      chronicleCount: state.chronicle.length,
      unreadNotices: 0,
      noticeKinds: [],
      unresolvedCount: 0,
      alliedHouse: null,
      rivalHouse: null,
    };
  }
  const nominee = findMember(state, state.nomination.memberId);
  const ally = getAlliedHouse(banner.nationId);
  const rival = getRivalHouse(banner.nationId);
  const allyRelation = findRelation(state.relations, ally.id);
  const rivalRelation = findRelation(state.relations, rival.id);
  const noticeKinds: NoticeKind[] = [];
  let unreadNotices = 0;
  for (const notice of state.notices) {
    if (notice.status === "unread") unreadNotices += 1;
    if (notice.status !== "resolved" && noticeKinds.indexOf(notice.kind) === -1) noticeKinds.push(notice.kind);
  }
  let holdsCaptive = false;
  for (const member of state.members) if (member.status === "captive" && member.captiveOf === rival.id) holdsCaptive = true;
  return {
    mode: state.mode,
    previewId: state.previewId,
    founded: true,
    draft: false,
    nationId: banner.nationId,
    bannerName: banner.name,
    heraldry: cloneHeraldry(banner.heraldry),
    rank: state.standing.rank,
    hallTier: hallTierForRecognition(state.standing.recognition),
    honours: deriveHonours(state),
    representative: nominee ? representativeFor(state, nominee) : null,
    levy: state.members
      .filter((member) => !nominee || member.id !== nominee.id)
      .map((member) => ({ memberId: member.id, name: member.name, status: member.status })),
    eligibleFiles: eligibleMusterFiles(banner.nationId),
    claimedFiles: claimedFilesFor(banner.nationId),
    matchMarkers: state.matches.map((match) => ({ matchId: match.matchId, outcome: match.outcome, stakes: match.stakes })),
    chronicleCount: state.chronicle.length,
    unreadNotices,
    noticeKinds,
    unresolvedCount: state.unresolved.length,
    alliedHouse: {
      id: ally.id,
      name: ally.name,
      heraldry: cloneHeraldry(ally.heraldry),
      stance: stanceForDisposition(allyRelation ? allyRelation.disposition : ALLIED_START_DISPOSITION),
    },
    rivalHouse: {
      id: rival.id,
      name: rival.name,
      nationId: rival.nationId,
      heraldry: cloneHeraldry(rival.heraldry),
      stance: stanceForDisposition(rivalRelation ? rivalRelation.disposition : RIVAL_START_DISPOSITION),
      holdsCaptive,
    },
  };
}

export interface LegacyFoundingDraft {
  nationId: NationId;
  /** The name as typed; trimmed for display, never validated here. */
  name?: string | null;
  heraldry?: Heraldry | null;
  /** When given, the levy previews the three members this seed would generate. */
  seed?: number | null;
  mode?: LegacyMode;
  previewId?: string | null;
}

/** Scene state for the live founding preview (`draft: true`, nothing saved). */
export function presentFoundingDraft(draft: LegacyFoundingDraft): LegacySceneState {
  const nationId: NationId = isNationId(draft.nationId) ? draft.nationId : defaultLegacyNation();
  const validated = draft.heraldry ? validateHeraldry(draft.heraldry) : null;
  const heraldry = validated !== null && validated.ok === true ? validated.heraldry : defaultHeraldry(nationId);
  const name = typeof draft.name === "string" ? draft.name.trim().replace(/\s+/g, " ") : "";
  const ally = getAlliedHouse(nationId);
  const rival = getRivalHouse(nationId);
  const mode: LegacyMode = draft.mode ?? "production";
  const levy = typeof draft.seed === "number" && Number.isFinite(draft.seed)
    ? generateFoundingMembers(nationId, draft.seed).map((member) => ({ memberId: member.id, name: member.name, status: member.status }))
    : [];
  return {
    mode,
    previewId: mode === "preview" ? draft.previewId ?? null : null,
    founded: false,
    draft: true,
    nationId,
    bannerName: name.length > 0 ? name : null,
    heraldry,
    rank: "minor-banner",
    hallTier: 0,
    honours: [],
    representative: null,
    levy,
    eligibleFiles: eligibleMusterFiles(nationId),
    claimedFiles: claimedFilesFor(nationId),
    matchMarkers: [],
    chronicleCount: 0,
    unreadNotices: 0,
    noticeKinds: [],
    unresolvedCount: 0,
    alliedHouse: { id: ally.id, name: ally.name, heraldry: cloneHeraldry(ally.heraldry), stance: stanceForDisposition(ALLIED_START_DISPOSITION) },
    rivalHouse: {
      id: rival.id, name: rival.name, nationId: rival.nationId, heraldry: cloneHeraldry(rival.heraldry),
      stance: stanceForDisposition(RIVAL_START_DISPOSITION), holdsCaptive: false,
    },
  };
}
