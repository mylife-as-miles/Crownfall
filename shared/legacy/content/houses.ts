// The external houses a new banner meets: in every nation one allied Great
// House of the same nation and one rival house from a foreign nation. Each
// fields a named representative on its standard-position square. Names, seats
// and temperaments are working placeholders pending creator approval.
//
// Representative squares are written from white's side of the board (ranks 1
// and 2). createMusterFormation mirrors the rank when that house's army plays
// black, so the same piece keeps its file in either colour.

import type { ExternalHouseDefinition, NationId } from "../types";

export const EXTERNAL_HOUSES: readonly ExternalHouseDefinition[] = [
  {
    id: "house-ombreval",
    name: "House Ombreval",
    nationId: "korvenia",
    kind: "allied-great-house",
    heraldry: { division: "per-saltire", field: ["sable", "purpure"], ordinary: "none", ordinaryTincture: "or", charge: "crown", chargeTincture: "or" },
    seat: "A Gothic cloister-estate above the black marble quarries",
    temperament:
      "An old house of austere ceremony and long memory. They think a banner this new has yet to earn its place " +
      "beside them, and they weigh it by how their own people fare in the Muster.",
    representative: { id: "ombreval-gervais", name: "Gervais Ombreval, the Veiled Lance", piece: "n", square: "b1" },
  },
  {
    id: "house-azhemar",
    name: "House Azhemar",
    nationId: "solforiz",
    kind: "rival-house",
    heraldry: { division: "plain", field: ["tenne", "tenne"], ordinary: "chevron", ordinaryTincture: "argent", charge: "flame", chargeTincture: "or" },
    seat: "The fortified wells of the eastern flats",
    temperament:
      "Proud well-keepers who settle insults on the Muster field and remember every debt, paid or owed.",
    representative: { id: "azhemar-idrasa", name: "Idrasa Azhemar, Warden of the Wells", piece: "p", square: "c2" },
  },
  {
    id: "house-qarathun",
    name: "House Qarathun",
    nationId: "solforiz",
    kind: "allied-great-house",
    heraldry: { division: "plain", field: ["or", "or"], ordinary: "chief", ordinaryTincture: "gules", charge: "tower", chargeTincture: "gules" },
    seat: "A furnace gate on the road to the capital",
    temperament:
      "Keepers of a great furnace gate, generous in public and exacting in private. They count a minor banner " +
      "as useful, and they hold it to every word it gives.",
    representative: { id: "qarathun-sahlun", name: "Sahlun Qarathun, Keeper of the Furnace Gate", piece: "b", square: "c1" },
  },
  {
    id: "house-hildmere",
    name: "House Hildmere",
    nationId: "aethelgard",
    kind: "rival-house",
    heraldry: { division: "per-pale", field: ["vert", "sable"], ordinary: "none", ordinaryTincture: "argent", charge: "sword", chargeTincture: "or" },
    seat: "A timber hall above a cold and contested ford",
    temperament:
      "A hard-bitten frontier house that tests every new banner and boasts of each prize it carries home.",
    representative: { id: "hildmere-hrodda", name: "Hrodda Hildmere, the Ford-Shield", piece: "p", square: "f2" },
  },
  {
    id: "house-stanhyrst",
    name: "House Stanhyrst",
    nationId: "aethelgard",
    kind: "allied-great-house",
    heraldry: { division: "plain", field: ["sanguine", "sanguine"], ordinary: "chevron", ordinaryTincture: "argent", charge: "tree", chargeTincture: "or" },
    seat: "A barrow-hall among colossal stones",
    temperament:
      "One of the oldest clans of the Blood-Throne. They call your banner a sapling, and they hold every house " +
      "to account for the kin it brings home.",
    representative: { id: "stanhyrst-eadmer", name: "Eadmer Stanhyrst, Spear of the Barrow", piece: "p", square: "e2" },
  },
  {
    id: "house-takara-hui",
    name: "House Takara-Hui",
    nationId: "kwind-09",
    kind: "rival-house",
    heraldry: { division: "per-bend", field: ["azure", "sable"], ordinary: "bordure", ordinaryTincture: "argent", charge: "cog", chargeTincture: "or" },
    seat: "A combine tower above the rail yards",
    temperament:
      "A combine that prices every grievance and collects on every debt. They treat the Muster as an audit.",
    representative: { id: "takara-hui-mio", name: "Mio Takara-Hui, Director of Field Assets", piece: "n", square: "g1" },
  },
  {
    id: "house-kanemura-lok",
    name: "House Kanemura-Lok",
    nationId: "kwind-09",
    kind: "allied-great-house",
    heraldry: { division: "per-pale", field: ["azure", "sable"], ordinary: "chief", ordinaryTincture: "argent", charge: "key", chargeTincture: "or" },
    seat: "A trading exchange in the upper towers",
    temperament:
      "Old money from the upper towers. They file your banner as a junior account and keep a careful tally " +
      "of every one of their people sent to the field.",
    representative: { id: "kanemura-lok-rei", name: "Rei Kanemura-Lok, Field Principal", piece: "n", square: "g1" },
  },
  {
    id: "house-vaudrenne",
    name: "House Vaudrenne",
    nationId: "korvenia",
    kind: "rival-house",
    heraldry: { division: "plain", field: ["purpure", "purpure"], ordinary: "saltire", ordinaryTincture: "or", charge: "mullet", chargeTincture: "sable" },
    seat: "A cloistered keep on a fog-bound ridge",
    temperament:
      "A veiled house of scholars who keep exact accounts of every slight and answer each defeat with a vow.",
    representative: { id: "vaudrenne-isaure", name: "Isaure Vaudrenne, the Grey Cantor", piece: "b", square: "f1" },
  },
];

/** Which external houses a banner of each nation deals with. */
export const NATION_HOUSES: Readonly<Record<NationId, { allied: string; rival: string }>> = {
  korvenia: { allied: "house-ombreval", rival: "house-azhemar" },
  solforiz: { allied: "house-qarathun", rival: "house-hildmere" },
  aethelgard: { allied: "house-stanhyrst", rival: "house-takara-hui" },
  "kwind-09": { allied: "house-kanemura-lok", rival: "house-vaudrenne" },
};

export function getExternalHouse(id: string): ExternalHouseDefinition | null {
  for (const house of EXTERNAL_HOUSES) if (house.id === id) return house;
  return null;
}

function requireHouse(id: string): ExternalHouseDefinition {
  const house = getExternalHouse(id);
  if (!house) throw new Error(`Legacy content is missing external house ${id}.`);
  return house;
}

export function getAlliedHouse(nationId: NationId): ExternalHouseDefinition {
  return requireHouse(NATION_HOUSES[nationId].allied);
}

export function getRivalHouse(nationId: NationId): ExternalHouseDefinition {
  return requireHouse(NATION_HOUSES[nationId].rival);
}

/**
 * How copy names a nation's crown when a royal or levy piece takes a captive:
 * the formal polity, lowercase "the" so it reads mid-sentence. Copy builders
 * capitalise it at the start of a sentence (see sentenceCase in copy.ts).
 */
export const CROWN_TITLES: Readonly<Record<NationId, string>> = {
  korvenia: "the Grand Duchy of Korvenia",
  solforiz: "the Scorched Caliphate of Solforiz",
  aethelgard: "the Blood-Throne of Aethelgard",
  "kwind-09": "the Kwind Zaibatsu",
};
