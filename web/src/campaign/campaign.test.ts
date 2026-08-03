import { CampaignController } from "./campaignController";
import { getMission } from "./content/chapterOne";
import { resolveConsequences } from "./consequences";
import { evaluateMission } from "./objectives";
import { MemoryCampaignStorage, type CampaignStorage } from "./storage";
import { GameController } from "../core/gameController";

describe("Crownfall campaign foundation", () => {
  it("autosaves formation and reloads an active named battle", () => {
    const storage = new MemoryCampaignStorage();
    const first = new CampaignController(storage);
    first.newCampaign("story");
    first.recordPrologueChoice("tell-cael");
    first.openBriefing();
    first.openFormation();
    first.openGambit();
    const battle = first.launchBattle();

    expect(battle.identityMap.e5).toBe("cael");
    expect(battle.identityMap.d6).toBe("varro-outrider");

    const reloaded = new CampaignController(storage);
    expect(reloaded.continueCampaign()).toBe(true);
    const save = reloaded.getSnapshot().save;
    expect(save?.screen).toBe("battle");
    expect(save?.activeBattle?.identityMap.e5).toBe("cael");
    expect(save?.storyFlags).toContain("cael-told-about-the-player");
  });

  it("evaluates the assassination objective from identity events", () => {
    const mission = getMission("opening-sacrifice");
    const battle = {
      missionId: mission.id,
      startingFen: mission.startingFen,
      currentFen: mission.startingFen,
      formation: { e5: "cael" },
      startingIdentityMap: { e5: "cael", e1: "aldric", d6: "varro-outrider", e8: "varro-crown" },
      identityMap: { d6: "cael", e1: "aldric", e8: "varro-crown" },
      capturedCharacterIds: ["varro-outrider"],
      moveLog: [
        {
          ply: 0,
          actorId: "cael",
          from: "e5",
          to: "d6",
          capturedCharacterId: "varro-outrider",
          capturedSquare: "d6",
          rookCharacterId: null,
          promotion: null,
        },
      ],
      selectedGambitId: null,
      seed: 42,
    };
    expect(evaluateMission(mission, battle)).toEqual({ state: "complete", explanation: mission.primaryObjective.description });
  });

  it("produces repeatable, explained Story-mode consequences", () => {
    const controller = new CampaignController(new MemoryCampaignStorage());
    controller.newCampaign("story");
    const roster = controller.getSnapshot().save!.roster;
    const mission = getMission("opening-sacrifice");
    const battle = {
      missionId: mission.id,
      startingFen: mission.startingFen,
      currentFen: mission.startingFen,
      formation: { e5: "cael" },
      startingIdentityMap: { e5: "cael", e1: "aldric", d6: "varro-outrider", e8: "varro-crown" },
      identityMap: { e1: "aldric", d6: "varro-outrider", e8: "varro-crown" },
      capturedCharacterIds: ["cael"],
      moveLog: [],
      selectedGambitId: null,
      seed: 7,
    };

    const first = resolveConsequences({ mission, battle, roster, difficulty: "story", victory: false });
    const second = resolveConsequences({ mission, battle, roster, difficulty: "story", victory: false });
    expect(first.report).toEqual(second.report);
    expect(first.report.characterOutcomes.find((outcome) => outcome.characterId === "cael")?.status).toBe("injured");
    expect(first.report.characterOutcomes[0].factors).toContain("Story mode protects essential characters");
  });

  it("advances an assassination mission after the connected game settles", async () => {
    const campaign = new CampaignController(new MemoryCampaignStorage());
    const game = new GameController();
    campaign.connectGame(game);
    campaign.newCampaign("story");
    campaign.recordPrologueChoice("tell-cael");
    campaign.openBriefing();
    campaign.openFormation();
    campaign.openGambit();
    campaign.launchBattle();
    game.start(campaign.getBattleStartOptions()!);

    expect(await game.tryMove("e5", "d6")).toBe(true);
    expect(campaign.getSnapshot().save?.screen).toBe("consequence");
    expect(campaign.getSnapshot().save?.lastConsequence?.victory).toBe(true);
    game.dispose();
    campaign.dispose();
  });

  it("plays all three chapter missions with oath and promotion state intact", async () => {
    const campaign = new CampaignController(new MemoryCampaignStorage());
    const game = new GameController();
    campaign.connectGame(game);
    campaign.newCampaign("story");
    campaign.recordPrologueChoice("tell-cael");
    campaign.openBriefing();
    campaign.openFormation();
    campaign.openGambit();
    campaign.launchBattle();
    game.start(campaign.getBattleStartOptions()!);
    await game.tryMove("e5", "d6");
    campaign.acceptConsequences();

    campaign.openBriefing();
    campaign.openFormation();
    campaign.assignCharacter("a1", "tamsin");
    campaign.openGambit();
    campaign.selectGambit("oath_of_ash");
    campaign.launchBattle();
    game.start(campaign.getBattleStartOptions()!);
    await game.tryMove("a1", "a7");
    expect(campaign.getSnapshot().save?.lastConsequence?.gambitResult).toBe("success");
    expect(campaign.getSnapshot().save?.lastConsequence?.experienceAwards.tamsin).toBe(59);
    expect(campaign.getSnapshot().save?.lastConsequence?.experienceAwards.aldric).toBe(24);
    campaign.acceptConsequences();

    campaign.openBriefing();
    campaign.openFormation();
    campaign.openGambit();
    campaign.launchBattle();
    game.start(campaign.getBattleStartOptions()!);
    await game.tryMove("e7", "e8", "q");
    expect(campaign.getSnapshot().save?.roster.cael.currentKind).toBe("q");
    campaign.acceptConsequences();
    expect(campaign.getSnapshot().save?.screen).toBe("chapter-complete");
    expect(campaign.getSnapshot().save?.storyFlags).toContain("nameless-piece-revealed");
    game.dispose();
    campaign.dispose();
  });

  it("enforces the failed Oath and reports unavailable persistence truthfully", () => {
    const mission = getMission("the-empty-rook");
    const rosterController = new CampaignController(new MemoryCampaignStorage());
    rosterController.newCampaign("story");
    const roster = rosterController.getSnapshot().save!.roster;
    const battle = {
      missionId: mission.id,
      startingFen: mission.startingFen,
      currentFen: mission.startingFen,
      formation: { a1: "tamsin" },
      startingIdentityMap: { a1: "tamsin", e1: "aldric", a7: "selene-bastion", e8: "selene-crown" },
      identityMap: { a1: "tamsin", e1: "aldric", a7: "selene-bastion", e8: "selene-crown" },
      capturedCharacterIds: [],
      moveLog: [],
      selectedGambitId: "oath_of_ash",
      seed: 99,
    };
    const lost = resolveConsequences({ mission, battle, roster, difficulty: "story", victory: false });
    expect(lost.roster.tamsin.status).toBe("captured");
    expect(lost.report.characterOutcomes.find((outcome) => outcome.characterId === "tamsin")?.factors).toContain(
      "Oath of Ash failure consequence",
    );

    const deniedStorage: CampaignStorage = {
      has: () => false,
      load: () => ({ save: null, error: null }),
      save: () => "Storage permission denied",
      clear: () => undefined,
    };
    const denied = new CampaignController(deniedStorage);
    denied.newCampaign("story");
    expect(denied.getSnapshot().saveError).toBe("Storage permission denied");
    expect(denied.getSnapshot().hasSave).toBe(false);
  });

  it("does not treat checkmate as a substitute for a narrative objective", () => {
    const mission = getMission("opening-sacrifice");
    const battle = {
      missionId: mission.id,
      startingFen: mission.startingFen,
      currentFen: mission.startingFen,
      formation: { e5: "cael" },
      startingIdentityMap: { e5: "cael", e1: "aldric", d6: "varro-outrider", e8: "varro-crown" },
      identityMap: { e5: "cael", e1: "aldric", d6: "varro-outrider" },
      capturedCharacterIds: ["varro-crown"],
      moveLog: [],
      selectedGambitId: null,
      seed: 11,
    };
    expect(evaluateMission(mission, battle, { winner: "w", reason: "checkmate" }).state).toBe("failed");
  });
});
