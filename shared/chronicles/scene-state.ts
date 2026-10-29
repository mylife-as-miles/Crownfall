// The scene state both platforms reduce (docs/chronicles/ARCHITECTURE.md §4.6, M1 scope).
// Desktop holds it in a reducer and Quest embeds it in its menu state, so Back,
// pause and resume behave alike on both. The reducer is pure and total: an
// event it cannot apply (an unknown or hidden entry, another collection's entry,
// bare map ground, a repeated report, a malformed event) returns the very same
// state object, so platforms can skip work when nothing changed.
import { getHotspotRecords, hotspotAt } from "./content";
import { CHRONICLE_REGISTRY } from "./registry";
import type { ChronicleRegistry } from "./registry";
import type { ContentPolicy } from "./status";
import type {
  ChronicleEntry, ChronicleNationId, ChroniclesFocus, ChroniclesLoad, ChroniclesSceneEvent, ChroniclesSceneState,
} from "./types";

export type ChroniclesSceneReducer = (state: ChroniclesSceneState, event: ChroniclesSceneEvent, policy: ContentPolicy) => ChroniclesSceneState;

/** The overview focus. States share this object, and each nation focus is shared the same way. */
export const CHRONICLES_OVERVIEW: ChroniclesFocus = Object.freeze({ kind: "overview" } as const);

// A nation is reached through its map hotspot: its approved Atlas record.
const nationFocus = new Map<ChronicleNationId, ChroniclesFocus>();
const nationEntry = new Map<ChronicleNationId, string>();
const entryNation = new Map<string, ChronicleNationId>();
for (const record of getHotspotRecords()) {
  nationFocus.set(record.nation, Object.freeze({ kind: "nation", nation: record.nation } as const));
  nationEntry.set(record.nation, record.id);
  entryNation.set(record.id, record.nation);
}

// The presentation only moves forward, so a late or repeated report never
// undoes a later one: a context lost after ready falls back to the flat
// painting, and nothing leaves failed. Entering again starts a new state.
const LOAD_ORDER: readonly ChroniclesLoad[] = ["loading", "ready", "flat", "failed"];

const sameFocus = (a: ChroniclesFocus, b: ChroniclesFocus): boolean =>
  a === b || (a.kind === b.kind && (a.kind !== "nation" || (b.kind === "nation" && a.nation === b.nation)));

const next = (state: ChroniclesSceneState, change: Partial<ChroniclesSceneState>): ChroniclesSceneState =>
  Object.freeze({ ...state, ...change });

/** The state the Home tile opens: the Atlas overview with nothing open, while the archive builds. */
export function createChroniclesScene(): ChroniclesSceneState {
  return Object.freeze({ collection: "atlas", focus: CHRONICLES_OVERVIEW, entryId: null, load: "loading" });
}

/** Whether Back has something to close inside the archive. When false, Back returns Home. */
export function canUnwind(state: ChroniclesSceneState): boolean {
  return state.entryId !== null || state.focus.kind !== "overview";
}

/**
 * A reducer over one registry. Rules, M1:
 * - collection: atlas, interregnum or laws; a collection with no visible
 *   entries (the Contested Record today) is refused. A switch clears the focus
 *   and the open entry.
 * - focus: the overview, or a nation while the Atlas is shown. A new focus
 *   closes the open entry.
 * - entry: only an entry of the shown collection that the policy shows. In the
 *   Atlas only a nation's map entry opens, and it brings its nation's focus.
 * - map: image fractions hit-tested through hotspotAt, in the Atlas only; a
 *   hotspot opens its nation's entry, while bare ground and the centre do nothing.
 * - back: closes the entry, then returns the focus to the overview.
 * - loaded: ready, flat or failed, moving forward only.
 */
export function createChroniclesSceneReducer(registry: ChronicleRegistry): ChroniclesSceneReducer {
  const visibleNation = (nation: ChronicleNationId, policy: ContentPolicy): ChroniclesFocus | null => {
    const focus = nationFocus.get(nation), id = nationEntry.get(nation);
    return focus && id !== undefined && registry.entry(id, policy) ? focus : null;
  };
  const open = (state: ChroniclesSceneState, entryId: string, focus: ChroniclesFocus): ChroniclesSceneState =>
    state.entryId === entryId && sameFocus(state.focus, focus) ? state : next(state, { entryId, focus });

  return function reduceScene(state, event, policy) {
    if (!event || typeof event !== "object") return state;
    switch (event.type) {
      case "collection": {
        const { collection } = event;
        if (collection === state.collection || registry.collections(policy).indexOf(collection) < 0) return state;
        return next(state, { collection, focus: CHRONICLES_OVERVIEW, entryId: null });
      }
      case "focus": {
        const wanted = event.focus;
        if (!wanted || typeof wanted !== "object") return state;
        const focus = wanted.kind === "overview" ? CHRONICLES_OVERVIEW
          : wanted.kind === "nation" && state.collection === "atlas" ? visibleNation(wanted.nation, policy) : null;
        return !focus || sameFocus(state.focus, focus) ? state : next(state, { focus, entryId: null });
      }
      case "entry": {
        const entry = registry.entry(event.id, policy);
        if (!entry || entry.collection !== state.collection) return state;
        if (state.collection !== "atlas") return open(state, entry.id, state.focus);
        const nation = entryNation.get(entry.id);
        const focus = nation === undefined ? null : visibleNation(nation, policy);
        return focus ? open(state, entry.id, focus) : state;
      }
      case "map": {
        if (state.collection !== "atlas" || typeof event.x !== "number" || typeof event.y !== "number") return state;
        const record = hotspotAt(event.x, event.y);
        const focus = record && record.nation ? visibleNation(record.nation, policy) : null;
        return record && focus ? open(state, record.id, focus) : state;
      }
      case "back":
        if (state.entryId !== null) return next(state, { entryId: null });
        return state.focus.kind === "overview" ? state : next(state, { focus: CHRONICLES_OVERVIEW });
      case "loaded": {
        const rank = LOAD_ORDER.indexOf(event.result);
        return rank > 0 && rank > LOAD_ORDER.indexOf(state.load) ? next(state, { load: event.result }) : state;
      }
      default:
        return state;
    }
  };
}

/** The reducer both platforms use, over the shared registry. */
export const reduceChroniclesScene: ChroniclesSceneReducer = createChroniclesSceneReducer(CHRONICLE_REGISTRY);

/** The entry the record panel shows, or undefined when none is open or the policy hides it. */
export function getOpenEntry(state: ChroniclesSceneState, policy: ContentPolicy, registry: ChronicleRegistry = CHRONICLE_REGISTRY): ChronicleEntry | undefined {
  if (state.entryId === null) return undefined;
  const entry = registry.entry(state.entryId, policy);
  return entry && entry.collection === state.collection ? entry : undefined;
}
