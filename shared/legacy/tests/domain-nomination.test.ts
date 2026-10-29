import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry } from "../content/heraldry";
import { getAlliedHouse } from "../content/houses";
import { eligibleMusterFiles, musterClaimFor } from "../content/muster";
import { nominationRefusal } from "../domain/nomination";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { FileLetter, LegacyState, NationId } from "../types";

const AT = "2026-02-01T10:00:00.000Z";

function founded(nationId: NationId = "korvenia"): LegacyState {
  const transition = reduceLegacy(createLegacyState({ at: AT }), {
    type: "found-banner", name: "House Ashgrove", nationId, heraldry: defaultHeraldry(nationId), at: AT, seed: 3,
  });
  assert.equal(transition.error, null);
  return transition.state;
}

test("nomination needs a banner, a member of the house and an open file", () => {
  const empty = createLegacyState({ at: AT });
  const refused = reduceLegacy(empty, { type: "nominate", memberId: "member-1", file: "b", at: AT });
  assert.match(refused.error ?? "", /Found a banner/);
  assert.equal(refused.state, empty);
  const state = founded();
  assert.match(nominationRefusal(state, "member-9", "b") ?? "", /does not belong to this house/);
  assert.match(nominationRefusal(state, "member-1", "z" as FileLetter) ?? "", /from a to h/);
  assert.equal(nominationRefusal(state, "member-1", "b"), null);
  const noTime = reduceLegacy(state, { type: "nominate", memberId: "member-1", file: "b", at: "" });
  assert.match(noTime.error ?? "", /timestamp/);
  assert.equal(noTime.state, state);
});

test("claimed files are refused with the claimant named; open files are accepted", () => {
  for (const nationId of ["korvenia", "solforiz", "aethelgard", "kwind-09"] as const) {
    const state = founded(nationId);
    const open = eligibleMusterFiles(nationId);
    for (const file of ["a", "b", "c", "d", "e", "f", "g", "h"] as const) {
      const claim = musterClaimFor(nationId, file);
      const transition = reduceLegacy(state, { type: "nominate", memberId: "member-2", file, at: AT });
      if (claim) {
        assert.equal(transition.error, `The ${file}-file is claimed by ${claim.label}.`, `${nationId} ${file}`);
        assert.equal(transition.state, state);
      } else {
        assert.equal(transition.error, null, `${nationId} ${file}`);
        assert.ok(open.indexOf(file) !== -1);
        assert.deepEqual(transition.state.nomination, { memberId: "member-2", file });
      }
    }
  }
  const ally = getAlliedHouse("korvenia");
  assert.match(nominationRefusal(founded(), "member-1", "d") ?? "", new RegExp(`claimed by ${ally.name}'s household guard`));
});

test("nominating records a chronicle entry, repeats are no-ops and changes are recorded", () => {
  const state = founded();
  const first = reduceLegacy(state, { type: "nominate", memberId: "member-1", file: "b", at: AT });
  assert.equal(first.error, null);
  const entry = first.state.chronicle[first.state.chronicle.length - 1];
  assert.equal(entry.kind, "nomination");
  assert.equal(entry.refs.memberId, "member-1");
  assert.match(entry.body, /will stand on the b-file of the national formation/);
  assert.equal(state.nomination.memberId, null, "the input state is untouched");
  const repeat = reduceLegacy(first.state, { type: "nominate", memberId: "member-1", file: "b", at: AT });
  assert.equal(repeat.error, null);
  assert.equal(repeat.state, first.state);
  const moved = reduceLegacy(first.state, { type: "nominate", memberId: "member-3", file: "h", at: "2026-02-01T11:00:00.000Z" });
  assert.deepEqual(moved.state.nomination, { memberId: "member-3", file: "h" });
  assert.equal(moved.state.chronicle.length, first.state.chronicle.length + 1);
  assert.equal(moved.state.updatedAt, "2026-02-01T11:00:00.000Z");
});
