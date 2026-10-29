// Runs Quest Bannerhold builds and heraldry atlas fills in a Web Worker; falls back to
// the main thread (with a console warning) only when workers are unavailable.

import type { LegacySceneState } from '../../../../shared/legacy/environment-contract';
import type { NationId } from '../../../../shared/legacy/types';
import type { QuestMiniature } from '../../../../shared/legacy/environment/vr/miniature';
import type { EnvironmentBuild } from '../../../../shared/legacy/environment/build/buildBannerhold';

export interface BuildResult {
  miniature: QuestMiniature;
  atlas: Uint8ClampedArray;
  buildMs: number;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class QuestBuildClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private fallbackBuild: { nationId: NationId; build: EnvironmentBuild } | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module', name: 'bannerhold-quest-build' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data);
      };
      this.worker.onerror = () => {
        this.pending.forEach((p) => p.reject(new Error('Bannerhold build worker failed')));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('no worker'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...message });
    });
  }

  async build(state: LegacySceneState, nationId: NationId, userYawDeg = 0): Promise<BuildResult> {
    if (this.worker) return this.request<BuildResult>({ kind: 'build', state, nationId, userYawDeg });
    console.warn('[Bannerhold] Web Workers are unavailable; building on the main thread.');
    const [{ buildBannerhold }, { prepareQuestMiniature }] = await Promise.all([
      import('../../../../shared/legacy/environment/build/buildBannerhold'),
      import('../../../../shared/legacy/environment/vr/miniature'),
    ]);
    const t0 = performance.now();
    const build = buildBannerhold({ state, quality: 'quest', nationId });
    const buildMs = Math.round(performance.now() - t0);
    this.fallbackBuild = { nationId, build };
    const miniature = prepareQuestMiniature(build, userYawDeg);
    return { miniature, atlas: await this.mainThreadAtlas(state, nationId), buildMs };
  }

  /** Re-prepares the last build for another user rotation (the worker keeps the build). */
  async prepare(state: LegacySceneState, nationId: NationId, userYawDeg: number): Promise<QuestMiniature> {
    if (this.worker) return (await this.request<{ miniature: QuestMiniature }>({ kind: 'prepare', state, nationId, userYawDeg })).miniature;
    const { prepareQuestMiniature } = await import('../../../../shared/legacy/environment/vr/miniature');
    if (!this.fallbackBuild || this.fallbackBuild.nationId !== nationId) return (await this.build(state, nationId, userYawDeg)).miniature;
    return prepareQuestMiniature(this.fallbackBuild.build, userYawDeg);
  }

  async atlas(state: LegacySceneState | null, nationId: NationId): Promise<Uint8ClampedArray> {
    if (this.worker) return (await this.request<{ atlas: Uint8ClampedArray }>({ kind: 'atlas', state, nationId })).atlas;
    return this.mainThreadAtlas(state, nationId);
  }

  private async mainThreadAtlas(state: LegacySceneState | null, nationId: NationId): Promise<Uint8ClampedArray> {
    const [{ fillHeraldryAtlas }, { atlasHeraldryFor }, { getBannerholdBlueprint }, { HERALDRY_ATLAS_SIZE }] = await Promise.all([
      import('../../../../shared/legacy/environment/heraldry/adapter'),
      import('../../../../shared/legacy/environment/build/state'),
      import('../../../../shared/legacy/environment/blueprint'),
      import('../../../../shared/legacy/environment/heraldry/atlas'),
    ]);
    const full = new Uint8ClampedArray(HERALDRY_ATLAS_SIZE.width * HERALDRY_ATLAS_SIZE.height * 4);
    fillHeraldryAtlas(full, atlasHeraldryFor(state, getBannerholdBlueprint(nationId).atmosphere));
    return full;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach((p) => p.reject(new Error('disposed')));
    this.pending.clear();
  }
}
