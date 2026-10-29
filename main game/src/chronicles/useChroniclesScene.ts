// The Chronicles scene state on desktop: the shared reducer under the shared
// content policy, held by React. Inputs send events through `send`, which also
// keeps the latest state in a ref, so Back can ask canUnwind synchronously even
// when two presses arrive before a render. Keyboard focus and hover stay local
// to the screen.
import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import { getChronicleCollections } from "../../../shared/chronicles/registry";
import { canUnwind, createChroniclesScene, getOpenEntry, reduceChroniclesScene } from "../../../shared/chronicles/scene-state";
import { CHRONICLES_CONTENT_POLICY } from "../../../shared/chronicles/status";
import type { ChronicleCollectionId, ChronicleEntry, ChroniclesSceneEvent, ChroniclesSceneState } from "../../../shared/chronicles/types";

const reduce = (state: ChroniclesSceneState, event: ChroniclesSceneEvent) => reduceChroniclesScene(state, event, CHRONICLES_CONTENT_POLICY);

export interface ChroniclesScene {
  state: ChroniclesSceneState;
  /** The entry the record panel shows. */
  entry: ChronicleEntry | undefined;
  /** The collections with something to show, in archive order: the dormant Contested Record is absent. */
  collections: readonly ChronicleCollectionId[];
  /** Applies an event; true when it changed the state. */
  send(event: ChroniclesSceneEvent): boolean;
  /** Back inside the archive: true when it closed something, false when the platform should return Home. */
  unwind(): boolean;
}

export function useChroniclesScene(): ChroniclesScene {
  const [state, dispatch] = useReducer(reduce, undefined, createChroniclesScene);
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; }, [state]);
  const send = useCallback((event: ChroniclesSceneEvent) => {
    const next = reduce(latest.current, event);
    if (next === latest.current) return false;
    latest.current = next;
    dispatch(event);
    return true;
  }, []);
  const unwind = useCallback(() => canUnwind(latest.current) && send({ type: "back" }), [send]);
  return {
    state,
    entry: getOpenEntry(state, CHRONICLES_CONTENT_POLICY),
    collections: getChronicleCollections(CHRONICLES_CONTENT_POLICY),
    send,
    unwind,
  };
}
