// The unsaved founding ceremony draft. It lives in the Legacy screen while the
// screen is mounted, so leaving for Home and returning resumes the ceremony.
// Only "Raise the banner" turns it into a found-banner event.

import { cloneHeraldry, defaultHeraldry, heraldryEquals } from "../../../shared/legacy/content/heraldry";
import { defaultLegacyNation } from "../../../shared/legacy/content/nations";
import type { Heraldry, NationId } from "../../../shared/legacy/types";
import { foundingSeed } from "./storage";

export const FOUNDING_STEP_COUNT = 4;

export interface FoundingDraft {
  step: number;
  nationId: NationId;
  name: string;
  /** Show name validation once the player has typed, left the field or tried to continue. */
  nameTouched: boolean;
  heraldry: Heraldry;
  motto: string;
  /** Seeds the three members and the name suggestions, so the preview matches what is founded. */
  seed: number;
  suggestionPage: number;
  suggestionCursor: number;
}

export function createFoundingDraft(nationId: NationId = defaultLegacyNation()): FoundingDraft {
  return {
    step: 0,
    nationId,
    name: "",
    nameTouched: false,
    heraldry: defaultHeraldry(nationId),
    motto: "",
    seed: foundingSeed(),
    suggestionPage: 0,
    suggestionCursor: 0,
  };
}

/** Changes nation; arms still at the old nation's default follow to the new nation's default. */
export function withNation(draft: FoundingDraft, nationId: NationId): FoundingDraft {
  if (draft.nationId === nationId) return draft;
  const untouched = heraldryEquals(draft.heraldry, defaultHeraldry(draft.nationId));
  return {
    ...draft,
    nationId,
    heraldry: untouched ? defaultHeraldry(nationId) : cloneHeraldry(draft.heraldry),
    suggestionPage: 0,
    suggestionCursor: 0,
  };
}
