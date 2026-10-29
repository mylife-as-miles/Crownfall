// Herald's Station notices and unresolved matters. A Muster challenge is a
// notice with stakes "muster" and a plain-language wager; exactly one rival
// challenge is open at a time once a banner exists.

import { LEGACY_TEXT } from "../content/copy";
import type { ChallengeContext } from "../content/copy";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { NATIONS } from "../content/nations";
import { matterId, noticeId } from "./chronicle";
import { nationOfHouse } from "./identity";
import type { HeraldNotice, LegacyState, NationId, UnresolvedMatter } from "../types";

export function postNotice(notices: HeraldNotice[], draft: Omit<HeraldNotice, "id" | "status">): HeraldNotice {
  const notice: HeraldNotice = { ...draft, id: noticeId(notices.length + 1), status: "unread" };
  notices.push(notice);
  return notice;
}

export function findNotice(state: Pick<LegacyState, "notices">, id: string): HeraldNotice | null {
  for (const notice of state.notices) if (notice.id === id) return notice;
  return null;
}

/** A notice that can be accepted as a Muster challenge: it states its wager. */
export function isChallengeNotice(notice: HeraldNotice): boolean {
  return notice.stakes === "muster" && notice.wager !== null;
}

/** The open (not yet resolved) challenge, if any. */
export function openChallenge(state: Pick<LegacyState, "notices">): HeraldNotice | null {
  for (const notice of state.notices) if (isChallengeNotice(notice) && notice.status !== "resolved") return notice;
  return null;
}

/** The nation a challenge is fought against: the nation of the house that issued it. */
export function challengeOpponentNation(notice: HeraldNotice): NationId | null {
  return nationOfHouse(notice.fromHouseId);
}

/** Posts the rival's next challenge and opens its unresolved matter. */
export function postRivalChallenge(
  notices: HeraldNotice[],
  unresolved: UnresolvedMatter[],
  playerNationId: NationId,
  bannerName: string,
  context: ChallengeContext,
  captiveName: string | null,
  createdAtMatch: number,
): HeraldNotice {
  const rival = getRivalHouse(playerNationId);
  const ally = getAlliedHouse(playerNationId);
  const rivalNation = NATIONS[rival.nationId].name;
  let number = 1;
  for (const notice of notices) if (notice.kind === "rival-challenge") number += 1;
  const text = LEGACY_TEXT.challenge(context, rival.name, rivalNation, bannerName, number, captiveName);
  const notice = postNotice(notices, {
    kind: "rival-challenge",
    fromHouseId: rival.id,
    title: text.title,
    body: text.body,
    stakes: "muster",
    wager: LEGACY_TEXT.wager(rivalNation, ally.name),
    createdAtMatch,
  });
  const matter = LEGACY_TEXT.matters.challenge(rival.name);
  unresolved.push({
    id: matterId(notice.id),
    kind: "challenge",
    title: matter.title,
    body: matter.body,
    houseId: rival.id,
    memberId: null,
    openedAtMatch: createdAtMatch,
  });
  return notice;
}

export function setNoticeStatus(notices: readonly HeraldNotice[], id: string, status: HeraldNotice["status"]): HeraldNotice[] {
  return notices.map((notice) => (notice.id === id ? { ...notice, status } : notice));
}
