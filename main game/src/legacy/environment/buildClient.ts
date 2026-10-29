// Runs environment builds in a Web Worker (falls back to the main thread when
// workers are unavailable) so building never blocks interaction.

import type { BuildInput, EnvironmentBuild } from "../../../../shared/legacy/environment/build/buildBannerhold";

type Input = Omit<BuildInput, "registry" | "blueprint">;

export class BuildClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (b: { build: EnvironmentBuild; ms: number }) => void; reject: (e: Error) => void }>();

  constructor() {
    try {
      this.worker = new Worker(new URL("./build.worker.ts", import.meta.url), { type: "module", name: "bannerhold-build" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; build?: EnvironmentBuild; ms?: number; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.build) p.resolve({ build: e.data.build, ms: e.data.ms ?? 0 });
        else p.reject(new Error(e.data.error ?? "environment build failed"));
      };
      this.worker.onerror = () => {
        this.pending.forEach((p) => p.reject(new Error("environment build worker failed")));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  async build(input: Input): Promise<{ build: EnvironmentBuild; ms: number }> {
    if (!this.worker) {
      const mod = await import("../../../../shared/legacy/environment/build/buildBannerhold");
      const t0 = performance.now();
      const build = mod.buildBannerhold(input);
      return { build, ms: performance.now() - t0 };
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, input });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach((p) => p.reject(new Error("disposed")));
    this.pending.clear();
  }
}
