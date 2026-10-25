import { useCallback, useEffect, useRef, useState } from "react";
import Atmosphere from "./Atmosphere";
import CreatureStage from "./CreatureStage";
import "./styles.css";

type Panel =
  | "new"
  | "resume"
  | "load"
  | "browse"
  | "home"
  | "examples"
  | "community"
  | "settings"
  | "quit"
  | null;
type Quality = "low" | "medium" | "high";
type SaveGame = { name: string; chapter: string; updatedAt: string };
type Preferences = { quality: Quality; volume: number; motion: boolean };

const saveKey = "crownfall.main-game.save";
const preferencesKey = "crownfall.main-game.preferences";
const initialPreferences: Preferences = {
  quality: "high",
  volume: 65,
  motion: true,
};
const cards = [
  {
    id: "new",
    title: "NEW",
    subtitle: "Start a fresh game.",
    description:
      "This button opens the way forward. A new story is ready to be written.",
  },
  {
    id: "resume",
    title: "RESUME",
    subtitle: "Continue with your game from your last session.",
    description:
      "This button picks up where a story goes. Return to the world you left behind. The choices that you made, the battles you survived, and the fate of a kingdom are waiting.",
  },
  {
    id: "load",
    title: "LOAD GAME",
    subtitle: "Select which save file you would like to play.",
    description:
      "There is no save in loading systems. Your story is written in the world.",
  },
  {
    id: "browse",
    title: "BROWSE",
    subtitle: "Search for any online Games.",
    description: "Discover other worlds. Find your next adventure.",
  },
] as const;
const tabs: { label: string; panel: Panel; aria: string }[] = [
  { label: "HOME", panel: "home", aria: "Home" },
  { label: "PLAY", panel: null, aria: "Play" },
  { label: "EXAMPLE", panel: "examples", aria: "Explore game examples" },
  { label: "EXAMPLE", panel: "community", aria: "Explore community examples" },
  { label: "SETTINGS", panel: "settings", aria: "Settings" },
];

function getSave(): SaveGame | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(saveKey) || "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("name" in value) ||
      !("chapter" in value) ||
      !("updatedAt" in value)
    )
      return null;
    return typeof value.name === "string" &&
      typeof value.chapter === "string" &&
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt))
      ? (value as SaveGame)
      : null;
  } catch {
    return null;
  }
}

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
  const [activeTab, setActiveTab] = useState<number>(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [save, setSave] = useState<SaveGame | null>(getSave);
  const [preferences, setPreferences] = useState<Preferences>(getPreferences);
  const [characterName, setCharacterName] = useState<string>("The Wanderer");
  const [notice, setNotice] = useState<string>("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gamepadInputAt = useRef(0);

  const closePanel = useCallback(() => {
    setPanel(null);
    setActiveTab(1);
    setNotice("");
  }, []);
  const selectCard = useCallback((index: number) => {
    const next = ((index % cards.length) + cards.length) % cards.length;
    setSelected(next);
    cardRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const changeTab = useCallback((direction: number) => {
    setActiveTab((current) => {
      const next = (current + direction + tabs.length) % tabs.length;
      setPanel(tabs[next].panel);
      return next;
    });
  }, []);
  const activate = useCallback((index: number) => {
    setSelected(index);
    setNotice("");
    setPanel(cards[index].id);
  }, []);

  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

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
        if (panel) closePanel();
        else setPanel("quit");
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        panel
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        selectCard(selected + (event.key === "ArrowRight" ? 1 : -1));
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        selectCard(event.key === "Home" ? 0 : cards.length - 1);
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
        activate(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, panel, activate, changeTab, closePanel, selectCard]);

  useEffect(() => {
    let frame: number;
    const poll = (time: number) => {
      const pad = navigator.getGamepads?.()[0];
      if (pad && time > gamepadInputAt.current) {
        const left = pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        if (left || right) {
          if (!panel) selectCard(selected + (right ? 1 : -1));
          gamepadInputAt.current = time + 230;
        } else if (pad.buttons[0]?.pressed) {
          if (!panel) activate(selected);
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[1]?.pressed) {
          if (panel) closePanel();
          else setPanel("quit");
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
  }, [panel, selected, activate, changeTab, closePanel, selectCard]);

  function startJourney() {
    const next: SaveGame = {
      name: characterName.trim() || "The Wanderer",
      chapter: "Chapter I · The Fallen Crown",
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(next));
    } catch {
      setNotice(
        "Your journey is available for this session. Browser storage is unavailable.",
      );
    }
    setSave(next);
    setPanel("resume");
    try {
      setNotice(
        localStorage.getItem(saveKey)
          ? "Your journey has been saved on this device."
          : "Your journey is available for this session.",
      );
    } catch {
      setNotice("Your journey is available for this session.");
    }
  }

  return (
    <main className={`menu-shell ${preferences.motion ? "" : "reduce-motion"}`}>
      <div className="menu-stage">
        <div className="scene-wash" aria-hidden="true" />
        <Atmosphere
          quality={preferences.quality}
          reducedMotion={!preferences.motion}
        />
        <CreatureStage reducedMotion={!preferences.motion} />
        <nav className="main-nav" aria-label="Main menu">
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
                onClick={() => {
                  setActiveTab(index);
                  setPanel(tab.panel);
                  setNotice("");
                }}
              >
                {tab.label}
                {index === 3 && (
                  <span className="nav-notification" aria-label="New content">
                    !
                  </span>
                )}
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

        <section className="game-cards" aria-label="Play options">
          {cards.map((card, index) => (
            <button
              key={card.id}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              tabIndex={selected === index ? 0 : -1}
              className={`game-card card-${card.id} ${selected === index ? "is-selected" : ""}`}
              aria-label={
                card.title === "LOAD GAME"
                  ? "Load game"
                  : card.title.charAt(0) + card.title.slice(1).toLowerCase()
              }
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

        <footer className="controller-hints" aria-label="Menu controls">
          <button aria-label="Select" onClick={() => activate(selected)}>
            <span className="controller-key" aria-hidden="true">
              A
            </span>
            <span>Select</span>
          </button>
          <button aria-label="Quit" onClick={() => setPanel("quit")}>
            <span className="controller-key" aria-hidden="true">
              B
            </span>
            <span>Quit</span>
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
            {panel === "new" && (
              <>
                <h1 id="dialog-heading">A new beginning.</h1>
                <p>Every kingdom has a story. This one begins with you.</p>
                {save && (
                  <p className="dialog-note">
                    Starting a new journey will replace your saved journey.
                  </p>
                )}
                <label className="field-label" htmlFor="character-name">
                  Your name
                </label>
                <input
                  id="character-name"
                  value={characterName}
                  maxLength={32}
                  onChange={(event) => setCharacterName(event.target.value)}
                />
                <button className="primary-action" onClick={startJourney}>
                  Begin journey <span>↗</span>
                </button>
              </>
            )}
            {panel === "resume" && (
              <>
                <h1 id="dialog-heading">
                  {save ? "Your journey awaits." : "Your story is unwritten."}
                </h1>
                <p>
                  {save
                    ? `${save.name}, the kingdom remembers.`
                    : "Begin a new journey to create your first save."}
                </p>
                {save && (
                  <div className="save-slot">
                    <span className="save-mark">♜</span>
                    <div>
                      <strong>{save.chapter}</strong>
                      <small>
                        {save.name} · Saved{" "}
                        {new Date(save.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                  </div>
                )}
                <p className="dialog-note">
                  {save
                    ? "The game world will be connected here as development continues."
                    : "Progress is stored locally on this device."}
                </p>
                <button
                  className="primary-action"
                  onClick={() => (save ? closePanel() : setPanel("new"))}
                >
                  {save ? "Return to menu" : "Start a new journey"}
                  <span>↗</span>
                </button>
              </>
            )}
            {panel === "load" && (
              <>
                <h1 id="dialog-heading">Load a journey.</h1>
                <p>Pick up where you left off.</p>
                {save ? (
                  <button
                    className="save-slot save-button"
                    onClick={() => setPanel("resume")}
                  >
                    <span className="save-mark">♜</span>
                    <span>
                      <strong>{save.chapter}</strong>
                      <small>
                        {save.name} ·{" "}
                        {new Date(save.updatedAt).toLocaleDateString()}
                      </small>
                    </span>
                    <span>→</span>
                  </button>
                ) : (
                  <div className="empty-state">
                    No saved journeys yet.
                    <small>Your first adventure is waiting.</small>
                  </div>
                )}
                {!save && (
                  <button
                    className="primary-action"
                    onClick={() => setPanel("new")}
                  >
                    New journey <span>↗</span>
                  </button>
                )}
              </>
            )}
            {panel === "browse" && (
              <>
                <h1 id="dialog-heading">Beyond the veil.</h1>
                <p>Other worlds will open in time.</p>
                <div className="empty-state">
                  The gates are still closed.
                  <small>Online games are not available yet.</small>
                </div>
                <button className="primary-action" onClick={closePanel}>
                  Return to your world <span>↗</span>
                </button>
              </>
            )}
            {panel === "home" && (
              <>
                <h1 id="dialog-heading">The crown awaits.</h1>
                <p>A kingdom on the edge. A story yet to be told.</p>
                <div className="chapter-line">
                  <span>I</span>
                  <strong>The Fallen Crown</strong>
                  <small>CHAPTER ONE</small>
                </div>
                <button className="primary-action" onClick={closePanel}>
                  Enter the menu <span>↗</span>
                </button>
              </>
            )}
            {(panel === "examples" || panel === "community") && (
              <>
                <h1 id="dialog-heading">
                  {panel === "examples"
                    ? "The training grounds."
                    : "Worlds beyond yours."}
                </h1>
                <p>
                  {panel === "examples"
                    ? "Get familiar with the controls before your journey."
                    : "Discover what is coming to Crownfall."}
                </p>
                <dl className="controls-list">
                  <div>
                    <dt>← / →</dt>
                    <dd>Choose a journey</dd>
                  </div>
                  <div>
                    <dt>Enter / A</dt>
                    <dd>Select</dd>
                  </div>
                  <div>
                    <dt>Q / E · LB / RB</dt>
                    <dd>Switch menu tabs</dd>
                  </div>
                  <div>
                    <dt>Escape / B</dt>
                    <dd>Return</dd>
                  </div>
                </dl>
                <button className="primary-action" onClick={closePanel}>
                  Ready to play <span>↗</span>
                </button>
              </>
            )}
            {panel === "settings" && (
              <>
                <h1 id="dialog-heading">Shape your world.</h1>
                <p>A few small details. A world of difference.</p>
                <div className="settings-fields">
                  <label htmlFor="effect-quality">
                    <span>
                      Particle quality
                      <small>Ambient magic and drifting embers</small>
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
                      <small>Ready for the world's soundscape</small>
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
                      <small>Creature idle and floating particles</small>
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
                  Save & return <span>↗</span>
                </button>
              </>
            )}
            {panel === "quit" && (
              <>
                <h1 id="dialog-heading">Leave the kingdom?</h1>
                <p>Your saved journey will be here when you return.</p>
                <div className="dialog-actions">
                  <button className="secondary-action" onClick={closePanel}>
                    Stay a little longer
                  </button>
                  <button
                    className="primary-action"
                    onClick={() => {
                      setPanel("home");
                      setActiveTab(0);
                    }}
                  >
                    Return home <span>↗</span>
                  </button>
                </div>
              </>
            )}
            {notice && (
              <p className="save-notice" role="status">
                {notice}
              </p>
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
