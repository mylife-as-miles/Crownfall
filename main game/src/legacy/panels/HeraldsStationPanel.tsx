import { LEGACY_COPY, sentenceCase } from "../../../../shared/legacy/content/copy";
import { getAlliedHouse, getExternalHouse, getRivalHouse } from "../../../../shared/legacy/content/houses";
import { NATIONS } from "../../../../shared/legacy/content/nations";
import type { LegacySceneState } from "../../../../shared/legacy/environment-contract";
import { musterReadiness } from "../../../../shared/legacy/domain/formation";
import { houseDisplayName } from "../../../../shared/legacy/domain/identity";
import { isChallengeNotice } from "../../../../shared/legacy/domain/notices";
import type { HeraldNotice, LegacyEvent, LegacyState } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { HeraldryEmblem } from "../HeraldryEmblem";
import { PanelSection } from "./InspectionPanel";

const NOTICES = LEGACY_COPY.notices;

interface HeraldsStationPanelProps {
  state: LegacyState;
  scene: LegacySceneState;
  dispatch(event: LegacyEvent): string | null;
  /** Opens the parent's acceptance dialog, which states the wager again. */
  onAccept(notice: HeraldNotice): void;
}

function statusLabel(notice: HeraldNotice): string {
  if (notice.status === "accepted") return NOTICES.accepted;
  if (notice.status === "resolved") return NOTICES.resolved;
  if (notice.status === "unread") return NOTICES.unread;
  return "";
}

export function AwaitingBoard() {
  return <div className="legacy-awaiting" role="note" data-awaiting-board>
    <p className="legacy-awaiting-title">{LEGACY_COPY.awaitingBoard.title}</p>
    <p>{LEGACY_COPY.awaitingBoard.body}</p>
    <p className="legacy-fineprint">{LEGACY_COPY.awaitingBoard.hint}</p>
  </div>;
}

export function HeraldsStationPanel({ state, scene, dispatch, onAccept }: HeraldsStationPanelProps) {
  const banner = state.banner;
  if (!banner) return <p className="legacy-empty">{LEGACY_COPY.empty.unfounded}</p>;
  const readiness = musterReadiness(state);
  const accepted = state.notices.some((notice) => isChallengeNotice(notice) && notice.status === "accepted");
  // Open business first, then the archive; newest first within each.
  const notices = state.notices.slice().reverse().sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved"));
  const ally = getAlliedHouse(banner.nationId);
  const rival = getRivalHouse(banner.nationId);
  return <>
    <PanelSection title={UI.readiness}>
      <p className={`legacy-readiness${readiness.ready ? " is-ready" : ""}`} data-readiness={readiness.ready ? "ready" : "waiting"}>{readiness.ready ? UI.ready : readiness.reason}</p>
      {accepted && <AwaitingBoard />}
    </PanelSection>
    <PanelSection title={UI.notices}>
      {notices.length === 0 ? <p className="legacy-empty">{LEGACY_COPY.empty.notices}</p> : <ul className="legacy-record-list legacy-notices">
        {notices.map((notice) => {
          const challenge = isChallengeNotice(notice);
          const from = houseDisplayName(notice.fromHouseId);
          const house = getExternalHouse(notice.fromHouseId);
          const canRead = notice.status === "unread";
          const canAccept = challenge && (notice.status === "unread" || notice.status === "read");
          return <li key={notice.id}>
            <article className={`legacy-notice legacy-notice--${notice.kind} is-${notice.status}`} tabIndex={0} data-nav data-notice={notice.id} data-notice-kind={notice.kind} aria-label={`${NOTICES.kinds[notice.kind]}: ${notice.title}`}>
              <header>
                {house ? <HeraldryEmblem className="legacy-seal" heraldry={house.heraldry} aspect="shield" label="" /> : <span className="legacy-seal legacy-seal--crown" aria-hidden="true" />}
                <span className="legacy-notice-kind">{NOTICES.kinds[notice.kind]}</span>
                {statusLabel(notice) && <span className={`legacy-notice-status is-${notice.status}`}>{statusLabel(notice)}</span>}
              </header>
              <p className="legacy-entry-title">{notice.title}</p>
              <p className="legacy-notice-from">{NOTICES.from(sentenceCase(from))}</p>
              <p className="legacy-muted">{notice.body}</p>
              {challenge && notice.wager && <section className="legacy-terms" aria-label={NOTICES.wagerHeading}>
                <h4>{NOTICES.wagerHeading}</h4>
                <p>{notice.wager}</p>
              </section>}
            </article>
            {(canRead || canAccept) && <div className="legacy-notice-actions">
              {canRead && <button type="button" className="legacy-button" data-nav onClick={() => { dispatch({ type: "read-notice", noticeId: notice.id }); }}>{NOTICES.read}</button>}
              {canAccept && <button type="button" className="legacy-button legacy-button--primary" data-nav data-accept={notice.id} onClick={() => onAccept(notice)}>{NOTICES.accept}</button>}
            </div>}
          </li>;
        })}
      </ul>}
    </PanelSection>
    <PanelSection title={UI.houses}>
      <ul className="legacy-houses">
        {[{ house: ally, kind: UI.alliedHouse, stance: scene.alliedHouse?.stance, holdsCaptive: false }, { house: rival, kind: UI.rivalHouse, stance: scene.rivalHouse?.stance, holdsCaptive: scene.rivalHouse?.holdsCaptive ?? false }].map((item) => <li key={item.house.id}>
          <article className="legacy-house" tabIndex={0} data-nav data-house={item.house.id}>
            <HeraldryEmblem className="legacy-house-shield" heraldry={item.house.heraldry} aspect="shield" label="" />
            <div>
              <p className="legacy-house-kind">{item.kind} · {NATIONS[item.house.nationId].name}</p>
              <p className="legacy-entry-title">{item.house.name}</p>
              {item.stance && <p className={`legacy-stance legacy-stance--${item.stance}`}>{LEGACY_COPY.stance[item.stance]}</p>}
              <p className="legacy-muted">{item.house.temperament}</p>
              {item.holdsCaptive && <p className="legacy-house-captive">{UI.holdsCaptive}</p>}
            </div>
          </article>
        </li>)}
      </ul>
    </PanelSection>
  </>;
}
