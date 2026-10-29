import { LEGACY_COPY } from "../../../../shared/legacy/content/copy";
import { describeHeraldry } from "../../../../shared/legacy/content/heraldry";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import type { LegacySceneState } from "../../../../shared/legacy/environment-contract";
import type { LegacyState } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { formatLegacyDate } from "../format";
import { HeraldryEmblem } from "../HeraldryEmblem";
import { NextStepAction } from "../LegacyTerms";
import type { NextStep } from "../next-step";
import { LedgerRow, PanelSection } from "./InspectionPanel";

interface BannerHallPanelProps {
  state: LegacyState;
  scene: LegacySceneState;
  persistent: boolean;
  nextStep: NextStep | null;
  onNextStep(step: NextStep): void;
  onDissolve(): void;
}

/** The seat of the house. Its primary action is the next step toward a match; dissolving waits behind Manage banner. */
export function BannerHallPanel({ state, scene, persistent, nextStep, onNextStep, onDissolve }: BannerHallPanelProps) {
  const banner = state.banner;
  if (!banner) return <p className="legacy-empty">{LEGACY_COPY.empty.unfounded}</p>;
  const nation = NATIONS[banner.nationId];
  const preview = state.mode === "preview";
  return <>
    <div className="legacy-hall-identity" tabIndex={0} data-nav aria-label={`${banner.name}. ${describeHeraldry(banner.heraldry)}`}>
      <HeraldryEmblem className="legacy-hall-banner" heraldry={banner.heraldry} aspect="banner" />
      <div className="legacy-hall-name">
        <p className="legacy-hall-title">{banner.name}</p>
        {banner.motto && <p className="legacy-motto">“{banner.motto}”</p>}
        <p className="legacy-blazon">{describeHeraldry(banner.heraldry)}</p>
      </div>
    </div>
    {nextStep && <div className="legacy-panel-next"><NextStepAction step={nextStep} onGo={onNextStep} variant="panel" defaultFocus /></div>}
    <PanelSection title={UI.standing}>
      <dl className="legacy-ledger">
        <LedgerRow label={UI.nation}>{nation.polity}<span className="legacy-muted"> · {nation.epithet}</span></LedgerRow>
        <LedgerRow label={UI.rank}>{LEGACY_COPY.rank[scene.rank]}</LedgerRow>
        <LedgerRow label={UI.recognition}>{state.standing.recognition}</LedgerRow>
        <LedgerRow label={UI.hall}>{LEGACY_COPY.hallTiers[scene.hallTier]}<span className="legacy-muted"> · {UI.levelOf(scene.hallTier + 1, LEGACY_COPY.hallTiers.length)}</span></LedgerRow>
      </dl>
    </PanelSection>
    <PanelSection title={UI.honours}>
      {scene.honours.length === 0
        ? <p className="legacy-empty">{LEGACY_COPY.empty.honours}</p>
        : <ul className="legacy-honours">{scene.honours.map((honour) => {
          const match = honour.matchId ? state.matches.find((item) => item.matchId === honour.matchId) : undefined;
          return <li key={honour.id} data-honour={honour.kind}>
            <span className="legacy-honour-mark" aria-hidden="true" />
            <span>{honour.label}</span>
            {match && <time className="legacy-honour-date" dateTime={match.completedAt}>{formatLegacyDate(match.completedAt)}</time>}
          </li>;
        })}</ul>}
    </PanelSection>
    <details className="legacy-manage" data-manage-banner>
      <summary data-nav>{UI.manageBanner}</summary>
      <div className="legacy-manage-body">
        {preview
          ? <p className="legacy-fineprint">{LEGACY_COPY.preview.locked}</p>
          : <button type="button" className="legacy-button legacy-button--danger" data-nav data-dissolve onClick={onDissolve}>{LEGACY_COPY.reset.action}</button>}
        {persistent && <p className="legacy-fineprint">{LEGACY_COPY.noSync}</p>}
      </div>
    </details>
  </>;
}
