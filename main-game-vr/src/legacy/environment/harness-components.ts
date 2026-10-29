// System-free component for the ?legacyEnvironment development harness. Registered at
// runtime by the harness (not in src/components.ts: it is never authored in scenes). It is
// the command and readback channel for capture scripts (`npx @iwsdk/cli ecs set-component`
// and `ecs query`), so automation never needs page scripting.

import { createComponent, Types } from '@iwsdk/core';

export const LegacyEnvironmentHarnessState = createComponent('LegacyEnvironmentHarnessState', {
  ready: { type: Types.Boolean, default: false },
  caption: { type: Types.String, default: '' },
  nation: { type: Types.String, default: 'korvenia' },
  fixture: { type: Types.String, default: 'founded' },
  quality: { type: Types.String, default: 'high' },
  posture: { type: Types.String, default: 'seated' },
  yaw: { type: Types.Float32, default: 0 },
  panels: { type: Types.Boolean, default: false },
  reducedMotion: { type: Types.Boolean, default: false },
  paused: { type: Types.Boolean, default: false },
  /** recenter | focus:<landmark> | focus: | highlight:<landmark> | highlight: | stats */
  command: { type: Types.String, default: '' },
  commandSeq: { type: Types.Int32, default: 0 },
  handledSeq: { type: Types.Int32, default: 0 },
  hover: { type: Types.String, default: '' },
  lastSelect: { type: Types.String, default: '' },
  selectCount: { type: Types.Int32, default: 0 },
  hoverCount: { type: Types.Int32, default: 0 },
  focus: { type: Types.String, default: '' },
  presenting: { type: Types.Boolean, default: false },
  recenters: { type: Types.Int32, default: 0 },
  /** JSON: environment debug info, staging and anchor-space targets, refreshed by the stats command. */
  report: { type: Types.String, default: '' },
});
