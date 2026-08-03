import type { GameResult } from "../core/types";
import type { ActiveCampaignBattle, CampaignMission } from "./types";

export interface MissionEvaluation {
  state: "active" | "complete" | "failed";
  explanation: string;
}

export function evaluateMission(
  mission: CampaignMission,
  battle: ActiveCampaignBattle,
  gameResult: GameResult | null = null,
): MissionEvaluation {
  for (const failure of mission.failureConditions) {
    if (failure.type === "character-captured" && battle.capturedCharacterIds.includes(failure.characterId)) {
      return { state: "failed", explanation: failure.description };
    }
  }

  const objective = mission.primaryObjective;
  if (objective.type === "checkmate") {
    if (gameResult?.reason === "checkmate" && gameResult.winner === mission.playerFaction) {
      return { state: "complete", explanation: objective.description };
    }
  } else if (objective.type === "assassination") {
    if (battle.capturedCharacterIds.includes(objective.targetCharacterId)) {
      return { state: "complete", explanation: objective.description };
    }
  } else if (objective.type === "escort") {
    const target = Object.entries(battle.identityMap).find(([, id]) => id === objective.characterId)?.[0];
    if (target && objective.targetSquares.includes(target)) {
      return { state: "complete", explanation: objective.description };
    }
  } else if (objective.type === "survival") {
    const alive = Object.values(battle.identityMap).includes(objective.characterId);
    if (alive && battle.moveLog.length >= objective.requiredPlies) {
      return { state: "complete", explanation: objective.description };
    }
  } else if (objective.type === "promotion") {
    const promoted = battle.moveLog.some((record) => record.actorId === objective.characterId && record.promotion !== null);
    if (promoted) return { state: "complete", explanation: objective.description };
  }

  for (const failure of mission.failureConditions) {
    if (failure.type === "turn-limit" && battle.moveLog.length >= failure.plies) {
      return { state: "failed", explanation: failure.description };
    }
  }
  if (objective.type === "assassination" && objective.turnLimit && battle.moveLog.length >= objective.turnLimit) {
    return { state: "failed", explanation: "The target escaped before the objective was fulfilled." };
  }

  if (gameResult) {
    return {
      state: "failed",
      explanation:
        gameResult.winner === mission.playerFaction
          ? "The enemy crown fell, but the mission objective was not fulfilled."
          : "The battle ended before the mission objective was fulfilled.",
    };
  }

  return { state: "active", explanation: objective.description };
}
