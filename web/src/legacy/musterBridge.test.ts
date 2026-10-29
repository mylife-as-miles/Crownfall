import { GameController } from "../core/gameController";
import { BattleIdentityTracker } from "../campaign/identity";
import type { MoveEvent, PieceKind } from "../core/types";
import { createMusterRecorder } from "./musterBridge";
import type { MusterMatchSetup } from "./musterBridge";
import { defaultHeraldry } from "../../../shared/legacy/content/heraldry";
import { getRivalHouse } from "../../../shared/legacy/content/houses";
import { prominentAftermath } from "../../../shared/legacy/domain/aftermath";
import { createMusterFormation } from "../../../shared/legacy/domain/formation";
import { openChallenge } from "../../../shared/legacy/domain/notices";
import { presentBannerhold } from "../../../shared/legacy/domain/presentation";
import { reduceLegacy } from "../../../shared/legacy/domain/reducer";
import { createLegacyState } from "../../../shared/legacy/domain/state";
import type { FileLetter, LegacyEvent, LegacyState } from "../../../shared/legacy/types";

const AT = "2026-03-01T12:00:00.000Z";
const rival = getRivalHouse("korvenia");
const clock = { now: () => "2026-03-01T12:30:00.000Z" };

function apply(state: LegacyState, event: LegacyEvent): LegacyState {
  const transition = reduceLegacy(state, event);
  expect(transition.error).toBeNull();
  return transition.state;
}

/** A Korvenian banner with member-1 nominated on `file` and the rival's challenge accepted. */
function readyBanner(file: FileLetter): LegacyState {
  let state = apply(createLegacyState({ at: AT }), {
    type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), at: AT, seed: 5,
  });
  state = apply(state, { type: "nominate", memberId: "member-1", file, at: AT });
  const challenge = openChallenge(state);
  expect(challenge).not.toBeNull();
  return apply(state, { type: "accept-challenge", noticeId: challenge?.id ?? "", at: AT });
}

function setupFor(state: LegacyState, matchId: string): MusterMatchSetup {
  const { formation, allegiance, representativeIdentityId } = createMusterFormation(state, { playerSide: "w", opponentNationId: rival.nationId });
  expect(representativeIdentityId).toBe("player:member-1");
  return { matchId, stakes: "muster", challengeId: openChallenge(state)?.id ?? null, playerSide: "w", opponentNationId: rival.nationId, formation, allegiance };
}

function startHotseat(): GameController {
  const game = new GameController();
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
  return game;
}

async function playTape(game: GameController, tape: readonly string[]): Promise<void> {
  for (const move of tape) {
    const promotion = move.length > 4 ? (move.charAt(4) as PieceKind) : undefined;
    expect(await game.tryMove(move.slice(0, 2), move.slice(2, 4), promotion), move).toBe(true);
  }
}

describe("Muster engine bridge", () => {
  it("records a real hotseat Muster game in which the representative pawn is captured, and reduceLegacy holds them captive", async () => {
    const state = readyBanner("b");
    const setup = setupFor(state, "engine-muster-1");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setup, clock);
    // Independent tracker fed from the same events, to prove the bridge returns its records unchanged.
    const witness = new BattleIdentityTracker({ ...setup.formation });
    game.on("move", (event: MoveEvent) => void witness.apply(event));

    // 1.b4 c5 2.f3 cxb4 3.g4 e5 4.a3 Qh4# — the rival's c-pawn takes the nominated b-pawn.
    await playTape(game, ["b2b4", "c7c5", "f2f3", "c5b4", "g2g4", "e7e5", "a2a3", "d8h4"]);
    const record = await recorder.whenComplete();

    expect(game.getSnapshot().result).toEqual({ winner: "b", reason: "checkmate" });
    expect(recorder.status()).toBe("complete");
    expect(record.source).toBe("engine");
    expect(record.result).toEqual({ winner: "b", reason: "checkmate" });
    expect(record.completedAt).toBe("2026-03-01T12:30:00.000Z");
    expect(record.moves.map((move) => move.san)).toEqual(game.getSnapshot().sanList);
    expect(record.moves.map(({ san: _san, ...rest }) => rest)).toEqual(witness.getRecords());
    expect(record.moves[3]).toMatchObject({ actorId: `rival:${rival.id}`, capturedCharacterId: "player:member-1", capturedSquare: "b4" });

    const after = apply(state, { type: "record-match", record });
    const member = after.members.find((candidate) => candidate.id === "member-1");
    expect(member?.status).toBe("captive");
    expect(member?.captiveOf).toBe(rival.id);
    expect(after.matches[0]).toMatchObject({ outcome: "defeat", representativeFate: "captured", representativeCapturedBy: rival.id, plies: 8 });
    const newEntries = after.chronicle.slice(state.chronicle.length);
    expect(newEntries.map((entry) => entry.kind)).toEqual(["match", "captivity"]);
    expect(newEntries[0].title).toBe("Muster conflict against Solforiz: Defeat");
    expect(after.notices.filter((notice) => notice.status !== "resolved").map((notice) => notice.kind)).toEqual(
      expect.arrayContaining(["captivity-notice", "rival-challenge"]),
    );
    expect(after.unresolved.map((matter) => matter.kind)).toEqual(["captive", "challenge"]);
    expect(prominentAftermath(after).map((entry) => entry.kind)).toEqual(["captivity", "match"]);
    const scene = presentBannerhold(after);
    expect(scene.representative?.status).toBe("captive");
    expect(scene.representative?.captorName).toBe(rival.name);
    expect(scene.rivalHouse?.holdsCaptive).toBe(true);

    // Submitting the same record again changes nothing.
    expect(reduceLegacy(after, { type: "record-match", record }).state).toBe(after);
    game.dispose();
  });

  it("records a real victory in which the representative is taken, leaving them injured", async () => {
    const state = readyBanner("b");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setupFor(state, "engine-muster-2"), clock);
    // 1.e4 e5 2.b4 Bxb4 3.Bc4 Nc6 4.Qh5 Nf6 5.Qxf7#
    await playTape(game, ["e2e4", "e7e5", "b2b4", "f8b4", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]);
    const record = await recorder.whenComplete();
    expect(record.result).toEqual({ winner: "w", reason: "checkmate" });
    const after = apply(state, { type: "record-match", record });
    expect(after.members[0].status).toBe("injured");
    expect(after.standing.recognition).toBe(2);
    expect(after.chronicle.slice(state.chronicle.length).map((entry) => entry.kind)).toEqual(["match", "injury"]);
    game.dispose();
  });

  it("records a real Classic match ended by resignation, with no lasting consequences", async () => {
    let state = apply(createLegacyState({ at: AT }), {
      type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), at: AT, seed: 5,
    });
    state = apply(state, { type: "nominate", memberId: "member-1", file: "b", at: AT });
    const { formation, allegiance } = createMusterFormation(state, { playerSide: "w", opponentNationId: "aethelgard" });
    const game = startHotseat();
    const recorder = createMusterRecorder(game, {
      matchId: "engine-classic-1", stakes: "classic", challengeId: null, playerSide: "w", opponentNationId: "aethelgard", formation, allegiance,
    }, clock);
    // 1.b4 a5 2.bxa5, then Black resigns: the nominated pawn makes a capture.
    await playTape(game, ["b2b4", "a7a5", "b4a5"]);
    game.resign();
    const record = await recorder.whenComplete();
    expect(record.result).toEqual({ winner: "w", reason: "resignation" });
    expect(record.moves[2]).toMatchObject({ actorId: "player:member-1", capturedCharacterId: "levy:aethelgard:a7", san: "bxa5" });
    const after = apply(state, { type: "record-match", record });
    expect(after.matches[0]).toMatchObject({ stakes: "classic", outcome: "victory", representativeFate: "survived", representativeCaptures: 1 });
    expect(after.members[0]).toMatchObject({ status: "available", captures: 1, musters: 0 });
    expect(after.standing.recognition).toBe(0);
    expect(after.relations).toEqual(state.relations);
    expect(after.notices).toEqual(state.notices);
    expect(after.chronicle.slice(state.chronicle.length).map((entry) => entry.kind)).toEqual(["match", "capture"]);
    game.dispose();
  });

  it("follows hotseat undo so identities stay in step with the board", async () => {
    const state = readyBanner("b");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setupFor(state, "engine-undo"), clock);
    await playTape(game, ["b2b4", "c7c5"]);
    expect(game.undo()).toBe(true);
    expect(recorder.moves()).toHaveLength(1);
    await playTape(game, ["e7e5"]);
    expect(recorder.moves().map((move) => [move.actorId, move.to, move.san])).toEqual([
      ["player:member-1", "b4", "b4"],
      ["levy:solforiz:e7", "e5", "e5"],
    ]);
    recorder.dispose();
    expect(recorder.status()).toBe("aborted");
    await expect(recorder.whenComplete()).rejects.toThrow(/disposed/);
    game.dispose();
  });

  it("aborts when the board restarts and refuses non-standard starting positions", async () => {
    const state = readyBanner("b");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setupFor(state, "engine-restart"), clock);
    await playTape(game, ["b2b4"]);
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    expect(recorder.status()).toBe("aborted");
    await expect(recorder.whenComplete()).rejects.toThrow(/restarted/);

    const custom = new GameController();
    custom.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, startingFen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1" });
    expect(() => createMusterRecorder(custom, setupFor(state, "engine-custom"), clock)).toThrow(/standard starting position/);
    game.dispose();
    custom.dispose();
  });
});
