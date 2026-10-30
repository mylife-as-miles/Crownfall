// Content status for every word Chronicles shows (docs/chronicles/ARCHITECTURE.md §3 and §7).
// A canon status records who approved the words. It is kept apart from the
// in-world label (Recorded, Disputed, Testimony, Rumor) and from a source's
// evidence classes: an approved record may be in-world Rumor, and a working
// proposal stays unapproved even when it describes something Recorded.
import type { ChroniclesLoad } from './types';

/** Shared interface feedback; approved records remain available in the fallback. */
export const CHRONICLES_LOAD_FAILURE = 'The 3D map could not load. Records remain available. Return Home and reopen Chronicles to retry.';

export function getChroniclesLoadFailure(load: ChroniclesLoad): string | null {
  return load === 'flat' || load === 'failed' ? CHRONICLES_LOAD_FAILURE : null;
}

/** Production authority of the words, set by the creator. Agents write only the last two. */
export type CanonStatus = "approved" | "public-assertion" | "disputed-testimony" | "working-proposal" | "placeholder";

/** The statuses agents may write: design text awaiting approval, and development text that never ships. */
export type UnapprovedStatus = Extract<CanonStatus, "working-proposal" | "placeholder">;

/**
 * Evidence class of one statement inside a source, for the Contested Record:
 * verified fact, interpretation, rumor or accusation, missing evidence, or an
 * unresolved claim. Their on-screen names are text, so they await approval.
 */
export type SourceReliability = "verified-fact" | "interpretation" | "rumor-or-accusation" | "missing-evidence" | "unresolved-claim";

/** Which words a build shows. Both platforms pass CHRONICLES_CONTENT_POLICY. */
export interface ContentPolicy {
  readonly showUnapproved: boolean;
}

export const CANON_STATUSES: readonly CanonStatus[] = Object.freeze([
  "approved", "public-assertion", "disputed-testimony", "working-proposal", "placeholder",
] as const);

export const SOURCE_RELIABILITIES: readonly SourceReliability[] = Object.freeze([
  "verified-fact", "interpretation", "rumor-or-accusation", "missing-evidence", "unresolved-claim",
] as const);

/**
 * The one visibility switch for both platforms. The draft build shows working
 * proposals and placeholders, each beside its marker. Everything that shows
 * Chronicles text reads it through the registry, so setting showUnapproved to
 * false removes every unapproved entry and every marker on desktop and Quest alike.
 */
export const CHRONICLES_CONTENT_POLICY: ContentPolicy = Object.freeze({ showUnapproved: true });

const CREATOR_APPROVED: readonly CanonStatus[] = ["approved", "public-assertion", "disputed-testimony"];

export function isCanonStatus(value: unknown): value is CanonStatus {
  return typeof value === "string" && CANON_STATUSES.indexOf(value as CanonStatus) >= 0;
}

/** True for the three statuses only the creator grants; a release shows nothing else. */
export function isCreatorApproved(status: CanonStatus): boolean {
  return CREATOR_APPROVED.indexOf(status) >= 0;
}

/**
 * Whether words of this status may be shown under the policy. Creator-approved
 * words always show; unapproved words only while the switch shows them. An
 * unknown status or a malformed policy hides the words.
 */
export function isStatusVisible(status: CanonStatus, policy: ContentPolicy): boolean {
  if (isCreatorApproved(status)) return true;
  return isCanonStatus(status) && !!policy && policy.showUnapproved === true;
}

/**
 * The marker shown beside unapproved words. The marker strings are themselves
 * placeholder text, so they disappear with the switch like any placeholder.
 */
export interface CanonMarker {
  readonly canonStatus: "placeholder";
  readonly text: string;
}

export const CANON_MARKERS: Readonly<Record<UnapprovedStatus, CanonMarker>> = Object.freeze({
  "working-proposal": Object.freeze({ canonStatus: "placeholder", text: "Working proposal" } as const),
  placeholder: Object.freeze({ canonStatus: "placeholder", text: "Placeholder" } as const),
});

/** The marker text to show beside words of this status, or null when none shows. */
export function getCanonMarker(status: CanonStatus, policy: ContentPolicy): string | null {
  if (status !== "working-proposal" && status !== "placeholder") return null;
  const marker = CANON_MARKERS[status];
  return isStatusVisible(status, policy) && isStatusVisible(marker.canonStatus, policy) ? marker.text : null;
}
