// Development-only diagnostics for automated verification of My Legacy: lets a
// browser-runner script drive the per-frame update path in isolation (to prove
// it does not allocate) and read the environment's own stats. Installed only
// when import.meta.env.DEV is true, so production builds never expose it.

import type { LegacyEnvironmentStats } from '../../../shared/legacy/environment-contract';

export interface LegacyDiagnosticsTarget {
  update(delta: number, time: number): void;
  environmentStats(): LegacyEnvironmentStats | null;
}

export interface LegacyDiagnostics {
  /** Runs the Legacy per-frame update this many times at 72 Hz steps and returns the final time. */
  runUpdates(frames: number): number;
  environmentStats(): LegacyEnvironmentStats | null;
}

declare global {
  interface Window {
    __crownfallLegacyDiagnostics?: LegacyDiagnostics;
  }
}

export function installLegacyDiagnostics(target: LegacyDiagnosticsTarget): () => void {
  let time = 0;
  window.__crownfallLegacyDiagnostics = {
    runUpdates(frames: number): number {
      for (let frame = 0; frame < frames; frame++) {
        time += 1 / 72;
        target.update(1 / 72, time);
      }
      return time;
    },
    environmentStats: () => target.environmentStats(),
  };
  return () => { delete window.__crownfallLegacyDiagnostics; };
}
