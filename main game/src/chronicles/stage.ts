// The stage the Chronicles screen mounts: one WebGL view behind the screen's
// DOM, driven by the shared scene state. Its surface follows the archive
// renderer's contract (docs/chronicles/ARCHITECTURE.md §5.1), so the screen
// never depends on which renderer stands behind it. The renderer module loads
// lazily, in its own chunk, only when Chronicles opens.
//
// Today the stage is the Living Atlas relief renderer (scene/AtlasScene)
// behind a small adapter. When the archive renderer (scene/ArchiveScene)
// lands, createChroniclesStage imports it instead and returns it as it is:
// its contract already has this shape.
import { getHotspotRecords } from "../../../shared/chronicles/content";
import type { ChronicleCollectionId, ChroniclesFocus } from "../../../shared/chronicles/types";
import type { Direction, FrameLimit, Quality } from "../settings-types";

export type ChroniclesStageTarget = { kind: "marker"; index: number } | { kind: "exhibit"; collection: ChronicleCollectionId };
export type ChroniclesStageFailure = "webgl" | "context-lost" | "build";

export interface ChroniclesStageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the stage frames: the collection, its focus, the emphasised marker and the open entry's marker (each -1 for none). */
export interface ChroniclesStageView {
  collection: ChronicleCollectionId;
  focus: ChroniclesFocus;
  emphasized: number;
  open: number;
}

export interface ChroniclesStageStats {
  drawCalls: number;
  triangles: number;
  programs?: number;
  textures?: number;
  textureBytes?: number;
}

export interface ChroniclesStageOptions {
  host: HTMLElement;
  quality: Quality;
  renderScale: number;
  frameLimit: FrameLimit;
  reducedMotion: boolean;
  /** 0–1, monotonic, between build steps. */
  onProgress(share: number): void;
  /** Programs compiled, textures uploaded and the first frame drawn. */
  onReady(): void;
  onFailure(reason: ChroniclesStageFailure): void;
  /** A real pointer movement over a target. */
  onPointerTarget(target: ChroniclesStageTarget | null): void;
  /** A click or tap on a target. */
  onActivateTarget(target: ChroniclesStageTarget): void;
}

export interface ChroniclesStage {
  /** Renders only while shown and the page is visible. */
  setActive(active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setView(view: ChroniclesStageView): void;
  /** Stage space to keep clear with no entry open, and with one open. */
  setInsets(closed: ChroniclesStageInsets, open: ChroniclesStageInsets): void;
  /** Elements placed over each marker, in getHotspotRecords order. */
  setLabels(labels: readonly (HTMLElement | null)[]): void;
  /** A keyboard turn or tilt within the framing's limits. */
  orbit(direction: Direction): void;
  /** Positive steps move in. */
  zoom(steps: number): void;
  stats(): ChroniclesStageStats;
  dispose(): void;
}

const nations = getHotspotRecords().map((record) => record.nation);

/**
 * Loads the renderer and creates the stage. Rejects when the module cannot load
 * or WebGL is unavailable; later failures arrive through onFailure.
 */
export async function createChroniclesStage(options: ChroniclesStageOptions): Promise<ChroniclesStage> {
  options.onProgress(0.05);
  const { createAtlasScene } = await import("./scene/AtlasScene");
  options.onProgress(1 / 3);
  const { host } = options;
  let lost = false, settledReady = false;
  // Registered as a capturing listener, so it runs before the renderer's own
  // handler reports the failure, and the reason is known by then.
  const onLost = () => { lost = true; };
  const scene = createAtlasScene({
    host,
    quality: options.quality,
    renderScale: options.renderScale,
    frameLimit: options.frameLimit,
    reducedMotion: options.reducedMotion,
    onReady() {
      settledReady = true;
      options.onProgress(1);
      options.onReady();
    },
    onFailure: () => options.onFailure(lost || settledReady ? "context-lost" : "build"),
    onPointerMarker: (index) => options.onPointerTarget({ kind: "marker", index }),
    onActivateMarker: (index) => options.onActivateTarget({ kind: "marker", index }),
  });
  const canvas = host.querySelector("canvas");
  canvas?.addEventListener("webglcontextlost", onLost, { capture: true });
  options.onProgress(2 / 3);
  // The relief draws only in the Atlas. Leaving it, the relief first returns
  // to its overview, then rests on that frame (dimmed by the screen while the
  // host carries data-stage-resting) and nothing renders.
  let active = true, collection: ChronicleCollectionId = "atlas";
  // Settled on the overview, or wherever the visitor turned it: never mid-flight or on a nation.
  const settled = () => host.dataset.cameraSettled === "true" && (host.dataset.camera === "overview" || host.dataset.camera === "free");
  const apply = () => {
    const atlas = collection === "atlas";
    scene.setActive(active && (atlas || !settled()));
    if (atlas) delete host.dataset.stageResting;
    else host.dataset.stageResting = "true";
  };
  const settling = new MutationObserver(() => { if (collection !== "atlas") apply(); });
  settling.observe(host, { attributes: true, attributeFilter: ["data-camera-settled", "data-camera"] });
  return {
    setActive(value) {
      active = value;
      apply();
    },
    setReducedMotion: (reduced) => scene.setReducedMotion(reduced),
    setView(view) {
      collection = view.collection;
      // The relief's camera follows its "open" marker: the open entry's, or else the focused nation's.
      const focused = view.focus.kind === "nation" ? nations.indexOf(view.focus.nation) : -1;
      const atlas = view.collection === "atlas";
      scene.setSelection(atlas ? view.emphasized : -1, atlas ? (view.open >= 0 ? view.open : focused) : -1);
      apply();
    },
    setInsets: (closed, open) => scene.setInsets(closed, open),
    setLabels: (labels) => scene.setLabels(labels),
    orbit: (direction) => scene.orbit(direction),
    zoom: (steps) => scene.zoom(steps),
    stats: () => ({ drawCalls: Number(host.dataset.drawCalls) || 0, triangles: Number(host.dataset.triangles) || 0 }),
    dispose() {
      settling.disconnect();
      canvas?.removeEventListener("webglcontextlost", onLost, { capture: true });
      delete host.dataset.stageResting;
      scene.dispose();
    },
  };
}

