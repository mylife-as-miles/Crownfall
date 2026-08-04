import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Crown,
  LoaderCircle,
  LockKeyhole,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  Swords,
  Users,
} from "lucide-react";

import { audio } from "../audio/audioManager";
import type { CampaignMenuSummary } from "../campaign/menuSummary";
import type { CampaignDifficulty } from "../campaign/types";
import type { DemoOptions, Difficulty, Faction } from "../core/types";
import { CharacterPortrait } from "./CharacterPortrait";
import { DifficultyEmblem } from "./DifficultyEmblem";
import { Crest } from "./Heraldry";

export interface MatchConfig {
  mode: "ai" | "hotseat" | "demo";
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  demo?: DemoOptions;
}

interface MainMenuProps {
  onStart: (config: MatchConfig) => void;
  onNewCampaign: (difficulty: CampaignDifficulty) => void;
  onContinueCampaign: () => void;
  campaignSummary: CampaignMenuSummary | null;
  campaignError: string | null;
  onOpenSettings: () => void;
}

type MenuMode = "campaign" | "classic" | "hotseat" | "demo";
type CampaignView = "continue" | "new";

const DIFFICULTY_COPY: Record<Difficulty, string> = {
  easy: "Squire — swift, forgiving play",
  medium: "Knight — measured tactical search",
  hard: "Warlord — full search, no mercy",
};

const CAMPAIGN_DIFFICULTY: {
  id: CampaignDifficulty;
  title: string;
  legend: string;
  copy: string;
}[] = [
  { id: "story", title: "Story", legend: "The Chronicle", copy: "Threat warnings and protected essential characters." },
  { id: "tactician", title: "Tactician", legend: "The War Table", copy: "Limited guidance with lasting consequences." },
  { id: "grandmaster", title: "Grandmaster", legend: "The Deep Game", copy: "Minimal assistance and the strongest search." },
  { id: "iron-crown", title: "Iron Crown", legend: "The Unbroken Oath", copy: "One severe record with deterministic fates." },
];

const DEMO_SPEEDS = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

const CLOCKS: { label: string; value: number | null }[] = [
  { label: "None", value: null },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
];

function saveTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MainMenu({
  onStart,
  onNewCampaign,
  onContinueCampaign,
  campaignSummary,
  campaignError,
  onOpenSettings,
}: MainMenuProps) {
  const [mode, setMode] = useState<MenuMode>("campaign");
  const [campaignView, setCampaignView] = useState<CampaignView>(campaignSummary ? "continue" : "new");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [campaignDifficulty, setCampaignDifficulty] = useState<CampaignDifficulty>("story");
  const [playerColor, setPlayerColor] = useState<Faction>("w");
  const [clock, setClock] = useState<number | null>(null);
  const [demoWhite, setDemoWhite] = useState<Difficulty>("medium");
  const [demoBlack, setDemoBlack] = useState<Difficulty>("hard");
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoLoop, setDemoLoop] = useState(true);
  const [confirmNewCampaign, setConfirmNewCampaign] = useState(false);
  const [pendingAction, setPendingAction] = useState<"continue" | "campaign" | "match" | null>(null);

  const perform = (id: NonNullable<typeof pendingAction>, action: () => void): void => {
    if (pendingAction) return;
    audio.blip("press");
    setPendingAction(id);
    window.requestAnimationFrame(action);
    window.setTimeout(() => setPendingAction(null), 1500);
  };

  const startMatch = (): void => {
    const gameMode = mode === "hotseat" ? "hotseat" : mode === "demo" ? "demo" : "ai";
    perform("match", () => onStart({
      mode: gameMode,
      difficulty,
      playerColor,
      clockMinutes: gameMode === "demo" ? null : clock,
      demo: gameMode === "demo" ? { white: demoWhite, black: demoBlack, speed: demoSpeed, autoRematch: demoLoop } : undefined,
    }));
  };

  const chooseMode = (next: MenuMode): void => {
    if (next !== mode) audio.blip("press");
    setMode(next);
    if (next === "campaign") setCampaignView(campaignSummary ? "continue" : "new");
  };

  return (
    <div className="mc-menu cf-menu pointer-events-auto absolute inset-0 overflow-hidden">
      <div className="cf-menu-contrast" aria-hidden="true" />
      <div className="cf-menu-layout">
        <header className="mc-unfurl cf-title-lockup">
          <div className="cf-title-chapter"><span>Chapter I</span><i /></div>
          <p className="mc-display cf-overline">A King&apos;s Gambit Story</p>
          <h1 className="mc-display mc-title-glow">CROWNFALL</h1>
          <div className="mc-rule" />
          <p className="cf-title-tagline">Every sacrifice has a name. Every surviving piece remembers.</p>
          <div className="cf-title-witness"><span aria-hidden="true">♙</span><p><strong>Cael remembers the first board.</strong><small>The war is no longer played by nameless pieces.</small></p></div>
        </header>

        <nav className="cf-mode-rail" aria-label="Game modes">
          <ModeButton icon={<Crown size={17} />} active={mode === "campaign"} onClick={() => chooseMode("campaign")}>Story Campaign</ModeButton>
          <ModeButton icon={<Swords size={17} />} active={mode === "classic"} onClick={() => chooseMode("classic")}>Classic Chess</ModeButton>
          <ModeButton icon={<Users size={17} />} active={mode === "hotseat"} onClick={() => chooseMode("hotseat")}>Local Duel</ModeButton>
          <ModeButton icon={<Clapperboard size={17} />} active={mode === "demo"} onClick={() => chooseMode("demo")}>Showcase</ModeButton>
          <button type="button" className="cf-mode-button" disabled aria-label="Online Duel, unavailable">
            <LockKeyhole size={16} /><span>Online Duel</span><small>Unavailable</small>
          </button>
          <button type="button" className="cf-mode-button" disabled aria-label="Codex, unavailable">
            <BookOpen size={16} /><span>Codex</span><small>Unavailable</small>
          </button>
        </nav>

        <section className="cf-menu-panel" aria-live="polite" aria-busy={pendingAction !== null}>
          <div className="cf-artifact-rivet cf-artifact-rivet-nw" aria-hidden="true" />
          <div className="cf-artifact-rivet cf-artifact-rivet-se" aria-hidden="true" />
          <div className="cf-artifact-spine" aria-hidden="true"><span>I</span></div>
          <div className="mc-scroll cf-menu-scroll">
            <div key={`${mode}-${campaignView}`} className="cf-menu-content">
              {mode === "campaign" ? (
                <CampaignPanel
                  summary={campaignSummary}
                  campaignError={campaignError}
                  view={campaignView}
                  setView={setCampaignView}
                  difficulty={campaignDifficulty}
                  setDifficulty={setCampaignDifficulty}
                  confirmNew={confirmNewCampaign}
                  setConfirmNew={setConfirmNewCampaign}
                  pending={pendingAction}
                  onContinue={() => perform("continue", onContinueCampaign)}
                  onNew={() => perform("campaign", () => onNewCampaign(campaignDifficulty))}
                />
              ) : mode === "classic" ? (
                <div className="cf-mode-content">
                  <PanelHeading kicker="King's Gambit combat engine" title="Classic Chess" copy="Pure legal chess. No campaign advantages, injuries, or altered rules." />
                  <ChoiceGrid label="Opponent" values={["easy", "medium", "hard"]} active={difficulty} onSelect={setDifficulty} />
                  <p className="cf-option-note">{DIFFICULTY_COPY[difficulty]}</p>
                  <div>
                    <p className="cf-kicker mb-2">Your banner</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["w", "b"] as Faction[]).map((color) => (
                        <button key={color} type="button" className="mc-chip cf-choice-chip" data-active={playerColor === color} aria-pressed={playerColor === color} onClick={() => setPlayerColor(color)}>
                          <Crest faction={color} size={18} active={playerColor === color} />{color === "w" ? "Ivory" : "Obsidian"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ClockPicker value={clock} onSelect={setClock} />
                </div>
              ) : mode === "hotseat" ? (
                <div className="cf-mode-content">
                  <PanelHeading kicker="One board · two commanders" title="Local Duel" copy="The camera passes between players while the same deterministic rules govern every move." />
                  <ClockPicker value={clock} onSelect={setClock} />
                </div>
              ) : (
                <div className="cf-mode-content">
                  <PanelHeading kicker="Cinematic engine duel" title="Showcase" copy="Watch two commanders contest the board with the presentation controls held open." />
                  <ChoiceGrid label="Ivory engine" values={["easy", "medium", "hard"]} active={demoWhite} onSelect={setDemoWhite} />
                  <ChoiceGrid label="Obsidian engine" values={["easy", "medium", "hard"]} active={demoBlack} onSelect={setDemoBlack} />
                  <div><p className="cf-kicker mb-2">Pace</p><div className="grid grid-cols-4 gap-2">{DEMO_SPEEDS.map((option) => <button key={option.label} type="button" className="mc-chip cf-choice-chip" data-active={demoSpeed === option.value} aria-pressed={demoSpeed === option.value} onClick={() => setDemoSpeed(option.value)}>{option.label}</button>)}</div></div>
                  <button type="button" className="mc-chip cf-loop-choice" data-active={demoLoop} onClick={() => setDemoLoop((loop) => !loop)} aria-pressed={demoLoop}><span>Loop new duels</span><strong>{demoLoop ? "On" : "Off"}</strong></button>
                </div>
              )}
            </div>
          </div>

          <footer className="cf-menu-actions">
            {mode !== "campaign" ? <ActionButton loading={pendingAction === "match"} onClick={startMatch}>{mode === "demo" ? "Roll the showcase" : "Take the field"}</ActionButton> : null}
            <button type="button" className="mc-btn cf-secondary-action" onClick={onOpenSettings} disabled={pendingAction !== null}><SettingsIcon size={16} /> Settings</button>
          </footer>
        </section>
      </div>
    </div>
  );
}

function CampaignPanel({ summary, campaignError, view, setView, difficulty, setDifficulty, confirmNew, setConfirmNew, pending, onContinue, onNew }: {
  summary: CampaignMenuSummary | null;
  campaignError: string | null;
  view: CampaignView;
  setView: (view: CampaignView) => void;
  difficulty: CampaignDifficulty;
  setDifficulty: (difficulty: CampaignDifficulty) => void;
  confirmNew: boolean;
  setConfirmNew: (value: boolean) => void;
  pending: "continue" | "campaign" | "match" | null;
  onContinue: () => void;
  onNew: () => void;
}) {
  return (
    <div className="cf-campaign-panel">
      <div className="cf-artifact-heading">
        <div className="cf-chapter-seal"><Crown size={20} /><span>I</span></div>
        <div><p className="cf-kicker">The Chronicle of Aldermoor</p><h2 className="mc-display">The Pawn Who Would Not Die</h2></div>
      </div>

      {campaignError ? <div className="cf-save-error" role="alert"><AlertTriangle size={17} /><span><strong>Campaign record unavailable</strong>{campaignError}</span></div> : null}

      {view === "continue" && summary ? (
        <div className="cf-continue-view">
          <div className="cf-save-dossier">
            <CharacterPortrait characterId={summary.focusCharacter.id} name={summary.focusCharacter.name} title={summary.focusCharacter.title} kind={summary.focusCharacter.kind} status={summary.focusCharacter.status} />
            <div className="cf-save-dossier-copy">
              <p className="cf-kicker">{summary.missionSubtitle} · Current theatre</p>
              <h3 className="mc-display">{summary.missionTitle}</h3>
              <p className="cf-character-title">{summary.focusCharacter.name} · {summary.focusCharacter.title}</p>
              <span className="cf-status-seal" data-status={summary.focusCharacter.status}>{summary.focusCharacter.status}</span>
            </div>
          </div>

          <div className="cf-save-progress" aria-label={`${summary.completedCount} of ${summary.totalCount} missions complete`}>
            <span><strong>{summary.completedCount}</strong> of {summary.totalCount} battles remembered</span>
            <div>{Array.from({ length: summary.totalCount }, (_, index) => <i key={index} data-complete={index < summary.completedCount} data-current={index === summary.completedCount} />)}</div>
          </div>

          <dl className="cf-save-facts">
            <div><dt>Consequence rule</dt><dd>{summary.difficultyLabel}</dd></div>
            <div><dt>Last witnessed</dt><dd><time dateTime={summary.updatedAt}>{saveTimeLabel(summary.updatedAt)}</time></dd></div>
            <div><dt>Recent memory</dt><dd>{summary.lastConsequenceLabel ?? "No battle has yet been forgotten."}</dd></div>
            <div><dt>Gambit</dt><dd>{summary.gambitLabel ?? "No oath currently binds the formation."}</dd></div>
          </dl>

          <ActionButton loading={pending === "continue"} onClick={onContinue}>Continue the chronicle</ActionButton>
          <button type="button" className="cf-text-action" onClick={() => setView("new")} disabled={pending !== null}>Begin another campaign</button>
        </div>
      ) : (
        <div className="cf-new-campaign-view">
          <p className="cf-panel-prose">Choose how much mercy the Chronicle grants. The rules of chess remain unchanged; only warning, memory, and consequence differ.</p>
          <div className="cf-difficulty-grid" role="group" aria-label="Campaign consequence rules">
            {CAMPAIGN_DIFFICULTY.map((option) => (
              <button key={option.id} type="button" className="cf-difficulty-card" data-active={difficulty === option.id} aria-pressed={difficulty === option.id} onClick={() => setDifficulty(option.id)}>
                <DifficultyEmblem difficulty={option.id} />
                <span className="cf-difficulty-copy"><strong className="mc-display">{option.title}</strong><small>{option.legend}</small><em>{option.copy}</em></span>
                <span className="cf-selected-mark" aria-hidden="true">{difficulty === option.id ? "Selected" : "Choose"}</span>
              </button>
            ))}
          </div>

          {confirmNew && summary ? (
            <div className="cf-overwrite-warning" role="alert">
              <div><AlertTriangle size={18} /><span><strong>Break the current seal?</strong><small>The existing chronicle will be replaced.</small></span></div>
              <div className="grid grid-cols-2 gap-2"><button type="button" className="mc-btn" onClick={() => setConfirmNew(false)}>Keep it</button><ActionButton loading={pending === "campaign"} onClick={onNew}>Replace it</ActionButton></div>
            </div>
          ) : (
            <ActionButton loading={pending === "campaign"} onClick={() => summary ? setConfirmNew(true) : onNew()}>Begin Chapter One</ActionButton>
          )}
          {summary ? <button type="button" className="cf-text-action" onClick={() => { setConfirmNew(false); setView("continue"); }} disabled={pending !== null}><ScrollText size={14} /> Return to the current chronicle</button> : null}
        </div>
      )}
    </div>
  );
}

function ActionButton({ loading, onClick, children }: { loading: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="mc-btn mc-btn-primary cf-primary-action" onClick={onClick} disabled={loading} aria-busy={loading}>{loading ? <LoaderCircle className="cf-spinner" size={17} /> : <Crown size={17} />}<span>{loading ? "Opening the Chronicle…" : children}</span><ChevronRight size={16} /></button>;
}

function PanelHeading({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return <div><p className="cf-kicker">{kicker}</p><h2 className="mc-display cf-panel-title">{title}</h2><p className="cf-panel-prose">{copy}</p></div>;
}

function ModeButton({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="cf-mode-button" data-active={active} aria-pressed={active} onClick={onClick}>{icon}<span>{children}</span><ChevronRight size={15} /></button>;
}

function ChoiceGrid({ label, values, active, onSelect }: { label: string; values: Difficulty[]; active: Difficulty; onSelect: (value: Difficulty) => void }) {
  return <div><p className="cf-kicker mb-2">{label}</p><div className="grid grid-cols-3 gap-2">{values.map((value) => <button key={value} type="button" className="mc-chip cf-choice-chip capitalize" data-active={active === value} aria-pressed={active === value} onClick={() => onSelect(value)}>{value}</button>)}</div></div>;
}

function ClockPicker({ value, onSelect }: { value: number | null; onSelect: (value: number | null) => void }) {
  return <div><p className="cf-kicker mb-2">Hourglass</p><div className="grid grid-cols-4 gap-2">{CLOCKS.map((option) => <button key={option.label} type="button" className="mc-chip cf-choice-chip" data-active={value === option.value} aria-pressed={value === option.value} onClick={() => onSelect(option.value)}>{option.label}</button>)}</div></div>;
}
