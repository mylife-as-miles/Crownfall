// Match processing (Legacy rules v1, `record-match`). A finalised record from
// the engine bridge is validated against the formation it was played with,
// analysed for the fate of every named representative, and turned into
// chronicle entries, notices, unresolved matters and political change.

import { LEGACY_TEXT, PIECE_NAMES } from "../content/copy";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { isNationId, NATIONS } from "../content/nations";
import { selectAftermath } from "./aftermath";
import { appendChronicle, matterId } from "./chronicle";
import { createMusterFormation, standardPieceAt, standardSquares } from "./formation";
import { allyIdentityId, crownHouseId, houseDisplayName, nationOfHouse, parseIdentityId, PLAYER_HOUSE_ID, rivalIdentityId } from "./identity";
import { challengeOpponentNation, findNotice, isChallengeNotice, postNotice, postRivalChallenge, setNoticeStatus } from "./notices";
import {
  ALLIED_LOSS_DISPOSITION, changeRelation, MUSTER_DEFEAT_ALLIED_DISPOSITION, MUSTER_VICTORY_ALLIED_DISPOSITION,
  MUSTER_VICTORY_RECOGNITION,
} from "./politics";
import { findMember, isTimestamp } from "./state";
import type {
  ChessSide, ChronicleEntry, FileLetter, HouseMember, LegacyMatchRecord, LegacyState, LegacyTransition,
  MatchEndReason, MatchOutcome, MatchSummary, PieceKind, RepresentativeFate, SquareId,
} from "../types";

const END_REASONS: readonly MatchEndReason[] = [
  "checkmate", "stalemate", "resignation", "timeout", "threefold", "insufficient", "fiftymove", "objective", "draw",
];
const DECISIVE_REASONS: readonly MatchEndReason[] = ["checkmate", "resignation", "timeout", "objective"];
const PROMOTION_KINDS: readonly PieceKind[] = ["n", "b", "r", "q"];
const SQUARE = /^[a-h][1-8]$/;
/** Far beyond any finished chess game; guards against absurd input. */
const MAX_PLIES = 10000;
const MAX_LABEL = 120;

export interface MatchAnalysis {
  outcome: MatchOutcome;
  representativeIdentityId: string | null;
  representativeMemberId: string | null;
  representativeFile: FileLetter | null;
  representativeFate: RepresentativeFate;
  /** House id of the piece that took the representative. */
  capturedBy: string | null;
  capturedByLabel: string | null;
  capturedOnSquare: SquareId | null;
  representativeCaptures: number;
  promotedTo: Exclude<PieceKind, "p" | "k"> | null;
  alliedRepresentativeLost: boolean;
  rivalRepresentativeCaptured: boolean;
}

export type MatchValidation = { ok: true; analysis: MatchAnalysis } | { ok: false; error: string };

export function outcomeFor(winner: ChessSide | null, playerSide: ChessSide): MatchOutcome {
  if (winner === null) return "draw";
  return winner === playerSide ? "victory" : "defeat";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSide(value: unknown): value is ChessSide {
  return value === "w" || value === "b";
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Validates a record against the state it would be applied to. Checks shape,
 * the standard formation, allegiance, the nominated representative, the
 * accepted challenge and a full identity replay of every ply.
 */
export function validateMatchRecord(state: LegacyState, input: LegacyMatchRecord): MatchValidation {
  const fail = (error: string): MatchValidation => ({ ok: false, error });
  const banner = state.banner;
  if (!banner) return fail("Found a banner before recording a match.");
  const record: unknown = input;
  if (!isObject(record)) return fail("The match record is not an object.");
  if (typeof record.matchId !== "string" || record.matchId.length === 0 || record.matchId.length > 128) return fail("The match record needs an id.");
  if (record.source !== "engine" && record.source !== "fixture") return fail("The match record has an unknown source.");
  if (record.source === "fixture" && state.mode !== "preview") return fail("Fixture match records are accepted only by development previews.");
  if (record.stakes !== "classic" && record.stakes !== "muster") return fail("The match record has unknown stakes.");
  if (!isSide(record.playerSide)) return fail("The match record needs the player's side.");
  if (!isNationId(record.opponentNationId)) return fail("The match record names an unknown opponent nation.");
  if (!isTimestamp(record.completedAt)) return fail("The match record needs a completion time.");
  const result = record.result;
  if (!isObject(result)) return fail("The match record has no result.");
  if (result.winner !== null && !isSide(result.winner)) return fail("The match result names an unknown winner.");
  if (typeof result.reason !== "string" || END_REASONS.indexOf(result.reason as MatchEndReason) === -1) return fail("The match result has an unknown reason.");
  const decisive = DECISIVE_REASONS.indexOf(result.reason as MatchEndReason) !== -1;
  if (decisive && result.winner === null) return fail(`A result ${result.reason} needs a winner.`);
  if (!decisive && result.winner !== null) return fail(`A result ${result.reason} cannot have a winner.`);

  const playerSide = record.playerSide;
  const ally = getAlliedHouse(banner.nationId);
  const rival = getRivalHouse(banner.nationId);
  const allyId = allyIdentityId(ally.id);
  const rivalId = rivalIdentityId(rival.id);

  // Formation: exactly the standard position, every identity unique and owed allegiance.
  const formation = record.formation;
  const allegiance = record.allegiance;
  if (!isObject(formation) || !isObject(allegiance)) return fail("The match record needs its formation and allegiance.");
  const squares = standardSquares();
  if (Object.keys(formation).length !== squares.length) return fail("The formation must be the standard starting position.");
  if (Object.keys(allegiance).length !== squares.length) return fail("The allegiance must cover exactly the pieces of the formation.");
  const kinds = new Map<string, PieceKind>();
  const sides = new Map<string, ChessSide>();
  const board = new Map<SquareId, string>();
  let representativeIdentityId: string | null = null;
  for (const square of squares) {
    const id = formation[square];
    const piece = standardPieceAt(square);
    if (typeof id !== "string" || id.length === 0 || !piece) return fail("The formation must be the standard starting position.");
    if (kinds.has(id)) return fail(`The formation lists ${id} twice.`);
    const owed = hasOwn(allegiance, id) ? allegiance[id] : undefined;
    if (!isObject(owed) || typeof owed.houseId !== "string" || typeof owed.label !== "string" || owed.label.length === 0 ||
      owed.label.length > MAX_LABEL || owed.side !== piece.side) {
      return fail(`The allegiance of ${id} is missing or does not match its side.`);
    }
    const parsed = parseIdentityId(id);
    if (parsed?.kind === "player") {
      if (representativeIdentityId) return fail("The formation names more than one representative of the house.");
      if (piece.side !== playerSide || owed.houseId !== PLAYER_HOUSE_ID) return fail("The house's representative must stand on the player's side.");
      representativeIdentityId = id;
    } else if (parsed?.kind === "ally") {
      if (id !== allyId || piece.side !== playerSide) return fail("The formation names an allied representative this banner does not serve with.");
    } else if (parsed?.kind === "rival") {
      if (id !== rivalId || piece.side === playerSide || record.opponentNationId !== rival.nationId) return fail("The formation names a rival representative that does not belong in this match.");
    }
    kinds.set(id, piece.kind);
    sides.set(id, piece.side);
    board.set(square, id);
  }

  // The nominated representative must be present exactly when they can take the field.
  const nominee = findMember(state, state.nomination.memberId);
  const nomineeFit = nominee !== null && nominee.status === "available" && state.nomination.file !== null;
  let representativeMemberId: string | null = null;
  let representativeFile: FileLetter | null = null;
  if (representativeIdentityId) {
    const parsed = parseIdentityId(representativeIdentityId);
    const memberId = parsed && parsed.kind === "player" ? parsed.memberId : "";
    const member = findMember(state, memberId);
    if (!member) return fail("The formation names a representative who is not a member of this house.");
    if (!nominee || member.id !== nominee.id) return fail(`${member.name} is not the nominated representative.`);
    if (member.status !== "available") return fail(`${member.name} cannot take the field while ${member.status}.`);
    const file = state.nomination.file;
    if (!file || formation[`${file}${playerSide === "w" ? 2 : 7}`] !== representativeIdentityId) {
      return fail(`${member.name} must stand on the nominated ${file ?? "?"}-file pawn.`);
    }
    representativeMemberId = member.id;
    representativeFile = file;
  } else if (nomineeFit) {
    return fail("The nominated representative is absent from the formation.");
  }
  if (record.stakes === "muster" && !representativeIdentityId) return fail("A Muster conflict needs an available nominated representative.");

  // Every identity and allegiance must be exactly the Muster formation this banner fields, so
  // every captor is a known house of the opposing army.
  const expected = createMusterFormation(state, { playerSide, opponentNationId: record.opponentNationId });
  for (const square of squares) {
    const id = formation[square] as string;
    if (expected.formation[square] !== id) return fail(`${square} holds ${id}, which is not part of this banner's Muster formation.`);
    const owed = allegiance[id];
    if (!isObject(owed) || owed.houseId !== expected.allegiance[id].houseId) return fail(`${id} owes allegiance to the wrong house.`);
  }

  // Muster records answer an accepted challenge from the opponent's side; classic records answer none.
  if (record.stakes === "muster") {
    if (typeof record.challengeId !== "string") return fail("A Muster conflict must answer an accepted challenge.");
    const notice = findNotice(state, record.challengeId);
    if (!notice || !isChallengeNotice(notice)) return fail("The Muster conflict answers an unknown challenge.");
    if (notice.status !== "accepted") return fail("Accept the challenge, with its wager, before its match is recorded.");
    if (challengeOpponentNation(notice) !== record.opponentNationId) return fail("The match was fought against a different nation than the challenge named.");
  } else if (record.challengeId !== null) {
    return fail("A Classic match cannot answer a Muster challenge.");
  }

  // Replay every ply over the identity map, as BattleIdentityTracker produced it.
  const moves = record.moves;
  if (!Array.isArray(moves)) return fail("The match record needs its moves.");
  if (moves.length > MAX_PLIES) return fail("The match record has more plies than any finished game.");
  const captured = new Set<string>();
  let capturedBy: string | null = null;
  let capturedByLabel: string | null = null;
  let capturedOnSquare: SquareId | null = null;
  let representativeCaptures = 0;
  let promotedTo: Exclude<PieceKind, "p" | "k"> | null = null;
  for (let index = 0; index < moves.length; index++) {
    const move: unknown = moves[index];
    const label = `Ply ${index + 1}`;
    if (!isObject(move)) return fail(`${label} is not a move.`);
    if (move.ply !== index) return fail(`${label} is out of sequence (expected ply ${index}, found ${String(move.ply)}).`);
    if (move.san !== undefined && typeof move.san !== "string") return fail(`${label} has an invalid SAN.`);
    const actorId = move.actorId;
    if (typeof actorId !== "string" || !kinds.has(actorId)) return fail(`${label} names an actor who is not in the formation.`);
    if (captured.has(actorId)) return fail(`${label} moves ${actorId}, who was captured earlier.`);
    if (typeof move.from !== "string" || !SQUARE.test(move.from) || typeof move.to !== "string" || !SQUARE.test(move.to) || move.from === move.to) {
      return fail(`${label} has invalid squares.`);
    }
    const from = move.from;
    const to = move.to;
    if (board.get(from) !== actorId) return fail(`${label}: ${actorId} is not on ${from}.`);
    const side = sides.get(actorId) as ChessSide;
    if (side !== (index % 2 === 0 ? "w" : "b")) return fail(`${label} is played out of turn.`);
    const kind = kinds.get(actorId) as PieceKind;

    // Narrow the untrusted fields into typed locals (explicit, so non-strict consumers type-check too).
    const rawCaptured = move.capturedCharacterId;
    const rawCapturedSquare = move.capturedSquare;
    let capturedId: string | null = null;
    let capturedSquare: SquareId | null = null;
    if (rawCaptured !== null) {
      if (typeof rawCaptured !== "string" || !kinds.has(rawCaptured)) return fail(`${label} captures an identity that is not in the formation.`);
      if (captured.has(rawCaptured)) return fail(`${label} captures ${rawCaptured}, who was already captured.`);
      if (typeof rawCapturedSquare !== "string" || board.get(rawCapturedSquare) !== rawCaptured) return fail(`${label}: ${rawCaptured} is not on the captured square.`);
      if (sides.get(rawCaptured) === side) return fail(`${label} captures a piece of its own side.`);
      if (kinds.get(rawCaptured) === "k") return fail(`${label} captures a king.`);
      const enPassant = kind === "p" && rawCapturedSquare === `${to.charAt(0)}${from.charAt(1)}`;
      if (rawCapturedSquare !== to && !enPassant) return fail(`${label} captures away from its destination.`);
      if (rawCapturedSquare !== to && board.has(to)) return fail(`${label} lands on an occupied square.`);
      capturedId = rawCaptured;
      capturedSquare = rawCapturedSquare;
    } else {
      if (rawCapturedSquare !== null) return fail(`${label} names a captured square without a captured identity.`);
      if (board.has(to)) return fail(`${label} lands on an occupied square without a capture.`);
    }

    const rawRook = move.rookCharacterId;
    let rookId: string | null = null;
    let rookFrom: SquareId | null = null;
    let rookTo: SquareId | null = null;
    const homeRank = side === "w" ? "1" : "8";
    const castling = kind === "k" && from === `e${homeRank}` && (to === `g${homeRank}` || to === `c${homeRank}`);
    if (rawRook !== null) {
      if (typeof rawRook !== "string" || !castling) return fail(`${label} moves a rook outside castling.`);
      const rank = from.charAt(1);
      rookFrom = to.charAt(0) === "g" ? `h${rank}` : `a${rank}`;
      rookTo = to.charAt(0) === "g" ? `f${rank}` : `d${rank}`;
      if (board.get(rookFrom) !== rawRook || kinds.get(rawRook) !== "r" || board.has(rookTo)) return fail(`${label} castles with a rook that is not in place.`);
      rookId = rawRook;
    } else if (castling) {
      return fail(`${label} castles without its rook.`);
    }

    const rawPromotion = move.promotion;
    let promotion: Exclude<PieceKind, "p" | "k"> | null = null;
    const lastRank = side === "w" ? "8" : "1";
    if (rawPromotion !== null) {
      if (typeof rawPromotion !== "string" || PROMOTION_KINDS.indexOf(rawPromotion as PieceKind) === -1) return fail(`${label} promotes to an invalid piece.`);
      if (kind !== "p" || to.charAt(1) !== lastRank) return fail(`${label} promotes a piece that cannot promote.`);
      promotion = rawPromotion as Exclude<PieceKind, "p" | "k">;
    } else if (kind === "p" && to.charAt(1) === lastRank) {
      return fail(`${label} reaches the last rank without promotion.`);
    }

    // Commit the ply.
    if (capturedId !== null && capturedSquare !== null) {
      board.delete(capturedSquare);
      captured.add(capturedId);
      if (capturedId === representativeIdentityId) {
        const owed = allegiance[actorId];
        capturedBy = isObject(owed) && typeof owed.houseId === "string" ? owed.houseId : null;
        capturedByLabel = isObject(owed) && typeof owed.label === "string" ? owed.label : null;
        capturedOnSquare = capturedSquare;
      }
      if (actorId === representativeIdentityId) representativeCaptures += 1;
    }
    board.delete(from);
    board.set(to, actorId);
    if (rookId !== null && rookFrom !== null && rookTo !== null) {
      board.delete(rookFrom);
      board.set(rookTo, rookId);
    }
    if (promotion !== null) {
      kinds.set(actorId, promotion);
      if (actorId === representativeIdentityId) promotedTo = promotion;
    }
  }

  const representativeCaptured = representativeIdentityId !== null && captured.has(representativeIdentityId);
  let fate: RepresentativeFate = "absent";
  if (representativeIdentityId) {
    if (representativeCaptured) fate = promotedTo ? "captured-after-promotion" : "captured";
    else fate = promotedTo ? "promoted" : "survived";
  }
  return {
    ok: true,
    analysis: {
      outcome: outcomeFor(result.winner as ChessSide | null, playerSide),
      representativeIdentityId,
      representativeMemberId,
      representativeFile,
      representativeFate: fate,
      capturedBy: representativeCaptured ? capturedBy : null,
      capturedByLabel: representativeCaptured ? capturedByLabel : null,
      capturedOnSquare: representativeCaptured ? capturedOnSquare : null,
      representativeCaptures,
      promotedTo,
      alliedRepresentativeLost: captured.has(allyId),
      rivalRepresentativeCaptured: captured.has(rivalId),
    },
  };
}

/** Applies a validated record. Idempotent by matchId; refusals return the input state unchanged. */
export function applyMatchRecord(state: LegacyState, record: LegacyMatchRecord): LegacyTransition {
  if (state.banner && record && typeof record === "object" && state.processedMatchIds.indexOf(record.matchId) !== -1) {
    return { state, error: null };
  }
  const validation = validateMatchRecord(state, record);
  if (validation.ok === false) return { state, error: validation.error };
  const banner = state.banner;
  if (!banner) return { state, error: "Found a banner before recording a match." };
  const analysis = validation.analysis;
  const at = record.completedAt;
  const matchIndex = state.matches.length;
  const matchNumber = matchIndex + 1;
  const muster = record.stakes === "muster";
  const opponentName = NATIONS[record.opponentNationId].name;
  const ally = getAlliedHouse(banner.nationId);
  const rival = getRivalHouse(banner.nationId);

  const chronicle: ChronicleEntry[] = state.chronicle.slice();
  let notices = state.notices.slice();
  let unresolved = state.unresolved.slice();
  let members: HouseMember[] = state.members.slice();
  let relations = state.relations.slice();
  let recognition = state.standing.recognition;
  const majorIds: string[] = [];
  const add = (draft: Parameters<typeof appendChronicle>[1]): ChronicleEntry => {
    const entry = appendChronicle(chronicle, draft);
    if (entry.prominence === "major") majorIds.push(entry.id);
    return entry;
  };
  const representative = findMember(state, analysis.representativeMemberId);
  const matchRefs = { matchId: record.matchId };

  const matchEntry = add({
    kind: "match",
    text: LEGACY_TEXT.match(record.stakes, analysis.outcome, record.result.reason, record.moves.length, opponentName, representative?.name ?? null),
    at, matchIndex, prominence: "major",
    refs: representative ? { ...matchRefs, memberId: representative.id } : matchRefs,
  });

  // The answered challenge closes, and its open-challenge matter with it.
  if (muster && record.challengeId) {
    notices = setNoticeStatus(notices, record.challengeId, "resolved");
    const challengeMatter = matterId(record.challengeId);
    unresolved = unresolved.filter((matter) => matter.id !== challengeMatter);
    const challenge = findNotice(state, record.challengeId);
    if (challenge && challenge.fromHouseId === rival.id) relations = changeRelation(relations, rival.id, { remember: matchEntry.id });
  }

  // The representative's fate.
  if (representative) {
    const captured = analysis.representativeFate === "captured" || analysis.representativeFate === "captured-after-promotion";
    let status = representative.status;
    let captiveOf = representative.captiveOf;
    let injuredUntilMatch = representative.injuredUntilMatch;
    const promotions = analysis.promotedTo
      ? representative.battlefieldPromotions.concat({ matchId: record.matchId, to: analysis.promotedTo })
      : representative.battlefieldPromotions;
    if (captured && !muster) {
      add({
        kind: "capture",
        text: LEGACY_TEXT.classicCapture(representative.name, analysis.capturedOnSquare ?? "the board", analysis.capturedByLabel ?? opponentName),
        at, matchIndex, prominence: "minor", refs: { ...matchRefs, memberId: representative.id },
      });
    } else if (captured && analysis.outcome === "defeat") {
      const captor = analysis.capturedBy ?? crownHouseId(record.opponentNationId);
      const captorName = houseDisplayName(captor);
      status = "captive";
      captiveOf = captor;
      injuredUntilMatch = null;
      const entry = add({
        kind: "captivity",
        text: LEGACY_TEXT.captivity(representative.name, captorName, opponentName),
        at, matchIndex, prominence: "major", refs: { ...matchRefs, memberId: representative.id, houseId: captor },
      });
      const noticeText = LEGACY_TEXT.captivityNotice(representative.name, captorName, opponentName);
      postNotice(notices, { kind: "captivity-notice", fromHouseId: captor, title: noticeText.title, body: noticeText.body, stakes: null, wager: null, createdAtMatch: matchNumber });
      const matter = LEGACY_TEXT.matters.captive(representative.name, captorName);
      unresolved.push({ id: matterId(entry.id), kind: "captive", title: matter.title, body: matter.body, houseId: captor, memberId: representative.id, openedAtMatch: matchNumber });
      if (captor === rival.id) relations = changeRelation(relations, rival.id, { remember: entry.id });
    } else if (captured) {
      status = "injured";
      injuredUntilMatch = matchNumber + 1;
      add({
        kind: "injury",
        text: LEGACY_TEXT.injury(representative.name, analysis.outcome),
        at, matchIndex, prominence: "major", refs: { ...matchRefs, memberId: representative.id },
      });
    }
    if (analysis.promotedTo) {
      add({
        kind: "promotion",
        text: LEGACY_TEXT.promotion(representative.name, PIECE_NAMES[analysis.promotedTo], captured),
        at, matchIndex, prominence: "major", refs: { ...matchRefs, memberId: representative.id },
      });
    }
    if (analysis.representativeCaptures > 0) {
      add({
        kind: "capture",
        text: LEGACY_TEXT.representativeCaptures(representative.name, analysis.representativeCaptures),
        at, matchIndex, prominence: "minor", refs: { ...matchRefs, memberId: representative.id },
      });
    }
    members = members.map((member) => member.id !== representative.id ? member : {
      ...member,
      status,
      captiveOf,
      injuredUntilMatch,
      battlefieldPromotions: promotions,
      musters: member.musters + (muster ? 1 : 0),
      captures: member.captures + analysis.representativeCaptures,
      timesCaptured: member.timesCaptured + (captured ? 1 : 0),
    });
  }

  // Muster politics. Classic matches are recorded without political consequence.
  if (muster) {
    if (analysis.outcome === "victory") {
      recognition += MUSTER_VICTORY_RECOGNITION;
      relations = changeRelation(relations, ally.id, { disposition: MUSTER_VICTORY_ALLIED_DISPOSITION });
    } else if (analysis.outcome === "defeat") {
      relations = changeRelation(relations, ally.id, { disposition: MUSTER_DEFEAT_ALLIED_DISPOSITION });
    }
    if (analysis.alliedRepresentativeLost) {
      const entry = add({
        kind: "allied-reaction",
        text: LEGACY_TEXT.alliedReaction(ally.name, ally.representative.name, opponentName),
        at, matchIndex, prominence: "major", refs: { ...matchRefs, houseId: ally.id },
      });
      relations = changeRelation(relations, ally.id, { disposition: ALLIED_LOSS_DISPOSITION, grievances: 1, remember: entry.id });
      const demand = LEGACY_TEXT.alliedDemand(ally.name, ally.representative.name);
      postNotice(notices, { kind: "allied-demand", fromHouseId: ally.id, title: demand.title, body: demand.body, stakes: null, wager: null, createdAtMatch: matchNumber });
      const matter = LEGACY_TEXT.matters.accounting(ally.name);
      unresolved.push({ id: matterId(entry.id), kind: "allied-accounting", title: matter.title, body: matter.body, houseId: ally.id, memberId: null, openedAtMatch: matchNumber });
    }
    if (analysis.rivalRepresentativeCaptured) {
      const entry = add({
        kind: "grievance",
        text: LEGACY_TEXT.grievance(rival.name, rival.representative.name),
        at, matchIndex, prominence: "major", refs: { ...matchRefs, houseId: rival.id },
      });
      relations = changeRelation(relations, rival.id, { grievances: 1, remember: entry.id });
      const vow = LEGACY_TEXT.rivalVow(rival.name, rival.representative.name);
      postNotice(notices, { kind: "rival-vow", fromHouseId: rival.id, title: vow.title, body: vow.body, stakes: null, wager: null, createdAtMatch: matchNumber });
      const matter = LEGACY_TEXT.matters.grievance(rival.name);
      unresolved.push({ id: matterId(entry.id), kind: "grievance", title: matter.title, body: matter.body, houseId: rival.id, memberId: null, openedAtMatch: matchNumber });
    }
    // A Muster victory over the nation holding a captive brings them home.
    if (analysis.outcome === "victory") {
      for (const member of members) {
        if (member.status !== "captive" || !member.captiveOf || nationOfHouse(member.captiveOf) !== record.opponentNationId) continue;
        const captor = member.captiveOf;
        const captorName = houseDisplayName(captor);
        add({
          kind: "return",
          text: LEGACY_TEXT.returned(member.name, opponentName),
          at, matchIndex, prominence: "major", refs: { ...matchRefs, memberId: member.id, houseId: captor },
        });
        const notice = LEGACY_TEXT.returnNotice(member.name, captorName);
        postNotice(notices, { kind: "return-notice", fromHouseId: captor, title: notice.title, body: notice.body, stakes: null, wager: null, createdAtMatch: matchNumber });
        unresolved = unresolved.filter((matter) => !(matter.kind === "captive" && matter.memberId === member.id));
      }
      members = members.map((member) =>
        member.status === "captive" && member.captiveOf && nationOfHouse(member.captiveOf) === record.opponentNationId
          ? { ...member, status: "available", captiveOf: null }
          : member);
    }
  }

  // Injuries heal once their recovery match has been recorded.
  const recovered: HouseMember[] = [];
  members = members.map((member) => {
    if (member.status !== "injured" || member.injuredUntilMatch === null || member.injuredUntilMatch > matchNumber) return member;
    const healed: HouseMember = { ...member, status: "available", injuredUntilMatch: null };
    recovered.push(healed);
    return healed;
  });
  for (const member of recovered) {
    add({ kind: "recovery", text: LEGACY_TEXT.recovery(member.name), at, matchIndex, prominence: "minor", refs: { ...matchRefs, memberId: member.id } });
  }

  // The rival offers the next field once a challenge has been answered.
  if (muster) {
    let captiveName: string | null = null;
    for (const member of members) {
      if (member.status === "captive" && member.captiveOf && nationOfHouse(member.captiveOf) === rival.nationId) {
        captiveName = member.name;
        break;
      }
    }
    const context = captiveName ? "captive" : analysis.rivalRepresentativeCaptured ? "vow" : "renewed";
    postRivalChallenge(notices, unresolved, banner.nationId, banner.name, context, captiveName, matchNumber);
  }

  const summary: MatchSummary = {
    matchId: record.matchId,
    stakes: record.stakes,
    outcome: analysis.outcome,
    reason: record.result.reason,
    plies: record.moves.length,
    opponentNationId: record.opponentNationId,
    representativeId: analysis.representativeMemberId,
    representativeFile: analysis.representativeFile,
    representativeFate: analysis.representativeFate,
    representativeCapturedBy: analysis.capturedBy,
    representativeCaptures: analysis.representativeCaptures,
    alliedRepresentativeLost: analysis.alliedRepresentativeLost,
    rivalRepresentativeCaptured: analysis.rivalRepresentativeCaptured,
    completedAt: at,
  };

  return {
    state: {
      ...state,
      updatedAt: at,
      standing: { ...state.standing, recognition },
      members,
      relations,
      matches: state.matches.concat(summary),
      processedMatchIds: state.processedMatchIds.concat(record.matchId),
      chronicle,
      notices,
      unresolved,
      pendingAftermath: selectAftermath(chronicle, state.pendingAftermath.concat(majorIds)),
    },
    error: null,
  };
}

/** True when the summary's representative was taken on the board, before or after promotion. */
export function representativeWasCaptured(summary: Pick<MatchSummary, "representativeFate">): boolean {
  return summary.representativeFate === "captured" || summary.representativeFate === "captured-after-promotion";
}

