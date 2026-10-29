// The Quest My Legacy destination: binds the generated Legacy panels to the
// shared Legacy domain, keeps the session and saves, owns the Legacy anchor and
// panel staging, and drives the environment strictly through the Quest
// environment contract. The Home menu system owns navigation (QuestState),
// loads this module only when My Legacy is first opened, and tells it when My
// Legacy is shown, paused or left. The reading panel and the touch tray are
// instantiated from their lazy UIKitML manifest entries on that first entry.

import { PokeInteractable, RayInteractable } from '@iwsdk/core';
import type { Entity, Object3D, UIKit, UIKitMLAsset, Vector3, World } from '@iwsdk/core';
import { HERALDRY_PRESETS, describeHeraldry } from '../../../shared/legacy/content/heraldry';
import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import { FILES, eligibleMusterFiles } from '../../../shared/legacy/content/muster';
import { NATION_ORDER, defaultLegacyNation, isNationFoundable } from '../../../shared/legacy/content/nations';
import { prominentAftermath } from '../../../shared/legacy/domain/aftermath';
import { validateMotto } from '../../../shared/legacy/domain/founding';
import { openChallenge } from '../../../shared/legacy/domain/notices';
import { presentBannerhold, presentFoundingDraft } from '../../../shared/legacy/domain/presentation';
import { findMember } from '../../../shared/legacy/domain/state';
import { LEGACY_LANDMARKS } from '../../../shared/legacy/environment-contract';
import type { LegacyEnvironmentStats, LegacySceneState } from '../../../shared/legacy/environment-contract';
import type { LandmarkId, LegacyEvent, LegacyState } from '../../../shared/legacy/types';
import { CrownfallQuestState } from '../quest-components.js';
import type { QuestEnvironmentQuality, QuestLegacyEnvironment, QuestPosture } from './environment-contract.js';
import { provideQuestLegacyEnvironment } from './environment-provider.js';
import type { QuestEnvironmentSource } from './environment-provider.js';
import { HeraldryTexture } from './heraldry-texture.js';
import { legacyButtonStyle, legacyButtonStyleKey } from './legacy-button-style.js';
import type { LegacyButtonVariant } from './legacy-button-style.js';
import { installLegacyDiagnostics } from './legacy-diagnostics.js';
import {
  LEGACY_RECORD_TABS, acceptsLandmarkSelection, createLegacyFlow, isFoundingView, landmarkOfView, reduceLegacyFlow, suggestionSlots,
} from './legacy-flow.js';
import type { LegacyFlowEvent, LegacyFlowState } from './legacy-flow.js';
import { LegacySessionController } from './legacy-session.js';
import { fallbackLegacyStaging, placeLegacyPanels } from './legacy-staging.js';
import type { LegacyPanelPlacements } from './legacy-staging.js';
import { browserLegacyStorage } from './legacy-storage.js';
import {
  LEGACY_DOCK_ACTION_IDS, LEGACY_HERALDRY_IMAGE_IDS, LEGACY_HERALDRY_PARTS, LEGACY_HERALDRY_RASTER, LEGACY_HOUSE_SHIELD_IDS, LEGACY_KEY_ACTIONS,
  LEGACY_KEY_ROWS, LEGACY_LIVE_TEXT, LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE, LEGACY_PANEL_NAMES, LEGACY_RECORD_PAGE, LEGACY_SCENE_NODES,
  LEGACY_SHIELD_RASTER, LEGACY_SUGGESTION_SLOTS, LEGACY_UI_LAYOUT, LEGACY_VIEW_IDS,
  legacyFileId, legacyKeyActionId, legacyKeyId, legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId, legacyRecordTabId,
} from './legacy-ui-contract.js';
import type { LegacyPanelActionId, LegacyViewId } from './legacy-ui-contract.js';
import { buildLegacyDockModel, buildLegacyPanelModel, defaultRecordTab, noticesNewestFirst, recordItems } from './legacy-view-model.js';
import type { LegacyControlState, LegacyDockModel, LegacyElementStyle, LegacyModelInput } from './legacy-view-model.js';
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
  /** Home's Menu Distance in metres; the reading panel follows it. */
  panelDistance: number;
  /** Panel Height offset in metres. */
  panelHeight: number;
  reducedMotion: boolean;
}

/** Controls that show a selected state; all use the standard button surface. */
const SELECTABLE_PREFIXES = ['Legacy_Nation_', 'Legacy_Suggestion_', 'Legacy_Preset_', 'Legacy_Member_', 'Legacy_File_', 'Legacy_Landmark_', 'Legacy_RecordTab_', 'Legacy_Key_Shift'];
/** Generated control classes and the look each one starts from. */
const BUTTON_CLASSES: ReadonlyArray<readonly [string, LegacyButtonVariant]> = [['lg-btn', 'button'], ['lg-btn-primary', 'primary'], ['lg-btn-danger', 'danger']];
/** Controls that still answer while My Legacy is paused: the pause view's own, and the tray's Recenter, Exit and mirrors of them. */
const PAUSED_CONTROLS = new Set<string>(['Legacy_Resume', 'Legacy_PauseHome', 'Legacy_DockRecenter', 'Legacy_DockExit', 'Legacy_DockBack', 'Legacy_DockPrimary']);

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
  private readonly anchor: Object3D;
  private readonly elements = new Map<string, UIKit.Text>();
  private readonly textCache = new Map<string, string>();
  private readonly displayCache = new Map<string, boolean>();
  private readonly styleCache = new Map<string, string>();
  private readonly dataStyleCache = new Map<string, string>();
  private readonly positionCache = new Map<string, number>();
  private readonly controlStates = new Map<string, LegacyControlState>();
  /** Each control's guarded activation, so the tray's mirrors press exactly what the panel would. */
  private readonly activators = new Map<string, () => void>();
  /** Controls the pointer is over, from each control's onHoverChange. */
  private readonly hovered = new Set<string>();
  /** Generated control containers by visual variant, read once from their classes. */
  private readonly buttonVariants = new Map<object, LegacyButtonVariant>();
  private readonly heraldry = new HeraldryTexture(LEGACY_HERALDRY_RASTER.width, LEGACY_HERALDRY_RASTER.height);
  private readonly alliedShield = new HeraldryTexture(LEGACY_SHIELD_RASTER.width, LEGACY_SHIELD_RASTER.height, 'shield');
  private readonly rivalShield = new HeraldryTexture(LEGACY_SHIELD_RASTER.width, LEGACY_SHIELD_RASTER.height, 'shield');
  private readonly cleanup: (() => void)[] = [];
  private readonly session = new LegacySessionController(browserLegacyStorage());
  private sessionRequested = false;
  private flow: LegacyFlowState = createLegacyFlow(defaultLegacyNation());
  private environment: QuestLegacyEnvironment | null = null;
  private environmentSource: QuestEnvironmentSource | null = null;
  private environmentFellBack = false;
  private environmentRequested = false;
  private interactive = false;
  private status: LegacyHostStatus = { active: false, paused: false, pauseReason: '', entered: false, handTracked: false };
  private comfort: LegacyComfort = { quality: 'medium', posture: 'seated', textScale: 100, panelDistance: 1.5, panelHeight: 0, reducedMotion: false };
  private placement: LegacyPanelPlacements | null = null;
  private activeView: LegacyViewId | null = null;
  private mirror: LegacyDockModel['mirror'] = { back: null, primary: null };
  private focused: LandmarkId | null = null;
  private highlighted: LandmarkId | null = null;
  private worldHover: LandmarkId | null = null;
  private listHover: LandmarkId | null = null;
  private selectSource: 'world' | 'list' | '' = '';
  private message = '';
  private recenters = 0;
  private sceneDirty = true;
  private disposed = false;
  private readonly sessionLabel: HTMLElement | null;

  /**
   * Instantiates the reading panel and the touch tray from their lazy manifest entries under the
   * scene-authored Legacy anchor, then binds them. Rejects, leaving nothing behind, when either fails.
   */
  static async create(world: World, stateEntity: Entity, actions: LegacyHostActions): Promise<QuestLegacyExperience> {
    const anchorEntity = world.requireSceneEntity(LEGACY_SCENE_NODES.anchor);
    const [panel, dock] = await Promise.all([
      world.assets.instantiate<UIKitMLAsset>(LEGACY_UI_LAYOUT.panelManifestId),
      world.assets.instantiate<UIKitMLAsset>(LEGACY_UI_LAYOUT.dockManifestId),
    ]);
    panel.name = LEGACY_PANEL_NAMES.panel;
    dock.name = LEGACY_PANEL_NAMES.dock;
    const panelEntity = world.createTransformEntity(panel, { parent: anchorEntity });
    const dockEntity = world.createTransformEntity(dock, { parent: anchorEntity });
    try {
      return new QuestLegacyExperience(world, stateEntity, actions, anchorEntity, panelEntity, panel, dockEntity, dock);
    } catch (error) {
      panelEntity.dispose();
      dockEntity.dispose();
      throw error;
    }
  }

  private constructor(
    private readonly world: World,
    private readonly stateEntity: Entity,
    private readonly actions: LegacyHostActions,
    private readonly anchorEntity: Entity,
    private readonly panelEntity: Entity,
    private readonly panel: UIKitMLAsset,
    private readonly dockEntity: Entity,
    private readonly dock: UIKitMLAsset,
  ) {
    this.anchor = anchorEntity.object3D!;
    // Hidden until Home shows My Legacy; hidden panels also stay out of the pointer target lists.
    this.anchor.visible = false;
    for (const id of LEGACY_HERALDRY_IMAGE_IDS) this.panel.requireElementById<UIKit.Image>(id).setProperties({ src: this.heraldry.texture });
    this.panel.requireElementById<UIKit.Image>(LEGACY_HOUSE_SHIELD_IDS.allied).setProperties({ src: this.alliedShield.texture });
    this.panel.requireElementById<UIKit.Image>(LEGACY_HOUSE_SHIELD_IDS.rival).setProperties({ src: this.rivalShield.texture });
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
      if (this.status.paused && !PAUSED_CONTROLS.has(id)) return;
      activate();
    };
    const onHoverChange = (hover: boolean): void => {
      if (hover) this.hovered.add(id);
      else this.hovered.delete(id);
      const state = this.controlStates.get(id);
      if (state) this.styleControl(id, state);
      onHover?.(hover);
    };
    this.activators.set(id, click);
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

  /** Presses the panel control the tray mirrors in the current view, with that control's own guards. */
  private pressMirror(slot: 'back' | 'primary'): void {
    const source = this.mirror[slot];
    if (source) this.activators.get(source)?.();
  }

  private bindControls(): void {
    this.bind('Legacy_RecoveryHome', () => this.actions.home());
    this.bind('Legacy_RecoveryGuest', () => {
      this.session.continueAsGuest(nowIso());
      this.sceneDirty = true;
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
    this.bind('Legacy_ConfirmMotto', this.flowEvent({ type: 'open-motto' }));
    this.bind('Legacy_ConfirmClearMotto', this.flowEvent({ type: 'clear-motto' }));
    this.bind('Legacy_ConfirmBack', this.flowEvent({ type: 'founding-step', view: 'arms' }));
    this.bind('Legacy_ConfirmRaise', () => this.raiseBanner());
    this.bind('Legacy_RaisedContinue', () => this.finishBeat());
    this.bind('Legacy_AftermathLater', this.flowEvent({ type: 'defer-aftermath' }));
    this.bind('Legacy_AftermathDismiss', () => {
      this.message = '';
      if (this.commit({ type: 'dismiss-aftermath' })) this.dispatchFlow({ type: 'acknowledged' });
      else this.render();
    });
    this.bind('Legacy_AftermathReview', this.flowEvent({ type: 'review-aftermath' }));
    for (const landmark of LEGACY_LANDMARKS) {
      this.bind(legacyLandmarkButtonId(landmark), () => this.openLandmark(landmark, 'list'), (hover) => {
        if (hover) this.listHover = landmark;
        else if (this.listHover === landmark) this.listHover = null;
        this.render();
      });
    }
    this.bind('Legacy_ResetOpen', this.flowEvent({ type: 'request-reset' }));
    this.bind('Legacy_ResetCancel', this.flowEvent({ type: 'cancel-reset' }));
    this.bind('Legacy_ResetConfirm', () => this.dissolveBanner());
    for (const id of ['Legacy_HallBack', 'Legacy_MusterBack', 'Legacy_RecordBack', 'Legacy_HeraldBack']) this.bind(id, this.flowEvent({ type: 'overview' }));
    this.bind('Legacy_MusterChoose', () => this.openNomination());
    this.bind('Legacy_NominateBack', this.flowEvent({ type: 'close-nominate' }));
    for (let index = 0; index < LEGACY_MEMBER_SLOTS; index++) {
      this.bind(`Legacy_Member_${index}`, () => {
        const member = this.session.state.members[index];
        if (member) { this.message = ''; this.dispatchFlow({ type: 'select-member', memberId: member.id }); }
      });
    }
    for (const file of FILES) this.bind(legacyFileId(file), this.flowEvent({ type: 'select-file', file }));
    this.bind('Legacy_MusterNominate', () => this.nominate());
    for (const tab of LEGACY_RECORD_TABS) this.bind(legacyRecordTabId(tab), this.flowEvent({ type: 'record-tab', tab }));
    const recordPages = (): number => Math.max(1, Math.ceil(recordItems(this.session.state, this.flow.recordTab).length / LEGACY_RECORD_PAGE));
    this.bind('Legacy_RecordPrev', () => this.dispatchFlow({ type: 'page', list: 'record', delta: -1, total: recordPages() }));
    this.bind('Legacy_RecordNext', () => this.dispatchFlow({ type: 'page', list: 'record', delta: 1, total: recordPages() }));
    const noticePages = (): number => Math.max(1, Math.ceil(this.session.state.notices.length / LEGACY_NOTICE_PAGE));
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
      Legacy_DockBack: () => this.pressMirror('back'),
      Legacy_DockPrimary: () => this.pressMirror('primary'),
      Legacy_DockHome: () => this.actions.home(),
      Legacy_DockRecenter: () => this.actions.recenter(),
      Legacy_DockPause: () => this.actions.pause(),
      Legacy_DockExit: () => this.actions.exit(),
    };
    for (const id of LEGACY_DOCK_ACTION_IDS) this.bind(id, dock[id]);
  }

  // ---------------------------------------------------------------- session and domain

  private get state(): LegacyState {
    return this.session.state;
  }

  /** Resolves where this visit's banner comes from, once, on the first entry to My Legacy. */
  private ensureSession(): void {
    if (this.sessionRequested) return;
    this.sessionRequested = true;
    void this.session.resolve(window.location.search, nowIso()).then((session) => {
      if (this.disposed) return;
      this.sceneDirty = true;
      if (session.kind === 'recovery') this.dispatchFlow({ type: 'show', view: 'recovery' });
      else if (session.state.banner) this.dispatchFlow({ type: 'show', view: prominentAftermath(session.state).length > 0 ? 'aftermath' : 'overview' });
      else this.beginFounding();
      if (session.kind === 'preview-missing' || session.kind === 'unavailable') this.message = session.error;
      this.updateBrowserLabel();
      this.render();
    });
  }

  /** Applies a domain event; a refusal or failed save becomes the panel message. Returns whether it was accepted. */
  private commit(event: LegacyEvent): boolean {
    const result = this.session.commit(event);
    if (result.changed) this.sceneDirty = true;
    if (result.error) this.message = result.error;
    return result.changed || result.error === null;
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
    const motto = validateMotto(draft.motto);
    if (motto.ok === false) { this.message = motto.error; this.render(); return; }
    const before = this.state;
    this.commit({ type: 'found-banner', name: draft.name, nationId: draft.nationId, heraldry: draft.heraldry, motto: motto.motto, at: nowIso(), seed: draft.seed });
    if (this.state === before || !this.state.banner) { this.render(); return; }
    this.dispatchFlow({ type: 'founded' });
  }

  /**
   * Ends the raising beat and opens the Bannerhold. Unlike desktop's timed beat, the headset waits for
   * Continue, so nobody reading the founding line in the headset is moved on mid-sentence.
   */
  private finishBeat(): void {
    this.dispatchFlow({ type: 'raised-done' });
  }

  private dissolveBanner(): void {
    const error = this.session.dissolve(nowIso());
    if (error) { this.message = error; this.render(); return; }
    this.sceneDirty = true;
    this.beginFounding();
  }

  /** Opens the nomination with the current nominee and file, or the first available member and open file. */
  private openNomination(): void {
    const state = this.state;
    if (!state.banner) return;
    this.message = '';
    this.dispatchFlow({ type: 'open-nominate' });
    if (!this.flow.member) {
      let first: string | null = null;
      for (const member of state.members) if (!first && member.status === 'available') first = member.id;
      if (first) this.dispatchFlow({ type: 'select-member', memberId: first });
    }
    if (!this.flow.file) {
      const open = eligibleMusterFiles(state.banner.nationId);
      if (open.length > 0) this.dispatchFlow({ type: 'select-file', file: open[0] });
    }
  }

  private nominate(): void {
    const { member, file } = this.flow;
    if (!member || !file) return;
    this.message = '';
    const before = this.state;
    this.commit({ type: 'nominate', memberId: member, file, at: nowIso() });
    if (this.state !== before) {
      const latest = this.state.chronicle[this.state.chronicle.length - 1];
      if (latest && latest.kind === 'nomination' && this.message === '') this.message = latest.title;
      this.dispatchFlow({ type: 'nominated' });
      return;
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
    const before = this.state;
    this.commit({ type: 'accept-challenge', noticeId, at: nowIso() });
    if (this.state !== before) this.dispatchFlow({ type: 'accepted' });
    else this.render();
  }

  private openLandmark(landmark: LandmarkId, source: 'world' | 'list'): void {
    if (!this.state.banner || !acceptsLandmarkSelection(this.flow.view)) return;
    this.selectSource = source;
    this.message = '';
    this.dispatchFlow({
      type: 'open-landmark', landmark, member: this.state.nomination.memberId, file: this.state.nomination.file,
      recordTab: defaultRecordTab(this.state),
    });
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

  /** Places the reading panel and the touch tray from the published staging and the viewer's comfort settings. */
  private stagePanels(): void {
    const staging = this.environment ? this.environment.getStaging() : fallbackLegacyStaging(this.comfort.posture);
    const placement = placeLegacyPanels(staging, this.comfort);
    this.placement = placement;
    const [px, py, pz] = placement.panel.position;
    const [tx, ty, tz] = placement.tray.position;
    faceEye(this.panel, px, py, pz);
    faceEye(this.dock, tx, ty, tz);
    this.panel.scale.setScalar(placement.panel.scale);
    this.dock.scale.setScalar(placement.tray.scale);
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

  /** Comfort preferences shared with the Home menu: quality, posture, text size, distance, height and motion. */
  setComfort(comfort: LegacyComfort): void {
    const previous = this.comfort;
    this.comfort = comfort;
    if (this.environment) {
      if (previous.quality !== comfort.quality) this.environment.setQuality(comfort.quality);
      if (previous.posture !== comfort.posture) this.environment.setPosture(comfort.posture);
      if (previous.reducedMotion !== comfort.reducedMotion) this.environment.setReducedMotion(comfort.reducedMotion);
    }
    this.stagePanels();
    this.writeInspection();
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
    this.panelEntity.dispose();
    this.dockEntity.dispose();
    this.heraldry.dispose();
    this.alliedShield.dispose();
    this.rivalShield.dispose();
    this.sessionLabel?.remove();
  }

  // ---------------------------------------------------------------- rendering

  private modelInput(): LegacyModelInput {
    return {
      state: this.state,
      flow: this.flow,
      session: this.session.info(),
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
    const dock = buildLegacyDockModel(input, model);
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
    for (const id in model.styles) this.setStyle(id, model.styles[id]);
    for (const id in dock.texts) this.setText(id, dock.texts[id]);
    for (const id in dock.controls) this.applyControl(id, dock.controls[id]);
    this.mirror = dock.mirror;
    if (model.heraldry) this.heraldry.show(model.heraldry);
    if (model.houses) {
      this.alliedShield.show(model.houses.allied);
      this.rivalShield.show(model.houses.rival);
    }
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

  private setStyle(id: string, style: LegacyElementStyle): void {
    const key = `${style.backgroundColor ?? ''}|${style.borderColor ?? ''}|${style.color ?? ''}`;
    if (this.dataStyleCache.get(id) === key) return;
    this.dataStyleCache.set(id, key);
    this.element(id).setProperties(style);
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
    const info = this.session.info();
    const nominee = findMember(state, state.nomination.memberId);
    const challenge = openChallenge(state);
    const shownHeraldry = isFoundingView(flow.view) ? flow.draft.heraldry : banner?.heraldry ?? null;
    e.setValue(c, 'legacyActive', this.status.active);
    e.setValue(c, 'legacyView', this.status.active && this.status.paused ? 'pause' : flow.view);
    e.setValue(c, 'legacySession', this.session.session ? info.kind : '');
    e.setValue(c, 'legacyPersistent', info.persistent);
    e.setValue(c, 'legacySaved', info.saved);
    e.setValue(c, 'legacySave', this.session.saveStatus);
    e.setValue(c, 'legacyLabel', info.label ?? '');
    e.setValue(c, 'legacyPreview', state.previewId ?? '');
    e.setValue(c, 'legacyFounded', banner !== null);
    e.setValue(c, 'legacyBanner', banner?.name ?? '');
    e.setValue(c, 'legacyNation', banner?.nationId ?? flow.draft.nationId);
    e.setValue(c, 'legacyDraftName', flow.draft.name);
    e.setValue(c, 'legacyMotto', banner ? banner.motto ?? '' : flow.draft.motto);
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
    e.setValue(c, 'legacyRecordTab', flow.recordTab);
    e.setValue(c, 'legacyChronicle', state.chronicle.length);
    e.setValue(c, 'legacyUnread', state.notices.filter((notice) => notice.status === 'unread').length);
    e.setValue(c, 'legacyAftermath', prominentAftermath(state).length);
    e.setValue(c, 'legacyMirrorBack', this.mirror.back ?? '');
    e.setValue(c, 'legacyMirrorPrimary', this.mirror.primary ?? '');
    e.setValue(c, 'legacyEnvironment', this.environmentSource ?? '');
    e.setValue(c, 'legacyEnvironmentReady', this.environment !== null);
    e.setValue(c, 'legacyRecenters', this.recenters);
    e.setValue(c, 'legacyMessage', this.message);
    const placement = this.placement;
    if (placement) {
      const [px, py, pz] = placement.panel.position;
      const half = LEGACY_UI_LAYOUT.panel.height / 200 * placement.panel.scale;
      const horizontal = Math.hypot(px, pz);
      const [tx, ty, tz] = placement.tray.position;
      e.setValue(c, 'legacyPanelTopDegrees', Math.atan2(py + half, horizontal) * 180 / Math.PI);
      e.setValue(c, 'legacyPanelBottomDegrees', Math.atan2(py - half, horizontal) * 180 / Math.PI);
      e.setValue(c, 'legacyPanelDistance', Math.hypot(px, py, pz));
      e.setValue(c, 'legacyTrayDistance', Math.hypot(tx, ty, tz));
      e.setValue(c, 'legacyTrayElevationDegrees', Math.atan2(ty, Math.hypot(tx, tz)) * 180 / Math.PI);
    }
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
    const info = this.session.info();
    const text = info.label
      ? `${LEGACY_COPY.title}: ${info.label}${info.kind === 'preview' && info.title ? ` (${info.title})` : ''}${info.error ? `. ${info.error}` : ''}`
      : '';
    label.textContent = text;
    label.hidden = text.length === 0;
  }
}
