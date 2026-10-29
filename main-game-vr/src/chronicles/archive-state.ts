import { createComponent, Types } from '@iwsdk/core';

/**
 * What the archive controller reports about the room and the control surface,
 * written beside CrownfallQuestState on the menu panel's entity whenever it
 * changes, so a runtime query proves room state as well as screen state. It is
 * runtime-only and never authored in a scene, so it stays out of the editor's
 * component manifest.
 */
export const ChroniclesArchiveState = createComponent('ChroniclesArchiveState', {
  /** The room exists: building or built. */
  open: { type: Types.Boolean, default: false },
  /** The panel stands on the control surface and the room is placed around the viewer. */
  presented: { type: Types.Boolean, default: false },
  visible: { type: Types.Boolean, default: false },
  ready: { type: Types.Boolean, default: false },
  progress: { type: Types.Float32, default: 0 },
  /** The shared scene state's presentation: loading, ready, flat or failed. */
  load: { type: Types.String, default: 'loading' },
  collection: { type: Types.String, default: '' },
  /** "overview" or the focused nation. */
  focus: { type: Types.String, default: '' },
  entry: { type: Types.String, default: '' },
  /** The collection the room emphasises, and the record its marker lights. */
  emphasis: { type: Types.String, default: '' },
  selection: { type: Types.String, default: '' },
  /** "menu" or "control-surface". */
  panelPose: { type: Types.String, default: 'menu' },
  panelScale: { type: Types.Float32, default: 0 },
  /** Opacity of the head-locked fade, 0 when clear. */
  fade: { type: Types.Float32, default: 0 },
  /** Room placements so far: entries and recentres. */
  placements: { type: Types.Int16, default: 0 },
  roomYaw: { type: Types.Float32, default: 0 },
  loading: { type: Types.Boolean, default: false },
  /** Frames the loading bar has shown in the current visit, and the seconds from opening to ready. */
  loadingFrames: { type: Types.Int32, default: 0 },
  buildSeconds: { type: Types.Float32, default: 0 },
  quality: { type: Types.String, default: 'medium' },
  posture: { type: Types.String, default: 'seated' },
  triangles: { type: Types.Int32, default: 0 },
  textureBytes: { type: Types.Float32, default: 0 },
});
