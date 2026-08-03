import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Crown,
  Eye,
  Flag,
  HeartHandshake,
  Map,
  LogOut,
  ScanLine,
  Settings2,
  Shield,
  Sparkles,
  Swords,
  UserRound,
} from "lucide-react";

import type { CampaignController } from "../campaign/campaignController";
import { CHAPTER_ONE_GAMBITS, getMission } from "../campaign/content/chapterOne";
import type { CampaignSnapshot, HeroPiece } from "../campaign/types";
import type { GameSnapshot, PieceKind } from "../core/types";
import { PIECE_LABEL } from "../core/types";
import "./crownfall.css";

interface CampaignExperienceProps {
  controller: CampaignController;
  snapshot: CampaignSnapshot;
  game: GameSnapshot;
  onLaunchBattle: () => void;
  onReturnToTitle: () => void;
  onOpenSettings: () => void;
  onToggleTactical: () => void;
  tactical: boolean;
}

export function CampaignExperience({ controller, snapshot, game, onLaunchBattle, onReturnToTitle, onOpenSettings, onToggleTactical, tactical }: CampaignExperienceProps) {
  const save = snapshot.save;
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (save?.screen !== "battle") mainRef.current?.focus();
  }, [save?.screen]);
  if (!save) return null;
  const mission = getMission(save.currentMissionId);

  if (save.screen === "battle") {
    const battle = save.activeBattle;
    return (
      <div className="cf-battle-overlay pointer-events-none absolute inset-0 z-20">
        <div className="cf-battle-objective pointer-events-auto">
          <p className="cf-kicker">{mission.subtitle} · {mission.enemyCommanderName}</p>
          <h2 className="mc-display text-base text-[#f2e2bd]">{mission.title}</h2>
          <p>{mission.primaryObjective.description}</p>
          <div className="cf-battle-state">
            <span data-active={game.turn === "w"}>{game.thinking ? "The enemy is considering the line…" : game.turn === "w" ? "Your move" : "Enemy move"}</span>
            <span>{battle?.moveLog.length ?? 0} {battle?.moveLog.length === 1 ? "move recorded" : "moves recorded"}</span>
          </div>
        </div>
        <div className="cf-battle-nameplate">
          <Eye size={14} /> Every figure on this board has a persistent identity.
        </div>
        <div className="cf-battle-toolbar pointer-events-auto" aria-label="Campaign battle controls">
          <button type="button" onClick={onToggleTactical} aria-pressed={tactical} aria-label={tactical ? "Leave tactical view" : "Open tactical view"}><ScanLine size={16} /><span>{tactical ? "Battle view" : "Tactical"}</span></button>
          <button type="button" onClick={onOpenSettings} aria-label="Open settings"><Settings2 size={16} /><span>Settings</span></button>
          <button type="button" onClick={onReturnToTitle} aria-label="Save battle and return to title"><LogOut size={16} /><span>Save &amp; exit</span></button>
        </div>
      </div>
    );
  }

  return (
    <div className="cf-campaign pointer-events-auto absolute inset-0 z-20 overflow-hidden">
      <div className="cf-campaign-backdrop" />
      <header className="cf-campaign-header">
        <button type="button" className="cf-icon-button" onClick={onReturnToTitle} aria-label="Return to title">
          <ArrowLeft size={17} />
        </button>
        <div>
          <p className="cf-kicker">Crownfall · Chapter One</p>
          <p className="mc-display text-sm text-[#e9d4a7]">The Pawn Who Would Not Die</p>
        </div>
        <div className="cf-save-mark" data-error={Boolean(snapshot.saveError)} title={snapshot.saveError ?? "Campaign progress autosaves after every decision"}>
          {snapshot.saveError ? <AlertTriangle size={13} /> : <Check size={13} />} {snapshot.saveError ? "Save failed" : "Autosaved"}
        </div>
      </header>

      <main ref={mainRef} className="cf-campaign-stage mc-scroll" tabIndex={-1} aria-live="polite">
        {save.screen === "prologue" ? <Prologue onChoose={(choice) => controller.recordPrologueChoice(choice)} /> : null}
        {save.screen === "hub" ? <Hub save={save} mission={mission} onBrief={() => controller.openBriefing()} /> : null}
        {save.screen === "briefing" ? <Briefing mission={mission} onFormation={() => controller.openFormation()} onBack={() => controller.returnToHub()} /> : null}
        {save.screen === "formation" ? (
          <Formation
            mission={mission}
            roster={save.roster}
            formation={save.formationDraft}
            ready={controller.formationReady()}
            onAssign={(square, id) => controller.assignCharacter(square, id)}
            onContinue={() => controller.openGambit()}
            onBack={() => controller.openBriefing()}
          />
        ) : null}
        {save.screen === "gambit" ? (
          <Gambit
            mission={mission}
            selected={save.selectedGambitId}
            onSelect={(id) => controller.selectGambit(id)}
            onLaunch={onLaunchBattle}
            onBack={() => controller.openFormation()}
          />
        ) : null}
        {save.screen === "consequence" && save.lastConsequence ? (
          <Consequences
            report={save.lastConsequence}
            roster={save.roster}
            onContinue={() => controller.acceptConsequences()}
          />
        ) : null}
        {save.screen === "chapter-complete" ? <ChapterComplete onTitle={onReturnToTitle} /> : null}
      </main>
    </div>
  );
}

function Prologue({ onChoose }: { onChoose: (choice: "tell-cael" | "obey-the-king") => void }) {
  return (
    <section className="cf-story-scene cf-panel-enter">
      <div className="cf-chapter-mark">I</div>
      <p className="cf-kicker">Aldermoor · before the opening move</p>
      <h1 className="mc-display mt-3 max-w-3xl text-3xl leading-tight text-[#f4e3bd] sm:text-5xl">A pawn wakes with the memory of his own sacrifice.</h1>
      <div className="mc-rule mt-5 w-48" />
      <p className="cf-prose mt-6">
        Cael remembers the knight crossing the line. He remembers the king calling it necessary. Most of all, he
        remembers a vast hand of light choosing the square beneath his feet—and the impossible breath that came after death.
      </p>
      <blockquote>“If you can hear me, Player, do not pretend I am only a piece.”</blockquote>
      <div className="cf-choice-stack">
        <button type="button" className="cf-story-choice" onClick={() => onChoose("tell-cael")}>
          <span><Eye size={17} /><strong>Tell Cael the truth</strong></span>
          <small>Gain his trust. Deepen his anger at the crown.</small>
          <ChevronRight size={17} />
        </button>
        <button type="button" className="cf-story-choice" onClick={() => onChoose("obey-the-king")}>
          <span><Crown size={17} /><strong>Obey the king in silence</strong></span>
          <small>Preserve royal order. Cael will remember the lie.</small>
          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}

function Hub({ save, mission, onBrief }: { save: NonNullable<CampaignSnapshot["save"]>; mission: ReturnType<typeof getMission>; onBrief: () => void }) {
  const cael = save.roster.cael;
  const progress = save.completedMissionIds.length;
  return (
    <section className="cf-hub cf-panel-enter">
      <div className="cf-hub-intro">
        <p className="cf-kicker">The War Table · Aldermoor</p>
        <h1 className="mc-display mt-2 text-3xl text-[#f4e3bd] sm:text-4xl">The kingdom is a board with too many empty names.</h1>
        <p className="cf-prose mt-4">The hall changes after every battle. The memorial remains empty—for now.</p>
      </div>

      <div className="cf-hub-grid">
        <article className="cf-location-card cf-location-primary">
          <div className="cf-location-icon"><Map size={21} /></div>
          <p className="cf-kicker">War Table · {mission.subtitle}</p>
          <h2 className="mc-display mt-2 text-2xl text-[#f0dfb6]">{mission.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#b7a88a]">{mission.description}</p>
          <div className="cf-commander-line"><Swords size={14} /> Enemy commander: {mission.enemyCommanderName}</div>
          <button type="button" className="mc-btn mc-btn-primary mt-5 flex items-center gap-2" onClick={onBrief}>
            Inspect the mission <ChevronRight size={15} />
          </button>
        </article>

        <article className="cf-location-card">
          <div className="cf-location-icon"><UserRound size={21} /></div>
          <p className="cf-kicker">Barracks · protagonist</p>
          <h2 className="mc-display mt-2 text-xl text-[#f0dfb6]">{cael.name}</h2>
          <p className="text-xs uppercase tracking-[0.16em] text-[#9d8050]">{cael.title}</p>
          <div className="cf-stat-line"><span>Loyalty</span><strong>{cael.loyalty}</strong></div>
          <div className="cf-stat-line"><span>Morale</span><strong>{cael.morale}</strong></div>
          <div className="mt-3 flex flex-wrap gap-2">{cael.traits.map((trait) => <span className="cf-trait" key={trait}>{trait}</span>)}</div>
        </article>

        <article className="cf-location-card">
          <div className="cf-location-icon"><Flag size={21} /></div>
          <p className="cf-kicker">Campaign state</p>
          <h2 className="mc-display mt-2 text-xl text-[#f0dfb6]">{progress} of 3 battles remembered</h2>
          <div className="cf-campaign-track">{[0, 1, 2].map((index) => <span key={index} data-complete={index < progress} data-current={index === progress} />)}</div>
          <p className="mt-3 text-sm text-[#9f9074]">Difficulty: <span className="capitalize text-[#dac495]">{save.difficulty.replace("-", " ")}</span></p>
        </article>
      </div>
    </section>
  );
}

function Briefing({ mission, onFormation, onBack }: { mission: ReturnType<typeof getMission>; onFormation: () => void; onBack: () => void }) {
  return (
    <section className="cf-briefing cf-panel-enter">
      <BackButton onClick={onBack}>War table</BackButton>
      <p className="cf-kicker mt-6">{mission.subtitle} · {mission.battlefieldId}</p>
      <h1 className="mc-display mt-2 text-4xl text-[#f4e3bd]">{mission.title}</h1>
      <p className="cf-prose mt-5">{mission.briefing}</p>
      <div className="cf-brief-grid">
        <div><span>Primary objective</span><strong>{mission.primaryObjective.description}</strong></div>
        <div><span>Enemy commander</span><strong>{mission.enemyCommanderName}</strong></div>
        <div><span>Tactical setup</span><strong>Handcrafted mission position</strong></div>
        <div><span>Gambit</span><strong>{mission.availableGambits.length ? "Optional and consequential" : "None available"}</strong></div>
      </div>
      <button type="button" className="mc-btn mc-btn-primary mt-6 flex items-center gap-2" onClick={onFormation}>Prepare the formation <ChevronRight size={15} /></button>
    </section>
  );
}

function Formation({ mission, roster, formation, ready, onAssign, onContinue, onBack }: {
  mission: ReturnType<typeof getMission>;
  roster: Record<string, HeroPiece>;
  formation: Record<string, string>;
  ready: boolean;
  onAssign: (square: string, id: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const slot = mission.deploymentSlots[0];
  const candidates = slot.allowedCharacterIds.map((id) => roster[id]).filter(Boolean);
  return (
    <section className="cf-formation cf-panel-enter">
      <BackButton onClick={onBack}>Mission briefing</BackButton>
      <div className="cf-section-heading">
        <div><p className="cf-kicker">Formation</p><h1 className="mc-display mt-2 text-3xl text-[#f4e3bd]">Place a name on {slot.square}</h1></div>
        <div className="cf-slot-seal"><span>{slot.square}</span><small>{PIECE_LABEL[slot.kind]}</small></div>
      </div>
      <p className="cf-prose">{slot.label}. The rank still moves by the laws of chess; the person carries the consequence.</p>
      <div className="cf-roster-grid">
        {candidates.map((hero) => <RosterCard key={hero.id} hero={hero} selected={formation[slot.square] === hero.id} locked={slot.requiredCharacterId === hero.id} onClick={() => onAssign(slot.square, hero.id)} />)}
      </div>
      <div className="cf-formation-summary"><Shield size={16} /><span>{ready ? `${roster[formation[slot.square]]?.name} will retain this identity through movement, capture, and promotion.` : "Assign an available character before marching."}</span></div>
      <button type="button" className="mc-btn mc-btn-primary mt-5 flex items-center gap-2" onClick={onContinue} disabled={!ready}>Review the Gambit <ChevronRight size={15} /></button>
    </section>
  );
}

function RosterCard({ hero, selected, locked, onClick }: { hero: HeroPiece; selected: boolean; locked: boolean; onClick: () => void }) {
  return (
    <button type="button" className="cf-roster-card" data-selected={selected} onClick={onClick} aria-pressed={selected}>
      <div className="cf-portrait" data-kind={hero.currentKind}><span>{hero.name.slice(0, 1)}</span></div>
      <div className="min-w-0 flex-1 text-left">
        <p className="mc-display truncate text-base text-[#ecd9ad]">{hero.name}</p>
        <p className="truncate text-xs uppercase tracking-[0.12em] text-[#8f7650]">{hero.title}</p>
        <p className="mt-3 text-sm leading-relaxed text-[#ab9b7d]">{hero.biography}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{hero.traits.map((trait) => <span className="cf-trait" key={trait}>{trait}</span>)}</div>
      </div>
      <div className="cf-roster-state">{selected ? <Check size={16} /> : locked ? "Required" : "Assign"}</div>
    </button>
  );
}

function Gambit({ mission, selected, onSelect, onLaunch, onBack }: {
  mission: ReturnType<typeof getMission>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onLaunch: () => void;
  onBack: () => void;
}) {
  const gambits = mission.availableGambits.map((id) => CHAPTER_ONE_GAMBITS[id]).filter(Boolean);
  return (
    <section className="cf-gambit cf-panel-enter">
      <BackButton onClick={onBack}>Formation</BackButton>
      <p className="cf-kicker mt-6">The price before battle</p>
      <h1 className="mc-display mt-2 text-3xl text-[#f4e3bd]">Choose a Gambit—or refuse the board its due.</h1>
      {gambits.length ? (
        <div className="mt-6 grid gap-3">
          {gambits.map((gambit) => (
            <button key={gambit.id} type="button" className="cf-gambit-card" data-selected={selected === gambit.id} aria-pressed={selected === gambit.id} onClick={() => onSelect(selected === gambit.id ? null : gambit.id)}>
              <Sparkles size={19} />
              <span><strong className="mc-display">{gambit.title}</strong><small>{gambit.description}</small><em>{gambit.warning}</em></span>
              <span className="cf-gambit-choice">{selected === gambit.id ? "Accepted" : "Accept"}</span>
            </button>
          ))}
          <button type="button" className="cf-decline-card" data-selected={selected === null} aria-pressed={selected === null} onClick={() => onSelect(null)}><Shield size={17} /> Refuse the Gambit. Fight only the position before you.</button>
        </div>
      ) : (
        <div className="cf-empty-gambit"><Shield size={22} /><div><strong>No Gambit is offered.</strong><p>This mission will be decided by its legal position and the names you placed within it.</p></div></div>
      )}
      <button type="button" className="mc-btn mc-btn-primary mt-6 flex items-center gap-2" onClick={onLaunch}>Enter the battle <Swords size={15} /></button>
    </section>
  );
}

function Consequences({ report, roster, onContinue }: { report: NonNullable<CampaignSnapshot["save"]>["lastConsequence"] & {}; roster: Record<string, HeroPiece>; onContinue: () => void }) {
  if (!report) return null;
  return (
    <section className="cf-consequences cf-panel-enter">
      <div className="cf-result-seal" data-victory={report.victory}>{report.victory ? <Crown size={28} /> : <Flag size={28} />}</div>
      <p className="cf-kicker">After the final move</p>
      <h1 className="mc-display mt-2 text-4xl text-[#f4e3bd]">{report.title}</h1>
      <p className="cf-prose mt-3">{report.summary}</p>
      <div className="cf-outcome-list">
        {report.characterOutcomes.map((outcome) => {
          const hero = roster[outcome.characterId];
          return <article key={outcome.characterId} className="cf-outcome-card" data-status={outcome.status}>
            <div className="cf-portrait compact" data-kind={hero.currentKind}><span>{hero.name.slice(0, 1)}</span></div>
            <div><p className="mc-display text-base text-[#ead6aa]">{hero.name} · {outcome.title}</p><p>{outcome.explanation}</p><small>{outcome.factors.join(" · ")}{outcome.roll === null ? "" : " · Fate resolved from saved battle evidence"}</small></div>
            <strong>+{report.experienceAwards[outcome.characterId] ?? 0} XP</strong>
          </article>;
        })}
      </div>
      {report.gambitResult !== "declined" ? <div className="cf-gambit-result"><Sparkles size={16} /> Gambit {report.gambitResult}. The oath is now part of the campaign record.</div> : null}
      <button type="button" className="mc-btn mc-btn-primary mt-6 flex items-center gap-2" onClick={onContinue}>{report.victory ? "Carry the names forward" : "Return to the war table"} <ChevronRight size={15} /></button>
    </section>
  );
}

function ChapterComplete({ onTitle }: { onTitle: () => void }) {
  return (
    <section className="cf-finale cf-panel-enter">
      <div className="cf-nameless-glyph"><span>?</span></div>
      <p className="cf-kicker">The fifth silhouette</p>
      <h1 className="mc-display mt-3 text-4xl text-[#f4e3bd] sm:text-6xl">THE NAMELESS PIECE</h1>
      <p className="cf-prose mt-5">Cael reaches the final rank. Queen. Rook. Bishop. Knight. Behind them, where the ancient Game permits nothing, a fifth shape opens its eyes.</p>
      <blockquote>“Promotion is only the word the kings taught you.”</blockquote>
      <div className="cf-next-mission"><span>New mission revealed</span><strong>The Pieces Below</strong></div>
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-[#7f7056]">Chapter One complete · save preserved</p>
      <button type="button" className="mc-btn mc-btn-primary mt-6 flex items-center gap-2" onClick={onTitle}>Return to Crownfall <Crown size={15} /></button>
    </section>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="cf-back-button" onClick={onClick}><ArrowLeft size={14} /> {children}</button>;
}
