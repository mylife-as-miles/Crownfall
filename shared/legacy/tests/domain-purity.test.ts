import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry } from "../content/heraldry";
import { getRivalHouse } from "../content/houses";
import { FILES } from "../content/muster";
import { NATION_ORDER } from "../content/nations";
import { prominentAftermath, selectAftermath } from "../domain/aftermath";
import { chronicleNewestFirst, findChronicleEntry } from "../domain/chronicle";
import { buildLegacyPreview, LEGACY_PREVIEW_IDS } from "../domain/fixtures";
import { createMusterFormation, musterReadiness } from "../domain/formation";
import { nominationRefusal } from "../domain/nomination";
import { findNotice, openChallenge } from "../domain/notices";
import { findRelation } from "../domain/politics";
import { deriveHonours, presentBannerhold, presentFoundingDraft, representativeCondition } from "../domain/presentation";
import { createLegacyState, findMember, nominatedMember } from "../domain/state";
import type { LegacyState } from "../types";

function objectReferences(value: unknown): Map<string, object> {
  const references = new Map<string, object>();
  const visit = (child: unknown, path: string) => {
    if (typeof child !== "object" || child === null) return;
    references.set(path, child);
    for (const [key, nested] of Object.entries(child)) visit(nested, `${path}.${key}`);
  };
  visit(value, "input");
  return references;
}

/** Frozen input catches writes, including in-place sorts; references also guard replacement. */
function guardInput(value: unknown): (label: string) => void {
  const before = objectReferences(value);
  const json = JSON.stringify(value);
  for (const object of before.values()) Object.freeze(object);
  return (label) => {
    const after = objectReferences(value);
    assert.deepEqual([...after.keys()], [...before.keys()], `${label}: input structure`);
    for (const [path, object] of before) assert.equal(after.get(path), object, `${label}: ${path} identity`);
    assert.equal(JSON.stringify(value), json, `${label}: input data`);
  };
}

function preview(id: string): LegacyState {
  const state = buildLegacyPreview(id);
  assert.ok(state, `public fixture ${id} exists`);
  return state;
}

/** The read paths used when opening or revisiting the four inspectors. No events are dispatched. */
function readNavigationModels(state: LegacyState) {
  const scene = presentBannerhold(state);
  const banner = state.banner;
  const formations = banner
    ? (["w", "b"] as const).map((playerSide) => createMusterFormation(state, Object.freeze({
      playerSide,
      opponentNationId: getRivalHouse(banner.nationId).nationId,
    })))
    : [];
  return {
    scene,
    honours: deriveHonours(state),
    aftermath: prominentAftermath(state),
    selectedAftermath: selectAftermath(state.chronicle, state.pendingAftermath),
    ledger: chronicleNewestFirst(state),
    readiness: musterReadiness(state),
    challenge: openChallenge(state),
    nominee: nominatedMember(state),
    members: state.members.map((member) => findMember(state, member.id)),
    notices: state.notices.map((notice) => findNotice(state, notice.id)),
    relations: state.relations.map((relation) => findRelation(state.relations, relation.houseId)),
    nominationChoices: state.members.map((member) => FILES.map((file) => nominationRefusal(state, member.id, file))),
    formations,
  };
}

test("revisiting presentation and inspector selectors preserves frozen save data and every nested identity", () => {
  const cases: [string, LegacyState][] = [
    ["unfounded", createLegacyState()],
    ...LEGACY_PREVIEW_IDS.map((id): [string, LegacyState] => [id, preview(id)]),
  ];
  for (const [id, state] of cases) {
    const unchanged = guardInput(state);
    const first = readNavigationModels(state);
    assert.notEqual(first.ledger, state.chronicle, `${id}: ledger ordering owns its array`);
    assert.deepEqual(first.ledger.map((entry) => entry.id), state.chronicle.map((entry) => entry.id).reverse());
    for (const entry of first.ledger) assert.equal(findChronicleEntry(state, entry.id), entry);
    assert.deepEqual(first.aftermath.map((entry) => entry.id), state.pendingAftermath);
    for (let visit = 0; visit < 4; visit++) {
      assert.deepEqual(readNavigationModels(state), first, `${id}: repeat visit ${visit + 1}`);
      unchanged(`${id}: repeat visit ${visit + 1}`);
    }
  }
});

test("reading an inspector cannot release a captive, heal an injury or acknowledge a return", () => {
  for (const condition of ["captive", "injured", "returned"] as const) {
    const state = preview(condition);
    const unchanged = guardInput(state);
    assert.ok(state.pendingAftermath.length > 0, `${condition}: a consequence awaits acknowledgement`);
    const member = nominatedMember(state);
    assert.ok(member);
    if (condition === "captive") assert.ok(member.captiveOf);
    if (condition === "injured") assert.ok((member.injuredUntilMatch ?? 0) > state.matches.length);
    for (let visit = 0; visit < 8; visit++) {
      const model = readNavigationModels(state);
      assert.ok(model.scene.representative);
      assert.equal(representativeCondition(model.scene.representative), condition);
      for (const formation of model.formations) {
        assert.equal(formation.representativeIdentityId === null, condition !== "returned", "unfit nominees cannot take the field");
      }
      assert.ok(model.aftermath.length > 0, "reading does not consume the pending consequence");
      unchanged(`${condition}: visit ${visit + 1}`);
    }
  }
});

test("renderer presentation edits cannot rewrite a save or a frozen founding draft", () => {
  const state = preview("captive");
  const unchanged = guardInput(state);
  const expected = presentBannerhold(state);
  const rendered = presentBannerhold(state);
  assert.ok(state.banner && rendered.heraldry && rendered.representative);
  assert.notEqual(rendered.heraldry, state.banner.heraldry);
  assert.notEqual(rendered.heraldry.field, state.banner.heraldry.field);
  rendered.heraldry.charge = "none";
  rendered.representative.status = "available";
  rendered.matchMarkers.length = 0;
  rendered.levy[0].status = "captive";
  unchanged("renderer edits");
  assert.deepEqual(presentBannerhold(state), expected, "the next render still reflects the saved consequences");

  for (const nationId of NATION_ORDER) {
    const draft = { nationId, name: "  Test   Banner  ", seed: 42, heraldry: defaultHeraldry(nationId) };
    const draftUnchanged = guardInput(draft);
    const first = presentFoundingDraft(draft);
    assert.equal(first.bannerName, "Test Banner");
    assert.equal(first.draft, true);
    assert.equal(first.founded, false);
    assert.equal(first.representative, null);
    assert.equal(first.levy.length, 3);
    assert.deepEqual(first.matchMarkers, []);
    assert.deepEqual(first.honours, []);
    assert.equal(first.chronicleCount, 0);
    for (let visit = 0; visit < 4; visit++) {
      assert.deepEqual(presentFoundingDraft(draft), first);
      draftUnchanged(`${nationId}: founding preview ${visit + 1}`);
    }
  }
});
