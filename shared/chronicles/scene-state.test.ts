import assert from "node:assert/strict";
import test from "node:test";
import { RELIEF_SEGMENTS, buildReliefMesh, imageToRelief, intersectRelief, reliefHeightAt, reliefToImage } from "./archive/relief";
import {
  CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLE_RECORDS, CHRONICLES_TITLE, getChronicleRecords, getHotspotRecords,
} from "./content";
import { CHRONICLE_COLLECTIONS, createChronicleRegistry, getChronicleEntries } from "./registry";
import {
  CHRONICLES_OVERVIEW, canUnwind, createChroniclesScene, createChroniclesSceneReducer, getOpenEntry, reduceChroniclesScene,
} from "./scene-state";
import type { ChroniclesSceneReducer } from "./scene-state";
import { CHRONICLES_SCENE_FIXTURE } from "./scene-state.fixture";
import { CHRONICLES_CONTENT_POLICY } from "./status";
import type { ContentPolicy } from "./status";
import type { ChronicleCollectionId, ChronicleEntry, ChronicleNationId, ChroniclesFocus, ChroniclesSceneEvent, ChroniclesSceneState } from "./types";

const OFF: ContentPolicy = { showUnapproved: false };
const ON: ContentPolicy = { showUnapproved: true };
const POLICIES = [CHRONICLES_CONTENT_POLICY, ON, OFF] as const;
const overview = { kind: "overview" } as const;
const nationFocus = (nation: ChronicleNationId) => ({ kind: "nation", nation }) as const;
const scene = (collection: ChronicleCollectionId, focus: ChroniclesFocus, entryId: string | null, load: ChroniclesSceneState["load"] = "ready") =>
  ({ collection, focus, entryId, load });

const reduce = (state: ChroniclesSceneState, event: ChroniclesSceneEvent, policy: ContentPolicy = CHRONICLES_CONTENT_POLICY) =>
  reduceChroniclesScene(state, event, policy);
const apply = (state: ChroniclesSceneState, events: readonly ChroniclesSceneEvent[], policy: ContentPolicy = CHRONICLES_CONTENT_POLICY,
  reducer: ChroniclesSceneReducer = reduceChroniclesScene) => events.reduce((current, event) => reducer(current, event, policy), state);
const ready = () => reduce(createChroniclesScene(), { type: "loaded", result: "ready" });
const show = (collection: ChronicleCollectionId) => reduce(ready(), { type: "collection", collection });
const hit = (nation: ChronicleNationId): ChroniclesSceneEvent => {
  const { hotspot } = getHotspotRecords().find((record) => record.nation === nation)!;
  return { type: "map", x: hotspot.x, y: hotspot.y };
};
const BACK: ChroniclesSceneEvent = { type: "back" };

// Development fixtures for these tests only: never content and never shipped.
const fixture = (change: Partial<ChronicleEntry>): ChronicleEntry => ({
  id: "fixture-proposal", collection: "laws", canonStatus: "working-proposal", title: "Fixture proposal", body: "Development fixture text.", ...change,
});

// Every kind of event, valid and not, for the identity and policy sweeps.
const EVENTS: readonly ChroniclesSceneEvent[] = [
  ...(["ready", "flat", "failed", "loading", "done"] as const).map((result) => ({ type: "loaded", result }) as ChroniclesSceneEvent),
  ...[...CHRONICLE_COLLECTIONS, "annals"].map((collection) => ({ type: "collection", collection }) as ChroniclesSceneEvent),
  { type: "focus", focus: { kind: "overview" } },
  ...getHotspotRecords().map((record): ChroniclesSceneEvent => ({ type: "focus", focus: nationFocus(record.nation) })),
  { type: "focus", focus: { kind: "nation", nation: "elsewhere" } } as unknown as ChroniclesSceneEvent,
  { type: "focus", focus: { kind: "event", eventId: "year-19" } } as unknown as ChroniclesSceneEvent,
  { type: "focus", focus: null } as unknown as ChroniclesSceneEvent,
  ...[...CHRONICLE_RECORDS.map((record) => record.id), "unknown", ""].map((id): ChroniclesSceneEvent => ({ type: "entry", id })),
  { type: "entry", id: 7 } as unknown as ChroniclesSceneEvent,
  ...getHotspotRecords().map((record) => hit(record.nation)),
  ...[[0.5, 0.5], [0.45, 0.4], [0.02, 0.95], [NaN, 0.2], [0.15, Infinity]].map(([x, y]): ChroniclesSceneEvent => ({ type: "map", x, y })),
  { type: "map", x: "0.15", y: "0.17" } as unknown as ChroniclesSceneEvent,
  { type: "map" } as unknown as ChroniclesSceneEvent,
  BACK,
  ...[null, undefined, {}, { type: "unknown" }, "back", 42].map((event) => event as unknown as ChroniclesSceneEvent),
];

/** Every state the shared reducer can reach from the Home tile with the events above. */
function reachableStates(policy: ContentPolicy, reducer: ChroniclesSceneReducer = reduceChroniclesScene): ChroniclesSceneState[] {
  const states = [createChroniclesScene()];
  const seen = new Set(states.map((state) => JSON.stringify(state)));
  for (let index = 0; index < states.length; index++) {
    for (const event of EVENTS) {
      const next = reducer(states[index], event, policy);
      const key = JSON.stringify(next);
      if (!seen.has(key)) { seen.add(key); states.push(next); }
    }
  }
  return states;
}

test("the Home tile opens the Atlas overview, with nothing open while the archive builds", () => {
  const state = createChroniclesScene();
  assert.deepEqual(state, scene("atlas", overview, null, "loading"));
  assert.equal(state.focus, CHRONICLES_OVERVIEW);
  assert.equal(canUnwind(state), false);
  assert.equal(getOpenEntry(state, ON), undefined);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.focus));
  assert.notEqual(createChroniclesScene(), state, "each visit starts from a fresh state");
});

test("a collection switch clears the entry and the focus; the Contested Record and unknown ids are refused", () => {
  const atlas = reduce(ready(), hit("korvenia"));
  assert.deepEqual(atlas, scene("atlas", nationFocus("korvenia"), "korvenia"));
  for (const collection of ["interregnum", "laws"] as const) {
    const switched = reduce(atlas, { type: "collection", collection });
    assert.deepEqual(switched, scene(collection, overview, null));
    assert.equal(switched.focus, CHRONICLES_OVERVIEW);
    const opened = reduce(switched, { type: "entry", id: getChronicleRecords(collection)[0].id });
    assert.deepEqual(reduce(opened, { type: "collection", collection: "atlas" }), scene("atlas", overview, null));
  }
  for (const policy of POLICIES) {
    assert.equal(reduce(atlas, { type: "collection", collection: "contested" }, policy), atlas, "dormant while it has no visible entries");
    assert.equal(reduce(atlas, { type: "collection", collection: "atlas" }, policy), atlas, "the shown collection again changes nothing");
    for (const collection of ["annals", "", "ATLAS", undefined, null, 3]) {
      assert.equal(reduce(atlas, { type: "collection", collection } as unknown as ChroniclesSceneEvent, policy), atlas, String(collection));
    }
  }
  // Once the Contested Record has a visible entry it opens, and the switch off makes it dormant again.
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [fixture({ id: "fixture-contested", collection: "contested" })]);
  const reducer = createChroniclesSceneReducer(registry);
  const contested = reducer(atlas, { type: "collection", collection: "contested" }, ON);
  assert.deepEqual(contested, scene("contested", overview, null));
  assert.equal(reducer(contested, { type: "entry", id: "fixture-contested" }, ON).entryId, "fixture-contested");
  assert.equal(reducer(atlas, { type: "collection", collection: "contested" }, OFF), atlas);
  assert.equal(reducer(contested, { type: "entry", id: "fixture-contested" }, OFF), contested);
});

test("a record from another collection is rejected", () => {
  for (const exhibit of CHRONICLE_EXHIBITS) {
    const closed = exhibit.id === "atlas" ? ready() : show(exhibit.id);
    const own = getChronicleRecords(exhibit.id)[0];
    const opened = reduce(closed, { type: "entry", id: own.id });
    assert.equal(opened.entryId, own.id, exhibit.id);
    for (const state of [closed, opened]) {
      for (const record of CHRONICLE_RECORDS.filter((item) => item.exhibit !== exhibit.id)) {
        assert.equal(reduce(state, { type: "entry", id: record.id }), state, `${record.id} stays out of ${exhibit.id}`);
      }
      for (const id of ["unknown", "", "KORVENIA", undefined, 7]) {
        assert.equal(reduce(state, { type: "entry", id } as unknown as ChroniclesSceneEvent), state, String(id));
      }
    }
  }
});

test("a nation focus, then an entry", () => {
  const focused = reduce(ready(), { type: "focus", focus: nationFocus("korvenia") });
  assert.deepEqual(focused, scene("atlas", nationFocus("korvenia"), null));
  assert.equal(canUnwind(focused), true);
  const opened = reduce(focused, { type: "entry", id: "korvenia" });
  assert.deepEqual(opened, scene("atlas", nationFocus("korvenia"), "korvenia"));
  assert.equal(opened.focus, focused.focus, "the focus object is kept");
  assert.equal(getOpenEntry(opened, ON), getChronicleEntries(ON)[0]);
  assert.equal(reduce(opened, { type: "focus", focus: nationFocus("korvenia") }), opened, "the same nation again keeps its entry");
  assert.deepEqual(reduce(opened, { type: "focus", focus: nationFocus("aethelgard") }), scene("atlas", nationFocus("aethelgard"), null), "a new nation closes the entry");
  assert.deepEqual(reduce(opened, { type: "focus", focus: overview }), scene("atlas", overview, null), "the overview closes it too");
  assert.equal(reduce(opened, { type: "focus", focus: { kind: "nation", nation: "elsewhere" } } as unknown as ChroniclesSceneEvent), opened);
  const laws = show("laws");
  assert.equal(reduce(laws, { type: "focus", focus: nationFocus("korvenia") }), laws, "a nation focus belongs to the Atlas");
  assert.equal(reduce(laws, { type: "focus", focus: overview }), laws);
  for (const record of getHotspotRecords()) {
    const state = reduce(ready(), { type: "entry", id: record.id });
    assert.deepEqual(state, scene("atlas", nationFocus(record.nation), record.id), "a nation's entry brings its focus");
    assert.equal(state.focus, reduce(ready(), { type: "focus", focus: nationFocus(record.nation) }).focus, "nation focuses are shared objects");
  }
});

test("Atlas entries open only from a nation hotspot", () => {
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [fixture({ id: "fixture-atlas-note", collection: "atlas", nation: "korvenia" })]);
  const reducer = createChroniclesSceneReducer(registry);
  assert.ok(registry.entry("fixture-atlas-note", ON), "the fixture is visible");
  const atlas = reducer(ready(), { type: "focus", focus: nationFocus("korvenia") }, ON);
  assert.equal(reducer(atlas, { type: "entry", id: "fixture-atlas-note" }, ON), atlas, "an Atlas entry without a hotspot does not open, even in its nation");
  assert.equal(reducer(ready(), { type: "entry", id: "fixture-atlas-note" }, ON).entryId, null);
  assert.equal(reducer(atlas, { type: "entry", id: "korvenia" }, ON).entryId, "korvenia");
});

test("a map hit opens its nation, while the centre and empty ground do nothing", () => {
  const atlas = ready();
  for (const record of getHotspotRecords()) {
    const { x, y } = record.hotspot;
    const opened = reduce(atlas, { type: "map", x, y });
    assert.deepEqual(opened, scene("atlas", nationFocus(record.nation), record.id), record.id);
    assert.equal(reduce(atlas, { type: "map", x: x + 0.029, y }).entryId, record.id, "inside the hotspot");
    assert.equal(reduce(atlas, { type: "map", x: x + 0.031, y }), atlas, "just outside it");
    assert.equal(reduce(opened, { type: "map", x, y }), opened, "the open nation again changes nothing");
    for (const other of getHotspotRecords().filter((item) => item !== record)) {
      assert.deepEqual(reduce(opened, hit(other.nation)), scene("atlas", nationFocus(other.nation), other.id), "another hotspot moves to its nation");
    }
  }
  for (const [x, y] of [[0.5, 0.5], [0.45, 0.4], [0.5, 0.2], [0.5, 0.8], [0.02, 0.95], [0, 0], [1, 1], [-1, -1], [NaN, 0.2], [0.15, Infinity]]) {
    assert.equal(reduce(atlas, { type: "map", x, y }), atlas, `empty ground at ${x}, ${y}`);
  }
  for (const event of [{ type: "map", x: "0.15", y: "0.17" }, { type: "map" }, { type: "map", x: 0.15 }]) {
    assert.equal(reduce(atlas, event as unknown as ChroniclesSceneEvent), atlas, JSON.stringify(event));
  }
  for (const collection of ["interregnum", "laws"] as const) {
    const state = show(collection);
    assert.equal(reduce(state, hit("korvenia")), state, `the map does not answer in ${collection}`);
  }
});

test("Back unwinds entry, then focus, then overview, where canUnwind turns false", () => {
  let state = reduce(ready(), hit("aethelgard"));
  assert.equal(canUnwind(state), true);
  state = reduce(state, BACK);
  assert.deepEqual(state, scene("atlas", nationFocus("aethelgard"), null));
  assert.equal(canUnwind(state), true);
  state = reduce(state, BACK);
  assert.deepEqual(state, scene("atlas", overview, null));
  assert.equal(state.focus, CHRONICLES_OVERVIEW);
  assert.equal(canUnwind(state), false, "the platform returns Home on the next Back");
  assert.equal(reduce(state, BACK), state);

  let laws = apply(show("laws"), [{ type: "entry", id: "the-muster" }]);
  assert.equal(canUnwind(laws), true);
  laws = reduce(laws, BACK);
  assert.deepEqual(laws, scene("laws", overview, null));
  assert.equal(canUnwind(laws), false);
  assert.equal(reduce(laws, BACK), laws);
});

test("loaded moves forward only: ready, then the flat fallback, then failed", () => {
  const loading = createChroniclesScene();
  for (const result of ["ready", "flat", "failed"] as const) {
    const loaded = reduce(loading, { type: "loaded", result });
    assert.deepEqual(loaded, { ...loading, load: result }, result);
  }
  const ok = reduce(loading, { type: "loaded", result: "ready" });
  assert.equal(reduce(ok, { type: "loaded", result: "ready" }), ok, "a repeated report changes nothing");
  const flat = reduce(ok, { type: "loaded", result: "flat" });
  assert.equal(flat.load, "flat", "a context lost after ready falls back to the flat painting");
  assert.equal(reduce(flat, { type: "loaded", result: "ready" }), flat, "a late ready never undoes the fallback");
  const failed = reduce(flat, { type: "loaded", result: "failed" });
  assert.equal(failed.load, "failed");
  for (const result of ["ready", "flat", "failed", "loading", "done", undefined]) {
    assert.equal(reduce(failed, { type: "loaded", result } as unknown as ChroniclesSceneEvent), failed, String(result));
  }
  assert.equal(reduce(ok, { type: "loaded", result: "loading" } as unknown as ChroniclesSceneEvent), ok, "nothing returns to loading");
  // The presentation never decides what may open: records open while building, in 3D and on the flat painting.
  for (const state of [loading, ok, flat, failed]) {
    const opened = reduce(state, hit("solforiz"));
    assert.equal(opened.entryId, "solforiz");
    assert.equal(opened.load, state.load, "navigation keeps the presentation");
  }
});

test("every no-op returns the same object, and every change is a new frozen state that leaves its input intact", () => {
  for (const policy of [ON, OFF]) {
    const states = reachableStates(policy);
    assert.equal(states.length, 72, "18 navigation states in each of the four presentations");
    let unchanged = 0, changed = 0;
    for (const state of states) {
      const before = JSON.stringify(state);
      for (const event of EVENTS) {
        const next = reduceChroniclesScene(state, event, policy);
        assert.equal(JSON.stringify(state), before, "the input is never mutated");
        if (JSON.stringify(next) === before) {
          assert.equal(next, state, `${JSON.stringify(event)} on ${before} must return the same object`);
          unchanged++;
        } else {
          assert.ok(Object.isFrozen(next), "a changed state is frozen");
          changed++;
        }
      }
    }
    assert.ok(unchanged > 0 && changed > 0);
  }
});

test("M1 ships no proposal, so the reducer behaves alike whichever way the switch is set", () => {
  for (const state of reachableStates(ON)) {
    for (const event of EVENTS) assert.deepEqual(reduceChroniclesScene(state, event, ON), reduceChroniclesScene(state, event, OFF));
  }
});

test("a hidden entry never opens, and a state still holding one shows nothing", () => {
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [fixture({ id: "fixture-timeline-note", collection: "interregnum" })]);
  const reducer = createChroniclesSceneReducer(registry);
  const interregnum = reducer(ready(), { type: "collection", collection: "interregnum" }, ON);
  const opened = reducer(interregnum, { type: "entry", id: "fixture-timeline-note" }, ON);
  assert.equal(opened.entryId, "fixture-timeline-note", "with the switch on it opens");
  assert.equal(getOpenEntry(opened, ON, registry)?.canonStatus, "working-proposal");
  assert.equal(reducer(interregnum, { type: "entry", id: "fixture-timeline-note" }, OFF), interregnum, "with the switch off it never opens");
  assert.equal(getOpenEntry(opened, OFF, registry), undefined, "a state that still holds it shows nothing once the switch is off");
  assert.equal(reducer(opened, BACK, OFF).entryId, null, "and Back still closes it");
  assert.equal(getOpenEntry(scene("laws", overview, "year-19"), ON), undefined, "an entry of another collection is never shown");
});

test("the parity fixture replays exactly, under the content policy and either switch value", () => {
  const { policy, start, steps } = CHRONICLES_SCENE_FIXTURE;
  assert.equal(policy, CHRONICLES_CONTENT_POLICY);
  assert.deepEqual(start, createChroniclesScene());
  for (const replayPolicy of [policy, ON, OFF]) {
    let state = createChroniclesScene();
    steps.forEach((step, index) => {
      const next = reduceChroniclesScene(state, step.event, replayPolicy);
      const where = `step ${index + 1} (${step.note})`;
      assert.deepEqual(next, step.expect, where);
      assert.equal(next === state, step.unchanged, `${where}: identity`);
      assert.equal(canUnwind(next), step.canUnwind, `${where}: canUnwind`);
      state = next;
    });
  }
});

test("the fixture is frozen plain data covering every M1 event, applied and refused, and ends where Back returns Home", () => {
  const { steps } = CHRONICLES_SCENE_FIXTURE;
  assert.deepEqual(JSON.parse(JSON.stringify(CHRONICLES_SCENE_FIXTURE)), CHRONICLES_SCENE_FIXTURE);
  assert.ok(Object.isFrozen(CHRONICLES_SCENE_FIXTURE) && Object.isFrozen(steps));
  for (const step of steps) assert.ok([step, step.event, step.expect, step.expect.focus].every(Object.isFrozen), step.note);
  const types = [...new Set(steps.map((step) => step.event.type))].sort();
  assert.deepEqual(types, ["back", "collection", "entry", "focus", "loaded", "map"]);
  for (const type of types) {
    assert.ok(steps.some((step) => step.event.type === type && !step.unchanged), `${type} applied`);
    assert.ok(steps.some((step) => step.event.type === type && step.unchanged), `${type} refused`);
  }
  assert.deepEqual([...new Set(steps.map((step) => step.expect.collection))].sort(), ["atlas", "interregnum", "laws"]);
  const nations = new Set(steps.map((step) => step.expect.focus).filter((focus) => focus.kind === "nation").map((focus) => focus.kind === "nation" && focus.nation));
  assert.equal(nations.size, getHotspotRecords().length, "every nation is focused once");
  const last = steps[steps.length - 1];
  assert.ok(last.event.type === "back" && last.unchanged && !last.canUnwind);
  assert.ok(steps.some((step) => step.event.type === "back" && !step.unchanged && step.expect.focus.kind === "overview" && step.expect.collection === "atlas"),
    "Back unwinds a nation focus to the overview");
});

// The seven Brief E Quest Chronicles behaviours (main-game-vr/src/quest-state.test.ts), restated against the shared reducer.

test("Brief E behaviour 1: the Chronicles Home tile opens the archive at the Atlas", () => {
  const state = createChroniclesScene();
  assert.equal(state.collection, "atlas");
  assert.equal(state.entryId, null);
  const left = apply(state, [{ type: "loaded", result: "ready" }, { type: "collection", collection: "laws" }, { type: "entry", id: "the-muster" }, BACK]);
  assert.equal(canUnwind(left), false, "Back from here returns Home");
  assert.deepEqual(createChroniclesScene(), scene("atlas", overview, null, "loading"), "the Home tile reopens the Atlas");
});

test("Brief E behaviour 2: exhibits switch, each kind of record opens, and records stay within their exhibit", () => {
  let state = ready();
  for (const exhibit of CHRONICLE_EXHIBITS) {
    state = reduce(state, { type: "collection", collection: exhibit.id });
    assert.equal(state.collection, exhibit.id);
    assert.equal(state.entryId, null);
    for (const record of getChronicleRecords(exhibit.id)) {
      state = reduce(state, { type: "entry", id: record.id });
      assert.equal(state.entryId, record.id);
      assert.equal(getOpenEntry(state, CHRONICLES_CONTENT_POLICY)?.title, record.title);
    }
    const other = CHRONICLE_EXHIBITS.find((item) => item.id !== exhibit.id)!;
    assert.equal(reduce(state, { type: "entry", id: getChronicleRecords(other.id)[0].id }), state, "another exhibit's record is rejected");
    assert.equal(reduce(state, { type: "entry", id: "unknown" }), state);
    const switched = reduce(state, { type: "collection", collection: other.id });
    assert.equal(switched.collection, other.id);
    assert.equal(switched.entryId, null, "switching exhibits closes the record");
  }
  assert.equal(reduce(state, { type: "collection", collection: "unknown" } as unknown as ChroniclesSceneEvent), state);
});

test("Brief E behaviour 3: each map hotspot opens its nation while empty ground and the centre do nothing", () => {
  const atlas = ready();
  for (const record of getHotspotRecords()) {
    assert.equal(reduce(atlas, { type: "map", x: record.hotspot.x, y: record.hotspot.y }).entryId, record.id);
    assert.equal(reduce(atlas, { type: "entry", id: record.id }).entryId, record.id);
  }
  for (const [x, y] of [[0.5, 0.5], [0.45, 0.4], [0.02, 0.95], [NaN, 0.2], [-1, -1]]) assert.equal(reduce(atlas, { type: "map", x, y }), atlas, `empty ground at ${x}, ${y}`);
  const laws = reduce(atlas, { type: "collection", collection: "laws" });
  assert.equal(reduce(laws, { type: "map", x: 0.15, y: 0.17 }), laws, "the map only answers on the Atlas");
});

test("Brief E behaviour 4: a ray onto the Atlas relief's bare ground selects only where a hotspot is", () => {
  // A seated eye looks down on the Quest relief from the south; the ray hit becomes map fractions for the reducer.
  const width = 0.95, mesh = buildReliefMesh(width, RELIEF_SEGMENTS.quest), eye = [0, 0.5, mesh.depth / 2 + 0.36] as const;
  const atlas = ready();
  const pick = (x: number, y: number) => {
    const [tx, tz] = imageToRelief(x, y, width), ty = reliefHeightAt(x, y) * width;
    const t = intersectRelief(mesh, eye[0], eye[1], eye[2], tx - eye[0], ty - eye[1], tz - eye[2]);
    assert.ok(t > 0, `the ray reaches the relief at ${x}, ${y}`);
    const [hx, hy] = reliefToImage(eye[0] + (tx - eye[0]) * t, eye[2] + (tz - eye[2]) * t, width);
    return reduce(atlas, { type: "map", x: hx, y: hy });
  };
  for (const [x, y] of [[0.5, 0.5], [0.4, 0.35], [0.62, 0.86]]) assert.equal(pick(x, y), atlas, `bare ground at ${x}, ${y}`);
  for (const record of getHotspotRecords()) assert.equal(pick(record.hotspot.x, record.hotspot.y).entryId, record.id);
});

test("Brief E behaviour 5: Back closes an open record first, then returns Home", () => {
  // The archive adds one level: Back from an Atlas record keeps its nation, and the next Back returns to the overview.
  let state = reduce(ready(), { type: "entry", id: "aethelgard" });
  state = reduce(state, BACK);
  assert.equal(state.entryId, null);
  state = reduce(state, BACK);
  assert.equal(canUnwind(state), false, "the next Back returns Home");
  const laws = apply(ready(), [{ type: "collection", collection: "laws" }, { type: "entry", id: "law-of-the-pawn" }, BACK]);
  assert.equal(laws.entryId, null);
  assert.equal(canUnwind(laws), false, "outside the Atlas, the second Back returns Home as before");
  assert.equal(createChroniclesScene().collection, "atlas", "the Home tile reopens the Atlas");
});

test("Brief E behaviour 6: pause and resume keep the exhibit and the open record", () => {
  const original = apply(ready(), [{ type: "collection", collection: "interregnum" }, { type: "entry", id: "year-19" }]);
  // Pausing holds the state as a value: the reducer keeps no clock, timer or hidden state,
  // so a held copy resumes exactly where the original stood.
  const held = JSON.parse(JSON.stringify(original)) as ChroniclesSceneState;
  assert.deepEqual(held, original);
  for (const event of EVENTS) assert.deepEqual(reduce(held, event), reduce(original, event), JSON.stringify(event));
  assert.equal(reduce(held, { type: "entry", id: "year-19" }), held, "a no-op on the held copy returns the copy itself");
  const heldNation = JSON.parse(JSON.stringify(reduce(ready(), hit("solforiz")))) as ChroniclesSceneState;
  assert.equal(reduce(heldNation, hit("solforiz")), heldNation, "a held nation focus still compares equal");
  assert.throws(() => { (original as { entryId: string | null }).entryId = null; }, TypeError, "a held state cannot change behind the reducer");
});

test("Brief E behaviour 7: every entry the reducer opens renders exactly on Quest except its dashes", () => {
  // UIKitML builds each @font-face Barlow atlas with UIKit's default TTF charset (see quest-state.test.ts).
  const atlas = new Set(" \tABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,;:'\"()-[]{}@#$%&*+=/\\<>");
  const renderable = (value: string) => {
    for (const glyph of value.replace(/[–—]/gu, "-")) assert.ok(atlas.has(glyph), `${JSON.stringify(glyph)} in ${value}`);
  };
  for (const policy of [ON, OFF]) {
    for (const entry of getChronicleEntries(policy)) {
      const shown = reduce(show(entry.collection), { type: "entry", id: entry.id }, policy);
      assert.equal(getOpenEntry(shown, policy), entry, `${entry.id} opens`);
      const record = CHRONICLE_RECORDS.find((item) => item.id === entry.id)!;
      assert.ok(Object.is(entry.title, record.title) && Object.is(entry.body, record.body), `${entry.id} is the approved text itself`);
      renderable(entry.title);
      renderable(entry.body);
    }
  }
  for (const value of [CHRONICLES_TITLE, ...CHRONICLE_EXHIBITS.map((item) => item.title), ...Object.values(CHRONICLE_LABELS).flatMap((item) => [item.name, item.meaning])]) renderable(value);
});
