import { Emitter } from "../core/emitter";
import type { GameController } from "../core/gameController";
import type { Faction, GameResult, MoveEvent, PieceKind, SquareId } from "../core/types";
import { CHAPTER_ONE_GAMBITS, CHAPTER_ONE_MISSIONS, createChapterOneSave, getMission } from "./content/chapterOne";
import { resolveConsequences } from "./consequences";
import { BattleIdentityTracker } from "./identity";
import { evaluateMission } from "./objectives";
import { LocalCampaignStorage, type CampaignStorage } from "./storage";
import type {
  ActiveCampaignBattle,
  CampaignDifficulty,
  CampaignMission,
  CampaignSnapshot,
  GambitDefinition,
} from "./types";

interface CampaignEvents {
  state: CampaignSnapshot;
}

function defaultFormation(mission: CampaignMission): Record<SquareId, string> {
  const result: Record<SquareId, string> = {};
  for (const slot of mission.deploymentSlots) {
    const id = slot.requiredCharacterId ?? slot.allowedCharacterIds[0];
    if (id) result[slot.square] = id;
  }
  return result;
}

function toCoreDifficulty(difficulty: CampaignDifficulty): "easy" | "medium" | "hard" {
  if (difficulty === "story") return "easy";
  if (difficulty === "tactician") return "medium";
  return "hard";
}

export class CampaignController extends Emitter<CampaignEvents> {
  private storage: CampaignStorage;
  private snapshot: CampaignSnapshot;
  private tracker: BattleIdentityTracker | null = null;
  private game: GameController | null = null;
  private disconnectGame: (() => void)[] = [];
  private finalizing = false;
  private resolutionPresenter: ((result: GameResult) => Promise<void>) | null = null;

  constructor(storage: CampaignStorage = new LocalCampaignStorage()) {
    super();
    this.storage = storage;
    this.snapshot = { save: null, hasSave: storage.has(), loadError: null, saveError: null };
  }

  getSnapshot(): CampaignSnapshot {
    return this.snapshot;
  }

  getCurrentMission(): CampaignMission | null {
    return this.snapshot.save ? getMission(this.snapshot.save.currentMissionId) : null;
  }

  getGambit(id: string): GambitDefinition | null {
    return CHAPTER_ONE_GAMBITS[id] ?? null;
  }

  /** Lets the renderer finish the objective/result beat before UI consequences replace it. */
  setResolutionPresenter(presenter: ((result: GameResult) => Promise<void>) | null): void {
    this.resolutionPresenter = presenter;
  }

  newCampaign(difficulty: CampaignDifficulty): void {
    this.tracker = null;
    this.snapshot = { save: createChapterOneSave(difficulty), hasSave: true, loadError: null, saveError: null };
    this.commit();
  }

  continueCampaign(): boolean {
    const loaded = this.storage.load();
    if (!loaded.save) {
      this.snapshot = { save: null, hasSave: this.storage.has(), loadError: loaded.error, saveError: null };
      this.publish();
      return false;
    }
    this.snapshot = { save: loaded.save, hasSave: true, loadError: null, saveError: null };
    if (loaded.save.activeBattle) {
      this.tracker = new BattleIdentityTracker(loaded.save.activeBattle.identityMap, loaded.save.activeBattle.moveLog);
    }
    this.publish();
    return true;
  }

  clearSave(): void {
    this.storage.clear();
    this.tracker = null;
    this.snapshot = { save: null, hasSave: false, loadError: null, saveError: null };
    this.publish();
  }

  recordPrologueChoice(choice: "tell-cael" | "obey-the-king"): void {
    const save = this.requireSave();
    const flag = choice === "tell-cael" ? "cael-told-about-the-player" : "cael-obeyed-without-truth";
    if (!save.storyFlags.includes(flag)) save.storyFlags.push(flag);
    save.roster.cael.loyalty += choice === "tell-cael" ? 6 : -4;
    save.roster.cael.relationships.aldric += choice === "tell-cael" ? -3 : 2;
    save.screen = "hub";
    this.commit();
  }

  openBriefing(): void {
    const save = this.requireSave();
    save.screen = "briefing";
    save.selectedGambitId = null;
    save.formationDraft = defaultFormation(getMission(save.currentMissionId));
    this.commit();
  }

  openFormation(): void {
    const save = this.requireSave();
    save.screen = "formation";
    this.commit();
  }

  assignCharacter(square: SquareId, characterId: string): void {
    const save = this.requireSave();
    const mission = getMission(save.currentMissionId);
    const slot = mission.deploymentSlots.find((candidate) => candidate.square === square);
    const hero = save.roster[characterId];
    if (!slot || !slot.allowedCharacterIds.includes(characterId) || !hero || hero.status !== "active") return;
    if (hero.currentKind !== slot.kind) return;
    for (const [occupiedSquare, occupiedId] of Object.entries(save.formationDraft)) {
      if (occupiedId === characterId && occupiedSquare !== square) delete save.formationDraft[occupiedSquare];
    }
    save.formationDraft[square] = characterId;
    this.commit();
  }

  formationReady(): boolean {
    const save = this.snapshot.save;
    if (!save) return false;
    const mission = getMission(save.currentMissionId);
    return mission.deploymentSlots.every((slot) => {
      const id = save.formationDraft[slot.square];
      return Boolean(id && slot.allowedCharacterIds.includes(id) && save.roster[id]?.status === "active");
    });
  }

  openGambit(): void {
    if (!this.formationReady()) return;
    const save = this.requireSave();
    save.screen = "gambit";
    this.commit();
  }

  selectGambit(id: string | null): void {
    const save = this.requireSave();
    const mission = getMission(save.currentMissionId);
    if (id !== null && !mission.availableGambits.includes(id)) return;
    save.selectedGambitId = id;
    this.commit();
  }

  launchBattle(): ActiveCampaignBattle {
    if (!this.formationReady()) throw new Error("Every required formation slot needs an available character.");
    const save = this.requireSave();
    const mission = getMission(save.currentMissionId);
    const identityMap: Record<SquareId, string> = {};
    for (const placement of mission.fixedPlayerPlacements) identityMap[placement.square] = placement.characterId;
    for (const [square, id] of Object.entries(save.formationDraft)) identityMap[square] = id;
    for (const placement of mission.enemyFormation) identityMap[placement.square] = placement.characterId;
    const seed = (save.deterministicSeed + save.completedMissionIds.length * 9_973) >>> 0;
    const battle: ActiveCampaignBattle = {
      missionId: mission.id,
      startingFen: mission.startingFen,
      currentFen: mission.startingFen,
      formation: { ...save.formationDraft },
      identityMap: { ...identityMap },
      startingIdentityMap: { ...identityMap },
      capturedCharacterIds: [],
      moveLog: [],
      selectedGambitId: save.selectedGambitId,
      seed,
    };
    save.activeBattle = battle;
    save.lastConsequence = null;
    save.screen = "battle";
    this.tracker = new BattleIdentityTracker(identityMap);
    this.commit();
    return structuredClone(battle);
  }

  getBattleStartOptions(): {
    mode: "campaign";
    difficulty: "easy" | "medium" | "hard";
    playerColor: Faction;
    clockMinutes: null;
    startingFen: string;
  } | null {
    const save = this.snapshot.save;
    const battle = save?.activeBattle;
    if (!save || !battle) return null;
    const mission = getMission(battle.missionId);
    return {
      mode: "campaign",
      difficulty: toCoreDifficulty(save.difficulty),
      playerColor: mission.playerFaction,
      clockMinutes: null,
      startingFen: battle.currentFen,
    };
  }

  acceptConsequences(): void {
    const save = this.requireSave();
    const report = save.lastConsequence;
    if (!report) return;
    if (!report.victory) {
      save.screen = "briefing";
      save.activeBattle = null;
      save.lastConsequence = null;
      this.tracker = null;
      this.commit();
      return;
    }
    const index = CHAPTER_ONE_MISSIONS.findIndex((mission) => mission.id === report.missionId);
    if (index === CHAPTER_ONE_MISSIONS.length - 1) {
      save.screen = "chapter-complete";
    } else {
      const next = CHAPTER_ONE_MISSIONS[index + 1];
      save.currentMissionId = next.id;
      save.formationDraft = defaultFormation(next);
      save.selectedGambitId = null;
      save.screen = "hub";
    }
    save.lastConsequence = null;
    save.activeBattle = null;
    this.tracker = null;
    this.commit();
  }

  returnToHub(): void {
    const save = this.requireSave();
    if (save.screen === "battle" || save.screen === "consequence") return;
    save.screen = "hub";
    this.commit();
  }

  connectGame(game: GameController): () => void {
    this.disconnectFromGame();
    this.game = game;
    this.disconnectGame = [
      game.on("move", (event) => this.onMove(event)),
      game.on("settled", () => this.onMoveSettled()),
      game.on("gameover", (result) => void this.onGameOver(result)),
    ];
    return () => this.disconnectFromGame();
  }

  private onMove(event: MoveEvent): void {
    const save = this.snapshot.save;
    const battle = save?.activeBattle;
    if (!save || !battle || save.screen !== "battle") return;
    if (!this.tracker) this.tracker = new BattleIdentityTracker(battle.identityMap, battle.moveLog);
    const record = this.tracker.apply(event);
    battle.identityMap = this.tracker.getSnapshot();
    battle.moveLog = this.tracker.getRecords();
    if (record.capturedCharacterId && !battle.capturedCharacterIds.includes(record.capturedCharacterId)) {
      battle.capturedCharacterIds.push(record.capturedCharacterId);
    }
    battle.currentFen = this.game?.getSnapshot().fen ?? battle.currentFen;
    this.commit();
  }

  private onMoveSettled(): void {
    const save = this.snapshot.save;
    const battle = save?.activeBattle;
    if (!save || !battle || save.screen !== "battle" || !this.game) return;
    battle.currentFen = this.game.getSnapshot().fen;
    const mission = getMission(battle.missionId);
    const evaluation = evaluateMission(mission, battle);
    if (evaluation.state === "complete") this.game.completeObjective(mission.playerFaction);
    else if (evaluation.state === "failed") this.game.resign();
  }

  private async onGameOver(result: GameResult): Promise<void> {
    const save = this.snapshot.save;
    const battle = save?.activeBattle;
    if (!save || !battle || save.screen !== "battle" || this.finalizing) return;
    this.finalizing = true;
    try {
      if (this.resolutionPresenter) await this.resolutionPresenter(result);
      const mission = getMission(battle.missionId);
      const victory = evaluateMission(mission, battle, result).state === "complete";
      const resolved = resolveConsequences({ mission, battle, roster: save.roster, difficulty: save.difficulty, victory });
      save.roster = resolved.roster;
      save.lastConsequence = resolved.report;
      save.screen = "consequence";
      if (victory) {
        if (!save.completedMissionIds.includes(mission.id)) save.completedMissionIds.push(mission.id);
        for (const reward of mission.rewards) {
          if (reward.type === "unlock") {
            const id = String(reward.value);
            if (!save.unlockedMissionIds.includes(id)) save.unlockedMissionIds.push(id);
          }
          if (reward.type === "story-flag" && !save.storyFlags.includes(String(reward.value))) {
            save.storyFlags.push(String(reward.value));
          }
        }
        for (const flag of resolved.report.storyFlagsAdded) {
          if (!save.storyFlags.includes(flag)) save.storyFlags.push(flag);
        }
      }
      save.activeBattle = null;
      this.tracker = null;
      this.commit();
    } finally {
      this.finalizing = false;
    }
  }

  private disconnectFromGame(): void {
    for (const disconnect of this.disconnectGame) disconnect();
    this.disconnectGame = [];
    this.game = null;
  }

  private requireSave() {
    const save = this.snapshot.save;
    if (!save) throw new Error("No Crownfall campaign is loaded.");
    return save;
  }

  private commit(): void {
    const save = this.snapshot.save;
    let saveError: string | null = null;
    if (save) {
      save.updatedAt = new Date().toISOString();
      saveError = this.storage.save(save);
    }
    this.snapshot = {
      save: save ? structuredClone(save) : null,
      hasSave: this.storage.has(),
      loadError: this.snapshot.loadError,
      saveError,
    };
    this.emit("state", this.snapshot);
  }

  private publish(): void {
    this.snapshot = {
      save: this.snapshot.save ? structuredClone(this.snapshot.save) : null,
      hasSave: this.storage.has(),
      loadError: this.snapshot.loadError,
      saveError: this.snapshot.saveError,
    };
    this.emit("state", this.snapshot);
  }

  dispose(): void {
    this.disconnectFromGame();
    this.clear();
  }
}

export type { PieceKind };
