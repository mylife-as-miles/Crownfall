// Pure navigation and founding-draft state for the Quest My Legacy panels.
// Domain transitions (founding, nomination, notices, reset) stay in
// shared/legacy reduceLegacy; this module only decides which panel view is
// shown and edits the unsaved founding draft. No IWSDK, DOM or clock access.

import { BANNER_NAME_SUGGESTIONS, suggestBannerNames } from '../../../shared/legacy/content/names';
import {
  CHARGES, DIVISIONS, ORDINARIES, TINCTURES, cloneHeraldry, defaultHeraldry, heraldryEquals, tinctureClass,
} from '../../../shared/legacy/content/heraldry';
import { BANNER_NAME_MAX, MOTTO_MAX, validateBannerName } from '../../../shared/legacy/domain/founding';
import type { FileLetter, Heraldry, LandmarkId, NationId, Tincture } from '../../../shared/legacy/types';
import { LEGACY_SUGGESTION_SLOTS } from './legacy-ui-contract.js';
import type { LegacyHeraldryPart, LegacyKeyAction } from './legacy-ui-contract.js';

export type LegacyFoundingView = 'nation' | 'name' | 'keyboard' | 'arms' | 'confirm';
export type LegacyInspectorView = 'banner-hall' | 'muster-grounds' | 'war-record' | 'heralds-station';
/** The three sections of the War Record, one shown at a time. */
export type LegacyRecordTab = 'conflicts' | 'unresolved' | 'ledger';
export type LegacyKeyboardTarget = 'name' | 'motto';
export type LegacyFlowView =
  | 'loading' | 'recovery' | LegacyFoundingView | 'raised' | 'aftermath' | 'overview' | LegacyInspectorView
  | 'nominate' | 'notice' | 'accept' | 'awaiting' | 'reset';

export const LEGACY_FOUNDING_VIEWS: readonly LegacyFoundingView[] = ['nation', 'name', 'keyboard', 'arms', 'confirm'];
export const LEGACY_RECORD_TABS: readonly LegacyRecordTab[] = ['conflicts', 'unresolved', 'ledger'];
/** Founding steps as LEGACY_COPY.founding.steps counts them. */
export const LEGACY_FOUNDING_STEP: Readonly<Record<Exclude<LegacyFoundingView, 'keyboard'>, number>> = { nation: 1, name: 2, arms: 3, confirm: 4 };
export const LEGACY_FOUNDING_STEP_COUNT = 4;

/** The inspector view of each landmark; their ids match one to one. */
export const LEGACY_LANDMARK_VIEW: Readonly<Record<LandmarkId, LegacyInspectorView>> = {
  'banner-hall': 'banner-hall',
  'muster-grounds': 'muster-grounds',
  'war-record': 'war-record',
  'heralds-station': 'heralds-station',
};

export interface LegacyFoundingDraftState {
  nationId: NationId;
  /** As chosen or typed; validated only when the ceremony advances. */
  name: string;
  /** Optional motto as typed; empty means none. Validated by the domain when the banner is raised. */
  motto: string;
  heraldry: Heraldry;
  /** Seed for name suggestions and the three generated members. */
  seed: number;
  suggestionPage: number;
}

export interface LegacyFlowState {
  view: LegacyFlowView;
  draft: LegacyFoundingDraftState;
  /** The large-key keyboard edits either the banner name (step 2) or the motto (step 4). */
  keyboard: { buffer: string; shift: boolean; target: LegacyKeyboardTarget };
  /** Muster nomination selection, prefilled from the current nomination. */
  member: string | null;
  file: FileLetter | null;
  recordTab: LegacyRecordTab;
  recordPage: number;
  noticePage: number;
  noticeId: string | null;
  /** The landmark the environment is asked to emphasise. */
  landmark: LandmarkId | null;
  /** The aftermath was set aside for this visit; only Acknowledge clears it from the save. */
  aftermathDeferred: boolean;
}

export type LegacyFlowEvent =
  | { type: 'show'; view: 'loading' | 'recovery' | 'overview' | 'aftermath' }
  | { type: 'begin-founding'; nationId: NationId; seed: number }
  | { type: 'choose-nation'; nationId: NationId }
  | { type: 'founding-step'; view: 'nation' | 'name' | 'arms' | 'confirm' }
  | { type: 'suggest'; name: string }
  | { type: 'more-names' }
  | { type: 'open-keyboard' }
  | { type: 'open-motto' }
  | { type: 'clear-motto' }
  | { type: 'key'; key: string }
  | { type: 'key-action'; action: LegacyKeyAction }
  | { type: 'keyboard-done' }
  | { type: 'keyboard-cancel' }
  | { type: 'heraldry'; heraldry: Heraldry }
  | { type: 'cycle-part'; part: LegacyHeraldryPart; step: 1 | -1 }
  | { type: 'founded' }
  | { type: 'raised-done' }
  | { type: 'acknowledged' }
  | { type: 'defer-aftermath' }
  | { type: 'review-aftermath' }
  | { type: 'open-landmark'; landmark: LandmarkId; member: string | null; file: FileLetter | null; recordTab?: LegacyRecordTab }
  | { type: 'overview' }
  | { type: 'open-nominate' }
  | { type: 'close-nominate' }
  | { type: 'nominated' }
  | { type: 'select-member'; memberId: string }
  | { type: 'select-file'; file: FileLetter }
  | { type: 'record-tab'; tab: LegacyRecordTab }
  | { type: 'page'; list: 'record' | 'notices'; delta: 1 | -1; total: number }
  | { type: 'open-notice'; noticeId: string }
  | { type: 'notice-list' }
  | { type: 'request-accept' }
  | { type: 'accepted' }
  | { type: 'show-awaiting' }
  | { type: 'cancel-accept' }
  | { type: 'request-reset' }
  | { type: 'cancel-reset' };

export function createFoundingDraft(nationId: NationId, seed: number): LegacyFoundingDraftState {
  return { nationId, name: '', motto: '', heraldry: defaultHeraldry(nationId), seed: seed >>> 0, suggestionPage: 0 };
}

export function createLegacyFlow(nationId: NationId, seed = 0): LegacyFlowState {
  return {
    view: 'loading',
    draft: createFoundingDraft(nationId, seed),
    keyboard: { buffer: '', shift: false, target: 'name' },
    member: null,
    file: null,
    recordTab: 'conflicts',
    recordPage: 0,
    noticePage: 0,
    noticeId: null,
    landmark: null,
    aftermathDeferred: false,
  };
}

export function isFoundingView(view: LegacyFlowView): view is LegacyFoundingView {
  return (LEGACY_FOUNDING_VIEWS as readonly string[]).indexOf(view) !== -1;
}

/** The founding step a view belongs to; the keyboard counts as the step it edits. */
export function foundingStepOf(flow: LegacyFlowState): number {
  if (flow.view === 'keyboard') return flow.keyboard.target === 'motto' ? LEGACY_FOUNDING_STEP.confirm : LEGACY_FOUNDING_STEP.name;
  return isFoundingView(flow.view) ? LEGACY_FOUNDING_STEP[flow.view] : 0;
}

/** Views in which pointing at a landmark in the holding opens its inspector. */
export function acceptsLandmarkSelection(view: LegacyFlowView): boolean {
  return view === 'overview' || view === 'aftermath' || view === 'banner-hall' || view === 'muster-grounds' || view === 'war-record'
    || view === 'heralds-station' || view === 'nominate' || view === 'notice' || view === 'awaiting';
}

/** The landmark whose inspector a view belongs to, for staging emphasis. */
export function landmarkOfView(view: LegacyFlowView): LandmarkId | null {
  if (view === 'banner-hall' || view === 'muster-grounds' || view === 'war-record' || view === 'heralds-station') return view;
  if (view === 'raised' || view === 'reset') return 'banner-hall';
  if (view === 'nominate') return 'muster-grounds';
  if (view === 'notice' || view === 'accept' || view === 'awaiting') return 'heralds-station';
  return null;
}

/** The quick-pick names for the draft's current page; always LEGACY_SUGGESTION_SLOTS distinct names. */
export function suggestionSlots(draft: LegacyFoundingDraftState): string[] {
  const pool = suggestBannerNames(draft.nationId, draft.seed, BANNER_NAME_SUGGESTIONS[draft.nationId].length);
  const out: string[] = [];
  if (pool.length === 0) return out;
  const pages = Math.ceil(pool.length / LEGACY_SUGGESTION_SLOTS);
  const start = (draft.suggestionPage % pages) * LEGACY_SUGGESTION_SLOTS;
  for (let index = 0; index < Math.min(LEGACY_SUGGESTION_SLOTS, pool.length); index++) out.push(pool[(start + index) % pool.length]);
  return out;
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

/** Keys a banner name cannot contain; the keyboard shows them disabled while a name is typed. */
export const MOTTO_ONLY_KEYS: readonly string[] = [',', '.'];

/** Name casing for the letter keyboard: capitals start the name and each word unless Shift says otherwise. */
export function typeNameKey(buffer: string, key: string, shift: boolean): string {
  if (characterCount(buffer) >= BANNER_NAME_MAX) return buffer;
  if (key === "'" || key === '-') return buffer.length === 0 ? buffer : buffer + key;
  if (!/^[A-Z]$/.test(key)) return buffer;
  const last = buffer.charAt(buffer.length - 1);
  const wordStart = buffer.length === 0 || last === ' ' || last === '-';
  return buffer + (wordStart !== shift ? key : key.toLowerCase());
}

/** Sentence casing for a motto: a capital opens the motto and each sentence unless Shift says otherwise. */
export function typeMottoKey(buffer: string, key: string, shift: boolean): string {
  if (characterCount(buffer) >= MOTTO_MAX) return buffer;
  if (key === "'" || key === '-' || key === ',' || key === '.') return buffer.length === 0 ? buffer : buffer + key;
  if (!/^[A-Z]$/.test(key)) return buffer;
  const sentenceStart = buffer.length === 0 || /[.!?] $/.test(buffer);
  return buffer + (sentenceStart !== shift ? key : key.toLowerCase());
}

export function applyKeyAction(keyboard: LegacyFlowState['keyboard'], action: LegacyKeyAction): LegacyFlowState['keyboard'] {
  const { buffer } = keyboard;
  const max = keyboard.target === 'motto' ? MOTTO_MAX : BANNER_NAME_MAX;
  switch (action) {
    case 'shift':
      return { ...keyboard, shift: !keyboard.shift };
    case 'space':
      if (buffer.length === 0 || buffer.charAt(buffer.length - 1) === ' ' || characterCount(buffer) >= max) return keyboard;
      return { ...keyboard, buffer: `${buffer} ` };
    case 'delete':
      return buffer.length === 0 ? keyboard : { ...keyboard, buffer: Array.from(buffer).slice(0, -1).join('') };
    case 'clear':
      return buffer.length === 0 && !keyboard.shift ? keyboard : { ...keyboard, buffer: '', shift: false };
  }
}

/** True when a key types something for the keyboard's current target. */
export function keyAccepted(target: LegacyKeyboardTarget, key: string): boolean {
  return target === 'motto' || MOTTO_ONLY_KEYS.indexOf(key) === -1;
}

function cycle<T>(values: readonly T[], value: T, step: 1 | -1): T {
  const index = values.indexOf(value);
  return values[((index === -1 ? 0 : index + step) + values.length) % values.length];
}

function contrastingTincture(tincture: Tincture): Tincture {
  for (const candidate of TINCTURES) if (tinctureClass(candidate) !== tinctureClass(tincture)) return candidate;
  return tincture;
}

/** Steps one heraldic element through its vocabulary. A newly divided field gets a contrasting second tincture. */
export function cycleHeraldryPart(heraldry: Heraldry, part: LegacyHeraldryPart, step: 1 | -1): Heraldry {
  const next = cloneHeraldry(heraldry);
  switch (part) {
    case 'division':
      next.division = cycle(DIVISIONS, heraldry.division, step);
      if (heraldry.division === 'plain' && next.division !== 'plain' && heraldry.field[0] === heraldry.field[1]) {
        next.field = [heraldry.field[0], contrastingTincture(heraldry.field[0])];
      }
      break;
    case 'field0': {
      // A plain field keeps its unused second tincture equal to the first, as the presets do.
      const tincture = cycle(TINCTURES, heraldry.field[0], step);
      next.field = [tincture, heraldry.division === 'plain' ? tincture : heraldry.field[1]];
      break;
    }
    case 'field1':
      next.field = [heraldry.field[0], cycle(TINCTURES, heraldry.field[1], step)];
      break;
    case 'ordinary':
      next.ordinary = cycle(ORDINARIES, heraldry.ordinary, step);
      break;
    case 'ordinaryTincture':
      next.ordinaryTincture = cycle(TINCTURES, heraldry.ordinaryTincture, step);
      break;
    case 'charge':
      next.charge = cycle(CHARGES, heraldry.charge, step);
      break;
    case 'chargeTincture':
      next.chargeTincture = cycle(TINCTURES, heraldry.chargeTincture, step);
      break;
  }
  return next;
}

/** The elements a design currently uses: a second field only when divided, tinctures only for present parts. */
export function visibleHeraldryParts(heraldry: Heraldry): Readonly<Record<LegacyHeraldryPart, boolean>> {
  return {
    division: true,
    field0: true,
    field1: heraldry.division !== 'plain',
    ordinary: true,
    ordinaryTincture: heraldry.ordinary !== 'none',
    charge: true,
    chargeTincture: heraldry.charge !== 'none',
  };
}

function withView(flow: LegacyFlowState, view: LegacyFlowView): LegacyFlowState {
  return flow.view === view ? flow : { ...flow, view };
}

function withDraft(flow: LegacyFlowState, draft: Partial<LegacyFoundingDraftState>): LegacyFlowState {
  return { ...flow, draft: { ...flow.draft, ...draft } };
}

/** Founding steps may only move forward from a ready step and back to an earlier one. */
function foundingStep(flow: LegacyFlowState, view: 'nation' | 'name' | 'arms' | 'confirm'): LegacyFlowState {
  const current = flow.view;
  if (!isFoundingView(current) || current === 'keyboard') return flow;
  const from = LEGACY_FOUNDING_STEP[current];
  const to = LEGACY_FOUNDING_STEP[view];
  if (to > from + 1) return flow;
  if (to > from && current === 'name' && !validateBannerName(flow.draft.name).ok) return flow;
  return withView(flow, view);
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Pure Legacy panel navigation. Unknown or out-of-place events return the same object. */
export function reduceLegacyFlow(flow: LegacyFlowState, event: LegacyFlowEvent): LegacyFlowState {
  switch (event.type) {
    case 'show':
      return { ...flow, view: event.view, landmark: null, noticeId: null };
    case 'begin-founding':
      return {
        ...flow,
        view: 'nation',
        draft: createFoundingDraft(event.nationId, event.seed),
        keyboard: { buffer: '', shift: false, target: 'name' },
        member: null, file: null, recordTab: 'conflicts', recordPage: 0, noticePage: 0, noticeId: null, landmark: null, aftermathDeferred: false,
      };
    case 'choose-nation':
      if (flow.view !== 'nation' || flow.draft.nationId === event.nationId) return flow;
      return withDraft(flow, { nationId: event.nationId, heraldry: defaultHeraldry(event.nationId), suggestionPage: 0 });
    case 'founding-step':
      return foundingStep(flow, event.view);
    case 'suggest':
      if (flow.view !== 'name' || flow.draft.name === event.name) return flow;
      return withDraft(flow, { name: event.name });
    case 'more-names':
      return flow.view === 'name' ? withDraft(flow, { suggestionPage: flow.draft.suggestionPage + 1 }) : flow;
    case 'open-keyboard':
      return flow.view === 'name' ? { ...flow, view: 'keyboard', keyboard: { buffer: flow.draft.name, shift: false, target: 'name' } } : flow;
    case 'open-motto':
      return flow.view === 'confirm' ? { ...flow, view: 'keyboard', keyboard: { buffer: flow.draft.motto, shift: false, target: 'motto' } } : flow;
    case 'clear-motto':
      return flow.view === 'confirm' && flow.draft.motto !== '' ? withDraft(flow, { motto: '' }) : flow;
    case 'key': {
      if (flow.view !== 'keyboard') return flow;
      const { target, buffer: current, shift } = flow.keyboard;
      if (!keyAccepted(target, event.key)) return flow;
      const buffer = target === 'motto' ? typeMottoKey(current, event.key, shift) : typeNameKey(current, event.key, shift);
      if (buffer === current) return flow;
      return { ...flow, keyboard: { buffer, shift: /^[A-Z]$/.test(event.key) ? false : shift, target } };
    }
    case 'key-action': {
      if (flow.view !== 'keyboard') return flow;
      const keyboard = applyKeyAction(flow.keyboard, event.action);
      return keyboard === flow.keyboard ? flow : { ...flow, keyboard };
    }
    case 'keyboard-done': {
      if (flow.view !== 'keyboard') return flow;
      const motto = flow.keyboard.target === 'motto';
      const text = collapse(flow.keyboard.buffer);
      return { ...withDraft(flow, motto ? { motto: text } : { name: text }), view: motto ? 'confirm' : 'name' };
    }
    case 'keyboard-cancel':
      return flow.view === 'keyboard' ? withView(flow, flow.keyboard.target === 'motto' ? 'confirm' : 'name') : flow;
    case 'heraldry':
      if (flow.view !== 'arms' || heraldryEquals(flow.draft.heraldry, event.heraldry)) return flow;
      return withDraft(flow, { heraldry: cloneHeraldry(event.heraldry) });
    case 'cycle-part':
      if (flow.view !== 'arms') return flow;
      if (!visibleHeraldryParts(flow.draft.heraldry)[event.part]) return flow;
      return withDraft(flow, { heraldry: cycleHeraldryPart(flow.draft.heraldry, event.part, event.step) });
    case 'founded':
      return flow.view === 'confirm' ? { ...flow, view: 'raised', landmark: null } : flow;
    case 'raised-done':
      return flow.view === 'raised' ? { ...flow, view: 'overview', landmark: null } : flow;
    case 'acknowledged':
      return flow.view === 'aftermath' ? { ...flow, view: 'overview', aftermathDeferred: false } : flow;
    case 'defer-aftermath':
      return flow.view === 'aftermath' ? { ...flow, view: 'overview', aftermathDeferred: true } : flow;
    case 'review-aftermath':
      return flow.view === 'overview' ? { ...flow, view: 'aftermath', aftermathDeferred: false } : flow;
    case 'open-landmark':
      if (!acceptsLandmarkSelection(flow.view)) return flow;
      return {
        ...flow,
        view: LEGACY_LANDMARK_VIEW[event.landmark],
        landmark: event.landmark,
        member: event.member,
        file: event.file,
        recordTab: event.landmark === 'war-record' && flow.view !== 'war-record' ? event.recordTab ?? 'conflicts' : flow.recordTab,
        recordPage: event.landmark === 'war-record' && flow.view !== 'war-record' ? 0 : flow.recordPage,
        noticePage: event.landmark === 'heralds-station' && flow.view !== 'heralds-station' ? 0 : flow.noticePage,
        noticeId: null,
        // Opening a landmark from the aftermath sets it aside for this visit, as Later does.
        aftermathDeferred: flow.view === 'aftermath' ? true : flow.aftermathDeferred,
      };
    case 'overview':
      if (flow.view === 'overview' || flow.view === 'aftermath' || !acceptsLandmarkSelection(flow.view)) return flow;
      return { ...flow, view: 'overview', landmark: null, noticeId: null };
    case 'open-nominate':
      return flow.view === 'muster-grounds' ? withView(flow, 'nominate') : flow;
    case 'close-nominate':
    case 'nominated':
      return flow.view === 'nominate' ? withView(flow, 'muster-grounds') : flow;
    case 'select-member':
      return flow.view === 'nominate' && flow.member !== event.memberId ? { ...flow, member: event.memberId } : flow;
    case 'select-file':
      return flow.view === 'nominate' && flow.file !== event.file ? { ...flow, file: event.file } : flow;
    case 'record-tab':
      return flow.view === 'war-record' && flow.recordTab !== event.tab ? { ...flow, recordTab: event.tab, recordPage: 0 } : flow;
    case 'page': {
      const pages = Math.max(1, event.total);
      if (event.list === 'record') {
        if (flow.view !== 'war-record') return flow;
        const recordPage = Math.max(0, Math.min(pages - 1, flow.recordPage + event.delta));
        return recordPage === flow.recordPage ? flow : { ...flow, recordPage };
      }
      if (flow.view !== 'heralds-station') return flow;
      const noticePage = Math.max(0, Math.min(pages - 1, flow.noticePage + event.delta));
      return noticePage === flow.noticePage ? flow : { ...flow, noticePage };
    }
    case 'open-notice':
      return flow.view === 'heralds-station' ? { ...flow, view: 'notice', noticeId: event.noticeId, landmark: 'heralds-station' } : flow;
    case 'notice-list':
      return flow.view === 'notice' || flow.view === 'awaiting' ? { ...flow, view: 'heralds-station', noticeId: null } : flow;
    case 'request-accept':
      return flow.view === 'notice' ? withView(flow, 'accept') : flow;
    case 'accepted':
      return flow.view === 'accept' ? withView(flow, 'awaiting') : flow;
    case 'show-awaiting':
      return flow.view === 'notice' ? withView(flow, 'awaiting') : flow;
    case 'cancel-accept':
      return flow.view === 'accept' ? withView(flow, 'notice') : flow;
    case 'request-reset':
      return flow.view === 'banner-hall' ? withView(flow, 'reset') : flow;
    case 'cancel-reset':
      return flow.view === 'reset' ? withView(flow, 'banner-hall') : flow;
  }
}
