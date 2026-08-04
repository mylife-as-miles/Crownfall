import { CHAPTER_ONE_GAMBITS, CHAPTER_ONE_MISSIONS, getMission } from "./content/chapterOne";
import type { CampaignDifficulty, CampaignSaveV1, CharacterStatus, HeroPiece } from "./types";

export interface CampaignMenuCharacter {
  id: string;
  name: string;
  title: string;
  status: CharacterStatus;
  level: number;
  kind: HeroPiece["currentKind"];
}

export interface CampaignMenuSummary {
  missionTitle: string;
  missionSubtitle: string;
  completedCount: number;
  totalCount: number;
  difficulty: CampaignDifficulty;
  difficultyLabel: string;
  updatedAt: string;
  focusCharacter: CampaignMenuCharacter;
  lastConsequenceLabel: string | null;
  gambitLabel: string | null;
}

const DIFFICULTY_LABEL: Record<CampaignDifficulty, string> = {
  story: "Story",
  tactician: "Tactician",
  grandmaster: "Grandmaster",
  "iron-crown": "Iron Crown",
};

const STATUS_PRIORITY: Record<CharacterStatus, number> = {
  dead: 6,
  missing: 5,
  captured: 4,
  corrupted: 3,
  injured: 2,
  active: 0,
};

function chooseFocusCharacter(save: CampaignSaveV1): HeroPiece {
  const heroes = Object.values(save.roster);
  const marked = heroes
    .filter((hero) => hero.status !== "active")
    .sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status] || b.level - a.level)[0];
  if (marked) return marked;
  if (save.roster.cael) return save.roster.cael;
  return [...heroes].sort((a, b) => b.level - a.level || b.experience - a.experience)[0];
}

export function selectCampaignMenuSummary(save: CampaignSaveV1 | null): CampaignMenuSummary | null {
  if (!save) return null;
  const mission = getMission(save.currentMissionId);
  const focus = chooseFocusCharacter(save);
  const gambit = save.selectedGambitId ? CHAPTER_ONE_GAMBITS[save.selectedGambitId] : null;
  return {
    missionTitle: mission.title,
    missionSubtitle: mission.subtitle,
    completedCount: save.completedMissionIds.length,
    totalCount: CHAPTER_ONE_MISSIONS.length,
    difficulty: save.difficulty,
    difficultyLabel: DIFFICULTY_LABEL[save.difficulty],
    updatedAt: save.updatedAt,
    focusCharacter: {
      id: focus.id,
      name: focus.name,
      title: focus.title,
      status: focus.status,
      level: focus.level,
      kind: focus.currentKind,
    },
    lastConsequenceLabel: save.lastConsequence?.title ?? null,
    gambitLabel: gambit?.title ?? null,
  };
}
