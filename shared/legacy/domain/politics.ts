// Political arithmetic for Legacy rules v1: dispositions, stances, recognition
// and hall tiers. Recognition is political only and never converts into chess power.

import type { HouseRelation, HouseStance } from "../types";

export const ALLIED_START_DISPOSITION = -25;
export const RIVAL_START_DISPOSITION = -10;
export const MUSTER_VICTORY_RECOGNITION = 2;
export const MUSTER_VICTORY_ALLIED_DISPOSITION = 5;
export const MUSTER_DEFEAT_ALLIED_DISPOSITION = -5;
export const ALLIED_LOSS_DISPOSITION = -10;
/** Recognition needed for hall tiers 1, 2 and 3. */
export const HALL_TIER_THRESHOLDS: readonly [number, number, number] = [4, 10, 18];

export function clampDisposition(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function stanceForDisposition(disposition: number): HouseStance {
  if (disposition <= -60) return "hostile";
  if (disposition <= -15) return "disdainful";
  if (disposition < 15) return "wary";
  if (disposition < 50) return "cordial";
  return "loyal";
}

export function hallTierForRecognition(recognition: number): 0 | 1 | 2 | 3 {
  if (recognition >= HALL_TIER_THRESHOLDS[2]) return 3;
  if (recognition >= HALL_TIER_THRESHOLDS[1]) return 2;
  if (recognition >= HALL_TIER_THRESHOLDS[0]) return 1;
  return 0;
}

export function findRelation(relations: readonly HouseRelation[], houseId: string): HouseRelation | null {
  for (const relation of relations) if (relation.houseId === houseId) return relation;
  return null;
}

export interface RelationChange {
  disposition?: number;
  grievances?: number;
  remember?: string;
}

/** Returns a new relations array with one relation changed; other relations keep their identity. */
export function changeRelation(relations: readonly HouseRelation[], houseId: string, change: RelationChange): HouseRelation[] {
  return relations.map((relation) => {
    if (relation.houseId !== houseId) return relation;
    return {
      houseId: relation.houseId,
      disposition: clampDisposition(relation.disposition + (change.disposition ?? 0)),
      grievances: relation.grievances + (change.grievances ?? 0),
      memory: change.remember ? relation.memory.concat(change.remember) : relation.memory,
    };
  });
}
