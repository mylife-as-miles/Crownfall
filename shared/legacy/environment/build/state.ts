// State adapter: maps a LegacySceneState onto what the environment shows (hall
// tier, scene flags, slot counts, heraldry for the atlas). It only reads what
// gameplay already decided; it never computes results or consequences.

import type { LegacySceneState } from "../../environment-contract";
import type { MatchOutcome } from "../../types";
import type { BannerholdBlueprint } from "../blueprint";
import type { AtlasHeraldry } from "../heraldry/adapter";
import type { SceneFlag, StateGate } from "../kernel";

export interface SceneSlotCounts {
  hallTier: 0 | 1 | 2 | 3;
  flags: ReadonlySet<SceneFlag>;
  /** 1 when the nominated representative stands on the marked stone. */
  pawn: 0 | 1;
  /** 1 when an injury is recorded and the representative rests in the holding. */
  injured: 0 | 1;
  levy: number;
  honours: number;
  recordMarkers: readonly MatchOutcome[];
  notices: number;
}

export interface SlotCapacities {
  levy: number;
  honours: number;
  recordMarkers: number;
  notices: number;
}

export function slotCapacities(bp: BannerholdBlueprint): SlotCapacities {
  return { levy: bp.muster.levySlots.length, honours: bp.slots.honourNiches.length, recordMarkers: bp.slots.recordMarkers.length, notices: bp.slots.noticeBoard.length };
}

export function resolveSceneSlots(state: LegacySceneState | null, cap: SlotCapacities): SceneSlotCounts {
  const flags = new Set<SceneFlag>();
  if (!state) {
    return { hallTier: 0, flags, pawn: 0, injured: 0, levy: 0, honours: 0, recordMarkers: [], notices: 0 };
  }
  if (state.founded || state.draft) flags.add("founded");
  if (state.alliedHouse) flags.add("allied-house");
  if (state.rivalHouse) {
    flags.add("rival-house");
    flags.add(`frontier:${state.rivalHouse.nationId}` as SceneFlag);
  }
  if (state.noticeKinds.indexOf("rival-challenge") >= 0) flags.add("rival-challenge");
  const rep = state.representative;
  const status = rep ? rep.status : null;
  if (status === "captive") flags.add("representative-captive");
  const repId = rep ? rep.memberId : null;
  let levy = 0;
  for (const m of state.levy) if (m.status === "available" && m.memberId !== repId) levy++;
  return {
    hallTier: state.hallTier,
    flags,
    pawn: status === "available" ? 1 : 0,
    injured: status === "injured" ? 1 : 0,
    levy: Math.min(levy, cap.levy),
    honours: Math.min(state.honours.length, cap.honours),
    recordMarkers: state.matchMarkers.slice(0, cap.recordMarkers).map((m) => m.outcome),
    notices: Math.min(Math.max(state.unreadNotices, state.noticeKinds.length), cap.notices),
  };
}

export function gateVisible(gate: StateGate | null, slots: SceneSlotCounts): boolean {
  if (!gate) return true;
  if (gate.minHallTier !== undefined && slots.hallTier < gate.minHallTier) return false;
  if (gate.maxHallTier !== undefined && slots.hallTier > gate.maxHallTier) return false;
  if (gate.flag !== undefined && !slots.flags.has(gate.flag)) return false;
  return true;
}

/** Linear tint per War Record marker outcome. */
export function markerTint(outcome: MatchOutcome): [number, number, number] {
  if (outcome === "victory") return [1.45, 1.15, 0.55];
  if (outcome === "defeat") return [0.62, 0.14, 0.12];
  return [0.78, 0.78, 0.8];
}

/** Heraldry the atlas shows for this state (undyed cloth before a banner exists). */
export function atlasHeraldryFor(state: LegacySceneState | null, atmosphere: BannerholdBlueprint["atmosphere"]): AtlasHeraldry {
  const pal = atmosphere.palette;
  return {
    player: state && state.heraldry ? state.heraldry : null,
    ally: state && state.alliedHouse ? state.alliedHouse.heraldry : null,
    rival: state && state.rivalHouse ? state.rivalHouse.heraldry : null,
    crown: { field: pal.crownField ?? pal.purpure ?? "#4a3a5a", border: pal.crownBorder ?? pal.gilt ?? "#c9a23a" },
    undyed: "#8f877b",
    veil: { cloth: "#231d2b", border: pal.gilt ?? "#a8873a" },
  };
}

/** Stable key of the heraldry the atlas shows; renderers refill the atlas only when it changes. */
export function heraldryKey(h: AtlasHeraldry): string {
  return JSON.stringify([h.player, h.ally, h.rival]);
}
