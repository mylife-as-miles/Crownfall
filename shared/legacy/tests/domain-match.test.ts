import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { MAX_PROMINENT_AFTERMATH, prominentAftermath, selectAftermath } from "../domain/aftermath";
import { identityRecordsFromTape } from "../domain/fixtures";
import { createMusterFormation, musterReadiness } from "../domain/formation";
import { openChallenge } from "../domain/notices";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { ChessSide, ChronicleEntry, FileLetter, LegacyMatchRecord, LegacyState, MatchEndReason, MatchStakes } from "../types";

const AT = "2026-02-01T10:00:00.000Z";
const ally = getAlliedHouse("korvenia");
const rival = getRivalHouse("korvenia");

// Legal games from the standard position. The same tapes back the preview fixtures, which
// web/src/legacy/fixtures.test.ts replays through GameController (chess.js) and BattleIdentityTracker.
const REP_B_TAKEN_IN_DEFEAT = ["b2b4", "c7c5", "f2f3", "c5b4", "g2g4", "e7e5", "a2a3", "d8h4"];
const REP_B_TAKEN_IN_VICTORY = ["e2e4", "e7e5", "b2b4", "f8b4", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const SCHOLARS = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const PROMOTION_C = ["c2c4", "b7b5", "c4b5", "a7a6", "b5a6", "c8b7", "a6b7", "b8c6", "b7a8q"];
const ALLY_LOST = ["e2e4", "e7e5", "b1c3", "f8b4", "f1c4", "b4c3", "d1h5", "d7d6", "h5f7"];
const RIVAL_TAKEN = ["b2b4", "c7c5", "b4c5", "e7e5", "e2e4", "b8c6", "f1c4", "a7a6", "d1f3", "h7h6", "f3f7"];
const REP_B_TAKEN_THEN_REPETITION = ["b2b4", "c7c5", "g1f3", "c5b4", "f3g1", "b8c6", "g1f3", "c6b8", "f3g1", "b8c6", "g1f3", "c6b8"];

function apply(state: LegacyState, ...events: Parameters<typeof reduceLegacy>[1][]): LegacyState {
  let current = state;
  for (const event of events) {
    const transition = reduceLegacy(current, event);
    assert.equal(transition.error, null, `${event.type} refused: ${transition.error}`);
    current = transition.state;
  }
  return current;
}

function founded(file: FileLetter = "b", mode: "production" | "preview" = "production"): LegacyState {
  const base = createLegacyState({ at: AT, mode, previewId: mode === "preview" ? "test" : null });
  return apply(base,
    { type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), at: AT, seed: 7 },
    { type: "nominate", memberId: "member-1", file, at: AT });
}

function accept(state: LegacyState): LegacyState {
  const challenge = openChallenge(state);
  assert.ok(challenge, "an open challenge exists");
  return apply(state, { type: "accept-challenge", noticeId: challenge.id, at: AT });
}

interface RecordOptions {
  matchId: string;
  tape: readonly string[];
  winner: ChessSide | null;
  reason: MatchEndReason;
  stakes?: MatchStakes;
  side?: ChessSide;
  source?: "engine" | "fixture";
}

/** Simulates the engine bridge's output for a tape played from createMusterFormation. */
function record(state: LegacyState, options: RecordOptions): LegacyMatchRecord {
  const stakes = options.stakes ?? "muster";
  const side = options.side ?? "w";
  const { formation, allegiance } = createMusterFormation(state, { playerSide: side, opponentNationId: rival.nationId });
  const challenge = stakes === "muster" ? openChallenge(state) : null;
  return {
    matchId: options.matchId,
    stakes,
    challengeId: challenge ? challenge.id : null,
    playerSide: side,
    opponentNationId: rival.nationId,
    formation,
    allegiance,
    moves: identityRecordsFromTape(formation, options.tape),
    result: { winner: options.winner, reason: options.reason },
    completedAt: "2026-02-01T11:00:00.000Z",
    source: options.source ?? "engine",
  };
}

function play(state: LegacyState, options: RecordOptions): LegacyState {
  const ready = (options.stakes ?? "muster") === "muster" ? accept(state) : state;
  return apply(ready, { type: "record-match", record: record(ready, options) });
}

function kinds(entries: readonly ChronicleEntry[]): string[] {
  return entries.map((entry) => entry.kind);
}

test("a Classic match records the capture without lasting harm or politics", () => {
  const before = founded();
  const after = play(before, { matchId: "c1", stakes: "classic", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
  const member = after.members[0];
  assert.equal(member.status, "available");
  assert.equal(member.captiveOf, null);
  assert.equal(member.timesCaptured, 1);
  assert.equal(member.musters, 0);
  assert.deepEqual(kinds(after.chronicle.slice(before.chronicle.length)), ["match", "capture"]);
  // The yield is prominent, so the aftermath itself shows that nobody was harmed.
  assert.equal(after.chronicle[after.chronicle.length - 1].prominence, "major");
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["capture", "match"]);
  assert.deepEqual(after.relations, before.relations);
  assert.equal(after.standing.recognition, 0);
  assert.equal(after.notices.length, before.notices.length, "no new notices");
  assert.deepEqual(after.unresolved, before.unresolved);
  assert.equal(after.matches[0].representativeFate, "captured");
  assert.equal(after.matches[0].outcome, "defeat");
  const capture = after.chronicle[after.chronicle.length - 1];
  assert.equal(capture.title, `${member.name} yielded on b4`);
  // Black's c-pawn is the rival house's representative.
  assert.equal(capture.body, `Taken in a Classic match by ${rival.representative.name}. ${member.name} laid down arms and left the board unharmed.`);
  // Captures the representative makes stay a minor tally, in Classic matches and Musters alike.
  const scored = play(founded(), { matchId: "c2", stakes: "classic", tape: RIVAL_TAKEN, winner: "w", reason: "checkmate" });
  const tally = scored.chronicle[scored.chronicle.length - 1];
  assert.deepEqual([tally.kind, tally.prominence], ["capture", "minor"]);
  assert.deepEqual(prominentAftermath(scored).map((e) => e.kind), ["match"]);
});

test("Muster defeat with the representative taken: captive of the capturing house, notice and unresolved matter", () => {
  const after = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
  const member = after.members[0];
  assert.equal(member.status, "captive");
  assert.equal(member.captiveOf, rival.id, "taken by the rival house's representative pawn");
  assert.equal(member.musters, 1);
  assert.equal(after.nomination.memberId, "member-1", "the empty place still belongs to the nominee");
  assert.deepEqual(kinds(after.chronicle.slice(3)), ["match", "captivity"]);
  const captivity = after.notices.find((n) => n.kind === "captivity-notice");
  assert.ok(captivity && captivity.fromHouseId === rival.id && captivity.wager === null);
  assert.deepEqual(after.unresolved.map((m) => [m.kind, m.memberId]), [["captive", "member-1"], ["challenge", null]]);
  assert.equal(after.relations[0].disposition, -30, "defeat costs allied favour");
  assert.equal(after.relations[1].memory.length, 2, "the rival remembers the battle and the captive");
  assert.equal(after.notices.filter((n) => n.kind === "rival-challenge" && n.status === "resolved").length, 1);
  const next = openChallenge(after);
  assert.ok(next && next.status === "unread" && /remains in Solforiz's keeping/.test(next.body));
  assert.equal(after.matches[0].representativeCapturedBy, rival.id);
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["captivity", "match"]);
  assert.match(reduceLegacy(after, { type: "nominate", memberId: "member-1", file: "b", at: AT }).error ?? "", /captive/);
});

test("Muster victory with the representative taken: injured, then recovered after one more recorded match", () => {
  const injured = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_IN_VICTORY, winner: "w", reason: "checkmate" });
  assert.equal(injured.members[0].status, "injured");
  assert.equal(injured.members[0].injuredUntilMatch, 2);
  assert.equal(injured.standing.recognition, 2);
  assert.equal(injured.relations[0].disposition, -20);
  assert.deepEqual(kinds(injured.chronicle.slice(3)), ["match", "injury"]);
  assert.match(reduceLegacy(injured, { type: "nominate", memberId: "member-1", file: "c", at: AT }).error ?? "", /recovering/);
  // An injured nominee cannot take the field; a Muster record without them is refused.
  const ready = accept(injured);
  const formation = createMusterFormation(ready, { playerSide: "w", opponentNationId: rival.nationId });
  assert.equal(formation.representativeIdentityId, null);
  assert.match(reduceLegacy(ready, { type: "record-match", record: record(ready, { matchId: "m2", tape: SCHOLARS, winner: "w", reason: "checkmate" }) }).error ?? "", /available nominated representative/);
  // A Classic match is still a recorded match, so the recovery completes.
  const recovered = play(injured, { matchId: "c2", stakes: "classic", tape: SCHOLARS, winner: "w", reason: "checkmate" });
  assert.equal(recovered.members[0].status, "available");
  assert.equal(recovered.members[0].injuredUntilMatch, null);
  assert.equal(recovered.matches[1].representativeFate, "absent");
  assert.ok(kinds(recovered.chronicle).indexOf("recovery") !== -1);
});

test("a Muster draw with the representative taken leaves them injured", () => {
  const after = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_THEN_REPETITION, winner: null, reason: "threefold" });
  assert.equal(after.matches[0].outcome, "draw");
  assert.equal(after.members[0].status, "injured");
  assert.equal(after.standing.recognition, 0);
  assert.equal(after.relations[0].disposition, -25, "a draw moves no allied favour");
  assert.match(after.chronicle.find((e) => e.kind === "injury")?.body ?? "", /exchanged under truce/);
});

test("battlefield promotion is recorded without changing political rank", () => {
  const after = play(founded("c"), { matchId: "m1", tape: PROMOTION_C, winner: "w", reason: "resignation" });
  const member = after.members[0];
  assert.equal(after.matches[0].representativeFate, "promoted");
  assert.deepEqual(member.battlefieldPromotions, [{ matchId: "m1", to: "q" }]);
  assert.equal(member.captures, 4);
  assert.equal(member.status, "available");
  assert.equal(after.standing.rank, "minor-banner");
  assert.deepEqual(kinds(after.chronicle.slice(3)), ["match", "promotion", "capture"]);
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["promotion", "match"]);
});

test("promotion then capture keeps both facts and applies the Muster fate", () => {
  const tape = PROMOTION_C.concat(["d8a8"]); // ...Qxa8 takes the new Queen.
  const after = play(founded("c"), { matchId: "m1", tape, winner: "w", reason: "resignation" });
  assert.equal(after.matches[0].representativeFate, "captured-after-promotion");
  assert.equal(after.members[0].status, "injured");
  assert.deepEqual(after.members[0].battlefieldPromotions, [{ matchId: "m1", to: "q" }]);
  assert.match(after.chronicle.find((e) => e.kind === "promotion")?.body ?? "", /before being taken/);
  const lost = play(founded("c"), { matchId: "m1", tape, winner: "b", reason: "resignation" });
  assert.equal(lost.members[0].status, "captive");
  assert.equal(lost.members[0].captiveOf, `crown:${rival.nationId}`, "taken by a royal piece: held by the opponent crown");
  const captivity = lost.chronicle.find((e) => e.kind === "captivity");
  assert.equal(captivity?.title, `${lost.members[0].name} is taken captive`);
  assert.equal(captivity?.body, "Held by the Scorched Caliphate of Solforiz. Their place stands empty until your house wins a Muster against Solforiz.");
  assert.match(lost.notices.find((n) => n.kind === "captivity-notice")?.title ?? "", /^The Scorched Caliphate of Solforiz holds /);
  assert.deepEqual(prominentAftermath(lost).map((e) => e.kind), ["captivity", "promotion"]);
});

test("the allied representative lost in a victory opens an accounting thread", () => {
  const after = play(founded("g"), { matchId: "m1", tape: ALLY_LOST, winner: "w", reason: "checkmate" });
  assert.equal(after.matches[0].outcome, "victory");
  assert.equal(after.matches[0].alliedRepresentativeLost, true);
  const relation = after.relations[0];
  assert.equal(relation.disposition, -25 + 5 - 10);
  assert.equal(relation.grievances, 1);
  assert.equal(relation.memory.length, 1);
  assert.ok(after.notices.some((n) => n.kind === "allied-demand" && n.fromHouseId === ally.id));
  assert.ok(after.unresolved.some((m) => m.kind === "allied-accounting" && m.houseId === ally.id));
  assert.equal(after.members[0].status, "available", "the house's own representative is unharmed");
  const reaction = after.chronicle.find((e) => e.kind === "allied-reaction");
  assert.equal(reaction?.title, `${ally.name} counts its loss`);
  assert.equal(reaction?.body, `${ally.representative.name}, was taken in the Muster. ${ally.name} holds your banner to account.`);
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["allied-reaction", "match"]);
});

test("taking the rival's representative opens a grievance thread without any loss", () => {
  const after = play(founded("b"), { matchId: "m1", tape: RIVAL_TAKEN, winner: "w", reason: "checkmate" });
  assert.equal(after.matches[0].rivalRepresentativeCaptured, true);
  assert.equal(after.matches[0].representativeCaptures, 1);
  assert.equal(after.members[0].status, "available");
  assert.equal(after.members[0].captures, 1);
  const relation = after.relations[1];
  assert.equal(relation.grievances, 1);
  assert.ok(relation.memory.length >= 1);
  assert.ok(after.notices.some((n) => n.kind === "rival-vow" && n.fromHouseId === rival.id));
  assert.ok(after.unresolved.some((m) => m.kind === "grievance" && m.houseId === rival.id));
  assert.match(openChallenge(after)?.title ?? "", /demands an answer/);
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["grievance", "match"]);
});

test("a captive returns after a Muster victory over the captor's nation", () => {
  const captive = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
  const renominated = apply(captive, { type: "nominate", memberId: "member-2", file: "a", at: AT });
  const after = play(renominated, { matchId: "m2", tape: SCHOLARS, winner: "w", reason: "checkmate" });
  assert.equal(after.members[0].status, "available");
  assert.equal(after.members[0].captiveOf, null);
  assert.ok(after.notices.some((n) => n.kind === "return-notice" && n.fromHouseId === rival.id));
  assert.equal(after.unresolved.some((m) => m.kind === "captive"), false, "the captive matter is resolved");
  const returnEntry = after.chronicle.find((e) => e.kind === "return");
  assert.ok(returnEntry && returnEntry.refs.memberId === "member-1");
  assert.ok(after.chronicle.some((e) => e.kind === "captivity"), "the chronicle preserves the captivity");
  assert.deepEqual(prominentAftermath(after).map((e) => e.kind), ["captivity", "return"]);
  const dismissed = apply(after, { type: "dismiss-aftermath" });
  assert.deepEqual(dismissed.pendingAftermath, []);
});

test("recording the same matchId twice is idempotent", () => {
  const ready = accept(founded());
  const rec = record(ready, { matchId: "m1", tape: SCHOLARS, winner: "w", reason: "checkmate" });
  const once = reduceLegacy(ready, { type: "record-match", record: rec });
  assert.equal(once.error, null);
  const twice = reduceLegacy(once.state, { type: "record-match", record: rec });
  assert.equal(twice.error, null);
  assert.equal(twice.state, once.state);
});

function refuse(state: LegacyState, rec: LegacyMatchRecord, pattern: RegExp, label: string): void {
  const transition = reduceLegacy(state, { type: "record-match", record: rec });
  assert.match(transition.error ?? "(accepted)", pattern, label);
  assert.equal(transition.state, state, `${label}: state unchanged`);
}

test("malformed records are refused with the state unchanged", () => {
  const ready = accept(founded());
  const good = record(ready, { matchId: "m1", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
  const moves = good.moves;

  refuse(ready, { ...good, moves: [moves[0], { ...moves[1], ply: 2 }] }, /out of sequence/, "ply gap");
  refuse(ready, { ...good, moves: [{ ...moves[0], actorId: "levy:korvenia:z9" }] }, /not in the formation/, "unknown actor");
  // Black's c-pawn takes b4 (ply 3); then a white piece "captures" the same identity again.
  const doubleCapture = moves.slice(0, 4).concat({ ply: 4, actorId: good.formation.a2, from: "a2", to: "b3", capturedCharacterId: moves[3].capturedCharacterId, capturedSquare: "b4", rookCharacterId: null, promotion: null });
  refuse(ready, { ...good, moves: doubleCapture }, /already captured/, "double capture");
  const repId = good.formation.b2;
  const actorCapturedEarlier = moves.slice(0, 4).concat({ ply: 4, actorId: repId, from: "b4", to: "b5", capturedCharacterId: null, capturedSquare: null, rookCharacterId: null, promotion: null });
  refuse(ready, { ...good, moves: actorCapturedEarlier }, /captured earlier/, "actor captured earlier");
  const withoutRepresentative = { ...good.formation, b2: "levy:korvenia:b2" };
  const allegiance: LegacyMatchRecord["allegiance"] = { ...good.allegiance, "levy:korvenia:b2": { houseId: "crown:korvenia", side: "w", label: "a Pawn of the Korvenia levy" } };
  delete allegiance[repId];
  refuse(ready, { ...good, formation: withoutRepresentative, allegiance, moves: [], result: { winner: "b", reason: "resignation" } }, /absent from the formation/, "missing representative");
  refuse(ready, { ...good, moves: [{ ...moves[0], actorId: good.formation.c7, from: "c7", to: "c5" }] }, /out of turn/, "wrong side to move");
  refuse(ready, { ...good, moves: [{ ...moves[0], from: "b3" }] }, /is not on b3/, "actor not on its square");
  refuse(ready, { ...good, formation: { ...good.formation, e4: good.formation.e2 } }, /standard starting position/, "non-standard formation");
  refuse(ready, { ...good, result: { winner: null, reason: "checkmate" } }, /needs a winner/, "checkmate without winner");
  refuse(ready, { ...good, result: { winner: "w", reason: "stalemate" } }, /cannot have a winner/, "stalemate with winner");
  refuse(ready, { ...good, matchId: "" }, /needs an id/, "empty id");
  refuse(ready, { ...good, opponentNationId: "aethelgard" }, /rival representative|different nation/, "opponent mismatch");
  const capturer = good.formation.c7;
  const owedBy = (houseId: string): LegacyMatchRecord["allegiance"] => ({ ...good.allegiance, [capturer]: { ...good.allegiance[capturer], houseId } });
  refuse(ready, { ...good, allegiance: owedBy("house-nowhere") }, /wrong house/, "spoofed captor house");
  refuse(ready, { ...good, allegiance: owedBy("player") }, /wrong house/, "opponent piece claiming the house");
  refuse(ready, { ...good, allegiance: owedBy("") }, /wrong house/, "empty captor house");
  refuse(ready, { ...good, allegiance: owedBy(`crown:${rival.nationId}`) }, /wrong house/, "rival representative disowned");
  const levyPawn = good.formation.a7;
  refuse(ready, { ...good, allegiance: { ...good.allegiance, [levyPawn]: { ...good.allegiance[levyPawn], houseId: rival.id } } }, /wrong house/, "levy piece claiming the rival house");
  refuse(ready, { ...good, allegiance: { ...good.allegiance, "levy:ghost:a1": { houseId: "crown:korvenia", side: "w", label: "Ghost" } } }, /cover exactly/, "extra allegiance entry");
  refuse(ready, { ...good, formation: { ...good.formation, a7: good.formation.h7, h7: good.formation.a7 } }, /not part of this banner's Muster formation/, "swapped identities");
  refuse(ready, { ...good, moves: [{ ...moves[0], san: 42 as unknown as string }] }, /invalid SAN/, "non-string SAN");
  refuse(ready, { ...good, completedAt: "x".repeat(65) }, /completion time/, "oversized timestamp");
  refuse(ready, { ...good, stakes: "classic" }, /Classic match cannot answer/, "classic answering a challenge");
  refuse(ready, { ...good, moves: [{ ...moves[0], promotion: "q" }] }, /cannot promote/, "illegal promotion flag");
  refuse(ready, { ...good, moves: "e2e4" as unknown as LegacyMatchRecord["moves"] }, /needs its moves/, "moves not an array");
  refuse(createLegacyState({ at: AT }), good, /Found a banner/, "no banner");
});

test("fixture records are refused in production and accepted only by preview states", () => {
  const ready = accept(founded());
  const fixture = record(ready, { matchId: "f1", tape: SCHOLARS, winner: "w", reason: "checkmate", source: "fixture" });
  refuse(ready, fixture, /development previews/, "fixture in production");
  const preview = accept(founded("b", "preview"));
  const accepted = reduceLegacy(preview, { type: "record-match", record: record(preview, { matchId: "f1", tape: SCHOLARS, winner: "w", reason: "checkmate", source: "fixture" }) });
  assert.equal(accepted.error, null);
});

test("Muster records need an accepted challenge that names the opponent", () => {
  const unaccepted = founded();
  const rec = record(unaccepted, { matchId: "m1", tape: SCHOLARS, winner: "w", reason: "checkmate" });
  refuse(unaccepted, rec, /Accept the challenge/, "challenge not accepted");
  refuse(unaccepted, { ...rec, challengeId: null }, /accepted challenge/, "no challenge");
  refuse(unaccepted, { ...rec, challengeId: unaccepted.notices[0].id }, /unknown challenge/, "summons is not a challenge");
  const summons = reduceLegacy(unaccepted, { type: "accept-challenge", noticeId: unaccepted.notices[0].id, at: AT });
  assert.match(summons.error ?? "", /stated wager/);
  const accepted = accept(unaccepted);
  const challenge = openChallenge(accepted);
  assert.equal(challenge?.status, "accepted");
  assert.equal(accepted.chronicle[accepted.chronicle.length - 1].kind, "challenge-accepted");
  const again = reduceLegacy(accepted, { type: "accept-challenge", noticeId: challenge?.id ?? "", at: AT });
  assert.equal(again.state, accepted);
});

test("the same events always produce byte-identical state", () => {
  const run = (): string => {
    let state = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
    state = apply(state, { type: "nominate", memberId: "member-2", file: "a", at: AT });
    state = play(state, { matchId: "m2", tape: SCHOLARS, winner: "w", reason: "checkmate" });
    return JSON.stringify(state);
  };
  assert.equal(run(), run());
});

test("aftermath keeps at most two prominent entries, by priority then recency", () => {
  const entry = (id: string, kind: ChronicleEntry["kind"], prominence: ChronicleEntry["prominence"] = "major"): ChronicleEntry => ({
    id, kind, matchIndex: 0, title: id, body: id, at: AT, prominence, refs: {},
  });
  const chronicle = [
    entry("chr-0001", "match"), entry("chr-0002", "injury"), entry("chr-0003", "promotion"),
    entry("chr-0004", "grievance"), entry("chr-0005", "allied-reaction"), entry("chr-0006", "return"),
    entry("chr-0007", "captivity"), entry("chr-0008", "recovery", "minor"), entry("chr-0009", "match"),
  ];
  const all = chronicle.map((e) => e.id);
  assert.deepEqual(selectAftermath(chronicle, all), ["chr-0007", "chr-0006"]);
  assert.deepEqual(selectAftermath(chronicle, ["chr-0001", "chr-0009", "chr-0002"]), ["chr-0002", "chr-0009"]);
  assert.deepEqual(selectAftermath(chronicle, ["chr-0008", "chr-9999"]), []);
  assert.deepEqual(selectAftermath(chronicle, ["chr-0003", "chr-0004", "chr-0005"]), ["chr-0005", "chr-0004"]);
  assert.equal(MAX_PROMINENT_AFTERMATH, 2);
  // Every fact stays in the chronicle even when only two are prominent.
  const busy = play(founded("g"), { matchId: "m1", tape: ALLY_LOST, winner: "w", reason: "checkmate" });
  assert.ok(busy.pendingAftermath.length <= 2);
  assert.ok(busy.chronicle.filter((e) => e.prominence === "major").length >= busy.pendingAftermath.length);
});

test("Muster readiness explains what stands between the house and the board", () => {
  assert.match(musterReadiness(createLegacyState()).reason ?? "", /Found a banner/);
  const unnominated = reduceLegacy(createLegacyState({ at: AT }), { type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), at: AT, seed: 7 }).state;
  assert.match(musterReadiness(unnominated).reason ?? "", /Nominate/);
  const nominated = founded();
  const waiting = musterReadiness(nominated);
  assert.equal(waiting.ready, false);
  assert.match(waiting.reason ?? "", /Accept the challenge/);
  assert.equal(waiting.opponentNationId, "solforiz");
  const ready = musterReadiness(accept(nominated));
  assert.deepEqual([ready.ready, ready.reason, ready.opponentNationId], [true, null, "solforiz"]);
  assert.equal(ready.challengeId, openChallenge(accept(nominated))?.id);
  const captive = play(founded(), { matchId: "m1", tape: REP_B_TAKEN_IN_DEFEAT, winner: "b", reason: "checkmate" });
  assert.match(musterReadiness(captive).reason ?? "", /captive and cannot take the field/);
});
