import { LEGACY_COPY } from "../../../../shared/legacy/content/copy";
import { describeHeraldry } from "../../../../shared/legacy/content/heraldry";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import type { LegacySceneState } from "../../../../shared/legacy/environment-contract";
import type { LegacyState } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { formatLegacyDate } from "../format";
import { HeraldryEmblem } from "../HeraldryEmblem";
import { LedgerRow, PanelSection } from "./InspectionPanel";

interface BannerHallPanelProps {
  state: LegacyState;
  scene: LegacySceneState;
  persistent: boolean;
  onAbandon(): void;
}

export function BannerHallPanel({ state, scene, persistent, onAbandon }: BannerHallPanelProps) {
  const banner = state.banner;
  if (!banner) return <p className="legacy-empty">{LEGACY_COPY.empty.unfounded}</p>;
  const nation = NATIONS[banner.nationId];
  const preview = state.mode === "preview";
  return <>
    <div className="legacy-hall-identity" tabIndex={0} data-nav data-nav-default aria-label={`${banner.name}. ${describeHeraldry(banner.heraldry)}`}>
      <HeraldryEmblem className="legacy-hall-banner" heraldry={banner.heraldry} aspect="banner" />
      <div className="legacy-hall-name">
        <p className="legacy-hall-title">{banner.name}</p>
        {banner.motto && <p className="legacy-motto">“{banner.motto}”</p>}
        <p className="legacy-blazon">{describeHeraldry(banner.heraldry)}</p>
      </div>
    </div>
    <PanelSection title={UI.standing}>
      <dl className="legacy-ledger">
        <LedgerRow label={UI.nation}>{nation.polity}<span className="legacy-muted"> · {nation.epithet}</span></LedgerRow>
        <LedgerRow label={UI.rank}>{LEGACY_COPY.rank[scene.rank]}</LedgerRow>
        <LedgerRow label={UI.recognition}>{LEGACY_COPY.recognitionLabel(state.standing.recognition)}</LedgerRow>
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
    <div className="legacy-hall-actions">
      {preview
        ? <p className="legacy-fineprint">{UI.previewLocked}</p>
        : <button type="button" className="legacy-button legacy-button--danger" data-nav onClick={onAbandon}>{UI.abandon}</button>}
      {persistent && <p className="legacy-fineprint">{LEGACY_COPY.noSync}</p>}
    </div>
  </>;
}
