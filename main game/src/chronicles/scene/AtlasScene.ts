import * as THREE from "three";
import { CHRONICLES_MAP } from "../../../../shared/chronicles/content";
import {
  blendReliefViews, clampReliefView, fitReliefDistance, getReliefMarkers, getReliefViewPose, intersectRelief,
  reliefMeshSlices, reliefToImage, RELIEF_ASPECT, RELIEF_CAMERA_LIMITS, RELIEF_FOV, RELIEF_LEVELS, RELIEF_SEGMENTS, RELIEF_SLAB, RELIEF_VIEWS,
  type ReliefMesh, type ReliefPose, type ReliefView, type ReliefViewState,
} from "../../../../shared/chronicles/archive/relief";
import type { ChronicleNationId } from "../../../../shared/chronicles/types";
import { nextRenderTimestamp, normalizeFrameLimit, scaledPixelRatio } from "../../effects/render-controls";
import type { Direction, FrameLimit, Quality } from "../../settings-types";
import { createAtlasDetails, type AtlasDetails } from "./atlas-details";
import { createAtlasMarkers, type AtlasMarkers } from "./atlas-markers";
import { createAtlasSet, SET_REACH, TABLE_COLOR, type AtlasSet } from "./atlas-set";

// The Atlas: the shared relief sculpted in real time with the painting as its
// albedo. The map is one world unit wide. The camera frames the part of the
// stage the menu leaves clear (`insets`, in CSS pixels): the vertical field of
// view is widened so that frame spans RELIEF_FOV, and a view offset centres
// the frame, so the shared views and limits apply unchanged around the UI.

export interface AtlasInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AtlasSceneOptions {
  host: HTMLElement;
  quality: Quality;
  renderScale: number;
  frameLimit: FrameLimit;
  reducedMotion: boolean;
  /** The first frame is on screen. */
  onReady(): void;
  /** WebGL failed or was lost; the screen shows the flat painting instead. */
  onFailure(): void;
  /** A real pointer movement arrived over a marker. */
  onPointerMarker(index: number): void;
  /** A click or tap landed on a marker. */
  onActivateMarker(index: number): void;
}

export interface AtlasScene {
  /** Renders only while its exhibit is shown; the last frame stays as a backdrop. */
  setActive(active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** The emphasised marker and the open record's marker, each -1 for none. The camera follows the open one. */
  setSelection(emphasized: number, open: number): void;
  /** Stage space the map should keep clear with no record open, and with one open. */
  setInsets(closed: AtlasInsets, open: AtlasInsets): void;
  /** Elements placed over each marker every frame, in getHotspotRecords order. */
  setLabels(labels: readonly (HTMLElement | null)[]): void;
  /** A keyboard turn or tilt, as a short drag would. */
  orbit(direction: Direction): void;
  /** Positive steps move in toward the frame's centre. */
  zoom(steps: number): void;
  dispose(): void;
}

type Follow = "overview" | "nation" | "free";

interface Flight {
  from: ReliefViewState;
  to: ReliefViewState;
  start: number;
  duration: number;
  ease: (t: number) => number;
  frame: [fromX: number, fromY: number];
}

const WIDTH = 1;
const ANISOTROPY: Record<Quality, number> = { low: 2, medium: 4, high: 8 };
// The drawn ring against the shared one; see createAtlasMarkers.
const RING_SCALE = 0.7;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

// Opening must never hold one long task: the build yields between short slices.
function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// The relief is identical on every open, so the session keeps the last one
// built (its typed arrays only); the GPU copy is released on every exit.
let cachedMesh: ReliefMesh | null = null;

const viewState = (view: ReliefView): ReliefViewState => ({ target: [view.target[0], view.target[1]], distance: view.distance, azimuth: view.azimuth, elevation: view.elevation });

function copyView(from: ReliefView, to: ReliefViewState): ReliefViewState {
  to.target[0] = from.target[0];
  to.target[1] = from.target[1];
  to.distance = from.distance;
  to.azimuth = from.azimuth;
  to.elevation = from.elevation;
  return to;
}

function settled(a: ReliefView, b: ReliefView): boolean {
  return Math.abs(a.target[0] - b.target[0]) < 2e-5 && Math.abs(a.target[1] - b.target[1]) < 2e-5
    && Math.abs(a.distance / b.distance - 1) < 2e-4 && Math.abs(a.azimuth - b.azimuth) < 2e-5 && Math.abs(a.elevation - b.elevation) < 2e-5;
}

export function createAtlasScene(options: AtlasSceneOptions): AtlasScene {
  const { host, quality } = options;
  const frameLimit = normalizeFrameLimit(options.frameLimit);
  // Throws where WebGL is unavailable; the caller then shows the flat painting.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const canvas = renderer.domElement;
  renderer.setPixelRatio(scaledPixelRatio(window.devicePixelRatio, options.renderScale));
  renderer.setClearColor(TABLE_COLOR, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = quality !== "low";
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The light and the relief never move, so the shadow is drawn once.
  renderer.shadowMap.autoUpdate = false;
  canvas.className = "chronicles-stage-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(TABLE_COLOR, 2, 5);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(RELIEF_FOV, 16 / 9, 0.01, 12);
  const pose: ReliefPose = { position: [0, 0, 0], target: [0, 0, 0] };
  const overview = viewState(RELIEF_VIEWS.overview);
  const view = viewState(RELIEF_VIEWS.overview);
  const goal = viewState(RELIEF_VIEWS.overview);
  const insets = { closed: { top: 0, right: 0, bottom: 0, left: 0 }, open: { top: 0, right: 0, bottom: 0, left: 0 } };
  const size = { width: 0, height: 0 };
  // The principal point in stage pixels, where it is heading, and the overview's centring correction.
  const frame = { x: 0, y: 0, toX: 0, toY: 0, shiftX: 0, shiftY: 0 };
  const point = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const buffer = new THREE.Vector2();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const ground: [number, number] = [0, 0];
  const nations: ChronicleNationId[] = [];
  const rings: number[] = [];
  const corners: number[] = [];
  const placed = new Float32Array(16).fill(NaN);
  const reported = { calls: -1, triangles: -1, camera: "", settled: "" };
  let labels: readonly (HTMLElement | null)[] = [];
  let mesh: ReliefMesh | null = null;
  let bitmap: ImageBitmap | null = null;
  let painting: THREE.Texture | null = null;
  let set: AtlasSet | null = null;
  let details: AtlasDetails | null = null;
  let markers: AtlasMarkers | null = null;
  let flight: Flight | null = null;
  let follow: Follow = "overview";
  let maxDistance: number = RELIEF_CAMERA_LIMITS.distance[1];
  let active = true, reduced = options.reducedMotion, ready = false, failed = false, disposed = false, dirty = true;
  let emphasized = -1, open = -1;
  let animation = 0, lastTime = 0, lastRendered = 0, elapsed = 0;

  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    options.onFailure();
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    fail();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  const canRun = () => ready && active && !disposed && !document.hidden;
  const wake = () => {
    dirty = true;
    if (animation || !canRun()) return;
    lastTime = performance.now();
    animation = requestAnimationFrame(tick);
  };

  function placeCamera(state: ReliefView, x: number, y: number) {
    camera.setViewOffset(size.width, size.height, size.width / 2 - x, size.height / 2 - y, size.width, size.height);
    getReliefViewPose(state, WIDTH, pose);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    camera.updateMatrixWorld();
  }

  function applyCamera() {
    if (!size.width) return;
    placeCamera(view, frame.x, frame.y);
    // Fog only reaches the table beyond the slab's far edge.
    fog.near = view.distance + 0.5;
    fog.far = view.distance + 2.6;
  }

  // The shared fit holds the slab's bounds symmetrically, but perspective
  // draws the near edge larger than the far one; fitting the projected slab
  // and frame in screen space fills the clear frame and centres the map.
  function fitOverview(left: number, top: number, width: number, height: number) {
    overview.distance = fitReliefDistance(RELIEF_VIEWS.overview, RELIEF_FOV, width / height, 0.03);
    frame.shiftX = 0;
    frame.shiftY = 0;
    if (!corners.length) return;
    const centreX = left + width / 2, centreY = top + height / 2;
    for (let pass = 0; pass < 4; pass++) {
      placeCamera(overview, centreX + frame.shiftX, centreY + frame.shiftY);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let index = 0; index < corners.length; index += 3) {
        point.set(corners[index], corners[index + 1], corners[index + 2]).project(camera);
        const x = (point.x + 1) * 0.5 * size.width, y = (1 - point.y) * 0.5 * size.height;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      frame.shiftX += centreX - (minX + maxX) / 2;
      frame.shiftY += centreY - (minY + maxY) / 2;
      overview.distance *= Math.max((maxX - minX) / (width * 0.97), (maxY - minY) / (height * 0.97));
    }
  }

  // Layout: the canvas fills the stage and the frame is the clear area inside
  // it. A record opening or closing moves the frame with its camera flight.
  function layout(snapFrame = true) {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const pixelRatio = scaledPixelRatio(window.devicePixelRatio, options.renderScale);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    if (width !== size.width || height !== size.height) renderer.setSize(width, height, false);
    size.width = width;
    size.height = height;
    const closed = insets.closed, current = open >= 0 ? insets.open : closed;
    const frameWidth = Math.max(1, width - current.left - current.right), frameHeight = Math.max(1, height - current.top - current.bottom);
    camera.fov = (2 * Math.atan(Math.tan((RELIEF_FOV * Math.PI) / 360) * (height / frameHeight)) * 180) / Math.PI;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitOverview(closed.left, closed.top, Math.max(1, width - closed.left - closed.right), Math.max(1, height - closed.top - closed.bottom));
    maxDistance = Math.max(RELIEF_CAMERA_LIMITS.distance[1], overview.distance * 1.12);
    frame.toX = current.left + frameWidth / 2 + (open < 0 ? frame.shiftX : 0);
    frame.toY = current.top + frameHeight / 2 + (open < 0 ? frame.shiftY : 0);
    if (snapFrame && !flight) {
      frame.x = frame.toX;
      frame.y = frame.toY;
    }
    if (follow === "overview") {
      if (flight) copyView(overview, flight.to);
      else copyView(overview, view);
      copyView(overview, goal);
    }
    details?.resize(renderer.getDrawingBufferSize(buffer).y, camera.fov);
    applyCamera();
    if (ready) render();
  }
  const observer = new ResizeObserver(() => layout());
  observer.observe(host);

  function clampGoal() {
    const distance = goal.distance;
    clampReliefView(goal, goal);
    goal.distance = Math.max(RELIEF_CAMERA_LIMITS.distance[0], Math.min(maxDistance, Number.isFinite(distance) ? distance : overview.distance));
  }

  // Direct input takes the camera over from any flight in progress.
  function takeControl() {
    if (flight) {
      copyView(view, goal);
      frame.x = frame.toX;
      frame.y = frame.toY;
      flight = null;
    }
    follow = "free";
  }

  function fly(to: ReliefView, duration: number, ease = easeInOut) {
    if (!flight) flight = { from: viewState(view), to: viewState(to), start: 0, duration, ease, frame: [0, 0] };
    else {
      copyView(view, flight.from);
      copyView(to, flight.to);
      flight.duration = duration;
      flight.ease = ease;
    }
    flight.start = performance.now();
    flight.frame[0] = frame.x;
    flight.frame[1] = frame.y;
    copyView(to, goal);
    wake();
  }

  function stepCamera(now: number, delta: number): boolean {
    let moved = false;
    if (flight) {
      const t = reduced ? 1 : Math.min(1, (now - flight.start) / flight.duration);
      const eased = flight.ease(t);
      blendReliefViews(flight.from, flight.to, eased, view);
      frame.x = flight.frame[0] + (frame.toX - flight.frame[0]) * eased;
      frame.y = flight.frame[1] + (frame.toY - flight.frame[1]) * eased;
      if (t >= 1) {
        copyView(flight.to, goal);
        flight = null;
      }
      moved = true;
    } else if (!settled(view, goal)) {
      blendReliefViews(view, goal, reduced ? 1 : 1 - Math.exp(-delta * 10), view);
      if (settled(view, goal)) copyView(goal, view);
      moved = true;
    }
    if (!flight && (frame.x !== frame.toX || frame.y !== frame.toY)) {
      frame.x = frame.toX;
      frame.y = frame.toY;
      moved = true;
    }
    if (moved) applyCamera();
    return moved;
  }

  function nationView(index: number): ReliefView {
    const nation = nations[index];
    return nation ? RELIEF_VIEWS[nation] : overview;
  }

  // Each label follows its ring, with the pin's height and the ring's
  // on-screen radius so the caption clears both at any distance.
  function placeLabels() {
    if (!markers) return;
    for (let index = 0; index < labels.length && index < rings.length; index++) {
      const label = labels[index];
      if (!label) continue;
      markers.ringCentre(index, point);
      edge.copy(point).setX(point.x + rings[index]).project(camera);
      point.project(camera);
      markers.pinTop(index, lift).project(camera);
      const x = (point.x + 1) * 0.5 * size.width, y = (1 - point.y) * 0.5 * size.height;
      const rise = (1 - lift.y) * 0.5 * size.height - y, radius = Math.abs(edge.x - point.x) * 0.5 * size.width;
      const slot = index * 4;
      if (Math.abs(x - placed[slot]) < 0.1 && Math.abs(y - placed[slot + 1]) < 0.1 && Math.abs(rise - placed[slot + 2]) < 0.1 && Math.abs(radius - placed[slot + 3]) < 0.1) continue;
      label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      label.style.setProperty("--chronicles-pin", `${rise.toFixed(1)}px`);
      label.style.setProperty("--chronicles-ring", `${radius.toFixed(1)}px`);
      placed[slot] = x;
      placed[slot + 1] = y;
      placed[slot + 2] = rise;
      placed[slot + 3] = radius;
    }
  }

  function report() {
    const { calls, triangles } = renderer.info.render;
    if (calls !== reported.calls) host.dataset.drawCalls = String((reported.calls = calls));
    if (triangles !== reported.triangles) host.dataset.triangles = String((reported.triangles = triangles));
    const framing = follow === "nation" && open >= 0 ? nations[open] : follow;
    if (framing !== reported.camera) host.dataset.camera = reported.camera = framing;
    const still = flight || !settled(view, goal) ? "false" : "true";
    if (still !== reported.settled) host.dataset.cameraSettled = reported.settled = still;
  }

  function render() {
    if (!ready || disposed || !set || !details || !markers) return;
    dirty = false;
    set.update(elapsed, reduced);
    details.update(elapsed, reduced);
    renderer.render(scene, camera);
    placeLabels();
    report();
  }

  // The right stick turns and tilts and the triggers zoom; the menu's own
  // controller polling keeps the D-pad, left stick and face buttons.
  function pollGamepad(delta: number) {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping !== "standard") continue;
      const turn = Math.abs(pad.axes[2] ?? 0) > 0.2 ? pad.axes[2] : 0;
      const tilt = Math.abs(pad.axes[3] ?? 0) > 0.2 ? pad.axes[3] : 0;
      const zoom = (pad.buttons[6]?.value ?? 0) - (pad.buttons[7]?.value ?? 0);
      if (!turn && !tilt && Math.abs(zoom) < 0.08) return;
      takeControl();
      goal.azimuth -= turn * 1.1 * delta;
      goal.elevation += tilt * 0.8 * delta;
      goal.distance *= Math.exp(zoom * 1.3 * delta);
      clampGoal();
      return;
    }
  }

  function tick(now: number) {
    animation = 0;
    if (!canRun()) return;
    animation = requestAnimationFrame(tick);
    const timestamp = nextRenderTimestamp(now, lastRendered, frameLimit);
    if (timestamp === null) return;
    const delta = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    lastRendered = timestamp;
    if (!reduced) elapsed += delta;
    pollGamepad(delta);
    const moved = stepCamera(now, delta);
    const changing = markers?.update(delta, elapsed, reduced) ?? false;
    // Held still, the map draws only when something changed.
    if (reduced && !moved && !changing && !dirty) return;
    render();
  }

  // Picking: a ray from the pointer through the frame.
  function rayAt(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    origin.copy(camera.position);
    direction.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5).unproject(camera).sub(origin).normalize();
    return true;
  }
  function markerAt(clientX: number, clientY: number): number {
    if (!ready || !mesh || !markers || !rayAt(clientX, clientY)) return -1;
    const index = markers.pick(origin, direction);
    if (index < 0) return -1;
    // A peak standing in front of the marker takes the click instead.
    const terrain = intersectRelief(mesh, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z);
    return terrain >= 0 && terrain < markers.hitDistance - 0.02 ? -1 : index;
  }
  function groundAt(clientX: number, clientY: number): boolean {
    if (!ready || !mesh || !rayAt(clientX, clientY)) return false;
    const t = intersectRelief(mesh, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z);
    if (t < 0) return false;
    reliefToImage(origin.x + direction.x * t, origin.z + direction.z * t, WIDTH, ground);
    return true;
  }

  function zoomBy(factor: number, clientX?: number, clientY?: number) {
    takeControl();
    const before = goal.distance;
    const next = Math.max(RELIEF_CAMERA_LIMITS.distance[0], Math.min(maxDistance, before * factor));
    // Zoom about the ground under the pointer, so it stays under the pointer.
    if (clientX !== undefined && clientY !== undefined && groundAt(clientX, clientY)) {
      const pull = 1 - next / before;
      goal.target[0] += (ground[0] - goal.target[0]) * pull;
      goal.target[1] += (ground[1] - goal.target[1]) * pull;
    }
    goal.distance = next;
    clampGoal();
    wake();
  }
  function turnBy(dx: number, dy: number) {
    takeControl();
    goal.azimuth -= dx * 0.0042;
    goal.elevation += dy * 0.0036;
    clampGoal();
    wake();
  }
  function panBy(dx: number, dy: number) {
    takeControl();
    const frameHeight = Math.max(1, size.height - insets.closed.top - insets.closed.bottom);
    const across = (goal.distance * 2 * Math.tan((RELIEF_FOV * Math.PI) / 360)) / frameHeight;
    const along = across / Math.max(0.3, Math.sin(goal.elevation));
    const cos = Math.cos(goal.azimuth), sin = Math.sin(goal.azimuth);
    goal.target[0] += -cos * dx * across - sin * dy * along;
    goal.target[1] += (sin * dx * across - cos * dy * along) / RELIEF_ASPECT;
    clampGoal();
    wake();
  }

  // Pointer: a press that stays put selects; a drag turns and tilts (right
  // button or Shift pans); two touches pinch to zoom; the wheel zooms.
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { id: number; startX: number; startY: number; pan: boolean; moved: boolean } | null = null;
  let pinch = 0;
  const pinchSpan = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!ready || (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2)) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, pan: event.button === 2 || event.shiftKey, moved: false };
    else {
      drag = null;
      pinch = pinchSpan();
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    const held = pointers.get(event.pointerId);
    if (held) {
      const dx = event.clientX - held.x, dy = event.clientY - held.y;
      held.x = event.clientX;
      held.y = event.clientY;
      if (pointers.size === 2) {
        const span = pinchSpan();
        if (pinch > 0 && span > 0) zoomBy(pinch / span);
        pinch = span;
      } else if (drag?.id === event.pointerId) {
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
          drag.moved = true;
          canvas.dataset.dragging = "true";
        }
        if (drag.moved) {
          if (drag.pan) panBy(dx, dy);
          else turnBy(dx, dy);
        }
      }
      return;
    }
    const index = markerAt(event.clientX, event.clientY);
    const over = index >= 0 ? "marker" : "ground";
    if (canvas.dataset.over !== over) canvas.dataset.over = over;
    if (index >= 0 && event.pointerType === "mouse" && (event.movementX || event.movementY)) options.onPointerMarker(index);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (drag?.id === event.pointerId) {
      // Empty ground, the centre included, does nothing.
      if (!drag.moved && event.type === "pointerup" && (event.pointerType !== "mouse" || event.button === 0)) {
        const index = markerAt(event.clientX, event.clientY);
        if (index >= 0) options.onActivateMarker(index);
      }
      drag = null;
    }
    if (!pointers.size) delete canvas.dataset.dragging;
    pinch = pointers.size === 2 ? pinchSpan() : 0;
  };
  const onWheel = (event: WheelEvent) => {
    if (!ready) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 0.04 : event.deltaMode === 2 ? 1 : 0.0016;
    zoomBy(Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * scale))), event.clientX, event.clientY);
  };
  const onContextMenu = (event: Event) => event.preventDefault();
  const onVisibility = () => wake();
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("visibilitychange", onVisibility);

  void (async () => {
    try {
      const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
      const decoded = loader.loadAsync(CHRONICLES_MAP.src) as Promise<ImageBitmap>;
      decoded.catch(() => undefined);
      const segments = RELIEF_SEGMENTS[quality];
      if (cachedMesh?.columns === segments) mesh = cachedMesh;
      else {
        const slices = reliefMeshSlices(WIDTH, segments, 8);
        let slice = slices.next();
        while (!slice.done) {
          const deadline = performance.now() + 5;
          while (!slice.done && performance.now() < deadline) slice = slices.next();
          await yieldToBrowser();
          if (disposed) return;
        }
        mesh = cachedMesh = slice.value;
      }
      bitmap = await decoded;
      if (disposed) return;
      painting = new THREE.Texture(bitmap);
      painting.flipY = false;
      painting.colorSpace = THREE.SRGBColorSpace;
      painting.anisotropy = Math.min(ANISOTROPY[quality], renderer.capabilities.getMaxAnisotropy());
      painting.needsUpdate = true;
      set = createAtlasSet(mesh, painting, quality, painting.anisotropy);
      await yieldToBrowser();
      if (disposed) return;
      details = createAtlasDetails(quality, set.key.position);
      const placedMarkers = getReliefMarkers(mesh);
      nations.push(...placedMarkers.map((marker) => marker.record.nation));
      rings.push(...placedMarkers.map((marker) => marker.ring * RING_SCALE));
      markers = createAtlasMarkers(placedMarkers, RING_SCALE);
      markers.setState(emphasized, open);
      markers.update(0, 0, true);
      // The slab and its frame for the overview's screen fit: the foot of
      // each corner, and the top of each edge, peaks included to the north.
      const reachX = mesh.width / 2 + SET_REACH, reachZ = mesh.depth / 2 + SET_REACH;
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        corners.push(x * reachX, RELIEF_SLAB.base, z * reachZ);
        corners.push(x * mesh.width / 2, z < 0 ? mesh.maxHeight : RELIEF_LEVELS.rim, z * mesh.depth / 2);
      }
      scene.add(set.group, details.group, markers.group);
      layout();
      await yieldToBrowser();
      if (disposed) return;
      renderer.initTexture(painting);
      await yieldToBrowser();
      if (disposed) return;
      // Compile every program off the critical path where the browser allows it.
      if (renderer.extensions.has("KHR_parallel_shader_compile")) await renderer.compileAsync(scene, camera);
      else {
        renderer.compile(scene, camera);
        await pause(32);
      }
      if (disposed) return;
      ready = true;
      if (open >= 0) {
        follow = "nation";
        copyView(nationView(open), goal);
        copyView(goal, view);
      } else if (!reduced) {
        // The map first appears a little high and turned, then settles.
        view.distance = overview.distance * 1.2;
        view.azimuth = overview.azimuth - 0.1;
        view.elevation = Math.min(RELIEF_CAMERA_LIMITS.elevation[1], overview.elevation + 0.14);
      }
      applyCamera();
      // Two hidden frames split the first draw's work: the scene, then the
      // one-off shadow pass, so the frame that fades in is already complete.
      render();
      await yieldToBrowser();
      if (disposed) return;
      renderer.shadowMap.needsUpdate = true;
      render();
      if (renderer.getContext().isContextLost()) {
        fail();
        return;
      }
      options.onReady();
      if (open < 0 && !reduced) fly(overview, 2200, easeOut);
      wake();
    } catch {
      fail();
    }
  })();

  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      wake();
    },
    setReducedMotion(value) {
      if (reduced === value) return;
      reduced = value;
      wake();
    },
    setSelection(nextEmphasized, nextOpen) {
      if (nextEmphasized === emphasized && nextOpen === open) return;
      const opened = nextOpen !== open;
      emphasized = nextEmphasized;
      open = nextOpen;
      markers?.setState(emphasized, open);
      if (opened) {
        layout(!ready);
        if (ready) {
          follow = open >= 0 ? "nation" : "overview";
          fly(open >= 0 ? nationView(open) : overview, open >= 0 ? 1300 : 1100);
        }
      }
      wake();
    },
    setInsets(closed, opened) {
      const same = (a: AtlasInsets, b: AtlasInsets) => a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
      if (same(closed, insets.closed) && same(opened, insets.open)) return;
      insets.closed = { ...closed };
      insets.open = { ...opened };
      layout();
      wake();
    },
    setLabels(next) {
      labels = next;
      placed.fill(NaN);
      if (ready) placeLabels();
    },
    orbit(towards) {
      if (!ready) return;
      if (towards === "left" || towards === "right") turnBy(towards === "left" ? -18 : 18, 0);
      else turnBy(0, towards === "up" ? -16 : 16);
    },
    zoom(steps) {
      if (ready) zoomBy(Math.pow(0.86, steps));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animation);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibility);
      set?.dispose();
      details?.dispose();
      markers?.dispose();
      painting?.dispose();
      bitmap?.close();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
