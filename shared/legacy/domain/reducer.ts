// reduceLegacy: the single pure entry point for every Legacy transition. A
// refusal returns the very same state object together with a readable reason.

import { LEGACY_TEXT } from "../content/copy";
import { LEGACY_NATION_AVAILABILITY } from "../content/nations";
import { appendChronicle } from "./chronicle";
import { applyFounding } from "./founding";
import { houseDisplayName } from "./identity";
import { applyMatchRecord } from "./match";
import { applyNomination } from "./nomination";
import { findNotice, isChallengeNotice, setNoticeStatus } from "./notices";
import { createLegacyState, isTimestamp } from "./state";
import type { LegacyEvent, LegacyState, LegacyTransition, NationAvailability, NationId } from "../types";

export interface ReduceLegacyOptions {
  /** Founding availability; defaults to LEGACY_NATION_AVAILABILITY. */
  availability?: Readonly<Record<NationId, NationAvailability>>;
}

export function reduceLegacy(state: LegacyState, event: LegacyEvent, options: ReduceLegacyOptions = {}): LegacyTransition {
  if (typeof event !== "object" || event === null) return { state, error: "Unknown Legacy event." };
  switch (event.type) {
    case "found-banner":
      return applyFounding(state, event, options.availability ?? LEGACY_NATION_AVAILABILITY);
    case "nominate":
      return applyNomination(state, event);
    case "read-notice": {
      const notice = findNotice(state, event.noticeId);
      if (!notice) return { state, error: "That notice does not exist." };
      if (notice.status !== "unread") return { state, error: null };
      return { state: { ...state, notices: setNoticeStatus(state.notices, notice.id, "read") }, error: null };
    }
    case "accept-challenge": {
      if (!state.banner) return { state, error: "Found a banner before accepting a challenge." };
      const notice = findNotice(state, event.noticeId);
      if (!notice) return { state, error: "That notice does not exist." };
      if (!isChallengeNotice(notice)) return { state, error: "Only a Muster challenge with a stated wager can be accepted." };
      if (notice.status === "accepted") return { state, error: null };
      if (notice.status === "resolved") return { state, error: "That challenge has already been answered on the board." };
      if (!isTimestamp(event.at)) return { state, error: "Accepting a challenge needs a timestamp from the caller." };
      const chronicle = state.chronicle.slice();
      appendChronicle(chronicle, {
        kind: "challenge-accepted",
        text: LEGACY_TEXT.challengeAccepted(houseDisplayName(notice.fromHouseId)),
        at: event.at,
        matchIndex: null,
        prominence: "minor",
        refs: { houseId: notice.fromHouseId, noticeId: notice.id },
      });
      return {
        state: { ...state, updatedAt: event.at, notices: setNoticeStatus(state.notices, notice.id, "accepted"), chronicle },
        error: null,
      };
    }
    case "record-match":
      return applyMatchRecord(state, event.record);
    case "dismiss-aftermath":
      if (state.pendingAftermath.length === 0) return { state, error: null };
      return { state: { ...state, pendingAftermath: [] }, error: null };
    case "reset":
      if (!isTimestamp(event.at)) return { state, error: "Reset needs a timestamp from the caller." };
      return { state: createLegacyState({ at: event.at, mode: state.mode, previewId: state.previewId }), error: null };
    default:
      return { state, error: "Unknown Legacy event." };
  }
}

/** Applies events in order and stops at the first refusal. Convenient for fixtures and tests. */
export function reduceLegacyAll(state: LegacyState, events: readonly LegacyEvent[], options: ReduceLegacyOptions = {}): LegacyTransition {
  let current = state;
  for (const event of events) {
    const transition = reduceLegacy(current, event, options);
    if (transition.error) return transition;
    current = transition.state;
  }
  return { state: current, error: null };
}
