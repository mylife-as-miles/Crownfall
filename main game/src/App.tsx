import { useCallback, useEffect, useRef, useState } from "react";
import Atmosphere from "./Atmosphere";
import CreatureStage from "./CreatureStage";
import HomeGrid from "./HomeGrid";
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
  | "settings"
  | "quit"
  | null;
type Quality = "low" | "medium" | "high";
type Screen = "home" | "play";
type Preferences = { quality: Quality; volume: number; motion: boolean };

const preferencesKey = "crownfall.main-game.preferences";
const initialPreferences: Preferences = {
  quality: "high",
  volume: 65,
  motion: true,
};
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
  { label: "SETTINGS", panel: "settings", aria: "Settings" },
];
const homeDirections: Partial<Record<string, HomeDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

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
    };
  } catch {
    return initialPreferences;
  }
}

export default function App() {
  const [selected, setSelected] = useState<number>(1);
  const [screen, setScreen] = useState<Screen>("play");
  const [homeSelected, setHomeSelected] = useState(0);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] = useState<Preferences>(getPreferences);
  const dialog = useRef<HTMLDialogElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const homeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const homeRight = useRef(1);
  const previousScreen = useRef<Screen>(screen);
  const gamepadInputAt = useRef(0);

  const closePanel = useCallback(() => {
    setPanel(null);
    setActiveTab(screen === "home" ? 0 : 1);
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
  const openTab = useCallback((index: number) => {
    setActiveTab(index);
    setPanel(tabs[index].panel);
    if (index < 2) setScreen(index === 0 ? "home" : "play");
  }, []);
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
    if (panel) closePanel();
    else if (screen === "home") openTab(1);
    else setPanel("quit");
  }, [panel, screen, closePanel, openTab]);

  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

  useEffect(() => {
    if (previousScreen.current === screen) return;
    previousScreen.current = screen;
    const target = screen === "home" ? homeRefs.current[homeSelected] : cardRefs.current[selected];
    target?.focus({ preventScroll: true });
  }, [screen, homeSelected, selected]);

  useEffect(() => {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* Preferences still work when browser storage is unavailable. */
    }
  }, [preferences]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        back();
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        panel
      )
        return;
      const direction = homeDirections[event.key];
      if (screen === "home" && direction) {
        event.preventDefault();
        moveHome(direction);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        selectCard(selected + (event.key === "ArrowRight" ? 1 : -1));
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (screen === "home") selectHome(event.key === "Home" ? 0 : HOME_CONTENT.length - 1);
        else selectCard(event.key === "Home" ? 0 : cards.length - 1);
      }
      if (event.key.toLowerCase() === "q" || event.key.toLowerCase() === "e") {
        event.preventDefault();
        changeTab(event.key.toLowerCase() === "e" ? 1 : -1);
      }
      if (
        event.key === "Enter" &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        if (screen === "home") activateHome(homeSelected);
        else activate(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, panel, screen, homeSelected, activate, activateHome, back, changeTab, moveHome, selectHome, selectCard]);

  useEffect(() => {
    let frame: number;
    const poll = (time: number) => {
      const pad = navigator.getGamepads?.()[0];
      if (pad && time > gamepadInputAt.current) {
        const left = pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.55;
        const down = pad.buttons[13]?.pressed || pad.axes[1] > 0.55;
        const direction: HomeDirection | undefined = left ? "left" : right ? "right" : up ? "up" : down ? "down" : undefined;
        if (!panel && direction && (screen === "home" || left || right)) {
          if (screen === "home") moveHome(direction);
          else selectCard(selected + (right ? 1 : -1));
          gamepadInputAt.current = time + 230;
        } else if (pad.buttons[0]?.pressed) {
          if (!panel) {
            if (screen === "home") activateHome(homeSelected);
            else activate(selected);
          }
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[1]?.pressed) {
          back();
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
  }, [panel, screen, selected, homeSelected, activate, activateHome, back, changeTab, moveHome, selectCard]);

  const activeMode = cards.find((mode) => mode.id === panel);

  return (
    <main className={`menu-shell ${preferences.motion ? "" : "reduce-motion"}`}>
      <div className="menu-stage">
        <div className="scene-wash" aria-hidden="true" />
        <Atmosphere
          quality={preferences.quality}
          reducedMotion={!preferences.motion}
        />
        <CreatureStage reducedMotion={!preferences.motion} />
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

        <footer className="controller-hints" aria-label="Menu controls">
          <button aria-label="Select" onClick={() => screen === "home" ? activateHome(homeSelected) : activate(selected)}>
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
        </footer>
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
            {panel === "settings" && (
              <>
                <h1 id="dialog-heading">Settings</h1>
                <p>Adjust menu effects. Preferences save automatically.</p>
                <div className="settings-fields">
                  <label htmlFor="effect-quality">
                    <span>
                      Particle quality
                      <small>Teal sparks and drifting embers</small>
                    </span>
                    <select
                      id="effect-quality"
                      value={preferences.quality}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          quality: event.target.value as Quality,
                        })
                      }
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label htmlFor="ambient-volume">
                    <span>
                      Ambient volume
                      <small>Saved setting; audio is not connected</small>
                    </span>
                    <input
                      id="ambient-volume"
                      type="range"
                      min="0"
                      max="100"
                      value={preferences.volume}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          volume: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label htmlFor="motion-toggle">
                    <span>
                      Ambient motion
                      <small>Creature and background animation</small>
                    </span>
                    <input
                      id="motion-toggle"
                      type="checkbox"
                      checked={preferences.motion}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          motion: event.target.checked,
                        })
                      }
                    />
                  </label>
                </div>
                <button className="primary-action" onClick={closePanel}>
                  Back to {screen === "home" ? "Home" : "Play"} <span aria-hidden="true">&gt;</span>
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
