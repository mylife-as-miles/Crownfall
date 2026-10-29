// Development preview fixtures. Every preview state is produced by running
// scripted fixture LegacyMatchRecords (source "fixture") through reduceLegacy,
// so previews show exactly what the real rules decide. Fixture states are
// mode "preview" and every persistence path refuses them.
//
// Each tape is a legal game from the standard position, written in coordinate
// notation; web/src/legacy/fixtures.test.ts replays every tape through the
// real GameController and BattleIdentityTracker to prove it.

import { defaultHeraldry } from "../content/heraldry";
import { getRivalHouse } from "../content/houses";
import { createMusterFormation, standardPieceAt } from "./formation";
import { openChallenge } from "./notices";
import { reduceLegacy } from "./reducer";
import { createLegacyState } from "./state";
import type {
  ChessSide, FileLetter, LegacyMatchRecord, LegacyMoveRecord, LegacyState, LegacyTransition, MatchEndReason, NationId, PieceKind,
  SquareId,
} from "../types";

/**
 * Converts a coordinate tape ("e2e4", "b7a8q") into identity move records the
 * way BattleIdentityTracker records them: captures (including en passant),
 * castling rook trips and promotions keep each identity. Fixture-only: live
 * matches always come from the engine bridge and the real tracker.
 */
export function identityRecordsFromTape(formation: Readonly<Record<SquareId, string>>, tape: readonly string[]): LegacyMoveRecord[] {
  const board = new Map<SquareId, string>();
  const kinds = new Map<string, PieceKind>();
  for (const square of Object.keys(formation)) {
    const piece = standardPieceAt(square);
    board.set(square, formation[square]);
    if (piece) kinds.set(formation[square], piece.kind);
  }
  return tape.map((move, ply) => {
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length > 4 ? (move.charAt(4) as PieceKind) : null;
    const actorId = board.get(from);
    if (!actorId) throw new Error(`Fixture tape ply ${ply} moves from empty square ${from}.`);
    const kind = kinds.get(actorId);
    let capturedSquare: SquareId | null = board.has(to) ? to : null;
    if (!capturedSquare && kind === "p" && from.charAt(0) !== to.charAt(0)) capturedSquare = `${to.charAt(0)}${from.charAt(1)}`;
    const capturedCharacterId = capturedSquare ? board.get(capturedSquare) ?? null : null;
    let rookCharacterId: string | null = null;
    if (kind === "k" && from.charAt(0) === "e" && (to.charAt(0) === "g" || to.charAt(0) === "c")) {
      const rank = from.charAt(1);
      const rookFrom = to.charAt(0) === "g" ? `h${rank}` : `a${rank}`;
      const rookTo = to.charAt(0) === "g" ? `f${rank}` : `d${rank}`;
      rookCharacterId = board.get(rookFrom) ?? null;
      if (rookCharacterId) {
        board.delete(rookFrom);
        board.set(rookTo, rookCharacterId);
      }
    }
    if (capturedSquare) board.delete(capturedSquare);
    board.delete(from);
    board.set(to, actorId);
    if (promotion) kinds.set(actorId, promotion);
    return { ply, actorId, from, to, capturedCharacterId, capturedSquare, rookCharacterId, promotion };
  });
}

interface FixtureMatch {
  type: "match";
  matchId: string;
  stakes: "muster" | "classic";
  playerSide: ChessSide;
  /** Defaults to the rival house's nation. */
  opponentNationId?: NationId;
  tape: readonly string[];
  winner: ChessSide | null;
  reason: MatchEndReason;
  at: string;
}

type FixtureStep =
  | { type: "found"; nationId: NationId; name: string; seed: number; at: string }
  | { type: "nominate"; member: 1 | 2 | 3; file: FileLetter; at: string }
  | { type: "accept"; at: string }
  /** The aftermath acknowledged, as when the house returns to My Legacy between matches. */
  | { type: "dismiss" }
  | FixtureMatch;

const DISMISS: FixtureStep = { type: "dismiss" };

interface PreviewFixture {
  id: string;
  title: string;
  description: string;
  nationId: NationId;
  steps: readonly FixtureStep[];
}

export interface LegacyPreviewListing {
  id: string;
  title: string;
  description: string;
  nationId: NationId;
}

// Tapes (Korvenia vs Solforiz; rival representative on c7, allied Knight on b1).
const TAPE_REPRESENTATIVE_TAKEN_IN_DEFEAT = ["b2b4", "c7c5", "f2f3", "c5b4", "g2g4", "e7e5", "a2a3", "d8h4"];
const TAPE_REPRESENTATIVE_TAKEN_IN_VICTORY = ["e2e4", "e7e5", "b2b4", "f8b4", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const TAPE_SCHOLARS_VICTORY = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const TAPE_FOOLS_VICTORY_AS_BLACK = ["f2f3", "e7e5", "g2g4", "d8h4"];
const TAPE_PROMOTION = ["c2c4", "b7b5", "c4b5", "a7a6", "b5a6", "c8b7", "a6b7", "b8c6", "b7a8q"];
const TAPE_ALLY_LOST_IN_VICTORY = ["e2e4", "e7e5", "b1c3", "f8b4", "f1c4", "b4c3", "d1h5", "d7d6", "h5f7"];
const TAPE_REPRESENTATIVE_TAKEN_THEN_REPETITION = ["b2b4", "c7c5", "g1f3", "c5b4", "f3g1", "b8c6", "g1f3", "c6b8", "f3g1", "b8c6", "g1f3", "c6b8"];
const TAPE_RIVAL_TAKEN = ["b2b4", "c7c5", "b4c5", "e7e5", "e2e4", "b8c6", "f1c4", "a7a6", "d1f3", "h7h6", "f3f7"];

const FOUNDING_NAMES: Readonly<Record<NationId, string>> = {
  korvenia: "House Vesperine",
  solforiz: "House Ruqaimar",
  aethelgard: "House Hrothwyn",
  "kwind-09": "House Arata-Kwok",
};

const KORVENIA_FOUNDING: FixtureStep = { type: "found", nationId: "korvenia", name: "House Vesperine", seed: 1201, at: "2026-01-12T19:00:00.000Z" };

function muster(matchId: string, tape: readonly string[], winner: ChessSide | null, reason: MatchEndReason, at: string, playerSide: ChessSide = "w"): FixtureMatch {
  return { type: "match", matchId, stakes: "muster", playerSide, tape, winner, reason, at };
}

function classic(matchId: string, tape: readonly string[], winner: ChessSide | null, reason: MatchEndReason, at: string): FixtureMatch {
  return { type: "match", matchId, stakes: "classic", playerSide: "w", tape, winner, reason, at };
}

const FIXTURES: readonly PreviewFixture[] = [
  {
    id: "founded",
    title: "Newly founded banner",
    description: "A Korvenian minor banner, its first Pawn nominated and the rival's challenge unanswered at the Herald's Station.",
    nationId: "korvenia",
    steps: [KORVENIA_FOUNDING, { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" }],
  },
  {
    id: "captive",
    title: "Representative held captive",
    description: "A Muster conflict lost by checkmate after the rival's representative took the nominated Pawn. Their place stands empty.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-captive-1", TAPE_REPRESENTATIVE_TAKEN_IN_DEFEAT, "b", "checkmate", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "injured",
    title: "Representative injured",
    description: "A Muster conflict won by checkmate in which the nominated Pawn was taken. They recover after one further recorded match.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-injured-1", TAPE_REPRESENTATIVE_TAKEN_IN_VICTORY, "w", "checkmate", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "recovered",
    title: "Injury healed",
    description: "The nominated Pawn is wounded in a Muster victory, another member stands in the next Muster, and the first recovers once that match is recorded.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-recovered-1", TAPE_REPRESENTATIVE_TAKEN_IN_VICTORY, "w", "checkmate", "2026-01-12T19:30:00.000Z"),
      DISMISS,
      { type: "nominate", member: 2, file: "a", at: "2026-01-13T19:00:00.000Z" },
      { type: "accept", at: "2026-01-13T19:01:00.000Z" },
      muster("fixture-recovered-2", TAPE_SCHOLARS_VICTORY, "w", "checkmate", "2026-01-13T19:20:00.000Z"),
      { type: "nominate", member: 1, file: "b", at: "2026-01-13T19:25:00.000Z" },
    ],
  },
  {
    id: "classic-capture",
    title: "Classic match capture",
    description: "The nominated Pawn is taken in a lost Classic match. The War Record notes the capture; no one is wounded or held.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      classic("fixture-classic-1", TAPE_REPRESENTATIVE_TAKEN_IN_DEFEAT, "b", "checkmate", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "returned",
    title: "Captive returned",
    description: "A representative taken in a lost Muster comes home after a later Muster victory over the captor's nation, and is nominated again.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-returned-1", TAPE_REPRESENTATIVE_TAKEN_IN_DEFEAT, "b", "checkmate", "2026-01-12T19:30:00.000Z"),
      DISMISS,
      { type: "nominate", member: 2, file: "a", at: "2026-01-13T19:00:00.000Z" },
      { type: "accept", at: "2026-01-13T19:01:00.000Z" },
      muster("fixture-returned-2", TAPE_SCHOLARS_VICTORY, "w", "checkmate", "2026-01-13T19:20:00.000Z"),
      { type: "nominate", member: 1, file: "b", at: "2026-01-13T19:25:00.000Z" },
    ],
  },
  {
    id: "drawn",
    title: "Drawn Muster, representative wounded",
    description: "The nominated Pawn is taken early and the Muster ends drawn by threefold repetition. They were exchanged under truce and are recovering.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-drawn-1", TAPE_REPRESENTATIVE_TAKEN_THEN_REPETITION, null, "threefold", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "promoted",
    title: "Battlefield promotion",
    description: "The nominated Pawn reaches the last rank and becomes a Queen before the opponent resigns. Political rank is unchanged.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "c", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-promoted-1", TAPE_PROMOTION, "w", "resignation", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "allied-loss",
    title: "Allied representative lost",
    description: "A Muster victory in which the allied Great House's Knight is taken. The Great House demands an accounting.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "g", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-allied-loss-1", TAPE_ALLY_LOST_IN_VICTORY, "w", "checkmate", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "rival-grievance",
    title: "Rival grievance",
    description: "The nominated Pawn takes the rival house's representative in a Muster victory. The rival vows an answer; nothing was lost.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "b", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-rival-grievance-1", TAPE_RIVAL_TAKEN, "w", "checkmate", "2026-01-12T19:30:00.000Z"),
    ],
  },
  {
    id: "honoured",
    title: "Honoured hall",
    description: "Five Muster victories, one with a battlefield promotion, earn recognition 10 and the second hall tier.",
    nationId: "korvenia",
    steps: [
      KORVENIA_FOUNDING,
      { type: "nominate", member: 1, file: "a", at: "2026-01-12T19:05:00.000Z" },
      { type: "accept", at: "2026-01-12T19:06:00.000Z" },
      muster("fixture-honoured-1", TAPE_SCHOLARS_VICTORY, "w", "checkmate", "2026-01-12T19:30:00.000Z"),
      DISMISS,
      { type: "accept", at: "2026-01-13T19:00:00.000Z" },
      muster("fixture-honoured-2", TAPE_FOOLS_VICTORY_AS_BLACK, "b", "checkmate", "2026-01-13T19:20:00.000Z", "b"),
      DISMISS,
      { type: "accept", at: "2026-01-14T19:00:00.000Z" },
      muster("fixture-honoured-3", TAPE_SCHOLARS_VICTORY, "w", "checkmate", "2026-01-14T19:20:00.000Z"),
      DISMISS,
      { type: "accept", at: "2026-01-15T19:00:00.000Z" },
      muster("fixture-honoured-4", TAPE_FOOLS_VICTORY_AS_BLACK, "b", "checkmate", "2026-01-15T19:20:00.000Z", "b"),
      DISMISS,
      { type: "nominate", member: 2, file: "c", at: "2026-01-16T18:55:00.000Z" },
      { type: "accept", at: "2026-01-16T19:00:00.000Z" },
      muster("fixture-honoured-5", TAPE_PROMOTION, "w", "resignation", "2026-01-16T19:30:00.000Z"),
    ],
  },
  ...(["solforiz", "aethelgard", "kwind-09"] as const).map((nationId, index): PreviewFixture => ({
    id: `founded-${nationId}`,
    title: `Newly founded banner · ${nationId === "kwind-09" ? "Kwind-09" : nationId.charAt(0).toUpperCase() + nationId.slice(1)}`,
    description: "A freshly raised minor banner with its first Pawn nominated, for staging this nation's Bannerhold.",
    nationId,
    steps: [
      { type: "found", nationId, name: FOUNDING_NAMES[nationId], seed: 2301 + index, at: "2026-01-12T19:00:00.000Z" },
      { type: "nominate", member: 1, file: "a", at: "2026-01-12T19:05:00.000Z" },
    ],
  })),
];

export const LEGACY_PREVIEW_IDS: readonly string[] = FIXTURES.map((fixture) => fixture.id);

/** Every development preview with its title and description, in presentation order. */
export function listLegacyPreviews(): LegacyPreviewListing[] {
  return FIXTURES.map((fixture) => ({ id: fixture.id, title: fixture.title, description: fixture.description, nationId: fixture.nationId }));
}

function findFixture(id: string): PreviewFixture | null {
  for (const fixture of FIXTURES) if (fixture.id === id) return fixture;
  return null;
}

interface FixtureRun {
  state: LegacyState;
  records: LegacyMatchRecord[];
}

function runFixture(fixture: PreviewFixture): FixtureRun {
  let state = createLegacyState({ mode: "preview", previewId: fixture.id, at: "2026-01-12T18:59:00.000Z" });
  const records: LegacyMatchRecord[] = [];
  for (const step of fixture.steps) {
    let transition: LegacyTransition;
    if (step.type === "found") {
      transition = reduceLegacy(state, { type: "found-banner", name: step.name, nationId: step.nationId, heraldry: defaultHeraldry(step.nationId), motto: null, at: step.at, seed: step.seed });
    } else if (step.type === "nominate") {
      transition = reduceLegacy(state, { type: "nominate", memberId: `member-${step.member}`, file: step.file, at: step.at });
    } else if (step.type === "accept") {
      const challenge = openChallenge(state);
      if (!challenge) throw new Error(`Fixture ${fixture.id} has no open challenge to accept.`);
      transition = reduceLegacy(state, { type: "accept-challenge", noticeId: challenge.id, at: step.at });
    } else if (step.type === "dismiss") {
      transition = reduceLegacy(state, { type: "dismiss-aftermath" });
    } else {
      const record = buildFixtureRecord(state, step);
      records.push(record);
      transition = reduceLegacy(state, { type: "record-match", record });
    }
    if (transition.error) throw new Error(`Fixture ${fixture.id} step ${step.type} was refused: ${transition.error}`);
    state = transition.state;
  }
  return { state, records };
}

function buildFixtureRecord(state: LegacyState, step: FixtureMatch): LegacyMatchRecord {
  if (!state.banner) throw new Error("Fixture match before founding.");
  const opponentNationId = step.opponentNationId ?? getRivalHouse(state.banner.nationId).nationId;
  const { formation, allegiance } = createMusterFormation(state, { playerSide: step.playerSide, opponentNationId });
  const challenge = step.stakes === "muster" ? openChallenge(state) : null;
  return {
    matchId: step.matchId,
    stakes: step.stakes,
    challengeId: challenge ? challenge.id : null,
    playerSide: step.playerSide,
    opponentNationId,
    formation,
    allegiance,
    moves: identityRecordsFromTape(formation, step.tape),
    result: { winner: step.winner, reason: step.reason },
    completedAt: step.at,
    source: "fixture",
  };
}

/** The preview state for a fixture id (mode "preview"), or null for an unknown id. */
export function buildLegacyPreview(id: string): LegacyState | null {
  const fixture = findFixture(id);
  return fixture ? runFixture(fixture).state : null;
}

/** The fixture match records a preview was built from, for verification against the real engine. */
export function getLegacyPreviewRecords(id: string): LegacyMatchRecord[] {
  const fixture = findFixture(id);
  return fixture ? runFixture(fixture).records : [];
}

/** The coordinate tapes behind a preview's records, aligned with getLegacyPreviewRecords. */
export function getLegacyPreviewTapes(id: string): string[][] {
  const fixture = findFixture(id);
  if (!fixture) return [];
  const out: string[][] = [];
  for (const step of fixture.steps) if (step.type === "match") out.push(step.tape.slice());
  return out;
}
