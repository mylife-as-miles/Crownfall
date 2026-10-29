import { END_REASON_PHRASES, LEGACY_COPY, sentenceCase } from "../../../../shared/legacy/content/copy";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import { chronicleNewestFirst } from "../../../../shared/legacy/domain/chronicle";
import { houseDisplayName } from "../../../../shared/legacy/domain/identity";
import { findMember } from "../../../../shared/legacy/domain/state";
import type { LegacyState } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { formatLegacyTime } from "../format";
import { PanelSection } from "./InspectionPanel";

/** The house's physical record: conflicts, open matters and every chronicle entry, newest first. */
export function WarRecordPanel({ state }: { state: LegacyState }) {
  const matches = state.matches.slice().reverse();
  const entries = chronicleNewestFirst(state);
  return <>
    <PanelSection title={UI.conflicts}>
      {matches.length === 0 ? <p className="legacy-empty" data-empty="matches">{LEGACY_COPY.empty.matches}</p> : <ol className="legacy-record-list">
        {matches.map((match) => {
          const representative = findMember(state, match.representativeId);
          return <li key={match.matchId}>
            <article className={`legacy-match legacy-match--${match.outcome}`} tabIndex={0} data-nav data-match={match.matchId} aria-label={`${LEGACY_COPY.stakes[match.stakes].label} · ${NATIONS[match.opponentNationId].name} · ${LEGACY_COPY.outcome[match.outcome]}`}>
              <header>
                <span className="legacy-match-kind">{LEGACY_COPY.stakes[match.stakes].label} · {NATIONS[match.opponentNationId].name}</span>
                <span className={`legacy-outcome legacy-outcome--${match.outcome}`}>{LEGACY_COPY.outcome[match.outcome]}</span>
              </header>
              <p>{sentenceCase(END_REASON_PHRASES[match.reason])} · {UI.moves(Math.ceil(match.plies / 2))} · <time dateTime={match.completedAt}>{formatLegacyTime(match.completedAt)}</time></p>
              {representative && <p className="legacy-muted">
                {representative.name}{match.representativeFile ? ` (${LEGACY_COPY.inspector.fileName(match.representativeFile)})` : ""}: {UI.fate[match.representativeFate]}
                {match.representativeCapturedBy ? ` · ${sentenceCase(houseDisplayName(match.representativeCapturedBy))}` : ""}
                {match.representativeCaptures > 0 ? ` · ${LEGACY_COPY.inspector.captures} ${match.representativeCaptures}` : ""}
              </p>}
            </article>
          </li>;
        })}
      </ol>}
    </PanelSection>
    <PanelSection title={UI.unresolved}>
      {state.unresolved.length === 0 ? <p className="legacy-empty" data-empty="unresolved">{LEGACY_COPY.empty.unresolved}</p> : <ul className="legacy-record-list">
        {state.unresolved.map((matter) => <li key={matter.id}>
          <article className={`legacy-matter legacy-matter--${matter.kind}`} tabIndex={0} data-nav data-matter={matter.id}>
            <span className="legacy-matter-kind">{LEGACY_COPY.unresolvedKinds[matter.kind]}</span>
            <p className="legacy-entry-title">{matter.title}</p>
            <p className="legacy-muted">{matter.body}</p>
          </article>
        </li>)}
      </ul>}
    </PanelSection>
    <PanelSection title={UI.ledger} className="legacy-ledger-section">
      {entries.length === 0 ? <p className="legacy-empty" data-empty="chronicle">{LEGACY_COPY.empty.chronicle}</p> : <ol className="legacy-record-list legacy-chronicle">
        {entries.map((entry) => <li key={entry.id}>
          <article className={`legacy-entry legacy-entry--${entry.prominence}`} tabIndex={0} data-nav data-entry={entry.id} aria-label={entry.title}>
            <header>
              <span className="legacy-entry-kind">{LEGACY_COPY.aftermath.headings[entry.kind]}</span>
              <time dateTime={entry.at}>{formatLegacyTime(entry.at)}</time>
            </header>
            <p className="legacy-entry-title">{entry.title}</p>
            <p className="legacy-muted">{entry.body}</p>
          </article>
        </li>)}
      </ol>}
    </PanelSection>
  </>;
}
