import {
  AnimationMixer, AssetManager, Box3, createSystem, Entity, LoopRepeat,
  Object3D, Quaternion, UIKit, UIKitMLAsset, Vector3, VisibilityState,
} from '@iwsdk/core';
import { ARENAS, CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS, SETTINGS_CATEGORIES, SHOWCASE_CATEGORIES, getModalContent } from '../../shared/menu/content';
import { MENU_THEME } from '../../shared/menu/theme';
import type { HomeTileAction, SettingsCategory } from '../../shared/menu/types';
import { CrownfallQuestState } from './quest-components.js';
import {
  adjustQuestPreference, createQuestState, getQuestSettingsRows, normalizeQuestPreferences,
  QUEST_PREFERENCES_KEY, QUEST_VISIT_ARENAS, QUEST_VISIT_STEPS, reduceQuestState,
} from './quest-state.js';
import type { QuestEvent, QuestPreferences, QuestState } from './quest-state.js';
import { QUEST_VIEW_IDS, QUEST_SETTING_ROWS } from './ui-contract.js';

const VISIT_KEY = 'crownfall.quest.visit-complete';
const publicUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`, document.baseURI).href;
const ascii = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '/');
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
  private activeTime = 0;
  private observationTime = 0;
  private canEnter = false;
  private entering = false;
  private headPosition = new Vector3();
  private headDirection = new Vector3();
  private headRotation = new Quaternion();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  init(): void {
    this.panel = this.world.requireSceneObject<UIKitMLAsset>('menu-panel');
    this.stateEntity = this.world.requireSceneEntity('menu-panel');
    this.anchor = this.world.requireSceneEntity('experience-anchor').object3D!;
    this.menuObject = this.stateEntity.object3D!;
    this.heroAnchor = this.world.requireSceneEntity('sorcerer-anchor').object3D!;
    const bind = (id: string, callback: () => void) => {
      const element = this.element(id);
      element.name = id;
      element.addEventListener('click', callback);
      this.cleanupFuncs.push(() => element.removeEventListener('click', callback));
    };
    for (const tab of NAV_TABS) bind(`Nav_${tab.aria}`, () => this.dispatch({ type: 'nav', screen: tab.aria.toLowerCase() as 'home' | 'play' | 'showcase' | 'settings' }));
    for (const item of HOME_CONTENT) bind(`Home_${item.action}`, () => this.dispatch({ type: 'home', panel: item.action as HomeTileAction }));
    for (const item of PLAY_CARDS) bind(`Play_${item.id}`, () => this.dispatch({ type: 'play', id: item.id }));
    CHAPTERS.forEach((_, index) => bind(`Chapter_${CHAPTERS[index].id}`, () => {
      this.dispatch({ type: 'chapter', index });
      if (CHAPTERS[index].locked) this.text('Status_Boot', `${CHAPTERS[index].title} is locked in this preview.`);
    }));
    for (const item of SHOWCASE_CATEGORIES) bind(`Showcase_${item.id}`, () => this.dispatch({ type: 'showcase', view: item.id }));
    ARENAS.forEach((_, index) => bind(`Arena_${index}`, () => this.dispatch({ type: 'arena', index })));
    for (const category of SETTINGS_CATEGORIES) bind(`Settings_${category}`, () => { this.settingsIndex = 0; this.dispatch({ type: 'category', category }); });
    for (let index = 0; index < QUEST_SETTING_ROWS; index++) bind(`Setting_${index}`, () => this.adjustSetting(index));
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
    this.cleanupFuncs.push(() => { this.alive = false; this.mixer?.stopAllAction(); if (this.hero) this.hero.dispose(); });
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
  private text(id: string, value: string): void { this.element(id).setProperties({ text: ascii(value) }); }
  private display(id: string, visible: boolean): void { this.element(id).setProperties({ display: visible ? 'flex' : 'none' }); }
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
      : ({ home: 'View_Home', play: 'View_Play', showcase: 'View_Showcase', chapters: 'View_Chapters', settings: 'View_Settings', arenas: 'View_Arenas', library: 'View_Library', onboarding: 'View_Onboarding', visit: 'View_Visit', pause: 'View_Pause' } as const)[s.screen];
    for (const id of QUEST_VIEW_IDS) this.display(id, id === view);
    const navigationVisible = !s.modal && !s.paused && s.screen !== 'onboarding' && s.screen !== 'visit';
    for (const tab of NAV_TABS) {
      const id = `Nav_${tab.aria}`;
      this.display(id, navigationVisible);
      const selected = s.screen === tab.aria.toLowerCase() || tab.aria === 'Play' && s.screen === 'chapters' || tab.aria === 'Showcase' && (s.screen === 'arenas' || s.screen === 'library');
      this.element(id).setProperties({ backgroundColor: selected ? MENU_THEME.colors.activeTab : MENU_THEME.colors.surface, color: selected ? MENU_THEME.colors.background : MENU_THEME.colors.inactiveHeading });
    }
    this.display('Btn_VisitReplay', s.screen === 'home' && !s.modal && !s.paused);
    this.display('Btn_Pause', s.entered && !s.paused);
    this.display('Btn_Recenter', s.entered);
    this.display('Btn_Exit', s.entered);
    this.display('Btn_EnterVR', !s.entered && this.canEnter);
    this.display('Btn_Back', !s.paused);
    this.display('Status_Hint', this.preferences.showHints);
    this.display('Btn_RetryCreature', this.modelFailed);
    this.text('Status_Hint', 'Point and pinch, or touch a button.');
    this.text('Status_Tracking', s.entered ? this.trackingLabel() : 'Hands-first / no controller required');
    if (s.modal) {
      const copy = getModalContent(s.modal, CHAPTERS[s.chapterIndex]);
      this.text('Modal_Title', copy.title.toUpperCase()); this.text('Modal_Description', copy.description);
      this.text('Modal_Note', copy.note || ''); this.display('Modal_Note', !!copy.note);
    }
    if (s.screen === 'settings' && s.settingsCategory) this.renderSettings(s.settingsCategory);
    if (s.screen === 'library') {
      this.text('Library_Title', s.library === 'battles' ? 'AI BATTLES' : 'MATCH REPLAYS');
      this.text('Library_Description', s.library === 'battles' ? 'Cinematic AI battle playback is not connected in this build.' : 'Match replays are planned for a future update.');
    }
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
      this.element('View_Visit').setProperties({ backgroundColor: s.visitComplete ? '#173d2ce6' : '#100d0800' });
    }
    if (s.paused) {
      this.text('Pause_Title', 'PAUSED'); this.text('Pause_Body', s.pauseReason);
      this.display('Btn_Resume', !s.entered || this.leftTracked || this.rightTracked);
    }
    this.element('Crownfall_UI').setProperties({ backgroundColor: s.modal || s.paused || this.preferences.contrast === 'high' ? '#100d08f0' : '#100d0833' });
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
    this.text('Settings_Title', category.toUpperCase());
    this.text('Settings_Description', rows[this.settingsIndex]?.description || 'Select a setting.');
    for (let index = 0; index < QUEST_SETTING_ROWS; index++) {
      const row = rows[index]; this.display(`Setting_${index}`, !!row);
      if (!row) continue;
      this.text(`Setting_Label_${index}`, row.label); this.text(`Setting_Value_${index}`, row.value);
      this.element(`Setting_${index}`).setProperties({ borderColor: index === this.settingsIndex ? MENU_THEME.colors.activeTab : MENU_THEME.colors.accent });
    }
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
    this.menuObject.scale.setScalar(.1 * this.preferences.textScale / 100);
    this.menuObject.position.set(0, this.preferences.posture === 'seated' ? -.12 : -.2, -this.preferences.panelDistance);
    this.heroAnchor.position.z = -this.preferences.panelDistance - .85;
    this.world.renderer.xr.setFoveation({ low: 1, medium: .5, high: 0 }[this.preferences.quality]);
    if (!this.world.renderer.xr.isPresenting) this.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * { low: .75, medium: 1, high: 1.15 }[this.preferences.quality]);
  }
  private recenter(): void {
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
    if (!this.mixer || this.state.paused || !this.preferences.motion || this.reducedMotion.matches || document.hidden) return;
    this.activeTime += delta;
    this.mixer.update(delta);
    this.heroAnchor.rotation.y = -.47 + Math.sin(this.activeTime * .22) * .018;
    this.heroAnchor.position.y = -2.2 + Math.sin(this.activeTime * .6) * .012;
    this.observationTime += delta;
    if (this.observationTime >= .25) {
      this.observationTime = 0;
      this.stateEntity.setValue(CrownfallQuestState, 'animationTime', this.mixer.time);
    }
  }
}
