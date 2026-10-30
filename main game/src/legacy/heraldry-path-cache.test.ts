import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeraldry, TINCTURES } from "../../../shared/legacy/content/heraldry";
import { heraldrySvgPaths } from "../../../shared/legacy/heraldry/svg";
import type { HeraldryAspect } from "../../../shared/legacy/heraldry/shapes";
import type { Heraldry } from "../../../shared/legacy/types";
import { cachedHeraldryPaths } from "./heraldry-path-cache";

test("remounted designs reuse exact paths without stale colours, shapes or aspect", () => {
  const base = defaultHeraldry("korvenia");
  const variants: Heraldry[] = [base,
    { ...base, division: "quarterly" },
    { ...base, field: ["azure", base.field[1]] },
    { ...base, field: [base.field[0], "sanguine"] },
    { ...base, ordinary: "bend" },
    { ...base, ordinaryTincture: "argent" },
    { ...base, charge: "key" },
    { ...base, chargeTincture: "vert" },
  ];
  for (const design of variants) {
    for (const aspect of ["shield", "banner", "pennant"] satisfies HeraldryAspect[]) {
      for (const swallowtail of [false, true]) {
        const actual = cachedHeraldryPaths(design, aspect, swallowtail);
        assert.deepEqual(actual, heraldrySvgPaths(design, aspect, { swallowtail }));
        assert.equal(cachedHeraldryPaths({ ...design, field: [...design.field] }, aspect, swallowtail), actual);
      }
    }
  }
});

test("many edits evict old designs while retaining recent exact output", () => {
  const base = defaultHeraldry("solforiz");
  const first = cachedHeraldryPaths(base, "shield", false);
  let recent = first;
  let last = base;
  for (const a of TINCTURES) for (const b of TINCTURES) {
    last = { ...base, field: [a, b] };
    recent = cachedHeraldryPaths(last, "banner", false);
  }
  assert.equal(cachedHeraldryPaths(last, "banner", false), recent);
  const restored = cachedHeraldryPaths(base, "shield", false);
  assert.notEqual(restored, first);
  assert.deepEqual(restored, first);
});
