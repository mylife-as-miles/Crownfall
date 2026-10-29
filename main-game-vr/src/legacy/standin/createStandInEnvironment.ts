// Gameplay's stand-in for the Quest Bannerhold (docs/legacy/WORKFLOWS.md): a small,
// neutral diorama base with labelled landmark markers and a visible
// "Environment stand-in" caption. It exists so the Legacy flows stay usable and
// testable until the environment workflow's Bannerhold is present; it makes no
// claim to be the authored world. It implements the same QuestLegacyEnvironment
// contract, reads only LegacySceneState, and reports landmark hover/select from
// ray- and poke-interactable proxies.

import {
  BoxGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, PokeInteractable, RayInteractable, RingGeometry, Shape, SphereGeometry,
  Vector2,
} from '@iwsdk/core';
import type { BufferGeometry, Entity, Material, Object3D, World } from '@iwsdk/core';
import { NATIONS } from '../../../../shared/legacy/content/nations';
import { LEGACY_COPY } from '../../../../shared/legacy/content/copy';
import { LEGACY_LANDMARKS, TINCTURE_SRGB } from '../../../../shared/legacy/environment-contract';
import type { LandmarkDescriptor, LegacyEnvironmentStats, LegacySceneState } from '../../../../shared/legacy/environment-contract';
import type { LandmarkId, NationId } from '../../../../shared/legacy/types';
import type {
  CreateQuestLegacyEnvironment, QuestEnvironmentQuality, QuestLegacyEnvironment, QuestLegacyEnvironmentOptions, QuestPosture,
  QuestStagingInfo,
} from '../environment-contract.js';
import { HeraldryTexture } from '../heraldry-texture.js';
import { legacyLandmarkTargetName } from '../legacy-ui-contract.js';
import { QUEST_LEGACY_COPY } from '../quest-legacy-copy.js';
import { DEFAULT_LEGACY_STAGING, STAND_IN_LANDMARK_OFFSETS } from '../legacy-staging.js';
import { drawPlacard } from './standin-labels.js';

/** Marker positions on the base (a staggered layout let the front marker capture rays aimed behind it). */
const LANDMARK_OFFSETS = STAND_IN_LANDMARK_OFFSETS;

const PLACARD_SIZE = [0.17, 0.0425] as const;
/** Height of the focus marker above the base, clear of the tallest marker (the hall's standard). */
const FOCUS_MARKER_HEIGHT = 0.21;
const PLINTH_NEUTRAL = new Color('#2a2520');
const PAWN_IVORY = new Color('#d8cfba');
/** Pick volumes hug the markers, so rays aimed past the holding at the reading panel clear them. */
const PROXY_SIZE = [0.2, 0.13, 0.16] as const;

interface LandmarkParts {
  id: LandmarkId;
  marker: Group;
  ring: Mesh;
  placard: Mesh;
  proxy: Mesh;
  proxyEntity: Entity;
  hovered: Set<number>;
  onEnter: (event: { pointerId: number }) => void;
  onLeave: (event: { pointerId: number }) => void;
  onClick: () => void;
}

function standard(color: string, roughness = 0.88, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
}

class StandInEnvironment implements QuestLegacyEnvironment {
  private readonly world: World;
  private readonly root = new Group();
  private readonly rootEntity: Entity;
  private readonly landmarks: LandmarkParts[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly plinthMaterial: MeshStandardMaterial;
  private readonly pawnMaterial: MeshStandardMaterial;
  private readonly hoverMaterial: MeshBasicMaterial;
  private readonly focusMaterial: MeshBasicMaterial;
  private readonly hallMarker: Group;
  private readonly flag: Mesh;
  private readonly flagTexture = new HeraldryTexture(96, 144, 'banner');
  private readonly pawn: Group;
  private readonly emptyPlace: Mesh;
  private readonly unreadMarker: Mesh;
  /** A gold marker above the landmark whose inspector is open, tying the panel to its place in the holding. */
  private readonly focusMarker: Mesh;
  private readonly caption: Mesh;
  private readonly staging: QuestStagingInfo;
  private readonly descriptors: LandmarkDescriptor[];
  private readonly frameTimes = new Float32Array(120);
  private frameCursor = 0;
  private frameCount = 0;
  private nationId: NationId | null = null;
  private posture: QuestPosture;
  private reducedMotion: boolean;
  private paused = false;
  private visible = true;
  private interactive = false;
  private highlighted: LandmarkId | null = null;
  private focused: LandmarkId | null = null;
  private hoveredLandmark: LandmarkId | null = null;
  private disposed = false;
  private readonly onHover: (id: LandmarkId | null) => void;
  private readonly onSelect: (id: LandmarkId) => void;
  // Mutable staging vectors, rewritten in place when the posture changes.
  private readonly surfaceCenter: [number, number, number] = [0, 0, 0];
  private readonly landmarkPositions: { id: LandmarkId; position: [number, number, number] }[];

  constructor(options: QuestLegacyEnvironmentOptions) {
    this.world = options.world;
    this.posture = options.posture;
    this.reducedMotion = options.reducedMotion;
    this.onHover = options.onLandmarkHover;
    this.onSelect = options.onLandmarkSelect;
    this.root.name = 'Legacy Environment Stand-in';
    this.landmarkPositions = LEGACY_LANDMARKS.map((id) => ({ id, position: [0, 0, 0] }));
    this.staging = {
      scale: DEFAULT_LEGACY_STAGING.scale,
      footprint: DEFAULT_LEGACY_STAGING.footprint,
      surfaceCenter: this.surfaceCenter,
      panelAnchors: DEFAULT_LEGACY_STAGING.panelAnchors,
      landmarks: this.landmarkPositions,
    };
    this.descriptors = LEGACY_LANDMARKS.map((id) => {
      const offset = LANDMARK_OFFSETS[id];
      const scale = DEFAULT_LEGACY_STAGING.scale;
      return { id, label: LEGACY_COPY.landmarks[id].title, position: [offset[0] / scale, offset[1] / scale, offset[2] / scale] as const };
    });

    const [width, depth] = DEFAULT_LEGACY_STAGING.footprint;
    const baseMaterial = this.own(standard('#5f584d', 0.94));
    this.plinthMaterial = this.own(standard('#2a2520', 0.9));
    const base = new Mesh(this.geometry(new BoxGeometry(width, 0.04, depth)), baseMaterial);
    base.position.y = -0.02;
    const plinth = new Mesh(this.geometry(new BoxGeometry(width + 0.03, 0.03, depth + 0.03)), this.plinthMaterial);
    plinth.position.y = -0.055;
    this.root.add(base, plinth);

    this.hoverMaterial = this.own(new MeshBasicMaterial({ color: new Color('#e0a03c'), transparent: true, opacity: 0.55, depthWrite: false }));
    this.focusMaterial = this.own(new MeshBasicMaterial({ color: new Color('#ffd27a'), transparent: true, opacity: 0.9, depthWrite: false }));
    this.pawnMaterial = this.own(standard('#d8cfba', 0.6));
    const ringGeometry = this.geometry(new RingGeometry(0.078, 0.092, 48));
    const proxyGeometry = this.geometry(new BoxGeometry(PROXY_SIZE[0], PROXY_SIZE[1], PROXY_SIZE[2]));
    const proxyMaterial = this.own(new MeshBasicMaterial({ visible: false }));
    const placardGeometry = this.geometry(new PlaneGeometry(PLACARD_SIZE[0], PLACARD_SIZE[1]));

    const markers = this.buildMarkers();
    this.hallMarker = markers.hall;
    this.flag = markers.flag;
    this.pawn = markers.pawn;
    this.emptyPlace = markers.emptyPlace;
    this.unreadMarker = markers.unread;

    this.rootEntity = this.world.createTransformEntity(this.root, { parent: options.parent });
    for (const id of LEGACY_LANDMARKS) {
      const offset = LANDMARK_OFFSETS[id];
      const marker = markers.byId[id];
      marker.position.set(offset[0], 0, offset[2]);
      const ring = new Mesh(ringGeometry, this.hoverMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(offset[0], 0.003, offset[2]);
      ring.visible = false;
      const placardMaterial = this.own(new MeshBasicMaterial({
        map: drawPlacard({ title: LEGACY_COPY.landmarks[id].title }, 512, 128), transparent: true, side: DoubleSide,
      }));
      const placard = new Mesh(placardGeometry, placardMaterial);
      // Raised so the placard, tilted back to face the eye, never sinks into the base.
      placard.position.set(offset[0], 0.022, offset[2] + 0.085);
      this.root.add(marker, ring, placard);
      const proxy = new Mesh(proxyGeometry, proxyMaterial);
      proxy.name = legacyLandmarkTargetName(id);
      proxy.position.set(offset[0], PROXY_SIZE[1] / 2, offset[2] + 0.02);
      const proxyEntity = this.world.createTransformEntity(proxy, { parent: this.rootEntity });
      const parts: LandmarkParts = {
        id, marker, ring, placard, proxy, proxyEntity, hovered: new Set<number>(),
        onEnter: (event) => { parts.hovered.add(event.pointerId); this.updateHover(); },
        onLeave: (event) => { parts.hovered.delete(event.pointerId); this.updateHover(); },
        onClick: () => { if (this.visible && !this.paused) this.onSelect(id); },
      };
      proxy.addEventListener('pointerenter', parts.onEnter as never);
      proxy.addEventListener('pointerleave', parts.onLeave as never);
      proxy.addEventListener('click', parts.onClick as never);
      this.landmarks.push(parts);
    }

    const captionMaterial = this.own(new MeshBasicMaterial({
      map: drawPlacard({ title: QUEST_LEGACY_COPY.environment.standin, subtitle: QUEST_LEGACY_COPY.environment.standinNote }, 1024, 256),
      transparent: true, side: DoubleSide,
    }));
    const markerGeometry = this.geometry(new ConeGeometry(0.018, 0.04, 4));
    markerGeometry.rotateX(Math.PI);
    this.focusMarker = new Mesh(markerGeometry, this.focusMaterial);
    this.focusMarker.name = 'Legacy Stand-in Focus Marker';
    this.focusMarker.visible = false;
    this.root.add(this.focusMarker);

    this.caption = new Mesh(this.geometry(new PlaneGeometry(0.36, 0.09)), captionMaterial);
    this.caption.name = 'Legacy Stand-in Caption';
    this.caption.position.set(0, 0.045, 0.215);
    this.root.add(this.caption);

    this.setInteractive(true);
    this.applyPosture();
    this.setState(options.state);
  }

  private own<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** Plain, readable markers: a hall with its standard, a parade square with the named Pawn, a ledger table and a herald's post. */
  private buildMarkers(): { byId: Record<LandmarkId, Group>; hall: Group; flag: Mesh; pawn: Group; emptyPlace: Mesh; unread: Mesh } {
    const stone = this.own(standard('#8a8070'));
    const timber = this.own(standard('#5a4532'));
    const roofMaterial = this.own(standard('#3b3029'));
    const parchment = this.own(standard('#d9ccab', 0.95));
    const ground = this.own(standard('#6d6556', 0.96));
    const iron = this.own(standard('#3a3a3c', 0.55, 0.4));
    const glow = this.own(new MeshStandardMaterial({ color: new Color('#e0a03c'), emissive: new Color('#c07a20'), emissiveIntensity: 1.2, roughness: 0.4 }));

    const hall = new Group();
    const body = new Mesh(this.geometry(new BoxGeometry(0.15, 0.075, 0.095)), stone);
    body.position.y = 0.0375;
    const gable = new Shape([new Vector2(-0.082, 0), new Vector2(0.082, 0), new Vector2(0, 0.048)]);
    const roofGeometry = this.geometry(new ExtrudeGeometry(gable, { depth: 0.105, bevelEnabled: false }));
    roofGeometry.translate(0, 0, -0.0525);
    const roof = new Mesh(roofGeometry, roofMaterial);
    roof.position.y = 0.075;
    const door = new Mesh(this.geometry(new BoxGeometry(0.03, 0.045, 0.004)), timber);
    door.position.set(0, 0.0225, 0.0495);
    // Kept low enough that the standard never rises into the dock seen above the holding.
    const pole = new Mesh(this.geometry(new CylinderGeometry(0.003, 0.003, 0.17, 8)), iron);
    pole.position.set(0.1, 0.085, 0.03);
    const flagMaterial = this.own(new MeshStandardMaterial({ map: this.flagTexture.texture, transparent: true, alphaTest: 0.2, side: DoubleSide, roughness: 0.9 }));
    const flag = new Mesh(this.geometry(new PlaneGeometry(0.06, 0.09)), flagMaterial);
    flag.position.set(0.1 + 0.033, 0.125, 0.03);
    hall.add(body, roof, door, pole, flag);

    const muster = new Group();
    const square = new Mesh(this.geometry(new BoxGeometry(0.17, 0.006, 0.13)), ground);
    square.position.y = 0.003;
    const pawn = new Group();
    const profile = [
      new Vector2(0, 0), new Vector2(0.02, 0), new Vector2(0.02, 0.006), new Vector2(0.013, 0.012), new Vector2(0.009, 0.034),
      new Vector2(0.013, 0.04), new Vector2(0.007, 0.045), new Vector2(0, 0.045),
    ];
    const pawnBody = new Mesh(this.geometry(new LatheGeometry(profile, 20)), this.pawnMaterial);
    const pawnHead = new Mesh(this.geometry(new SphereGeometry(0.012, 16, 12)), this.pawnMaterial);
    pawnHead.position.y = 0.055;
    pawn.add(pawnBody, pawnHead);
    pawn.position.y = 0.006;
    const emptyPlace = new Mesh(this.geometry(new RingGeometry(0.016, 0.024, 32)), this.own(new MeshBasicMaterial({ color: new Color('#16120d') })));
    emptyPlace.rotation.x = -Math.PI / 2;
    emptyPlace.position.y = 0.0065;
    emptyPlace.visible = false;
    muster.add(square, pawn, emptyPlace);

    const record = new Group();
    const table = new Mesh(this.geometry(new BoxGeometry(0.12, 0.05, 0.075)), timber);
    table.position.y = 0.025;
    const ledger = new Mesh(this.geometry(new BoxGeometry(0.09, 0.006, 0.06)), parchment);
    ledger.position.y = 0.053;
    ledger.rotation.x = -0.12;
    record.add(table, ledger);

    const herald = new Group();
    const post = new Mesh(this.geometry(new CylinderGeometry(0.005, 0.006, 0.13, 10)), timber);
    post.position.y = 0.065;
    const board = new Mesh(this.geometry(new BoxGeometry(0.085, 0.055, 0.006)), parchment);
    board.position.set(0, 0.1, 0.008);
    const unread = new Mesh(this.geometry(new OctahedronGeometry(0.011)), glow);
    unread.position.set(0, 0.15, 0.008);
    unread.visible = false;
    herald.add(post, board, unread);

    return {
      byId: { 'banner-hall': hall, 'muster-grounds': muster, 'war-record': record, 'heralds-station': herald },
      hall, flag, pawn, emptyPlace, unread,
    };
  }

  private updateHover(): void {
    let next: LandmarkId | null = null;
    for (const parts of this.landmarks) if (parts.hovered.size > 0) next = parts.id;
    if (next === this.hoveredLandmark) return;
    this.hoveredLandmark = next;
    this.applyEmphasis();
    this.onHover(next);
  }

  /** Recomputes anchor-space staging for the posture and turns placards toward the viewer's eye. */
  private applyPosture(): void {
    const height = DEFAULT_LEGACY_STAGING.surfaceHeight[this.posture];
    this.surfaceCenter[0] = 0;
    this.surfaceCenter[1] = height;
    this.surfaceCenter[2] = DEFAULT_LEGACY_STAGING.surfaceDepth;
    this.root.position.set(0, height, DEFAULT_LEGACY_STAGING.surfaceDepth);
    for (const entry of this.landmarkPositions) {
      const offset = LANDMARK_OFFSETS[entry.id];
      entry.position[0] = offset[0];
      entry.position[1] = height + offset[1];
      entry.position[2] = DEFAULT_LEGACY_STAGING.surfaceDepth + offset[2];
    }
    // The eye is the anchor origin, i.e. -root.position in root space (the root is not rotated).
    const eyeX = -this.root.position.x, eyeY = -this.root.position.y, eyeZ = -this.root.position.z;
    // A plane faces +Z: yaw toward the eye, then tilt so its face looks up at it.
    const face = (object: Object3D): void => {
      const dx = eyeX - object.position.x, dy = eyeY - object.position.y, dz = eyeZ - object.position.z;
      object.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
    };
    for (const parts of this.landmarks) face(parts.placard);
    face(this.caption);
  }

  setState(state: LegacySceneState): void {
    if (this.disposed) return;
    if (state.nationId !== this.nationId) {
      this.nationId = state.nationId;
      // The base stays neutral; only the plinth carries a hint of the nation's palette.
      this.plinthMaterial.color.set(NATIONS[state.nationId].palette.primary).lerp(PLINTH_NEUTRAL, 0.35);
    }
    const heraldry = state.heraldry;
    this.flag.visible = heraldry !== null;
    if (heraldry) {
      this.flagTexture.show(heraldry);
      this.pawnMaterial.color.set(TINCTURE_SRGB[heraldry.field[0]]).lerp(PAWN_IVORY, 0.55);
    } else {
      this.pawnMaterial.color.copy(PAWN_IVORY);
    }
    this.hallMarker.scale.setScalar(1 + state.hallTier * 0.08);
    const representative = state.representative;
    const captive = representative !== null && representative.status === 'captive';
    this.pawn.visible = representative !== null && !captive;
    this.emptyPlace.visible = captive;
    // An injured representative rests on their side in the holding.
    this.pawn.rotation.z = representative !== null && representative.status === 'injured' ? Math.PI / 2.3 : 0;
    this.pawn.position.y = representative !== null && representative.status === 'injured' ? 0.018 : 0.006;
    this.unreadMarker.visible = state.unreadNotices > 0;
  }

  focusLandmark(id: LandmarkId | null): void {
    if (this.focused === id) return;
    this.focused = id;
    this.applyEmphasis();
  }

  highlightLandmark(id: LandmarkId | null): void {
    if (this.highlighted === id) return;
    this.highlighted = id;
    this.applyEmphasis();
  }

  /** Focus wins over hover; a landmark pointed at in the world or in the panel list is emphasised the same way. */
  private applyEmphasis(): void {
    for (const parts of this.landmarks) {
      const focused = parts.id === this.focused;
      const hovered = parts.id === this.highlighted || parts.id === this.hoveredLandmark;
      parts.ring.visible = focused || hovered;
      parts.ring.material = focused ? this.focusMaterial : this.hoverMaterial;
      if (!focused) parts.ring.scale.setScalar(1);
    }
    const offset = this.focused ? LANDMARK_OFFSETS[this.focused] : null;
    this.focusMarker.visible = offset !== null;
    if (offset) this.focusMarker.position.set(offset[0], FOCUS_MARKER_HEIGHT, offset[2]);
  }

  getLandmarks(): readonly LandmarkDescriptor[] {
    return this.descriptors;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  getStats(): LegacyEnvironmentStats {
    let triangles = 0;
    let drawCalls = 0;
    this.root.traverseVisible((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as Material;
      if (!material.visible) return;
      const geometry = mesh.geometry;
      const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      triangles += count / 3;
      drawCalls += 1;
    });
    let textures = 0;
    for (const material of this.materials) if ((material as MeshBasicMaterial).map) textures += 1;
    const frames = Math.min(this.frameCount, this.frameTimes.length);
    const frameTimesMs: number[] = [];
    for (let index = 0; index < frames; index++) {
      frameTimesMs.push(this.frameTimes[(this.frameCursor - frames + index + this.frameTimes.length) % this.frameTimes.length]);
    }
    return { triangles: Math.round(triangles), drawCalls, geometries: this.geometries.length, textures, frameTimesMs };
  }

  update(delta: number, time: number): void {
    if (!this.visible || this.disposed) return;
    this.frameTimes[this.frameCursor] = delta * 1000;
    this.frameCursor = (this.frameCursor + 1) % this.frameTimes.length;
    this.frameCount += 1;
    if (this.paused || this.reducedMotion) return;
    if (this.focused) {
      // An indexed loop: no iterator object even before the function is optimised.
      for (let index = 0; index < this.landmarks.length; index++) {
        const parts = this.landmarks[index];
        if (parts.id === this.focused) parts.ring.scale.setScalar(1 + Math.sin(time * 2.4) * 0.05);
      }
    }
    if (this.unreadMarker.visible) {
      this.unreadMarker.rotation.y = time * 1.2;
      this.unreadMarker.position.y = 0.15 + Math.sin(time * 1.8) * 0.006;
    }
    if (this.focusMarker.visible) {
      this.focusMarker.rotation.y = time * 0.9;
      this.focusMarker.position.y = FOCUS_MARKER_HEIGHT + Math.sin(time * 2.1) * 0.008;
    }
  }

  setQuality(_quality: QuestEnvironmentQuality): void {
    // The stand-in is already minimal (about twenty draw calls), so every quality renders it the same way.
  }

  setPosture(posture: QuestPosture): void {
    if (this.posture === posture) return;
    this.posture = posture;
    this.applyPosture();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      for (const parts of this.landmarks) parts.ring.scale.setScalar(1);
      this.unreadMarker.rotation.y = 0;
      this.unreadMarker.position.y = 0.15;
      this.focusMarker.rotation.y = 0;
      this.focusMarker.position.y = FOCUS_MARKER_HEIGHT;
    }
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.visible = visible;
    this.setInteractive(visible);
    if (!visible) {
      for (const parts of this.landmarks) parts.hovered.clear();
      this.updateHover();
    }
  }

  /** Hidden proxies also leave the interactable lists, so no hover or press survives a hide. */
  private setInteractive(interactive: boolean): void {
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    for (const parts of this.landmarks) {
      if (interactive) parts.proxyEntity.addComponent(RayInteractable).addComponent(PokeInteractable);
      else parts.proxyEntity.removeComponent(RayInteractable).removeComponent(PokeInteractable);
    }
  }

  getStaging(): QuestStagingInfo {
    return this.staging;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const parts of this.landmarks) {
      parts.proxy.removeEventListener('pointerenter', parts.onEnter as never);
      parts.proxy.removeEventListener('pointerleave', parts.onLeave as never);
      parts.proxy.removeEventListener('click', parts.onClick as never);
      parts.proxyEntity.dispose();
    }
    this.landmarks.length = 0;
    this.rootEntity.dispose();
    // Shared geometries and materials may have been released by the entity already; dispose is idempotent.
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) {
      const map = (material as MeshBasicMaterial).map;
      if (map && map !== this.flagTexture.texture) map.dispose();
      material.dispose();
    }
    this.flagTexture.dispose();
  }
}

export const createStandInEnvironment: CreateQuestLegacyEnvironment = async (options) => new StandInEnvironment(options);
