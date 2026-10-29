import { CHRONICLE_EXHIBITS, getChronicleRecord, hotspotAt } from "../../shared/chronicles/content";
import type { ChronicleExhibitId } from "../../shared/chronicles/types";
import { ARENAS, CHAPTERS, HOME_CONTENT, PLAY_CARDS, SETTINGS_CATEGORIES } from "../../shared/menu/content";
import type { HomeTileAction, MenuPanel, PlayCardId, SettingsCategory, ShowcaseView } from "../../shared/menu/types";

export interface QuestPreferences {
  motion: boolean;
  quality: "low" | "medium" | "high";
  showHints: boolean;
  textScale: 100 | 125 | 150;
  panelDistance: 1.2 | 1.5 | 1.8;
  posture: "seated" | "standing";
  contrast: "standard" | "high";
  volume: number;
}

export const QUEST_PREFERENCES_KEY = "crownfall.quest.preferences";
export const DEFAULT_QUEST_PREFERENCES: Readonly<QuestPreferences> = Object.freeze({
  motion: true, quality: "medium", showHints: true, textScale: 100,
  panelDistance: 1.5, posture: "seated", contrast: "standard", volume: 65,
});

const QUALITY = ["low", "medium", "high"] as const;
const TEXT_SCALE = [100, 125, 150] as const;
const PANEL_DISTANCE = [1.2, 1.5, 1.8] as const;
const POSTURE = ["seated", "standing"] as const;
const CONTRAST = ["standard", "high"] as const;

function member<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

export function normalizeQuestPreferences(value: unknown): QuestPreferences {
  const p = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    motion: typeof p.motion === "boolean" ? p.motion : DEFAULT_QUEST_PREFERENCES.motion,
    quality: member(QUALITY, p.quality, DEFAULT_QUEST_PREFERENCES.quality),
    showHints: typeof p.showHints === "boolean" ? p.showHints : DEFAULT_QUEST_PREFERENCES.showHints,
    textScale: member(TEXT_SCALE, p.textScale, DEFAULT_QUEST_PREFERENCES.textScale),
    panelDistance: member(PANEL_DISTANCE, p.panelDistance, DEFAULT_QUEST_PREFERENCES.panelDistance),
    posture: member(POSTURE, p.posture, DEFAULT_QUEST_PREFERENCES.posture),
    contrast: member(CONTRAST, p.contrast, DEFAULT_QUEST_PREFERENCES.contrast),
    volume: typeof p.volume === "number" && Number.isFinite(p.volume)
      ? Math.round(Math.max(0, Math.min(100, p.volume))) : DEFAULT_QUEST_PREFERENCES.volume,
  };
}

export type QuestNavigationScreen = "home" | "play" | "showcase" | "settings";
export type QuestScreen = QuestNavigationScreen | "chapters" | "arenas" | "library" | "chronicles" | "onboarding" | "visit" | "pause";
type ContentScreen = Exclude<QuestScreen, "pause">;
type ShowcaseOrigin = "home" | "play" | "chapters" | "settings";

export interface QuestState {
  screen: QuestScreen;
  previousScreen: ContentScreen;
  modal: MenuPanel;
  chapterIndex: number;
  arenaIndex: number;
  library: "battles" | "replays";
  settingsCategory: SettingsCategory | null;
  visitStep: number;
  visitComplete: boolean;
  paused: boolean;
  pauseReason: string;
  entered: boolean;
  /** Origins survive pause without overloading its previousScreen snapshot. */
  showcaseOrigin: ShowcaseOrigin;
  settingsOrigin: "home" | "play";
  /** Chronicles keeps its exhibit and open record through pause; the Home tile reopens the Atlas. */
  exhibit: ChronicleExhibitId;
  record: string | null;
}

export type QuestEvent =
  | { type: "nav"; screen: QuestNavigationScreen }
  | { type: "home"; panel: HomeTileAction }
  | { type: "play"; id: PlayCardId }
  | { type: "chapter"; index: number }
  | { type: "showcase"; view: ShowcaseView }
  | { type: "arena"; index: number }
  | { type: "category"; category: SettingsCategory }
  | { type: "exhibit"; exhibit: ChronicleExhibitId }
  | { type: "record"; id: string }
  | { type: "map"; x: number; y: number }
  | { type: "enter"; firstVisit: boolean }
  | { type: "pause"; reason: string }
  | { type: "back" | "confirm" | "cancel" | "exit" | "start-visit" | "skip-visit" | "visit-next" | "visit-back" | "visit-finish" | "resume" | "pause-home" | "close-record" };

export const QUEST_VISIT_ARENAS = ARENAS.slice(0, 3);
export const QUEST_VISIT_STEPS = QUEST_VISIT_ARENAS.length;

export function createQuestState(): QuestState {
  return {
    screen: "home", previousScreen: "home", modal: null,
    chapterIndex: 0, arenaIndex: 0, library: "battles", settingsCategory: null,
    visitStep: 0, visitComplete: false, paused: false, pauseReason: "", entered: false,
    showcaseOrigin: "home", settingsOrigin: "home", exhibit: CHRONICLE_EXHIBITS[0].id, record: null,
  };
}

function content(state: QuestState, screen: ContentScreen): QuestState {
  return { ...state, screen, previousScreen: screen };
}

function nav(state: QuestState, screen: QuestNavigationScreen): QuestState {
  if (screen === "showcase") {
    const origin: ShowcaseOrigin = ["home", "play", "chapters", "settings"].includes(state.screen)
      ? state.screen as ShowcaseOrigin : state.showcaseOrigin;
    return { ...content(state, screen), showcaseOrigin: origin };
  }
  if (screen === "settings") {
    const origin = state.screen === "settings" ? state.settingsOrigin : state.screen === "home" ? "home"
      : state.screen === "showcase" || state.screen === "arenas" || state.screen === "library"
        ? state.showcaseOrigin === "home" ? "home" : "play" : "play";
    return { ...content(state, screen), settingsOrigin: origin, settingsCategory: null };
  }
  return { ...content(state, screen), settingsCategory: null };
}

/** Pure state only: the runtime owns actual XR entry, tracking and rendering. */
export function reduceQuestState(state: QuestState, event: QuestEvent): QuestState {
  if (state.paused && !["pause", "resume", "pause-home", "exit", "enter"].includes(event.type)) return state;
  if (state.modal && !["confirm", "cancel", "back", "pause", "resume", "pause-home", "exit", "enter"].includes(event.type)) return state;

  switch (event.type) {
    case "enter":
      return event.firstVisit
        ? { ...content(state, "onboarding"), entered: true, modal: null, paused: false, pauseReason: "" }
        : { ...state, entered: true };
    case "exit":
      return state.entered ? { ...state, entered: false } : state;
    case "pause":
      return {
        ...state, previousScreen: state.screen === "pause" ? state.previousScreen : state.screen,
        screen: "pause", paused: true, pauseReason: event.reason.trim() || "Paused",
      };
    case "resume":
      return state.paused ? { ...state, screen: state.previousScreen, paused: false, pauseReason: "" } : state;
    case "pause-home":
      return state.paused
        ? { ...content(state, "home"), modal: null, settingsCategory: null, paused: false, pauseReason: "" } : state;
    case "confirm":
      if (!state.modal) return state;
      return state.modal === "quit" ? { ...nav(state, "home"), modal: null } : { ...state, modal: null };
    case "cancel":
      return state.modal ? { ...state, modal: null } : state;
    case "nav":
      return ["home", "play", "showcase", "settings"].includes(event.screen) ? nav(state, event.screen) : state;
    case "home": {
      const tile = state.screen === "home" ? HOME_CONTENT.find(item => item.action === event.panel) : undefined;
      if (!tile) return state;
      return tile.destination === "chronicles"
        ? { ...content(state, "chronicles"), exhibit: CHRONICLE_EXHIBITS[0].id, record: null } : { ...state, modal: event.panel };
    }
    case "play":
      if (state.screen !== "play" || !PLAY_CARDS.some(item => item.id === event.id)) return state;
      return event.id === "chapters" ? content(state, "chapters") : { ...state, modal: event.id };
    case "chapter": {
      if (state.screen !== "chapters" || !Number.isInteger(event.index)) return state;
      const chapter = CHAPTERS[event.index];
      if (!chapter) return state;
      return { ...state, chapterIndex: event.index, modal: !chapter.locked && chapter.previewable ? "chapter-preview" : null };
    }
    case "showcase":
      if (!["showcase", "arenas", "library"].includes(state.screen)) return state;
      if (event.view === "overview") return content(state, "showcase");
      if (event.view === "arenas") return content(state, "arenas");
      return event.view === "battles" || event.view === "replays"
        ? { ...content(state, "library"), library: event.view } : state;
    case "arena":
      return state.screen === "arenas" && Number.isInteger(event.index) && !!ARENAS[event.index]
        ? { ...state, arenaIndex: event.index } : state;
    case "category":
      return state.screen === "settings" && SETTINGS_CATEGORIES.includes(event.category)
        ? { ...state, settingsCategory: event.category } : state;
    case "exhibit":
      return state.screen === "chronicles" && state.exhibit !== event.exhibit && CHRONICLE_EXHIBITS.some(item => item.id === event.exhibit)
        ? { ...state, exhibit: event.exhibit, record: null } : state;
    case "record": {
      // A record opens from its own exhibit; Atlas records open from their map hotspot.
      const record = state.screen === "chronicles" ? getChronicleRecord(event.id) : undefined;
      return record && record.id !== state.record && record.exhibit === state.exhibit && (record.exhibit !== "atlas" || !!record.hotspot)
        ? { ...state, record: record.id } : state;
    }
    case "map": {
      // Hit-tests the bare map image; empty ground and the centre do nothing.
      const record = state.screen === "chronicles" && state.exhibit === "atlas" ? hotspotAt(event.x, event.y) : null;
      return record && record.id !== state.record ? { ...state, record: record.id } : state;
    }
    case "close-record":
      return state.screen === "chronicles" && state.record ? { ...state, record: null } : state;
    case "start-visit":
      return ["home", "onboarding", "visit"].includes(state.screen)
        ? { ...content(state, "visit"), visitStep: 0, visitComplete: false } : state;
    case "skip-visit":
      return state.screen === "onboarding" || state.screen === "visit" ? content(state, "home") : state;
    case "visit-next":
      return state.screen === "visit" && !state.visitComplete && state.visitStep < QUEST_VISIT_STEPS - 1
        ? { ...state, visitStep: state.visitStep + 1 } : state;
    case "visit-back":
      return state.screen === "visit" && !state.visitComplete && state.visitStep > 0
        ? { ...state, visitStep: state.visitStep - 1 } : state;
    case "visit-finish":
      return state.screen === "visit" && !state.visitComplete && state.visitStep === QUEST_VISIT_STEPS - 1
        ? { ...state, visitComplete: true } : state;
    case "back":
      if (state.modal) return { ...state, modal: null };
      if (state.screen === "chapters") return content(state, "play");
      if (state.screen === "chronicles") return state.record ? { ...state, record: null } : content(state, "home");
      if (state.screen === "arenas" || state.screen === "library") return content(state, "showcase");
      if (state.screen === "showcase") return content(state, state.showcaseOrigin);
      if (state.screen === "settings") return state.settingsCategory
        ? { ...state, settingsCategory: null } : nav(state, state.settingsOrigin);
      if (state.screen === "play") return { ...state, modal: "quit" };
      if (state.screen === "home") return content(state, "play");
      if (state.screen === "onboarding") return content(state, "home");
      if (state.screen === "visit") return state.visitComplete ? content(state, "home")
        : state.visitStep > 0 ? { ...state, visitStep: state.visitStep - 1 } : content(state, "onboarding");
      return state;
  }
}

export interface QuestSettingsRow {
  id: string;
  label: string;
  value: string;
  description: string;
  action?: string;
}

export function getQuestSettingsRows(
  category: SettingsCategory,
  prefs: QuestPreferences,
  tracking = "Waiting for hands",
): readonly QuestSettingsRow[] {
  switch (category) {
    case "general": return [
      { id: "experience", label: "Experience", value: "Quest - hands first", description: "Use either hand to point and pinch, or touch a button. A controller is not required." },
      { id: "ambient-motion", label: "Ambient Motion", value: prefs.motion ? "On" : "Off", action: "ambient-motion", description: "Animate the sorcerer and ambient effects. Your device's reduced-motion setting also applies." },
      { id: "show-hints", label: "Hand Hints", value: prefs.showHints ? "On" : "Off", action: "show-hints", description: "Show reminders for hand selection, pause and returning to the menu." },
      { id: "contrast", label: "Contrast", value: prefs.contrast === "high" ? "High" : "Standard", action: "contrast", description: "Increase panel contrast to keep text clear against the room." },
      { id: "save-preferences", label: "Save Preferences", value: "Automatic", description: "Comfort preferences are saved on this device separately from the desktop version." },
    ];
    case "controls": return [
      { id: "point-pinch", label: "Point + Pinch", value: "Select", description: "Aim at a button with either hand, then pinch to select it." },
      { id: "touch", label: "Touch", value: "Select nearby buttons", description: "Press a nearby button with your fingertip, then lift your finger away." },
      { id: "back", label: "Back", value: "On-screen button", description: "Select Back to return one step. In a dialog, Cancel returns to the same selection." },
      { id: "pause-resume", label: "Pause + Resume", value: "On-screen buttons", description: "Select Pause to take a break. Select Resume when you are ready; your place is kept." },
      { id: "recenter", label: "Recenter Menu", value: "On-screen button", description: "Move the menu in front of your current view without moving your viewpoint." },
      { id: "exit-vr", label: "Exit VR", value: "On-screen button", description: "Return to the browser at any time. No keyboard or controller button is needed." },
      { id: "controllers", label: "Controllers", value: "Optional", description: "Hands are the primary input. You do not need to pair a controller to finish the visit." },
    ];
    case "input": return [
      { id: "hand-tracking", label: "Hand Tracking", value: tracking, description: "Current hand visibility is reported by the immersive session. Bring a hand into view to recover tracking." },
      { id: "supported-hands", label: "Supported Hands", value: "Left + right", description: "Either hand can select menu controls. You do not need to use both hands at once." },
      { id: "interaction", label: "Interaction", value: "Pinch + touch", description: "Point and pinch from a comfortable distance, or directly touch nearby controls." },
      { id: "tracking-loss", label: "Tracking Loss", value: "Pause and recover", description: "Your place is retained when the session pauses. Bring a hand back, then select Resume." },
    ];
    case "video": return [
      { id: "quality", label: "Render Quality", value: prefs.quality[0].toUpperCase() + prefs.quality.slice(1), action: "quality", description: "Adjust preview resolution and headset peripheral shading. Head tracking keeps the headset's native frame timing." },
      { id: "text-scale", label: "Text Size", value: `${prefs.textScale}%`, action: "text-scale", description: "Enlarge the menu and its text to 100%, 125% or 150%." },
      { id: "panel-distance", label: "Menu Distance", value: `${prefs.panelDistance.toFixed(1)} m`, action: "panel-distance", description: "Place the menu 1.2, 1.5 or 1.8 metres away. Recenter keeps it in front of your current view." },
      { id: "posture", label: "Posture", value: prefs.posture === "seated" ? "Seated" : "Standing", action: "posture", description: "Adjust the menu for seated or standing use without artificial movement of your viewpoint." },
      { id: "headset-resolution", label: "Display Resolution", value: "Headset managed", description: "The immersive session controls the headset display. Desktop window resolution settings do not apply here." },
      { id: "headset-frame-rate", label: "Frame Timing", value: "Headset managed", description: "Head tracking uses the headset's immersive frame timing. This menu does not apply a desktop frame-rate cap." },
      { id: "locomotion", label: "Locomotion", value: "Stationary", description: "Menus and the short visit can be used from one place. No joystick movement is required." },
    ];
    case "audio": return [
      { id: "master-volume", label: "Master Volume", value: `${prefs.volume}%`, action: "master-volume", description: "Save your preferred volume. Audio playback is not connected in this menu yet. Select to raise by 5%; after 100%, it returns to 0%." },
      { id: "audio-device", label: "Audio Output", value: "System default", description: "Audio output is managed by your headset and browser." },
      { id: "music", label: "Music", value: "Unavailable", description: "Music playback is not connected in this build." },
      { id: "sfx", label: "Sound Effects", value: "Unavailable", description: "Menu sound effects are not connected in this build." },
    ];
    case "credits": return [
      { id: "project", label: "Project", value: "Crownfall", description: "Crownfall - King's Gambit. A hands-first immersive menu and short environment-artwork visit." },
      { id: "technology", label: "Built With", value: "Immersive Web SDK", description: "The Quest version uses IWSDK and native spatial UI; shared Crownfall content also drives the desktop menu." },
      { id: "artwork", label: "Artwork + Sorcerer", value: "Supplied assets", description: "The environment images, Home artwork and animated sorcerer were supplied for Crownfall." },
      { id: "typefaces", label: "Typefaces", value: "Barlow + spatial text", description: "The desktop menu uses Barlow and Barlow Condensed. Quest uses readable native spatial text." },
      { id: "licenses", label: "Licenses", value: "Included notices", description: "Project code is MIT licensed. Barlow is distributed under the SIL Open Font License. Supplied artwork retains its own rights." },
    ];
  }
}

function cycle<T>(values: readonly T[], value: T): T {
  return values[(values.indexOf(value) + 1) % values.length];
}

/** Unknown and read-only row IDs never mutate preferences. */
export function adjustQuestPreference(prefs: QuestPreferences, id: string): QuestPreferences {
  switch (id) {
    case "ambient-motion": return { ...prefs, motion: !prefs.motion };
    case "show-hints": return { ...prefs, showHints: !prefs.showHints };
    case "contrast": return { ...prefs, contrast: cycle(CONTRAST, prefs.contrast) };
    case "quality": return { ...prefs, quality: cycle(QUALITY, prefs.quality) };
    case "text-scale": return { ...prefs, textScale: cycle(TEXT_SCALE, prefs.textScale) };
    case "panel-distance": return { ...prefs, panelDistance: cycle(PANEL_DISTANCE, prefs.panelDistance) };
    case "posture": return { ...prefs, posture: cycle(POSTURE, prefs.posture) };
    case "master-volume": return { ...prefs, volume: prefs.volume >= 100 ? 0 : Math.min(100, prefs.volume + 5) };
    default: return prefs;
  }
}
