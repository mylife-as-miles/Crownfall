import { CHAPTER_ONE_GAMBITS } from "./content/chapterOne";
import type {
  ActiveCampaignBattle,
  CampaignDifficulty,
  CampaignMission,
  CharacterOutcome,
  ConsequenceReport,
  HeroPiece,
} from "./types";

function hash(input: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x45d9f3b) >>> 0;
    value ^= value >>> 16;
  }
  return value >>> 0;
}

function deterministicRoll(input: string, seed: number): number {
  return hash(input, seed) / 0xffffffff;
}

function capturedOutcome(
  hero: HeroPiece,
  mission: CampaignMission,
  difficulty: CampaignDifficulty,
  seed: number,
  gambitAccepted: boolean,
): CharacterOutcome {
  const roll = deterministicRoll(`${mission.id}:${hero.id}:fate`, seed);
  const factors = [`${difficulty} consequence rules`, `fixed mission seed ${seed}`];
  let injuryThreshold = difficulty === "story" ? 0.9 : difficulty === "tactician" ? 0.64 : difficulty === "grandmaster" ? 0.42 : 0.25;
  let captureThreshold = difficulty === "story" ? 0.98 : difficulty === "tactician" ? 0.9 : difficulty === "grandmaster" ? 0.72 : 0.52;

  if (hero.essential && difficulty === "story") {
    injuryThreshold = 1;
    captureThreshold = 1;
    factors.push("Story mode protects essential characters");
  }
  if (hero.traits.includes("Shield Brother")) {
    injuryThreshold = Math.min(1, injuryThreshold + 0.14);
    factors.push("Shield Brother improves survival");
  }
  if (gambitAccepted) {
    injuryThreshold = Math.max(0, injuryThreshold - 0.08);
    captureThreshold = Math.max(injuryThreshold, captureThreshold - 0.05);
    factors.push("Oath of Ash makes capture consequences harsher");
  }

  if (roll <= injuryThreshold) {
    return {
      characterId: hero.id,
      status: "injured",
      title: "Carried from the board",
      explanation: `${hero.name} survives, but the wound will follow them into the next battle.`,
      roll,
      factors,
    };
  }
  if (roll <= captureThreshold) {
    return {
      characterId: hero.id,
      status: "captured",
      title: "Taken beyond the line",
      explanation: `${hero.name} lives in enemy hands. A rescue mission may still bring them home.`,
      roll,
      factors,
    };
  }
  return {
    characterId: hero.id,
    status: "dead",
    title: "A name for the memorial",
    explanation: `${hero.name} does not rise when the board falls silent.`,
    roll,
    factors,
  };
}

export function resolveConsequences(input: {
  mission: CampaignMission;
  battle: ActiveCampaignBattle;
  roster: Record<string, HeroPiece>;
  difficulty: CampaignDifficulty;
  victory: boolean;
}): { report: ConsequenceReport; roster: Record<string, HeroPiece> } {
  const { mission, battle, difficulty, victory } = input;
  const roster = structuredClone(input.roster);
  const deployedIds = Array.from(
    new Set([
      ...Object.values(battle.formation),
      ...mission.fixedPlayerPlacements.map((placement) => placement.characterId),
    ]),
  ).filter((id) => roster[id]);
  const gambitAccepted = Boolean(battle.selectedGambitId);
  const selectedGambit = battle.selectedGambitId ? CHAPTER_ONE_GAMBITS[battle.selectedGambitId] : undefined;
  const oathBearer = Object.values(battle.formation).find((id) => roster[id]?.currentKind === "r");
  const forcedGambitStatus = !victory
    ? selectedGambit?.failureConsequences.find((consequence) => consequence.type === "status")
    : undefined;
  const characterOutcomes: CharacterOutcome[] = [];
  const experienceAwards: Record<string, number> = {};
  const loyaltyChanges: Record<string, number> = {};

  for (const id of deployedIds) {
    const current = roster[id];
    current.battlesFought += 1;
    const captured = battle.capturedCharacterIds.includes(id);
    const outcome = forcedGambitStatus && id === oathBearer
      ? {
          characterId: id,
          status: String(forcedGambitStatus.value) as HeroPiece["status"],
          title: "Bound by the failed Oath",
          explanation: forcedGambitStatus.description,
          roll: null,
          factors: ["Oath of Ash failure consequence"],
        }
      : captured
        ? capturedOutcome(current, mission, difficulty, battle.seed, gambitAccepted)
        : {
          characterId: id,
          status: "active" as const,
          title: "Returned from the board",
          explanation: `${current.name} survives the battle and remembers every square crossed.`,
          roll: null,
          factors: ["Character remained on the board"],
        };
    current.status = outcome.status;
    if (outcome.status === "injured") {
      current.injuries.push({
        id: `${mission.id}-${id}-wound`,
        title: "Board-burn scar",
        missionId: mission.id,
        permanent: difficulty === "iron-crown",
      });
    }
    characterOutcomes.push(outcome);

    const baseExperience = victory ? 24 : 10;
    const missionBonus = mission.rewards
      .filter((reward) =>
        reward.type === "experience" && (reward.characterId ? reward.characterId === id : Object.values(battle.formation).includes(id)),
      )
      .reduce((sum, reward) => sum + Number(reward.value), 0);
    const award = baseExperience + missionBonus;
    current.experience += award;
    current.level = Math.max(current.level, Math.floor(current.experience / 100) + 1);
    experienceAwards[id] = award;
  }

  for (const record of battle.moveLog) {
    const actor = roster[record.actorId];
    if (!actor) continue;
    if (record.capturedCharacterId) actor.captures += 1;
    if (record.promotion) {
      const from = actor.currentKind;
      actor.currentKind = record.promotion;
      actor.promotions.push({
        missionId: mission.id,
        from,
        to: record.promotion,
        path: mission.id === "promotion-trial" ? "The Nameless Threshold" : "Battlefield promotion",
      });
    }
  }

  if (battle.selectedGambitId && victory) {
    const loyaltyReward = selectedGambit?.successRewards.find((reward) => reward.type === "loyalty");
    if (oathBearer && loyaltyReward) {
      const amount = Number(loyaltyReward.value);
      roster[oathBearer].loyalty = Math.min(100, roster[oathBearer].loyalty + amount);
      loyaltyChanges[oathBearer] = amount;
    }
  }

  const defeatedEnemyIds = battle.capturedCharacterIds.filter((id) => !roster[id]);
  const storyFlagsAdded = victory
    ? mission.rewards.filter((reward) => reward.type === "story-flag").map((reward) => String(reward.value))
    : [];
  const report: ConsequenceReport = {
    missionId: mission.id,
    victory,
    title: victory ? "The line holds" : "The board remembers",
    summary: victory
      ? `${mission.title} is complete. Every survivor carries the position forward.`
      : `${mission.title} is lost. The named pieces bear the consequence, not an anonymous ledger.`,
    objectiveDescription: mission.primaryObjective.description,
    gambitResult: battle.selectedGambitId ? (victory ? "success" : "failed") : "declined",
    characterOutcomes,
    defeatedEnemyIds,
    experienceAwards,
    loyaltyChanges,
    storyFlagsAdded,
    seed: battle.seed,
  };
  return { report, roster };
}
