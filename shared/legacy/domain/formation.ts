// Muster formation for the engine bridge: the starting identity map and
// allegiance for the standard chess position. The bridge feeds `formation`
// to the existing BattleIdentityTracker and never alters chess rules.

import { LEGACY_COPY, PIECE_NAMES } from "../content/copy";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { FILES, musterClaimFor } from "../content/muster";
import { NATIONS } from "../content/nations";
import {
  allyIdentityId, crownHouseId, crownIdentityId, levyIdentityId, PLAYER_HOUSE_ID, playerIdentityId, rivalIdentityId,
} from "./identity";
import { openChallenge } from "./notices";
import { findMember } from "./state";
import type { ChessSide, FileLetter, IdentityAllegiance, LegacyState, NationId, PieceKind, SquareId } from "../types";

export const STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const STANDARD_BACK_RANK: readonly PieceKind[] = ["r", "n", "b", "q", "k", "b", "n", "r"];

/** The piece on a square of the standard starting position, or null for an empty square. */
export function standardPieceAt(square: SquareId): { kind: PieceKind; side: ChessSide } | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const fileIndex = square.charCodeAt(0) - 97;
  const rank = square.charCodeAt(1) - 48;
  if (rank === 1 || rank === 8) return { kind: STANDARD_BACK_RANK[fileIndex], side: rank === 1 ? "w" : "b" };
  if (rank === 2 || rank === 7) return { kind: "p", side: rank === 2 ? "w" : "b" };
  return null;
}

/** The 32 occupied squares of the standard position, white's back rank first. */
export function standardSquares(): SquareId[] {
  const out: SquareId[] = [];
  for (const rank of ["1", "2", "7", "8"]) for (const file of FILES) out.push(`${file}${rank}`);
  return out;
}

/** Converts a square written from white's side (ranks 1–2) to the same piece's square for `side`. */
export function squareForSide(whiteSquare: SquareId, side: ChessSide): SquareId {
  if (side === "w") return whiteSquare;
  const rank = whiteSquare.charCodeAt(1) - 48;
  return `${whiteSquare.charAt(0)}${9 - rank}`;
}

export interface MusterFormationOptions {
  playerSide: ChessSide;
  opponentNationId: NationId;
}

export interface MusterFormation {
  /** Starting identity map, square → identity id, for BattleIdentityTracker. */
  formation: Record<SquareId, string>;
  allegiance: Record<string, IdentityAllegiance>;
  /** The house's representative, or null when the nominee cannot take the field. */
  representativeIdentityId: string | null;
  alliedIdentityId: string;
  /** Present only when the opponent is the rival house's nation. */
  rivalIdentityId: string | null;
}

/**
 * Builds the identity formation for a match from the standard position. The
 * nominated member stands on their file's pawn only while available; an
 * injured or captive nominee leaves an ordinary levy pawn in their place.
 * Throws when no banner has been founded.
 */
export function createMusterFormation(state: LegacyState, options: MusterFormationOptions): MusterFormation {
  const banner = state.banner;
  if (!banner) throw new Error("createMusterFormation needs a founded banner.");
  const playerSide = options.playerSide;
  const opponentSide: ChessSide = playerSide === "w" ? "b" : "w";
  const playerNation = banner.nationId;
  const opponentNation = options.opponentNationId;
  const ally = getAlliedHouse(playerNation);
  const rival = getRivalHouse(playerNation);
  const nominee = findMember(state, state.nomination.memberId);
  const nomineeFile: FileLetter | null = nominee && nominee.status === "available" ? state.nomination.file : null;

  const formation: Record<SquareId, string> = {};
  const allegiance: Record<string, IdentityAllegiance> = {};
  let representativeIdentityId: string | null = null;
  let rivalId: string | null = null;
  const allySquare = squareForSide(ally.representative.square, playerSide);
  const rivalSquare = opponentNation === rival.nationId ? squareForSide(rival.representative.square, opponentSide) : null;

  for (const square of standardSquares()) {
    const piece = standardPieceAt(square);
    if (!piece) continue;
    const ownSide = piece.side === playerSide;
    const nationId = ownSide ? playerNation : opponentNation;
    const nation = NATIONS[nationId];
    const file = square.charAt(0) as FileLetter;
    let id: string;
    let entry: IdentityAllegiance;
    if (ownSide && piece.kind === "p" && nominee && file === nomineeFile) {
      id = playerIdentityId(nominee.id);
      entry = { houseId: PLAYER_HOUSE_ID, side: piece.side, label: `${nominee.name} of ${banner.name}` };
      representativeIdentityId = id;
    } else if (ownSide && square === allySquare) {
      id = allyIdentityId(ally.id);
      entry = { houseId: ally.id, side: piece.side, label: ally.representative.name };
    } else if (!ownSide && square === rivalSquare) {
      id = rivalIdentityId(rival.id);
      entry = { houseId: rival.id, side: piece.side, label: rival.representative.name };
      rivalId = id;
    } else if (piece.kind === "k" || piece.kind === "q") {
      id = crownIdentityId(nationId, square);
      entry = { houseId: crownHouseId(nationId), side: piece.side, label: `the ${PIECE_NAMES[piece.kind]} of the ${nation.name} formation` };
    } else {
      id = levyIdentityId(nationId, square);
      const claim = ownSide && piece.kind === "p" ? musterClaimFor(nationId, file) : null;
      entry = claim
        ? { houseId: claim.houseId, side: piece.side, label: `a ${PIECE_NAMES.p} of ${claim.label}` }
        : { houseId: crownHouseId(nationId), side: piece.side, label: `a ${PIECE_NAMES[piece.kind]} of the ${nation.name} levy` };
    }
    formation[square] = id;
    allegiance[id] = entry;
  }

  return { formation, allegiance, representativeIdentityId, alliedIdentityId: allyIdentityId(ally.id), rivalIdentityId: rivalId };
}

export interface MusterReadiness {
  /** True when a Muster conflict can be played and recorded right now. */
  ready: boolean;
  /** Plain-language reason when not ready, for the UI. */
  reason: string | null;
  /** The accepted challenge a Muster record must answer, if any. */
  challengeId: string | null;
  /** The opponent nation of the open challenge, if any. */
  opponentNationId: NationId | null;
}

/** Whether the house can take the field in a Muster conflict now, and against whom. */
export function musterReadiness(state: LegacyState): MusterReadiness {
  const challenge = openChallenge(state);
  const opponentNationId = challenge && state.banner ? getRivalHouse(state.banner.nationId).nationId : null;
  const result = (reason: string | null): MusterReadiness => ({
    ready: reason === null,
    reason,
    challengeId: challenge && challenge.status === "accepted" ? challenge.id : null,
    opponentNationId,
  });
  if (!state.banner) return result(LEGACY_COPY.readiness.noBanner);
  const nominee = findMember(state, state.nomination.memberId);
  if (!nominee || !state.nomination.file) return result(LEGACY_COPY.readiness.noNominee);
  if (nominee.status !== "available") return result(LEGACY_COPY.readiness.nomineeUnfit(nominee.name, nominee.status));
  if (!challenge) return result(LEGACY_COPY.readiness.noChallenge);
  if (challenge.status !== "accepted") return result(LEGACY_COPY.readiness.notAccepted);
  return result(null);
}
