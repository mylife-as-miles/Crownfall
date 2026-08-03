import type { Faction, PieceKind, SquareId } from "../core/types";

export type CampaignDifficulty = "story" | "tactician" | "grandmaster" | "iron-crown";

export type CharacterStatus = "active" | "injured" | "captured" | "missing" | "corrupted" | "dead";

export interface InjuryRecord {
  id: string;
  title: string;
  missionId: string;
  permanent: boolean;
}

export interface PromotionRecord {
  missionId: string;
  from: PieceKind;
  to: PieceKind;
  path: string;
}

export interface HeroPiece {
  id: string;
  name: string;
  title: string;
  faction: Faction;
  currentKind: PieceKind;
  originalKind: PieceKind;
  level: number;
  experience: number;
  loyalty: number;
  morale: number;
  status: CharacterStatus;
  injuries: InjuryRecord[];
  traits: string[];
  equipment: string[];
  relationships: Record<string, number>;
  battlesFought: number;
  captures: number;
  sacrificesSurvived: number;
  promotions: PromotionRecord[];
  storyFlags: string[];
  biography: string;
  voiceProfileId: string;
  visualVariantId: string;
  essential?: boolean;
}

export type BattleIdentityMap = Record<SquareId, HeroPiece["id"]>;

export type MissionObjective =
  | { type: "checkmate"; description: string }
  | { type: "assassination"; targetCharacterId: string; description: string; turnLimit?: number }
  | { type: "escort"; characterId: string; targetSquares: SquareId[]; description: string }
  | { type: "survival"; characterId: string; requiredPlies: number; description: string }
  | { type: "promotion"; characterId: string; description: string };

export type MissionFailureCondition =
  | { type: "character-captured"; characterId: string; description: string }
  | { type: "turn-limit"; plies: number; description: string };

export interface MissionReward {
  type: "experience" | "loyalty" | "story-flag" | "unlock" | "relic";
  value: string | number;
  characterId?: string;
  description: string;
}

export interface MissionConsequence {
  type: "loyalty" | "morale" | "story-flag" | "status";
  value: string | number;
  characterId?: string;
  description: string;
}

export interface DeploymentSlot {
  square: SquareId;
  kind: PieceKind;
  label: string;
  requiredCharacterId?: string;
  allowedCharacterIds: string[];
}

export interface EnemyPlacement {
  square: SquareId;
  characterId: string;
  name: string;
  kind: PieceKind;
}

export interface CampaignMission {
  id: string;
  chapterId: string;
  title: string;
  subtitle: string;
  description: string;
  briefing: string;
  battlefieldId: string;
  enemyCommanderId: string;
  enemyCommanderName: string;
  startingFen: string;
  playerFaction: Faction;
  permittedRoster: string[];
  requiredCharacters: string[];
  unavailableCharacters: string[];
  deploymentSlots: DeploymentSlot[];
  fixedPlayerPlacements: EnemyPlacement[];
  enemyFormation: EnemyPlacement[];
  primaryObjective: MissionObjective;
  secondaryObjectives: MissionObjective[];
  failureConditions: MissionFailureCondition[];
  availableGambits: string[];
  rewards: MissionReward[];
  lossConsequences: MissionConsequence[];
  preBattleSceneIds: string[];
  midBattleTriggerIds: string[];
  postBattleSceneIds: string[];
  unlockConditions: string[];
}

export interface GambitDefinition {
  id: string;
  title: string;
  description: string;
  warning: string;
  availabilityConditions: string[];
  acceptanceEffects: string[];
  successConditions: string[];
  failureConditions: string[];
  successRewards: MissionReward[];
  failureConsequences: MissionConsequence[];
  involvedCharacterIds?: string[];
  visibleToCharacters: boolean;
  canBeConcealed: boolean;
}

export interface IdentityMoveRecord {
  ply: number;
  actorId: string;
  from: SquareId;
  to: SquareId;
  capturedCharacterId: string | null;
  capturedSquare: SquareId | null;
  rookCharacterId: string | null;
  promotion: PieceKind | null;
}

export interface ActiveCampaignBattle {
  missionId: string;
  startingFen: string;
  currentFen: string;
  formation: Record<SquareId, string>;
  identityMap: BattleIdentityMap;
  startingIdentityMap: BattleIdentityMap;
  capturedCharacterIds: string[];
  moveLog: IdentityMoveRecord[];
  selectedGambitId: string | null;
  seed: number;
}

export interface CharacterOutcome {
  characterId: string;
  status: CharacterStatus;
  title: string;
  explanation: string;
  roll: number | null;
  factors: string[];
}

export interface ConsequenceReport {
  missionId: string;
  victory: boolean;
  title: string;
  summary: string;
  objectiveDescription: string;
  gambitResult: "success" | "failed" | "declined";
  characterOutcomes: CharacterOutcome[];
  defeatedEnemyIds: string[];
  experienceAwards: Record<string, number>;
  loyaltyChanges: Record<string, number>;
  storyFlagsAdded: string[];
  seed: number;
}

export type CampaignScreen =
  | "prologue"
  | "hub"
  | "briefing"
  | "formation"
  | "gambit"
  | "battle"
  | "consequence"
  | "chapter-complete";

export interface CampaignSaveV1 {
  schemaVersion: 1;
  slotId: string;
  updatedAt: string;
  chapterId: string;
  difficulty: CampaignDifficulty;
  screen: CampaignScreen;
  currentMissionId: string;
  completedMissionIds: string[];
  unlockedMissionIds: string[];
  roster: Record<string, HeroPiece>;
  formationDraft: Record<SquareId, string>;
  selectedGambitId: string | null;
  activeBattle: ActiveCampaignBattle | null;
  lastConsequence: ConsequenceReport | null;
  storyFlags: string[];
  territoryState: Record<string, string>;
  deterministicSeed: number;
}

export interface CampaignSnapshot {
  save: CampaignSaveV1 | null;
  hasSave: boolean;
  loadError: string | null;
  saveError: string | null;
}
