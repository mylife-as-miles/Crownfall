import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Crown,
  LockKeyhole,
  Settings as SettingsIcon,
  Shield,
  Swords,
  Users,
} from "lucide-react";

import type { CampaignDifficulty } from "../campaign/types";
import type { DemoOptions, Difficulty, Faction } from "../core/types";
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
  hasCampaign: boolean;
  campaignError: string | null;
  onOpenSettings: () => void;
  attract: boolean;
  onInteract: () => void;
}

type MenuMode = "campaign" | "classic" | "hotseat" | "demo";

const DIFFICULTY_COPY: Record<Difficulty, string> = {
  easy: "Squire — swift, forgiving play",
  medium: "Knight — measured tactical search",
  hard: "Warlord — full search, no mercy",
};

const CAMPAIGN_DIFFICULTY: { id: CampaignDifficulty; title: string; copy: string }[] = [
  { id: "story", title: "Story", copy: "Threat warnings, protected essential characters, forgiving fates." },
  { id: "tactician", title: "Tactician", copy: "Limited guidance, capable commanders, lasting consequences." },
  { id: "grandmaster", title: "Grandmaster", copy: "Minimal assistance, severe fates, the strongest search." },
  { id: "iron-crown", title: "Iron Crown", copy: "Single-save intent and the harshest deterministic outcomes." },
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

export function MainMenu({
  onStart,
  onNewCampaign,
  onContinueCampaign,
  hasCampaign,
  campaignError,
  onOpenSettings,
  attract,
  onInteract,
}: MainMenuProps) {
  const [mode, setMode] = useState<MenuMode>("campaign");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [campaignDifficulty, setCampaignDifficulty] = useState<CampaignDifficulty>("story");
  const [playerColor, setPlayerColor] = useState<Faction>("w");
  const [clock, setClock] = useState<number | null>(null);
  const [demoWhite, setDemoWhite] = useState<Difficulty>("medium");
  const [demoBlack, setDemoBlack] = useState<Difficulty>("hard");
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoLoop, setDemoLoop] = useState(true);
  const [confirmNewCampaign, setConfirmNewCampaign] = useState(false);

  const startMatch = (): void => {
    const gameMode = mode === "hotseat" ? "hotseat" : mode === "demo" ? "demo" : "ai";
    onStart({
      mode: gameMode,
      difficulty,
      playerColor,
      clockMinutes: gameMode === "demo" ? null : clock,
      demo: gameMode === "demo" ? { white: demoWhite, black: demoBlack, speed: demoSpeed, autoRematch: demoLoop } : undefined,
    });
  };

  return (
    <div
      className="mc-menu pointer-events-auto absolute inset-0 flex items-center justify-center overflow-hidden px-4 py-4 sm:px-6"
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="cf-menu-layout w-full max-w-6xl">
        <header className="mc-unfurl cf-title-lockup">
          <p className="mc-display text-[0.62rem] tracking-[0.52em] text-[#b89a64]">A KING&apos;S GAMBIT STORY</p>
          <h1 className="mc-display mc-title-glow mt-2 text-5xl font-bold text-[#f4e3bd] sm:text-7xl">CROWNFALL</h1>
          <div className="mc-rule mt-3 w-56" />
          <p className="mt-3 max-w-md text-sm italic leading-relaxed text-[#c5b28d]">
            {attract
              ? "The old Game continues behind the veil. Move, and the pieces will remember you."
              : "Every sacrifice has a name. Every surviving piece remembers."}
          </p>
        </header>

        <nav className="cf-mode-rail" aria-label="Game modes">
          <ModeButton icon={<Crown size={16} />} active={mode === "campaign"} onClick={() => setMode("campaign")}>
            Story Campaign
          </ModeButton>
          <ModeButton icon={<Swords size={16} />} active={mode === "classic"} onClick={() => setMode("classic")}>
            Classic Chess
          </ModeButton>
          <ModeButton icon={<Users size={16} />} active={mode === "hotseat"} onClick={() => setMode("hotseat")}>
            Local Duel
          </ModeButton>
          <ModeButton icon={<Clapperboard size={16} />} active={mode === "demo"} onClick={() => setMode("demo")}>
            Showcase
          </ModeButton>
          <button type="button" className="cf-mode-button" disabled aria-label="Online Duel, planned">
            <LockKeyhole size={15} /> <span>Online Duel</span><small>Planned</small>
          </button>
          <button type="button" className="cf-mode-button" disabled aria-label="Codex, planned">
            <BookOpen size={15} /> <span>Codex</span><small>Planned</small>
          </button>
        </nav>

        <section className="mc-slate mc-goldleaf mc-rise cf-menu-panel" aria-live="polite">
          <div className="mc-scroll min-h-0 flex-1 overflow-y-auto pr-1">
            {mode === "campaign" ? (
              <div className="mc-fade">
                <p className="cf-kicker">Chapter One</p>
                <h2 className="mc-display mt-2 text-2xl text-[#f2e2bd]">The Pawn Who Would Not Die</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#b7a88a]">
                  Meet the named pieces of Aldermoor, prepare their formation, accept or reject a dangerous Gambit, and
                  carry their identities through three connected chess missions.
                </p>

                {campaignError ? (
                  <div className="cf-save-error mt-4" role="alert">
                    <AlertTriangle size={16} />
                    <span><strong>Campaign save unavailable.</strong>{campaignError}</span>
                  </div>
                ) : null}

                {hasCampaign ? (
                  <button type="button" className="mc-btn mc-btn-primary mt-5 flex w-full items-center justify-between px-4 py-3.5" onClick={onContinueCampaign}>
                    <span className="flex items-center gap-2"><Crown size={16} /> Continue Campaign</span>
                    <ChevronRight size={16} />
                  </button>
                ) : null}

                <div className="mt-6">
                  <p className="cf-kicker">New campaign consequence rules</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {CAMPAIGN_DIFFICULTY.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="cf-difficulty-card"
                        data-active={campaignDifficulty === option.id}
                        aria-pressed={campaignDifficulty === option.id}
                        onClick={() => setCampaignDifficulty(option.id)}
                      >
                        <span className="mc-display text-xs tracking-[0.15em] text-[#e9d4a7]">{option.title}</span>
                        <span>{option.copy}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {confirmNewCampaign ? (
                  <div className="cf-overwrite-warning mt-4" role="alert">
                    <div><AlertTriangle size={17} /><span><strong>Replace the current autosave?</strong><small>The existing campaign will be overwritten.</small></span></div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="mc-btn" onClick={() => setConfirmNewCampaign(false)}>Keep current</button>
                      <button type="button" className="mc-btn mc-btn-primary" onClick={() => onNewCampaign(campaignDifficulty)}>Replace save</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="mc-btn mt-4 flex w-full items-center justify-center gap-2" onClick={() => hasCampaign ? setConfirmNewCampaign(true) : onNewCampaign(campaignDifficulty)}>
                    <Shield size={15} /> {hasCampaign ? "Begin a new campaign" : "Begin Chapter One"}
                  </button>
                )}
              </div>
            ) : mode === "classic" ? (
              <div className="mc-fade space-y-5">
                <div>
                  <p className="cf-kicker">King&apos;s Gambit combat engine</p>
                  <h2 className="mc-display mt-2 text-2xl text-[#f2e2bd]">Classic Chess</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#b7a88a]">Pure legal chess. No campaign advantages, injuries, or altered rules.</p>
                </div>
                <ChoiceGrid label="Opponent" values={["easy", "medium", "hard"] as Difficulty[]} active={difficulty} onSelect={setDifficulty} />
                <p className="-mt-3 text-xs italic text-[#9c8b6c]">{DIFFICULTY_COPY[difficulty]}</p>
                <div>
                  <p className="cf-kicker mb-2">Your banner</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["w", "b"] as Faction[]).map((color) => (
                      <button key={color} type="button" className="mc-chip flex items-center justify-center gap-2 py-2.5" data-active={playerColor === color} aria-pressed={playerColor === color} onClick={() => setPlayerColor(color)}>
                        <Crest faction={color} size={18} active={playerColor === color} />{color === "w" ? "Ivory" : "Obsidian"}
                      </button>
                    ))}
                  </div>
                </div>
                <ClockPicker value={clock} onSelect={setClock} />
              </div>
            ) : mode === "hotseat" ? (
              <div className="mc-fade space-y-5">
                <p className="cf-kicker">One board · two commanders</p>
                <h2 className="mc-display text-2xl text-[#f2e2bd]">Local Duel</h2>
                <p className="text-sm italic leading-relaxed text-[#b7a88a]">The camera passes between players while the same deterministic King&apos;s Gambit rules govern every move.</p>
                <ClockPicker value={clock} onSelect={setClock} />
              </div>
            ) : (
              <div className="mc-fade space-y-5">
                <p className="cf-kicker">Cinematic engine duel</p>
                <h2 className="mc-display text-2xl text-[#f2e2bd]">Showcase</h2>
                <ChoiceGrid label="Ivory engine" values={["easy", "medium", "hard"] as Difficulty[]} active={demoWhite} onSelect={setDemoWhite} />
                <ChoiceGrid label="Obsidian engine" values={["easy", "medium", "hard"] as Difficulty[]} active={demoBlack} onSelect={setDemoBlack} />
                <div>
                  <p className="cf-kicker mb-2">Pace</p>
                  <div className="grid grid-cols-4 gap-2">
                    {DEMO_SPEEDS.map((option) => <button key={option.label} type="button" className="mc-chip py-2.5" data-active={demoSpeed === option.value} aria-pressed={demoSpeed === option.value} onClick={() => setDemoSpeed(option.value)}>{option.label}</button>)}
                  </div>
                </div>
                <button type="button" className="mc-chip flex w-full items-center justify-between px-3 py-2.5" data-active={demoLoop} onClick={() => setDemoLoop((loop) => !loop)} aria-pressed={demoLoop}>
                  <span>Loop new duels</span><span className="mc-display text-[0.62rem] tracking-[0.24em]">{demoLoop ? "ON" : "OFF"}</span>
                </button>
              </div>
            )}
          </div>

          {mode !== "campaign" ? (
            <button type="button" className="mc-btn mc-btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3.5 text-sm" onClick={startMatch}>
              {mode === "demo" ? <><Clapperboard size={16} /> Roll the showcase</> : <><Crown size={16} /> Take the field</>}
            </button>
          ) : null}
          <button type="button" className="mc-btn mt-2 flex w-full items-center justify-center gap-2" onClick={onOpenSettings}>
            <SettingsIcon size={15} /> Settings
          </button>
        </section>
      </div>
    </div>
  );
}

function ModeButton({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="cf-mode-button" data-active={active} aria-pressed={active} onClick={onClick}>{icon}<span>{children}</span><ChevronRight size={14} /></button>;
}

function ChoiceGrid({ label, values, active, onSelect }: { label: string; values: Difficulty[]; active: Difficulty; onSelect: (value: Difficulty) => void }) {
  return <div><p className="cf-kicker mb-2">{label}</p><div className="grid grid-cols-3 gap-2">{values.map((value) => <button key={value} type="button" className="mc-chip py-2.5 capitalize" data-active={active === value} aria-pressed={active === value} onClick={() => onSelect(value)}>{value}</button>)}</div></div>;
}

function ClockPicker({ value, onSelect }: { value: number | null; onSelect: (value: number | null) => void }) {
  return <div><p className="cf-kicker mb-2">Hourglass</p><div className="grid grid-cols-4 gap-2">{CLOCKS.map((option) => <button key={option.label} type="button" className="mc-chip py-2.5" data-active={value === option.value} aria-pressed={value === option.value} onClick={() => onSelect(option.value)}>{option.label}</button>)}</div></div>;
}
