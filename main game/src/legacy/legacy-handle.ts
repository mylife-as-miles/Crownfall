// Imperative input surface App.tsx drives while My Legacy is open. App keeps
// owning the configurable key bindings and the gamepad poll loop; the Legacy
// screen interprets them for its own layers (dialog, inspection, overview).

import type { SettingsPageHandle } from "../settings-types";

export interface LegacyScreenHandle extends SettingsPageHandle {
  /** Previous/next tab bindings and controller bumpers cycle the landmarks. */
  cycle(delta: 1 | -1): void;
  /** Right stick and triggers: one frame's orbit nudge, already scaled by frame time. */
  orbit(yaw: number, pitch: number, zoom: number): void;
}
