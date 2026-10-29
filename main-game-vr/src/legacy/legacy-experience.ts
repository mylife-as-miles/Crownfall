// The Quest My Legacy destination: binds the generated Legacy panels to the
// shared Legacy domain, keeps the session and saves, owns the Legacy anchor and
// panel staging, and drives the environment strictly through the Quest
// environment contract. The Home menu system owns navigation (QuestState) and
// tells this experience when My Legacy is shown, paused or left.

import { PokeInteractable, RayInteractable } from '@iwsdk/core';
import type { Entity, Object3D, UIKit, UIKitMLAsset, Vector3, World } from '@iwsdk/core';
import { HERALDRY_PRESETS, describeHeraldry } from '../../../shared/legacy/content/heraldry';
import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import { FILES } from '../../../shared/legacy/content/muster';
import { NATION_ORDER, defaultLegacyNation, isNationFoundable } from '../../../shared/legacy/content/nations';
import { prominentAftermath } from '../../../shared/legacy/domain/aftermath';
import { openChallenge } from '../../../shared/legacy/domain/notices';
import { clearLegacy, resolveLegacySession, saveLegacy } from '../../../shared/legacy/domain/persistence';
import type { LegacySession, LegacyStorageLike } from '../../../shared/legacy/domain/persistence';
import { presentBannerhold, presentFoundingDraft } from '../../../shared/legacy/domain/presentation';
import { reduceLegacy } from '../../../shared/legacy/domain/reducer';
import { createLegacyState, findMember } from '../../../shared/legacy/domain/state';
import { LEGACY_LANDMARKS } from '../../../shared/legacy/environment-contract';
import type { LegacyEnvironmentStats, LegacySceneState } from '../../../shared/legacy/environment-contract';
import type { LandmarkId, LegacyEvent, LegacyState } from '../../../shared/legacy/types';
import { CrownfallQuestState } from '../quest-components.js';
import type { QuestEnvironmentQuality, QuestLegacyEnvironment, QuestPosture } from './environment-contract.js';
import { provideQuestLegacyEnvironment } from './environment-provider.js';
import { installLegacyDiagnostics } from './legacy-diagnostics.js';
import type { QuestEnvironmentSource } from './environment-provider.js';
import { HeraldryTexture } from './heraldry-texture.js';
import { legacyButtonStyle, legacyButtonStyleKey } from './legacy-button-style.js';
import type { LegacyButtonVariant } from './legacy-button-style.js';
import {
  acceptsLandmarkSelection, createLegacyFlow, isFoundingView, landmarkOfView, reduceLegacyFlow, suggestionSlots,
} from './legacy-flow.js';
import type { LegacyFlowEvent, LegacyFlowState } from './legacy-flow.js';
import { LEGACY_PANEL_METRES, fallbackLegacyStaging } from './legacy-staging.js';
import { browserLegacyStorage } from './legacy-storage.js';
import {
  LEGACY_DOCK_ACTION_IDS, LEGACY_HERALDRY_IMAGE_IDS, LEGACY_HERALDRY_PARTS, LEGACY_HERALDRY_RASTER, LEGACY_KEY_ACTIONS, LEGACY_KEY_ROWS, LEGACY_LIVE_TEXT,
  LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE, LEGACY_RECORD_PAGE, LEGACY_SCENE_NODES, LEGACY_SUGGESTION_SLOTS, LEGACY_UI_LAYOUT, LEGACY_VIEW_IDS,
  legacyFileId, legacyKeyActionId, legacyKeyId, legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId,
} from './legacy-ui-contract.js';
import type { LegacyViewId } from './legacy-ui-contract.js';
import { buildLegacyDockModel, buildLegacyPanelModel, noticesNewestFirst } from './legacy-view-model.js';
import type { LegacyControlState, LegacyModelInput, LegacySessionInfo } from './legacy-view-model.js';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy.js';
import { spatialText } from './spatial-text.js';

/** Navigation the Home menu system performs on behalf of My Legacy. */
export interface LegacyHostActions {
  home(): void;
  pause(): void;
  resume(): void;
  exit(): void;
  recenter(): void;
}

/** What the Home menu system reports on every render. */
export interface LegacyHostStatus {
  /** My Legacy is the current place, including while it is paused. */
  active: boolean;
  paused: boolean;
  pauseReason: string;
  entered: boolean;
  handTracked: boolean;
}

export interface LegacyComfort {
  quality: QuestEnvironmentQuality;
  posture: QuestPosture;
  textScale: number;
  reducedMotion: boolean;
}

/** Controls that show a selected state; all use the standard button surface. */
const SELECTABLE_PREFIXES = ['Legacy_Nation_', 'Legacy_Suggestion_', 'Legacy_Preset_', 'Legacy_Member_', 'Legacy_File_', 'Legacy_Landmark_', 'Legacy_Key_Shift'];
/** Generated control classes and the look each one starts from. */
const BUTTON_CLASSES: ReadonlyArray<readonly [string, LegacyButtonVariant]> = [['lg-btn', 'button'], ['lg-btn-primary', 'primary'], ['lg-btn-danger', 'danger']];

function nowIso(): string {
  return new Date().toISOString();
}

function freshSeed(): number {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
  } catch {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
}

/** Turns a panel at anchor-space position p to face the anchor origin (the viewer's eye). */
function faceEye(object: Object3D, x: number, y: number, z: number): void {
  object.position.set(x, y, z);
  object.rotation.set(Math.atan2(y, Math.hypot(x, z)), Math.atan2(-x, -z), 0, 'YXZ');
}

export class QuestLegacyExperience {
  private readonly anchorEntity: Entity;
  private readonly anchor: Object3D;
  private readonly panelEntity: Entity;
  private readonly panelObject: Object3D;
  private readonly panel: UIKitMLAsset;
  private readonly dockEntity: Entity;
  private readonly dockObject: Object3D;
  private readonly dock: UIKitMLAsset;
  private readonly elements = new Map<string, UIKit.Text>();
  private readonly textCache = new Map<string, string>();
  private readonly displayCache = new Map<string, boolean>();
  private readonly styleCache = new Map<string, string>();
  private readonly positionCache = new Map<string, number>();
  private readonly controlStates = new Map<string, LegacyControlState>();
  /** Controls the pointer is over, from each control's onHoverChange. */
  private readonly hovered = new Set<string>();
  /** Generated control containers by visual variant, read once from their classes. */
  private readonly buttonVariants = new Map<object, LegacyButtonVariant>();
  private readonly heraldry = new HeraldryTexture(LEGACY_HERALDRY_RASTER.width, LEGACY_HERALDRY_RASTER.height);
  private readonly cleanup: (() => void)[] = [];
  private session: LegacySession | null = null;
  private storage: LegacyStorageLike | null = null;
  private state: LegacyState = createLegacyState();
  private flow: LegacyFlowState = createLegacyFlow(defaultLegacyNation());
  private environment: QuestLegacyEnvironment | null = null;
  private environmentSource: QuestEnvironmentSource | null = null;
  private environmentFellBack = false;
  private environmentRequested = false;
  private interactive = true;
  private status: LegacyHostStatus = { active: false, paused: false, pauseReason: '', entered: false, handTracked: false };
  private comfort: LegacyComfort = { quality: 'medium', posture: 'seated', textScale: 100, reducedMotion: false };
  private activeView: LegacyViewId | null = null;
  private focused: LandmarkId | null = null;
  private highlighted: LandmarkId | null = null;
  private worldHover: LandmarkId | null = null;
  private listHover: LandmarkId | null = null;
  private selectSource: 'world' | 'list' | '' = '';
  private message = '';
  private saveStatus: 'saved' | 'failed' | 'none' = 'none';
  private savedOnce = false;
  private recenters = 0;
  private sceneDirty = true;
  private disposed = false;
  private readonly sessionLabel: HTMLElement | null;

  constructor(private readonly world: World, private readonly stateEntity: Entity, private readonly actions: LegacyHostActions) {
    this.anchorEntity = world.requireSceneEntity(LEGACY_SCENE_NODES.anchor);
    this.anchor = this.anchorEntity.object3D!;
    this.panelEntity = world.requireSceneEntity(LEGACY_SCENE_NODES.panel);
    this.panelObject = this.panelEntity.object3D!;
    this.panel = world.requireSceneObject<UIKitMLAsset>(LEGACY_SCENE_NODES.panel);
    this.dockEntity = world.requireSceneEntity(LEGACY_SCENE_NODES.dock);
    this.dockObject = this.dockEntity.object3D!;
    this.dock = world.requireSceneObject<UIKitMLAsset>(LEGACY_SCENE_NODES.dock);
    // Hidden until Home opens My Legacy; hidden panels also leave the pointer target lists.
    this.anchor.visible = false;
    this.setInteractive(false);
    for (const id of LEGACY_HERALDRY_IMAGE_IDS) this.panel.requireElementById<UIKit.Image>(id).setProperties({ src: this.heraldry.texture });
    // Live texts arrive with a placeholder so UIKitML gives them a text node; clear them before first display.
    for (const owner of [this.panel, this.dock]) {
      for (const element of owner.document.getElementsByClassName(LEGACY_LIVE_TEXT.className)) element.setProperties({ text: '' });
      for (const [className, variant] of BUTTON_CLASSES) {
        for (const element of owner.document.getElementsByClassName(className)) this.buttonVariants.set(element, variant);
      }
    }
    this.bindControls();
    this.sessionLabel = this.createBrowserLabel();
    this.stagePanels();
    if (import.meta.env.DEV) this.cleanup.push(installLegacyDiagnostics(this));
  }

  private element(id: string): UIKit.Text {
    let element = this.elements.get(id);
    if (!element) {
      const owner = id.startsWith('Legacy_Dock') || id === 'LegacyDock_Root' ? this.dock : this.panel;
      element = owner.requireElementById<UIKit.Text>(id);
      element.name = id;
      this.elements.set(id, element);
    }
    return element;
  }

  /** Binds a control. Hidden, disabled or paused-behind controls ignore activation. */
  private bind(id: string, activate: () => void, onHover?: (hover: boolean) => void): void {
    const element = this.element(id);
    const click = (): void => {
      if (!this.status.active || this.disposed) return;
      const state = this.controlStates.get(id);
      if (state && (!state.visible || !state.enabled)) return;
      if (this.status.paused && id !== 'Legacy_Resume' && id !== 'Legacy_PauseHome' && id !== 'Legacy_DockRecenter' && id !== 'Legacy_DockExit') return;
      activate();
    };
    const onHoverChange = (hover: boolean): void => {
      if (hover) this.hovered.add(id);
      else this.hovered.delete(id);
      const state = this.controlStates.get(id);
      if (state) this.styleControl(id, state);
      onHover?.(hover);
    };
    element.addEventListener('click', click);
    element.setProperties({ onHoverChange });
    this.cleanup.push(() => {
      element.removeEventListener('click', click);
      element.setProperties({ onHoverChange: undefined });
    });
  }

  private flowEvent(event: LegacyFlowEvent): () => void {
    return () => { this.message = ''; this.dispatchFlow(event); };
  }

  private bindControls(): void {
    this.bind('Legacy_RecoveryHome', () => this.actions.home());
    this.bind('Legacy_RecoveryGuest', () => {
      this.session = { kind: 'guest', persistent: false, state: createLegacyState({ at: nowIso() }), label: LEGACY_COPY.guest.label };
      this.state = this.session.state;
      this.updateBrowserLabel();
      this.beginFounding();
    });
    this.bind('Legacy_RecoveryNew', () => this.beginFounding());
    for (const nationId of NATION_ORDER) this.bind(legacyNationId(nationId), this.flowEvent({ type: 'choose-nation', nationId }));
    this.bind('Legacy_FoundingHome', () => this.actions.home());
    this.bind('Legacy_NationNext', this.flowEvent({ type: 'founding-step', view: 'name' }));
    for (let index = 0; index < LEGACY_SUGGESTION_SLOTS; index++) {
      this.bind(`Legacy_Suggestion_${index}`, () => {
        const name = suggestionSlots(this.flow.draft)[index];
        if (name) { this.message = ''; this.dispatchFlow({ type: 'suggest', name }); }
      });
    }
    this.bind('Legacy_MoreNames', this.flowEvent({ type: 'more-names' }));
    this.bind('Legacy_OpenKeyboard', this.flowEvent({ type: 'open-keyboard' }));
    this.bind('Legacy_NameBack', this.flowEvent({ type: 'founding-step', view: 'nation' }));
    this.bind('Legacy_NameNext', this.flowEvent({ type: 'founding-step', view: 'arms' }));
    for (const key of LEGACY_KEY_ROWS.flat()) this.bind(legacyKeyId(key), this.flowEvent({ type: 'key', key }));
    for (const action of LEGACY_KEY_ACTIONS) this.bind(legacyKeyActionId(action), this.flowEvent({ type: 'key-action', action }));
    this.bind('Legacy_KeyboardCancel', this.flowEvent({ type: 'keyboard-cancel' }));
    this.bind('Legacy_KeyboardDone', this.flowEvent({ type: 'keyboard-done' }));
    for (let index = 0; index < 4; index++) {
      this.bind(`Legacy_Preset_${index}`, () => {
        const preset = HERALDRY_PRESETS[this.flow.draft.nationId][index];
        if (preset) { this.message = ''; this.dispatchFlow({ type: 'heraldry', heraldry: preset.heraldry }); }
      });
    }
    for (const part of LEGACY_HERALDRY_PARTS) {
      this.bind(legacyPartId(part), this.flowEvent({ type: 'cycle-part', part, step: 1 }));
      this.bind(legacyPartPreviousId(part), this.flowEvent({ type: 'cycle-part', part, step: -1 }));
    }
    this.bind('Legacy_ArmsBack', this.flowEvent({ type: 'founding-step', view: 'name' }));
    this.bind('Legacy_ArmsNext', this.flowEvent({ type: 'founding-step', view: 'confirm' }));
    this.bind('Legacy_ConfirmBack', this.flowEvent({ type: 'founding-step', view: 'arms' }));
    this.bind('Legacy_ConfirmRaise', () => this.raiseBanner());
    for (const landmark of LEGACY_LANDMARKS) {
      this.bind(legacyLandmarkButtonId(landmark), () => this.openLandmark(landmark, 'list'), (hover) => {
        if (hover) this.listHover = landmark;
        else if (this.listHover === landmark) this.listHover = null;
        this.render();
      });
    }
    this.bind('Legacy_AftermathDismiss', () => { this.message = ''; this.commit({ type: 'dismiss-aftermath' }); this.render(); });
    this.bind('Legacy_ResetOpen', this.flowEvent({ type: 'request-reset' }));
    this.bind('Legacy_ResetCancel', this.flowEvent({ type: 'cancel-reset' }));
    this.bind('Legacy_ResetConfirm', () => this.dissolveBanner());
    for (const id of ['Legacy_HallBack', 'Legacy_MusterBack', 'Legacy_RecordBack', 'Legacy_HeraldBack']) this.bind(id, this.flowEvent({ type: 'overview' }));
    for (let index = 0; index < LEGACY_MEMBER_SLOTS; index++) {
      this.bind(`Legacy_Member_${index}`, () => {
        const member = this.state.members[index];
        if (member) { this.message = ''; this.dispatchFlow({ type: 'select-member', memberId: member.id }); }
      });
    }
    for (const file of FILES) this.bind(legacyFileId(file), this.flowEvent({ type: 'select-file', file }));
    this.bind('Legacy_MusterNominate', () => this.nominate());
    const recordPages = (): number => Math.max(1, Math.ceil(this.state.chronicle.length / LEGACY_RECORD_PAGE));
    this.bind('Legacy_RecordPrev', () => this.dispatchFlow({ type: 'page', list: 'record', delta: -1, total: recordPages() }));
    this.bind('Legacy_RecordNext', () => this.dispatchFlow({ type: 'page', list: 'record', delta: 1, total: recordPages() }));
    const noticePages = (): number => Math.max(1, Math.ceil(this.state.notices.length / LEGACY_NOTICE_PAGE));
    this.bind('Legacy_HeraldPrev', () => this.dispatchFlow({ type: 'page', list: 'notices', delta: -1, total: noticePages() }));
    this.bind('Legacy_HeraldNext', () => this.dispatchFlow({ type: 'page', list: 'notices', delta: 1, total: noticePages() }));
    for (let index = 0; index < LEGACY_NOTICE_PAGE; index++) this.bind(`Legacy_Notice_${index}`, () => this.openNotice(index));
    this.bind('Legacy_NoticeBack', this.flowEvent({ type: 'notice-list' }));
    this.bind('Legacy_NoticeAccept', this.flowEvent({ type: 'request-accept' }));
    this.bind('Legacy_NoticeAwaiting', this.flowEvent({ type: 'show-awaiting' }));
    this.bind('Legacy_AcceptCancel', this.flowEvent({ type: 'cancel-accept' }));
    this.bind('Legacy_AcceptConfirm', () => this.acceptChallenge());
    this.bind('Legacy_AwaitingBack', this.flowEvent({ type: 'notice-list' }));
    this.bind('Legacy_Resume', () => this.actions.resume());
    this.bind('Legacy_PauseHome', () => this.actions.home());
    const dock: Record<typeof LEGACY_DOCK_ACTION_IDS[number], () => void> = {
      Legacy_DockHome: () => this.actions.home(),
      Legacy_DockRecenter: () => this.actions.recenter(),
      Legacy_DockPause: () => this.actions.pause(),
      Legacy_DockExit: () => this.actions.exit(),
    };
    for (const id of LEGACY_DOCK_ACTION_IDS) this.bind(id, dock[id]);
  }

  // ---------------------------------------------------------------- session and domain

  /** Resolves where this visit's banner comes from, once, on the first entry to My Legacy. */
  private ensureSession(): void {
    if (this.session) return;
    this.storage = browserLegacyStorage();
    const session = resolveLegacySession(window.location.search, this.storage, { at: nowIso() });
    this.session = session;
    this.state = session.state;
    this.sceneDirty = true;
    if (session.kind === 'recovery') this.dispatchFlow({ type: 'show', view: 'recovery' });
    else if (session.state.banner) this.dispatchFlow({ type: 'show', view: 'overview' });
    else this.beginFounding();
    if (session.kind === 'preview-missing' || session.kind === 'unavailable') this.message = session.error;
    this.updateBrowserLabel();
  }

  /** Saving is real only for a persistent session with working storage and a production state. */
  private canSave(): boolean {
    return !!this.session && this.session.persistent && this.storage !== null && this.state.mode === 'production';
  }

  private sessionInfo(): LegacySessionInfo {
    const session = this.session;
    const persistent = this.canSave();
    if (!session) return { kind: 'new', persistent, label: null, error: null, reason: null, title: null };
    switch (session.kind) {
      case 'guest': return { kind: 'guest', persistent: false, label: session.label, error: null, reason: null, title: null };
      case 'preview': return { kind: 'preview', persistent: false, label: session.label, error: null, reason: null, title: session.title };
      case 'preview-missing': return { kind: 'preview-missing', persistent: false, label: session.label, error: session.error, reason: null, title: null };
      case 'unavailable': return { kind: 'unavailable', persistent: false, label: null, error: session.error, reason: 'unavailable', title: null };
      case 'recovery':
        // Once a new banner has been saved over the unreadable record, the session is an ordinary stored one.
        return this.savedOnce
          ? { kind: 'stored', persistent, label: null, error: null, reason: null, title: null }
          : { kind: 'recovery', persistent, label: null, error: session.error, reason: session.reason, title: null };
      case 'new':
        return { kind: this.savedOnce ? 'stored' : 'new', persistent, label: null, error: null, reason: null, title: null };
      case 'stored': return { kind: 'stored', persistent, label: null, error: null, reason: null, title: null };
    }
  }

  /** Applies a domain event; a refusal becomes the panel message and leaves everything as it was. */
  private commit(event: LegacyEvent): boolean {
    const transition = reduceLegacy(this.state, event);
    if (transition.error) { this.message = transition.error; return false; }
    if (transition.state === this.state) return true;
    this.state = transition.state;
    this.sceneDirty = true;
    if (this.canSave() && this.storage) {
      const saved = saveLegacy(this.storage, this.state);
      this.saveStatus = saved.ok ? 'saved' : 'failed';
      if (saved.ok) this.savedOnce = true;
      else this.message = saved.error;
    }
    return true;
  }

  private dispatchFlow(event: LegacyFlowEvent): void {
    const previous = this.flow;
    const next = reduceLegacyFlow(previous, event);
    if (next === previous) { this.render(); return; }
    if (next.draft !== previous.draft || isFoundingView(next.view) !== isFoundingView(previous.view)) this.sceneDirty = true;
    this.flow = next;
    this.render();
  }

  private beginFounding(): void {
    const draftNation = this.flow.draft.nationId;
    const nationId = isNationFoundable(draftNation) ? draftNation : defaultLegacyNation();
    this.message = '';
    this.dispatchFlow({ type: 'begin-founding', nationId, seed: freshSeed() });
  }

  private raiseBanner(): void {
    const draft = this.flow.draft;
    this.message = '';
    if (!this.commit({ type: 'found-banner', name: draft.name, nationId: draft.nationId, heraldry: draft.heraldry, motto: null, at: nowIso(), seed: draft.seed })) {
      this.render();
      return;
    }
    this.dispatchFlow({ type: 'founded' });
  }

  private dissolveBanner(): void {
    const transition = reduceLegacy(this.state, { type: 'reset', at: nowIso() });
    if (transition.error) { this.message = transition.error; this.render(); return; }
    this.state = transition.state;
    this.sceneDirty = true;
    this.saveStatus = 'none';
    if (this.canSave() && this.storage) {
      const cleared = clearLegacy(this.storage);
      if (!cleared.ok) this.message = cleared.error;
    }
    this.beginFounding();
  }

  private nominate(): void {
    const { member, file } = this.flow;
    if (!member || !file) return;
    this.message = '';
    if (this.commit({ type: 'nominate', memberId: member, file, at: nowIso() })) {
      const latest = this.state.chronicle[this.state.chronicle.length - 1];
      if (latest && latest.kind === 'nomination') this.message = latest.title;
    }
    this.render();
  }

  private openNotice(slot: number): void {
    const notice = noticesNewestFirst(this.state)[this.flow.noticePage * LEGACY_NOTICE_PAGE + slot];
    if (!notice) return;
    this.message = '';
    this.commit({ type: 'read-notice', noticeId: notice.id });
    this.dispatchFlow({ type: 'open-notice', noticeId: notice.id });
  }

  private acceptChallenge(): void {
    const noticeId = this.flow.noticeId;
    if (!noticeId) return;
    this.message = '';
    if (this.commit({ type: 'accept-challenge', noticeId, at: nowIso() })) this.dispatchFlow({ type: 'accepted' });
    else this.render();
  }

  private openLandmark(landmark: LandmarkId, source: 'world' | 'list'): void {
    if (!this.state.banner || !acceptsLandmarkSelection(this.flow.view)) return;
    this.selectSource = source;
    this.message = '';
    this.dispatchFlow({ type: 'open-landmark', landmark, member: this.state.nomination.memberId, file: this.state.nomination.file });
  }

  // ---------------------------------------------------------------- environment and staging

  private sceneState(): LegacySceneState {
    const draft = this.flow.draft;
    if (isFoundingView(this.flow.view)) {
      return presentFoundingDraft({
        nationId: draft.nationId, name: draft.name, heraldry: draft.heraldry, seed: draft.seed,
        mode: this.state.mode, previewId: this.state.previewId,
      });
    }
    return presentBannerhold(this.state);
  }

  /** Creates the environment once, on the first entry; the panels stay usable while it loads. */
  private ensureEnvironment(): void {
    if (this.environmentRequested) return;
    this.environmentRequested = true;
    void provideQuestLegacyEnvironment({
      world: this.world,
      parent: this.anchorEntity,
      state: this.sceneState(),
      quality: this.comfort.quality,
      posture: this.comfort.posture,
      reducedMotion: this.comfort.reducedMotion,
      onLandmarkHover: (id) => this.onWorldHover(id),
      onLandmarkSelect: (id) => this.onWorldSelect(id),
    }).then((provided) => {
      if (this.disposed) { provided.environment.dispose(); return; }
      this.environment = provided.environment;
      this.environmentSource = provided.source;
      this.environmentFellBack = provided.fellBack;
      if (provided.fellBack) this.message = QUEST_LEGACY_COPY.environment.fallback;
      this.sceneDirty = true;
      this.environment.setVisible(this.status.active);
      this.environment.setPaused(!this.status.active || this.status.paused);
      this.stagePanels();
      this.render();
    }).catch((error: unknown) => {
      console.error('[My Legacy] No environment could be created.', error);
      this.environmentRequested = false;
      this.render();
    });
  }

  private onWorldHover(id: LandmarkId | null): void {
    if (this.worldHover === id) return;
    this.worldHover = id;
    if (this.status.active) this.render();
  }

  private onWorldSelect(id: LandmarkId): void {
    if (!this.status.active || this.status.paused) return;
    this.openLandmark(id, 'world');
  }

  /** Places the panels at the environment's published anchors, facing the viewer's eye. */
  private stagePanels(): void {
    const staging = this.environment ? this.environment.getStaging() : fallbackLegacyStaging(this.comfort.posture);
    const scale = this.comfort.textScale / 100;
    const primary = staging.panelAnchors.primary;
    const dock = staging.panelAnchors.dock;
    // Larger text grows the panel upward and the dock downward so the two never overlap.
    faceEye(this.panelObject, primary[0], primary[1] + (scale - 1) * LEGACY_PANEL_METRES.panel[1] / 2, primary[2]);
    faceEye(this.dockObject, dock[0], dock[1] - (scale - 1) * LEGACY_PANEL_METRES.dock[1] / 2, dock[2]);
    this.panelObject.scale.setScalar(LEGACY_UI_LAYOUT.authoredScale * scale);
    this.dockObject.scale.setScalar(LEGACY_UI_LAYOUT.authoredScale * scale);
  }

  private setInteractive(interactive: boolean): void {
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    for (const entity of [this.panelEntity, this.dockEntity]) {
      if (interactive) entity.addComponent(RayInteractable).addComponent(PokeInteractable);
      else entity.removeComponent(RayInteractable).removeComponent(PokeInteractable);
    }
  }

  // ---------------------------------------------------------------- host interface

  /** Called by the Home menu system on every render with the current route and tracking state. */
  sync(status: LegacyHostStatus): void {
    if (this.disposed) return;
    const wasActive = this.status.active;
    this.status = status;
    if (status.active && !wasActive) {
      this.ensureSession();
      this.anchor.visible = true;
      this.setInteractive(true);
      this.ensureEnvironment();
      this.environment?.setVisible(true);
      this.stagePanels();
    } else if (!status.active && wasActive) {
      this.anchor.visible = false;
      this.setInteractive(false);
      this.environment?.setVisible(false);
      this.worldHover = null;
      this.listHover = null;
    }
    this.environment?.setPaused(!status.active || status.paused);
    this.render();
  }

  /** Comfort preferences shared with the Home menu: quality, posture, text size and motion. */
  setComfort(comfort: LegacyComfort): void {
    const previous = this.comfort;
    this.comfort = comfort;
    if (this.environment) {
      if (previous.quality !== comfort.quality) this.environment.setQuality(comfort.quality);
      if (previous.posture !== comfort.posture) this.environment.setPosture(comfort.posture);
      if (previous.reducedMotion !== comfort.reducedMotion) this.environment.setReducedMotion(comfort.reducedMotion);
    }
    this.stagePanels();
  }

  /** Moves the Legacy anchor to the given eye position and heading; the viewer is never moved. */
  placeAnchor(position: Vector3, yaw: number, recentered: boolean): void {
    this.anchor.position.copy(position);
    this.anchor.rotation.set(0, yaw, 0);
    if (recentered) this.recenters += 1;
    this.writeInspection();
  }

  update(delta: number, time: number): void {
    if (this.environment && this.status.active) this.environment.update(delta, time);
  }

  /** The environment's own resource and frame statistics, once it exists. */
  environmentStats(): LegacyEnvironmentStats | null {
    return this.environment ? this.environment.getStats() : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.cleanup) release();
    this.cleanup.length = 0;
    this.environment?.dispose();
    this.environment = null;
    this.heraldry.dispose();
    this.sessionLabel?.remove();
  }

  // ---------------------------------------------------------------- rendering

  private modelInput(): LegacyModelInput {
    return {
      state: this.state,
      flow: this.flow,
      session: this.sessionInfo(),
      pause: { paused: this.status.paused, reason: this.status.pauseReason, canResume: !this.status.entered || this.status.handTracked },
      entered: this.status.entered,
      environment: { kind: this.environmentSource, ready: this.environment !== null, fallback: this.environmentFellBack },
      hover: this.worldHover ?? this.listHover,
      message: this.message,
    };
  }

  /** Writes the current model into the panels. Runs on events only, never per frame, and skips unchanged values. */
  private render(): void {
    if (this.disposed || !this.status.active) { this.writeInspection(); return; }
    const input = this.modelInput();
    const model = buildLegacyPanelModel(input);
    const dock = buildLegacyDockModel(input);
    if (model.view !== this.activeView) {
      for (const id of LEGACY_VIEW_IDS) this.setDisplay(id, id === model.view);
      this.activeView = model.view;
      // The previous view's controls are hidden; a pointer resting there enters the new view's controls afresh.
      for (const id of this.hovered) if (!id.startsWith('Legacy_Dock')) this.hovered.delete(id);
    }
    for (const id in model.texts) this.setText(id, model.texts[id]);
    for (const id in model.displays) this.setDisplay(id, model.displays[id]);
    for (const id in model.controls) this.applyControl(id, model.controls[id]);
    for (const id in model.positions) this.setPosition(id, model.positions[id]);
    for (const id in dock.texts) this.setText(id, dock.texts[id]);
    for (const id in dock.controls) this.applyControl(id, dock.controls[id]);
    if (model.heraldry) this.heraldry.show(model.heraldry);
    if (this.environment) {
      if (this.sceneDirty) {
        this.environment.setState(this.sceneState());
        this.sceneDirty = false;
      }
      const focus = this.status.paused ? null : this.flow.landmark ?? landmarkOfView(this.flow.view);
      if (focus !== this.focused) { this.focused = focus; this.environment.focusLandmark(focus); }
      const highlight = this.status.paused ? null : this.listHover;
      if (highlight !== this.highlighted) { this.highlighted = highlight; this.environment.highlightLandmark(highlight); }
    }
    this.writeInspection();
  }

  private setText(id: string, value: string): void {
    const text = spatialText(value);
    if (this.textCache.get(id) === text) return;
    this.textCache.set(id, text);
    this.element(id).setProperties({ text });
  }

  private setDisplay(id: string, visible: boolean): void {
    if (this.displayCache.get(id) === visible) return;
    this.displayCache.set(id, visible);
    this.element(id).setProperties({ display: visible ? 'flex' : 'none' });
  }

  private setPosition(id: string, left: number): void {
    if (this.positionCache.get(id) === left) return;
    this.positionCache.set(id, left);
    this.element(id).setProperties({ positionLeft: left });
  }

  private applyControl(id: string, state: LegacyControlState): void {
    this.controlStates.set(id, state);
    this.setDisplay(id, state.visible);
    this.styleControl(id, state);
  }

  /** Sets a control's explicit look from its variant, availability, selection and hover; unchanged looks are skipped. */
  private styleControl(id: string, state: LegacyControlState): void {
    const element = this.element(id);
    const variant = this.buttonVariants.get(element);
    if (!variant) {
      const key = state.enabled ? 'enabled' : 'disabled';
      if (this.styleCache.get(id) === key) return;
      this.styleCache.set(id, key);
      element.setProperties({ opacity: state.enabled ? 1 : 0.42 });
      return;
    }
    const selectable = SELECTABLE_PREFIXES.some((prefix) => id.startsWith(prefix));
    const style = legacyButtonStyle(variant, { enabled: state.enabled, selected: selectable && state.selected, hovered: state.visible && this.hovered.has(id) });
    const key = legacyButtonStyleKey(style);
    if (this.styleCache.get(id) === key) return;
    this.styleCache.set(id, key);
    element.setProperties(style);
  }

  // ---------------------------------------------------------------- inspection and browser entry

  /** Named Legacy state on CrownfallQuestState, for runtime inspection and automated verification. */
  private writeInspection(): void {
    const e = this.stateEntity, c = CrownfallQuestState;
    const state = this.state, flow = this.flow, banner = state.banner;
    const info = this.sessionInfo();
    const nominee = findMember(state, state.nomination.memberId);
    const challenge = openChallenge(state);
    const shownHeraldry = isFoundingView(flow.view) ? flow.draft.heraldry : banner?.heraldry ?? null;
    e.setValue(c, 'legacyActive', this.status.active);
    e.setValue(c, 'legacyView', this.status.active && this.status.paused ? 'pause' : flow.view);
    e.setValue(c, 'legacySession', this.session ? info.kind : '');
    e.setValue(c, 'legacyPersistent', info.persistent);
    e.setValue(c, 'legacySave', this.saveStatus);
    e.setValue(c, 'legacyLabel', info.label ?? '');
    e.setValue(c, 'legacyPreview', state.previewId ?? '');
    e.setValue(c, 'legacyFounded', banner !== null);
    e.setValue(c, 'legacyBanner', banner?.name ?? '');
    e.setValue(c, 'legacyNation', banner?.nationId ?? flow.draft.nationId);
    e.setValue(c, 'legacyDraftName', flow.draft.name);
    e.setValue(c, 'legacyHeraldry', shownHeraldry ? describeHeraldry(shownHeraldry) : '');
    e.setValue(c, 'legacyRepresentative', nominee?.name ?? '');
    e.setValue(c, 'legacyFile', state.nomination.file ?? '');
    e.setValue(c, 'legacyMemberChoice', flow.member ?? '');
    e.setValue(c, 'legacyFileChoice', flow.file ?? '');
    e.setValue(c, 'legacyLandmark', flow.landmark ?? landmarkOfView(flow.view) ?? '');
    e.setValue(c, 'legacyHover', this.worldHover ?? this.listHover ?? '');
    e.setValue(c, 'legacySelectSource', this.selectSource);
    e.setValue(c, 'legacyNotice', flow.noticeId ?? '');
    e.setValue(c, 'legacyChallenge', challenge ? challenge.status : '');
    e.setValue(c, 'legacyChronicle', state.chronicle.length);
    e.setValue(c, 'legacyUnread', state.notices.filter((notice) => notice.status === 'unread').length);
    e.setValue(c, 'legacyAftermath', prominentAftermath(state).length);
    e.setValue(c, 'legacyEnvironment', this.environmentSource ?? '');
    e.setValue(c, 'legacyEnvironmentReady', this.environment !== null);
    e.setValue(c, 'legacyRecenters', this.recenters);
    e.setValue(c, 'legacyMessage', this.message);
  }

  /** The browser entry panel names guest and preview sessions before anyone enters the headset. */
  private createBrowserLabel(): HTMLElement | null {
    const entry = document.querySelector('.quest-entry');
    if (!entry) return null;
    const label = document.createElement('p');
    label.className = 'quest-legacy-session';
    label.setAttribute('role', 'note');
    entry.insertBefore(label, document.getElementById('enter-vr'));
    const search = new URLSearchParams(window.location.search);
    if (search.has('legacyPreview')) label.textContent = `${LEGACY_COPY.title}: ${LEGACY_COPY.preview.label}`;
    else if (search.get('legacy') === 'fresh') label.textContent = `${LEGACY_COPY.title}: ${LEGACY_COPY.guest.label}`;
    label.hidden = !label.textContent;
    return label;
  }

  private updateBrowserLabel(): void {
    const label = this.sessionLabel;
    if (!label) return;
    const info = this.sessionInfo();
    const text = info.label
      ? `${LEGACY_COPY.title}: ${info.label}${info.kind === 'preview' && info.title ? ` (${info.title})` : ''}${info.error ? `. ${info.error}` : ''}`
      : '';
    label.textContent = text;
    label.hidden = text.length === 0;
  }
}
