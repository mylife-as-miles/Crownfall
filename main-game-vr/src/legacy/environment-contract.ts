// Quest side of the gameplay ↔ environment contract (docs/legacy/WORKFLOWS.md).
// The environment workflow implements CreateQuestLegacyEnvironment in
// ./environment/createLegacyEnvironment.ts; gameplay discovers it lazily with
// import.meta.glob and falls back to its stand-in when the module is absent.

import type { Entity, World } from '@iwsdk/core';
import type { LandmarkId } from '../../../shared/legacy/types';
import type { LegacyEnvironmentBase, LegacySceneState } from '../../../shared/legacy/environment-contract';

export type QuestEnvironmentQuality = 'low' | 'medium' | 'high';
export type QuestPosture = 'seated' | 'standing';
type Vec3 = readonly [number, number, number];

export interface QuestLegacyEnvironmentOptions {
  world: World;
  /** Gameplay-owned anchor entity, recentred in front of the viewer. Everything the environment creates is parented under it. */
  parent: Entity;
  state: LegacySceneState;
  quality: QuestEnvironmentQuality;
  posture: QuestPosture;
  reducedMotion: boolean;
  onLandmarkHover: (id: LandmarkId | null) => void;
  onLandmarkSelect: (id: LandmarkId) => void;
}

/** Spatial staging published by the environment so gameplay can place panels comfortably. All values in anchor-space metres. */
export interface QuestStagingInfo {
  /** Uniform scale from blueprint metres to anchor metres (miniature territory). */
  scale: number;
  footprint: readonly [number, number];
  surfaceCenter: Vec3;
  panelAnchors: { primary: Vec3; dock: Vec3 };
  landmarks: readonly { id: LandmarkId; position: Vec3 }[];
}

export interface QuestLegacyEnvironment extends LegacyEnvironmentBase {
  /** Called every frame by the owning gameplay system. Must not allocate. */
  update(delta: number, time: number): void;
  setQuality(quality: QuestEnvironmentQuality): void;
  setPosture(posture: QuestPosture): void;
  setReducedMotion(reduced: boolean): void;
  setVisible(visible: boolean): void;
  getStaging(): QuestStagingInfo;
}

export type CreateQuestLegacyEnvironment = (options: QuestLegacyEnvironmentOptions) => Promise<QuestLegacyEnvironment>;
