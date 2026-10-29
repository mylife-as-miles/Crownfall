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
import { presentBannerhold, representativeCondition } from "../../../shared/legacy/domain/presentation";
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

/** An independent tracker fed from the same events, to prove the bridge returns the tracker's records unchanged. */
function witnessFor(game: GameController, setup: MusterMatchSetup): BattleIdentityTracker {
  const witness = new BattleIdentityTracker({ ...setup.formation });
  game.on("move", (event: MoveEvent) => void witness.apply(event));
  return witness;
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

  // Special moves through the real engine: chess.js decides legality, the unchanged tracker records
  // identities, and validateMatchRecord's en passant (capturedSquare) and castling (rook) branches accept them.
  it("records castling on both wings, en passant and a capturing under-promotion by a levy pawn, and reduceLegacy accepts the game", async () => {
    let state = apply(createLegacyState({ at: AT }), {
      type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), at: AT, seed: 9,
    });
    state = apply(state, { type: "nominate", memberId: "member-1", file: "a", at: AT });
    const { formation, allegiance } = createMusterFormation(state, { playerSide: "w", opponentNationId: "aethelgard" });
    const setup: MusterMatchSetup = { matchId: "engine-special-1", stakes: "classic", challengeId: null, playerSide: "w", opponentNationId: "aethelgard", formation, allegiance };
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setup, clock);
    const witness = witnessFor(game, setup);
    // 1.e4 d5 2.e5 f5 3.exf6 e.p. Nc6 4.Nf3 Be6 5.Be2 Qd7 6.O-O O-O-O 7.fxg7 Kb8 8.gxh8=N a6, then White resigns.
    await playTape(game, ["e2e4", "d7d5", "e4e5", "f7f5", "e5f6", "b8c6", "g1f3", "c8e6", "f1e2", "d8d7", "e1g1", "e8c8", "f6g7", "c8b8", "g7h8n", "a7a6"]);
    game.resign();
    const record = await recorder.whenComplete();

    expect(record.result).toEqual({ winner: "b", reason: "resignation" });
    expect(record.moves.map(({ san: _san, ...rest }) => rest)).toEqual(witness.getRecords());
    expect(record.moves.map((move) => move.san)).toEqual(game.getSnapshot().sanList);
    // The e-pawn belongs to the allied Great House's guard (a claimed file), not to the house.
    expect(allegiance["levy:korvenia:e2"].houseId).toBe("house-ombreval");
    expect(record.moves[4]).toMatchObject({ actorId: "levy:korvenia:e2", from: "e5", to: "f6", capturedCharacterId: "levy:aethelgard:f7", capturedSquare: "f5", san: "exf6" });
    expect(record.moves[10]).toMatchObject({ actorId: "crown:korvenia:e1", from: "e1", to: "g1", rookCharacterId: "levy:korvenia:h1", capturedCharacterId: null, san: "O-O" });
    expect(record.moves[11]).toMatchObject({ actorId: "crown:aethelgard:e8", from: "e8", to: "c8", rookCharacterId: "levy:aethelgard:a8", capturedCharacterId: null, san: "O-O-O" });
    expect(record.moves[14]).toMatchObject({ actorId: "levy:korvenia:e2", from: "g7", to: "h8", capturedCharacterId: "levy:aethelgard:h8", capturedSquare: "h8", promotion: "n", san: "gxh8=N" });

    const transition = reduceLegacy(state, { type: "record-match", record });
    expect(transition.error).toBeNull();
    expect(transition.state.matches[0]).toMatchObject({ stakes: "classic", outcome: "defeat", plies: 16, representativeFate: "survived", representativeCaptures: 0 });
    expect(transition.state.chronicle.slice(state.chronicle.length).map((entry) => entry.kind)).toEqual(["match"]);
    game.dispose();
  });

  it("records the nominated pawn capturing en passant and promoting by capture in a real Muster victory with castling on both wings", async () => {
    const state = readyBanner("g");
    const setup = setupFor(state, "engine-special-2");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setup, clock);
    const witness = witnessFor(game, setup);
    // 1.g4 d5 2.g5 h5 3.gxh6 e.p. Nc6 4.Nf3 Be6 5.Bg2 Qd7 6.O-O O-O-O 7.hxg7 Kb8 8.gxh8=N, then Black resigns.
    await playTape(game, ["g2g4", "d7d5", "g4g5", "h7h5", "g5h6", "b8c6", "g1f3", "c8e6", "f1g2", "d8d7", "e1g1", "e8c8", "h6g7", "c8b8", "g7h8n"]);
    game.resign();
    const record = await recorder.whenComplete();

    expect(record.result).toEqual({ winner: "w", reason: "resignation" });
    expect(record.moves.map(({ san: _san, ...rest }) => rest)).toEqual(witness.getRecords());
    expect(record.moves[4]).toMatchObject({ actorId: "player:member-1", from: "g5", to: "h6", capturedCharacterId: "levy:solforiz:h7", capturedSquare: "h5", san: "gxh6" });
    expect(record.moves[10]).toMatchObject({ actorId: "crown:korvenia:e1", to: "g1", rookCharacterId: "levy:korvenia:h1", san: "O-O" });
    expect(record.moves[11]).toMatchObject({ actorId: "crown:solforiz:e8", to: "c8", rookCharacterId: "levy:solforiz:a8", san: "O-O-O" });
    expect(record.moves[12]).toMatchObject({ actorId: "player:member-1", from: "h6", to: "g7", capturedCharacterId: "levy:solforiz:g7", capturedSquare: "g7" });
    expect(record.moves[14]).toMatchObject({ actorId: "player:member-1", from: "g7", to: "h8", capturedCharacterId: "levy:solforiz:h8", promotion: "n", san: "gxh8=N" });

    const after = apply(state, { type: "record-match", record });
    expect(after.matches[0]).toMatchObject({ stakes: "muster", outcome: "victory", representativeFate: "promoted", representativeCaptures: 3, representativeFile: "g" });
    expect(after.members[0]).toMatchObject({ status: "available", captures: 3, musters: 1, battlefieldPromotions: [{ matchId: "engine-special-2", to: "n" }] });
    expect(after.standing).toEqual({ rank: "minor-banner", recognition: 2, representation: 1 });
    const newEntries = after.chronicle.slice(state.chronicle.length);
    expect(newEntries.map((entry) => entry.kind)).toEqual(["match", "promotion", "capture"]);
    expect(newEntries[1].body).toBe(`${after.members[0].name} reached the last rank and rose to Knight. Political standing is unchanged.`);
    expect(prominentAftermath(after).map((entry) => entry.kind)).toEqual(["promotion", "match"]);
    const representative = presentBannerhold(after).representative;
    expect(representative?.promotedTo).toBe("n");
    expect(representative && representativeCondition(representative)).toBe("promoted");
    game.dispose();
  });

  it("records the nominated pawn taken en passant by the rival's representative, and a real Muster defeat holds them captive", async () => {
    const state = readyBanner("b");
    const setup = setupFor(state, "engine-special-3");
    const game = startHotseat();
    const recorder = createMusterRecorder(game, setup, clock);
    // 1.e4 c5 2.e5 c4 3.b4 cxb3 e.p., then White resigns.
    await playTape(game, ["e2e4", "c7c5", "e4e5", "c5c4", "b2b4", "c4b3"]);
    game.resign();
    const record = await recorder.whenComplete();

    expect(record.result).toEqual({ winner: "b", reason: "resignation" });
    expect(record.moves[5]).toMatchObject({ actorId: `rival:${rival.id}`, from: "c4", to: "b3", capturedCharacterId: "player:member-1", capturedSquare: "b4", san: "cxb3" });
    const after = apply(state, { type: "record-match", record });
    expect(after.matches[0]).toMatchObject({ outcome: "defeat", representativeFate: "captured", representativeCapturedBy: rival.id });
    expect(after.members[0]).toMatchObject({ status: "captive", captiveOf: rival.id, timesCaptured: 1 });
    expect(prominentAftermath(after).map((entry) => entry.kind)).toEqual(["captivity", "match"]);
    game.dispose();
  });
});
