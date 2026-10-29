import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_TEXT } from "../content/copy";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { NATIONS, NATION_ORDER } from "../content/nations";

test("the stored wager is the stated terms as running prose, for every nation", () => {
  for (const nationId of NATION_ORDER) {
    const opponent = NATIONS[getRivalHouse(nationId).nationId].name;
    const allied = getAlliedHouse(nationId).name;
    const terms = LEGACY_TEXT.wagerTerms(opponent, allied);
    const prose = LEGACY_TEXT.wager(opponent, allied);
    assert.ok(prose.startsWith(terms.intro), "the prose opens with the terms' introduction");
    assert.ok(prose.endsWith(terms.closing), "and closes with the same closing");
    for (const term of terms.terms) {
      const sentence = `${term.when}, ${term.then.charAt(0).toLowerCase()}${term.then.slice(1)}`;
      assert.ok(prose.includes(sentence), `${nationId}: the prose states "${sentence}"`);
      assert.match(term.then, /^(They|Victory) /u, "each term continues the prose without lowercasing a name");
    }
    assert.ok(prose.includes(allied), `${nationId}: the allied house keeps its capitals in the prose`);
  }
});

test("the terms state every consequence of a Muster conflict before the match", () => {
  const terms = LEGACY_TEXT.wagerTerms("Solforiz", "House Ombreval");
  const text = terms.terms.map((term) => `${term.when} ${term.then}`).join(" ");
  assert.match(text, /held captive until your house wins a later Muster against Solforiz/u, "captivity in defeat, and the way home");
  assert.match(text, /wounded and recover after one further recorded match/u, "a wound in victory or a draw");
  assert.match(text, /recognition and House Ombreval's favour; defeat costs that favour/u, "recognition, or the ally's favour lost");
  assert.match(text, /House Ombreval's representative is taken/u, "the ally's own representative");
  assert.match(text, /accounting/u);
  assert.equal(terms.closing, "The rules of chess do not change.");
});
