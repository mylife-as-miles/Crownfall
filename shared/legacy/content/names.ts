// Banner-name suggestions and member name pools: original working
// placeholders pending creator approval, kept here so they can be replaced in
// one place. Every suggestion passes the founding name rule. Suggestions are
// deterministic for a seed, so a Quest quick-pick row and its desktop
// counterpart show the same names for the same ceremony.

import { mixSeed, seededShuffle } from "../domain/random";
import type { NationId } from "../types";

export const BANNER_NAME_SUGGESTIONS: Readonly<Record<NationId, readonly string[]>> = {
  korvenia: [
    "House Vesperine", "House Sombrelune", "House Noirval", "House Aubrecourt",
    "House Lisandre", "House Morvanel", "House Ombrecoeur", "House Cendrevaux",
    "House Vauclerc", "The Veiled Lantern", "The Marble Vigil", "The Quiet Eclipse",
    "The Violet Oath", "Keepers of the Umbra",
  ],
  solforiz: [
    "House Ruqaimar", "House Ilkhazun", "House Tahrisan", "House Qumaridh",
    "House Sulmiraz", "House Khadunai", "House Basimur", "House Ghirahan",
    "House Azurqan", "The Shaded Court", "Keepers of the Deep Well", "The Furnace Oath",
    "Banner of the Long Shade", "The Amber Wall",
  ],
  aethelgard: [
    "House Hrothwyn", "House Eldbrand", "House Wulfmere", "House Thornhallow",
    "House Osgrave", "House Holtmere", "House Cynewald", "House Haelstan",
    "The Cairn Watch", "The Ashwood Oath", "Keepers of the Old Fire", "The Antler Hearth",
    "Children of the Barrow", "The Hearthstone Levy",
  ],
  "kwind-09": [
    "House Arata-Kwok", "House Seto-Lam", "House Ishiro-Vance", "House Mak-Hollis",
    "House Tanabe-Lowe", "House Fung-Arden", "House Sora-Kessler", "House Ho-Merrick",
    "The Night Shift Covenant", "Keepers of the Signal", "The Rail Stewards", "The Lower Line Union",
    "The Quiet Ledger", "The Gantry Compact",
  ],
};

export interface MemberNamePool {
  given: readonly string[];
  epithets: readonly string[];
  origins: readonly string[];
}

export const MEMBER_NAME_POOLS: Readonly<Record<NationId, MemberNamePool>> = {
  korvenia: {
    given: ["Aurelien", "Severine", "Lucien", "Ondine", "Ambroise", "Celestine", "Remy", "Mathurin",
      "Albane", "Gaspard", "Thibault", "Elodie", "Bastien", "Clemence", "Octave", "Violaine", "Perrine"],
    epithets: ["the Quiet", "of the Lantern", "the Patient", "Veil-Sworn", "the Unhurried", "Keeper of Candles",
      "of the Long Vigil", "the Soft-Spoken", "Eclipse-Born", "the Lamplighter's Child", "of the Black Stair"],
    origins: [
      "Raised in the almshouse of a fading noble estate.",
      "A stonecutter's child from the black marble quarries.",
      "Kept the ledgers of an estate that no longer flies its banner.",
      "Came down from the cloister hills with a borrowed spear.",
      "Grew up tending the lamps of a night market.",
      "Second child of a ferryman on the black river.",
      "Taught letters by an archivist who never lifted her veil.",
      "Apprenticed to a glazier of violet windows.",
      "Stood vigil on the processional road beneath the eclipse.",
    ],
  },
  solforiz: {
    given: ["Khaliyun", "Ruqanna", "Zufira", "Talqim", "Basrun", "Nahira", "Ghazun", "Qamrun",
      "Hudara", "Farqis", "Ramiza", "Daqir", "Yasmira", "Sabirun", "Iqrina", "Thurima"],
    epithets: ["of the Long Shade", "Well-Keeper", "the Steady Flame", "Salt-Road Born", "the Patient Flame",
      "Reader of Dunes", "Furnace-Hand", "of the Cool Court", "the Unscorched", "Lantern of the Cistern", "the Mason's Heir"],
    origins: [
      "Raised beside a great cistern beneath the lower terraces.",
      "Walked the salt road with a caravan of masons.",
      "Apprenticed to the sulfur cutters of the eastern flats.",
      "Kept the shade-cloths of a courtyard school.",
      "Born in a wind-tower quarter where the air never rests.",
      "A mason's child who learned the old courtyard patterns by heart.",
      "Carried water to the garrison on a fortress wall.",
      "Grew up reading star charts in a merchant's counting house.",
      "Tended the furnace channels of a working refinery.",
    ],
  },
  aethelgard: {
    given: ["Hrethwyn", "Osmer", "Eadwen", "Ulfra", "Leofwen", "Thurwin", "Aedra", "Bryndis",
      "Edrun", "Wystan", "Sigrun", "Aelfgar", "Hildeth", "Torvald", "Ricsige", "Eormund", "Gytha"],
    epithets: ["the Cairn-Born", "Ash-Handed", "the Unbending", "Hound-Walker", "Hearth-Keeper",
      "the Stone-Quiet", "Antler-Crowned", "the Barrow-Sworn", "Storm-Weathered", "Oak-Steady", "of the Long Winter"],
    origins: [
      "Raised among the hound-keepers of the northern holds.",
      "Hauled timber for the roof-beams of a great hall.",
      "Swore the clan oath beside their grandmother's cairn.",
      "Held a ford against wolves through a hard winter.",
      "A smith's apprentice from the iron bogs.",
      "Grew up in the shadow of a ring of ancient stones.",
      "Herded the long-horned cattle of the high moor.",
      "Carried word between the clan halls on foot.",
      "Cut peat and kept the fires of a longhall.",
    ],
  },
  "kwind-09": {
    given: ["Ren", "Kaito", "Mei", "Hana", "Jun", "Kit", "Lok", "Yuen",
      "Akane", "Tomo", "Wing", "Sora", "Max", "Ivy", "Dex", "Shun", "Aya"],
    epithets: ["of the Lower Stacks", "Shift-Runner", "the Unaudited", "Signal-Keeper", "Line-Mender",
      "Gantry-Born", "the Night Clerk", "Rail-Steady", "of the Quiet Platform", "the Last Off-Shift", "Steam-Proof"],
    origins: [
      "Raised in a worker block beneath an elevated freight line.",
      "Kept the signal lamps on an elevated freight spur.",
      "Apprenticed to a maintenance crew in the lower stacks.",
      "Ran messages between company offices when the network went dark.",
      "Grew up repairing gantry cranes in a contract yard.",
      "Earned a scholarship seat out of the service corridors.",
      "Kept the night ledger for a shift canteen.",
      "Came up from the tunnel markets with a borrowed badge.",
      "Learned to read from the neon signs outside a dormitory window.",
    ],
  },
};

/**
 * Deterministic banner-name suggestions: the same nation, seed and count always
 * return the same names in the same order. Count is clamped to the pool size.
 */
export function suggestBannerNames(nationId: NationId, seed: number, count: number): string[] {
  const pool = BANNER_NAME_SUGGESTIONS[nationId];
  const wanted = Math.max(0, Math.min(pool.length, Math.floor(Number.isFinite(count) ? count : 0)));
  return seededShuffle(pool, mixSeed(seed, `banner-names:${nationId}`)).slice(0, wanted);
}

export interface GeneratedMemberIdentity {
  name: string;
  epithet: string;
  origin: string;
}

/** Distinct given names, epithets and origins for a founding's members, chosen by seed. */
export function generateMemberIdentities(nationId: NationId, seed: number, count: number): GeneratedMemberIdentity[] {
  const pool = MEMBER_NAME_POOLS[nationId];
  const given = seededShuffle(pool.given, mixSeed(seed, `given:${nationId}`));
  const epithets = seededShuffle(pool.epithets, mixSeed(seed, `epithets:${nationId}`));
  const origins = seededShuffle(pool.origins, mixSeed(seed, `origins:${nationId}`));
  const out: GeneratedMemberIdentity[] = [];
  const total = Math.max(0, Math.min(Math.floor(count), given.length));
  for (let index = 0; index < total; index++) {
    out.push({
      name: given[index],
      epithet: epithets[index % epithets.length],
      origin: origins[index % origins.length],
    });
  }
  return out;
}
