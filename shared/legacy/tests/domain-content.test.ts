import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_COPY, LEGACY_TEXT, sentenceCase } from "../content/copy";
import {
  CHARGES, DIVISIONS, HERALDRY_PRESETS, ORDINARIES, TINCTURES, defaultHeraldry, describeHeraldry, tinctureAdvisory,
  tinctureInfo, validateHeraldry,
} from "../content/heraldry";
import { CROWN_TITLES, EXTERNAL_HOUSES, NATION_HOUSES, getAlliedHouse, getRivalHouse } from "../content/houses";
import { MUSTER_FILE_CLAIMS, eligibleMusterFiles } from "../content/muster";
import { BANNER_NAME_SUGGESTIONS, MEMBER_NAME_POOLS, suggestBannerNames } from "../content/names";
import { LEGACY_NATION_AVAILABILITY, NATIONS, NATION_ORDER, UNNAMED_CAPITAL, listFoundableNations } from "../content/nations";
import { TINCTURE_SRGB } from "../environment-contract";
import { buildLegacyPreview, listLegacyPreviews } from "../domain/fixtures";
import { validateBannerName } from "../domain/founding";
import { standardPieceAt } from "../domain/formation";
import type { LegacyState } from "../types";

test("four nations with distinct identities, all available in this build", () => {
  assert.deepEqual([...NATION_ORDER], ["korvenia", "solforiz", "aethelgard", "kwind-09"]);
  const palettes = new Set<string>();
  for (const id of NATION_ORDER) {
    const nation = NATIONS[id];
    assert.equal(nation.id, id);
    for (const value of Object.values(nation.palette)) assert.match(value, /^#[0-9a-f]{6}$/);
    palettes.add(nation.palette.primary);
    assert.equal(LEGACY_NATION_AVAILABILITY[id], "available");
  }
  assert.equal(palettes.size, 4);
  assert.deepEqual(new Set(NATION_ORDER.map((id) => NATIONS[id].architecture)).size, 4);
  assert.equal(listFoundableNations().length, 4);
  const restricted = listFoundableNations({ korvenia: "available", solforiz: "preview", aethelgard: "unavailable", "kwind-09": "unavailable" });
  assert.deepEqual(restricted.map((entry) => [entry.nation.id, entry.availability]), [["korvenia", "available"], ["solforiz", "preview"]]);
});

test("tinctures reuse the contract colours and classify metals", () => {
  for (const tincture of TINCTURES) assert.equal(tinctureInfo(tincture).hex, TINCTURE_SRGB[tincture]);
  assert.deepEqual(TINCTURES.filter((t) => tinctureInfo(t).class === "metal"), ["or", "argent"]);
  assert.equal(DIVISIONS.length, 7);
  assert.equal(ORDINARIES.length, 9);
  assert.equal(CHARGES.length, 12);
});

test("presets are valid, follow the rule of tincture, and the first is each nation's default", () => {
  for (const id of NATION_ORDER) {
    const presets = HERALDRY_PRESETS[id];
    assert.ok(presets.length >= 3 && presets.length <= 4, `${id} has 3–4 presets`);
    assert.deepEqual(defaultHeraldry(id), presets[0].heraldry);
    for (const preset of presets) {
      assert.ok(validateHeraldry(preset.heraldry).ok, preset.id);
      assert.deepEqual(tinctureAdvisory(preset.heraldry), [], `${preset.id} follows the rule of tincture`);
    }
  }
  for (const house of EXTERNAL_HOUSES) assert.deepEqual(tinctureAdvisory(house.heraldry), [], `${house.id} follows the rule of tincture`);
});

test("rule-of-tincture advisory warns without blocking and validation is structural", () => {
  const clash = { division: "plain", field: ["or", "or"], ordinary: "chief", ordinaryTincture: "argent", charge: "key", chargeTincture: "or" } as const;
  const advice = tinctureAdvisory(clash);
  assert.deepEqual(advice.map((item) => [item.part, item.code]), [["ordinary", "metal-on-metal"], ["charge", "same-tincture"]]);
  assert.ok(validateHeraldry(clash).ok, "a clashing design is still valid");
  const colourOnColour = tinctureAdvisory({ division: "plain", field: ["gules", "gules"], ordinary: "fess", ordinaryTincture: "azure", charge: "none", chargeTincture: "or" });
  assert.equal(colourOnColour[0].code, "colour-on-colour");
  assert.equal(validateHeraldry({ division: "plain" }).ok, false);
  assert.equal(validateHeraldry({ ...clash, field: ["or"] }).ok, false);
  assert.equal(validateHeraldry({ ...clash, charge: "comet" }).ok, false);
  assert.equal(validateHeraldry(null).ok, false);
  assert.equal(describeHeraldry(HERALDRY_PRESETS.solforiz[2].heraldry), "Azure, on a fess or a flame gules");
  assert.equal(describeHeraldry(HERALDRY_PRESETS.korvenia[1].heraldry), "Per bend purpure and sable, a key argent");
});

test("banner-name suggestions are original, valid and deterministic", () => {
  for (const id of NATION_ORDER) {
    const names = BANNER_NAME_SUGGESTIONS[id];
    assert.ok(names.length >= 12, `${id} has at least 12 names`);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.ok(validateBannerName(name).ok, `${name} passes the naming rule`);
    const pool = MEMBER_NAME_POOLS[id];
    assert.ok(pool.given.length >= 12 && pool.epithets.length >= 8 && pool.origins.length >= 8);
    assert.deepEqual(suggestBannerNames(id, 7, 5), suggestBannerNames(id, 7, 5));
    assert.equal(suggestBannerNames(id, 7, 5).length, 5);
    assert.equal(suggestBannerNames(id, 7, 99).length, names.length);
    assert.equal(suggestBannerNames(id, 7, -3).length, 0);
  }
  assert.notDeepEqual(suggestBannerNames("korvenia", 1, 6), suggestBannerNames("korvenia", 2, 6));
});

test("each nation has one allied Great House and one foreign rival with a representative on its standard square", () => {
  const ids = new Set<string>();
  for (const id of NATION_ORDER) {
    const ally = getAlliedHouse(id);
    const rival = getRivalHouse(id);
    assert.equal(ally.kind, "allied-great-house");
    assert.equal(ally.nationId, id);
    assert.equal(rival.kind, "rival-house");
    assert.notEqual(rival.nationId, id);
    for (const house of [ally, rival]) {
      ids.add(house.id);
      const piece = standardPieceAt(house.representative.square);
      assert.ok(piece && piece.side === "w", `${house.id} square is written from white's side`);
      assert.equal(piece?.kind, house.representative.piece, `${house.id} representative matches the standard position`);
      assert.ok(house.seat.length > 0 && house.temperament.length > 0);
    }
    assert.deepEqual(NATION_HOUSES[id], { allied: ally.id, rival: rival.id });
  }
  assert.equal(ids.size, 8);
  assert.equal(EXTERNAL_HOUSES.length, 8);
});

test("Muster claims leave four or five eligible files and cover allied pawn representatives", () => {
  for (const id of NATION_ORDER) {
    const eligible = eligibleMusterFiles(id);
    assert.ok(eligible.length >= 4 && eligible.length <= 5, `${id} leaves ${eligible.length} files`);
    assert.equal(eligible.length + MUSTER_FILE_CLAIMS[id].length, 8);
    const ally = getAlliedHouse(id);
    if (ally.representative.piece === "p") {
      const file = ally.representative.square.charAt(0);
      assert.equal(eligible.some((open) => open === file), false, "allied pawn file is claimed");
    }
  }
});

test("shared copy carries the honesty labels verbatim", () => {
  assert.equal(LEGACY_COPY.guest.label, "Guest session — not saved");
  assert.equal(LEGACY_COPY.preview.label, "Development preview · fixture data · not saved");
  assert.match(LEGACY_COPY.awaitingBoard.body, /not connected/);
  assert.equal(LEGACY_COPY.status.returned.label, "Returned");
  assert.equal(LEGACY_COPY.status.promoted.label, "Promoted");
  assert.equal(LEGACY_COPY.founding.steps.length, 4);
});

test("nations keep to public-safe identity: formal polities and unnamed capitals", () => {
  assert.deepEqual(NATION_ORDER.map((id) => NATIONS[id].polity), [
    "The Grand Duchy of Korvenia", "The Scorched Caliphate of Solforiz", "The Blood-Throne of Aethelgard", "The Kwind Zaibatsu",
  ]);
  for (const id of NATION_ORDER) {
    assert.equal(NATIONS[id].capital, UNNAMED_CAPITAL, `${id} capital stays unnamed`);
    assert.ok(NATIONS[id].summary.length > 80 && NATIONS[id].epithet.length > 0);
  }
  assert.equal(UNNAMED_CAPITAL, "the capital");
});

/** Every string a value holds, calling copy functions with neutral sample arguments. */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") collectStrings((value as (...args: unknown[]) => unknown)("Sample", 2), out, depth + 1);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out, depth + 1);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
}

function stateStrings(state: LegacyState, out: string[]): void {
  for (const entry of state.chronicle) out.push(entry.title, entry.body);
  for (const notice of state.notices) out.push(notice.title, notice.body, notice.wager ?? "");
  for (const matter of state.unresolved) out.push(matter.title, matter.body);
  for (const member of state.members) out.push(member.name, member.epithet, member.origin);
}

test("copy hygiene: no reactions to who commands, no death, no numbered districts, capitals unnamed", () => {
  const texts: string[] = [];
  collectStrings(LEGACY_COPY, texts);
  collectStrings(NATIONS, texts);
  collectStrings(EXTERNAL_HOUSES, texts);
  collectStrings(CROWN_TITLES, texts);
  collectStrings(MUSTER_FILE_CLAIMS, texts);
  collectStrings(BANNER_NAME_SUGGESTIONS, texts);
  collectStrings(MEMBER_NAME_POOLS, texts);
  collectStrings(HERALDRY_PRESETS, texts);
  for (const listing of listLegacyPreviews()) {
    texts.push(listing.title, listing.description);
    const state = buildLegacyPreview(listing.id);
    assert.ok(state);
    stateStrings(state, texts);
  }
  for (const outcome of ["victory", "defeat", "draw"] as const) {
    const injury = LEGACY_TEXT.injury("Sample", outcome);
    texts.push(injury.title, injury.body);
  }
  for (const context of ["first", "renewed", "captive", "vow"] as const) {
    const challenge = LEGACY_TEXT.challenge(context, "House Sample", "Solforiz", "House Ashgrove", 12, "Sample");
    texts.push(challenge.title, challenge.body);
  }
  assert.ok(texts.length > 400, `collected ${texts.length} strings`);
  for (const text of texts) {
    assert.doesNotMatch(text, /\bcommand(s|ed|er|ing)?\b/i, `reacts to outcomes, not to who commands: ${text}`);
    assert.doesNotMatch(text, /\b(die|dies|died|dying|death|dead|slain|slay|killed|perish(ed)?|corpse)\b/i, `no death: ${text}`);
    assert.doesNotMatch(text, /\b(district|sector)\s+(\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i, `no numbered districts: ${text}`);
    assert.doesNotMatch(text, /\bplayers?\b/i, `copy addresses your banner or your house: ${text}`);
    const capitals = text.match(/\b\w*\s?capital\b/gi) ?? [];
    for (const mention of capitals) assert.match(mention, /^the capital$/i, `capitals stay unnamed: ${text}`);
  }
});

test("names are original-looking, font-safe and readable", () => {
  const names: string[] = [];
  for (const id of NATION_ORDER) names.push(...BANNER_NAME_SUGGESTIONS[id], ...MEMBER_NAME_POOLS[id].given);
  for (const house of EXTERNAL_HOUSES) names.push(house.name, house.representative.name);
  for (const name of names) assert.match(name, /^[A-Za-z][A-Za-z ,'-]*$/, `${name} renders in every UI font`);
  const given = NATION_ORDER.flatMap((id) => MEMBER_NAME_POOLS[id].given);
  assert.equal(new Set(given).size, given.length, "given names are unique across nations");
  for (const house of EXTERNAL_HOUSES) {
    const first = house.representative.name.split(" ")[0];
    assert.equal(MEMBER_NAME_POOLS[house.nationId].given.indexOf(first), -1, `${house.representative.name} never collides with a founding member`);
  }
});

test("names that open a sentence are capitalised; formal titles read mid-sentence", () => {
  assert.equal(sentenceCase(CROWN_TITLES["kwind-09"]), "The Kwind Zaibatsu");
  assert.equal(LEGACY_TEXT.captivityNotice("Remy", CROWN_TITLES.solforiz, "Solforiz").title, "The Scorched Caliphate of Solforiz holds Remy");
  assert.match(LEGACY_TEXT.captivity("Remy", CROWN_TITLES.solforiz, "Solforiz").body, /is held by the Scorched Caliphate of Solforiz\./);
  assert.equal(LEGACY_TEXT.returnNotice("Remy", CROWN_TITLES.aethelgard).body, "The Blood-Throne of Aethelgard releases Remy under the terms of the Muster.");
  assert.equal(
    LEGACY_TEXT.founding("House Ashgrove", NATIONS.korvenia.polity).body,
    "House Ashgrove is entered in the rolls of the Grand Duchy of Korvenia as a minor banner. In the capital, few yet know its name.",
  );
  const wager = LEGACY_TEXT.wager("Solforiz", "House Ombreval");
  assert.match(wager, /^These are the terms of this Muster conflict against Solforiz\./);
  assert.match(wager, /The rules of chess do not change\.$/);
  assert.match(LEGACY_TEXT.classicCapture("Remy", "b4", "a Pawn of the Solforiz levy").body, /left the board unharmed/);
});
