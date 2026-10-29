// Stand-in without WebGL: a flat painted ground with four fixed landmark
// markers, so My Legacy stays usable (founding, panels, saves) on devices that
// cannot create a 3D context. It never pretends to be the 3D scene.

import { LEGACY_COPY } from "../../../../shared/legacy/content/copy";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { LandmarkDescriptor, LegacyEnvironmentStats, LegacySceneState } from "../../../../shared/legacy/environment-contract";
import type { LandmarkId } from "../../../../shared/legacy/types";
import type { DesktopLegacyEnvironment, DesktopLegacyEnvironmentOptions, ScreenAnchor } from "../environment-contract";
import { STAND_IN_FLAT_CAPTION } from "./caption";
import { STAND_IN_LANDMARKS } from "./layout";
import "./standin.css";

/** Marker positions as fractions of the container. */
const FLAT_POSITIONS: Readonly<Record<LandmarkId, readonly [number, number]>> = {
  "banner-hall": [0.5, 0.36],
  "muster-grounds": [0.24, 0.56],
  "war-record": [0.76, 0.55],
  "heralds-station": [0.57, 0.75],
};

export function createFlatStandIn(options: DesktopLegacyEnvironmentOptions): DesktopLegacyEnvironment {
  const container = options.container;
  const root = document.createElement("div");
  root.className = "legacy-standin-flat";
  root.setAttribute("aria-hidden", "true");
  const markers = new Map<LandmarkId, HTMLElement>();
  for (const id of LEGACY_LANDMARKS) {
    const marker = document.createElement("span");
    marker.className = "legacy-standin-flat-marker";
    marker.style.left = `${FLAT_POSITIONS[id][0] * 100}%`;
    marker.style.top = `${FLAT_POSITIONS[id][1] * 100}%`;
    marker.addEventListener("click", () => options.onLandmarkSelect(id));
    marker.addEventListener("pointerenter", () => options.onLandmarkHover(id));
    marker.addEventListener("pointerleave", () => options.onLandmarkHover(null));
    root.appendChild(marker);
    markers.set(id, marker);
  }
  const caption = document.createElement("p");
  caption.className = "legacy-standin-caption";
  caption.textContent = STAND_IN_FLAT_CAPTION;
  container.append(root, caption);
  const anchors = new Map<LandmarkId, ScreenAnchor>();
  for (const id of LEGACY_LANDMARKS) anchors.set(id, { x: 0, y: 0, visible: true });
  let focused: LandmarkId | null = null;
  let highlighted: LandmarkId | null = null;
  const paint = () => {
    for (const [id, marker] of markers) {
      marker.classList.toggle("is-focused", id === focused);
      marker.classList.toggle("is-highlighted", id === highlighted);
    }
  };
  requestAnimationFrame(() => options.onReady?.());
  return {
    setState(_state: LegacySceneState) { /* The flat stand-in shows no state beyond the gameplay panels. */ },
    focusLandmark(id) { focused = id; paint(); },
    highlightLandmark(id) { highlighted = id; paint(); },
    getLandmarks(): readonly LandmarkDescriptor[] {
      return LEGACY_LANDMARKS.map((id) => ({ id, label: LEGACY_COPY.landmarks[id].title, position: STAND_IN_LANDMARKS[id].position }));
    },
    setPaused() { /* Nothing animates. */ },
    getStats(): LegacyEnvironmentStats { return { triangles: 0, drawCalls: 0, geometries: 0, textures: 0, frameTimesMs: [] }; },
    setQuality() { /* No renderer to configure. */ },
    setReducedMotion() { /* Nothing animates. */ },
    nudgeOrbit() { /* No camera. */ },
    resetView() { focused = null; paint(); },
    inspectRepresentative() { focused = "muster-grounds"; paint(); },
    projectLandmark(id) {
      const anchor = anchors.get(id);
      if (!anchor) return null;
      anchor.x = FLAT_POSITIONS[id][0] * container.clientWidth;
      anchor.y = FLAT_POSITIONS[id][1] * container.clientHeight - 18;
      anchor.visible = container.clientWidth > 0;
      return anchor;
    },
    resize() { /* Positions are fractional. */ },
    dispose() { root.remove(); caption.remove(); markers.clear(); },
  };
}
