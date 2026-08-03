import { GameController } from "./gameController";

describe("GameController mission positions", () => {
  it("loads a legal custom FEN and commits its capture through the normal move path", async () => {
    const controller = new GameController();
    const events: string[] = [];
    controller.on("settled", (event) => events.push(event.san));
    controller.start({
      mode: "hotseat",
      difficulty: "easy",
      playerColor: "w",
      clockMinutes: null,
      startingFen: "4k3/8/3n4/4P3/8/8/8/4K3 w - - 0 1",
    });

    expect(controller.getBoard()).toContainEqual({ square: "e5", kind: "p", color: "w" });
    expect(await controller.tryMove("e5", "d6")).toBe(true);
    expect(controller.pieceAt("d6")).toEqual({ kind: "p", color: "w" });
    expect(events).toEqual(["exd6"]);
    controller.dispose();
  });

  it("reports the declared fifty-move result instead of a generic draw", async () => {
    const controller = new GameController();
    controller.start({
      mode: "hotseat",
      difficulty: "easy",
      playerColor: "w",
      clockMinutes: null,
      startingFen: "7k/8/8/8/8/8/1R6/K7 w - - 99 51",
    });
    expect(await controller.tryMove("b2", "b3")).toBe(true);
    expect(controller.getSnapshot().result?.reason).toBe("fiftymove");
    controller.dispose();
  });
});
