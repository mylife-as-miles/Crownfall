// Construction and lookup helpers for LegacyState. A fresh state has no banner;
// founding is the only way to create one.

import { LEGACY_SCHEMA_VERSION } from "../types";
import type { HouseMember, LegacyMode, LegacyState } from "../types";

/** Placeholder timestamp for states created before any caller-supplied time exists. */
export const LEGACY_EPOCH = "1970-01-01T00:00:00.000Z";

export interface CreateLegacyStateOptions {
  /** ISO timestamp from the caller; the domain never reads the clock. */
  at?: string;
  mode?: LegacyMode;
  /** Required for preview states (the fixture id); ignored in production. */
  previewId?: string | null;
}

/** Caller-supplied ISO timestamps are persisted, so they must be short non-empty strings. */
export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export function createLegacyState(options: CreateLegacyStateOptions = {}): LegacyState {
  const at = options.at ?? LEGACY_EPOCH;
  const mode: LegacyMode = options.mode ?? "production";
  return {
    schemaVersion: LEGACY_SCHEMA_VERSION,
    mode,
    previewId: mode === "preview" ? options.previewId ?? "preview" : null,
    createdAt: at,
    updatedAt: at,
    banner: null,
    standing: { rank: "minor-banner", recognition: 0, representation: 1 },
    members: [],
    nomination: { memberId: null, file: null },
    relations: [],
    matches: [],
    processedMatchIds: [],
    chronicle: [],
    notices: [],
    unresolved: [],
    pendingAftermath: [],
  };
}

export function findMember(state: Pick<LegacyState, "members">, memberId: string | null): HouseMember | null {
  if (memberId === null) return null;
  for (const member of state.members) if (member.id === memberId) return member;
  return null;
}

/** The nominated member, whatever their condition, or null when nobody is nominated. */
export function nominatedMember(state: LegacyState): HouseMember | null {
  return findMember(state, state.nomination.memberId);
}

/** Returns a new members array with one member replaced through `update`. */
export function updateMember(members: readonly HouseMember[], memberId: string, update: (member: HouseMember) => HouseMember): HouseMember[] {
  return members.map((member) => (member.id === memberId ? update(member) : member));
}
