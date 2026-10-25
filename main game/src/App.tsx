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
    title: "NEW GAMBIT",
    label: "New Gambit",
    subtitle: "Begin a new gambit.",
    description: "Choose your opening. Every move has a cost.",
  },
  {
    id: "resume",
    title: "RESUME GAMBIT",
    label: "Resume Gambit",
    subtitle: "Return to your gambit.",
    description: "Continue where you left the board.",
  },
  {
    id: "load",
    title: "LOAD GAMBIT",
    label: "Load Gambit",
    subtitle: "Choose a saved gambit.",
    description: "Return to a saved position.",
  },
  {
    id: "browse",
    title: "BROWSE GAMBITS",
    label: "Browse Gambits",
    subtitle: "Unavailable in this build.",
    description: "",
  },
] as const;
const tabs: { label: string; panel: Panel; aria: string }[] = [
  { label: "HOME", panel: "home", aria: "Home" },
  { label: "PLAY", panel: null, aria: "Play" },
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
  const [playerName, setPlayerName] = useState<string>("Player");
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

  function createDemoSave() {
    const next: SaveGame = {
      name: playerName.trim() || "Player",
      chapter: "Crownfall · Demo save",
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(next));
    } catch {
      setNotice(
        "Demo save kept for this session. Browser storage is unavailable.",
      );
    }
    setSave(next);
    setPanel("resume");
    try {
      setNotice(
        localStorage.getItem(saveKey)
          ? "Demo save created on this device."
          : "Demo save kept for this session.",
      );
    } catch {
      setNotice("Demo save kept for this session.");
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

        <footer className="controller-hints" aria-label="Menu controls">
          <button aria-label="Select" onClick={() => activate(selected)}>
            <span className="controller-key" aria-hidden="true">
              A
            </span>
            <span>Select</span>
          </button>
          <button aria-label="Back" onClick={() => setPanel("quit")}>
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
            {panel === "new" && (
              <>
                <h1 id="dialog-heading">New Gambit</h1>
                <p>Choose a name for your Crownfall demo save.</p>
                {save && (
                  <p className="dialog-note">
                    This replaces the demo save on this device.
                  </p>
                )}
                <label className="field-label" htmlFor="player-name">
                  Your name
                </label>
                <input
                  id="player-name"
                  value={playerName}
                  maxLength={32}
                  onChange={(event) => setPlayerName(event.target.value)}
                />
                <p className="dialog-note">
                  This preview saves your setup. It does not start a chess game.
                </p>
                <button className="primary-action" onClick={createDemoSave}>
                  Create demo save <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "resume" && (
              <>
                <h1 id="dialog-heading">
                  {save ? "Resume Gambit" : "No saved gambit yet"}
                </h1>
                <p>
                  {save
                    ? `${save.name} · Local demo save`
                    : "Create a new gambit to save a setup on this device."}
                </p>
                {save && (
                  <div className="save-slot">
                    <span className="save-mark">♜</span>
                    <div>
                      <strong>Crownfall · Demo save</strong>
                      <small>
                        {save.name} · Saved{" "}
                        {new Date(save.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                  </div>
                )}
                <p className="dialog-note">
                  This preview does not restore a chess position or launch gameplay.
                </p>
                <button
                  className="primary-action"
                  onClick={() => (save ? closePanel() : setPanel("new"))}
                >
                  {save ? "Back to Play" : "New Gambit"}
                  <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "load" && (
              <>
                <h1 id="dialog-heading">Load Gambit</h1>
                <p>
                  One local demo save slot. Chess positions cannot be restored
                  in this preview.
                </p>
                {save ? (
                  <button
                    className="save-slot save-button"
                    onClick={() => setPanel("resume")}
                  >
                    <span className="save-mark">♜</span>
                    <span>
                      <strong>Crownfall · Demo save</strong>
                      <small>
                        {save.name} ·{" "}
                        {new Date(save.updatedAt).toLocaleDateString()}
                      </small>
                    </span>
                    <span aria-hidden="true">&gt;</span>
                  </button>
                ) : (
                  <div className="empty-state">
                    No saved gambit yet.
                    <small>Create a new gambit to add a demo save.</small>
                  </div>
                )}
                {!save && (
                  <button
                    className="primary-action"
                    onClick={() => setPanel("new")}
                  >
                    New Gambit <span aria-hidden="true">&gt;</span>
                  </button>
                )}
              </>
            )}
            {panel === "browse" && (
              <>
                <h1 id="dialog-heading">Browse Gambits</h1>
                <p>Online play is not connected in this preview.</p>
                <div className="empty-state">
                  No online matches available.
                  <small>This menu supports local demo saves only.</small>
                </div>
                <button className="primary-action" onClick={closePanel}>
                  Back to Play <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "home" && (
              <>
                <h1 id="dialog-heading">Crownfall</h1>
                <p>A King’s Gambit Story.</p>
                <div className="chapter-line">
                  <span aria-hidden="true">♔</span>
                  <strong>Every sacrifice has a name.</strong>
                  <small>CINEMATIC CHESS</small>
                </div>
                <p className="dialog-note">
                  This menu preview stores a local demo save. It does not launch
                  the chess campaign.
                </p>
                <button className="primary-action" onClick={closePanel}>
                  Open Play <span aria-hidden="true">&gt;</span>
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
                  Back to Play <span aria-hidden="true">&gt;</span>
                </button>
              </>
            )}
            {panel === "quit" && (
              <>
                <h1 id="dialog-heading">Return to Home?</h1>
                <p>Your local demo save stays on this device.</p>
                <div className="dialog-actions">
                  <button className="secondary-action" onClick={closePanel}>
                    Stay in Play
                  </button>
                  <button
                    className="primary-action"
                    onClick={() => {
                      setPanel("home");
                      setActiveTab(0);
                    }}
                  >
                    Go to Home <span aria-hidden="true">&gt;</span>
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
