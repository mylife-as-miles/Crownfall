// Quest Bannerhold development harness (?legacyEnvironment; seam in src/index.ts). Hides the
// menu scene nodes, places an anchor at the viewer's eyes like gameplay's Legacy anchor, and
// shows the environment with labelled development fixtures only (never production state).
// Provides its own Enter VR (the page's #enter-vr button), recentring, fixture, nation,
// posture, quality and rotation controls as world-space buttons, and an ECS component that
// capture scripts drive (harness-components.ts).
//
// URL: ?legacyEnvironment&nation=korvenia|solforiz|aethelgard|kwind-09&fixture=unfounded|founded|
//      injured|captive|returned|recognised&quality=low|medium|high&posture=seated|standing&yaw=-45..45&panels=1&reducedMotion=1
//      &fbScale=0.2..0.99 (development only: XR framebuffer scale for software emulation)

import {
  CanvasTexture, Color, createSystem, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry,
  PokeInteractable, Quaternion, RayInteractable, SRGBColorSpace, Vector3, VisibilityState, BoxGeometry, EdgesGeometry,
} from '@iwsdk/core';
import type { Entity, Object3D, World } from '@iwsdk/core';
import type { LandmarkId, NationId } from '../../../../shared/legacy/types';
import { DEVELOPMENT_FIXTURE_CAPTION, ENVIRONMENT_FIXTURE_IDS, environmentFixture } from '../../../../shared/legacy/environment/fixtures';
import type { EnvironmentFixtureId } from '../../../../shared/legacy/environment/fixtures';
import { getBannerholdBlueprint } from '../../../../shared/legacy/environment/blueprint';
import { blueprintToAnchor } from '../../../../shared/legacy/environment/vr/frame';
import { QUEST_LEGACY_PANELS } from '../../../../shared/legacy/environment/vr/staging';
import type { QuestEnvironmentQuality, QuestPosture, QuestStagingInfo } from '../environment-contract';
import { QuestBannerholdEnvironment } from './environment';
import { LegacyEnvironmentHarnessState as H } from './harness-components';

const NATIONS: readonly NationId[] = ['korvenia', 'solforiz', 'aethelgard', 'kwind-09'];
const QUALITIES: readonly QuestEnvironmentQuality[] = ['high', 'medium', 'low'];
const BUTTONS = [
  { id: 'fixture', label: 'Fixture' }, { id: 'nation', label: 'Nation' }, { id: 'posture', label: 'Posture' }, { id: 'quality', label: 'Quality' },
  { id: 'turn-left', label: 'Turn left' }, { id: 'turn-right', label: 'Turn right' }, { id: 'recenter', label: 'Recentre' }, { id: 'panels', label: 'Panels' },
] as const;
type ButtonId = (typeof BUTTONS)[number]['id'];

interface Settings {
  nation: NationId;
  fixture: EnvironmentFixtureId;
  quality: QuestEnvironmentQuality;
  posture: QuestPosture;
  yaw: number;
  panels: boolean;
  reducedMotion: boolean;
  paused: boolean;
}

function plateTexture(lines: readonly { text: string; size: number; color: string; weight?: number }[], w: number, h: number, border = '#a07a3c'): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(16, 13, 9, 0.92)';
  g.fillRect(0, 0, w, h);
  g.lineWidth = Math.max(3, Math.round(h * 0.035));
  g.strokeStyle = border;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  const total = lines.reduce((s, l) => s + l.size * 1.3, 0);
  let y = (h - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.weight ?? 600} ${l.size}px Barlow, Arial, sans-serif`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y + l.size * 0.12, w - 24);
    y += l.size * 1.3;
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Turns a +Z-facing object at anchor-space p to face the anchor origin (the eyes), like gameplay's panels. */
function faceEye(o: Object3D, x: number, y: number, z: number): void {
  o.position.set(x, y, z);
  o.rotation.set(Math.atan2(y, Math.hypot(x, z)), Math.atan2(-x, -z), 0, 'YXZ');
}

function param<T extends string>(p: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const v = p.get(key);
  return v && (allowed as readonly string[]).indexOf(v) >= 0 ? (v as T) : fallback;
}

class LegacyEnvironmentHarnessSystem extends createSystem({ harness: { required: [H] } }) {
  private env: QuestBannerholdEnvironment | null = null;
  private stateEntity!: Entity;
  private anchor!: Object3D;
  private settings!: Settings;
  private presenting = false;
  private needRecenter = false;
  private canEnter = false;
  private focus: LandmarkId | null = null;
  private readonly owned: { dispose(): void }[] = [];
  private readonly buttonEntities: Entity[] = [];
  private readonly buttonMeshes = new Map<ButtonId, Mesh>();
  private strip!: Group;
  private stripCanvas!: HTMLCanvasElement;
  private stripTexture!: CanvasTexture;
  private stripEntity!: Entity;
  private info!: Mesh;
  private infoMaterial!: MeshBasicMaterial;
  private nearCaption!: Mesh;
  private ghosts!: Group;
  private readonly headPosition = new Vector3();
  private readonly headRotation = new Quaternion();
  private readonly headDirection = new Vector3();
  private readonly tmp: [number, number, number] = [0, 0, 0];
  private readonly world3 = new Vector3();
  private lastSeq = 0;

  init(): void {
    const world = this.world;
    // Hide the Home menu: the harness replaces it and must not leave it holding rays or pokes.
    const menuAnchor = world.getSceneObject('experience-anchor');
    if (menuAnchor) menuAnchor.visible = false;
    const menuPanel = world.getSceneEntity('menu-panel');
    if (menuPanel) menuPanel.removeComponent(RayInteractable).removeComponent(PokeInteractable);
    const p = new URLSearchParams(window.location.search);
    this.settings = {
      nation: param(p, 'nation', NATIONS, 'korvenia'),
      fixture: param(p, 'fixture', ENVIRONMENT_FIXTURE_IDS, 'founded'),
      quality: param(p, 'quality', QUALITIES, 'high'),
      posture: param(p, 'posture', ['seated', 'standing'] as const, 'seated'),
      yaw: Math.max(-45, Math.min(45, Math.round((Number(p.get('yaw')) || 0) / 15) * 15)),
      panels: p.get('panels') === '1',
      reducedMotion: p.get('reducedMotion') === '1',
      paused: false,
    };
    const anchorGroup = new Group();
    anchorGroup.name = 'Legacy Environment Harness Anchor (development)';
    this.stateEntity = world.createTransformEntity(anchorGroup);
    this.anchor = anchorGroup;
    this.stateEntity.addComponent(H, {
      caption: DEVELOPMENT_FIXTURE_CAPTION, nation: this.settings.nation, fixture: this.settings.fixture, quality: this.settings.quality,
      posture: this.settings.posture, yaw: this.settings.yaw, panels: this.settings.panels, reducedMotion: this.settings.reducedMotion,
    });
    this.buildUi();
    this.frameBrowser();
    this.wireEntry();
    this.cleanupFuncs.push(world.visibilityState.subscribe((v) => this.onVisibility(v)));
    this.cleanupFuncs.push(world.onXRFrame((frame) => {
      const space = world.xrReferenceSpace;
      if (this.needRecenter && space && frame.getViewerPose(space)) {
        this.needRecenter = false;
        this.recenter();
      }
    }));
    this.cleanupFuncs.push(() => {
      this.env?.dispose();
      this.env = null;
      for (const e of this.buttonEntities) e.dispose();
      this.stripEntity.dispose();
      for (const o of this.owned) o.dispose();
      this.infoMaterial.map?.dispose();
    });
    // Development-only accommodation for software headset emulation (?fbScale=0.2–0.99);
    // production headset rendering keeps the native framebuffer scale.
    const fbScale = Number(p.get('fbScale'));
    if (import.meta.env.DEV && fbScale >= 0.2 && fbScale < 1) world.renderer.xr.setFramebufferScaleFactor(fbScale);
    void this.createEnvironment();
  }

  private async createEnvironment(): Promise<void> {
    const s = this.settings;
    const env = new QuestBannerholdEnvironment({
      world: this.world,
      parent: this.stateEntity,
      state: environmentFixture(s.fixture, s.nation),
      quality: s.quality,
      posture: s.posture,
      reducedMotion: s.reducedMotion,
      onLandmarkHover: (id) => {
        this.stateEntity.setValue(H, 'hover', id ?? '');
        this.stateEntity.setValue(H, 'hoverCount', (this.stateEntity.getValue(H, 'hoverCount') as number) + 1);
      },
      onLandmarkSelect: (id) => {
        this.stateEntity.setValue(H, 'lastSelect', id);
        this.stateEntity.setValue(H, 'selectCount', (this.stateEntity.getValue(H, 'selectCount') as number) + 1);
        this.setFocus(this.focus === id ? null : id);
      },
    });
    this.env = env;
    this.status('Building the holding…');
    try {
      await env.init();
      if (s.yaw !== 0) await env.setMiniatureYaw(s.yaw);
    } catch (error) {
      console.error('[Bannerhold harness] The environment could not be created.', error);
      this.status('The Bannerhold could not be built. See the console.');
      return;
    }
    if (this.env !== env) return;
    this.placeUi();
    this.refreshInfo();
    this.stateEntity.setValue(H, 'ready', true);
    this.status(`${DEVELOPMENT_FIXTURE_CAPTION}. Enter VR, then point and pinch at a landmark.`);
  }

  private setFocus(id: LandmarkId | null): void {
    this.focus = id;
    this.env?.focusLandmark(id);
    this.stateEntity.setValue(H, 'focus', id ?? '');
  }

  private status(text: string): void {
    const el = document.getElementById('quest-status');
    if (el) el.textContent = text;
  }

  private wireEntry(): void {
    const button = document.getElementById('enter-vr') as HTMLButtonElement | null;
    const enter = (): void => {
      if (!this.canEnter) {
        this.status('Open this page in a headset browser with hand tracking to enter VR.');
        return;
      }
      try {
        this.world.launchXR();
      } catch {
        this.status('VR could not start. Allow hand tracking and try again.');
      }
    };
    button?.addEventListener('click', enter);
    this.cleanupFuncs.push(() => button?.removeEventListener('click', enter));
    if (navigator.xr) {
      void navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
        this.canEnter = ok;
        if (button) button.disabled = !ok;
      }).catch(() => undefined);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'r' || e.key === 'R') this.recenter();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
  }

  private onVisibility(v: VisibilityState): void {
    const presenting = v !== VisibilityState.NonImmersive;
    if (presenting === this.presenting) return;
    this.presenting = presenting;
    this.stateEntity.setValue(H, 'presenting', presenting);
    document.body.dataset.xr = presenting ? 'presenting' : 'browser';
    if (presenting) this.needRecenter = true;
    else this.frameBrowser();
  }

  /** Re-places the anchor at the eyes with the head's heading (yaw only); the viewer is never moved. */
  private recenter(): void {
    const head = this.presenting ? this.player.head : this.world.camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.headPosition);
    head.getWorldQuaternion(this.headRotation);
    this.headDirection.set(0, 0, -1).applyQuaternion(this.headRotation);
    const yaw = this.headDirection.x * this.headDirection.x + this.headDirection.z * this.headDirection.z < 1e-6 ? 0 : Math.atan2(-this.headDirection.x, -this.headDirection.z);
    this.anchor.position.copy(this.headPosition);
    this.anchor.rotation.set(0, yaw, 0);
    this.stateEntity.setValue(H, 'recenters', (this.stateEntity.getValue(H, 'recenters') as number) + 1);
    // Blueprint recentre behaviour: the miniature returns to its authored orientation (vr.recentre.keepsYaw false).
    if (this.settings.yaw !== 0) this.stateEntity.setValue(H, 'yaw', 0);
  }

  /** Browser preview (outside XR): a seated or standing eye looking down at the miniature, anchor at the eye. */
  private frameBrowser(): void {
    const cam = this.world.camera;
    const vr = getBannerholdBlueprint(this.settings.nation).vr;
    const p = this.settings.posture === 'standing' ? vr.standing : vr.seated;
    cam.position.set(0, p.eyeHeight, 0);
    cam.rotation.set(-Math.atan2(p.eyeHeight - p.surfaceHeight, p.viewerDistance) * 0.92, 0, 0, 'YXZ');
    cam.fov = 64;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.anchor.position.set(0, p.eyeHeight, 0);
    this.anchor.rotation.set(0, 0, 0);
  }

  private buildUi(): void {
    const stripGroup = new Group();
    stripGroup.name = 'Harness controls (development)';
    this.strip = stripGroup;
    this.stripEntity = this.world.createTransformEntity(stripGroup, { parent: this.stateEntity });
    // One textured plane for every button (a single draw); invisible boxes take the rays and pokes.
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 128;
    this.stripCanvas = canvas;
    this.stripTexture = new CanvasTexture(canvas);
    this.stripTexture.colorSpace = SRGBColorSpace;
    this.stripTexture.anisotropy = 4;
    const W = BUTTONS.length * 0.128;
    const plane = new PlaneGeometry(W, 0.064);
    const face = new MeshBasicMaterial({ map: this.stripTexture, transparent: true, toneMapped: false, side: DoubleSide });
    const stripMesh = new Mesh(plane, face);
    stripMesh.name = 'Harness controls face';
    stripGroup.add(stripMesh);
    const hit = new BoxGeometry(0.12, 0.064, 0.02);
    const hidden = new MeshBasicMaterial({ visible: false });
    this.owned.push(this.stripTexture, plane, face, hit, hidden);
    BUTTONS.forEach((b, i) => {
      const mesh = new Mesh(hit, hidden);
      mesh.name = `Harness_${b.id}`;
      mesh.position.set((i - (BUTTONS.length - 1) / 2) * 0.128, 0, 0.004);
      const entity = this.world.createTransformEntity(mesh, { parent: this.stripEntity });
      entity.addComponent(RayInteractable).addComponent(PokeInteractable);
      mesh.addEventListener('pointerenter', (() => this.drawStrip(b.id)) as never);
      mesh.addEventListener('pointerleave', (() => this.drawStrip(null)) as never);
      mesh.addEventListener('click', (() => this.press(b.id)) as never);
      this.buttonEntities.push(entity);
      this.buttonMeshes.set(b.id, mesh);
    });
    this.drawStrip(null);
    const infoGeometry = new PlaneGeometry(0.62, 0.2);
    this.infoMaterial = new MeshBasicMaterial({ transparent: true, toneMapped: false, side: DoubleSide });
    this.info = new Mesh(infoGeometry, this.infoMaterial);
    this.info.name = 'Harness development fixture caption';
    this.owned.push(infoGeometry, this.infoMaterial);
    const captionTexture = plateTexture([
      { text: DEVELOPMENT_FIXTURE_CAPTION, size: 34, color: '#f0b860' },
    ], 1024, 64, '#8a6a30');
    const captionGeometry = new PlaneGeometry(0.42, 0.026);
    const captionMaterial = new MeshBasicMaterial({ map: captionTexture, transparent: true, toneMapped: false, side: DoubleSide });
    this.nearCaption = new Mesh(captionGeometry, captionMaterial);
    this.nearCaption.name = 'Harness development fixture label';
    this.owned.push(captionTexture, captionGeometry, captionMaterial);
    this.ghosts = new Group();
    this.ghosts.name = 'Gameplay panel areas (harness preview)';
    this.ghosts.visible = this.settings.panels;
    for (const size of [QUEST_LEGACY_PANELS.primary, QUEST_LEGACY_PANELS.dock]) {
      const plane = new PlaneGeometry(size.width, size.height);
      const edges = new EdgesGeometry(plane);
      const fill = new MeshBasicMaterial({ color: new Color('#d49130'), transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false, side: DoubleSide });
      const line = new LineBasicMaterial({ color: new Color('#f0b860'), toneMapped: false });
      const g = new Group();
      g.add(new Mesh(plane, fill), new LineSegments(edges, line));
      this.ghosts.add(g);
      this.owned.push(plane, edges, fill, line);
    }
    this.anchor.add(this.info, this.nearCaption, this.ghosts);
  }

  private drawStrip(hovered: ButtonId | null): void {
    const g = this.stripCanvas.getContext('2d') as CanvasRenderingContext2D;
    const cell = this.stripCanvas.width / BUTTONS.length, h = this.stripCanvas.height;
    g.clearRect(0, 0, this.stripCanvas.width, h);
    BUTTONS.forEach((b, i) => {
      const x = i * cell;
      g.fillStyle = b.id === hovered ? '#5a4320' : 'rgba(30, 24, 15, 0.94)';
      g.fillRect(x + 6, 6, cell - 12, h - 12);
      g.lineWidth = 5;
      g.strokeStyle = b.id === hovered ? '#ffc46a' : '#b0802f';
      g.strokeRect(x + 6, 6, cell - 12, h - 12);
      g.fillStyle = '#f2e6cc';
      g.font = '600 44px Barlow, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.label, x + cell / 2, h / 2 + 2, cell - 28);
    });
    this.stripTexture.needsUpdate = true;
  }

  /** Places the controls at the dock anchor, the caption plate at the primary anchor, the label at the near edge. */
  private placeUi(): void {
    const env = this.env;
    if (!env) return;
    const st: QuestStagingInfo = env.getStaging();
    const d = st.panelAnchors.dock, pr = st.panelAnchors.primary;
    faceEye(this.strip, d[0], d[1], d[2]);
    faceEye(this.info, pr[0], pr[1] - 0.2, pr[2]);
    const c = st.surfaceCenter;
    // On the face of the carved section, below the near edge, so it never hides the holding.
    faceEye(this.nearCaption, c[0], c[1] - 0.06, c[2] + st.footprint[1] / 2 + 0.012);
    const [primary, dock] = this.ghosts.children;
    faceEye(primary, pr[0], pr[1], pr[2]);
    faceEye(dock, d[0], d[1], d[2]);
  }

  private refreshInfo(): void {
    const s = this.settings;
    const old = this.infoMaterial.map;
    const nationName = s.nation === 'kwind-09' ? 'Kwind-09' : s.nation.charAt(0).toUpperCase() + s.nation.slice(1);
    this.infoMaterial.map = plateTexture([
      { text: 'DEVELOPMENT FIXTURE', size: 44, color: '#f0b860', weight: 700 },
      { text: 'Environment preview · not saved', size: 32, color: '#ece4d0' },
      { text: `${s.fixture} · ${nationName} · ${s.quality} · ${s.posture}${s.yaw ? ` · turned ${s.yaw}°` : ''}`, size: 30, color: '#c2baa8', weight: 500 },
    ], 1024, 330);
    this.infoMaterial.needsUpdate = true;
    old?.dispose();
  }

  /** World-space buttons write the component; update() applies it (one source of truth for scripts and hands). */
  private press(id: ButtonId): void {
    const e = this.stateEntity, s = this.settings;
    switch (id) {
      case 'fixture': e.setValue(H, 'fixture', ENVIRONMENT_FIXTURE_IDS[(ENVIRONMENT_FIXTURE_IDS.indexOf(s.fixture) + 1) % ENVIRONMENT_FIXTURE_IDS.length]); break;
      case 'nation': e.setValue(H, 'nation', NATIONS[(NATIONS.indexOf(s.nation) + 1) % NATIONS.length]); break;
      case 'posture': e.setValue(H, 'posture', s.posture === 'seated' ? 'standing' : 'seated'); break;
      case 'quality': e.setValue(H, 'quality', QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length]); break;
      case 'turn-left': e.setValue(H, 'yaw', Math.max(-45, s.yaw - 15)); break;
      case 'turn-right': e.setValue(H, 'yaw', Math.min(45, s.yaw + 15)); break;
      case 'recenter': this.recenter(); break;
      case 'panels': e.setValue(H, 'panels', !s.panels); break;
    }
  }

  update(delta: number, time: number): void {
    const env = this.env;
    if (env) env.update(delta, time);
    const e = this.stateEntity;
    if (!e) return;
    const s = this.settings;
    const nation = e.getValue(H, 'nation') as string, fixture = e.getValue(H, 'fixture') as string;
    if ((nation !== s.nation && NATIONS.indexOf(nation as NationId) >= 0) || (fixture !== s.fixture && ENVIRONMENT_FIXTURE_IDS.indexOf(fixture as EnvironmentFixtureId) >= 0)) {
      if (NATIONS.indexOf(nation as NationId) >= 0) s.nation = nation as NationId;
      if (ENVIRONMENT_FIXTURE_IDS.indexOf(fixture as EnvironmentFixtureId) >= 0) s.fixture = fixture as EnvironmentFixtureId;
      env?.setState(environmentFixture(s.fixture, s.nation));
      this.setFocus(null);
      this.refreshInfo();
      if (!this.presenting) this.frameBrowser();
    }
    const quality = e.getValue(H, 'quality') as string;
    if (quality !== s.quality && QUALITIES.indexOf(quality as QuestEnvironmentQuality) >= 0) {
      s.quality = quality as QuestEnvironmentQuality;
      env?.setQuality(s.quality);
      this.world.renderer.xr.setFoveation({ low: 1, medium: 0.5, high: 0 }[s.quality]);
      this.refreshInfo();
    }
    const posture = e.getValue(H, 'posture') as string;
    if (posture !== s.posture && (posture === 'seated' || posture === 'standing')) {
      s.posture = posture;
      env?.setPosture(posture);
      this.placeUi();
      this.refreshInfo();
      if (!this.presenting) this.frameBrowser();
    }
    const yaw = e.getValue(H, 'yaw') as number;
    if (yaw !== s.yaw && env) {
      s.yaw = Math.max(-45, Math.min(45, Math.round(yaw / 15) * 15));
      void env.setMiniatureYaw(s.yaw).then(() => {
        this.placeUi();
        this.refreshInfo();
      });
    }
    const panels = e.getValue(H, 'panels') as boolean;
    if (panels !== s.panels) {
      s.panels = panels;
      this.ghosts.visible = panels;
    }
    const reduced = e.getValue(H, 'reducedMotion') as boolean;
    if (reduced !== s.reducedMotion) {
      s.reducedMotion = reduced;
      env?.setReducedMotion(reduced);
    }
    const paused = e.getValue(H, 'paused') as boolean;
    if (paused !== s.paused) {
      s.paused = paused;
      env?.setPaused(paused);
    }
    const seq = e.getValue(H, 'commandSeq') as number;
    if (seq !== this.lastSeq) {
      this.lastSeq = seq;
      this.run(e.getValue(H, 'command') as string);
      e.setValue(H, 'handledSeq', seq);
    }
  }

  private run(command: string): void {
    const env = this.env;
    if (command === 'recenter') this.recenter();
    else if (command.indexOf('focus:') === 0) this.setFocus((command.slice(6) || null) as LandmarkId | null);
    else if (command.indexOf('highlight:') === 0) env?.highlightLandmark((command.slice(10) || null) as LandmarkId | null);
    else if (command === 'stats' && env) this.report(env);
  }

  /** Writes the environment's diagnostics and world-space targets (pawn stand, landmarks) for scripts. */
  private report(env: QuestBannerholdEnvironment): void {
    const debug = env.debugInfo();
    const staging = env.getStaging();
    const f = debug.frame;
    const toWorld = (x: number, y: number, z: number): number[] => {
      this.world3.set(x, y, z);
      this.anchor.localToWorld(this.world3);
      return [+this.world3.x.toFixed(4), +this.world3.y.toFixed(4), +this.world3.z.toFixed(4)];
    };
    const targets: Record<string, number[]> = {};
    if (f) {
      const bp = getBannerholdBlueprint(this.settings.nation);
      const pawn = bp.muster.pawnStand.position;
      blueprintToAnchor(f, pawn[0], pawn[1] + 1.1, pawn[2], this.tmp);
      targets.pawnChest = toWorld(this.tmp[0], this.tmp[1], this.tmp[2]);
      for (const l of staging.landmarks) targets[l.id] = toWorld(l.position[0], l.position[1], l.position[2]);
      targets.surfaceCenter = toWorld(staging.surfaceCenter[0], staging.surfaceCenter[1], staging.surfaceCenter[2]);
      targets.anchor = toWorld(0, 0, 0);
    }
    this.stateEntity.setValue(H, 'report', JSON.stringify({ debug, staging, stats: env.getStats(), targets, settings: this.settings }));
  }
}

/** Seam (docs/legacy/WORKFLOWS.md): src/index.ts calls this when the URL has ?legacyEnvironment. */
export function registerLegacyEnvironmentHarness(world: World): void {
  world.registerComponent(H);
  world.registerSystem(LegacyEnvironmentHarnessSystem);
}
