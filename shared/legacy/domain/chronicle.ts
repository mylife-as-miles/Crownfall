// War Record bookkeeping. Entries are append-only and their ids are the
// 1-based sequence number, so the same events always produce the same ids.

import type { ChronicleEntry, ChronicleKind, LegacyState } from "../types";
import type { LegacyText } from "../content/copy";

function pad4(value: number): string {
  const text = String(value);
  return text.length >= 4 ? text : "0000".slice(text.length) + text;
}

export function chronicleEntryId(sequence: number): string {
  return `chr-${pad4(sequence)}`;
}

export function noticeId(sequence: number): string {
  return `notice-${pad4(sequence)}`;
}

/** Unresolved matters take the id of the entry or notice that opened them. */
export function matterId(sourceId: string): string {
  return `matter-${sourceId}`;
}

export interface ChronicleDraft {
  kind: ChronicleKind;
  text: LegacyText;
  at: string;
  matchIndex: number | null;
  prominence: ChronicleEntry["prominence"];
  refs?: ChronicleEntry["refs"];
}

/** Appends to a chronicle array the caller already owns (never the input state's array). */
export function appendChronicle(chronicle: ChronicleEntry[], draft: ChronicleDraft): ChronicleEntry {
  const entry: ChronicleEntry = {
    id: chronicleEntryId(chronicle.length + 1),
    kind: draft.kind,
    matchIndex: draft.matchIndex,
    title: draft.text.title,
    body: draft.text.body,
    at: draft.at,
    prominence: draft.prominence,
    refs: draft.refs ? { ...draft.refs } : {},
  };
  chronicle.push(entry);
  return entry;
}

export function findChronicleEntry(state: Pick<LegacyState, "chronicle">, id: string): ChronicleEntry | null {
  for (const entry of state.chronicle) if (entry.id === id) return entry;
  return null;
}

/** Chronicle entries newest first, for ledger views. */
export function chronicleNewestFirst(state: Pick<LegacyState, "chronicle">): ChronicleEntry[] {
  return state.chronicle.slice().reverse();
}
