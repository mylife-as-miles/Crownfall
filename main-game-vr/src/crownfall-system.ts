import {
  AnimationMixer, AssetManager, Box3, createSystem, Entity, LoopRepeat,
  Object3D, Quaternion, UIKit, UIKitMLAsset, Vector3, VisibilityState,
} from '@iwsdk/core';
import { CHRONICLE_EXHIBITS, CHRONICLE_LABELS, getChronicleRecord } from '../../shared/chronicles/content';
import { getOpenEntry } from '../../shared/chronicles/scene-state';
import { CHRONICLES_CONTENT_POLICY, getCanonMarker } from '../../shared/chronicles/status';
import { ARENAS, CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS, SETTINGS_CATEGORIES, SHOWCASE_CATEGORIES, getModalContent } from '../../shared/menu/content';
import { MENU_THEME } from '../../shared/menu/theme';
import type { HomeTileAction, SettingsCategory } from '../../shared/menu/types';
import { CrownfallQuestState } from './quest-components.js';
import {
  adjustQuestPreference, createQuestState, getQuestSettingsRows, normalizeQuestPreferences,
  QUEST_PREFERENCES_KEY, QUEST_VISIT_ARENAS, QUEST_VISIT_STEPS, reduceQuestState,
} from './quest-state.js';
import type { QuestEvent, QuestPreferences, QuestState } from './quest-state.js';
import { QUEST_CHRONICLE_CONTROLS, QUEST_CHRONICLE_IDS, QUEST_CHRONICLE_LAYOUT, QUEST_UI_LAYOUT, QUEST_VIEW_IDS, QUEST_SETTING_ROWS, questText } from './ui-contract.js';
import { CrownfallAtmosphere } from './atmosphere.js';
import { ARCHIVE_PREVIEW_FRAMING, ArchiveController, chroniclesSelection } from './chronicles/archive-controller.js';

const SELECTION_GROUPS = {
  home: HOME_CONTENT.map(item => `Home_${item.action}`),
  play: PLAY_CARDS.map(item => `Play_${item.id}`),
  showcase: SHOWCASE_CATEGORIES.map(item => `Showcase_${item.id}`),
  chapters: CHAPTERS.map(item => `Chapter_${item.id}`),
  settings: SETTINGS_CATEGORIES.map(category => `Settings_${category}`),
} as const;

const VISIT_KEY = 'crownfall.quest.visit-complete';
// Browser preview framing for Chronicles: wider, tilted down to the monument and turned toward the control surface.
const PREVIEW_FRAMING = ARCHIVE_PREVIEW_FRAMING;
const PREVIEW_AXIS = new Vector3(1, 0, 0);
const PREVIEW_UP = new Vector3(0, 1, 0);
const publicUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`, document.baseURI).href;
function readPreferences(): QuestPreferences {
  try { return normalizeQuestPreferences(JSON.parse(localStorage.getItem(QUEST_PREFERENCES_KEY) || '{}')); }
  catch { return normalizeQuestPreferences(null); }
}
function visitCompleted(): boolean { try { return localStorage.getItem(VISIT_KEY) === 'true'; } catch { return false; } }

export class CrownfallMenuSystem extends createSystem({ state: { required: [CrownfallQuestState] } }) {
  private panel!: UIKitMLAsset;
  private stateEntity!: Entity;
  private anchor!: Object3D;
  private menuObject!: Object3D;
  private heroAnchor!: Object3D;
  private atmosphere!: CrownfallAtmosphere;
  private atmosphereObject!: Object3D;
  private chronicles!: ArchiveController;
  private elements = new Map<string, UIKit.Text>();
  private state: QuestState = createQuestState();
  private preferences = readPreferences();
  private mixer: AnimationMixer | null = null;
  private hero: Entity | null = null;
  private alive = true;
  private loadingHero = false;
  private modelFailed = false;
  private leftTracked = false;
  private rightTracked = false;
  private lastHandTime = 0;
  private needRecenter = false;
  private settingsIndex = 0;
  private selected = { home: 'Home_legacy', play: 'Play_local-duel', showcase: 'Showcase_battles', chapters: 'Chapter_chapter-01', settings: 'Settings_general' };
  private sceneDim = 0;
  private sceneTint = 0x0a0805;
  private activeView: string | null = null;
  private outgoingView: string | null = null;
  private transitionTime = 0;
  private fadeIn = Array.from({ length: 61 }, (_, index) => {
    const progress = 1 - Math.pow(1 - index / 60, 3);
    return { opacity: progress, positionLeft: 16 * (1 - progress), pointerEvents: 'auto' as const };
  });
  private fadeOut = Array.from({ length: 61 }, (_, index) => {
    const progress = 1 - Math.pow(1 - index / 60, 3);
    return { opacity: 1 - progress, positionLeft: -12 * progress, pointerEvents: 'none' as const };
  });
  private activeTime = 0;
  private atmosphereTime = 0;
  private observationTime = 0;
  private canEnter = false;
  private entering = false;
  private headPosition = new Vector3();
  private headDirection = new Vector3();
  private headRotation = new Quaternion();
  private previewView = 0;
  private previewBase: { fov: number; quaternion: Quaternion } | null = null;
  private previewTilt = new Quaternion();
  private previewTurn = new Quaternion();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  init(): void {
    this.panel = this.world.requireSceneObject<UIKitMLAsset>('menu-panel');
    this.stateEntity = this.world.requireSceneEntity('menu-panel');
    this.anchor = this.world.requireSceneEntity('experience-anchor').object3D!;
    this.menuObject = this.stateEntity.object3D!;
    this.heroAnchor = this.world.requireSceneEntity('sorcerer-anchor').object3D!;
    this.atmosphereObject = this.world.requireSceneObject<Object3D>('atmosphere-anchor');
    this.atmosphere = new CrownfallAtmosphere(this.atmosphereObject);
    // The archive is placed from the anchor, which recenter moves to the head pose.
    this.chronicles = new ArchiveController({
      world: this.world, anchor: this.anchor, panel: this.panel, panelObject: this.menuObject, stateEntity: this.stateEntity, view: this.world.camera,
      select: id => this.dispatch({ type: 'record', id }),
      ground: (x, y) => this.dispatch({ type: 'map', x, y }),
      loaded: result => this.dispatch({ type: 'loaded', result }),
    });
    const bind = (id: string, callback: () => void) => {
      const element = this.element(id);
      element.name = id;
      const activate = () => { this.selectControl(id); callback(); };
      element.addEventListener('click', activate);
      element.setProperties({ onHoverChange: (hover: boolean) => { if (hover) this.selectControl(id); } });
      this.cleanupFuncs.push(() => { element.removeEventListener('click', activate); element.setProperties({ onHoverChange: undefined }); });
    };
    for (const tab of NAV_TABS) bind(`Nav_${tab.aria}`, () => this.dispatch({ type: 'nav', screen: tab.aria.toLowerCase() as 'home' | 'play' | 'showcase' | 'settings' }));
    for (const item of HOME_CONTENT) bind(`Home_${item.action}`, () => this.dispatch({ type: 'home', panel: item.action as HomeTileAction }));
    for (const item of PLAY_CARDS) bind(`Play_${item.id}`, () => this.dispatch({ type: 'play', id: item.id }));
    CHAPTERS.forEach((_, index) => bind(`Chapter_${CHAPTERS[index].id}`, () => {
      this.dispatch({ type: 'chapter', index });
      if (CHAPTERS[index].locked) { this.text('Status_Boot', `${CHAPTERS[index].title} is locked in this preview.`); this.display('Status_Boot', true); }
    }));
    for (const item of SHOWCASE_CATEGORIES) bind(`Showcase_${item.id}`, () => this.dispatch({ type: 'showcase', view: item.id }));
    bind('Btn_ExploreArenas', () => this.dispatch({ type: 'showcase', view: 'arenas' }));
    ARENAS.forEach((_, index) => bind(`Arena_${index}`, () => this.dispatch({ type: 'arena', index })));
    for (const category of SETTINGS_CATEGORIES) bind(`Settings_${category}`, () => { this.settingsIndex = 0; this.dispatch({ type: 'category', category }); });
    for (let index = 0; index < QUEST_SETTING_ROWS; index++) bind(`Setting_${index}`, () => this.adjustSetting(index));
    for (const exhibit of CHRONICLE_EXHIBITS) bind(QUEST_CHRONICLE_IDS.tab(exhibit.id), () => this.dispatch({ type: 'exhibit', exhibit: exhibit.id }));
    for (const record of QUEST_CHRONICLE_CONTROLS) bind(QUEST_CHRONICLE_IDS.control(record), () => this.dispatch({ type: 'record', id: record.id }));
    const actions: Record<string, QuestEvent> = {
      Btn_Back: { type: 'back' }, Btn_Confirm: { type: 'confirm' }, Btn_Cancel: { type: 'cancel' },
      Btn_StartVisit: { type: 'start-visit' }, Btn_VisitReplay: { type: 'start-visit' }, Btn_SkipVisit: { type: 'skip-visit' },
      Btn_VisitNext: { type: 'visit-next' }, Btn_VisitBack: { type: 'visit-back' }, Btn_VisitFinish: { type: 'visit-finish' },
      Btn_Pause: { type: 'pause', reason: 'Take your time. Your place is kept.' }, Btn_PauseHome: { type: 'pause-home' },
    };
    for (const [id, event] of Object.entries(actions)) bind(id, () => this.dispatch(event));
    bind('Btn_Resume', () => { if (!this.state.entered || this.leftTracked || this.rightTracked) this.dispatch({ type: 'resume' }); });
    bind('Btn_Recenter', () => this.recenter());
    bind('Btn_EnterVR', () => { void this.enter(); });
    bind('Btn_Exit', () => { void this.exit(); });
    bind('Btn_RetryCreature', () => { void this.loadHero(); });
    const enterButton = document.getElementById('enter-vr');
    const enterFromBrowser = () => { void this.enter(); };
    enterButton?.addEventListener('click', enterFromBrowser);
    this.cleanupFuncs.push(() => enterButton?.removeEventListener('click', enterFromBrowser));
    const onDocumentVisibility = () => { if (document.hidden) this.dispatch({ type: 'pause', reason: 'Your visit was paused while you were away.' }); };
    document.addEventListener('visibilitychange', onDocumentVisibility);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', onDocumentVisibility));
    const onMotion = () => this.render();
    this.reducedMotion.addEventListener('change', onMotion);
    this.cleanupFuncs.push(() => this.reducedMotion.removeEventListener('change', onMotion));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(visibility => this.onVisibility(visibility)));
    this.cleanupFuncs.push(this.world.onXRFrame(frame => this.onHandsFrame(frame)));
    this.cleanupFuncs.push(() => { this.alive = false; this.atmosphere.dispose(); this.chronicles.dispose(); this.mixer?.stopAllAction(); if (this.hero) this.hero.dispose(); });
    if (navigator.xr) void navigator.xr.isSessionSupported('immersive-vr').then(supported => { this.canEnter = supported; this.render(); }).catch(() => this.browserStatus('VR availability could not be checked. Try opening this page in your headset browser.'));
    // Explicit development-only accommodation for software headset emulation.
    // Production headset rendering keeps the native framebuffer scale.
    const emulatorScale = Number(import.meta.env.VITE_CROWNFALL_EMULATOR_SCALE || 1);
    if (import.meta.env.DEV && emulatorScale >= .2 && emulatorScale < 1) {
      this.world.renderer.xr.setFramebufferScaleFactor(emulatorScale);
    }
    this.applyComfort();
    this.render();
    void this.loadHero();
  }

  private element(id: string): UIKit.Text {
    let result = this.elements.get(id);
    if (!result) { result = this.panel.requireElementById<UIKit.Text>(id); result.name = id; this.elements.set(id, result); }
    return result;
  }
  private text(id: string, value: string): void { this.element(id).setProperties({ text: questText(value) }); }
  private display(id: string, visible: boolean): void { this.element(id).setProperties({ display: visible ? 'flex' : 'none' }); }
  private finishTransition(): void {
    if (this.outgoingView) {
      this.display(this.outgoingView, false);
      this.element(this.outgoingView).setProperties({ opacity: 1, positionLeft: 0, pointerEvents: 'none' });
    }
    this.outgoingView = null;
    if (this.activeView) this.element(this.activeView).setProperties({ opacity: 1, positionLeft: 0, pointerEvents: 'auto' });
  }
  private showView(view: string): void {
    const motion = this.preferences.motion && !this.reducedMotion.matches;
    if (this.activeView === view) { if (!motion) this.finishTransition(); return; }
    this.finishTransition();
    const previous = this.activeView;
    this.activeView = view;
    for (const id of QUEST_VIEW_IDS) this.display(id, id === view || motion && id === previous);
    if (previous && motion) {
      this.outgoingView = previous; this.transitionTime = 0;
      this.element(view).setProperties(this.fadeIn[0]);
      this.element(previous).setProperties(this.fadeOut[0]);
    } else this.element(view).setProperties({ opacity: 1, positionLeft: 0, pointerEvents: 'auto' });
  }
  private selectControl(id: string): void {
    if (this.state.modal || this.state.paused) return;
    if (id.startsWith('Setting_') && this.state.settingsCategory) {
      const index = Number(id.slice('Setting_'.length));
      if (Number.isInteger(index) && this.settingsIndex !== index) {
        this.settingsIndex = index; this.renderSettings(this.state.settingsCategory); this.writeState();
      }
      return;
    }
    for (const group of Object.keys(SELECTION_GROUPS) as (keyof typeof SELECTION_GROUPS)[]) {
      if (SELECTION_GROUPS[group].includes(id) && this.selected[group] !== id) {
        this.selected[group] = id; this.styleSelections(); this.writeState(); return;
      }
    }
  }
  private styleSelections(): void {
    for (const group of Object.keys(SELECTION_GROUPS) as (keyof typeof SELECTION_GROUPS)[]) {
      for (const id of SELECTION_GROUPS[group]) {
        const selected = this.selected[group] === id;
        const settings = group === 'settings';
        const locked = group === 'chapters' && CHAPTERS.find(item => `Chapter_${item.id}` === id)?.locked;
        this.element(id).setProperties({
          borderWidth: selected ? 1.6 : .5,
          borderColor: selected ? settings ? '#c88917' : MENU_THEME.colors.accent : '#39352a',
        });
        this.panel.getElementById<UIKit.Text>(`${id}_Title`)?.setProperties({ color: locked ? '#777268' : selected ? settings ? '#d99320' : MENU_THEME.colors.accent : settings ? '#a29c8e' : MENU_THEME.colors.inactiveHeading });
        if (!settings) this.panel.getElementById<UIKit.Image>(`${id}_Art`)?.setProperties({ color: '#ffffff', opacity: group === 'chapters' ? locked ? .1166 : selected ? .7616 : .4896 : selected ? 1 : .82 });
        if (settings) {
          const category = id.slice('Settings_'.length);
          this.panel.getElementById<UIKit.Image>(`${id}_Icon`)?.setProperties({ src: publicUrl(`assets/decorations/settings-${category}-${selected ? 'selected' : 'inactive'}.svg`) });
        }
      }
    }
  }
  private dispatch(event: QuestEvent): void {
    const next = reduceQuestState(this.state, event);
    if (next === this.state) return;
    this.state = next;
    if (next.visitComplete) { try { localStorage.setItem(VISIT_KEY, 'true'); } catch { /* Memory-only visit remains usable. */ } }
    this.render();
  }

  private render(): void {
    const s = this.state;
    const view = s.paused ? 'View_Pause' : s.modal ? 'View_Modal'
      : s.screen === 'settings' && s.settingsCategory ? 'View_SettingsDetail'
      : ({ home: 'View_Home', play: 'View_Play', showcase: 'View_Showcase', chapters: 'View_Chapters', settings: 'View_Settings', arenas: 'View_Arenas', library: 'View_Library', chronicles: 'View_Chronicles', onboarding: 'View_Onboarding', visit: 'View_Visit', pause: 'View_Pause' } as const)[s.screen];
    this.showView(view);
    const detail = s.screen === 'chapters' || s.screen === 'chronicles' || s.screen === 'settings' && !!s.settingsCategory;
    const navigationVisible = !s.modal && !s.paused && !detail && s.screen !== 'onboarding' && s.screen !== 'visit';
    for (const tab of NAV_TABS) {
      const id = `Nav_${tab.aria}`;
      this.display(id, navigationVisible);
      const selected = s.screen === tab.aria.toLowerCase() || tab.aria === 'Play' && s.screen === 'chapters' || tab.aria === 'Showcase' && (s.screen === 'arenas' || s.screen === 'library');
      this.element(id).setProperties({ borderWidth: 0 });
      this.element(`${id}_Plate`).setProperties({ opacity: selected ? 1 : 0 });
      this.element(`${id}_Title`).setProperties({ color: selected ? '#19120a' : '#c1bbac', opacity: selected ? 1 : .54 });
    }
    this.display('Btn_VisitReplay', s.screen === 'home' && !s.modal && !s.paused);
    this.display('Btn_Pause', s.entered && !s.paused);
    this.display('Btn_Recenter', s.entered);
    this.display('Btn_Exit', s.entered);
    this.display('Btn_EnterVR', !s.entered && this.canEnter);
    this.display('Btn_Back', !s.paused && !s.modal);
    this.display('Status_Hint', false);
    this.display('Status_Tracking', false);
    // The sorcerer is hidden in Chronicles, so its retry stays off the archive's control surface.
    this.display('Status_Boot', this.modelFailed && s.screen !== 'chronicles');
    this.display('Btn_RetryCreature', this.modelFailed && s.screen !== 'chronicles');
    this.text('Status_Hint', 'Point and pinch, or touch a button.');
    this.text('Status_Tracking', s.entered ? this.trackingLabel() : 'Hands-first / no controller required');
    if (s.modal) {
      const copy = getModalContent(s.modal, CHAPTERS[s.chapterIndex]);
      this.text('Modal_Title', copy.title.toUpperCase()); this.text('Modal_Description', copy.description);
      this.text('Modal_Note', copy.note || ''); this.display('Modal_Note', !!copy.note);
    }
    if (s.screen === 'settings' && s.settingsCategory) this.renderSettings(s.settingsCategory);
    // The archive lives while Chronicles is open, pause included, and shows only on its screen.
    this.chronicles.sync({
      open: s.screen === 'chronicles' || s.paused && s.previousScreen === 'chronicles', shown: s.screen === 'chronicles', scene: s.chronicles,
      posture: this.preferences.posture, textScale: this.preferences.textScale, quality: this.preferences.quality,
      motion: this.preferences.motion && !this.reducedMotion.matches,
    });
    if (this.hero?.object3D) this.hero.object3D.visible = !this.chronicles.open;
    if (s.screen === 'chronicles') this.renderChronicles();
    if (s.screen === 'library') {
      this.display('Library_Art', s.library === 'battles');
      this.display('Library_Archive', s.library === 'replays');
      this.display('Library_Battles_Emblem', s.library === 'battles');
      this.display('Library_Replays_Emblem', s.library === 'replays');
      this.text('Library_Title', s.library === 'battles' ? 'AI BATTLES' : 'MATCH REPLAYS');
      this.text('Library_Description', s.library === 'battles' ? 'Cinematic AI battle playback is not connected in this build.' : 'Match replays are planned for a future update.');
    }
    this.display('Btn_ExploreArenas', s.screen === 'library' && !s.modal && !s.paused);
    if (s.screen === 'arenas') {
      this.panel.requireElementById<UIKit.Image>('Arena_Image').setProperties({ src: publicUrl(ARENAS[s.arenaIndex].source) });
      this.text('Arena_Title', ARENAS[s.arenaIndex].label);
      this.text('Arena_Count', `${s.arenaIndex + 1} / ${ARENAS.length}`);
      ARENAS.forEach((_, index) => this.element(`Arena_${index}`).setProperties({ borderColor: index === s.arenaIndex ? MENU_THEME.colors.activeTab : MENU_THEME.colors.accent }));
    }
    if (s.screen === 'visit') {
      const arena = QUEST_VISIT_ARENAS[s.visitStep];
      this.panel.requireElementById<UIKit.Image>('Visit_Image').setProperties({ src: publicUrl(arena.source) });
      this.text('Visit_Title', s.visitComplete ? 'VISIT COMPLETE' : arena.label.toUpperCase());
      this.text('Visit_Count', s.visitComplete ? 'Three arenas explored' : `${s.visitStep + 1} / ${QUEST_VISIT_STEPS}`);
      this.text('Visit_Body', s.visitComplete ? 'A moment in Crownfall, complete. Select Back to explore the menu, or Exit VR to leave. Your menu preferences are kept.' : `${arena.alt}. Take a look around. Select Next when you are ready.`);
      this.display('Btn_VisitBack', s.visitStep > 0 && !s.visitComplete);
      this.display('Btn_VisitNext', s.visitStep < QUEST_VISIT_STEPS - 1 && !s.visitComplete);
      this.display('Btn_VisitFinish', s.visitStep === QUEST_VISIT_STEPS - 1 && !s.visitComplete);
      this.element('Visit_Scrim').setProperties({ opacity: 0 });
    }
    if (s.paused) {
      this.text('Pause_Title', 'PAUSED'); this.text('Pause_Body', s.pauseReason);
      this.display('Btn_Resume', !s.entered || this.leftTracked || this.rightTracked);
    }
    this.element('Scene_Scrim').setProperties({ opacity: 0 });
    const complete = s.screen === 'visit' && s.visitComplete;
    this.sceneDim = s.modal || s.paused ? .8 : detail ? .58 : this.preferences.contrast === 'high' ? .65 : complete ? .3 : 0;
    this.sceneTint = complete && !s.modal && !s.paused ? 0x39270c : 0x0a0805;
    this.styleSelections();
    document.body.dataset.xr = s.entered ? 'presenting' : 'browser';
    const entry = document.getElementById('enter-vr') as HTMLButtonElement | null;
    if (entry) entry.disabled = !this.canEnter || this.entering;
    this.writeState();
  }

  private trackingLabel(): string {
    return this.leftTracked && this.rightTracked ? 'Both hands ready' : this.leftTracked ? 'Left hand ready' : this.rightTracked ? 'Right hand ready' : 'Bring a hand into view';
  }
  private renderSettings(category: SettingsCategory): void {
    const rows = getQuestSettingsRows(category, this.preferences, this.trackingLabel());
    this.settingsIndex = Math.min(this.settingsIndex, rows.length - 1);
    this.text('Settings_Title', rows[this.settingsIndex]?.label || category.toUpperCase());
    this.text('Settings_Category', category.toUpperCase());
    this.display('Settings_Category', category === 'video');
    this.text('Settings_Description', rows[this.settingsIndex]?.description || 'Select a setting.');
    for (let index = 0; index < QUEST_SETTING_ROWS; index++) {
      const row = rows[index]; this.display(`Setting_${index}`, !!row);
      if (!row) continue;
      this.text(`Setting_Label_${index}`, row.label); this.text(`Setting_Value_${index}`, row.value);
      const selected = index === this.settingsIndex;
      this.element(`Setting_${index}`).setProperties({ borderWidth: 0 });
      this.element(`Setting_${index}_Surface`).setProperties({ backgroundColor: selected ? '#c5bca9' : index % 2 ? '#231f19' : '#1b1813', opacity: selected ? .1 : index % 2 ? .45 : .52 });
      this.element(`Setting_Label_${index}`).setProperties({ color: selected ? MENU_THEME.colors.accent : '#aaa79d' });
      this.element(`Setting_Value_${index}`).setProperties({ color: selected ? MENU_THEME.colors.accent : '#aaa79d' });
    }
  }
  private renderChronicles(): void {
    const scene = this.state.chronicles, marked = chroniclesSelection(scene);
    for (const exhibit of CHRONICLE_EXHIBITS) {
      const tab = QUEST_CHRONICLE_IDS.tab(exhibit.id), selected = exhibit.id === scene.collection;
      this.display(QUEST_CHRONICLE_IDS.pane(exhibit.id), selected);
      this.element(`${tab}_Plate`).setProperties({ opacity: selected ? 1 : 0 });
      this.element(`${tab}_Title`).setProperties({ color: selected ? '#19120a' : '#c1bbac', opacity: selected ? 1 : .54 });
    }
    for (const item of QUEST_CHRONICLE_CONTROLS) {
      const control = QUEST_CHRONICLE_IDS.control(item), selected = item.id === marked;
      this.element(`${control}_Mark`).setProperties({ opacity: selected ? 1 : 0 });
      this.panel.getElementById<UIKit.Text>(`${control}_Plate`)?.setProperties({ opacity: selected ? .1 : 0 });
      this.panel.getElementById<UIKit.Text>(`${control}_Title`)?.setProperties({ color: selected ? MENU_THEME.colors.modalHeading : MENU_THEME.colors.inactiveHeading });
    }
    // The record panel shows registry entries under the content policy, with the marker beside unapproved words.
    const entry = getOpenEntry(scene, CHRONICLES_CONTENT_POLICY);
    this.display(QUEST_CHRONICLE_IDS.record, !!entry);
    if (!entry) return;
    this.element(QUEST_CHRONICLE_IDS.record).setProperties({ positionTop: entry.collection === 'contested' ? QUEST_CHRONICLE_LAYOUT.recordTop.atlas : QUEST_CHRONICLE_LAYOUT.recordTop[entry.collection] });
    const label = entry.label ? CHRONICLE_LABELS[entry.label] : undefined;
    this.text('Record_Label', label?.name ?? ''); this.text('Record_Meaning', label?.meaning ?? '');
    this.text('Record_Title', entry.title); this.text('Record_Body', entry.body);
    const marker = getCanonMarker(entry.canonStatus, CHRONICLES_CONTENT_POLICY);
    this.text(QUEST_CHRONICLE_IDS.recordMarker, marker ?? ''); this.display(QUEST_CHRONICLE_IDS.recordMarker, !!marker);
  }
  private adjustSetting(index: number): void {
    if (this.state.modal || this.state.paused || !this.state.settingsCategory) return;
    const row = getQuestSettingsRows(this.state.settingsCategory, this.preferences, this.trackingLabel())[index];
    if (!row) return;
    this.settingsIndex = index;
    const before = this.preferences;
    this.preferences = adjustQuestPreference(before, row.id);
    if (before !== this.preferences) {
      try { localStorage.setItem(QUEST_PREFERENCES_KEY, JSON.stringify(this.preferences)); } catch { /* In-memory controls remain available. */ }
      this.applyComfort();
      if (before.panelDistance !== this.preferences.panelDistance || before.posture !== this.preferences.posture) this.recenter();
    }
    this.render();
  }
  private applyComfort(): void {
    // Enlarge the entire desktop design uniformly. A35-unit detail row is
    // physically hand-sized without altering the approved visual proportions.
    this.menuObject.scale.setScalar(QUEST_UI_LAYOUT.authoredScale * this.preferences.textScale / 100);
    this.menuObject.position.set(0, this.preferences.posture === 'seated' ? -.12 : -.2, -this.preferences.panelDistance);
    this.heroAnchor.position.z = -this.preferences.panelDistance - .85;
    this.atmosphereObject.position.set(0, this.preferences.posture === 'seated' ? -.12 : -.2, -this.preferences.panelDistance - .85);
    this.atmosphereObject.scale.setScalar(.22 * this.preferences.textScale / 100);
    // While the archive is open the panel keeps the control-surface pose instead.
    this.chronicles.comfort();
    this.world.renderer.xr.setFoveation({ low: 1, medium: .5, high: 0 }[this.preferences.quality]);
    if (!this.world.renderer.xr.isPresenting) this.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * { low: .75, medium: 1, high: 1.15 }[this.preferences.quality]);
  }
  private recenter(now = false): void {
    // In Chronicles the archive re-places the panel and the room under its fade.
    if (!now && this.chronicles.recenter(() => this.recenter(true))) return;
    this.player.head.updateWorldMatrix(true, false);
    this.player.head.getWorldPosition(this.headPosition);
    this.player.head.getWorldQuaternion(this.headRotation);
    this.headDirection.set(0, 0, -1).applyQuaternion(this.headRotation);
    if (this.headDirection.x * this.headDirection.x + this.headDirection.z * this.headDirection.z < .001) return;
    this.anchor.position.copy(this.headPosition);
    this.anchor.rotation.set(0, Math.atan2(-this.headDirection.x, -this.headDirection.z), 0);
    this.applyComfort();
  }
  private writeState(): void {
    const e = this.stateEntity, c = CrownfallQuestState, s = this.state;
    e.setValue(c, 'screen', s.screen); e.setValue(c, 'modal', s.modal || '');
    e.setValue(c, 'category', s.settingsCategory || ''); e.setValue(c, 'entered', s.entered);
    e.setValue(c, 'paused', s.paused); e.setValue(c, 'pauseReason', s.pauseReason);
    e.setValue(c, 'visitStep', s.visitStep); e.setValue(c, 'visitComplete', s.visitComplete);
    e.setValue(c, 'chapterIndex', s.chapterIndex); e.setValue(c, 'arenaIndex', s.arenaIndex);
    e.setValue(c, 'quality', this.preferences.quality); e.setValue(c, 'textScale', this.preferences.textScale);
    e.setValue(c, 'panelDistance', this.preferences.panelDistance); e.setValue(c, 'posture', this.preferences.posture);
    e.setValue(c, 'motion', this.preferences.motion);
    e.setValue(c, 'handsTracked', this.leftTracked || this.rightTracked);
    e.setValue(c, 'leftTracked', this.leftTracked); e.setValue(c, 'rightTracked', this.rightTracked);
    e.setValue(c, 'modelReady', !!this.hero);
    const group = s.screen === 'settings' ? 'settings' : s.screen === 'chapters' ? 'chapters' : s.screen === 'showcase' || s.screen === 'arenas' || s.screen === 'library' ? 'showcase' : s.screen === 'play' ? 'play' : 'home';
    // Chronicles reports its open record's control, then a focused nation's, or its collection tab.
    const marked = s.screen === 'chronicles' ? chroniclesSelection(s.chronicles) : null;
    const record = marked ? getChronicleRecord(marked) : undefined;
    e.setValue(c, 'selectedControl', s.screen === 'chronicles' ? record ? QUEST_CHRONICLE_IDS.control(record) : QUEST_CHRONICLE_IDS.tab(s.chronicles.collection)
      : s.screen === 'settings' && s.settingsCategory ? `Setting_${this.settingsIndex}` : this.selected[group]);
  }

  // Browser preview only: a desktop window cannot look around the archive, so
  // while it is presented the camera tilts down to the monument, turns toward
  // the control surface and widens. In XR the head is the camera and nothing moves.
  private framePreview(delta: number, motion: boolean): void {
    if (this.state.entered) { this.previewView = 0; this.previewBase = null; return; }
    const target = this.state.screen === 'chronicles' && this.chronicles.presenting ? 1 : 0;
    if (target === this.previewView) return;
    const camera = this.world.camera;
    this.previewBase ??= { fov: camera.fov, quaternion: camera.quaternion.clone() };
    this.previewView = motion ? Math.max(0, Math.min(1, this.previewView + Math.sign(target - this.previewView) * delta / PREVIEW_FRAMING.seconds)) : target;
    const t = this.previewView * this.previewView * (3 - 2 * this.previewView);
    camera.fov = this.previewBase.fov + (PREVIEW_FRAMING.fov - this.previewBase.fov) * t;
    camera.quaternion.copy(this.previewTurn.setFromAxisAngle(PREVIEW_UP, PREVIEW_FRAMING.turn * t)).multiply(this.previewBase.quaternion)
      .multiply(this.previewTilt.setFromAxisAngle(PREVIEW_AXIS, PREVIEW_FRAMING.tilt * t));
    camera.updateProjectionMatrix();
    if (this.previewView === 0) this.previewBase = null;
  }

  private onVisibility(visibility: VisibilityState): void {
    if (visibility === VisibilityState.Visible) {
      if (!this.state.entered) {
        this.lastHandTime = performance.now(); this.needRecenter = true;
        this.dispatch({ type: 'enter', firstVisit: !visitCompleted() });
      }
    } else if (visibility === VisibilityState.NonImmersive) {
      if (this.state.entered) this.dispatch({ type: 'exit' });
      this.leftTracked = false; this.rightTracked = false; this.render();
    } else if (this.state.entered) {
      this.dispatch({ type: 'pause', reason: 'Your headset paused the visit. Select Resume when you are ready.' });
    }
  }
  private onHandsFrame(frame: XRFrame): void {
    const space = this.world.xrReferenceSpace, session = this.world.xrSession;
    if (!space || !session || !this.state.entered) return;
    if (this.needRecenter && frame.getViewerPose(space)) { this.needRecenter = false; this.recenter(); }
    let left = false, right = false;
    for (const source of session.inputSources) {
      const wrist = source.hand?.get('wrist');
      if (!wrist || !frame.getJointPose?.(wrist, space)) continue;
      if (source.handedness === 'left') left = true; else right = true;
    }
    if (left || right) this.lastHandTime = performance.now();
    if (left !== this.leftTracked || right !== this.rightTracked) {
      this.leftTracked = left; this.rightTracked = right; this.render();
    }
    if (!left && !right && performance.now() - this.lastHandTime > 750 && !this.state.paused) {
      this.dispatch({ type: 'pause', reason: 'Bring a hand into view, then select Resume. Your place is kept.' });
    }
  }
  private async enter(): Promise<void> {
    if (this.entering || this.state.entered) return;
    if (!this.canEnter) { this.browserStatus('Open this version in a headset browser with hand tracking. You can still preview the room here.'); return; }
    this.entering = true; this.render();
    try { await this.world.launchXR(); }
    catch { this.browserStatus('VR could not start. Allow hand tracking in your headset browser and try again.'); }
    finally { this.entering = false; if (this.alive) this.render(); }
  }
  private async exit(): Promise<void> {
    try { await this.world.exitXR(); this.dispatch({ type: 'exit' }); this.browserStatus('Your place is kept. Enter VR again to continue.'); }
    catch { this.text('Status_Boot', 'Exit did not finish. Try Exit VR again.'); }
  }
  private browserStatus(message: string): void {
    const status = document.getElementById('quest-status'); if (status) status.textContent = message;
  }
  private async loadHero(): Promise<void> {
    if (this.loadingHero || this.hero) return;
    this.loadingHero = true; this.modelFailed = false; this.text('Status_Boot', 'The sorcerer is arriving. The menu is ready.');
    this.display('Btn_RetryCreature', false);
    AssetManager.loadingManager.setURLModifier(url => {
      const name = new URL(url, document.baseURI).pathname.split('/').pop();
      return name && ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js'].includes(name)
        ? publicUrl(`decoders/draco/${name}`) : url;
    });
    try {
      await AssetManager.loadGLTFById('sorcerer');
      if (!this.alive) return;
      const gltf = AssetManager.getGLTF('sorcerer');
      if (!gltf) throw new Error('Sorcerer is unavailable');
      const model = gltf.scene, bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Invalid sorcerer bounds');
      const scale = 2.8 / size.y;
      model.scale.multiplyScalar(scale);
      model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      const idle = gltf.animations.find(clip => /^idle$/i.test(clip.name));
      if (!idle) throw new Error('Sorcerer Idle is missing');
      this.hero = this.world.createTransformEntity(model, { parent: this.world.requireSceneEntity('sorcerer-anchor') });
      model.name = 'Crownfall Sorcerer';
      model.visible = !this.chronicles.open;
      this.mixer = new AnimationMixer(model);
      this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).setEffectiveTimeScale(1).play();
      this.text('Status_Boot', 'Crownfall / menu and arena preview');
      this.writeState();
    } catch {
      if (!this.alive) return;
      this.modelFailed = true;
      this.text('Status_Boot', 'The sorcerer could not load. You can keep exploring or retry.');
      this.display('Btn_RetryCreature', true);
    } finally { this.loadingHero = false; }
  }
  update(delta: number): void {
    if (this.outgoingView) {
      this.transitionTime += delta;
      const frame = Math.min(60, Math.round(this.transitionTime / .24 * 60));
      this.element(this.activeView!).setProperties(this.fadeIn[frame]);
      this.element(this.outgoingView).setProperties(this.fadeOut[frame]);
      if (frame === 60 || !this.preferences.motion || this.reducedMotion.matches) this.finishTransition();
    }
    const motion = this.preferences.motion && !this.reducedMotion.matches;
    const paused = this.state.paused || document.hidden;
    // While the archive is open it is the only moving thing: the atmosphere
    // holds still out of sight and the hidden sorcerer stops animating. Both
    // return when the room closes, at the black point of the exit fade.
    const archive = this.chronicles.open;
    const held = paused || archive;
    if (motion && !held) this.atmosphereTime += delta;
    this.atmosphere.update(this.atmosphereTime, motion, held, this.preferences.quality, this.sceneDim, this.sceneTint);
    this.atmosphereObject.visible = !archive;
    if (this.hero?.object3D) this.hero.object3D.visible = !archive;
    this.chronicles.update(delta, motion && !paused);
    this.framePreview(delta, motion);
    if (!this.mixer || held || !motion) return;
    this.activeTime += delta;
    this.mixer.update(delta);
    this.heroAnchor.rotation.y = -.47 + Math.sin(this.activeTime * .22) * .018;
    this.heroAnchor.position.y = -2.08 + Math.sin(this.activeTime * .6) * .012;
    this.observationTime += delta;
    if (this.observationTime >= .25) {
      this.observationTime = 0;
      this.stateEntity.setValue(CrownfallQuestState, 'animationTime', this.mixer.time);
    }
  }
}
