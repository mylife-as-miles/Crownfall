import { forwardRef, useMemo } from "react";
import type { FormEvent } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import {
  CHARGE_LABELS, CHARGES, DIVISION_LABELS, DIVISIONS, describeHeraldry, HERALDRY_PRESETS, heraldryEquals,
  ORDINARIES, ORDINARY_LABELS, tinctureAdvisory, tinctureInfo, TINCTURES, cloneHeraldry,
} from "../../../shared/legacy/content/heraldry";
import { suggestBannerNames } from "../../../shared/legacy/content/names";
import { LEGACY_NATION_AVAILABILITY, NATION_ORDER, NATIONS, isNationFoundable } from "../../../shared/legacy/content/nations";
import { generateFoundingMembers, validateBannerName, validateMotto } from "../../../shared/legacy/domain/founding";
import type { HeraldicCharge, HeraldicDivision, HeraldicOrdinary, Heraldry, Tincture } from "../../../shared/legacy/types";
import { Cycler } from "./Cycler";
import type { CyclerOption } from "./Cycler";
import { DESKTOP_LEGACY_COPY as UI } from "./desktop-copy";
import { FOUNDING_STEP_COUNT, withNation } from "./founding-draft";
import type { FoundingDraft } from "./founding-draft";
import { HeraldryEmblem } from "./HeraldryEmblem";

const COPY = LEGACY_COPY.founding;
const SUGGESTIONS_PER_PAGE = 3;

const TINCTURE_OPTIONS: readonly CyclerOption<Tincture>[] = TINCTURES.map((id) => {
  const info = tinctureInfo(id);
  return { value: id, label: info.label, aside: info.plain, swatch: info.hex };
});
const DIVISION_OPTIONS: readonly CyclerOption<HeraldicDivision>[] = DIVISIONS.map((id) => ({ value: id, label: DIVISION_LABELS[id] }));
const ORDINARY_OPTIONS: readonly CyclerOption<HeraldicOrdinary>[] = ORDINARIES.map((id) => ({ value: id, label: ORDINARY_LABELS[id] }));
const CHARGE_OPTIONS: readonly CyclerOption<HeraldicCharge>[] = CHARGES.map((id) => ({ value: id, label: CHARGE_LABELS[id] }));

interface FoundingCeremonyProps {
  draft: FoundingDraft;
  onChange(update: (draft: FoundingDraft) => FoundingDraft): void;
  /** Opens the parent's confirmation dialog. */
  onRaise(): void;
  /** Leaves for Home; the draft is kept for the next visit. */
  onCancel(): void;
  guest: boolean;
}

export const FoundingCeremony = forwardRef<HTMLElement, FoundingCeremonyProps>(function FoundingCeremony({ draft, onChange, onRaise, onCancel, guest }, ref) {
  const step = COPY.steps[draft.step];
  const name = validateBannerName(draft.name);
  const nameError = name.ok === false && draft.nameTouched ? name.error : null;
  const motto = validateMotto(draft.motto);
  const canContinue = draft.step !== 1 || name.ok;

  const next = () => {
    if (draft.step === 1 && name.ok === false) {
      onChange((current) => ({ ...current, nameTouched: true }));
      return;
    }
    if (draft.step === FOUNDING_STEP_COUNT - 1) {
      if (motto.ok) onRaise();
      return;
    }
    onChange((current) => ({ ...current, step: Math.min(FOUNDING_STEP_COUNT - 1, current.step + 1), name: name.ok ? name.name : current.name }));
  };
  const back = () => {
    if (draft.step === 0) onCancel();
    else onChange((current) => ({ ...current, step: current.step - 1 }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    next();
  };

  return <section ref={ref} className="legacy-founding legacy-card" aria-labelledby="legacy-founding-title" data-founding-step={step.id}>
    <header className="legacy-card-header">
      <p className="legacy-eyebrow">{COPY.stepCounter(draft.step + 1, FOUNDING_STEP_COUNT)}</p>
      <h2 id="legacy-founding-title">{COPY.title}</h2>
      <ol className="legacy-steps" aria-label={COPY.title}>
        {COPY.steps.map((item, index) => <li key={item.id} className={index === draft.step ? "is-current" : index < draft.step ? "is-done" : undefined} aria-current={index === draft.step ? "step" : undefined}>
          <span className="legacy-step-pip" aria-hidden="true" />
          <span className="legacy-step-name">{item.title}</span>
        </li>)}
      </ol>
      <h3 className="legacy-step-title">{step.title}</h3>
      <p className="legacy-step-hint">{draft.step === 0 ? COPY.intro : step.hint}</p>
    </header>
    <form className="legacy-card-body" onSubmit={submit} noValidate>
      {draft.step === 0 && <NationStep draft={draft} onChange={onChange} />}
      {draft.step === 1 && <NameStep draft={draft} onChange={onChange} error={nameError} />}
      {draft.step === 2 && <ArmsStep draft={draft} onChange={onChange} />}
      {draft.step === 3 && <RaiseStep draft={draft} onChange={onChange} guest={guest} mottoError={motto.ok === false ? motto.error : null} />}
      <footer className="legacy-card-actions">
        {/* B and Escape already go back, so directional movement only lands on Continue. */}
        <button type="button" className="legacy-button" onClick={back}>{draft.step === 0 ? COPY.cancel : COPY.back}</button>
        <button
          type="submit"
          className="legacy-button legacy-button--primary"
          data-nav
          data-nav-default={draft.step === 3 ? true : undefined}
          aria-disabled={!canContinue || (draft.step === 3 && !motto.ok) ? true : undefined}
        >{draft.step === FOUNDING_STEP_COUNT - 1 ? COPY.confirmAction : COPY.next}</button>
      </footer>
    </form>
  </section>;
});

interface StepProps {
  draft: FoundingDraft;
  onChange(update: (draft: FoundingDraft) => FoundingDraft): void;
}

function NationStep({ draft, onChange }: StepProps) {
  const nation = NATIONS[draft.nationId];
  return <>
    <div className="legacy-nations" role="radiogroup" aria-label={COPY.steps[0].title}>
      {NATION_ORDER.map((id) => {
        const option = NATIONS[id];
        const availability = LEGACY_NATION_AVAILABILITY[id];
        const foundable = isNationFoundable(id);
        const selected = id === draft.nationId;
        return <button
          key={id}
          type="button"
          role="radio"
          className={`legacy-nation${selected ? " is-selected" : ""}`}
          aria-checked={selected}
          aria-disabled={!foundable || undefined}
          aria-describedby={selected ? "legacy-nation-summary" : undefined}
          data-nav
          data-nav-default={selected || undefined}
          data-nation={id}
          style={{ ["--nation-accent" as string]: option.palette.glow, ["--nation-deep" as string]: option.palette.secondary }}
          onClick={() => { if (foundable) onChange((current) => withNation(current, id)); }}
        >
          <span className="legacy-nation-name">{option.name}</span>
          <span className="legacy-nation-epithet">{option.epithet}</span>
          <span className={`legacy-badge legacy-badge--${availability}`}>{COPY.availability[availability]}</span>
        </button>;
      })}
    </div>
    <div className="legacy-nation-detail" id="legacy-nation-summary" aria-live="polite">
      <p className="legacy-nation-polity">{nation.polity}</p>
      <p>{nation.summary}</p>
    </div>
    <p className="legacy-fineprint">{COPY.launchArmiesNote}</p>
  </>;
}

function NameStep({ draft, onChange, error }: StepProps & { error: string | null }) {
  const suggestions = useMemo(() => suggestBannerNames(draft.nationId, draft.seed, 14), [draft.nationId, draft.seed]);
  const page: string[] = [];
  for (let index = 0; index < SUGGESTIONS_PER_PAGE && suggestions.length > 0; index++) {
    page.push(suggestions[(draft.suggestionPage * SUGGESTIONS_PER_PAGE + index) % suggestions.length]);
  }
  const suggest = () => onChange((current) => ({
    ...current,
    name: suggestions[current.suggestionCursor % suggestions.length] ?? current.name,
    suggestionCursor: current.suggestionCursor + 1,
    nameTouched: true,
  }));
  return <>
    <label className="legacy-field-label" htmlFor="legacy-banner-name">{COPY.nameLabel}</label>
    <div className="legacy-name-row">
      <input
        id="legacy-banner-name"
        className="legacy-input"
        type="text"
        name="banner-name"
        value={draft.name}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        placeholder={COPY.namePlaceholder}
        aria-invalid={error ? true : undefined}
        aria-describedby="legacy-name-rules legacy-name-error"
        data-nav
        data-nav-default
        onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, name: value, nameTouched: true })); }}
        onBlur={() => { if (draft.name.length > 0) onChange((current) => (current.nameTouched ? current : { ...current, nameTouched: true })); }}
      />
      <button type="button" className="legacy-button" data-nav onClick={suggest}>{UI.suggest}</button>
    </div>
    <p className="legacy-fineprint" id="legacy-name-rules">{COPY.nameRules}</p>
    <p className="legacy-field-error" id="legacy-name-error" aria-live="polite">{error ?? ""}</p>
    <div className="legacy-suggestions" role="group" aria-label={COPY.suggestionsLabel}>
      <span className="legacy-field-label">{COPY.suggestionsLabel}</span>
      <div className="legacy-chip-row">
        {page.map((suggestion) => <button key={suggestion} type="button" className={`legacy-chip${suggestion === draft.name ? " is-current" : ""}`} data-nav onClick={() => onChange((current) => ({ ...current, name: suggestion, nameTouched: true }))}>{suggestion}</button>)}
        <button type="button" className="legacy-chip legacy-chip--more" data-nav onClick={() => onChange((current) => ({ ...current, suggestionPage: current.suggestionPage + 1 }))}>{COPY.moreSuggestions}</button>
      </div>
    </div>
  </>;
}

function ArmsStep({ draft, onChange }: StepProps) {
  const heraldry = draft.heraldry;
  const presets = HERALDRY_PRESETS[draft.nationId];
  const presetOptions: readonly CyclerOption<string>[] = presets.map((preset) => ({ value: preset.id, label: preset.label }));
  const activePreset = presets.find((preset) => heraldryEquals(preset.heraldry, heraldry)) ?? null;
  const advice = tinctureAdvisory(heraldry);
  const set = (patch: (current: Heraldry) => Heraldry) => onChange((current) => ({ ...current, heraldry: patch(cloneHeraldry(current.heraldry)) }));
  return <div className="legacy-arms">
    <div className="legacy-arms-controls" role="group" aria-label={COPY.steps[2].title}>
      <Cycler
        id="legacy-arms-preset"
        label={COPY.presetsLabel}
        options={presetOptions}
        value={activePreset ? activePreset.id : null}
        fallbackLabel={UI.customArms}
        onChange={(id) => { const preset = presets.find((item) => item.id === id); if (preset) set(() => cloneHeraldry(preset.heraldry)); }}
        note={activePreset?.note}
      />
      <Cycler id="legacy-arms-division" label={COPY.parts.division} options={DIVISION_OPTIONS} value={heraldry.division} onChange={(division) => set((current) => ({ ...current, division }))} />
      <Cycler id="legacy-arms-field" label={COPY.parts.field} options={TINCTURE_OPTIONS} value={heraldry.field[0]} showSwatches onChange={(tincture) => set((current) => ({ ...current, field: [tincture, current.field[1]] }))} />
      {heraldry.division !== "plain" && <Cycler id="legacy-arms-field-2" label={COPY.parts.secondField} options={TINCTURE_OPTIONS} value={heraldry.field[1]} showSwatches onChange={(tincture) => set((current) => ({ ...current, field: [current.field[0], tincture] }))} />}
      <Cycler id="legacy-arms-ordinary" label={COPY.parts.ordinary} options={ORDINARY_OPTIONS} value={heraldry.ordinary} onChange={(ordinary) => set((current) => ({ ...current, ordinary }))} />
      {heraldry.ordinary !== "none" && <Cycler id="legacy-arms-ordinary-tincture" label={COPY.parts.ordinaryTincture} options={TINCTURE_OPTIONS} value={heraldry.ordinaryTincture} showSwatches onChange={(tincture) => set((current) => ({ ...current, ordinaryTincture: tincture }))} />}
      <Cycler id="legacy-arms-charge" label={COPY.parts.charge} options={CHARGE_OPTIONS} value={heraldry.charge} onChange={(charge) => set((current) => ({ ...current, charge }))} />
      {heraldry.charge !== "none" && <Cycler id="legacy-arms-charge-tincture" label={COPY.parts.chargeTincture} options={TINCTURE_OPTIONS} value={heraldry.chargeTincture} showSwatches onChange={(tincture) => set((current) => ({ ...current, chargeTincture: tincture }))} />}
    </div>
    <figure className="legacy-arms-preview">
      <HeraldryEmblem className="legacy-arms-banner" heraldry={heraldry} aspect="banner" />
      <figcaption>
        <span className="legacy-blazon">{describeHeraldry(heraldry)}</span>
        <span className="legacy-advice" aria-live="polite">
          <strong>{COPY.advisoryTitle}</strong>
          {advice.length === 0 ? <span>{COPY.advisoryClear}</span> : advice.map((item) => <span key={`${item.part}-${item.code}`}>{item.message}</span>)}
          <span className="legacy-fineprint">{COPY.advisoryNote}</span>
        </span>
      </figcaption>
    </figure>
  </div>;
}

function RaiseStep({ draft, onChange, guest, mottoError }: StepProps & { guest: boolean; mottoError: string | null }) {
  const nation = NATIONS[draft.nationId];
  const members = useMemo(() => generateFoundingMembers(draft.nationId, draft.seed), [draft.nationId, draft.seed]);
  const name = validateBannerName(draft.name);
  return <div className="legacy-raise">
    <div className="legacy-raise-identity">
      <HeraldryEmblem className="legacy-raise-banner" heraldry={draft.heraldry} aspect="banner" />
      <div>
        <p className="legacy-raise-name">{name.ok ? name.name : draft.name}</p>
        <p className="legacy-raise-polity">{nation.polity} · {LEGACY_COPY.rank["minor-banner"]}</p>
        <p className="legacy-blazon">{describeHeraldry(draft.heraldry)}</p>
      </div>
    </div>
    <label className="legacy-field-label" htmlFor="legacy-banner-motto">{COPY.mottoLabel}</label>
    <input
      id="legacy-banner-motto"
      className="legacy-input"
      type="text"
      value={draft.motto}
      maxLength={80}
      autoComplete="off"
      placeholder={COPY.mottoPlaceholder}
      aria-invalid={mottoError ? true : undefined}
      aria-describedby="legacy-motto-error"
      data-nav
      onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, motto: value })); }}
    />
    <p className="legacy-field-error" id="legacy-motto-error" aria-live="polite">{mottoError ?? ""}</p>
    <div className="legacy-sworn">
      <span className="legacy-field-label">{UI.sworn}</span>
      <ul>{members.map((member) => <li key={member.id}><span>{member.name}</span> <span className="legacy-muted">{member.epithet}</span></li>)}</ul>
    </div>
    <p className="legacy-raise-note">{guest ? COPY.guestConfirmBody : COPY.confirmBody}</p>
  </div>;
}
