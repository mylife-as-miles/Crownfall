import { useCallback, useEffect, useRef, useState } from "react";
import Atmosphere from "./Atmosphere";
import CreatureStage from "./CreatureStage";
import HomeGrid from "./HomeGrid";
import { SettingsGrid, SETTINGS_CATEGORIES } from "./SettingsGrid";
import SettingsDetail from "./SettingsDetail";
import { INITIAL_PREFERENCES, normalizeBindings, type BindingAction, type Direction, type FrameLimit, type Preferences, type Quality, type SettingsCategory, type SettingsPageHandle } from "./settings-types";
import { HOME_CONTENT, getNextHomeTile, type HomeDirection } from "./home-content";
import "./styles.css";

type Panel =
  | "classic"
  | "local-duel"
  | "chapters"
  | "online-duel"
  | "legacy"
  | "chronicles"
  | "herald"
  | "showcase"
  | "quit"
  | null;
type Screen = "home" | "play" | "settings";

const preferencesKey = "crownfall.main-game.preferences";
const initialPreferences = INITIAL_PREFERENCES;
const cards = [
  {
    id: "classic",
    artwork: "new",
    title: "CLASSIC",
    label: "Classic",
    subtitle: "Make your opening move.",
    description: "Traditional chess against the computer.",
    preview: "Classic chess against the computer is not connected to this menu.",
  },
  {
    id: "local-duel",
    artwork: "resume",
    title: "LOCAL DUEL",
    label: "Local Duel",
    subtitle: "Share the board.",
    description: "Two players. One device.",
    preview: "Two-player chess on one device is not connected to this menu.",
  },
  {
    id: "chapters",
    artwork: "load",
    title: "CHAPTERS",
    label: "Chapters",
    subtitle: "Choose a chapter.",
    description: "Tactical missions and lasting consequences.",
    preview: "Crownfall's campaign chapters are not connected to this menu.",
  },
  {
    id: "online-duel",
    artwork: "browse",
    title: "ONLINE DUEL",
    label: "Online Duel",
    subtitle: "Unavailable in this build.",
    description: "",
    preview: "Online play is unavailable in this build. No matchmaking service is connected.",
  },
] as const;
const tabs: { label: string; panel: Panel; aria: string }[] = [
  { label: "HOME", panel: null, aria: "Home" },
  { label: "PLAY", panel: null, aria: "Play" },
  { label: "SHOWCASE", panel: "showcase", aria: "Showcase" },
  { label: "SETTINGS", panel: null, aria: "Settings" },
];

function getPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(preferencesKey) || "{}",
    );
    if (!value || typeof value !== "object") return initialPreferences;
    return {
      quality:
        "quality" in value &&
        ["low", "medium", "high"].includes(String(value.quality))
          ? (value.quality as Quality)
          : "high",
      volume:
        "volume" in value &&
        typeof value.volume === "number" &&
        Number.isFinite(value.volume)
          ? Math.min(100, Math.max(0, value.volume))
          : 65,
      motion:
        "motion" in value && typeof value.motion === "boolean"
          ? value.motion
          : true,
      showHints: "showHints" in value && typeof value.showHints === "boolean" ? value.showHints : true,
      renderScale: "renderScale" in value && typeof value.renderScale === "number" && Number.isFinite(value.renderScale) ? Math.min(100, Math.max(50, value.renderScale)) : 100,
      frameLimit: "frameLimit" in value && [0, 30, 60, 120].includes(Number(value.frameLimit)) ? Number(value.frameLimit) as FrameLimit : 0,
      bindings: normalizeBindings("bindings" in value ? value.bindings : undefined),
    };
  } catch {
    return initialPreferences;
  }
}

export default function App() {
  const [selected, setSelected] = useState<number>(1);
  const [screen, setScreen] = useState<Screen>("play");
  const [homeSelected, setHomeSelected] = useState(0);
  const [settingsSelected, setSettingsSelected] = useState(0);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | null>(null);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] = useState<Preferences>(getPreferences);
  const dialog = useRef<HTMLDialogElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const homeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const settingsRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detailRef = useRef<SettingsPageHandle>(null);
  const settingsOrigin = useRef<"home" | "play">("play");
  const previousCategory = useRef<SettingsCategory | null>(null);
  const restoreFocus = useRef(false);
  const homeRight = useRef(1);
  const previousScreen = useRef<Screen>(screen);
  const gamepadInputAt = useRef(0);

  const closePanel = useCallback(() => {
    restoreFocus.current = true;
    setPanel(null);
    setActiveTab(screen === "home" ? 0 : screen === "settings" ? 3 : 1);
  }, [screen]);
  const selectCard = useCallback((index: number) => {
    const next = ((index % cards.length) + cards.length) % cards.length;
    setSelected(next);
    cardRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const selectHome = useCallback((index: number, focus = true) => {
    const next = Math.max(0, Math.min(index, HOME_CONTENT.length - 1));
    if (next > 0) homeRight.current = next;
    setHomeSelected(next);
    if (focus) homeRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const moveHome = useCallback((direction: HomeDirection) => {
    selectHome(getNextHomeTile(homeSelected, direction, homeRight.current));
  }, [homeSelected, selectHome]);
  const selectSettings = useCallback((index: number) => {
    const next = Math.max(0, Math.min(5, index));
    setSettingsSelected(next);
    settingsRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const moveSettings = useCallback((direction: Direction) => {
    const column = settingsSelected % 3;
    const row = Math.floor(settingsSelected / 3);
    const nextColumn = Math.max(0, Math.min(2, column + (direction === "left" ? -1 : direction === "right" ? 1 : 0)));
    const nextRow = Math.max(0, Math.min(1, row + (direction === "up" ? -1 : direction === "down" ? 1 : 0)));
    selectSettings(nextRow * 3 + nextColumn);
  }, [settingsSelected, selectSettings]);
  const activateSettings = useCallback((index: number) => {
    setSettingsSelected(index);
    setSettingsCategory(SETTINGS_CATEGORIES[index]);
  }, []);
  const openTab = useCallback((index: number) => {
    setActiveTab(index);
    setPanel(tabs[index].panel);
    if (index < 2) {
      setScreen(index === 0 ? "home" : "play");
      setSettingsCategory(null);
    } else if (index === 3) {
      if (screen !== "settings") settingsOrigin.current = screen;
      setScreen("settings");
      setSettingsCategory(null);
    }
  }, [screen]);
  const changeTab = useCallback((direction: number) => {
    openTab((activeTab + direction + tabs.length) % tabs.length);
  }, [activeTab, openTab]);
  const activate = useCallback((index: number) => {
    setSelected(index);
    setPanel(cards[index].id);
  }, []);
  const activateHome = useCallback((index: number) => {
    const item = HOME_CONTENT[index];
    if (!item?.action || !item.title || !item.imageSrc) return;
    setHomeSelected(index);
    setPanel(item.action);
  }, []);
  const back = useCallback(() => {
    if (panel) { closePanel(); return; }
    if (screen === "settings" && settingsCategory && detailRef.current?.cancel()) return;
    if (screen === "settings" && settingsCategory) setSettingsCategory(null);
    else if (screen === "settings") openTab(settingsOrigin.current === "home" ? 0 : 1);
    else if (screen === "home") openTab(1);
    else setPanel("quit");
  }, [panel, screen, settingsCategory, closePanel, openTab]);
  const activateSelected = useCallback(() => {
    if (screen === "home") activateHome(homeSelected);
    else if (screen === "settings") {
      if (settingsCategory) detailRef.current?.activate();
      else activateSettings(settingsSelected);
    } else activate(selected);
  }, [screen, homeSelected, settingsCategory, settingsSelected, selected, activateHome, activateSettings, activate]);

  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

  useEffect(() => {
    if (previousScreen.current === screen && previousCategory.current === settingsCategory && !restoreFocus.current) return;
    previousScreen.current = screen;
    previousCategory.current = settingsCategory;
    restoreFocus.current = false;
    if (panel) return;
    if (screen === "settings" && settingsCategory) { detailRef.current?.focus(); return; }
    const target = screen === "home" ? homeRefs.current[homeSelected] : screen === "settings" ? settingsRefs.current[settingsSelected] : cardRefs.current[selected];
    target?.focus({ preventScroll: true });
  }, [screen, settingsCategory, panel, homeSelected, settingsSelected, selected]);

  useEffect(() => {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* Preferences still work when browser storage is unavailable. */
    }
  }, [preferences]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = (Object.entries(preferences.bindings) as [BindingAction, string][]).find(([, code]) => code === event.code)?.[0];
      if (event.code === "Escape" || action === "back") {
        event.preventDefault();
        back();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (action === "previousTab" || action === "nextTab") {
        event.preventDefault();
        changeTab(action === "nextTab" ? 1 : -1);
        return;
      }
      if (panel) return;
      const direction = action && ["left", "right", "up", "down"].includes(action) ? action as Direction : undefined;
      if (direction) {
        event.preventDefault();
        if (screen === "home") moveHome(direction);
        else if (screen === "settings") {
          if (settingsCategory) detailRef.current?.move(direction);
          else moveSettings(direction);
        } else if (direction === "left" || direction === "right") selectCard(selected + (direction === "right" ? 1 : -1));
        return;
      }
      if (action === "first" || action === "last") {
        event.preventDefault();
        const first = action === "first";
        if (screen === "home") selectHome(first ? 0 : HOME_CONTENT.length - 1);
        else if (screen === "settings" && !settingsCategory) selectSettings(first ? 0 : 5);
        else if (screen === "settings") detailRef.current?.edge?.(!first);
        else if (screen === "play") selectCard(first ? 0 : cards.length - 1);
      }
      if (action === "select" && !((event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        activateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preferences.bindings, panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectHome, selectSettings, selectCard]);

  useEffect(() => {
    let frame: number;
    const poll = (time: number) => {
      const pad = Array.from(navigator.getGamepads?.() || []).find((item) => item?.connected && item.mapping === "standard");
      if (pad && time > gamepadInputAt.current) {
        const left = pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.55;
        const down = pad.buttons[13]?.pressed || pad.axes[1] > 0.55;
        const direction: Direction | undefined = left ? "left" : right ? "right" : up ? "up" : down ? "down" : undefined;
        if (!panel && direction && (screen !== "play" || left || right)) {
          if (screen === "home") moveHome(direction);
          else if (screen === "settings") {
            if (settingsCategory) detailRef.current?.move(direction);
            else moveSettings(direction);
          } else selectCard(selected + (right ? 1 : -1));
          gamepadInputAt.current = time + 230;
        } else if (pad.buttons[0]?.pressed) {
          if (!panel) activateSelected();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[1]?.pressed) {
          back();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[3]?.pressed && !panel && screen === "settings" && settingsCategory) {
          detailRef.current?.reset();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) {
          changeTab(pad.buttons[5]?.pressed ? 1 : -1);
          gamepadInputAt.current = time + 250;
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectCard]);

  const activeMode = cards.find((mode) => mode.id === panel);

  return (
    <main className={`menu-shell ${preferences.motion ? "" : "reduce-motion"} ${screen === "settings" ? "is-settings" : ""} ${screen === "settings" && settingsCategory ? "settings-detail-open" : ""} ${preferences.showHints ? "" : "hide-control-hints"}`}>
      <div className="menu-stage">
        <div className="scene-wash" aria-hidden="true" />
        <Atmosphere
          quality={preferences.quality}
          reducedMotion={!preferences.motion}
          renderScale={preferences.renderScale}
          frameLimit={preferences.frameLimit}
        />
        <CreatureStage reducedMotion={!preferences.motion} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} />
        <nav className={`main-nav${screen === "home" ? " main-nav--home" : ""}`} aria-label="Main menu">
          <button
            className="shoulder-button"
            aria-label="Previous menu tab"
            onClick={() => changeTab(-1)}
          >
            <span>LB</span>
          </button>
          <div className="nav-links" role="tablist" aria-label="Sections">
            {tabs.map((tab, index) => (
              <button
                key={tab.aria}
                role="tab"
                aria-selected={activeTab === index}
                aria-label={tab.aria}
                className={`nav-item ${activeTab === index ? "is-active" : ""}`}
                onClick={() => openTab(index)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            className="shoulder-button shoulder-next"
            aria-label="Next menu tab"
            onClick={() => changeTab(1)}
          >
            <span>RB</span>
          </button>
        </nav>

        {screen === "home" ? (
          <HomeGrid
            selected={homeSelected}
            onSelect={selectHome}
            onActivate={(_item, index) => activateHome(index)}
            tileRefs={homeRefs}
          />
        ) : screen === "settings" ? (
          settingsCategory ? <SettingsDetail
            ref={detailRef}
            category={settingsCategory}
            preferences={preferences}
            onChange={setPreferences}
            onBack={back}
          /> : <SettingsGrid
            selected={settingsSelected}
            onSelect={selectSettings}
            onActivate={activateSettings}
            buttonRefs={settingsRefs}
          />
        ) : (
        <section className="game-cards" aria-label="Play options">
          {cards.map((card, index) => (
            <button
              key={card.id}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              tabIndex={selected === index ? 0 : -1}
              className={`game-card card-${card.artwork} ${selected === index ? "is-selected" : ""}`}
              aria-label={card.label}
              aria-pressed={selected === index}
              onPointerMove={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  (event.movementX !== 0 || event.movementY !== 0)
                ) setSelected(index);
              }}
              onFocus={() => setSelected(index)}
              onClick={() => activate(index)}
            >
              <span className="card-art" aria-hidden="true" />
              <span className="card-shade" aria-hidden="true" />
              <span className="card-heading">
                <span className="card-title">{card.title}</span>
                <span className="card-subtitle">{card.subtitle}</span>
              </span>
              <span className="card-description">{card.description}</span>
            </button>
          ))}
        </section>
        )}

        {!(screen === "settings" && settingsCategory) && <footer className="controller-hints" aria-label="Menu controls">
          <button aria-label="Select" onClick={activateSelected}>
            <span className="controller-key" aria-hidden="true">
              A
            </span>
            <span>Select</span>
          </button>
          <button aria-label="Back" onClick={back}>
            <span className="controller-key" aria-hidden="true">
              B
            </span>
            <span>Back</span>
          </button>
        </footer>}
        <div className="film-grain" aria-hidden="true" />

        <dialog
          ref={dialog}
          className="menu-dialog"
          onCancel={(event) => {
            event.preventDefault();
            closePanel();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
          aria-labelledby="dialog-heading"
        >
          <div className="dialog-inner">
            <button
              className="dialog-close"
              onClick={closePanel}
              aria-label="Close dialog"
            >
              ×
            </button>
            <span className="dialog-eyebrow">CROWNFALL</span>
            {activeMode && (
              <>
                <h1 id="dialog-heading">{activeMode.label}</h1>
                <p>{activeMode.preview}</p>
                <p className="dialog-note">Menu preview only. No gameplay will start here.</p>
                <button className="primary-action" onClick={closePanel}>
                  Back to Play <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {(panel === "legacy" || panel === "chronicles" || panel === "herald") && (
              <>
                <h1 id="dialog-heading">
                  {panel === "legacy" ? "My Legacy" : panel === "chronicles" ? "Chronicles" : "Herald Board"}
                </h1>
                <p>
                  {panel === "legacy" ? "Legacy profiles are unavailable in this build." : panel === "chronicles" ? "Chronicles are unavailable in this build." : "The herald board is unavailable in this build."}
                </p>
                <button className="primary-action" onClick={closePanel}>
                  Back to Home <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "showcase" && (
              <>
                <h1 id="dialog-heading">Showcase</h1>
                <p>Showcase matches are not connected to this menu.</p>
                <button className="primary-action" onClick={closePanel}>
                  Back to {screen === "home" ? "Home" : screen === "settings" ? "Settings" : "Play"} <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "quit" && (
              <>
                <h1 id="dialog-heading">Return to Home?</h1>
                <p>Your menu preferences stay on this device.</p>
                <div className="dialog-actions">
                  <button className="secondary-action" onClick={closePanel}>
                    Stay in Play
                  </button>
                  <button
                    className="primary-action"
                    onClick={() => openTab(0)}
                  >
                    Go to Home <span aria-hidden="true">&gt;</span>
                  </button>
                </div>
              </>
            )}
            <div className="dialog-footer">
              <span className="controller-key">B</span>
              <span>Back</span>
              <span className="dialog-rule" />
            </div>
          </div>
        </dialog>
      </div>
    </main>
  );
}
