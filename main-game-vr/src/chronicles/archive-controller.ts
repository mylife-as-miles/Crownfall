import { BackSide, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import type { Entity, Object3D, UIKit, UIKitMLAsset, World } from '@iwsdk/core';
import type { Vec3 } from '../../../shared/chronicles/archive/types';
import { getHotspotRecords } from '../../../shared/chronicles/content';
import { getChroniclesLoadFailure } from '../../../shared/chronicles/status';
import type { ChronicleCollectionId, ChronicleNationId, ChroniclesSceneState } from '../../../shared/chronicles/types';
import { QUEST_CHRONICLE_IDS, QUEST_CHRONICLE_LAYOUT } from '../ui-contract.js';
import { ChroniclesArchiveState } from './archive-state.js';
import type { ChroniclesPosture, ChroniclesTextScale } from './control-surface.js';

/** The lazy chunk: the room and everything it builds from. */
type ArchiveRuntime = typeof import('./archive-runtime.js');

export type ArchiveQualityPreset = 'low' | 'medium' | 'high';

/** Where the room stands: the recentred head pose in world space, and the posture it is sized for. */
export interface ArchiveRoomPose {
  posture: ChroniclesPosture;
  head: Vec3;
  yaw: number;
}

/**
 * The Quest archive room as the controller drives it (docs/chronicles/ARCHITECTURE.md
 * section 5.1). The room builds in slices, never moves the viewer, and
 * releases every GPU object on close.
 */
export interface ArchiveRoom {
  readonly ready: boolean;
  /** 0 to 1 while building; 0 when the room cannot tell. */
  readonly progress: number;
  /** True once the room knows it cannot be shown; the panel's records stay usable. */
  readonly failed?: boolean;
  open(): void;
  close(): void;
  setVisible(visible: boolean): void;
  place(pose: ArchiveRoomPose): void;
  setCollection(collection: ChronicleCollectionId): void;
  setSelection(recordId: string | null, atlasActive: boolean): void;
  setQuality(quality: ArchiveQualityPreset): void;
  update(delta: number, motion: boolean): void;
  stats(): { triangles: number; textureBytes: number };
  dispose(): void;
}

export interface ArchiveRoomEvents {
  select(recordId: string): void;
  /** Bare ground under a ray, as map image fractions. */
  ground(x: number, y: number): void;
}

export type ArchiveRoomFactory = (world: World, events: ArchiveRoomEvents) => ArchiveRoom;
const NO_STATS = Object.freeze({ triangles: 0, textureBytes: 0 });

/** What the menu system lends the controller. Nothing here names the XR rig: the head pose arrives through `anchor`. */
export interface ArchiveControllerHost {
  world: World;
  /** The experience anchor: the last recentred head pose, yaw only. The menu panel is its child. */
  anchor: Object3D;
  panel: UIKitMLAsset;
  panelObject: Object3D;
  /** The menu panel's entity, which also carries ChroniclesArchiveState. */
  stateEntity: Entity;
  /** The camera, which carries the head-locked fade. */
  view: Object3D;
  select(recordId: string): void;
  ground(x: number, y: number): void;
  loaded(result: 'ready' | 'failed'): void;
}

/** The menu state the controller presents. */
export interface ArchiveView {
  /** Chronicles is the screen, or the pause screen stands over it. */
  open: boolean;
  /** Chronicles itself is the screen. */
  shown: boolean;
  scene: ChroniclesSceneState;
  posture: ChroniclesPosture;
  textScale: ChroniclesTextScale;
  quality: ArchiveQualityPreset;
  /** Ambient motion is allowed: the preference and the device's reduced-motion setting. */
  motion: boolean;
}

/**
 * Fade timings in seconds: out to black, then back. Reduced motion cuts both.
 * If the lazy chunk has not arrived after `hold` at black, the view returns at
 * the menu pose with the loading bar and fades again once it lands.
 */
export const ARCHIVE_FADE = { out: 0.16, in: 0.24, hold: 0.5 } as const;

/**
 * Browser preview only, never in XR: a desktop window cannot look around, so
 * the camera widens (vertical degrees), tilts down to the monument and turns
 * right toward the control surface (radians), easing over `seconds`.
 */
export const ARCHIVE_PREVIEW_FRAMING = { fov: 76, tilt: -0.15, turn: -0.33, seconds: 0.6 } as const;

// Wordless loading bar steps, prepared once so the frame loop never allocates.
const FILL_STEPS = 40;
const SWEEP_STEPS = 48;
const SWEEP_WIDTH = QUEST_CHRONICLE_LAYOUT.loading.width / 4;
const FILL = Array.from({ length: FILL_STEPS + 1 }, (_, index) => ({ positionLeft: 0, width: (QUEST_CHRONICLE_LAYOUT.loading.width * index) / FILL_STEPS }));
const SWEEP = Array.from({ length: SWEEP_STEPS }, (_, index) => {
  const t = index / SWEEP_STEPS, ping = t < 0.5 ? t * 2 : 2 - t * 2;
  return { positionLeft: (QUEST_CHRONICLE_LAYOUT.loading.width - SWEEP_WIDTH) * ping * ping * (3 - 2 * ping), width: SWEEP_WIDTH };
});
const STILL = { positionLeft: (QUEST_CHRONICLE_LAYOUT.loading.width - SWEEP_WIDTH) / 2, width: SWEEP_WIDTH };
const SHOW = { display: 'flex' } as const;
const HIDE = { display: 'none' } as const;
const NATION_RECORD = new Map<ChronicleNationId, string>(getHotspotRecords().map((record) => [record.nation, record.id]));

/** The record the archive marks: the open entry, or a focused nation's record once its entry has closed. */
export function chroniclesSelection(scene: ChroniclesSceneState): string | null {
  if (scene.entryId !== null) return scene.entryId;
  return scene.focus.kind === 'nation' ? NATION_RECORD.get(scene.focus.nation) || null : null;
}

/**
 * Owns the Quest archive room's lifecycle while Chronicles is open: the room
 * opens on entry, holds through pause, shows only on the Chronicles screen and
 * closes on leaving. The menu panel moves to the blueprint's control surface
 * beside the monument and back, and every placement (entry, exit and recentre)
 * happens under a short head-locked fade. The viewer is never moved. The room
 * and its geometry arrive in a lazy chunk on the first visit; until then the
 * fade holds at black and the loading bar sweeps.
 */
export class ArchiveController {
  private room: ArchiveRoom | null = null;
  private runtime: ArchiveRuntime | null = null;
  private loadingRuntime = false;
  private runtimeFailed = false;
  private disposed = false;
  private readonly veil: Mesh;
  private readonly veilMaterial: MeshBasicMaterial;
  private readonly menuPosition = new Vector3();
  private readonly menuQuaternion = new Quaternion();
  private readonly menuScale = new Vector3(1, 1, 1);
  private readonly anchorPosition = new Vector3();
  private readonly anchorQuaternion = new Quaternion();
  private readonly forward = new Vector3();
  private readonly elements = new Map<string, UIKit.Text | null>();
  private view: ArchiveView | null = null;
  private roomOpen = false;
  private wanted = false;
  private presented = false;
  private shown = false;
  private reported = false;
  /** clear; fading out; holding at black until the lazy chunk arrives; fading back in. */
  private phase: 'clear' | 'out' | 'hold' | 'in' = 'clear';
  private fade = 0;
  private holdTime = 0;
  private pending: (() => void) | null = null;
  private loadingShown = false;
  private failureShown = false;
  private loadingStep = -1;
  private loadingFrames = 0;
  private buildSeconds = 0;
  private sweepTime = 0;
  private placements = 0;
  private roomYaw = 0;
  private panelScale = 0;
  private stats: { triangles: number; textureBytes: number } = NO_STATS;

  constructor(private readonly host: ArchiveControllerHost, private readonly createRoom?: ArchiveRoomFactory) {
    this.veilMaterial = new MeshBasicMaterial({ color: 0x070504, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    this.veil = new Mesh(new SphereGeometry(0.3, 16, 8), this.veilMaterial);
    this.veil.name = 'Chronicles_Fade';
    this.veil.renderOrder = 1e6;
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    // The fade covers the eyes only; it never takes a ray.
    this.veil.raycast = () => undefined;
    host.view.add(this.veil);
    // A runtime-only component is registered here, as it is in no scene; registering twice is a no-op.
    host.world.registerComponent(ChroniclesArchiveState);
    if (!host.stateEntity.hasComponent(ChroniclesArchiveState)) host.stateEntity.addComponent(ChroniclesArchiveState);
  }

  /** The room exists, so the menu's own backdrop stays hidden and held. */
  get open(): boolean { return this.roomOpen; }
  get ready(): boolean { return !!this.room && this.room.ready; }
  /** The panel stands on the control surface, so its comfort pose is the archive's. */
  get presenting(): boolean { return this.presented; }

  /** Applies the menu state; called whenever the menu renders. */
  sync(view: ArchiveView): void {
    const previous = this.view;
    this.view = view;
    this.shown = view.shown;
    const failure = view.shown && getChroniclesLoadFailure(view.scene.load) !== null;
    if (failure !== this.failureShown) {
      this.failureShown = failure;
      this.element(QUEST_CHRONICLE_IDS.failure)?.setProperties(failure ? SHOW : HIDE);
    }
    if (view.open && !this.roomOpen) {
      this.roomOpen = true;
      this.reported = false;
      this.loadingFrames = 0;
      this.buildSeconds = 0;
      if (this.room) this.room.open(); else this.loadRuntime();
    }
    if (view.open !== this.wanted) {
      this.wanted = view.open;
      this.transition(view.open ? () => this.present() : () => this.dismiss());
    } else if (this.presented && previous && (previous.posture !== view.posture || previous.textScale !== view.textScale)) {
      this.applyPanelPose();
      this.placeRoom();
    }
    this.writeState(this.syncRoom());
  }

  /** Hands the current view to the room, once it exists; returns the record its marker lights. */
  private syncRoom(): string | null {
    const view = this.view;
    if (!view) return null;
    const scene = view.scene;
    // The open entry lights its marker; a focused nation keeps its marker lit after its record closes.
    const selection = scene.collection === 'atlas' ? chroniclesSelection(scene) : null;
    if (!this.room) return selection;
    this.room.setVisible(this.shown && this.presented);
    this.room.setCollection(scene.collection);
    this.room.setSelection(selection, scene.collection === 'atlas');
    this.room.setQuality(view.quality);
    return selection;
  }

  /** Loads the lazy chunk once; the room opens as soon as it arrives if Chronicles is still open. */
  private loadRuntime(): void {
    if (this.loadingRuntime || this.runtime) return;
    this.loadingRuntime = true;
    this.runtimeFailed = false;
    import('./archive-runtime.js').then((runtime) => {
      if (this.disposed) return;
      this.runtime = runtime;
      const events: ArchiveRoomEvents = { select: (id) => this.host.select(id), ground: (x, y) => this.host.ground(x, y) };
      this.room = this.createRoom ? this.createRoom(this.host.world, events) : runtime.createArchiveRoom(this.host.world, events);
      if (this.roomOpen) this.room.open();
      if (this.phase === 'hold') this.atBlack();
      else if (this.pending) { const action = this.pending; this.pending = null; this.transition(action); }
      this.writeState(this.syncRoom());
    }).catch(() => {
      // Without its chunk the archive cannot be shown; the panel's records stay usable at the menu pose.
      this.runtimeFailed = true;
      this.loadingRuntime = false;
      if (this.phase === 'hold') this.atBlack();
    });
  }

  /**
   * Called after the menu system set the panel's menu pose: remember it, and
   * keep the control-surface pose while the archive is presented.
   */
  comfort(): void {
    if (!this.presented) return;
    this.captureMenuPose();
    this.applyPanelPose();
  }

  /**
   * Recentres under the fade while the archive is open: `apply` moves the
   * anchor to the head pose, then the room follows it. Returns false when the
   * archive is closed and the menu should recentre on its own.
   */
  recenter(apply: () => void): boolean {
    if (!this.wanted && !this.presented) return false;
    this.transition(() => {
      apply();
      if (this.presented) { this.applyPanelPose(); this.placeRoom(); }
      this.writeState();
    });
    return true;
  }

  /** The room's own counts, for evidence; not for per-frame use. */
  roomStats(): { triangles: number; textureBytes: number } {
    return this.room ? this.room.stats() : NO_STATS;
  }

  /** Allocation-free per-frame work: the fade, the room's build and reveal, and the loading bar. */
  update(delta: number, motion: boolean): void {
    if (this.phase === 'out') {
      this.fade = Math.min(1, this.fade + delta / ARCHIVE_FADE.out);
      if (this.fade >= 1) this.atBlack();
      this.applyFade();
    } else if (this.phase === 'in') {
      this.fade = Math.max(0, this.fade - delta / ARCHIVE_FADE.in);
      if (this.fade <= 0) this.phase = 'clear';
      this.applyFade();
    } else if (this.phase === 'hold' && this.fade > 0) {
      // Never leave the viewer in the dark: lift the fade and keep the change for when the chunk lands.
      this.holdTime += delta;
      if (this.holdTime > ARCHIVE_FADE.hold) this.phase = 'in';
    }
    if (!this.roomOpen) return;
    const room = this.room;
    if (room) room.update(delta, motion);
    if (!this.reported) {
      this.buildSeconds += delta;
      if (room ? room.ready || room.failed : this.runtimeFailed) {
        this.reported = true;
        this.stats = room ? room.stats() : NO_STATS;
        this.host.stateEntity.setValue(ChroniclesArchiveState, 'buildSeconds', this.buildSeconds);
        this.host.loaded(room && room.ready ? 'ready' : 'failed');
        this.writeState();
      }
    }
    this.updateLoading(delta, motion);
  }

  dispose(): void {
    this.disposed = true;
    this.room?.dispose();
    this.host.view.remove(this.veil);
    this.veil.geometry.dispose();
    this.veilMaterial.dispose();
  }

  // --- transitions -----------------------------------------------------------

  private transition(action: () => void): void {
    // A change requested while an earlier one waits for black lands with it, in order.
    const earlier = this.pending;
    const run = earlier ? () => { earlier(); action(); } : action;
    if (!this.view?.motion) {
      // Reduced motion: no fade, the change lands at once (once the chunk is here).
      this.fade = 0; this.applyFade();
      this.pending = run; this.phase = 'hold';
      if (this.canPresent()) this.atBlack();
      return;
    }
    this.pending = run;
    if (this.phase !== 'hold') this.phase = 'out';
    else if (this.canPresent()) this.atBlack();
  }

  /** The pose math arrives with the lazy chunk; a failed chunk presents nothing. */
  private canPresent(): boolean { return !!this.runtime || this.runtimeFailed || !this.wanted; }

  private atBlack(): void {
    if (!this.canPresent()) { this.phase = 'hold'; this.holdTime = 0; return; }
    const action = this.pending;
    this.pending = null;
    this.phase = this.fade > 0 ? 'in' : 'clear';
    action?.();
  }

  private applyFade(): void {
    const t = this.fade * this.fade * (3 - 2 * this.fade);
    this.veilMaterial.opacity = t;
    this.veil.visible = t > 0.001;
    this.host.stateEntity.setValue(ChroniclesArchiveState, 'fade', t);
  }

  private present(): void {
    if (!this.wanted || !this.runtime || !this.room) return;
    this.captureMenuPose();
    this.presented = true;
    this.applyPanelPose();
    this.placeRoom();
    this.writeState(this.syncRoom());
  }

  private dismiss(): void {
    if (this.wanted) return;
    if (this.presented) {
      const panel = this.host.panelObject;
      panel.position.copy(this.menuPosition);
      panel.quaternion.copy(this.menuQuaternion);
      panel.scale.copy(this.menuScale);
    }
    this.presented = false;
    if (this.roomOpen) {
      this.room?.setVisible(false);
      this.room?.close();
      this.roomOpen = false;
    }
    this.setLoading(false);
    this.stats = NO_STATS;
    this.writeState();
  }

  private captureMenuPose(): void {
    const panel = this.host.panelObject;
    this.menuPosition.copy(panel.position);
    this.menuQuaternion.copy(panel.quaternion);
    this.menuScale.copy(panel.scale);
  }

  private applyPanelPose(): void {
    if (!this.view || !this.runtime) return;
    const pose = this.runtime.chroniclesPanelPose(this.view.posture, this.view.textScale), panel = this.host.panelObject;
    panel.position.set(pose.position[0], pose.position[1], pose.position[2]);
    panel.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    panel.scale.setScalar(pose.scale);
    this.panelScale = pose.scale;
  }

  /** Places the room from the anchor: the head position and yaw at the last recentre. */
  private placeRoom(): void {
    if (!this.view || !this.room) return;
    const anchor = this.host.anchor;
    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(this.anchorPosition);
    anchor.getWorldQuaternion(this.anchorQuaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.anchorQuaternion);
    this.roomYaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.room.place({ posture: this.view.posture, head: [this.anchorPosition.x, this.anchorPosition.y, this.anchorPosition.z], yaw: this.roomYaw });
    this.placements++;
  }

  // --- loading bar -------------------------------------------------------------

  private element(id: string): UIKit.Text | null {
    if (!this.elements.has(id)) this.elements.set(id, this.host.panel.getElementById<UIKit.Text>(id) || null);
    return this.elements.get(id)!;
  }

  private setLoading(visible: boolean): void {
    if (visible === this.loadingShown) return;
    this.loadingShown = visible;
    this.loadingStep = -1;
    this.element(QUEST_CHRONICLE_IDS.loading)?.setProperties(visible ? SHOW : HIDE);
    this.host.stateEntity.setValue(ChroniclesArchiveState, 'loading', visible);
  }

  private updateLoading(delta: number, motion: boolean): void {
    const room = this.room;
    const visible = this.shown && !this.runtimeFailed && !(room && (room.ready || room.failed));
    this.setLoading(visible);
    if (!visible) return;
    this.host.stateEntity.setValue(ChroniclesArchiveState, 'loadingFrames', ++this.loadingFrames);
    const fill = this.element(QUEST_CHRONICLE_IDS.loadingFill);
    if (!fill) return;
    const progress = room ? room.progress : 0;
    let step: number;
    if (progress > 0) step = Math.round(Math.min(1, progress) * FILL_STEPS);
    else if (motion) { this.sweepTime = (this.sweepTime + delta / 1.6) % 1; step = FILL_STEPS + 1 + Math.floor(this.sweepTime * SWEEP_STEPS); }
    else step = FILL_STEPS + 1 + SWEEP_STEPS;
    if (step === this.loadingStep) return;
    this.loadingStep = step;
    fill.setProperties(step <= FILL_STEPS ? FILL[step] : step <= FILL_STEPS + SWEEP_STEPS ? SWEEP[step - FILL_STEPS - 1] : STILL);
    this.host.stateEntity.setValue(ChroniclesArchiveState, 'progress', progress);
  }

  // --- reporting ---------------------------------------------------------------

  private writeState(selection?: string | null): void {
    const e = this.host.stateEntity, c = ChroniclesArchiveState, view = this.view;
    e.setValue(c, 'open', this.roomOpen);
    e.setValue(c, 'presented', this.presented);
    e.setValue(c, 'visible', this.shown && this.presented);
    e.setValue(c, 'ready', !!this.room && this.room.ready);
    e.setValue(c, 'progress', this.room ? this.room.progress : 0);
    e.setValue(c, 'panelPose', this.presented ? 'control-surface' : 'menu');
    e.setValue(c, 'panelScale', this.presented ? this.panelScale : 0);
    e.setValue(c, 'placements', this.placements);
    e.setValue(c, 'roomYaw', this.roomYaw);
    e.setValue(c, 'triangles', this.stats.triangles);
    e.setValue(c, 'textureBytes', this.stats.textureBytes);
    if (!view) return;
    const scene = view.scene;
    e.setValue(c, 'load', scene.load);
    e.setValue(c, 'collection', scene.collection);
    e.setValue(c, 'focus', scene.focus.kind === 'nation' ? scene.focus.nation : scene.focus.kind);
    e.setValue(c, 'entry', scene.entryId || '');
    e.setValue(c, 'emphasis', view.open ? scene.collection : '');
    if (selection !== undefined) e.setValue(c, 'selection', selection || '');
    e.setValue(c, 'quality', view.quality);
    e.setValue(c, 'posture', view.posture);
  }
}
