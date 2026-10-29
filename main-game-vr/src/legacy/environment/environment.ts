// The Quest Bannerhold (IWSDK, super-three from @iwsdk/core): implements the full
// QuestLegacyEnvironment contract as a table-top miniature of the shared blueprint below
// eye level, the nation's land and skyline beyond it layered in haze, and the nation's sky.
// Everything is parented under the gameplay anchor (origin at the viewer's eyes, -Z ahead);
// the environment never moves or rotates the viewer. See ./README.md.

import { Color, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { Entity, InstancedMesh, Mesh, World } from '@iwsdk/core';
import type { LandmarkDescriptor, LegacyEnvironmentStats, LegacySceneState } from '../../../../shared/legacy/environment-contract';
import { LEGACY_LANDMARKS } from '../../../../shared/legacy/environment-contract';
import type { LandmarkId, NationId } from '../../../../shared/legacy/types';
import { atlasHeraldryFor, gateVisible, heraldryKey, markerTint, resolveSceneSlots } from '../../../../shared/legacy/environment/build/state';
import type { SceneSlotCounts } from '../../../../shared/legacy/environment/build/state';
import { getBannerholdBlueprint } from '../../../../shared/legacy/environment/blueprint';
import { createMaterialLibrary } from '../../../../shared/legacy/environment/materials/library';
import type { MiniatureFrame } from '../../../../shared/legacy/environment/vr/frame';
import { miniatureFrame } from '../../../../shared/legacy/environment/vr/frame';
import type { PanelLayout } from '../../../../shared/legacy/environment/vr/staging';
import { stagingNumbers } from '../../../../shared/legacy/environment/vr/staging';
import { sweepOccluders } from '../../../../shared/legacy/environment/vr/reveal';
import type { QuestMiniature } from '../../../../shared/legacy/environment/vr/miniature';
import type {
  QuestEnvironmentQuality, QuestLegacyEnvironment, QuestLegacyEnvironmentOptions, QuestPosture, QuestStagingInfo,
} from '../environment-contract';
import { assembleMiniature, disposeAssembly } from './assembly';
import type { QuestAssembly } from './assembly';
import { QuestBuildClient } from './buildClient';
import { QUEST_AGENTS, QUEST_DENSITY, QUEST_TEXTURE_BASE } from './constants';
import { QuestLandmarks } from './landmarks';
import { QuestAgents, QuestSmoke } from './life';
import { QuestMaterialFactory, QuestTextureLibrary, texturesFor } from './materials';
import { createQuestUniforms } from './shaderPatch';
import { QuestSky } from './sky';

/** Overall exposure of the unlit, baked look (multiplied by the blueprint atmosphere exposure). */
const QUEST_EXPOSURE = 1.0;
const WHITE = new Color(1, 1, 1);

function unitLuminance(c: Color): Color {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 1e-4 ? c.multiplyScalar(1 / l) : c.setRGB(1, 1, 1);
}
const YAW_LIMIT = 45;
/** Occlusion reveal: swept sphere radius and the character's chest height (blueprint metres). */
const REVEAL_RADIUS = 0.7;
const REVEAL_CHEST = 1.1;
const YAW_STEP = 15;

export interface QuestEnvironmentDebugInfo {
  nationId: NationId | null;
  quality: QuestEnvironmentQuality;
  posture: QuestPosture;
  userYawDeg: number;
  buildMs: number;
  prepMs: number;
  installMs: number;
  miniature: QuestMiniature['stats'] | null;
  buildStats: QuestMiniature['buildStats'] | null;
  staticDraws: number;
  instanceDraws: number;
  /** Environment objects visible now (submitted draws before frustum culling) and their triangles. */
  visibleDraws: number;
  visibleTriangles: number;
  textures: number;
  textureBytes: number;
  atlasBytes: number;
  layout: PanelLayout | null;
  frame: MiniatureFrame | null;
  renderer: { calls: number; triangles: number; geometries: number; textures: number; programs: number };
  /** XR views rendered per frame (2 without multiview) and whether OCULUS_multiview draws both eyes at once. */
  xrViews: number;
  multiview: boolean;
  /** Occlusion reveal: smoothed strength, dissolve variants active, sweeps run, occluder boxes. */
  reveal: { strength: number; active: boolean; sweeps: number; occluders: number; pairs: number };
}

export class QuestBannerholdEnvironment implements QuestLegacyEnvironment {
  private readonly world: World;
  private readonly o: QuestLegacyEnvironmentOptions;
  /** Anchor space (origin at the eyes): sky and labels. */
  private readonly root = new Group();
  /** The scaled, rotated miniature: content is in blueprint metres below it. */
  private readonly miniature = new Group();
  private readonly labels = new Group();
  private readonly rootEntity: Entity;
  private readonly miniatureEntity: Entity;
  private readonly U = createQuestUniforms();
  private readonly sky: QuestSky;
  private readonly client = new QuestBuildClient();
  private mini: QuestMiniature | null = null;
  private assembly: QuestAssembly | null = null;
  private factory: QuestMaterialFactory | null = null;
  private textures: QuestTextureLibrary | null = null;
  private texturesNation: NationId | null = null;
  private atlas: DataTexture | null = null;
  private atlasKey = '';
  private agents: QuestAgents | null = null;
  private smoke: QuestSmoke | null = null;
  private landmarks: QuestLandmarks | null = null;
  private state: LegacySceneState;
  private slots: SceneSlotCounts | null = null;
  private quality: QuestEnvironmentQuality;
  private posture: QuestPosture;
  private reduced: boolean;
  private paused = false;
  private visible = true;
  private disposed = false;
  private userYaw = 0;
  private frame: MiniatureFrame;
  private staging: QuestStagingInfo;
  private clock = 0;
  private readonly frameTimes = new Float32Array(120);
  private frameCursor = 0;
  private frameCount = 0;
  private hoverId: LandmarkId | null = null;
  private highlightId: LandmarkId | null = null;
  private focusId: LandmarkId | null = null;
  private readonly eyeWorld = new Vector3();
  private readonly eyeLocal = new Vector3();
  private loadToken = 0;
  private atlasToken = 0;
  private buildMs = 0;
  private prepMs = 0;
  private installMs = 0;
  private statsDirty = true;
  private readonly revealHit = new Float64Array(3);
  private readonly revealCam = new Vector3();
  private revealStrength = 0;
  private revealClearFor = 0;
  private revealSwapped = false;
  private revealSweeps = 0;
  private visibleDraws = 0;
  private visibleTriangles = 0;

  constructor(o: QuestLegacyEnvironmentOptions) {
    this.o = o;
    this.world = o.world;
    this.state = o.state;
    this.quality = o.quality;
    this.posture = o.posture;
    this.reduced = o.reducedMotion;
    this.root.name = 'Bannerhold (Quest)';
    this.miniature.name = 'Bannerhold miniature';
    this.labels.name = 'Bannerhold labels';
    this.sky = new QuestSky(this.U);
    this.root.add(this.sky.mesh, this.labels);
    this.root.visible = false;
    this.rootEntity = this.world.createTransformEntity(this.root, { parent: o.parent });
    this.miniatureEntity = this.world.createTransformEntity(this.miniature, { parent: this.rootEntity });
    const vr = getBannerholdBlueprint(o.state.nationId).vr;
    this.frame = miniatureFrame(vr, this.posture, 0);
    this.staging = this.computeStaging();
    this.U.uMotion.value = this.reduced ? 0.25 : 1;
  }

  // --- Lifecycle -------------------------------------------------------------------------

  async init(): Promise<void> {
    await this.load(this.state, 0);
    if (this.disposed) return;
    this.root.visible = this.visible;
    this.landmarks?.setInteractive(this.visible);
  }

  private async load(state: LegacySceneState, userYaw: number): Promise<void> {
    const token = ++this.loadToken;
    const nation = state.nationId;
    const result = await this.client.build(state, nation, userYaw);
    if (this.disposed || token !== this.loadToken) return;
    this.buildMs = result.buildMs;
    this.prepMs = result.miniature.stats.prepMs;
    const lib = createMaterialLibrary(nation);
    const keys = new Set<string>();
    for (const g of result.miniature.groups) keys.add(g.material);
    for (const s of result.miniature.instances) for (const p of s.prototypes) keys.add(p.material);
    let textures = this.textures;
    if (!textures || this.texturesNation !== nation) {
      textures = await QuestTextureLibrary.load(QUEST_TEXTURE_BASE, texturesFor(lib, keys));
      if (this.disposed || token !== this.loadToken) {
        textures.dispose();
        return;
      }
    }
    this.install(result.miniature, textures, nation, result.atlas);
    const renderer = this.world.renderer;
    // Precompile every program, including the hidden emphasis labels and rings, before the reveal.
    const wasVisible = this.root.visible;
    this.root.visible = true;
    this.landmarks?.setPrecompile(true);
    try {
      await renderer.compileAsync(this.root, this.world.camera, this.world.scene);
      // The occlusion reveal's dissolve variants, so the first reveal never compiles.
      this.swapReveal(true);
      await renderer.compileAsync(this.root, this.world.camera, this.world.scene);
    } catch {
      // Compilation then happens on first draw; nothing is lost.
    }
    this.swapReveal(this.revealStrength > 0.001);
    this.landmarks?.setPrecompile(false);
    this.root.visible = wasVisible;
    if (this.disposed) return;
    await textures.upload(renderer, () => !this.disposed);
    if (this.atlas && !this.disposed) renderer.initTexture(this.atlas);
  }

  private uploadAtlas(bytes: Uint8ClampedArray): void {
    const size = Math.round(Math.sqrt(bytes.length / 4));
    if (!this.atlas || this.atlas.image.width !== size) {
      this.atlas?.dispose();
      this.atlas = new DataTexture(bytes, size, size, RGBAFormat);
      this.atlas.colorSpace = SRGBColorSpace;
      // Rasters are row 0 at the top; atlas UVs assume a flipped upload (shared heraldry/atlas.ts).
      this.atlas.flipY = true;
      this.atlas.generateMipmaps = true;
      this.atlas.minFilter = LinearMipmapLinearFilter;
      this.atlas.magFilter = LinearFilter;
      this.atlas.anisotropy = 2;
    } else {
      (this.atlas.image as { data: Uint8ClampedArray }).data = bytes;
    }
    this.atlas.needsUpdate = true;
  }

  /** Swaps in a prepared miniature (first load, nation change or rotation). */
  private install(mini: QuestMiniature, textures: QuestTextureLibrary, nation: NationId, atlasBytes: Uint8ClampedArray | null): void {
    const t0 = performance.now();
    const sameNation = this.mini !== null && this.mini.nationId === nation && this.factory !== null;
    // Tear down what depends on the old content.
    this.landmarks?.dispose();
    this.landmarks = null;
    if (this.smoke) {
      this.smoke.mesh.removeFromParent();
      this.smoke.dispose();
      this.smoke = null;
    }
    if (this.assembly) disposeAssembly(this.assembly);
    this.assembly = null;
    this.revealSwapped = false;
    if (textures !== this.textures) {
      this.factory?.dispose();
      this.factory = null;
      this.textures?.dispose();
      this.textures = textures;
      this.texturesNation = nation;
    }
    if (atlasBytes) {
      this.uploadAtlas(atlasBytes);
      this.atlasKey = heraldryKey(atlasHeraldryFor(this.state, mini.atmosphere));
    }
    if (!this.factory || !sameNation) {
      this.factory?.dispose();
      this.factory = new QuestMaterialFactory({ lib: createMaterialLibrary(nation), uniforms: this.U, textures, atlas: this.atlas as DataTexture });
    }
    this.mini = mini;
    this.userYaw = mini.userYawDeg;
    const a = mini.atmosphere;
    this.U.uFogColor.value.set(a.fog.colour);
    this.U.uHorizonColor.value.set(a.sky.horizon);
    this.U.uSkyReflect.value.set(a.sky.horizon).lerp(this.U.uFogColor.value.clone().set(a.sky.zenith), 0.35);
    const L = Math.min(2000, Math.max(450, a.fog.far * 0.6));
    this.U.uHaze.value.set(0.8, L, a.fog.far * 0.45, a.fog.far * 2.8);
    this.U.uExposure.value = a.exposure * QUEST_EXPOSURE;
    const sb = (a.sun.bearingDeg * Math.PI) / 180, se = (a.sun.elevationDeg * Math.PI) / 180;
    this.U.uSunDir.value.set(Math.sin(sb) * Math.cos(se), Math.sin(se), -Math.cos(sb) * Math.cos(se)).normalize();
    unitLuminance(this.U.uSunTint.value.set(a.sun.colour));
    unitLuminance(this.U.uAmbTint.value.set(a.sky.zenith).lerp(new Color(a.sky.horizon), 0.6));
    // Keep tints gentle: the bake already carries the light's shape.
    this.U.uSunTint.value.lerp(WHITE, 0.45);
    this.U.uAmbTint.value.lerp(WHITE, 0.55);
    const wb = (a.wind.towardBearingDeg * Math.PI) / 180;
    const ws = Math.min(1.5, 0.4 + a.wind.speed * 0.12);
    this.U.uWind.value.set(Math.sin(wb) * ws, 0, -Math.cos(wb) * ws);
    this.U.uDatum.value = mini.vr.datumY;
    this.sky.apply(a);
    this.assembly = assembleMiniature(mini, this.factory);
    this.miniature.add(this.assembly.content);
    this.frame = miniatureFrame(mini.vr, this.posture, this.userYaw);
    this.agents = new QuestAgents(mini.agents, this.assembly.instanced, mini.field, QUEST_AGENTS[this.quality]);
    if (mini.smoke.length) {
      this.smoke = new QuestSmoke(mini.smoke, this.U, mini.vr.displayScale);
      this.assembly.content.add(this.smoke.mesh);
    }
    const c = mini.vr.displayCenter;
    this.landmarks = new QuestLandmarks(
      this.world, this.miniatureEntity, this.labels, this.assembly.content, mini.landmarks, [c[0], mini.vr.datumY, c[1]], mini.field,
      (id) => this.onProxyHover(id),
      (id) => this.o.onLandmarkSelect(id),
      () => this.visible && !this.paused,
    );
    this.landmarks.setInteractive(this.visible && this.root.visible);
    this.applyFrame();
    this.applyQuality();
    this.applyState(this.state);
    this.applyEmphasis();
    if (this.agents) this.agents.update(this.clock);
    this.statsDirty = true;
    this.installMs = Math.round(performance.now() - t0);
  }

  private applyFrame(): void {
    const f = this.frame;
    this.miniature.position.set(0, f.surfaceY, -f.distance);
    this.miniature.rotation.set(0, f.yaw, 0);
    this.miniature.scale.setScalar(f.scale);
    this.sky.mesh.rotation.set(0, f.yaw, 0);
    this.U.uFrame.value.set(f.centerX, f.centerZ, f.cos, f.sin);
    this.U.uExtent.value.set(f.halfWidth, f.halfDepth, f.lateral, f.far);
    this.U.uScaleInv.value = 1 / f.scale;
    this.landmarks?.layout(f);
    this.staging = this.computeStaging();
  }

  private computeStaging(): QuestStagingInfo {
    const f = this.frame;
    const layout = this.mini ? this.mini.layouts[this.posture] : null;
    const fallback: PanelLayout = {
      primary: { position: [-0.74, 0.02, -0.88], yawDeg: -40, pitchDeg: 1, distance: 1.15, clearance: 0 },
      dock: { position: [0.74, -0.2, -0.88], yawDeg: 40, pitchDeg: -10, distance: 1.15, clearance: 0 },
    };
    const bp = getBannerholdBlueprint(this.mini ? this.mini.nationId : this.state.nationId);
    const lm = this.mini ? this.mini.landmarks : bp.landmarks;
    const n = stagingNumbers(f, layout ?? fallback, lm, bp.vr.detailExtent);
    return { scale: n.scale, footprint: n.footprint, surfaceCenter: n.surfaceCenter, panelAnchors: n.panelAnchors, landmarks: n.landmarks };
  }

  // --- State -----------------------------------------------------------------------------

  setState(state: LegacySceneState): void {
    if (this.disposed) return;
    this.state = state;
    const mini = this.mini;
    if (!mini) return;
    if (state.nationId !== mini.nationId) {
      // The only change that rebuilds; the current holding stays until the new one is ready.
      void this.load(state, 0).catch((error: unknown) => console.error('[Bannerhold] Rebuild failed.', error));
      return;
    }
    this.applyState(state);
  }

  private applyState(state: LegacySceneState): void {
    const mini = this.mini, a = this.assembly;
    if (!mini || !a) return;
    const slots = resolveSceneSlots(state, mini.slotCapacities);
    this.slots = slots;
    for (const g of a.gated) g.object.visible = gateVisible(g.gate, slots);
    const setCount = (name: string, n: number): void => {
      const list = a.instanced.get(name);
      if (!list) return;
      for (const m of list) {
        m.count = Math.min(n, m.instanceMatrix.count);
        m.visible = m.count > 0;
      }
    };
    setCount(mini.slots.pawn, slots.pawn);
    setCount(mini.slots.injured, slots.injured);
    setCount(mini.slots.levy, slots.levy);
    setCount(mini.slots.honours, slots.honours);
    setCount(mini.slots.notices, slots.notices);
    const markers = a.instanced.get(mini.slots.recordMarkers);
    if (markers) {
      for (const m of markers) {
        m.count = Math.min(slots.recordMarkers.length, m.instanceMatrix.count);
        m.visible = m.count > 0;
        if (m.instanceColor) {
          const arr = m.instanceColor.array as Float32Array;
          slots.recordMarkers.forEach((o, i) => arr.set(markerTint(o), i * 3));
          m.instanceColor.needsUpdate = true;
        }
      }
    }
    this.smoke?.applyGates((gate) => gateVisible(gate, slots));
    const key = heraldryKey(atlasHeraldryFor(state, mini.atmosphere));
    if (key !== this.atlasKey) {
      this.atlasKey = key;
      const token = ++this.atlasToken;
      void this.client.atlas(state, mini.nationId).then((bytes) => {
        if (this.disposed || token !== this.atlasToken) return;
        this.uploadAtlas(bytes);
      }).catch((error: unknown) => console.warn('[Bannerhold] Heraldry atlas refill failed.', error));
    }
    this.statsDirty = true;
  }

  // --- Landmarks ---------------------------------------------------------------------------

  private onProxyHover(id: LandmarkId | null): void {
    this.hoverId = id;
    this.applyEmphasis();
    this.o.onLandmarkHover(id);
  }

  private applyEmphasis(): void {
    const hover = this.highlightId ?? this.hoverId;
    this.U.uHover.value = hover ? LEGACY_LANDMARKS.indexOf(hover) + 1 : 0;
    this.U.uFocus.value = this.focusId ? LEGACY_LANDMARKS.indexOf(this.focusId) + 1 : 0;
    this.landmarks?.setEmphasis({ hover: this.hoverId, highlight: this.highlightId, focus: this.focusId });
    this.statsDirty = true;
  }

  /** Quest: emphasis only (label, ground ring, warm rim on the landmark's buildings); the viewer never moves. */
  focusLandmark(id: LandmarkId | null): void {
    this.focusId = id;
    this.applyEmphasis();
  }

  highlightLandmark(id: LandmarkId | null): void {
    this.highlightId = id;
    this.applyEmphasis();
  }

  getLandmarks(): readonly LandmarkDescriptor[] {
    const list = this.mini ? this.mini.landmarks : getBannerholdBlueprint(this.state.nationId).landmarks;
    return list.map((l) => ({ id: l.id, label: l.label, position: l.anchor }));
  }

  // --- Frame -------------------------------------------------------------------------------

  /** Called every frame by the owning system. Allocation-free. */
  update(delta: number, _time: number): void {
    if (this.disposed || !this.visible || !this.assembly) return;
    this.frameTimes[this.frameCursor] = delta * 1000;
    this.frameCursor = (this.frameCursor + 1) % this.frameTimes.length;
    if (this.frameCount < this.frameTimes.length) this.frameCount++;
    if (this.paused) return;
    this.clock += delta < 0.1 ? delta : 0.1;
    const U = this.U;
    U.uTime.value = this.clock;
    U.uPulse.value = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 2.4);
    if (this.agents) this.agents.update(this.clock);
    this.updateReveal(delta);
    if (this.landmarks) {
      this.world.camera.getWorldPosition(this.eyeWorld);
      this.eyeLocal.copy(this.eyeWorld);
      this.labels.worldToLocal(this.eyeLocal);
      this.landmarks.update(this.eyeLocal, delta, this.clock, this.reduced);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setQuality(quality: QuestEnvironmentQuality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.applyQuality();
  }

  private applyQuality(): void {
    const a = this.assembly;
    if (!a) return;
    const density = QUEST_DENSITY[this.quality];
    for (const t of a.thinned) {
      const n = t.optional && this.quality === 'low' ? 0 : Math.max(1, Math.round(t.capacity * density));
      for (const m of t.meshes) {
        m.count = Math.min(n, m.instanceMatrix.count);
        m.visible = m.count > 0;
      }
    }
    this.agents?.setActive(QUEST_AGENTS[this.quality]);
    if (this.smoke) this.smoke.mesh.visible = this.quality !== 'low';
    this.statsDirty = true;
  }

  setPosture(posture: QuestPosture): void {
    if (this.posture === posture) return;
    this.posture = posture;
    const vr = this.mini ? this.mini.vr : getBannerholdBlueprint(this.state.nationId).vr;
    this.frame = miniatureFrame(vr, posture, this.userYaw);
    this.applyFrame();
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.U.uMotion.value = reduced ? 0.25 : 1;
    this.smoke?.setRate(reduced ? 0.5 : 1);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.visible = visible && this.mini !== null;
    this.landmarks?.setInteractive(visible && this.mini !== null);
    if (!visible && this.hoverId) this.onProxyHover(null);
  }

  getStaging(): QuestStagingInfo {
    return this.staging;
  }

  /**
   * Development and future-contract extra: turns the miniature (never the viewer) to a user
   * rotation within ±45° in 15° snaps. The worker re-prepares the table-top at that yaw so the
   * near cut and the fades stay relative to the viewer; the current view stays until it is ready.
   */
  async setMiniatureYaw(degrees: number): Promise<number> {
    const yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, Math.round(degrees / YAW_STEP) * YAW_STEP));
    if (!this.mini || yaw === this.userYaw) return this.userYaw;
    const token = ++this.loadToken;
    const nation = this.mini.nationId;
    const mini = await this.client.prepare(this.state, nation, yaw);
    if (this.disposed || token !== this.loadToken || !this.textures) return this.userYaw;
    this.prepMs = mini.stats.prepMs;
    this.install(mini, this.textures, nation, null);
    await this.textures.upload(this.world.renderer, () => !this.disposed);
    return this.userYaw;
  }

  get miniatureYaw(): number {
    return this.userYaw;
  }

  // --- Occlusion reveal --------------------------------------------------------------------------

  /**
   * Keeps the representative (or their empty place) visible from the viewer's head while the
   * Muster Grounds are focused: a sphere swept from the chest to the head against the blueprint's
   * occluder boxes drives a smoothed strength; occluding materials switch to their dissolve
   * variants only while it is above zero. Off on Low. Allocation-free.
   */
  private updateReveal(delta: number): void {
    const mini = this.mini, a = this.assembly;
    if (!mini || !a) return;
    let target = 0;
    if (this.focusId === 'muster-grounds' && this.quality !== 'low') {
      const bp = getBannerholdBlueprint(mini.nationId);
      const injured = this.slots !== null && this.slots.injured === 1;
      const p = injured ? bp.slots.injuredRest.position : bp.muster.pawnStand.position;
      const ax = p[0], ay = p[1] + REVEAL_CHEST, az = p[2];
      this.world.camera.getWorldPosition(this.revealCam);
      a.content.worldToLocal(this.revealCam);
      const t = sweepOccluders(mini.colliders, ax, ay, az, this.revealCam.x, this.revealCam.y, this.revealCam.z, REVEAL_RADIUS, this.revealHit);
      this.revealSweeps++;
      // Hysteresis: once revealing, keep it for a quarter second of clear sight before fading out.
      if (t >= 0) this.revealClearFor = 0;
      else this.revealClearFor += delta;
      target = t >= 0 || (this.revealStrength > 0.5 && this.revealClearFor < 0.25) ? 1 : 0;
      this.U.uRevealA.value.set(ax, ay, az);
      this.U.uRevealB.value.copy(this.revealCam);
    }
    const k = 1 - Math.exp(-6 * (delta < 0.1 ? delta : 0.1));
    this.revealStrength += (target - this.revealStrength) * k;
    if (this.revealStrength < 0.002 && target === 0) this.revealStrength = 0;
    this.U.uReveal.value.y = this.revealStrength;
    this.U.uReveal.value.z = this.quality === 'high' ? 0.35 : 0.2;
    this.swapReveal(this.revealStrength > 0.001);
  }

  private swapReveal(on: boolean): void {
    const a = this.assembly;
    if (!a || on === this.revealSwapped) return;
    this.revealSwapped = on;
    const pairs = a.revealPairs;
    for (let i = 0; i < pairs.length; i++) pairs[i].mesh.material = on ? pairs[i].reveal : pairs[i].normal;
  }

  // --- Stats and teardown --------------------------------------------------------------------

  private countVisible(): void {
    if (!this.statsDirty) return;
    this.statsDirty = false;
    let draws = 0, tris = 0;
    this.root.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as { visible?: boolean };
      if (mat && mat.visible === false) return;
      const geo = mesh.geometry;
      const per = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const inst = (mesh as unknown as InstancedMesh).isInstancedMesh ? (mesh as unknown as InstancedMesh).count : (geo as { instanceCount?: number }).instanceCount ?? 1;
      if (inst <= 0) return;
      draws++;
      tris += per * (Number.isFinite(inst) ? inst : 1);
    });
    this.visibleDraws = draws;
    this.visibleTriangles = Math.round(tris);
  }

  /** Renderer counts of the last rendered frame (the whole frame, including any host panels), environment memory and frame times. */
  getStats(): LegacyEnvironmentStats {
    const info = this.world.renderer.info;
    const frames = this.frameCount;
    const frameTimesMs: number[] = [];
    for (let i = 0; i < frames; i++) frameTimesMs.push(Math.round(this.frameTimes[(this.frameCursor - frames + i + this.frameTimes.length) % this.frameTimes.length] * 100) / 100);
    return {
      triangles: info.render.triangles,
      drawCalls: info.render.calls,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frameTimesMs,
    };
  }

  /** Development diagnostics for the harness and capture script. */
  debugInfo(): QuestEnvironmentDebugInfo {
    this.countVisible();
    const info = this.world.renderer.info;
    const xr = this.world.renderer.xr as typeof this.world.renderer.xr & { isMultiview?: boolean };
    const atlasImage = this.atlas ? (this.atlas.image as { width: number; height: number }) : null;
    return {
      nationId: this.mini ? this.mini.nationId : null,
      quality: this.quality,
      posture: this.posture,
      userYawDeg: this.userYaw,
      buildMs: this.buildMs,
      prepMs: this.prepMs,
      installMs: this.installMs,
      miniature: this.mini ? this.mini.stats : null,
      buildStats: this.mini ? this.mini.buildStats : null,
      staticDraws: this.assembly ? this.assembly.staticDraws : 0,
      instanceDraws: this.assembly ? this.assembly.instanceDraws : 0,
      visibleDraws: this.visibleDraws,
      visibleTriangles: this.visibleTriangles,
      textures: this.textures ? this.textures.count() : 0,
      textureBytes: this.textures ? this.textures.gpuBytes() : 0,
      atlasBytes: atlasImage ? Math.round(atlasImage.width * atlasImage.height * 4 * (4 / 3)) : 0,
      layout: this.mini ? this.mini.layouts[this.posture] : null,
      frame: this.frame,
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : 0 },
      xrViews: xr.isPresenting ? (xr.isMultiview ? 1 : Math.max(1, xr.getCamera().cameras.length)) : 1,
      multiview: xr.isPresenting && xr.isMultiview === true,
      reveal: { strength: +this.revealStrength.toFixed(3), active: this.revealSwapped, sweeps: this.revealSweeps, occluders: this.mini ? this.mini.colliders.length : 0, pairs: this.assembly ? this.assembly.revealPairs.length : 0 },
    };
  }

  /** Development: the hovered landmark as seen by the proxies. */
  get hovered(): LandmarkId | null {
    return this.hoverId;
  }

  get ready(): boolean {
    return this.mini !== null && !this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    this.client.dispose();
    this.landmarks?.dispose();
    this.landmarks = null;
    if (this.smoke) {
      this.smoke.mesh.removeFromParent();
      this.smoke.dispose();
      this.smoke = null;
    }
    if (this.assembly) disposeAssembly(this.assembly);
    this.assembly = null;
    this.factory?.dispose();
    this.factory = null;
    this.textures?.dispose();
    this.textures = null;
    this.atlas?.dispose();
    this.atlas = null;
    this.sky.mesh.removeFromParent();
    this.sky.dispose();
    this.agents = null;
    this.mini = null;
    // entity.dispose releases anything still attached to the trees (resources are already freed above).
    this.miniatureEntity.dispose();
    this.rootEntity.dispose();
  }
}
