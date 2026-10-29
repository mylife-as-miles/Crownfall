// Web Worker for the Quest Bannerhold: runs the pure shared build (quest profile) and the
// table-top preparation off the main thread, and fills the heraldry atlas, so entering
// My Legacy never blocks the XR frame loop. Typed arrays are transferred, never copied.

import { buildBannerhold } from '../../../../shared/legacy/environment/build/buildBannerhold';
import type { EnvironmentBuild } from '../../../../shared/legacy/environment/build/buildBannerhold';
import type { LegacySceneState } from '../../../../shared/legacy/environment-contract';
import type { NationId } from '../../../../shared/legacy/types';
import { atlasHeraldryFor } from '../../../../shared/legacy/environment/build/state';
import { fillHeraldryAtlas } from '../../../../shared/legacy/environment/heraldry/adapter';
import { HERALDRY_ATLAS_SIZE } from '../../../../shared/legacy/environment/heraldry/atlas';
import { getBannerholdBlueprint } from '../../../../shared/legacy/environment/blueprint';
import { miniatureTransferables, prepareQuestMiniature } from '../../../../shared/legacy/environment/vr/miniature';
import { QUEST_ATLAS_SIZE } from './constants';

export type WorkerRequest =
  | { id: number; kind: 'build'; state: LegacySceneState; nationId: NationId; userYawDeg: number }
  | { id: number; kind: 'prepare'; state: LegacySceneState; nationId: NationId; userYawDeg: number }
  | { id: number; kind: 'atlas'; state: LegacySceneState | null; nationId: NationId };

// The last build stays here so a rotation only re-runs the (much cheaper) table-top preparation.
let cached: { nationId: NationId; build: EnvironmentBuild } | null = null;

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage: (msg: unknown, transfer: Transferable[]) => void };

/** 1024² shared atlas → 512² box-filtered copy for Quest (layout is proportional, UVs unchanged). */
function questAtlas(state: LegacySceneState | null, nationId: NationId): Uint8ClampedArray {
  const W = HERALDRY_ATLAS_SIZE.width, H = HERALDRY_ATLAS_SIZE.height;
  const full = new Uint8ClampedArray(W * H * 4);
  fillHeraldryAtlas(full, atlasHeraldryFor(state, getBannerholdBlueprint(nationId).atmosphere));
  const w = QUEST_ATLAS_SIZE, h = QUEST_ATLAS_SIZE, sx = W / w, sy = H / h;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < sy; j++) {
        for (let i = 0; i < sx; i++) {
          const k = ((y * sy + j) * W + (x * sx + i)) * 4;
          r += full[k]; g += full[k + 1]; b += full[k + 2]; a += full[k + 3];
        }
      }
      const n = sx * sy, o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'atlas') {
      const atlas = questAtlas(req.state, req.nationId);
      scope.postMessage({ id: req.id, atlas }, [atlas.buffer]);
      return;
    }
    const t0 = performance.now();
    let buildMs = 0;
    if (req.kind === 'build' || !cached || cached.nationId !== req.nationId) {
      cached = { nationId: req.nationId, build: buildBannerhold({ state: req.state, quality: 'quest', nationId: req.nationId }) };
      buildMs = Math.round(performance.now() - t0);
    }
    const t1 = performance.now();
    const miniature = prepareQuestMiniature(cached.build, req.userYawDeg);
    miniature.stats.prepMs = Math.round(performance.now() - t1);
    if (req.kind === 'prepare') {
      scope.postMessage({ id: req.id, miniature, buildMs }, miniatureTransferables(miniature));
      return;
    }
    const atlas = questAtlas(req.state, req.nationId);
    scope.postMessage({ id: req.id, miniature, atlas, buildMs }, [...miniatureTransferables(miniature), atlas.buffer]);
  } catch (err) {
    scope.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
