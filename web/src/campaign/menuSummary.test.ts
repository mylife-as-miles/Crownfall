import { CampaignController } from "./campaignController";
import { selectCampaignMenuSummary } from "./menuSummary";

describe("selectCampaignMenuSummary", () => {
  it("turns a fresh save into a meaningful Continue dossier", () => {
    const controller = new CampaignController({
      has: () => false,
      load: () => ({ save: null, error: null }),
      save: () => null,
      clear: () => undefined,
    });
    controller.newCampaign("tactician");
    const summary = selectCampaignMenuSummary(controller.getSnapshot().save);

    expect(summary).toMatchObject({
      missionTitle: "The Opening Sacrifice",
      completedCount: 0,
      totalCount: 3,
      difficultyLabel: "Tactician",
      focusCharacter: { id: "cael", name: "Cael", status: "active" },
    });
    controller.dispose();
  });

  it("features a missing character ahead of an active survivor", () => {
    const controller = new CampaignController({
      has: () => false,
      load: () => ({ save: null, error: null }),
      save: () => null,
      clear: () => undefined,
    });
    controller.newCampaign("story");
    const save = controller.getSnapshot().save;
    if (!save) throw new Error("Campaign save was not created.");
    save.roster.mira.status = "missing";

    expect(selectCampaignMenuSummary(save)?.focusCharacter).toMatchObject({ id: "mira", status: "missing" });
    controller.dispose();
  });
});
