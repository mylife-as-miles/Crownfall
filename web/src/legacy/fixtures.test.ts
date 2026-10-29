import { GameController } from "../core/gameController";
import { BattleIdentityTracker } from "../campaign/identity";
import type { MoveEvent, PieceKind } from "../core/types";
import { getLegacyPreviewRecords, getLegacyPreviewTapes, listLegacyPreviews } from "../../../shared/legacy/domain/fixtures";

/**
 * Development previews must never show an impossible game. Every fixture tape is
 * replayed through the real GameController (chess.js) and BattleIdentityTracker,
 * and the fixture's identity records must match the real tracker's exactly.
 */
describe("Legacy preview fixtures are legal chess", () => {
  for (const preview of listLegacyPreviews()) {
    const records = getLegacyPreviewRecords(preview.id);
    const tapes = getLegacyPreviewTapes(preview.id);
    if (records.length === 0) continue;

    it(`${preview.id}: every fixture match is a legal game whose identities match the real tracker`, async () => {
      expect(tapes).toHaveLength(records.length);
      for (const [index, record] of records.entries()) {
        const game = new GameController();
        game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
        const tracker = new BattleIdentityTracker({ ...record.formation });
        game.on("move", (event: MoveEvent) => void tracker.apply(event));
        for (const move of tapes[index]) {
          const promotion = move.length > 4 ? (move.charAt(4) as PieceKind) : undefined;
          expect(await game.tryMove(move.slice(0, 2), move.slice(2, 4), promotion), `${preview.id} ${move}`).toBe(true);
        }
        if (record.result.reason === "resignation") game.resign();
        expect(game.getSnapshot().result).toEqual(record.result);
        expect(record.moves).toEqual(tracker.getRecords());
        game.dispose();
      }
    });
  }
});
