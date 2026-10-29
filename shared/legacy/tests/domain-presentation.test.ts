import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { buildLegacyPreview, getLegacyPreviewRecords, LEGACY_PREVIEW_IDS, listLegacyPreviews } from "../domain/fixtures";
import { generateFoundingMembers } from "../domain/founding";
import { validateLegacySave } from "../domain/persistence";
import { deriveHonours, presentBannerhold, presentFoundingDraft, representativeCondition } from "../domain/presentation";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { LegacyState } from "../types";

const rival = getRivalHouse("korvenia");
const ally = getAlliedHouse("korvenia");

function preview(id: string): LegacyState {
  const state = buildLegacyPreview(id);
  assert.ok(state, `fixture ${id} exists`);
  return state;
}

test("the required development previews exist, build through reduceLegacy and stay labelled as previews", () => {
  for (const id of ["founded", "captive", "injured", "recovered", "classic-capture", "drawn", "returned", "promoted", "allied-loss", "rival-grievance", "honoured"]) {
    assert.ok(LEGACY_PREVIEW_IDS.indexOf(id) !== -1, id);
  }
  assert.deepEqual(listLegacyPreviews().map((p) => p.id), [...LEGACY_PREVIEW_IDS]);
  for (const listing of listLegacyPreviews()) {
    assert.ok(listing.title.length > 0 && listing.description.length > 0);
    const state = preview(listing.id);
    assert.equal(state.mode, "preview");
    assert.equal(state.previewId, listing.id);
    assert.equal(validateLegacySave(state), null, `${listing.id} is structurally sound`);
    assert.equal(JSON.stringify(buildLegacyPreview(listing.id)), JSON.stringify(state), `${listing.id} is deterministic`);
    for (const record of getLegacyPreviewRecords(listing.id)) assert.equal(record.source, "fixture");
    const scene = presentBannerhold(state);
    assert.equal(scene.mode, "preview");
    assert.equal(scene.previewId, listing.id);
    assert.equal(scene.draft, false);
  }
  assert.equal(buildLegacyPreview("no-such-fixture"), null);
  assert.deepEqual(getLegacyPreviewRecords("no-such-fixture"), []);
});

test("an unfounded state presents an empty, honest holding", () => {
  const scene = presentBannerhold(createLegacyState());
  assert.equal(scene.founded, false);
  assert.equal(scene.draft, false);
  assert.equal(scene.nationId, "korvenia");
  assert.equal(scene.bannerName, null);
  assert.equal(scene.representative, null);
  assert.deepEqual(scene.honours, []);
  assert.deepEqual(scene.matchMarkers, []);
  assert.equal(scene.alliedHouse, null);
  assert.equal(scene.rivalHouse, null);
  const staged = presentBannerhold(createLegacyState(), { availability: { korvenia: "unavailable", solforiz: "available", aethelgard: "available", "kwind-09": "available" } });
  assert.equal(staged.nationId, "solforiz");
});

test("a newly founded banner presents its representative, levy, files, notices and houses", () => {
  const state = preview("founded");
  const scene = presentBannerhold(state);
  assert.equal(scene.founded, true);
  assert.equal(scene.bannerName, "House Vesperine");
  assert.deepEqual(scene.heraldry, defaultHeraldry("korvenia"));
  assert.equal(scene.rank, "minor-banner");
  assert.equal(scene.hallTier, 0);
  assert.deepEqual(scene.honours, []);
  assert.ok(scene.representative);
  assert.equal(scene.representative.file, "b");
  assert.equal(representativeCondition(scene.representative), "available");
  assert.equal(scene.levy.length, 2);
  assert.deepEqual(scene.eligibleFiles, ["a", "b", "c", "g", "h"]);
  assert.deepEqual(scene.claimedFiles.map((c) => c.file), ["d", "e", "f"]);
  assert.equal(scene.unreadNotices, 2);
  assert.deepEqual(scene.noticeKinds, ["muster-summons", "rival-challenge"]);
  assert.equal(scene.unresolvedCount, 1);
  assert.deepEqual(scene.alliedHouse && [scene.alliedHouse.id, scene.alliedHouse.stance], [ally.id, "disdainful"]);
  assert.deepEqual(scene.rivalHouse && [scene.rivalHouse.id, scene.rivalHouse.nationId, scene.rivalHouse.stance, scene.rivalHouse.holdsCaptive], [rival.id, "solforiz", "wary", false]);
});

test("every representative condition presents from real state", () => {
  const captive = presentBannerhold(preview("captive"));
  assert.ok(captive.representative);
  assert.equal(representativeCondition(captive.representative), "captive");
  assert.equal(captive.representative.captorHouseId, rival.id);
  assert.equal(captive.representative.captorName, rival.name);
  assert.equal(captive.rivalHouse?.holdsCaptive, true);
  assert.deepEqual(captive.honours, [], "a defeat earns no honour");
  assert.deepEqual(captive.matchMarkers, [{ matchId: "fixture-captive-1", outcome: "defeat", stakes: "muster" }]);

  const injured = presentBannerhold(preview("injured"));
  assert.ok(injured.representative);
  assert.equal(representativeCondition(injured.representative), "injured");
  assert.deepEqual(injured.honours.map((h) => h.kind), ["muster-victory"]);

  const drawn = presentBannerhold(preview("drawn"));
  assert.ok(drawn.representative);
  assert.equal(representativeCondition(drawn.representative), "injured");
  assert.deepEqual(drawn.honours, [], "a draw earns no honour");
  assert.deepEqual(drawn.matchMarkers.map((m) => m.outcome), ["draw"]);

  const returnedState = preview("returned");
  const returned = presentBannerhold(returnedState);
  assert.ok(returned.representative);
  assert.equal(returned.representative.recentlyReturned, true);
  assert.equal(representativeCondition(returned.representative), "returned");
  assert.deepEqual(returned.honours.map((h) => h.kind), ["muster-victory", "return"]);
  const acknowledged = reduceLegacy(returnedState, { type: "dismiss-aftermath" }).state;
  const settled = presentBannerhold(acknowledged).representative;
  assert.ok(settled);
  assert.equal(settled.recentlyReturned, false);
  assert.equal(representativeCondition(settled), "available");

  const promoted = presentBannerhold(preview("promoted"));
  assert.ok(promoted.representative);
  assert.equal(promoted.representative.promotedTo, "q");
  assert.equal(representativeCondition(promoted.representative), "promoted");
  assert.equal(promoted.rank, "minor-banner");
  assert.deepEqual(promoted.honours.map((h) => h.kind), ["muster-victory", "battlefield-promotion"]);

  const recoveredState = preview("recovered");
  const recovered = presentBannerhold(recoveredState);
  assert.ok(recovered.representative);
  assert.equal(representativeCondition(recovered.representative), "available");
  assert.equal(recovered.representative.memberId, "member-1");
  assert.ok(recoveredState.chronicle.some((e) => e.kind === "injury" && e.refs.memberId === "member-1"));
  assert.ok(recoveredState.chronicle.some((e) => e.kind === "recovery" && e.refs.memberId === "member-1"));
  assert.deepEqual(recovered.honours.map((h) => h.kind), ["muster-victory", "muster-victory", "recognition"]);
  assert.equal(recovered.hallTier, 1);

  const classicState = preview("classic-capture");
  const classic = presentBannerhold(classicState);
  assert.ok(classic.representative);
  assert.equal(representativeCondition(classic.representative), "available");
  assert.deepEqual(classic.honours, []);
  assert.deepEqual(classic.matchMarkers, [{ matchId: "fixture-classic-1", outcome: "defeat", stakes: "classic" }]);
  assert.equal(classicState.members[0].timesCaptured, 1);
  assert.ok(classicState.chronicle.some((e) => e.kind === "capture" && /left the board unharmed/.test(e.body)));

  const alliedLoss = presentBannerhold(preview("allied-loss"));
  assert.equal(alliedLoss.alliedHouse?.stance, "disdainful");
  assert.ok(alliedLoss.noticeKinds.indexOf("allied-demand") !== -1);
  assert.equal(alliedLoss.unresolvedCount, 2);
});

test("honours and hall tiers come only from recorded events", () => {
  const honoured = preview("honoured");
  const scene = presentBannerhold(honoured);
  assert.equal(honoured.standing.recognition, 10);
  assert.equal(scene.hallTier, 2);
  const counts = new Map<string, number>();
  for (const honour of scene.honours) counts.set(honour.kind, (counts.get(honour.kind) ?? 0) + 1);
  assert.equal(counts.get("muster-victory"), 5);
  assert.equal(counts.get("battlefield-promotion"), 1);
  assert.equal(counts.get("recognition"), 2);
  assert.equal(counts.get("return"), undefined);
  for (const honour of scene.honours) {
    if (honour.kind === "recognition") assert.equal(honour.matchId, null);
    else assert.ok(honoured.processedMatchIds.indexOf(honour.matchId ?? "") !== -1, `${honour.id} cites a recorded match`);
  }
  assert.equal(new Set(scene.honours.map((h) => h.id)).size, scene.honours.length);
  assert.deepEqual(deriveHonours(preview("founded")), []);
  assert.deepEqual(presentBannerhold(honoured), presentBannerhold(honoured), "presentation is deterministic");
});

test("the founding draft presents an unsaved preview of the chosen identity", () => {
  const scene = presentFoundingDraft({ nationId: "aethelgard", name: "  House  Cynewald ", seed: 99 });
  assert.equal(scene.draft, true);
  assert.equal(scene.founded, false);
  assert.equal(scene.mode, "production");
  assert.equal(scene.bannerName, "House Cynewald");
  assert.deepEqual(scene.heraldry, defaultHeraldry("aethelgard"));
  assert.deepEqual(scene.levy.map((m) => m.name), generateFoundingMembers("aethelgard", 99).map((m) => m.name));
  assert.equal(scene.alliedHouse?.id, getAlliedHouse("aethelgard").id);
  assert.equal(scene.rivalHouse?.nationId, getRivalHouse("aethelgard").nationId);
  assert.deepEqual(scene.honours, []);
  assert.equal(scene.representative, null);
  const custom = { ...defaultHeraldry("aethelgard"), charge: "pawn" as const };
  assert.equal(presentFoundingDraft({ nationId: "aethelgard", heraldry: custom }).heraldry?.charge, "pawn");
  assert.equal(presentFoundingDraft({ nationId: "aethelgard", name: "   " }).bannerName, null);
  assert.deepEqual(presentFoundingDraft({ nationId: "aethelgard" }).levy, []);
});
