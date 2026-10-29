// One event sequence with the scene state expected after each event. Desktop's
// verification suite and Quest's state tests both replay it through their own
// input paths, so the two platforms are held to the same scene behaviour. Every
// step uses approved entries only, so it holds whichever way the switch is set.
import { CHRONICLES_CONTENT_POLICY } from "./status";
import type { ContentPolicy } from "./status";
import type { ChronicleCollectionId, ChronicleNationId, ChroniclesFocus, ChroniclesSceneEvent, ChroniclesSceneState } from "./types";

export interface ChroniclesSceneFixtureStep {
  /** What the step demonstrates, for test and report output. */
  readonly note: string;
  readonly event: ChroniclesSceneEvent;
  /** The whole state after the event. */
  readonly expect: ChroniclesSceneState;
  /** True when the event changes nothing: the reducer returns the very same state object. */
  readonly unchanged: boolean;
  /** canUnwind after the event. When false, the next Back returns Home. */
  readonly canUnwind: boolean;
}

export interface ChroniclesSceneFixture {
  readonly policy: ContentPolicy;
  /** The state the Home tile opens, before the first step. */
  readonly start: ChroniclesSceneState;
  readonly steps: readonly ChroniclesSceneFixtureStep[];
}

const overview: ChroniclesFocus = { kind: "overview" };
const nation = (id: ChronicleNationId): ChroniclesFocus => ({ kind: "nation", nation: id });
const scene = (collection: ChronicleCollectionId, focus: ChroniclesFocus, entryId: string | null): ChroniclesSceneState =>
  ({ collection, focus, entryId, load: "ready" });

type Step = readonly [note: string, event: ChroniclesSceneEvent, expect: ChroniclesSceneState | "unchanged"];

const STEPS: readonly Step[] = [
  ["the archive reports ready", { type: "loaded", result: "ready" }, scene("atlas", overview, null)],
  ["a repeated ready report changes nothing", { type: "loaded", result: "ready" }, "unchanged"],
  ["the map centre selects nothing", { type: "map", x: 0.5, y: 0.5 }, "unchanged"],
  ["bare ground selects nothing", { type: "map", x: 0.45, y: 0.4 }, "unchanged"],
  ["a hotspot opens its nation and the nation's entry", { type: "map", x: 0.15, y: 0.17 }, scene("atlas", nation("korvenia"), "korvenia")],
  ["the same hotspot again changes nothing", { type: "map", x: 0.15, y: 0.17 }, "unchanged"],
  ["another collection's entry is refused", { type: "entry", id: "year-19" }, "unchanged"],
  ["Back closes the entry and keeps the nation", { type: "back" }, scene("atlas", nation("korvenia"), null)],
  ["a nation focus", { type: "focus", focus: { kind: "nation", nation: "solforiz" } }, scene("atlas", nation("solforiz"), null)],
  ["then that nation's entry", { type: "entry", id: "solforiz" }, scene("atlas", nation("solforiz"), "solforiz")],
  ["another nation's entry brings its own focus", { type: "entry", id: "aethelgard" }, scene("atlas", nation("aethelgard"), "aethelgard")],
  ["a collection switch clears the entry and the focus", { type: "collection", collection: "interregnum" }, scene("interregnum", overview, null)],
  ["the map answers only in the Atlas", { type: "map", x: 0.16, y: 0.62 }, "unchanged"],
  ["a nation focus belongs to the Atlas", { type: "focus", focus: { kind: "nation", nation: "kwind-09" } }, "unchanged"],
  ["an entry of the shown collection opens", { type: "entry", id: "year-19" }, scene("interregnum", overview, "year-19")],
  ["an Atlas entry is refused outside the Atlas", { type: "entry", id: "korvenia" }, "unchanged"],
  ["the Contested Record is refused while it has no visible entries", { type: "collection", collection: "contested" }, "unchanged"],
  ["the Laws", { type: "collection", collection: "laws" }, scene("laws", overview, null)],
  ["an article opens", { type: "entry", id: "law-of-the-pawn" }, scene("laws", overview, "law-of-the-pawn")],
  ["Back closes the article", { type: "back" }, scene("laws", overview, null)],
  ["back to the Atlas overview", { type: "collection", collection: "atlas" }, scene("atlas", overview, null)],
  ["a second hotspot opens its nation", { type: "map", x: 0.16, y: 0.62 }, scene("atlas", nation("kwind-09"), "kwind-09")],
  ["Back closes the entry", { type: "back" }, scene("atlas", nation("kwind-09"), null)],
  ["Back returns to the overview", { type: "back" }, scene("atlas", overview, null)],
  ["Back with nothing to close changes nothing, so the platform returns Home", { type: "back" }, "unchanged"],
];

function build(): ChroniclesSceneFixture {
  const start: ChroniclesSceneState = { collection: "atlas", focus: overview, entryId: null, load: "loading" };
  let previous = start;
  const steps = STEPS.map(([note, event, expect]): ChroniclesSceneFixtureStep => {
    const state = expect === "unchanged" ? previous : expect;
    previous = state;
    return { note, event, expect: state, unchanged: expect === "unchanged", canUnwind: state.entryId !== null || state.focus.kind !== "overview" };
  });
  return { policy: CHRONICLES_CONTENT_POLICY, start, steps };
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

/** The parity fixture. Plain data, so it can also be handed to a page as JSON. */
export const CHRONICLES_SCENE_FIXTURE: ChroniclesSceneFixture = deepFreeze(build());
