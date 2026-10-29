import { BattleIdentityTracker } from "../campaign/identity";
import type { GameController } from "../core/gameController";
import type { GameResult, GameSnapshot, MoveEvent } from "../core/types";
import { STANDARD_START_FEN } from "../../../shared/legacy/domain/formation";
import type {
  ChessSide,
  IdentityAllegiance,
  LegacyMatchRecord,
  LegacyMoveRecord,
  MatchStakes,
  NationId,
  SquareId,
} from "../../../shared/legacy/types";

/**
 * Engine bridge for My Legacy. Listens to a GameController playing a Muster or
 * Classic match from the standard position, feeds every move to the existing
 * BattleIdentityTracker (chess.js stays the authority for legality) and yields
 * a finalised LegacyMatchRecord for reduceLegacy. It never alters chess rules.
 */

/** What the bridge needs from the controller; GameController satisfies it. */
export type MusterGameSource = Pick<GameController, "on" | "getSnapshot">;

export interface MusterMatchSetup {
  /** Unique per match; reduceLegacy is idempotent by this id. */
  matchId: string;
  stakes: MatchStakes;
  /** The accepted Muster challenge notice id, or null for a Classic match. */
  challengeId: string | null;
  playerSide: ChessSide;
  opponentNationId: NationId;
  /** From createMusterFormation(state, { playerSide, opponentNationId }). */
  formation: Readonly<Record<SquareId, string>>;
  allegiance: Readonly<Record<string, IdentityAllegiance>>;
}

/** Supplies the completion timestamp; the shared domain never reads the clock itself. */
export interface MusterClock {
  now(): string;
}

export type MusterRecorderStatus = "recording" | "complete" | "aborted" | "failed";

export interface MusterRecorder {
  readonly matchId: string;
  status(): MusterRecorderStatus;
  /** Identity move records so far, exactly as BattleIdentityTracker produced them, plus SAN. */
  moves(): LegacyMoveRecord[];
  /** The finalised record after game over, otherwise null. */
  record(): LegacyMatchRecord | null;
  /** Why recording stopped without a record (aborted or failed), otherwise null. */
  error(): string | null;
  /** Resolves at game over; rejects if the game restarts, tracking fails or the recorder is disposed first. */
  whenComplete(): Promise<LegacyMatchRecord>;
  /** Stops listening. Safe to call more than once. */
  dispose(): void;
}

function isStandardStart(snapshot: GameSnapshot): boolean {
  return snapshot.moves.length === 0 && (snapshot.status === "idle" || snapshot.fen === STANDARD_START_FEN);
}

/**
 * Starts recording. Create it right after `game.start(...)` from the standard
 * position (no `startingFen`) and before the first move, or before `start`.
 * Muster screens should not offer undo; if a mode does, the recorder rolls the
 * tracker back in step with the board until the game ends.
 */
export function createMusterRecorder(game: MusterGameSource, setup: MusterMatchSetup, clock: MusterClock): MusterRecorder {
  if (!isStandardStart(game.getSnapshot())) {
    throw new Error("A Legacy match must be recorded from the standard starting position before its first move.");
  }
  const tracker = new BattleIdentityTracker({ ...setup.formation });
  const sanByPly: string[] = [];
  // Kept locally so clock ticks (a state event every 100 ms) never copy the tracker's records.
  let recordedPlies = 0;
  let status: MusterRecorderStatus = "recording";
  let finalRecord: LegacyMatchRecord | null = null;
  let failure: string | null = null;
  let resolve: (record: LegacyMatchRecord) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const completion = new Promise<LegacyMatchRecord>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // Callers may never await; keep an unobserved rejection from surfacing as an unhandled error.
  completion.catch(() => undefined);

  const currentMoves = (): LegacyMoveRecord[] =>
    tracker.getRecords().map((record) => ({ ...record, san: sanByPly[record.ply] }));

  const stop = (next: "aborted" | "failed", reason: string): void => {
    if (status !== "recording") return;
    status = next;
    failure = reason;
    unsubscribe();
    reject(new Error(reason));
  };

  const onMove = (event: MoveEvent): void => {
    if (status !== "recording") return;
    try {
      const record = tracker.apply(event);
      sanByPly[record.ply] = event.san;
      recordedPlies = record.ply + 1;
    } catch (error) {
      stop("failed", `Identity tracking failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onGameOver = (result: GameResult): void => {
    if (status !== "recording") return;
    if (recordedPlies !== game.getSnapshot().moves.length) {
      stop("failed", "The identity record fell out of step with the board.");
      return;
    }
    status = "complete";
    finalRecord = {
      matchId: setup.matchId,
      stakes: setup.stakes,
      challengeId: setup.challengeId,
      playerSide: setup.playerSide,
      opponentNationId: setup.opponentNationId,
      formation: { ...setup.formation },
      allegiance: { ...setup.allegiance },
      moves: currentMoves(),
      result: { winner: result.winner, reason: result.reason },
      completedAt: clock.now(),
      source: "engine",
    };
    unsubscribe();
    resolve(finalRecord);
  };

  const onState = (snapshot: GameSnapshot): void => {
    if (status !== "recording") return;
    // Undo removes plies from the board without a move event; follow it.
    while (recordedPlies > snapshot.moves.length && tracker.undo()) {
      recordedPlies -= 1;
      sanByPly.length = recordedPlies;
    }
  };

  const onReset = (options: { startingFen?: string }): void => {
    if (status !== "recording") return;
    if (recordedPlies > 0) {
      stop("aborted", "The board was restarted before the match ended.");
    } else if (options.startingFen) {
      stop("failed", "A Legacy match must start from the standard position.");
    }
  };

  const unsubscribers = [game.on("move", onMove), game.on("gameover", onGameOver), game.on("state", onState), game.on("reset", onReset)];
  function unsubscribe(): void {
    for (const off of unsubscribers.splice(0)) off();
  }

  return {
    matchId: setup.matchId,
    status: () => status,
    moves: currentMoves,
    record: () => finalRecord,
    error: () => failure,
    whenComplete: () => completion,
    dispose: () => {
      if (status === "recording") stop("aborted", "The recorder was disposed before the match ended.");
      unsubscribe();
    },
  };
}
