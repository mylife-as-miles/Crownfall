// The gameplay workflow's stand-in for the Bannerhold environment: an honest,
// minimal implementation of DesktopLegacyEnvironment (neutral ground, one plain
// marker per landmark, an "Environment stand-in" caption). It exists so the
// Legacy UI, input mapping and verification run against the real contract
// before the environment workflow's renderer lands. Renders on demand only:
// camera moves, highlight fades and visible state changes request frames; an
// idle scene, or a state change it does not show, costs nothing. Creation is
// spread over frames (context, scene, banner, one shader program per frame) so
// the loading state keeps painting between the steps.

import * as THREE from "three";
import { LEGACY_COPY } from "../../../../shared/legacy/content/copy";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import { LEGACY_LANDMARKS, TINCTURE_SRGB } from "../../../../shared/legacy/environment-contract";
import type { LandmarkDescriptor, LegacyEnvironmentStats, LegacySceneState } from "../../../../shared/legacy/environment-contract";
import { HeraldryRasterizer } from "../../../../shared/legacy/heraldry/raster";
import type { Heraldry, LandmarkId, NationId } from "../../../../shared/legacy/types";
import { nextRenderTimestamp, normalizeFrameLimit, normalizeRenderScale } from "../../effects/render-controls";
import type { FrameLimit } from "../../effects/render-controls";
import type {
  CreateDesktopLegacyEnvironment, DesktopEnvironmentQuality, DesktopLegacyEnvironment, DesktopLegacyEnvironmentOptions, ScreenAnchor,
} from "../environment-contract";
import { createFlatStandIn } from "./flatStandIn";
import { BANNER_TEXTURE_HEIGHT, BANNER_TEXTURE_WIDTH, buildStandInScene, Disposables, MAX_RECORD_STONES } from "./meshes";
import type { StandInParts } from "./meshes";
import { ORBIT_LIMITS, representativeFraming, STAND_IN_LANDMARKS, STAND_IN_OVERVIEW } from "./layout";
import type { StandInFraming } from "./layout";
import { STAND_IN_CAPTION } from "./caption";
import "./standin.css";

const PIXEL_RATIO_CAP: Readonly<Record<DesktopEnvironmentQuality["preset"], number>> = { low: 1, medium: 1.5, high: 2 };
const CAMERA_FOV = 38;
const TWEEN_MS = 950;
const FRAME_SAMPLES = 120;
/**
 * Frame pacing is sampled only inside runs of continuous rendering (a drag, a
 * camera move, a highlight fade): frames further apart than this are a pause
 * of the on-demand renderer, not a slow frame, and the first two frames of a
 * run are skipped.
 */
const FRAME_GAP_MS = 500;
const RUN_WARMUP_FRAMES = 2;
const DRAG_THRESHOLD_PX = 5;
const NEUTRAL_DARK = new THREE.Color("#15120e");
const NEUTRAL_GROUND = new THREE.Color("#4d463a");
const NEUTRAL_PLAZA = new THREE.Color("#6e6555");
const NEUTRAL_CLOTH: readonly [number, number, number] = [126, 118, 104];
const OUTCOME_STONES = { victory: TINCTURE_SRGB.or, defeat: TINCTURE_SRGB.sanguine, draw: TINCTURE_SRGB.argent } as const;

// Pose slots: target x/y/z, azimuth, polar, radius, shift.
const TX = 0, TY = 1, TZ = 2, AZ = 3, POL = 4, RAD = 5, SHIFT = 6;

function writeFraming(out: Float64Array, framing: StandInFraming): void {
  out[TX] = framing.target[0];
  out[TY] = framing.target[1];
  out[TZ] = framing.target[2];
  out[AZ] = framing.azimuth;
  out[POL] = framing.polar;
  out[RAD] = framing.radius;
  out[SHIFT] = framing.shift;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function heraldryKey(heraldry: Heraldry | null): string {
  if (!heraldry) return "";
  return `${heraldry.division}|${heraldry.field[0]}|${heraldry.field[1]}|${heraldry.ordinary}|${heraldry.ordinaryTincture}|${heraldry.charge}|${heraldry.chargeTincture}`;
}

/** Oldest-first copy of a ring buffer of samples. */
function ringToArray(ring: Float32Array, count: number, cursor: number): number[] {
  const out: number[] = [];
  const start = count < ring.length ? 0 : cursor;
  for (let index = 0; index < count; index++) out.push(ring[(start + index) % ring.length]);
  return out;
}

/** Resolves after the next frame has been produced, so a long step never shares a task with the previous one. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/**
 * Everything the stand-in draws from a scene state, as one comparable value.
 * Fields it does not show (the banner name typed during founding, honours,
 * counts) are left out, so changing them never costs a WebGL frame.
 */
function visibleStateKey(state: LegacySceneState): string {
  const representative = state.representative;
  let levy = 0;
  for (const member of state.levy) if (member.status !== "captive") levy++;
  let markers = "";
  for (let index = 0; index < state.matchMarkers.length && index < MAX_RECORD_STONES; index++) markers += state.matchMarkers[index].outcome.charAt(0);
  const lantern = state.unreadNotices > 0 ? 2 : state.noticeKinds.length > 0 ? 1 : 0;
  const rep = representative ? `${representative.status}|${representative.promotedTo ?? ""}` : "none";
  return `${state.nationId}|${heraldryKey(state.heraldry)}|${state.hallTier}|${rep}|${Math.min(levy, 3)}|${markers}|${lantern}`;
}

class StandInEnvironment implements DesktopLegacyEnvironment {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.5, 180);
  private readonly disposables: Disposables;
  private readonly parts: StandInParts;
  private readonly hemisphere = new THREE.HemisphereLight("#d8cdb8", "#2a2219", 1.5);
  private readonly sun = new THREE.DirectionalLight("#ffe7c4", 2.1);
  private readonly fog = new THREE.Fog("#15120e", 30, 62);
  private readonly rasterizer = new HeraldryRasterizer();
  private readonly caption: HTMLElement;
  private readonly onHover: (id: LandmarkId | null) => void;
  private readonly onSelect: (id: LandmarkId) => void;
  private onReady: (() => void) | undefined;

  private readonly from = new Float64Array(7);
  private readonly to = new Float64Array(7);
  private readonly pose = new Float64Array(7);
  private tweenStart = 0;
  private tweenDuration = 0;
  private userYaw = 0;
  private userPitch = 0;
  private userZoom = 1;
  private cameraDirty = true;

  private focused: LandmarkId | null = null;
  private highlighted: LandmarkId | null = null;
  private readonly glow = new Float32Array(LEGACY_LANDMARKS.length);
  private readonly glowTarget = new Float32Array(LEGACY_LANDMARKS.length);

  private readonly anchors = new Map<LandmarkId, ScreenAnchor>();
  private readonly projected = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];

  private width = 0;
  private height = 0;
  private quality: DesktopEnvironmentQuality;
  private frameLimit: FrameLimit;
  private reducedMotion: boolean;
  private paused = false;
  private disposed = false;
  private contextLost = false;
  private frameHandle = 0;
  private hoverHandle = 0;
  private lastRendered = 0;
  private lastFrame = 0;
  private idle = true;
  /** True until prepare() finishes: its grouped warm-up renders stay off screen and no frame is drawn mid-way. */
  private preparing = true;
  private firstFrameDone = false;
  /** Intervals between consecutive rendered frames during continuous rendering (frame pacing, GPU-bound frames included). */
  private readonly frameIntervals = new Float32Array(FRAME_SAMPLES);
  private frameIntervalCount = 0;
  private frameIntervalCursor = 0;
  /** Main-thread time inside renderer.render (render submission only). */
  private readonly submissions = new Float32Array(FRAME_SAMPLES);
  private submissionCount = 0;
  private submissionCursor = 0;
  private lastRenderedAt = 0;
  private runLength = 0;

  private nationId: NationId | null = null;
  private bannerKey = "\u0000";
  private stateKey = "";
  private hovered: LandmarkId | null = null;
  private pointerDown = false;
  private dragging = false;
  private pointerId = -1;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private hoverX = 0;
  private hoverY = 0;

  constructor(options: DesktopLegacyEnvironmentOptions, renderer: THREE.WebGLRenderer, disposables: Disposables, parts: StandInParts) {
    this.container = options.container;
    this.renderer = renderer;
    this.disposables = disposables;
    this.parts = parts;
    this.quality = { ...options.quality };
    this.frameLimit = normalizeFrameLimit(options.quality.frameLimit);
    this.reducedMotion = options.reducedMotion;
    this.onHover = options.onLandmarkHover;
    this.onSelect = options.onLandmarkSelect;
    this.onReady = options.onReady;

    // Skip three's synchronous link-status queries; the built-in materials here are known-good,
    // and the queries stall the main thread while a slow driver links programs.
    renderer.debug.checkShaderErrors = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "legacy-standin-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    this.container.appendChild(renderer.domElement);

    this.scene.add(this.parts.root, this.hemisphere, this.sun);
    this.sun.position.set(-9, 16, 11);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color("#15120e");

    this.caption = document.createElement("p");
    this.caption.className = "legacy-standin-caption";
    this.caption.textContent = STAND_IN_CAPTION;
    this.container.appendChild(this.caption);

    for (const id of LEGACY_LANDMARKS) this.anchors.set(id, { x: 0, y: 0, visible: false });
    writeFraming(this.from, STAND_IN_OVERVIEW);
    writeFraming(this.to, STAND_IN_OVERVIEW);
    writeFraming(this.pose, STAND_IN_OVERVIEW);

    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerCancel);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.applyPixelRatio();
    this.resize();
  }

  /**
   * Front-loads GPU work while the loading state shows: every optional part is
   * made visible and each shader program is linked in its own frame (meshes
   * grouped by program), so no single task links them all and later state
   * changes or camera moves never compile mid-flight. Drivers with
   * KHR_parallel_shader_compile link everything off the main thread first
   * (renderer.compileAsync). The canvas stays transparent and no regular frame
   * is drawn until this finishes, so the partial warm-up renders are never seen.
   */
  async prepare(): Promise<void> {
    const parts = this.parts;
    const optional: THREE.Object3D[] = [parts.hallTower, parts.hallSpire, parts.representative, parts.crown, parts.emptyPlace, parts.restingTent, ...parts.levy];
    for (const id of LEGACY_LANDMARKS) optional.push(parts.rings[id]);
    const visibility = optional.map((object) => object.visible);
    const stoneCount = parts.stones.count;
    for (const object of optional) object.visible = true;
    parts.stones.count = MAX_RECORD_STONES;
    this.poseCamera(performance.now());
    const groups = new Map<string, THREE.Mesh[]>();
    const meshes: THREE.Mesh[] = [];
    this.parts.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes.push(object);
      const material = object.material as THREE.Material & { map?: THREE.Texture | null };
      const key = `${material.type}|${material.map ? "map" : ""}|${object instanceof THREE.InstancedMesh ? "instanced" : ""}`;
      const group = groups.get(key);
      if (group) group.push(object);
      else groups.set(key, [object]);
    });
    const shown = meshes.map((mesh) => mesh.visible);
    try {
      // Where the driver links programs in parallel, let it link them all off the main thread first;
      // elsewhere each program's link stays in its own frame below.
      if (this.renderer.extensions.has("KHR_parallel_shader_compile")) {
        await this.renderer.compileAsync(this.scene, this.camera);
        if (this.disposed) return;
      }
      for (const group of groups.values()) {
        for (const mesh of meshes) mesh.visible = false;
        for (const mesh of group) mesh.visible = true;
        this.renderer.render(this.scene, this.camera);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (this.disposed) return;
      }
      meshes.forEach((mesh, index) => { mesh.visible = shown[index]; });
      // One full frame uploads whatever the grouped frames did not (shared buffers, instance data).
      this.renderer.render(this.scene, this.camera);
    } finally {
      meshes.forEach((mesh, index) => { mesh.visible = shown[index]; });
      optional.forEach((object, index) => { object.visible = visibility[index]; });
      parts.stones.count = stoneCount;
      this.preparing = false;
    }
    this.cameraDirty = true;
    this.invalidate();
  }

  // ---------------------------------------------------------------- state

  setState(state: LegacySceneState): void {
    if (this.disposed) return;
    const key = visibleStateKey(state);
    if (key === this.stateKey) return;
    this.stateKey = key;
    if (state.nationId !== this.nationId) this.applyPalette(state.nationId);
    const banner = heraldryKey(state.heraldry);
    if (banner !== this.bannerKey) {
      this.bannerKey = banner;
      this.paintBanner(state.heraldry);
    }
    const tier = state.hallTier;
    this.parts.hallTower.visible = tier >= 1;
    this.parts.hallTower.scale.y = tier >= 3 ? 1.3 : 1;
    this.parts.hallTower.position.y = 0.35 + 1.6 * this.parts.hallTower.scale.y;
    this.parts.hallSpire.visible = tier >= 2;
    this.parts.hallSpire.position.y = 0.35 + 3.2 * this.parts.hallTower.scale.y + 0.8;
    this.applyRepresentative(state);
    this.applyRecords(state);
    const lantern = this.parts.lanternMaterial;
    lantern.emissiveIntensity = state.unreadNotices > 0 ? 2.6 : state.noticeKinds.length > 0 ? 0.55 : 0.08;
    this.invalidate();
  }

  private applyPalette(nationId: NationId): void {
    this.nationId = nationId;
    const palette = NATIONS[nationId].palette;
    const background = this.scene.background;
    if (background instanceof THREE.Color) background.set(palette.sky).lerp(NEUTRAL_DARK, 0.62);
    this.fog.color.set(palette.sky).lerp(NEUTRAL_DARK, 0.62);
    this.parts.groundMaterial.color.set(palette.primary).lerp(NEUTRAL_GROUND, 0.72);
    this.parts.plazaMaterial.color.copy(NEUTRAL_PLAZA).lerp(this.color.set(palette.secondary), 0.16);
    this.parts.roofMaterial.color.set(palette.secondary).lerp(NEUTRAL_GROUND, 0.25);
    this.parts.metalMaterial.color.set(palette.metal);
    this.hemisphere.color.set(palette.sky).lerp(this.color.set("#ffffff"), 0.55);
    for (const id of LEGACY_LANDMARKS) this.parts.accents[id].color.set(palette.secondary);
  }

  private paintBanner(heraldry: Heraldry | null): void {
    const pixels = this.parts.bannerPixels;
    if (heraldry) {
      this.rasterizer.rasterize(heraldry, { width: BANNER_TEXTURE_WIDTH, height: BANNER_TEXTURE_HEIGHT, aspect: "banner" }, pixels);
    } else {
      // An undyed cloth until a banner is raised.
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = NEUTRAL_CLOTH[0];
        pixels[index + 1] = NEUTRAL_CLOTH[1];
        pixels[index + 2] = NEUTRAL_CLOTH[2];
        pixels[index + 3] = 255;
      }
    }
    this.parts.bannerTexture.needsUpdate = true;
  }

  private applyRepresentative(state: LegacySceneState): void {
    const parts = this.parts;
    const representative = state.representative;
    const field = state.heraldry ? TINCTURE_SRGB[state.heraldry.field[0]] : "#b9b2a4";
    parts.representativeMaterial.color.set(field).lerp(this.color.set("#d8d0c0"), 0.25);
    parts.representative.visible = representative !== null && representative.status !== "captive";
    parts.emptyPlace.visible = representative !== null && representative.status === "captive";
    parts.crown.visible = representative !== null && representative.promotedTo !== null;
    const resting = representative !== null && representative.status === "injured";
    parts.restingTent.visible = resting;
    if (resting) parts.representative.position.set(1.2, 0.43, -0.1);
    else parts.representative.position.set(0, 0.43, 0.85);
    let slot = 0;
    for (const member of state.levy) {
      if (slot >= parts.levy.length) break;
      if (member.status === "captive") continue;
      parts.levy[slot].visible = true;
      slot++;
    }
    for (; slot < parts.levy.length; slot++) parts.levy[slot].visible = false;
  }

  private applyRecords(state: LegacySceneState): void {
    const stones = this.parts.stones;
    const count = Math.min(MAX_RECORD_STONES, state.matchMarkers.length);
    for (let index = 0; index < count; index++) {
      stones.setColorAt(index, this.color.set(OUTCOME_STONES[state.matchMarkers[index].outcome]));
    }
    stones.count = count;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera

  focusLandmark(id: LandmarkId | null): void {
    this.focused = id;
    this.updateGlowTargets();
    this.animateTo(id ? STAND_IN_LANDMARKS[id].framing : STAND_IN_OVERVIEW);
  }

  highlightLandmark(id: LandmarkId | null): void {
    if (this.highlighted === id) return;
    this.highlighted = id;
    this.updateGlowTargets();
    this.invalidate();
  }

  resetView(): void {
    this.focused = null;
    this.updateGlowTargets();
    this.animateTo(STAND_IN_OVERVIEW);
  }

  inspectRepresentative(): void {
    this.focused = "muster-grounds";
    this.updateGlowTargets();
    this.animateTo(representativeFraming());
  }

  nudgeOrbit(yaw: number, pitch: number, zoom = 0): void {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(zoom)) return;
    this.userYaw = clamp(this.userYaw + yaw * 0.9, -ORBIT_LIMITS.yaw, ORBIT_LIMITS.yaw);
    this.userPitch = clamp(this.userPitch + pitch * 0.6, -ORBIT_LIMITS.pitchDown, ORBIT_LIMITS.pitchUp);
    this.userZoom = clamp(this.userZoom * Math.exp(-zoom * 0.8), ORBIT_LIMITS.zoomIn, ORBIT_LIMITS.zoomOut);
    this.cameraDirty = true;
    this.invalidate();
  }

  private animateTo(framing: StandInFraming): void {
    const now = performance.now();
    this.poseCamera(now);
    // Bake any orbit offset into the start pose so the move begins exactly where the camera is.
    this.from.set(this.pose);
    this.from[AZ] += this.userYaw;
    this.from[POL] = clamp(this.from[POL] - this.userPitch, ORBIT_LIMITS.polarMin, ORBIT_LIMITS.polarMax);
    this.from[RAD] *= this.userZoom;
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 1;
    writeFraming(this.to, framing);
    this.tweenStart = now;
    this.tweenDuration = this.reducedMotion ? 0 : TWEEN_MS;
    this.cameraDirty = true;
    this.invalidate();
  }

  /** Poses the camera for time `now`. Idempotent, so label projection can call it between frames. */
  private poseCamera(now: number): boolean {
    let moving = false;
    if (this.tweenDuration > 0) {
      const t = clamp((now - this.tweenStart) / this.tweenDuration, 0, 1);
      const eased = easeInOutCubic(t);
      for (let index = 0; index < 7; index++) this.pose[index] = this.from[index] + (this.to[index] - this.from[index]) * eased;
      if (t >= 1) this.tweenDuration = 0;
      else moving = true;
    } else {
      this.pose.set(this.to);
    }
    const azimuth = this.pose[AZ] + this.userYaw;
    const polar = clamp(this.pose[POL] - this.userPitch, ORBIT_LIMITS.polarMin, ORBIT_LIMITS.polarMax);
    const radius = this.pose[RAD] * this.userZoom;
    const sinPolar = Math.sin(polar);
    // Pan sideways (not rotate) so the subject sits left of an inspection panel at its own depth.
    const halfWidth = radius * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * this.camera.aspect;
    const pan = this.pose[SHIFT] * halfWidth;
    const rightX = Math.cos(azimuth);
    const rightZ = -Math.sin(azimuth);
    this.cameraTarget.set(this.pose[TX] + rightX * pan, this.pose[TY], this.pose[TZ] + rightZ * pan);
    this.camera.position.set(
      this.cameraTarget.x + radius * sinPolar * Math.sin(azimuth),
      this.cameraTarget.y + radius * Math.cos(polar),
      this.cameraTarget.z + radius * sinPolar * Math.cos(azimuth),
    );
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();
    this.cameraDirty = false;
    return moving;
  }

  projectLandmark(id: LandmarkId): ScreenAnchor | null {
    const anchor = this.anchors.get(id);
    const layout = STAND_IN_LANDMARKS[id];
    if (!anchor || !layout) return null;
    if (this.cameraDirty || this.tweenDuration > 0) this.poseCamera(performance.now());
    this.projected.set(layout.position[0], layout.position[1] + layout.labelHeight, layout.position[2]).project(this.camera);
    anchor.x = (this.projected.x + 1) * 0.5 * this.width;
    anchor.y = (1 - this.projected.y) * 0.5 * this.height;
    anchor.visible = this.projected.z < 1 && this.projected.x > -1.1 && this.projected.x < 1.1 && this.projected.y > -1.1 && this.projected.y < 1.1;
    return anchor;
  }

  getLandmarks(): readonly LandmarkDescriptor[] {
    return LEGACY_LANDMARKS.map((id) => ({ id, label: LEGACY_COPY.landmarks[id].title, position: STAND_IN_LANDMARKS[id].position }));
  }

  private updateGlowTargets(): void {
    for (let index = 0; index < LEGACY_LANDMARKS.length; index++) {
      const id = LEGACY_LANDMARKS[index];
      this.glowTarget[index] = id === this.highlighted ? 1 : id === this.focused ? 0.55 : 0;
    }
  }

  // ---------------------------------------------------------------- frames

  private invalidate(): void {
    if (this.preparing || this.paused || this.disposed || this.frameHandle !== 0) return;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameHandle = 0;
    if (this.paused || this.disposed) return;
    const timestamp = nextRenderTimestamp(now, this.lastRendered, this.frameLimit);
    if (timestamp === null) {
      this.frameHandle = requestAnimationFrame(this.frame);
      return;
    }
    const delta = this.idle ? 1 / 60 : Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.lastRendered = timestamp;
    const cameraMoving = this.poseCamera(now);
    const glowing = this.stepGlow(delta);
    if (!this.contextLost) {
      const start = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.recordSubmission(performance.now() - start);
      this.recordFrameInterval(now);
      if (!this.firstFrameDone) {
        this.firstFrameDone = true;
        this.renderer.domElement.classList.add("is-ready");
        const ready = this.onReady;
        this.onReady = undefined;
        ready?.();
      }
    }
    this.idle = !(cameraMoving || glowing);
    if (!this.idle) this.frameHandle = requestAnimationFrame(this.frame);
  };

  private stepGlow(delta: number): boolean {
    let animating = false;
    const blend = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 11);
    for (let index = 0; index < LEGACY_LANDMARKS.length; index++) {
      const id = LEGACY_LANDMARKS[index];
      const target = this.glowTarget[index];
      let value = this.glow[index] + (target - this.glow[index]) * blend;
      if (Math.abs(target - value) < 0.01) value = target;
      else animating = true;
      this.glow[index] = value;
      const ring = this.parts.rings[id];
      ring.visible = value > 0.005;
      ring.material.opacity = value * 0.8;
      // Focus alone keeps the ring; only hover/keyboard emphasis lights the accent stone.
      this.parts.accents[id].emissiveIntensity = Math.max(0, value - 0.55) * 1.6;
    }
    return animating;
  }

  private recordSubmission(ms: number): void {
    this.submissions[this.submissionCursor] = ms;
    this.submissionCursor = (this.submissionCursor + 1) % FRAME_SAMPLES;
    if (this.submissionCount < FRAME_SAMPLES) this.submissionCount++;
  }

  private recordFrameInterval(now: number): void {
    const interval = now - this.lastRenderedAt;
    this.lastRenderedAt = now;
    if (interval <= 0 || interval > FRAME_GAP_MS) {
      this.runLength = 0;
      return;
    }
    this.runLength++;
    if (this.runLength <= RUN_WARMUP_FRAMES) return;
    this.frameIntervals[this.frameIntervalCursor] = interval;
    this.frameIntervalCursor = (this.frameIntervalCursor + 1) % FRAME_SAMPLES;
    if (this.frameIntervalCount < FRAME_SAMPLES) this.frameIntervalCount++;
  }

  // ---------------------------------------------------------------- input

  private pick(clientX: number, clientY: number): LandmarkId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    if (this.cameraDirty || this.tweenDuration > 0) this.poseCamera(performance.now());
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.parts.proxies, false, this.hits);
    const hit = this.hits[0];
    const id: unknown = hit ? hit.object.userData.landmark : null;
    this.hits.length = 0;
    return typeof id === "string" && (LEGACY_LANDMARKS as readonly string[]).includes(id) ? (id as LandmarkId) : null;
  }

  private setHovered(id: LandmarkId | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? "pointer" : this.dragging ? "grabbing" : "grab";
    this.onHover(id);
  }

  private readonly processHover = (): void => {
    this.hoverHandle = 0;
    if (this.disposed || this.pointerDown) return;
    this.setHovered(this.pick(this.hoverX, this.hoverY));
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.disposed) return;
    this.pointerDown = true;
    this.dragging = false;
    this.pointerId = event.pointerId;
    this.downX = this.lastX = event.clientX;
    this.downY = this.lastY = event.clientY;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.pointerDown && event.pointerId === this.pointerId) {
      if (!this.dragging && Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > DRAG_THRESHOLD_PX) {
        this.dragging = true;
        this.setHovered(null);
        this.renderer.domElement.style.cursor = "grabbing";
      }
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.userYaw = clamp(this.userYaw - dx * 0.0042, -ORBIT_LIMITS.yaw, ORBIT_LIMITS.yaw);
        this.userPitch = clamp(this.userPitch + dy * 0.0032, -ORBIT_LIMITS.pitchDown, ORBIT_LIMITS.pitchUp);
        this.cameraDirty = true;
        this.invalidate();
      }
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      return;
    }
    this.hoverX = event.clientX;
    this.hoverY = event.clientY;
    if (this.hoverHandle === 0) this.hoverHandle = requestAnimationFrame(this.processHover);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown || event.pointerId !== this.pointerId) return;
    const wasDragging = this.dragging;
    this.pointerDown = false;
    this.dragging = false;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grab";
    if (wasDragging) return;
    const id = this.pick(event.clientX, event.clientY);
    if (id) this.onSelect(id);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerDown = false;
    this.dragging = false;
    this.renderer.domElement.style.cursor = "grab";
  };

  private readonly handlePointerLeave = (): void => {
    if (!this.pointerDown) this.setHovered(null);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1;
    this.userZoom = clamp(this.userZoom * Math.exp(event.deltaY * scale * 0.0011), ORBIT_LIMITS.zoomIn, ORBIT_LIMITS.zoomOut);
    this.cameraDirty = true;
    this.invalidate();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  private readonly handleContextRestored = (): void => {
    // three.js re-uploads geometry and textures (including the banner pixels) on the next render.
    this.contextLost = false;
    this.invalidate();
  };

  // ---------------------------------------------------------------- lifecycle

  setQuality(quality: DesktopEnvironmentQuality): void {
    this.quality = { ...quality };
    this.frameLimit = normalizeFrameLimit(quality.frameLimit);
    this.applyPixelRatio();
    this.resize();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.tweenDuration > 0) {
      this.tweenDuration = 0;
      this.cameraDirty = true;
    }
    this.invalidate();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle);
      if (this.hoverHandle !== 0) cancelAnimationFrame(this.hoverHandle);
      this.frameHandle = 0;
      this.hoverHandle = 0;
      this.pointerDown = false;
      this.dragging = false;
      this.setHovered(null);
    } else {
      this.idle = true;
      this.invalidate();
    }
  }

  resize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    if (width === this.width && height === this.height) {
      this.invalidate();
      return;
    }
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.cameraDirty = true;
    this.invalidate();
  }

  private applyPixelRatio(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[this.quality.preset]) * normalizeRenderScale(this.quality.renderScale) / 100;
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio);
      this.width = 0;
      this.height = 0;
    }
  }

  getStats(): LegacyEnvironmentStats {
    const info = this.renderer.info;
    // frameTimesMs is frame pacing (intervals between rendered frames while rendering continuously), so
    // GPU-bound slowness shows; a request to define it this way in the contract is recorded. The linked
    // program count and the render-submission times are not in the contract's stats; they ride along
    // for the performance protocol.
    const stats = {
      triangles: info.render.triangles,
      drawCalls: info.render.calls,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frameTimesMs: ringToArray(this.frameIntervals, this.frameIntervalCount, this.frameIntervalCursor),
      submissionTimesMs: ringToArray(this.submissions, this.submissionCount, this.submissionCursor),
      programs: info.programs?.length ?? 0,
    };
    return stats;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle);
    if (this.hoverHandle !== 0) cancelAnimationFrame(this.hoverHandle);
    this.frameHandle = 0;
    this.hoverHandle = 0;
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    canvas.removeEventListener("wheel", this.handleWheel);
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.disposables.dispose();
    this.rasterizer.release();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.caption.remove();
    this.onReady = undefined;
  }
}

/**
 * Creates the stand-in one step per frame, behind the caller's loading state:
 * the WebGL context (its synchronous capability queries are the step most
 * likely to wait on a busy GPU process), then the scene graph, then the
 * state and banner raster, then one shader program per frame in prepare().
 */
export const createStandInEnvironment: CreateDesktopLegacyEnvironment = async (options) => {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: options.quality.preset !== "low", powerPreference: "high-performance" });
  } catch {
    return createFlatStandIn(options);
  }
  const disposables = new Disposables();
  let environment: StandInEnvironment | null = null;
  try {
    await nextFrame();
    const parts = buildStandInScene(disposables);
    environment = new StandInEnvironment(options, renderer, disposables, parts);
    await nextFrame();
    environment.setState(options.state);
    await nextFrame();
    await environment.prepare();
  } catch (error) {
    if (environment) environment.dispose();
    else {
      disposables.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    throw error;
  }
  return environment;
};
