import { LEGACY_COPY, LEGACY_TEXT } from "../../../shared/legacy/content/copy";
import type { LegacyWagerTerms } from "../../../shared/legacy/content/copy";
import { getAlliedHouse } from "../../../shared/legacy/content/houses";
import { NATIONS } from "../../../shared/legacy/content/nations";
import { challengeOpponentNation, isChallengeNotice } from "../../../shared/legacy/domain/notices";
import type { HeraldNotice, LegacyState } from "../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "./desktop-copy";
import type { NextStep } from "./next-step";

/** A challenge's stated terms, from the same shared builder as the stored wager (Quest uses it too). */
export function wagerTermsFor(state: LegacyState, notice: HeraldNotice): LegacyWagerTerms | null {
  if (!state.banner || !isChallengeNotice(notice)) return null;
  const opponent = challengeOpponentNation(notice);
  if (!opponent) return null;
  return LEGACY_TEXT.wagerTerms(NATIONS[opponent].name, getAlliedHouse(state.banner.nationId).name);
}

interface WagerTermsProps {
  heading: string;
  terms: LegacyWagerTerms;
  /** Heading level inside its container: a panel section uses h4, a dialog h3. */
  level: 3 | 4;
}

/** The wager at body size: its introduction, each condition beside what follows, and the closing rule. */
export function WagerTerms({ heading, terms, level }: WagerTermsProps) {
  const Heading = level === 3 ? "h3" : "h4";
  return <section className="legacy-terms" aria-label={heading} data-wager>
    <Heading>{heading}</Heading>
    <p className="legacy-terms-lead">{terms.intro}</p>
    <dl className="legacy-terms-list">
      {terms.terms.map((term) => <div key={term.when} className="legacy-term" data-wager-term>
        <dt>{term.when}</dt>
        <dd>{term.then}</dd>
      </div>)}
    </dl>
    <p className="legacy-terms-close">{terms.closing}</p>
  </section>;
}

interface NextStepActionProps {
  step: NextStep;
  onGo(step: NextStep): void;
  /** The overview strip, or a landmark panel's primary action. */
  variant: "overview" | "panel";
  /** Takes focus when its panel opens. */
  defaultFocus?: boolean;
}

/** The next step toward a Muster match, with a direct jump to the landmark that holds it. */
export function NextStepAction({ step, onGo, variant, defaultFocus = false }: NextStepActionProps) {
  return <button
    type="button"
    className={`legacy-next legacy-next--${variant} legacy-next--${step.kind}`}
    data-nav
    data-nav-default={defaultFocus || undefined}
    data-next-step={step.kind}
    data-next-landmark={step.landmark}
    aria-label={`${UI.nextStep.heading}: ${step.title}. ${step.detail}`}
    onClick={() => onGo(step)}
  >
    <span className="legacy-next-eyebrow">{UI.nextStep.heading}</span>
    <span className="legacy-next-title">{step.title}</span>
    <span className="legacy-next-detail">{step.detail}</span>
    <span className="legacy-next-go" aria-hidden="true"><span className="legacy-next-dest">{LEGACY_COPY.landmarks[step.landmark].title}</span><span className="legacy-next-chevron">›</span></span>
  </button>;
}
