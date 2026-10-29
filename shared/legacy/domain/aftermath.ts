// Prominent aftermath selection. Every fact is written to the chronicle; the
// UI surfaces at most two prominent entries, chosen by narrative priority.

import type { ChronicleEntry, ChronicleKind, LegacyState } from "../types";

export const MAX_PROMINENT_AFTERMATH = 2;

/**
 * Highest priority first. Kinds not listed never become prominent aftermath.
 * "capture" is prominent only for a representative who yielded in a Classic
 * match; the tally of captures a representative made stays minor.
 */
export const AFTERMATH_PRIORITY: readonly ChronicleKind[] = [
  "captivity", "return", "allied-reaction", "grievance", "promotion", "injury", "capture", "match",
];

/**
 * Prominent aftermath copy is short enough to read whole at a glance: every
 * entry that can become prominent keeps its title and body within these
 * lengths for any house, member, nation and captor, so no platform has to
 * shorten a consequence (domain-content tests enforce the worst cases).
 */
export const AFTERMATH_TITLE_BUDGET = 44;
export const AFTERMATH_BODY_BUDGET = 125;

export function aftermathPriority(kind: ChronicleKind): number {
  const index = AFTERMATH_PRIORITY.indexOf(kind);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * Chooses at most two prominent entry ids from the candidates, by priority and
 * then newest first. Unknown ids, minor entries and non-aftermath kinds are dropped.
 */
export function selectAftermath(chronicle: readonly ChronicleEntry[], candidateIds: readonly string[]): string[] {
  const position = new Map<string, number>();
  chronicle.forEach((entry, index) => position.set(entry.id, index));
  const seen = new Set<string>();
  const candidates: ChronicleEntry[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const index = position.get(id);
    if (index === undefined) continue;
    const entry = chronicle[index];
    if (entry.prominence !== "major" || aftermathPriority(entry.kind) === Number.POSITIVE_INFINITY) continue;
    candidates.push(entry);
  }
  candidates.sort((a, b) => {
    const byPriority = aftermathPriority(a.kind) - aftermathPriority(b.kind);
    if (byPriority !== 0) return byPriority;
    return (position.get(b.id) ?? 0) - (position.get(a.id) ?? 0);
  });
  return candidates.slice(0, MAX_PROMINENT_AFTERMATH).map((entry) => entry.id);
}

/** The pending prominent entries in display order, resolved from the chronicle. */
export function prominentAftermath(state: Pick<LegacyState, "chronicle" | "pendingAftermath">): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  for (const id of state.pendingAftermath) {
    for (const entry of state.chronicle) {
      if (entry.id === id) {
        out.push(entry);
        break;
      }
    }
  }
  return out;
}
