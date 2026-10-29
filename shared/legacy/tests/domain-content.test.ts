import assert from "node:assert/strict";
import test from "node:test";
import { END_REASON_PHRASES, LEGACY_COPY, LEGACY_TEXT, PIECE_NAMES, closeAppositive, sentenceCase } from "../content/copy";
import type { LegacyText } from "../content/copy";
import {
  CHARGES, DIVISIONS, HERALDRY_PRESETS, ORDINARIES, TINCTURES, defaultHeraldry, describeHeraldry, tinctureAdvisory,
  tinctureInfo, validateHeraldry,
} from "../content/heraldry";
import { CROWN_TITLES, EXTERNAL_HOUSES, NATION_HOUSES, getAlliedHouse, getRivalHouse } from "../content/houses";
import { MUSTER_FILE_CLAIMS, eligibleMusterFiles } from "../content/muster";
import { BANNER_NAME_SUGGESTIONS, MEMBER_NAME_POOLS, suggestBannerNames } from "../content/names";
import { LEGACY_NATION_AVAILABILITY, NATIONS, NATION_ORDER, UNNAMED_CAPITAL, listFoundableNations } from "../content/nations";
import { TINCTURE_SRGB } from "../environment-contract";
import { AFTERMATH_BODY_BUDGET, AFTERMATH_TITLE_BUDGET, prominentAftermath } from "../domain/aftermath";
import { buildLegacyPreview, listLegacyPreviews } from "../domain/fixtures";
import { validateBannerName } from "../domain/founding";
import { createMusterFormation, standardPieceAt } from "../domain/formation";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { LegacyState, MatchEndReason, NationId } from "../types";

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

/** Every string the LEGACY_TEXT builders produce, calling each with sample text for every argument. */
function collectBuilt(value: unknown, out: string[]): void {
  if (typeof value === "function") collectStrings((value as (...args: unknown[]) => unknown)("Sample", "Sample", "Sample", "Sample", "Sample", "Sample"), out);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectBuilt(item, out);
}

function stateStrings(state: LegacyState, out: string[]): void {
  for (const entry of state.chronicle) out.push(entry.title, entry.body);
  for (const notice of state.notices) out.push(notice.title, notice.body, notice.wager ?? "");
  for (const matter of state.unresolved) out.push(matter.title, matter.body);
  for (const member of state.members) out.push(member.name, member.epithet, member.origin);
}

/**
 * Words player-facing copy never uses, with the reason. "Chronicle" is the
 * domain's internal term only: the house's record is the War Record, and
 * Chronicles is the separate world archive on Home.
 */
const FORBIDDEN_TERMS: readonly (readonly [RegExp, string])[] = [
  [/\bchronicles?\b/i, "the house's record is the War Record; Chronicles is the Home archive"],
  [/hearthstone/i, "echoes another game franchise"],
  [/weirwall/i, "echoes another franchise"],
  [/charter district/i, "no invented district names"],
  [/winterfell|rivendell|gondor|mordor|skyrim|whiterun|ironforge|stormwind|azeroth|westeros|hogwarts|hyrule/i, "echoes another franchise"],
];

test("copy hygiene: no reactions to who commands, no death, no numbered districts, capitals unnamed, no forbidden or borrowed names", () => {
  const texts: string[] = [];
  collectStrings(LEGACY_COPY, texts);
  collectBuilt(LEGACY_TEXT, texts);
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
    for (const [term, reason] of FORBIDDEN_TERMS) assert.doesNotMatch(text, term, `${reason}: ${text}`);
  }
  assert.equal(LEGACY_COPY.landmarks["war-record"].title, "War Record");
  assert.match(LEGACY_COPY.empty.chronicle, /^The War Record /);
  assert.match(LEGACY_COPY.reset.body, /its War Record/);
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
  assert.match(LEGACY_TEXT.captivity("Remy", CROWN_TITLES.solforiz, "Solforiz").body, /^Held by the Scorched Caliphate of Solforiz\./);
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

/** External representatives' names carry a title after a comma ("Idrasa Azhemar, Warden of the Wells"). */
const TITLED_NAMES = EXTERNAL_HOUSES.map((house) => house.representative.name);

/** Every titled name in `text` closes its title with a comma or ends its sentence: never "…, Warden of the Wells of House …". */
function assertTitlesClosed(text: string): void {
  for (const name of TITLED_NAMES) {
    for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + name.length)) {
      const next = text.charAt(index + name.length);
      assert.ok(next === "," || next === ".", `"${name}" leaves its title open in: ${text}`);
    }
  }
}

/** A founded banner of each nation, for formations and labels exactly as the domain builds them. */
function foundedIn(nationId: NationId): LegacyState {
  const transition = reduceLegacy(createLegacyState({ at: "2026-04-01T09:00:00.000Z" }), {
    type: "found-banner", name: "House Ashgrove", nationId, heraldry: defaultHeraldry(nationId), at: "2026-04-01T09:00:00.000Z", seed: 3,
  });
  assert.equal(transition.error, null);
  return transition.state;
}

test("consequence sentences close every representative's title and never read \"of … of\"", () => {
  assert.equal(closeAppositive("Remy"), "Remy");
  assert.equal(closeAppositive("Idrasa Azhemar, Warden of the Wells"), "Idrasa Azhemar, Warden of the Wells,");
  assert.equal(
    LEGACY_TEXT.alliedReaction("House Ombreval", "Gervais Ombreval, the Veiled Lance").body,
    "Gervais Ombreval, the Veiled Lance, was taken in the Muster. House Ombreval holds your banner to account.",
  );
  assert.equal(
    LEGACY_TEXT.grievance("House Azhemar", "Idrasa Azhemar, Warden of the Wells").body,
    "Idrasa Azhemar, Warden of the Wells, was taken by your side in the Muster. House Azhemar will remember it.",
  );
  assert.equal(
    LEGACY_TEXT.rivalVow("House Azhemar", "Idrasa Azhemar, Warden of the Wells").body,
    "House Azhemar vows that a future field will answer for the taking of Idrasa Azhemar, Warden of the Wells.",
  );
  assert.equal(
    LEGACY_TEXT.classicCapture("Ambroise", "c4", "Idrasa Azhemar, Warden of the Wells").body,
    "Taken in a Classic match by Idrasa Azhemar, Warden of the Wells. Ambroise laid down arms and left the board unharmed.",
  );

  const texts: LegacyText[] = [];
  for (const nationId of NATION_ORDER) {
    const ally = getAlliedHouse(nationId);
    const rival = getRivalHouse(nationId);
    texts.push(
      LEGACY_TEXT.alliedReaction(ally.name, ally.representative.name),
      LEGACY_TEXT.alliedDemand(ally.name, ally.representative.name),
      LEGACY_TEXT.grievance(rival.name, rival.representative.name),
      LEGACY_TEXT.rivalVow(rival.name, rival.representative.name),
      LEGACY_TEXT.classicCapture("Ambroise", "c4", rival.representative.name),
    );
  }
  for (const listing of listLegacyPreviews()) {
    const state = buildLegacyPreview(listing.id);
    assert.ok(state);
    texts.push(...state.chronicle, ...state.notices, ...state.unresolved);
  }
  for (const text of texts) {
    assertTitlesClosed(text.title);
    assertTitlesClosed(text.body);
    assert.doesNotMatch(text.body, /\bof House \w+ of\b|\bof [A-Z][\w-]+ of House\b/, `no "of … of": ${text.body}`);
  }
  const allied = buildLegacyPreview("allied-loss")?.chronicle.find((entry) => entry.kind === "allied-reaction");
  assert.equal(allied?.body, `${getAlliedHouse("korvenia").representative.name}, was taken in the Muster. House Ombreval holds your banner to account.`);
});

test("prominent aftermath copy fits its budget for every house, member, nation and captor", () => {
  const members = NATION_ORDER.flatMap((id) => MEMBER_NAME_POOLS[id].given);
  const member = members.reduce((longest, name) => (name.length > longest.length ? name : longest), "");
  const reasons = Object.keys(END_REASON_PHRASES) as MatchEndReason[];
  const checked: string[] = [];
  const fits = (label: string, text: LegacyText): void => {
    assert.ok(text.title.length <= AFTERMATH_TITLE_BUDGET, `${label} title is ${text.title.length} characters: ${text.title}`);
    assert.ok(text.body.length <= AFTERMATH_BODY_BUDGET, `${label} body is ${text.body.length} characters: ${text.body}`);
    checked.push(label);
  };
  for (const nationId of NATION_ORDER) {
    const ally = getAlliedHouse(nationId);
    const rival = getRivalHouse(nationId);
    const state = foundedIn(nationId);
    fits(`${nationId} allied reaction`, LEGACY_TEXT.alliedReaction(ally.name, ally.representative.name));
    fits(`${nationId} grievance`, LEGACY_TEXT.grievance(rival.name, rival.representative.name));
    for (const opponentId of NATION_ORDER) {
      const opponent = NATIONS[opponentId].name;
      // A thousand moves is far beyond any real game; every outcome, reason and stake is measured.
      for (const stakes of ["classic", "muster"] as const) {
        for (const outcome of ["victory", "defeat", "draw"] as const) {
          for (const reason of reasons) fits(`match ${stakes} ${outcome} ${reason}`, LEGACY_TEXT.match(stakes, outcome, reason, 1999, opponent, member));
        }
      }
      for (const captor of [rival.name, CROWN_TITLES[opponentId]]) fits(`captivity by ${captor}`, LEGACY_TEXT.captivity(member, captor, opponent));
      fits(`return from ${opponent}`, LEGACY_TEXT.returned(member, opponent));
      // Every label a capturing piece of this opponent can carry, exactly as the formation writes it.
      const { allegiance } = createMusterFormation(state, { playerSide: "w", opponentNationId: opponentId });
      for (const owed of Object.values(allegiance)) {
        if (owed.side === "b") fits(`classic yield to ${owed.label}`, LEGACY_TEXT.classicCapture(member, "b4", owed.label));
      }
    }
  }
  for (const outcome of ["victory", "draw"] as const) fits(`injury ${outcome}`, LEGACY_TEXT.injury(member, outcome));
  for (const piece of ["n", "b", "r", "q"] as const) {
    for (const laterCaptured of [false, true]) fits(`promotion ${piece}`, LEGACY_TEXT.promotion(member, PIECE_NAMES[piece], laterCaptured));
  }
  assert.ok(checked.length > 500, `measured ${checked.length} texts`);
  for (const listing of listLegacyPreviews()) {
    const state = buildLegacyPreview(listing.id);
    assert.ok(state);
    for (const entry of prominentAftermath(state)) fits(`${listing.id} ${entry.kind}`, entry);
  }
});
