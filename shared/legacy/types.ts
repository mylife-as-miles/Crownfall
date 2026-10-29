// My Legacy domain contracts shared by desktop and Quest. Pure data only: no
// browser, renderer, React or IWSDK dependencies. Changing a persisted shape
// requires a schema version bump and a migration in domain/persistence.ts.

export const LEGACY_SCHEMA_VERSION = 1 as const;

export type NationId = "korvenia" | "solforiz" | "aethelgard" | "kwind-09";
export type ChessSide = "w" | "b";
export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";
export type FileLetter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type SquareId = string;

/** Launch armies await explicit approval, so availability is configuration, not content. */
export type NationAvailability = "available" | "preview" | "unavailable";

export type ArchitectureStyle = "gothic" | "desert-fortress" | "timber-hall" | "stratified-metropolis";

export interface NationDefinition {
  id: NationId;
  name: string;
  polity: string;
  epithet: string;
  summary: string;
  capital: string;
  architecture: ArchitectureStyle;
  /** Linear-light-agnostic sRGB hex colours used by UI and as scene palette seeds. */
  palette: {
    primary: string;
    secondary: string;
    metal: string;
    glow: string;
    sky: string;
    fog: string;
  };
}

export type Tincture =
  | "or" | "argent" | "gules" | "azure" | "vert" | "purpure" | "sable" | "sanguine" | "tenne" | "celeste";
export type HeraldicDivision =
  | "plain" | "per-pale" | "per-fess" | "per-bend" | "per-chevron" | "quarterly" | "per-saltire";
export type HeraldicOrdinary =
  | "none" | "chief" | "fess" | "pale" | "bend" | "chevron" | "cross" | "saltire" | "bordure";
export type HeraldicCharge =
  | "none" | "crown" | "tower" | "key" | "sword" | "sun" | "eclipse" | "mullet" | "cog" | "flame" | "tree" | "pawn";

export interface Heraldry {
  division: HeraldicDivision;
  /** Second tincture is used only when the field is divided. */
  field: readonly [Tincture, Tincture];
  ordinary: HeraldicOrdinary;
  ordinaryTincture: Tincture;
  charge: HeraldicCharge;
  chargeTincture: Tincture;
}

export interface BannerIdentity {
  id: string;
  name: string;
  nationId: NationId;
  heraldry: Heraldry;
  motto: string | null;
  /** ISO timestamp supplied by the caller; domain code never reads the clock. */
  foundedAt: string;
  /** Deterministic seed for generated members and presentation variation. */
  seed: number;
}

/** Political ladder. v1 starts every banner at minor-banner and has no political promotion system yet. */
export type HouseRank = "minor-banner" | "sworn-banner" | "landed-house" | "great-house";

export interface HouseStanding {
  rank: HouseRank;
  /** Political recognition earned from real Muster results. Never converts into chess power. */
  recognition: number;
  /** How many named pieces the house supplies to the National Muster (1 in this release). */
  representation: number;
}

export type MemberStatus = "available" | "injured" | "captive";
/** Political appointment. Only "pawn" is assignable now; the others exist for future appointments. */
export type Appointment = "pawn" | "knight" | "bishop" | "rook" | "queen";

export interface BattlefieldPromotion {
  matchId: string;
  to: Exclude<PieceKind, "p" | "k">;
}

export interface HouseMember {
  id: string;
  name: string;
  epithet: string;
  origin: string;
  appointment: Appointment;
  status: MemberStatus;
  /** House id holding this member captive, when status is "captive". */
  captiveOf: string | null;
  /** Injured members recover once this many matches have been recorded in total. */
  injuredUntilMatch: number | null;
  battlefieldPromotions: BattlefieldPromotion[];
  musters: number;
  captures: number;
  timesCaptured: number;
}

export interface MusterNomination {
  memberId: string | null;
  file: FileLetter | null;
}

export type ExternalHouseKind = "allied-great-house" | "rival-house";

export interface ExternalHouseDefinition {
  id: string;
  name: string;
  nationId: NationId;
  kind: ExternalHouseKind;
  heraldry: Heraldry;
  seat: string;
  temperament: string;
  /** The house's named piece in its nation's Muster formation. */
  representative: { id: string; name: string; piece: Exclude<PieceKind, "k">; square: SquareId };
}

export type HouseStance = "disdainful" | "wary" | "cordial" | "loyal" | "hostile";

export interface HouseRelation {
  houseId: string;
  /** -100..100. Derived stance thresholds live in domain/politics.ts. */
  disposition: number;
  grievances: number;
  /** Chronicle entry ids this house remembers. */
  memory: string[];
}

export type MatchStakes = "classic" | "muster";
export type MatchEndReason =
  | "checkmate" | "stalemate" | "resignation" | "timeout" | "threefold"
  | "insufficient" | "fiftymove" | "objective" | "draw";
export type MatchOutcome = "victory" | "defeat" | "draw";

/** Mirrors web/src/campaign/types.ts IdentityMoveRecord produced by BattleIdentityTracker. */
export interface LegacyMoveRecord {
  ply: number;
  actorId: string;
  from: SquareId;
  to: SquareId;
  capturedCharacterId: string | null;
  capturedSquare: SquareId | null;
  rookCharacterId: string | null;
  promotion: PieceKind | null;
  san?: string;
}

export interface IdentityAllegiance {
  /** "player" for the player's banner, otherwise an external house id or "crown:<nation>". */
  houseId: string;
  side: ChessSide;
  label: string;
}

/** A finalised match as reported by the chess engine bridge. */
export interface LegacyMatchRecord {
  matchId: string;
  stakes: MatchStakes;
  challengeId: string | null;
  playerSide: ChessSide;
  opponentNationId: NationId;
  /** Starting identity map, square → identity id, as fed to BattleIdentityTracker. */
  formation: Record<SquareId, string>;
  allegiance: Record<string, IdentityAllegiance>;
  moves: LegacyMoveRecord[];
  result: { winner: ChessSide | null; reason: MatchEndReason };
  completedAt: string;
  /** Fixture records are accepted only by preview states and can never be persisted. */
  source: "engine" | "fixture";
}

export type RepresentativeFate = "survived" | "captured" | "promoted" | "captured-after-promotion" | "absent";

export interface MatchSummary {
  matchId: string;
  stakes: MatchStakes;
  outcome: MatchOutcome;
  reason: MatchEndReason;
  plies: number;
  opponentNationId: NationId;
  representativeId: string | null;
  representativeFile: FileLetter | null;
  representativeFate: RepresentativeFate;
  representativeCapturedBy: string | null;
  representativeCaptures: number;
  alliedRepresentativeLost: boolean;
  rivalRepresentativeCaptured: boolean;
  completedAt: string;
}

export type ChronicleKind =
  | "founding" | "nomination" | "notice" | "challenge-accepted" | "match" | "capture"
  | "captivity" | "injury" | "recovery" | "return" | "promotion" | "grievance" | "allied-reaction";

export interface ChronicleEntry {
  id: string;
  kind: ChronicleKind;
  /** Index of the recorded match that produced this entry, or null for non-match events. */
  matchIndex: number | null;
  title: string;
  body: string;
  at: string;
  prominence: "major" | "minor";
  refs: { memberId?: string; houseId?: string; matchId?: string; noticeId?: string };
}

export type NoticeKind =
  | "muster-summons" | "rival-challenge" | "allied-demand" | "rival-vow" | "captivity-notice" | "return-notice";

export interface HeraldNotice {
  id: string;
  kind: NoticeKind;
  /** External house id or "crown:<nation>". */
  fromHouseId: string;
  title: string;
  body: string;
  stakes: MatchStakes | null;
  /** Required for Muster challenges: the national wager stated before any match. */
  wager: string | null;
  status: "unread" | "read" | "accepted" | "resolved";
  createdAtMatch: number;
}

export type UnresolvedKind = "captive" | "grievance" | "allied-accounting" | "challenge";

export interface UnresolvedMatter {
  id: string;
  kind: UnresolvedKind;
  title: string;
  body: string;
  houseId: string | null;
  memberId: string | null;
  openedAtMatch: number;
}

/**
 * Production saves are persisted. Preview states load fixtures for clearly labelled
 * development previews and are refused by every persistence path.
 */
export type LegacyMode = "production" | "preview";

export interface LegacySaveV1 {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
  mode: LegacyMode;
  /** Identifies the fixture behind a preview state; null in production. */
  previewId: string | null;
  createdAt: string;
  updatedAt: string;
  banner: BannerIdentity | null;
  standing: HouseStanding;
  members: HouseMember[];
  nomination: MusterNomination;
  relations: HouseRelation[];
  matches: MatchSummary[];
  processedMatchIds: string[];
  chronicle: ChronicleEntry[];
  notices: HeraldNotice[];
  unresolved: UnresolvedMatter[];
  /** Chronicle entry ids awaiting acknowledgement. UIs show at most two prominent ones. */
  pendingAftermath: string[];
}

export type LegacyState = LegacySaveV1;

export type LegacyEvent =
  | { type: "found-banner"; name: string; nationId: NationId; heraldry: Heraldry; motto?: string | null; at: string; seed: number }
  | { type: "nominate"; memberId: string; file: FileLetter; at: string }
  | { type: "read-notice"; noticeId: string }
  | { type: "accept-challenge"; noticeId: string; at: string }
  | { type: "record-match"; record: LegacyMatchRecord }
  | { type: "dismiss-aftermath" }
  | { type: "reset"; at: string };

export interface LegacyTransition {
  state: LegacyState;
  /** Human-readable refusal reason; the returned state is then unchanged. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Presentation view-model consumed by both platform renderers. Computed purely
// from a LegacyState by domain/presentation.ts; renderers never read raw saves.
// ---------------------------------------------------------------------------

export type LandmarkId = "banner-hall" | "muster-grounds" | "war-chronicle" | "heralds-station";

export interface RepresentativePresentation {
  memberId: string;
  name: string;
  epithet: string;
  file: FileLetter | null;
  status: MemberStatus;
  captorHouseId: string | null;
  captorName: string | null;
  /** Latest battlefield promotion, if any. Political standing is unaffected. */
  promotedTo: Exclude<PieceKind, "p" | "k"> | null;
  /** True for one presentation after a return from captivity, until acknowledged. */
  recentlyReturned: boolean;
}

/** A visible honour, always derived from a real recorded event (or a labelled preview fixture). */
export interface LegacyHonour {
  id: string;
  kind: "muster-victory" | "return" | "battlefield-promotion" | "recognition";
  label: string;
  matchId: string | null;
}

export interface BannerholdPresentation {
  mode: LegacyMode;
  previewId: string | null;
  founded: boolean;
  /** True while the founding ceremony previews an unsaved draft identity. */
  draft: boolean;
  nationId: NationId;
  bannerName: string | null;
  heraldry: Heraldry | null;
  rank: HouseRank;
  /** 0 = modest founding hall; higher tiers add visible development earned through recognition. */
  hallTier: 0 | 1 | 2 | 3;
  honours: LegacyHonour[];
  representative: RepresentativePresentation | null;
  levy: { memberId: string; name: string; status: MemberStatus }[];
  /** Files a minor banner may claim, and which houses hold the others. */
  eligibleFiles: FileLetter[];
  claimedFiles: { file: FileLetter; houseId: string; label: string }[];
  matchMarkers: { matchId: string; outcome: MatchOutcome; stakes: MatchStakes }[];
  chronicleCount: number;
  unreadNotices: number;
  noticeKinds: NoticeKind[];
  unresolvedCount: number;
  alliedHouse: { id: string; name: string; heraldry: Heraldry; stance: HouseStance } | null;
  rivalHouse: { id: string; name: string; nationId: NationId; heraldry: Heraldry; stance: HouseStance; holdsCaptive: boolean } | null;
}
