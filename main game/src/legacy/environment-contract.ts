// Desktop side of the gameplay ↔ environment contract (docs/legacy/WORKFLOWS.md).
// The environment workflow implements CreateDesktopLegacyEnvironment in
// ./environment/createLegacyEnvironment.ts; gameplay discovers it lazily with
// import.meta.glob and falls back to its stand-in when the module is absent.

import type { LandmarkId } from "../../../shared/legacy/types";
import type { LegacyEnvironmentBase, LegacySceneState } from "../../../shared/legacy/environment-contract";

export interface DesktopEnvironmentQuality {
  preset: "low" | "medium" | "high";
  /** Internal resolution percentage, 50–100. */
  renderScale: number;
  frameLimit: 0 | 30 | 60 | 120;
}

export interface DesktopLegacyEnvironmentOptions {
  container: HTMLElement;
  state: LegacySceneState;
  quality: DesktopEnvironmentQuality;
  reducedMotion: boolean;
  onLandmarkHover: (id: LandmarkId | null) => void;
  onLandmarkSelect: (id: LandmarkId) => void;
  /** Called once the first frame of the real scene has rendered. */
  onReady?: () => void;
}

export interface ScreenAnchor {
  /** CSS pixels relative to the container. */
  x: number;
  y: number;
  visible: boolean;
}

export interface DesktopLegacyEnvironment extends LegacyEnvironmentBase {
  setQuality(quality: DesktopEnvironmentQuality): void;
  setReducedMotion(reduced: boolean): void;
  /** Gamepad/keyboard orbit nudges in normalised units; the camera system clamps them. */
  nudgeOrbit(yaw: number, pitch: number, zoom?: number): void;
  /** Return to the establishing composition. */
  resetView(): void;
  /** Close inspection of the nominated representative, or of their empty place. */
  inspectRepresentative(): void;
  /** Label anchor for HTML overlays. */
  projectLandmark(id: LandmarkId): ScreenAnchor | null;
  resize(): void;
}

export type CreateDesktopLegacyEnvironment = (options: DesktopLegacyEnvironmentOptions) => Promise<DesktopLegacyEnvironment>;
