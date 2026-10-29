// Session, state and persistence for the desktop Legacy screen. The session is
// resolved once, when My Legacy first opens, through the shared persistence
// rules (?legacy=fresh guest, ?legacyPreview=<id> fixtures, stored saves and
// recovery). Every transition goes through reduceLegacy; persistent sessions
// save after each successful transition, and nothing else writes storage.

import { useCallback, useRef, useState } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import { clearLegacy, resolveLegacySession, saveLegacy } from "../../../shared/legacy/domain/persistence";
import type { LegacySession, LegacyStorageLike } from "../../../shared/legacy/domain/persistence";
import { reduceLegacy } from "../../../shared/legacy/domain/reducer";
import { createLegacyState } from "../../../shared/legacy/domain/state";
import type { LegacyEvent, LegacyState } from "../../../shared/legacy/types";
import { getLegacyStorage, legacyTimestamp } from "./storage";

/** The shared session kinds, plus "replacing": a recovery session whose next save replaces the unreadable record. */
export type LegacySessionKind = LegacySession["kind"] | "replacing";

export interface LegacySessionModel {
  kind: LegacySessionKind;
  /** The resolved session as the shared rules described it (labels, preview metadata, errors). */
  session: LegacySession;
  state: LegacyState;
  /** True while transitions are written to this device. */
  persistent: boolean;
  /** Latest save problem, shown until the next successful save. */
  saveError: string | null;
  /** Applies an event; returns the refusal reason, or null on success (including no-ops). */
  dispatch(event: LegacyEvent): string | null;
  /** Recovery and missing-preview sessions: continue in memory without touching storage. */
  continueAsGuest(): void;
  /** Recovery: found a new banner whose first save replaces the unreadable record. */
  beginReplacement(): void;
  /** Dissolves the banner (after the caller's confirmation) and returns to founding. */
  dissolve(): string | null;
}

function initialSession(): { session: LegacySession; storage: LegacyStorageLike | null } {
  const storage = getLegacyStorage();
  const session = resolveLegacySession(window.location.search, storage, { at: legacyTimestamp() });
  return { session, storage };
}

export function useLegacySession(): LegacySessionModel {
  const [initial] = useState(initialSession);
  const storage = initial.storage;
  const [kind, setKind] = useState<LegacySessionKind>(initial.session.kind);
  const [state, setState] = useState<LegacyState>(initial.session.state);
  const [saveError, setSaveError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const kindRef = useRef<LegacySessionKind>(kind);

  const persistentKind = (value: LegacySessionKind) => value === "stored" || value === "new" || value === "replacing";
  const persist = useCallback((next: LegacyState) => {
    if (!persistentKind(kindRef.current) || !storage) return;
    const result = saveLegacy(storage, next);
    if (result.ok === false) {
      setSaveError(result.error);
      return;
    }
    setSaveError(null);
    if (kindRef.current !== "stored") {
      kindRef.current = "stored";
      setKind("stored");
    }
  }, [storage]);

  const commit = useCallback((next: LegacyState) => {
    stateRef.current = next;
    setState(next);
    persist(next);
  }, [persist]);

  const dispatch = useCallback((event: LegacyEvent): string | null => {
    const transition = reduceLegacy(stateRef.current, event);
    if (transition.error) return transition.error;
    if (transition.state !== stateRef.current) commit(transition.state);
    return null;
  }, [commit]);

  const continueAsGuest = useCallback(() => {
    const fresh = createLegacyState({ at: legacyTimestamp() });
    kindRef.current = "guest";
    setKind("guest");
    stateRef.current = fresh;
    setState(fresh);
    setSaveError(null);
  }, []);

  const beginReplacement = useCallback(() => {
    kindRef.current = "replacing";
    setKind("replacing");
  }, []);

  const dissolve = useCallback((): string | null => {
    if (stateRef.current.mode === "preview") return LEGACY_COPY.preview.label;
    if (persistentKind(kindRef.current) && storage) {
      const cleared = clearLegacy(storage);
      if (cleared.ok === false) return cleared.error;
    }
    const transition = reduceLegacy(stateRef.current, { type: "reset", at: legacyTimestamp() });
    if (transition.error) return transition.error;
    stateRef.current = transition.state;
    setState(transition.state);
    return null;
  }, [storage]);

  return {
    kind,
    session: initial.session,
    state,
    persistent: persistentKind(kind) && storage !== null,
    saveError,
    dispatch,
    continueAsGuest,
    beginReplacement,
    dissolve,
  };
}
