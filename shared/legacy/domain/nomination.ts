// Muster nomination: one available member on one open file. The file changes
// identity and narrative stakes only; the formation is always standard chess.

import { LEGACY_TEXT } from "../content/copy";
import { isFileLetter, musterClaimFor } from "../content/muster";
import { appendChronicle } from "./chronicle";
import { findMember, isTimestamp } from "./state";
import type { FileLetter, LegacyEvent, LegacyState, LegacyTransition } from "../types";

/** Why this member and file cannot be nominated right now, or null when they can. */
export function nominationRefusal(state: LegacyState, memberId: string, file: FileLetter): string | null {
  if (!state.banner) return "Found a banner before nominating a representative.";
  const member = findMember(state, memberId);
  if (!member) return "That member does not belong to this house.";
  if (member.status === "captive") return `${member.name} is held captive and cannot stand in the Muster.`;
  if (member.status === "injured") return `${member.name} is recovering from injury and cannot stand in the Muster yet.`;
  if (!isFileLetter(file)) return "Choose a file from a to h.";
  const claim = musterClaimFor(state.banner.nationId, file);
  if (claim) return `The ${file}-file is claimed by ${claim.label}.`;
  return null;
}

type NominateEvent = Extract<LegacyEvent, { type: "nominate" }>;

export function applyNomination(state: LegacyState, event: NominateEvent): LegacyTransition {
  const refusal = nominationRefusal(state, event.memberId, event.file);
  if (refusal) return { state, error: refusal };
  if (!isTimestamp(event.at)) return { state, error: "Nomination needs a timestamp from the caller." };
  if (state.nomination.memberId === event.memberId && state.nomination.file === event.file) return { state, error: null };
  const member = findMember(state, event.memberId);
  if (!member) return { state, error: "That member does not belong to this house." };
  const chronicle = state.chronicle.slice();
  appendChronicle(chronicle, {
    kind: "nomination",
    text: LEGACY_TEXT.nomination(member.name, event.file),
    at: event.at,
    matchIndex: null,
    prominence: "minor",
    refs: { memberId: member.id },
  });
  return {
    state: { ...state, updatedAt: event.at, nomination: { memberId: member.id, file: event.file }, chronicle },
    error: null,
  };
}
