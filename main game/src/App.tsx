import { useCallback, useEffect, useRef, useState } from "react";
import Atmosphere from "./Atmosphere";
import CreatureStage from "./CreatureStage";
import HomeGrid from "./HomeGrid";
import Chapters from "./Chapters";
import type { ChapterItem } from "./chapters-content";
import LoadingScreen from "./LoadingScreen";
import useBootLoading from "./useBootLoading";
import MenuTransition from "./MenuTransition";
import MenuDialog from "./MenuDialog";
import Showcase, { type ShowcaseView } from "./Showcase";
import Chronicles, { type ChroniclesHandle } from "./Chronicles";
import { SettingsGrid, SETTINGS_CATEGORIES } from "./SettingsGrid";
import SettingsDetail from "./SettingsDetail";
import { INITIAL_PREFERENCES, normalizeBindings, type BindingAction, type Direction, type FrameLimit, type Preferences, type Quality, type SettingsCategory, type SettingsPageHandle } from "./settings-types";
import { HOME_CONTENT, getNextHomeTile, type HomeDirection } from "./home-content";
import { PLAY_CARDS as cards, NAV_TABS as tabs, getModalContent } from "../../shared/menu/content";
import type { MenuPanel, MenuScreen } from "../../shared/menu/types";
import "./styles.css";

type Panel = MenuPanel;
type Screen = MenuScreen;

const preferencesKey = "crownfall.main-game.preferences";
const initialPreferences = INITIAL_PREFERENCES;

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
  const [chapterSelected, setChapterSelected] = useState(0);
  const [chapterPreview, setChapterPreview] = useState<ChapterItem | null>(null);
  const [showcaseView, setShowcaseView] = useState<ShowcaseView>("overview");
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [settingsSelected, setSettingsSelected] = useState(0);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | null>(null);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] = useState<Preferences>(getPreferences);
  const reducedMotion = !preferences.motion || systemReducedMotion;
  const boot = useBootLoading(reducedMotion);
  const continueBoot = boot.continueToMenu;
  const retryBoot = boot.retry;
  const bootKeys = useRef(new Set<string>());
  const bootPadBlocked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastPanel = useRef<Panel>(null);
  const showcaseRef = useRef<SettingsPageHandle>(null);
  const chaptersRef = useRef<SettingsPageHandle>(null);
  const chroniclesRef = useRef<ChroniclesHandle>(null);
  const showcaseOrigin = useRef<"home" | "play" | "settings" | "chapters">("play");
  const previousShowcaseView = useRef<ShowcaseView>(showcaseView);
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
  const gamepadConfirmHeld = useRef(false);
  const gamepadBackHeld = useRef(false);

  const closePanel = useCallback(() => {
    restoreFocus.current = true;
    setPanel(null);
    setActiveTab(screen === "home" ? 0 : screen === "settings" ? 3 : screen === "showcase" ? 2 : 1);
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
    if (boot.blocking) return;
    setSettingsSelected(index);
    setTransitionDirection(1);
    setSettingsCategory(SETTINGS_CATEGORIES[index]);
  }, [boot.blocking]);
  const openTab = useCallback((index: number, direction?: number) => {
    if (boot.blocking) return;
    setTransitionDirection(direction ?? (index >= activeTab ? 1 : -1));
    setActiveTab(index);
    setPanel(null);
    if (index < 2) {
      setScreen(index === 0 ? "home" : "play");
      setSettingsCategory(null);
    } else if (index === 2) {
      if (screen !== "showcase") showcaseOrigin.current = screen === "chronicles" ? "home" : screen;
      setScreen("showcase");
      setShowcaseView("overview");
    } else if (index === 3) {
      if (screen === "home" || screen === "play") settingsOrigin.current = screen;
      else if (screen === "chronicles") settingsOrigin.current = "home";
      else if (screen === "chapters") settingsOrigin.current = "play";
      else if (screen === "showcase" && showcaseOrigin.current !== "settings") settingsOrigin.current = showcaseOrigin.current === "chapters" ? "play" : showcaseOrigin.current;
      setScreen("settings");
      setSettingsCategory(null);
    }
  }, [screen, activeTab, boot.blocking]);
  const confirmPanel = useCallback(() => {
    if (panel === "quit") openTab(0);
    else closePanel();
  }, [panel, openTab, closePanel]);
  const moveDialogFocus = useCallback((direction: Direction | "first" | "last") => {
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(".dialog-actions button");
    if (!buttons?.length) return;
    const first = direction === "left" || direction === "up" || direction === "first";
    buttons[first ? 0 : buttons.length - 1]?.focus({ preventScroll: true });
  }, []);
  const activateDialogSelection = useCallback(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && dialog.current?.contains(focused)) focused.click();
    else confirmPanel();
  }, [confirmPanel]);
  const changeTab = useCallback((direction: number) => {
    openTab((activeTab + direction + tabs.length) % tabs.length, direction);
  }, [activeTab, openTab]);
  const changeShowcaseView = useCallback((view: ShowcaseView) => {
    if (boot.blocking) return;
    setTransitionDirection(view === "overview" ? -1 : 1);
    setShowcaseView(view);
  }, [boot.blocking]);
  const activate = useCallback((index: number) => {
    if (boot.blocking) return;
    setSelected(index);
    if (cards[index].id === "chapters") {
      setTransitionDirection(1);
      setPanel(null);
      setScreen("chapters");
      setActiveTab(1);
    } else setPanel(cards[index].id);
  }, [boot.blocking]);
  const previewChapter = useCallback((chapter: ChapterItem) => {
    if (boot.blocking) return;
    setChapterPreview(chapter);
    setPanel("chapter-preview");
  }, [boot.blocking]);
  const activateHome = useCallback((index: number) => {
    if (boot.blocking) return;
    const item = HOME_CONTENT[index];
    if (!item?.action || !item.title || !item.imageSrc) return;
    setHomeSelected(index);
    if (item.destination) {
      setTransitionDirection(1);
      setScreen(item.destination);
    } else setPanel(item.action);
  }, [boot.blocking]);
  const back = useCallback(() => {
    if (boot.blocking) return;
    if (panel) { closePanel(); return; }
    setTransitionDirection(-1);
    if (screen === "chapters") { openTab(1, -1); return; }
    if (screen === "chronicles") {
      if (!chroniclesRef.current?.cancel()) openTab(0, -1);
      return;
    }
    if (screen === "showcase") {
      if (showcaseRef.current?.cancel()) return;
      if (showcaseView !== "overview") setShowcaseView("overview");
      else {
        const origin = showcaseOrigin.current;
        setScreen(origin);
        setActiveTab(origin === "home" ? 0 : origin === "settings" ? 3 : 1);
      }
      return;
    }
    if (screen === "settings" && settingsCategory && detailRef.current?.cancel()) return;
    if (screen === "settings" && settingsCategory) setSettingsCategory(null);
    else if (screen === "settings") openTab(settingsOrigin.current === "home" ? 0 : 1);
    else if (screen === "home") openTab(1);
    else setPanel("quit");
  }, [panel, screen, settingsCategory, showcaseView, closePanel, openTab, boot.blocking]);
  const activateSelected = useCallback(() => {
    if (boot.blocking) return;
    if (screen === "home") activateHome(homeSelected);
    else if (screen === "showcase") showcaseRef.current?.activate();
    else if (screen === "chronicles") chroniclesRef.current?.activate();
    else if (screen === "chapters") chaptersRef.current?.activate();
    else if (screen === "settings") {
      if (settingsCategory) detailRef.current?.activate();
      else activateSettings(settingsSelected);
    } else activate(selected);
  }, [screen, homeSelected, settingsCategory, settingsSelected, selected, activateHome, activateSettings, activate, boot.blocking]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (panel) lastPanel.current = panel;
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

  useEffect(() => {
    if (boot.blocking) return;
    if (previousScreen.current === screen && previousCategory.current === settingsCategory && previousShowcaseView.current === showcaseView && !restoreFocus.current) return;
    previousScreen.current = screen;
    previousCategory.current = settingsCategory;
    previousShowcaseView.current = showcaseView;
    restoreFocus.current = false;
    if (panel) return;
    if (screen === "showcase") { showcaseRef.current?.focus(); return; }
    if (screen === "chronicles") { chroniclesRef.current?.focus(); return; }
    if (screen === "chapters") { chaptersRef.current?.focus(); return; }
    if (screen === "settings" && settingsCategory) { detailRef.current?.focus(); return; }
    const target = screen === "home" ? homeRefs.current[homeSelected] : screen === "settings" ? settingsRefs.current[settingsSelected] : cardRefs.current[selected];
    target?.focus({ preventScroll: true });
  }, [screen, settingsCategory, showcaseView, panel, homeSelected, settingsSelected, selected, boot.blocking]);

  useEffect(() => {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* Preferences still work when browser storage is unavailable. */
    }
  }, [preferences]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (boot.blocking) { bootKeys.current.add(event.code); return; }
      if (bootKeys.current.has(event.code)) return;
      const action = (Object.entries(preferences.bindings) as [BindingAction, string][]).find(([, code]) => code === event.code)?.[0];
      if (event.repeat && (action === "select" || action === "back" || event.code === "Escape")) {
        event.preventDefault();
        return;
      }
      if (event.code === "Escape" || action === "back") {
        event.preventDefault();
        back();
        return;
      }
      if (panel) {
        if (action === "previousTab" || action === "nextTab") event.preventDefault();
        else if (action && ["left", "right", "up", "down", "first", "last"].includes(action)) {
          event.preventDefault();
          moveDialogFocus(action as Direction | "first" | "last");
        } else if (action === "select" && !((event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          activateDialogSelection();
        }
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (action === "previousTab" || action === "nextTab") {
        event.preventDefault();
        // Inside Chronicles, Q/E cycle its collections; Back returns Home.
        if (screen === "chronicles") chroniclesRef.current?.cycle(action === "nextTab" ? 1 : -1);
        else changeTab(action === "nextTab" ? 1 : -1);
        return;
      }
      const direction = action && ["left", "right", "up", "down"].includes(action) ? action as Direction : undefined;
      if (direction) {
        event.preventDefault();
        if (screen === "home") moveHome(direction);
        else if (screen === "showcase") showcaseRef.current?.move(direction);
        else if (screen === "chronicles") chroniclesRef.current?.move(direction);
        else if (screen === "chapters") chaptersRef.current?.move(direction);
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
        else if (screen === "showcase") showcaseRef.current?.edge?.(!first);
        else if (screen === "chronicles") chroniclesRef.current?.edge?.(!first);
        else if (screen === "chapters") chaptersRef.current?.edge?.(!first);
        else if (screen === "play") selectCard(first ? 0 : cards.length - 1);
      }
      if (action === "select" && !((event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        activateSelected();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { bootKeys.current.delete(event.code); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [preferences.bindings, panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectHome, selectSettings, selectCard, moveDialogFocus, activateDialogSelection, boot.blocking]);

  useEffect(() => {
    let frame: number;
    const poll = (time: number) => {
      const pad = Array.from(navigator.getGamepads?.() || []).find((item) => item?.connected && item.mapping === "standard");
      if (boot.blocking) {
        bootPadBlocked.current = !!pad && (pad.buttons.some(button => button.pressed) || pad.axes.some(axis => Math.abs(axis) > .55));
        if (pad && time > gamepadInputAt.current) {
          if (boot.canContinue && pad.buttons[0]?.pressed) { continueBoot(); gamepadInputAt.current = time + 500; }
          else if (boot.degraded && pad.buttons[3]?.pressed) { retryBoot(); gamepadInputAt.current = time + 500; }
        }
        frame = requestAnimationFrame(poll);
        return;
      }
      if (bootPadBlocked.current && pad) {
        if (pad.buttons.some(button => button.pressed) || pad.axes.some(axis => Math.abs(axis) > .55)) {
          frame = requestAnimationFrame(poll);
          return;
        }
        bootPadBlocked.current = false;
      }
      if (!pad?.buttons[0]?.pressed) gamepadConfirmHeld.current = false;
      if (!pad?.buttons[1]?.pressed) gamepadBackHeld.current = false;
      if (pad && time > gamepadInputAt.current) {
        const left = pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.55;
        const down = pad.buttons[13]?.pressed || pad.axes[1] > 0.55;
        const direction: Direction | undefined = left ? "left" : right ? "right" : up ? "up" : down ? "down" : undefined;
        if (panel) {
          if (direction) {
            moveDialogFocus(direction);
            gamepadInputAt.current = time + 230;
          } else if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
            gamepadConfirmHeld.current = true;
            activateDialogSelection();
            gamepadInputAt.current = time + 350;
          } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
            gamepadBackHeld.current = true;
            closePanel();
            gamepadInputAt.current = time + 350;
          }
        } else if (direction && (screen !== "play" || left || right)) {
          if (screen === "home") moveHome(direction);
          else if (screen === "showcase") showcaseRef.current?.move(direction);
          else if (screen === "chronicles") chroniclesRef.current?.move(direction);
          else if (screen === "chapters") chaptersRef.current?.move(direction);
          else if (screen === "settings") {
            if (settingsCategory) detailRef.current?.move(direction);
            else moveSettings(direction);
          } else selectCard(selected + (right ? 1 : -1));
          gamepadInputAt.current = time + 230;
        } else if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
          gamepadConfirmHeld.current = true;
          activateSelected();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
          gamepadBackHeld.current = true;
          back();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[3]?.pressed && !panel && screen === "settings" && settingsCategory) {
          detailRef.current?.reset();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) {
          if (screen === "chronicles") chroniclesRef.current?.cycle(pad.buttons[5]?.pressed ? 1 : -1);
          else changeTab(pad.buttons[5]?.pressed ? 1 : -1);
          gamepadInputAt.current = time + 250;
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectCard, moveDialogFocus, activateDialogSelection, closePanel, boot.blocking, boot.canContinue, boot.degraded, continueBoot, retryBoot]);

  const detailScreenOpen = screen === "chapters" || screen === "settings" && !!settingsCategory;
  const displayedPanel = panel || lastPanel.current;
  const modalContent = getModalContent(displayedPanel, chapterPreview);
  const viewKey = screen === "settings" ? `settings:${settingsCategory || "grid"}` : screen === "showcase" ? `showcase:${showcaseView}` : screen;
  // Chronicles draws its own full-stage relief: the motes stand down (low draws
  // none) and the sorcerer holds its pose until it closes.
  const stageResting = screen === "chronicles";

  return (
    <main data-boot-state={boot.visible ? boot.leaving ? "leaving" : boot.degraded ? "degraded" : "loading" : "ready"} className={`menu-shell ${preferences.motion ? "" : "reduce-motion"} ${screen === "settings" ? "is-settings" : ""} ${screen === "settings" && settingsCategory ? "settings-detail-open" : ""} ${detailScreenOpen ? "detail-screen-open" : ""} ${preferences.showHints ? "" : "hide-control-hints"}`}>
      <div className="menu-stage">
        <div className="scene-wash" aria-hidden="true" />
        <Atmosphere
          quality={stageResting ? "low" : preferences.quality}
          reducedMotion={!preferences.motion}
          renderScale={preferences.renderScale}
          frameLimit={preferences.frameLimit}
        />
        <CreatureStage reducedMotion={!preferences.motion || stageResting} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} onLoadState={boot.onModelState} loadAttempt={boot.attempt} />
        <div className="menu-content" inert={boot.blocking} aria-hidden={boot.blocking || undefined}>
        <nav className={`main-nav${screen === "home" ? " main-nav--home" : ""}${screen === "chronicles" ? " main-nav--hidden" : ""}`} aria-label="Main menu" inert={detailScreenOpen || screen === "chronicles"}>
          <button
            className="shoulder-button"
            aria-label="Previous menu tab"
            onClick={() => changeTab(-1)}
          >
            <span>LB</span>
          </button>
          <div className="nav-links" role="tablist" aria-label="Sections">
            <span className="nav-active-indicator" aria-hidden="true" style={{ width: `${[7.5, 6.72, 12.1875, 10.78125][activeTab]}cqw`, transform: `translate3d(${[0, 9.375, 17.97, 32.0325][activeTab]}cqw, 0, 0)` }} />
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

        <MenuTransition viewKey={viewKey} reducedMotion={reducedMotion} direction={transitionDirection}>
        {screen === "home" ? (
          <HomeGrid
            selected={homeSelected}
            onSelect={selectHome}
            onActivate={(_item, index) => activateHome(index)}
            tileRefs={homeRefs}
          />
        ) : screen === "chapters" ? (
          <Chapters ref={chaptersRef} selected={chapterSelected} onSelect={setChapterSelected} onPreview={previewChapter} onBack={back} reducedMotion={reducedMotion} />
        ) : screen === "showcase" ? (
          <Showcase ref={showcaseRef} view={showcaseView} onViewChange={changeShowcaseView} onBackRoot={back} reducedMotion={reducedMotion} />
        ) : screen === "chronicles" ? (
          <Chronicles ref={chroniclesRef} onBack={back} reducedMotion={reducedMotion} quality={preferences.quality} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} bindings={preferences.bindings} />
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

        </MenuTransition>

        {screen !== "showcase" && screen !== "chapters" && screen !== "chronicles" && !(screen === "settings" && settingsCategory) && <footer className="controller-hints" aria-label="Menu controls">
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

        <MenuDialog
          ref={dialog}
          title={modalContent.title}
          description={modalContent.description}
          note={modalContent.note}
          panel={panel || "closed"}
          onConfirm={confirmPanel}
          onCancel={closePanel}
          reducedMotion={reducedMotion}
        />
        </div>
        {boot.visible && <LoadingScreen
          progress={boot.progress}
          status={boot.status}
          ready={boot.ready}
          leaving={boot.leaving}
          reducedMotion={reducedMotion}
          typeReady={boot.typeReady}
          degraded={boot.degraded}
          onRetry={boot.degraded ? boot.retry : undefined}
          onContinue={boot.canContinue ? boot.continueToMenu : undefined}
        />}
      </div>
    </main>
  );
}
