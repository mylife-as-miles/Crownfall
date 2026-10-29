// Founding a minor banner (Legacy rules v1). Pure: validates the ceremony's
// choices, generates three members from the seed and posts the two opening notices.

import { LEGACY_TEXT } from "../content/copy";
import { validateHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { generateMemberIdentities } from "../content/names";
import { isNationFoundable, isNationId, LEGACY_NATION_AVAILABILITY, NATIONS } from "../content/nations";
import { appendChronicle } from "./chronicle";
import { postNotice, postRivalChallenge } from "./notices";
import { ALLIED_START_DISPOSITION, RIVAL_START_DISPOSITION } from "./politics";
import { hashString, hex32, toSeed } from "./random";
import { isTimestamp } from "./state";
import type {
  ChronicleEntry, HeraldNotice, HouseMember, LegacyEvent, LegacyState, LegacyTransition,
  NationAvailability, NationId, UnresolvedMatter,
} from "../types";

export const BANNER_NAME_MIN = 2;
export const BANNER_NAME_MAX = 28;
export const MOTTO_MAX = 64;
export const FOUNDING_MEMBER_COUNT = 3;

const NAME_CHARACTERS = /^[\p{L}'’\- ]+$/u;
const STARTS_WITH_LETTER = /^\p{L}/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type NameValidation = { ok: true; name: string } | { ok: false; error: string };

/** Trims and collapses whitespace, then applies the v1 name rule. */
export function validateBannerName(raw: unknown): NameValidation {
  if (typeof raw !== "string") return { ok: false, error: "The banner needs a name." };
  const name = raw.trim().replace(/\s+/g, " ");
  const length = Array.from(name).length;
  if (length < BANNER_NAME_MIN) return { ok: false, error: `The name needs at least ${BANNER_NAME_MIN} characters.` };
  if (length > BANNER_NAME_MAX) return { ok: false, error: `The name can have at most ${BANNER_NAME_MAX} characters.` };
  if (!NAME_CHARACTERS.test(name)) return { ok: false, error: "Use only letters, spaces, apostrophes or hyphens." };
  if (!STARTS_WITH_LETTER.test(name)) return { ok: false, error: "The name must begin with a letter." };
  return { ok: true, name };
}

export type MottoValidation = { ok: true; motto: string | null } | { ok: false; error: string };

export function validateMotto(raw: unknown): MottoValidation {
  if (raw === undefined || raw === null) return { ok: true, motto: null };
  if (typeof raw !== "string") return { ok: false, error: "The motto must be text." };
  const motto = raw.trim().replace(/\s+/g, " ");
  if (motto.length === 0) return { ok: true, motto: null };
  if (CONTROL_CHARACTERS.test(motto)) return { ok: false, error: "The motto contains characters that cannot be shown." };
  if (Array.from(motto).length > MOTTO_MAX) return { ok: false, error: `The motto can have at most ${MOTTO_MAX} characters.` };
  return { ok: true, motto };
}

/** The three founding members for a nation and seed, with ids member-1..3. */
export function generateFoundingMembers(nationId: NationId, seed: number): HouseMember[] {
  return generateMemberIdentities(nationId, toSeed(seed), FOUNDING_MEMBER_COUNT).map((identity, index) => ({
    id: `member-${index + 1}`,
    name: identity.name,
    epithet: identity.epithet,
    origin: identity.origin,
    appointment: "pawn",
    status: "available",
    captiveOf: null,
    injuredUntilMatch: null,
    battlefieldPromotions: [],
    musters: 0,
    captures: 0,
    timesCaptured: 0,
  }));
}

export function bannerIdFor(name: string, nationId: NationId, seed: number, at: string): string {
  return `banner-${hex32(hashString(`${name}|${nationId}|${toSeed(seed)}|${at}`))}`;
}

type FoundEvent = Extract<LegacyEvent, { type: "found-banner" }>;

export function applyFounding(
  state: LegacyState,
  event: FoundEvent,
  availability: Readonly<Record<NationId, NationAvailability>> = LEGACY_NATION_AVAILABILITY,
): LegacyTransition {
  const refuse = (error: string): LegacyTransition => ({ state, error });
  if (state.banner !== null) return refuse("A banner already exists. Dissolve it before founding another.");
  if (!isNationId(event.nationId)) return refuse("Choose one of Crownfall's four nations.");
  if (!isNationFoundable(event.nationId, availability)) return refuse(`${NATIONS[event.nationId].name} is not open for founding in this build.`);
  const name = validateBannerName(event.name);
  if (name.ok === false) return refuse(name.error);
  const heraldry = validateHeraldry(event.heraldry);
  if (heraldry.ok === false) return refuse(heraldry.errors[0]);
  const motto = validateMotto(event.motto);
  if (motto.ok === false) return refuse(motto.error);
  if (!isTimestamp(event.at)) return refuse("Founding needs a timestamp from the caller.");
  if (typeof event.seed !== "number" || !Number.isFinite(event.seed)) return refuse("Founding needs a numeric seed.");

  const nation = NATIONS[event.nationId];
  const seed = toSeed(event.seed);
  const ally = getAlliedHouse(nation.id);
  const rival = getRivalHouse(nation.id);
  const chronicle: ChronicleEntry[] = [];
  const notices: HeraldNotice[] = [];
  const unresolved: UnresolvedMatter[] = [];

  appendChronicle(chronicle, {
    kind: "founding",
    text: LEGACY_TEXT.founding(name.name, nation.polity),
    at: event.at,
    matchIndex: null,
    prominence: "major",
  });
  const summons = LEGACY_TEXT.summons(ally.name, name.name, nation.name);
  postNotice(notices, {
    kind: "muster-summons",
    fromHouseId: ally.id,
    title: summons.title,
    body: summons.body,
    stakes: "muster",
    wager: null,
    createdAtMatch: 0,
  });
  postRivalChallenge(notices, unresolved, nation.id, name.name, "first", null, 0);

  return {
    state: {
      ...state,
      createdAt: event.at,
      updatedAt: event.at,
      banner: {
        id: bannerIdFor(name.name, nation.id, seed, event.at),
        name: name.name,
        nationId: nation.id,
        heraldry: heraldry.heraldry,
        motto: motto.motto,
        foundedAt: event.at,
        seed,
      },
      standing: { rank: "minor-banner", recognition: 0, representation: 1 },
      members: generateFoundingMembers(nation.id, seed),
      nomination: { memberId: null, file: null },
      relations: [
        { houseId: ally.id, disposition: ALLIED_START_DISPOSITION, grievances: 0, memory: [] },
        { houseId: rival.id, disposition: RIVAL_START_DISPOSITION, grievances: 0, memory: [] },
      ],
      matches: [],
      processedMatchIds: [],
      chronicle,
      notices,
      unresolved,
      pendingAftermath: [],
    },
    error: null,
  };
}
