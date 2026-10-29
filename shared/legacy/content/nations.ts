// The four nations of Crownfall: identity copy and palette seeds for founding
// pickers, panels and scene palettes. Environments build their own
// architecture from `architecture`; availability is configuration, never
// content. Epithets and summaries are working placeholders pending creator
// approval. Capitals stay unnamed, so copy always says "the capital".

import type { NationAvailability, NationDefinition, NationId } from "../types";

/** Stable presentation order for nation pickers on both platforms. */
export const NATION_ORDER: readonly NationId[] = ["korvenia", "solforiz", "aethelgard", "kwind-09"];

/** The unnamed capital as copy refers to it. */
export const UNNAMED_CAPITAL = "the capital";

export const NATIONS: Readonly<Record<NationId, NationDefinition>> = {
  korvenia: {
    id: "korvenia",
    name: "Korvenia",
    polity: "The Grand Duchy of Korvenia",
    epithet: "Beneath the Eclipse",
    summary:
      "An occult grand duchy of noble estates and Gothic stone, standing in the long shadow of the eclipse. " +
      "Its standards go veiled, its halls are cut from black marble, and its old houses judge a newcomer by its patience.",
    capital: UNNAMED_CAPITAL,
    architecture: "gothic",
    palette: {
      primary: "#1d1a22",
      secondary: "#4b3462",
      metal: "#b7954a",
      glow: "#9d86d0",
      sky: "#262033",
      fog: "#4a4458",
    },
  },
  solforiz: {
    id: "solforiz",
    name: "Solforiz",
    polity: "The Scorched Caliphate of Solforiz",
    epithet: "Walls of Sulfur and Stone",
    summary:
      "A scorched caliphate of fortified settlements and monumental masonry, raised among sulfur formations and heat-worn rock. " +
      "Its houses keep shaded courtyards and working furnaces alike, and measure a banner by the walls it holds and the word it keeps.",
    capital: UNNAMED_CAPITAL,
    architecture: "desert-fortress",
    palette: {
      primary: "#8c5a2b",
      secondary: "#d2a23c",
      metal: "#c9a050",
      glow: "#f0c243",
      sky: "#e2b57c",
      fog: "#c99a68",
    },
  },
  aethelgard: {
    id: "aethelgard",
    name: "Aethelgard",
    polity: "The Blood-Throne of Aethelgard",
    epithet: "Hewn from Ancient Stone",
    summary:
      "A primordial realm of rugged halls, colossal stone and timber fortifications, set against wild country and harsh ground. " +
      "Its houses honour monuments older than memory, and a banner counts for exactly as much as the people it brings through a hard season.",
    capital: UNNAMED_CAPITAL,
    architecture: "timber-hall",
    palette: {
      primary: "#4a2c24",
      secondary: "#7a2420",
      metal: "#8f8a7c",
      glow: "#d97a3a",
      sky: "#76848a",
      fog: "#8d9690",
    },
  },
  "kwind-09": {
    id: "kwind-09",
    name: "Kwind-09",
    polity: "The Kwind Zaibatsu",
    epithet: "Every Seat Under Contract",
    summary:
      "A stratified corporate metropolis of industrial neighbourhoods, elevated transit and layered towers lit in neon. " +
      "Privilege and labour live worlds apart within the same walls, and a banner keeps its seat only while it keeps delivering.",
    capital: UNNAMED_CAPITAL,
    architecture: "stratified-metropolis",
    palette: {
      primary: "#1b232e",
      secondary: "#2e6c7a",
      metal: "#97a1ab",
      glow: "#3fd2e2",
      sky: "#232c38",
      fog: "#384452",
    },
  },
};

/**
 * Which nations a new banner may be founded in. Launch armies still await
 * approval, so every nation is open in this build; set an entry to "preview"
 * or "unavailable" here once the launch armies are chosen.
 */
export const LEGACY_NATION_AVAILABILITY: Readonly<Record<NationId, NationAvailability>> = {
  korvenia: "available",
  solforiz: "available",
  aethelgard: "available",
  "kwind-09": "available",
};

export function isNationId(value: unknown): value is NationId {
  return typeof value === "string" && (NATION_ORDER as readonly string[]).indexOf(value) !== -1;
}

export function getNation(id: NationId): NationDefinition {
  return NATIONS[id];
}

/** Founding accepts "available" and "preview" nations; "unavailable" ones stay hidden. */
export function isNationFoundable(
  id: NationId,
  availability: Readonly<Record<NationId, NationAvailability>> = LEGACY_NATION_AVAILABILITY,
): boolean {
  const value = availability[id];
  return value === "available" || value === "preview";
}

/** Nations a founding picker should list, in presentation order, with their availability. */
export function listFoundableNations(
  availability: Readonly<Record<NationId, NationAvailability>> = LEGACY_NATION_AVAILABILITY,
): { nation: NationDefinition; availability: NationAvailability }[] {
  const out: { nation: NationDefinition; availability: NationAvailability }[] = [];
  for (const id of NATION_ORDER) {
    if (!isNationFoundable(id, availability)) continue;
    out.push({ nation: NATIONS[id], availability: availability[id] });
  }
  return out;
}

/** The nation an unfounded holding is staged in before founding: the first foundable one. */
export function defaultLegacyNation(
  availability: Readonly<Record<NationId, NationAvailability>> = LEGACY_NATION_AVAILABILITY,
): NationId {
  for (const id of NATION_ORDER) if (isNationFoundable(id, availability)) return id;
  return NATION_ORDER[0];
}
