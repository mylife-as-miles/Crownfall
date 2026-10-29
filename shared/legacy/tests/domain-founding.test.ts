import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { eligibleMusterFiles } from "../content/muster";
import { validateBannerName, validateMotto } from "../domain/founding";
import { stanceForDisposition } from "../domain/politics";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { LegacyEvent, LegacyState, NationId } from "../types";

const AT = "2026-02-01T10:00:00.000Z";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function foundEvent(overrides: Partial<Extract<LegacyEvent, { type: "found-banner" }>> = {}): LegacyEvent {
  return { type: "found-banner", name: "House Ashgrove", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), motto: "We keep the watch", at: AT, seed: 42, ...overrides };
}

function found(nationId: NationId = "korvenia"): LegacyState {
  const transition = reduceLegacy(createLegacyState({ at: AT }), foundEvent({ nationId, heraldry: defaultHeraldry(nationId) }));
  assert.equal(transition.error, null);
  return transition.state;
}

test("founding creates a minor banner with three seeded members, relations, notices and a founding entry", () => {
  const before = deepFreeze(createLegacyState({ at: AT }));
  const { state, error } = reduceLegacy(before, foundEvent({ name: "  House   Ashgrove " }));
  assert.equal(error, null);
  assert.notEqual(state, before);
  assert.equal(before.banner, null, "input state untouched");
  assert.equal(state.banner?.name, "House Ashgrove");
  assert.equal(state.banner?.motto, "We keep the watch");
  assert.match(state.banner?.id ?? "", /^banner-[0-9a-f]{8}$/);
  assert.deepEqual(state.standing, { rank: "minor-banner", recognition: 0, representation: 1 });
  assert.equal(state.members.length, 3);
  assert.deepEqual(state.members.map((m) => m.id), ["member-1", "member-2", "member-3"]);
  assert.equal(new Set(state.members.map((m) => m.name)).size, 3);
  for (const member of state.members) {
    assert.equal(member.status, "available");
    assert.equal(member.appointment, "pawn");
  }
  const ally = getAlliedHouse("korvenia");
  const rival = getRivalHouse("korvenia");
  assert.deepEqual(state.relations.map((r) => [r.houseId, r.disposition]), [[ally.id, -25], [rival.id, -10]]);
  assert.equal(stanceForDisposition(state.relations[0].disposition), "disdainful");
  assert.equal(stanceForDisposition(state.relations[1].disposition), "wary");
  assert.deepEqual(state.chronicle.map((e) => [e.id, e.kind]), [["chr-0001", "founding"]]);
  assert.equal(state.chronicle[0].body, "House Ashgrove is entered in the rolls of the Grand Duchy of Korvenia as a minor banner. In the capital, few yet know its name.");
  assert.deepEqual(state.notices.map((n) => [n.kind, n.fromHouseId, n.status]), [["muster-summons", ally.id, "unread"], ["rival-challenge", rival.id, "unread"]]);
  const challenge = state.notices[1];
  assert.equal(challenge.stakes, "muster");
  assert.match(challenge.wager ?? "", /^These are the terms of this Muster conflict against Solforiz\./);
  assert.match(challenge.wager ?? "", /held captive until your house wins a later Muster against Solforiz/);
  assert.match(challenge.wager ?? "", /recover after one further recorded match/);
  assert.match(state.notices[0].body, /judge it by how the Muster goes/);
  assert.deepEqual(state.unresolved.map((m) => m.kind), ["challenge"]);
  assert.deepEqual(state.pendingAftermath, []);
});

test("founding is deterministic for the same inputs and varies with the seed", () => {
  const a = reduceLegacy(createLegacyState({ at: AT }), foundEvent()).state;
  const b = reduceLegacy(createLegacyState({ at: AT }), foundEvent()).state;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = reduceLegacy(createLegacyState({ at: AT }), foundEvent({ seed: 43 })).state;
  assert.notDeepEqual(a.members.map((m) => m.name), c.members.map((m) => m.name));
});

test("founding refuses bad names, mottos, nations, heraldry and existing banners, returning the same state", () => {
  const empty = createLegacyState({ at: AT });
  const cases: [Partial<Extract<LegacyEvent, { type: "found-banner" }>>, RegExp][] = [
    [{ name: "A" }, /at least 2/],
    [{ name: "House of the Exceedingly Long Name" }, /at most 28/],
    [{ name: "House 42" }, /letters, spaces/],
    [{ name: "-Ashgrove" }, /begin with a letter/],
    [{ motto: "x".repeat(65) }, /motto/],
    [{ nationId: "atlantis" as NationId }, /four nations/],
    [{ heraldry: { ...defaultHeraldry("korvenia"), charge: "comet" as "key" } }, /charge/i],
    [{ at: "" }, /timestamp/],
    [{ seed: Number.NaN }, /seed/],
  ];
  for (const [overrides, pattern] of cases) {
    const transition = reduceLegacy(empty, foundEvent(overrides));
    assert.match(transition.error ?? "", pattern, JSON.stringify(overrides));
    assert.equal(transition.state, empty);
  }
  const founded = found();
  const again = reduceLegacy(founded, foundEvent());
  assert.match(again.error ?? "", /already exists/);
  assert.equal(again.state, founded);
});

test("availability configuration gates founding", () => {
  const empty = createLegacyState({ at: AT });
  const closed = reduceLegacy(empty, foundEvent({ nationId: "solforiz", heraldry: defaultHeraldry("solforiz") }), {
    availability: { korvenia: "available", solforiz: "unavailable", aethelgard: "available", "kwind-09": "available" },
  });
  assert.match(closed.error ?? "", /not open/);
  const preview = reduceLegacy(empty, foundEvent({ nationId: "solforiz", heraldry: defaultHeraldry("solforiz") }), {
    availability: { korvenia: "available", solforiz: "preview", aethelgard: "available", "kwind-09": "available" },
  });
  assert.equal(preview.error, null);
});

test("name and motto validation normalise whitespace and accept letters, apostrophes and hyphens", () => {
  assert.deepEqual(validateBannerName("  Ombre'a  Lune-Morn "), { ok: true, name: "Ombre'a Lune-Morn" });
  assert.equal(validateBannerName("Hôtel d’Ombre").ok, true);
  assert.equal(validateBannerName(12).ok, false);
  assert.deepEqual(validateMotto("   "), { ok: true, motto: null });
  assert.deepEqual(validateMotto(undefined), { ok: true, motto: null });
  assert.equal(validateMotto("bad\u0007bell").ok, false);
});

test("reset returns a fresh state that can found again; preview mode survives reset", () => {
  const founded = found();
  const reset = reduceLegacy(founded, { type: "reset", at: "2026-02-02T00:00:00.000Z" });
  assert.equal(reset.error, null);
  assert.equal(reset.state.banner, null);
  assert.equal(reset.state.members.length, 0);
  assert.equal(reset.state.chronicle.length, 0);
  assert.equal(reset.state.createdAt, "2026-02-02T00:00:00.000Z");
  assert.equal(reduceLegacy(reset.state, foundEvent()).error, null);
  const preview = reduceLegacy(createLegacyState({ mode: "preview", previewId: "founded" }), { type: "reset", at: AT }).state;
  assert.equal(preview.mode, "preview");
  assert.equal(preview.previewId, "founded");
  assert.match(reduceLegacy(founded, { type: "reset", at: "" }).error ?? "", /timestamp/);
});

test("every nation founds with its own houses and open files", () => {
  for (const nationId of ["korvenia", "solforiz", "aethelgard", "kwind-09"] as const) {
    const state = found(nationId);
    assert.equal(state.relations[0].houseId, getAlliedHouse(nationId).id);
    assert.equal(state.relations[1].houseId, getRivalHouse(nationId).id);
    assert.ok(eligibleMusterFiles(nationId).length >= 4);
  }
});

test("unknown events and notice reads are handled without mutation", () => {
  const state = found();
  const unknown = reduceLegacy(state, { type: "summon-storm" } as unknown as LegacyEvent);
  assert.equal(unknown.state, state);
  assert.match(unknown.error ?? "", /Unknown/);
  const read = reduceLegacy(state, { type: "read-notice", noticeId: state.notices[0].id });
  assert.equal(read.state.notices[0].status, "read");
  assert.equal(state.notices[0].status, "unread");
  const readAgain = reduceLegacy(read.state, { type: "read-notice", noticeId: state.notices[0].id });
  assert.equal(readAgain.state, read.state);
  assert.match(reduceLegacy(state, { type: "read-notice", noticeId: "notice-9999" }).error ?? "", /does not exist/);
});
