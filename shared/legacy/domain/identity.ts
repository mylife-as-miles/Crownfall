// Identity ids used in Muster formations and the house ids they owe
// allegiance to. The scheme is part of the engine-bridge contract:
//   player:<memberId>          the player's nominated representative
//   ally:<houseId>             the allied Great House's representative
//   rival:<houseId>            the rival house's representative
//   crown:<nation>:<square>    royal pieces (king and queen), by starting square
//   levy:<nation>:<square>     every other piece, by starting square
// House ids are "player", an external house id, or "crown:<nation>".

import { CROWN_TITLES, getExternalHouse } from "../content/houses";
import { isNationId, NATIONS } from "../content/nations";
import type { NationId, SquareId } from "../types";

export const PLAYER_HOUSE_ID = "player";

export function playerIdentityId(memberId: string): string {
  return `player:${memberId}`;
}

export function allyIdentityId(houseId: string): string {
  return `ally:${houseId}`;
}

export function rivalIdentityId(houseId: string): string {
  return `rival:${houseId}`;
}

export function crownIdentityId(nationId: NationId, square: SquareId): string {
  return `crown:${nationId}:${square}`;
}

export function levyIdentityId(nationId: NationId, square: SquareId): string {
  return `levy:${nationId}:${square}`;
}

export function crownHouseId(nationId: NationId): string {
  return `crown:${nationId}`;
}

export type ParsedIdentity =
  | { kind: "player"; memberId: string }
  | { kind: "ally"; houseId: string }
  | { kind: "rival"; houseId: string }
  | { kind: "crown"; nationId: NationId; square: SquareId }
  | { kind: "levy"; nationId: NationId; square: SquareId };

export function parseIdentityId(id: string): ParsedIdentity | null {
  const colon = id.indexOf(":");
  if (colon <= 0) return null;
  const prefix = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  if (rest.length === 0) return null;
  if (prefix === "player") return { kind: "player", memberId: rest };
  if (prefix === "ally") return { kind: "ally", houseId: rest };
  if (prefix === "rival") return { kind: "rival", houseId: rest };
  if (prefix === "crown" || prefix === "levy") {
    const split = rest.lastIndexOf(":");
    if (split <= 0) return null;
    const nationId = rest.slice(0, split);
    const square = rest.slice(split + 1);
    if (!isNationId(nationId) || !/^[a-h][1-8]$/.test(square)) return null;
    return prefix === "crown" ? { kind: "crown", nationId, square } : { kind: "levy", nationId, square };
  }
  return null;
}

/** The nation behind a "crown:<nation>" house id, or null for any other id. */
export function parseCrownHouseId(houseId: string): NationId | null {
  if (houseId.indexOf("crown:") !== 0) return null;
  const nationId = houseId.slice("crown:".length);
  return isNationId(nationId) ? nationId : null;
}

/** True for external house ids and "crown:<nation>" ids: the houses that can hold a captive. */
export function isKnownHouseId(houseId: string): boolean {
  return getExternalHouse(houseId) !== null || parseCrownHouseId(houseId) !== null;
}

export function nationOfHouse(houseId: string): NationId | null {
  const house = getExternalHouse(houseId);
  if (house) return house.nationId;
  return parseCrownHouseId(houseId);
}

/** Human-readable name for a house id; unknown ids are returned unchanged. */
export function houseDisplayName(houseId: string): string {
  const house = getExternalHouse(houseId);
  if (house) return house.name;
  const nationId = parseCrownHouseId(houseId);
  if (nationId) return CROWN_TITLES[nationId];
  return houseId;
}

export function nationName(nationId: NationId): string {
  return NATIONS[nationId].name;
}
