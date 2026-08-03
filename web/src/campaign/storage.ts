import type { CampaignSaveV1 } from "./types";
import { CHAPTER_ONE_MISSIONS } from "./content/chapterOne";

export const CAMPAIGN_SAVE_KEY = "crownfall.campaign.autosave";

export interface CampaignStorage {
  has(): boolean;
  load(): { save: CampaignSaveV1 | null; error: string | null };
  save(value: CampaignSaveV1): string | null;
  clear(): void;
}

function cloneSave(value: CampaignSaveV1): CampaignSaveV1 {
  return JSON.parse(JSON.stringify(value)) as CampaignSaveV1;
}

function parseSave(raw: string): CampaignSaveV1 {
  const value = JSON.parse(raw) as Partial<CampaignSaveV1>;
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported save schema ${String(value.schemaVersion)}. The original data was left untouched.`);
  }
  const missionIds = new Set(CHAPTER_ONE_MISSIONS.map((mission) => mission.id));
  const screens = new Set(["prologue", "hub", "briefing", "formation", "gambit", "battle", "consequence", "chapter-complete"]);
  const difficulties = new Set(["story", "tactician", "grandmaster", "iron-crown"]);
  if (
    !value.roster ||
    typeof value.roster !== "object" ||
    !value.currentMissionId ||
    !missionIds.has(value.currentMissionId) ||
    !value.screen ||
    !screens.has(value.screen) ||
    !value.difficulty ||
    !difficulties.has(value.difficulty) ||
    !Array.isArray(value.completedMissionIds) ||
    !Array.isArray(value.unlockedMissionIds) ||
    !Array.isArray(value.storyFlags) ||
    !value.formationDraft ||
    typeof value.formationDraft !== "object"
  ) {
    throw new Error("The campaign save is incomplete. The original data was left untouched.");
  }
  if (value.screen === "battle" && !value.activeBattle) {
    throw new Error("The active battle is missing from this save. The original data was left untouched.");
  }
  if (value.activeBattle) {
    const battle = value.activeBattle;
    if (
      !missionIds.has(battle.missionId) ||
      battle.missionId !== value.currentMissionId ||
      typeof battle.currentFen !== "string" ||
      !battle.identityMap ||
      !Array.isArray(battle.capturedCharacterIds) ||
      !Array.isArray(battle.moveLog)
    ) {
      throw new Error("The saved battle is invalid. The original data was left untouched.");
    }
  }
  return value as CampaignSaveV1;
}

export class LocalCampaignStorage implements CampaignStorage {
  has(): boolean {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(CAMPAIGN_SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  load(): { save: CampaignSaveV1 | null; error: string | null } {
    if (typeof window === "undefined") return { save: null, error: null };
    try {
      const raw = window.localStorage.getItem(CAMPAIGN_SAVE_KEY);
      if (!raw) return { save: null, error: null };
      return { save: parseSave(raw), error: null };
    } catch (error) {
      return { save: null, error: error instanceof Error ? error.message : "The campaign save could not be read." };
    }
  }

  save(value: CampaignSaveV1): string | null {
    if (typeof window === "undefined") return null;
    try {
      window.localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(value));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "The campaign could not be saved on this device.";
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(CAMPAIGN_SAVE_KEY);
  }
}

/** Deterministic in-memory storage for unit tests and non-browser consumers. */
export class MemoryCampaignStorage implements CampaignStorage {
  private value: CampaignSaveV1 | null;

  constructor(initial: CampaignSaveV1 | null = null) {
    this.value = initial ? cloneSave(initial) : null;
  }

  has(): boolean {
    return this.value !== null;
  }

  load(): { save: CampaignSaveV1 | null; error: string | null } {
    return { save: this.value ? cloneSave(this.value) : null, error: null };
  }

  save(value: CampaignSaveV1): string | null {
    this.value = cloneSave(value);
    return null;
  }

  clear(): void {
    this.value = null;
  }
}
