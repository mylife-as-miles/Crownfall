// Web Worker: runs the pure shared environment build off the main thread and
// transfers the resulting typed arrays without copying.

import { buildBannerhold } from "../../../../shared/legacy/environment/build/buildBannerhold";
import type { BuildInput, EnvironmentBuild } from "../../../../shared/legacy/environment/build/buildBannerhold";

interface Request {
  id: number;
  input: Omit<BuildInput, "registry" | "blueprint">;
}

export function transferablesOf(build: EnvironmentBuild): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null | undefined): void => {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  };
  for (const m of build.meshes) {
    add(m.positions); add(m.normals); add(m.uvs); add(m.colors); add(m.splat); add(m.motionWeights); add(m.landmarkIds); add(m.indices);
  }
  for (const s of build.instances) {
    add(s.transforms); add(s.tints);
    for (const p of s.prototypes) {
      add(p.positions); add(p.normals); add(p.uvs); add(p.colors); add(p.splat); add(p.motionWeights); add(p.landmarkIds); add(p.indices);
    }
  }
  add(build.field.heights);
  return Array.from(set);
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (msg: unknown, transfer: Transferable[]) => void };

scope.onmessage = (e: MessageEvent<Request>) => {
  const { id, input } = e.data;
  try {
    const t0 = performance.now();
    const build = buildBannerhold(input);
    const ms = performance.now() - t0;
    scope.postMessage({ id, build, ms }, transferablesOf(build));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
