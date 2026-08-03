import type { MoveEvent } from "../core/types";
import type { BattleIdentityMap, IdentityMoveRecord } from "./types";

/**
 * Render-independent identity layer for a single battle. chess.js remains the
 * authority for legal squares; this tracker only answers who occupies them.
 */
export class BattleIdentityTracker {
  private map: BattleIdentityMap;
  private records: IdentityMoveRecord[];
  private history: BattleIdentityMap[] = [];

  constructor(initial: BattleIdentityMap, records: IdentityMoveRecord[] = []) {
    this.map = { ...initial };
    this.records = records.map((record) => ({ ...record }));
  }

  getSnapshot(): BattleIdentityMap {
    return { ...this.map };
  }

  getRecords(): IdentityMoveRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  characterAt(square: string): string | null {
    return this.map[square] ?? null;
  }

  apply(event: MoveEvent): IdentityMoveRecord {
    const actorId = this.map[event.from];
    if (!actorId) throw new Error(`Identity map has no character on ${event.from}.`);

    this.history.push({ ...this.map });
    const capturedCharacterId = event.capture ? (this.map[event.capture.square] ?? null) : null;
    const rookCharacterId = event.rook ? (this.map[event.rook.from] ?? null) : null;

    if (event.capture) delete this.map[event.capture.square];
    delete this.map[event.from];
    this.map[event.to] = actorId;

    if (event.rook && rookCharacterId) {
      delete this.map[event.rook.from];
      this.map[event.rook.to] = rookCharacterId;
    }

    const record: IdentityMoveRecord = {
      ply: this.records.length,
      actorId,
      from: event.from,
      to: event.to,
      capturedCharacterId,
      capturedSquare: event.capture?.square ?? null,
      rookCharacterId,
      promotion: event.promotion,
    };
    this.records.push(record);
    return { ...record };
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.map = previous;
    this.records.pop();
    return true;
  }
}
