// The next step toward a Muster match, in the order of the shared readiness
// rules (domain/formation.ts musterReadiness): name a Pawn, answer the open
// challenge, then wait for the board. The overview strip and each landmark's
// primary action use it, so every Legacy screen points back to a match.

import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import { musterReadiness } from "../../../shared/legacy/domain/formation";
import { houseDisplayName } from "../../../shared/legacy/domain/identity";
import { openChallenge } from "../../../shared/legacy/domain/notices";
import { findMember } from "../../../shared/legacy/domain/state";
import type { LandmarkId, LegacyState } from "../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "./desktop-copy";

export type NextStepKind = "nominate" | "answer" | "ready" | "notices";

export interface NextStep {
  kind: NextStepKind;
  /** The landmark whose panel holds the step. */
  landmark: LandmarkId;
  title: string;
  /** The shared readiness wording behind the step. */
  detail: string;
  /** The challenge to answer, for "answer" and "ready". */
  noticeId: string | null;
}

/** The next step for a founded banner, or null before founding. */
export function nextStepFor(state: LegacyState): NextStep | null {
  if (!state.banner) return null;
  const readiness = musterReadiness(state);
  const nominee = findMember(state, state.nomination.memberId);
  const challenge = openChallenge(state);
  if (!nominee || !state.nomination.file) {
    return { kind: "nominate", landmark: "muster-grounds", title: UI.nextStep.nominate, detail: readiness.reason ?? LEGACY_COPY.readiness.noNominee, noticeId: null };
  }
  if (nominee.status !== "available") {
    return { kind: "nominate", landmark: "muster-grounds", title: UI.nextStep.renominate, detail: readiness.reason ?? LEGACY_COPY.readiness.nomineeUnfit(nominee.name, nominee.status), noticeId: null };
  }
  if (!challenge) {
    return { kind: "notices", landmark: "heralds-station", title: UI.nextStep.noChallenge, detail: readiness.reason ?? LEGACY_COPY.readiness.noChallenge, noticeId: null };
  }
  if (challenge.status !== "accepted") {
    return { kind: "answer", landmark: "heralds-station", title: UI.nextStep.answer(houseDisplayName(challenge.fromHouseId)), detail: readiness.reason ?? LEGACY_COPY.readiness.notAccepted, noticeId: challenge.id };
  }
  return { kind: "ready", landmark: "heralds-station", title: UI.nextStep.ready, detail: LEGACY_COPY.notices.accepted, noticeId: challenge.id };
}
