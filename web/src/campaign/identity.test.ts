import type { MoveEvent } from "../core/types";
import { BattleIdentityTracker } from "./identity";

function move(overrides: Partial<MoveEvent> = {}): MoveEvent {
  return {
    color: "w",
    kind: "p",
    from: "e2",
    to: "e4",
    san: "e4",
    capture: null,
    rook: null,
    promotion: null,
    isCheck: false,
    isGameOver: false,
    ...overrides,
  };
}

describe("BattleIdentityTracker", () => {
  it("moves the same named character and removes the captured identity", () => {
    const tracker = new BattleIdentityTracker({ e5: "cael", d6: "varro-outrider" });
    const record = tracker.apply(
      move({ from: "e5", to: "d6", san: "exd6", capture: { square: "d6", kind: "n", color: "b" } }),
    );

    expect(record.actorId).toBe("cael");
    expect(record.capturedCharacterId).toBe("varro-outrider");
    expect(tracker.getSnapshot()).toEqual({ d6: "cael" });
  });

  it("removes the en passant victim from its real square", () => {
    const tracker = new BattleIdentityTracker({ e5: "cael", d5: "enemy-pawn" });
    tracker.apply(
      move({ from: "e5", to: "d6", san: "exd6", capture: { square: "d5", kind: "p", color: "b" } }),
    );
    expect(tracker.getSnapshot()).toEqual({ d6: "cael" });
  });

  it("moves the king and rook identities during castling", () => {
    const tracker = new BattleIdentityTracker({ e1: "aldric", h1: "garran" });
    tracker.apply(move({ kind: "k", from: "e1", to: "g1", san: "O-O", rook: { from: "h1", to: "f1" } }));
    expect(tracker.getSnapshot()).toEqual({ g1: "aldric", f1: "garran" });
  });

  it("preserves identity through promotion and supports rollback", () => {
    const tracker = new BattleIdentityTracker({ e7: "cael" });
    tracker.apply(move({ from: "e7", to: "e8", san: "e8=Q", promotion: "q" }));
    expect(tracker.characterAt("e8")).toBe("cael");
    expect(tracker.getRecords()[0].promotion).toBe("q");
    expect(tracker.undo()).toBe(true);
    expect(tracker.getSnapshot()).toEqual({ e7: "cael" });
  });
});
