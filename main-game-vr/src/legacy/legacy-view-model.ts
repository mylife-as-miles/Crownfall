// Pure view model for the Quest My Legacy panels: every string, visibility and
// selection the runtime writes into UIKit, derived from the shared Legacy state,
// shared copy and the panel flow. Keeping it free of IWSDK makes the panel
// content testable and keeps the four landmark inspectors in step with desktop,
// which renders the same shared data. Shared copy is shown whole: no
// consequence is ever shortened to fit a box.

import { END_REASON_PHRASES, LEGACY_COPY, LEGACY_TEXT, PIECE_NAMES, sentenceCase } from '../../../shared/legacy/content/copy';
import type { LegacyWagerTerms, RepresentativeCondition } from '../../../shared/legacy/content/copy';
import {
  CHARGE_LABELS, DIVISION_LABELS, HERALDRY_PRESETS, ORDINARY_LABELS, describeHeraldry, heraldryEquals, tinctureAdvisory, tinctureInfo,
} from '../../../shared/legacy/content/heraldry';
import { CROWN_TITLES, getAlliedHouse, getRivalHouse } from '../../../shared/legacy/content/houses';
import { FILES, MUSTER_FILE_CLAIMS, eligibleMusterFiles } from '../../../shared/legacy/content/muster';
import { LEGACY_NATION_AVAILABILITY, NATIONS, NATION_ORDER } from '../../../shared/legacy/content/nations';
import { prominentAftermath } from '../../../shared/legacy/domain/aftermath';
import { chronicleNewestFirst } from '../../../shared/legacy/domain/chronicle';
import { MOTTO_MAX, generateFoundingMembers, validateBannerName } from '../../../shared/legacy/domain/founding';
import { createMusterFormation, musterReadiness, standardPieceAt } from '../../../shared/legacy/domain/formation';
import { houseDisplayName } from '../../../shared/legacy/domain/identity';
import { nominationRefusal } from '../../../shared/legacy/domain/nomination';
import { challengeOpponentNation, findNotice, isChallengeNotice } from '../../../shared/legacy/domain/notices';
import { presentBannerhold, representativeCondition } from '../../../shared/legacy/domain/presentation';
import { findMember } from '../../../shared/legacy/domain/state';
import { LEGACY_LANDMARKS, TINCTURE_SRGB } from '../../../shared/legacy/environment-contract';
import type { LegacySceneState } from '../../../shared/legacy/environment-contract';
import type { LegacySession } from '../../../shared/legacy/domain/persistence';
import type { HeraldNotice, Heraldry, LandmarkId, LegacyState, Tincture } from '../../../shared/legacy/types';
import { LEGACY_ACTION_LABELS, LEGACY_VIEW_MIRRORS } from './legacy-actions.js';
import {
  LEGACY_FOUNDING_STEP_COUNT, LEGACY_RECORD_TABS, foundingStepOf, isFoundingView, keyAccepted, landmarkOfView, suggestionSlots, visibleHeraldryParts,
} from './legacy-flow.js';
import type { LegacyFlowState, LegacyRecordTab } from './legacy-flow.js';
import {
  LEGACY_AFTERMATH_SLOTS, LEGACY_FORMATION_LEGEND, LEGACY_FORMATION_RANKS, LEGACY_HERALDRY_PARTS, LEGACY_HONOUR_SLOTS, LEGACY_KEY_ROWS,
  LEGACY_LEDGER_ROWS, LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE, LEGACY_RECORD_PAGE, LEGACY_UI_COLORS, LEGACY_UI_LAYOUT, LEGACY_WAGER_TERM_SLOTS,
  legacyFileId, legacyFormationCellId, legacyKeyId, legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId, legacyRecordTabId,
  legacyWagerTermId,
} from './legacy-ui-contract.js';
import type { LegacyFormationGroup, LegacyHeraldryPart, LegacyPanelActionId, LegacyViewId } from './legacy-ui-contract.js';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy.js';

export type LegacyEnvironmentKind = 'environment' | 'standin';

export interface LegacySessionInfo {
  kind: LegacySession['kind'];
  persistent: boolean;
  /** True when the banner on show is known to be in this device's storage: loaded from it, or saved since. */
  saved: boolean;
  /** The last save attempt failed. */
  saveFailed: boolean;
  /** The verbatim guest or preview label, or null for a saved banner. */
  label: string | null;
  /** Why storage or a preview could not be used, when that happened. */
  error: string | null;
  reason: 'corrupt' | 'future-version' | 'preview' | 'unavailable' | null;
  /** The development preview's title, for preview sessions. */
  title: string | null;
}

export interface LegacyModelInput {
  state: LegacyState;
  flow: LegacyFlowState;
  session: LegacySessionInfo;
  pause: { paused: boolean; reason: string; canResume: boolean };
  entered: boolean;
  environment: { kind: LegacyEnvironmentKind | null; ready: boolean; fallback: boolean };
  hover: LandmarkId | null;
  message: string;
}

export interface LegacyControlState {
  visible: boolean;
  enabled: boolean;
  selected: boolean;
}

/** Explicit looks set by data: formation cells, legend swatches and placeholder text. */
export interface LegacyElementStyle {
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
}

export interface LegacyPanelModel {
  view: LegacyViewId;
  texts: Record<string, string>;
  controls: Record<string, LegacyControlState>;
  /** Visibility of non-interactive containers (cards, ledger entries, the session band). */
  displays: Record<string, boolean>;
  /** positionLeft overrides, in panel units, for elements laid out by data (open files, a lone aftermath card). */
  positions: Record<string, number>;
  styles: Record<string, LegacyElementStyle>;
  /** The heraldry the panel's banner images should show, if any. */
  heraldry: Heraldry | null;
  /** The allied and rival arms for the Banner Hall's house shields. */
  houses: { allied: Heraldry; rival: Heraldry } | null;
}

export interface LegacyDockModel {
  texts: Record<string, string>;
  controls: Record<string, LegacyControlState>;
  /** The panel controls the tray's Back and primary buttons press, when the current view has them. */
  mirror: { back: LegacyPanelActionId | null; primary: LegacyPanelActionId | null };
}

const VIEW_ELEMENT: Readonly<Record<LegacyFlowState['view'], LegacyViewId>> = {
  loading: 'LegacyView_Loading',
  recovery: 'LegacyView_Recovery',
  replace: 'LegacyView_Reset',
  nation: 'LegacyView_Nation',
  name: 'LegacyView_Name',
  keyboard: 'LegacyView_Keyboard',
  arms: 'LegacyView_Arms',
  confirm: 'LegacyView_Confirm',
  raised: 'LegacyView_Raised',
  aftermath: 'LegacyView_Aftermath',
  overview: 'LegacyView_Overview',
  'banner-hall': 'LegacyView_Hall',
  'muster-grounds': 'LegacyView_Muster',
  nominate: 'LegacyView_Nominate',
  'war-record': 'LegacyView_Record',
  'heralds-station': 'LegacyView_Herald',
  notice: 'LegacyView_Notice',
  accept: 'LegacyView_Accept',
  awaiting: 'LegacyView_Awaiting',
  reset: 'LegacyView_Reset',
};

export const control = (visible = true, enabled = true, selected = false): LegacyControlState => ({ visible, enabled, selected });

/** Short labels that fit a hand-sized cycler: an explanation in parentheses is dropped when long. */
export function compactLabel(label: string, limit = 20): string {
  return label.length <= limit ? label : label.replace(/\s*\([^)]*\)$/, '');
}

export function tinctureCycleLabel(tincture: Tincture): string {
  const info = tinctureInfo(tincture);
  return compactLabel(`${info.label} (${info.plain})`);
}

/** The value a heraldry cycler shows for its element. */
export function heraldryPartValue(heraldry: Heraldry, part: LegacyHeraldryPart): string {
  switch (part) {
    case 'division': return compactLabel(DIVISION_LABELS[heraldry.division]);
    case 'field0': return tinctureCycleLabel(heraldry.field[0]);
    case 'field1': return tinctureCycleLabel(heraldry.field[1]);
    case 'ordinary': return compactLabel(ORDINARY_LABELS[heraldry.ordinary]);
    case 'ordinaryTincture': return tinctureCycleLabel(heraldry.ordinaryTincture);
    case 'charge': return compactLabel(CHARGE_LABELS[heraldry.charge]);
    case 'chargeTincture': return tinctureCycleLabel(heraldry.chargeTincture);
  }
}

export function formatDay(at: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : '';
}

function bandText(session: LegacySessionInfo): string {
  if (session.kind === 'guest' || session.kind === 'preview' || session.kind === 'preview-missing') return session.label ?? '';
  if (session.kind === 'unavailable') return LEGACY_COPY.storageUnavailable.title;
  return '';
}

function noticeStatus(notice: HeraldNotice): string {
  if (notice.status === 'unread') return LEGACY_COPY.notices.unread;
  if (notice.status === 'accepted') return LEGACY_COPY.notices.accepted;
  if (notice.status === 'resolved') return LEGACY_COPY.notices.resolved;
  return '';
}

function pages(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / size));
}

/** Notices newest first, as the herald hands them over. */
export function noticesNewestFirst(state: LegacyState): HeraldNotice[] {
  return state.notices.slice().reverse();
}

function pager(model: LegacyPanelModel, prefix: 'Record' | 'Herald', page: number, total: number): void {
  const many = total > 1;
  model.controls[`Legacy_${prefix}Prev`] = control(many, page > 0);
  model.controls[`Legacy_${prefix}Next`] = control(many, page < total - 1);
  model.texts[`Legacy_${prefix}_Page`] = many ? QUEST_LEGACY_COPY.page(page + 1, total) : '';
}

function stepSubtitle(flow: LegacyFlowState): string {
  const step = foundingStepOf(flow);
  if (step === 0) return '';
  return `${LEGACY_COPY.founding.stepCounter(step, LEGACY_FOUNDING_STEP_COUNT)} / ${LEGACY_COPY.founding.steps[step - 1].title} / ${LEGACY_COPY.founding.draftLabel}`;
}

function nameHint(name: string): string {
  if (name.trim().length === 0) return LEGACY_COPY.founding.nameRules;
  const result = validateBannerName(name);
  return result.ok ? LEGACY_COPY.founding.nameRules : result.error;
}

function conditionText(condition: RepresentativeCondition): { label: string; description: string } {
  return LEGACY_COPY.status[condition];
}

function readinessText(state: LegacyState): string {
  return musterReadiness(state).reason ?? LEGACY_COPY.readiness.ready;
}

/** Dark or light text, whichever reads on a heraldic colour. */
function textOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance > 140 ? LEGACY_UI_COLORS.surface : LEGACY_UI_COLORS.text;
}

/** Builds the primary panel for the current flow view, or the pause view while paused. */
export function buildLegacyPanelModel(input: LegacyModelInput): LegacyPanelModel {
  const { flow, session } = input;
  const view: LegacyViewId = input.pause.paused ? 'LegacyView_Pause' : VIEW_ELEMENT[flow.view];
  const model: LegacyPanelModel = { view, texts: {}, controls: {}, displays: {}, positions: {}, styles: {}, heraldry: null, houses: null };
  const band = bandText(session);
  model.texts.Legacy_Band = band;
  model.displays.Legacy_BandSurface = band.length > 0;
  model.texts.Legacy_Message = input.pause.paused ? '' : input.message;
  model.texts.Legacy_Subtitle = '';
  if (input.pause.paused) {
    model.texts.Legacy_Title = QUEST_LEGACY_COPY.pause.title;
    model.texts.Legacy_Pause_Reason = input.pause.reason;
    model.texts.Legacy_Pause_Hint = input.pause.canResume ? QUEST_LEGACY_COPY.pause.hint : QUEST_LEGACY_COPY.pause.noHand;
    model.controls.Legacy_Resume = control(input.pause.canResume);
    model.controls.Legacy_PauseHome = control();
    return model;
  }
  const draft = flow.draft;
  switch (flow.view) {
    case 'loading':
      model.texts.Legacy_Title = QUEST_LEGACY_COPY.loading.title;
      model.texts.Legacy_Loading_Body = QUEST_LEGACY_COPY.loading.body;
      break;
    case 'recovery': {
      const future = session.reason === 'future-version';
      model.texts.Legacy_Title = future ? LEGACY_COPY.futureSave.title : LEGACY_COPY.invalidSave.title;
      model.texts.Legacy_Recovery_Body = future ? LEGACY_COPY.futureSave.body : LEGACY_COPY.invalidSave.body;
      model.texts.Legacy_Recovery_Note = future ? LEGACY_COPY.futureSave.replaceNote : LEGACY_COPY.invalidSave.startNewNote;
      model.texts.Legacy_Recovery_Detail = session.error ? `${LEGACY_COPY.invalidSave.details}: ${session.error}` : '';
      for (const id of ['Legacy_RecoveryHome', 'Legacy_RecoveryGuest', 'Legacy_RecoveryNew']) model.controls[id] = control();
      break;
    }
    case 'replace':
      model.texts.Legacy_Title = LEGACY_COPY.newBanner.title;
      model.texts.Legacy_Reset_Body = session.reason === 'future-version' ? LEGACY_COPY.futureSave.replaceNote : LEGACY_COPY.invalidSave.startNewNote;
      model.texts.Legacy_ResetConfirm_Label = LEGACY_COPY.invalidSave.startNew;
      model.texts.Legacy_ResetCancel_Label = LEGACY_COPY.founding.back;
      model.controls.Legacy_ResetCancel = control();
      model.controls.Legacy_ResetConfirm = control();
      break;
    case 'nation':
      model.texts.Legacy_Title = LEGACY_COPY.founding.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      for (const nationId of NATION_ORDER) {
        const availability = LEGACY_NATION_AVAILABILITY[nationId];
        model.controls[legacyNationId(nationId)] = control(availability !== 'unavailable', true, nationId === draft.nationId);
        model.texts[`${legacyNationId(nationId)}_Status`] = availability === 'available' ? '' : LEGACY_COPY.founding.availability[availability];
      }
      model.texts.Legacy_Nation_Summary = NATIONS[draft.nationId].summary;
      // The tray's Return to Home sits in reach; a second identical control on the panel only competes with it.
      model.controls.Legacy_FoundingHome = control(false);
      model.controls.Legacy_NationNext = control();
      break;
    case 'name': {
      model.texts.Legacy_Title = LEGACY_COPY.founding.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      model.texts.Legacy_Name_Value = draft.name.length > 0 ? draft.name : QUEST_LEGACY_COPY.namePrompt;
      suggestionSlots(draft).forEach((name, index) => {
        model.texts[`Legacy_Suggestion_${index}_Label`] = name;
        model.controls[`Legacy_Suggestion_${index}`] = control(true, true, name === draft.name);
      });
      model.texts.Legacy_Name_Rules = nameHint(draft.name);
      model.controls.Legacy_MoreNames = control();
      model.controls.Legacy_OpenKeyboard = control();
      model.controls.Legacy_NameBack = control();
      model.controls.Legacy_NameNext = control(true, validateBannerName(draft.name).ok);
      break;
    }
    case 'keyboard': {
      const motto = flow.keyboard.target === 'motto';
      model.texts.Legacy_Title = motto ? QUEST_LEGACY_COPY.keyboard.mottoTitle : QUEST_LEGACY_COPY.keyboard.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      // No caret glyph: the spatial font atlas has neither '_' nor '|', and typing always appends at the end.
      model.texts.Legacy_Keyboard_Value = flow.keyboard.buffer.length > 0 ? flow.keyboard.buffer : QUEST_LEGACY_COPY.keyboard.placeholder;
      model.texts.Legacy_Keyboard_Hint = motto
        ? QUEST_LEGACY_COPY.page(Array.from(flow.keyboard.buffer).length, MOTTO_MAX)
        : nameHint(flow.keyboard.buffer);
      for (const key of LEGACY_KEY_ROWS.flat()) model.controls[legacyKeyId(key)] = control(true, keyAccepted(flow.keyboard.target, key));
      model.controls.Legacy_Key_Shift = control(true, true, flow.keyboard.shift);
      model.controls.Legacy_KeyboardCancel = control();
      model.controls.Legacy_KeyboardDone = control();
      break;
    }
    case 'arms': {
      model.texts.Legacy_Title = LEGACY_COPY.founding.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      HERALDRY_PRESETS[draft.nationId].forEach((preset, index) => {
        model.texts[`Legacy_Preset_${index}_Label`] = preset.label;
        model.controls[`Legacy_Preset_${index}`] = control(true, true, heraldryEquals(preset.heraldry, draft.heraldry));
      });
      const visible = visibleHeraldryParts(draft.heraldry);
      for (const part of LEGACY_HERALDRY_PARTS) {
        model.controls[legacyPartId(part)] = control(visible[part]);
        model.controls[legacyPartPreviousId(part)] = control(visible[part]);
        model.texts[`${legacyPartId(part)}_Value`] = heraldryPartValue(draft.heraldry, part);
      }
      model.texts.Legacy_Arms_Blazon = describeHeraldry(draft.heraldry);
      const advice = tinctureAdvisory(draft.heraldry);
      model.texts.Legacy_Arms_Advice = `${LEGACY_COPY.founding.advisoryTitle}: ${advice.length > 0 ? advice.map((item) => item.message).join(' ') : LEGACY_COPY.founding.advisoryClear}`;
      model.controls.Legacy_ArmsBack = control();
      model.controls.Legacy_ArmsNext = control();
      model.heraldry = draft.heraldry;
      break;
    }
    case 'confirm': {
      model.texts.Legacy_Title = LEGACY_COPY.founding.confirmTitle;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      model.texts.Legacy_Confirm_Name = draft.name;
      model.texts.Legacy_Confirm_Nation = `${NATIONS[draft.nationId].polity} / ${LEGACY_COPY.rank['minor-banner']}`;
      model.texts.Legacy_Confirm_Blazon = describeHeraldry(draft.heraldry);
      const hasMotto = draft.motto.length > 0;
      model.texts.Legacy_Confirm_Motto = hasMotto ? `"${draft.motto}"` : LEGACY_COPY.founding.mottoPlaceholder;
      model.styles.Legacy_Confirm_Motto = { color: hasMotto ? LEGACY_UI_COLORS.text : LEGACY_UI_COLORS.muted };
      model.controls.Legacy_ConfirmMotto = control();
      model.controls.Legacy_ConfirmClearMotto = control(hasMotto);
      model.texts.Legacy_Confirm_Members = generateFoundingMembers(draft.nationId, draft.seed)
        .map((member) => `${member.name}, ${member.epithet}`).join(' / ');
      model.texts.Legacy_Confirm_Body = session.persistent ? LEGACY_COPY.founding.confirmBody : LEGACY_COPY.founding.guestConfirmBody;
      model.controls.Legacy_ConfirmBack = control();
      model.controls.Legacy_ConfirmRaise = control(true, validateBannerName(draft.name).ok);
      model.heraldry = draft.heraldry;
      break;
    }
    default:
      buildBannerholdView(model, input);
  }
  return model;
}

function landmarkStatus(state: LegacyState, scene: LegacySceneState, landmark: LandmarkId): string {
  switch (landmark) {
    case 'banner-hall':
      return `${LEGACY_COPY.rank[scene.rank]} / ${LEGACY_COPY.hallTiers[scene.hallTier]} / ${LEGACY_COPY.recognitionLabel(state.standing.recognition)}`;
    case 'muster-grounds': {
      const rep = scene.representative;
      if (!rep) return LEGACY_COPY.empty.representative;
      // Absence is felt where the house looks first: the empty place, and who holds them.
      if (rep.status === 'captive' && rep.captorName) return `${rep.name} / ${LEGACY_COPY.inspector.emptyPlace(sentenceCase(rep.captorName))}`;
      const file = rep.file ? ` / ${LEGACY_COPY.inspector.fileName(rep.file)}` : '';
      return `${rep.name} / ${conditionText(representativeCondition(rep)).label}${file}`;
    }
    case 'war-record':
      return state.chronicle.length === 0
        ? LEGACY_COPY.empty.matches
        : `${LEGACY_COPY.counts.conflicts(state.matches.length)} / ${LEGACY_COPY.counts.unresolved(state.unresolved.length)}`;
    case 'heralds-station':
      if (state.notices.length === 0) return LEGACY_COPY.empty.notices;
      return scene.unreadNotices > 0
        ? `${LEGACY_COPY.counts.unread(scene.unreadNotices)} / ${LEGACY_COPY.counts.notices(state.notices.length)}`
        : LEGACY_COPY.counts.notices(state.notices.length);
  }
}

function buildBannerholdView(model: LegacyPanelModel, input: LegacyModelInput): void {
  const { state, flow, session } = input;
  const banner = state.banner;
  const landmark = landmarkOfView(flow.view);
  if (landmark) model.texts.Legacy_Subtitle = LEGACY_COPY.landmarks[landmark].description;
  if (!banner) {
    // Unreachable through the flow; keeps the frame truthful if a state is ever replaced underneath.
    model.texts.Legacy_Title = LEGACY_COPY.title;
    model.texts.Legacy_Subtitle = LEGACY_COPY.empty.unfounded;
    return;
  }
  const scene = presentBannerhold(state);
  const nation = NATIONS[banner.nationId];
  const persistentNote = (): void => {
    if (model.texts.Legacy_Message === '' && session.persistent) model.texts.Legacy_Message = LEGACY_COPY.noSync;
  };
  switch (flow.view) {
    case 'raised':
      model.texts.Legacy_Title = LEGACY_COPY.founding.title;
      model.texts.Legacy_Subtitle = `${nation.polity} / ${LEGACY_COPY.rank[scene.rank]}`;
      model.texts.Legacy_Raised_Heading = LEGACY_COPY.aftermath.headings.founding;
      model.texts.Legacy_Raised_Name = banner.name;
      model.texts.Legacy_Raised_Motto = banner.motto ? `"${banner.motto}"` : '';
      model.displays.Legacy_Raised_Motto = !!banner.motto;
      model.texts.Legacy_Raised_Body = LEGACY_TEXT.founding(banner.name, nation.polity).body;
      model.controls.Legacy_RaisedContinue = control();
      model.heraldry = banner.heraldry;
      break;
    case 'aftermath':
      buildAftermathView(model, input);
      break;
    case 'overview':
      buildOverview(model, input, scene);
      break;
    case 'banner-hall':
      buildHallView(model, input, scene);
      break;
    case 'muster-grounds':
      buildMusterView(model, input, scene);
      break;
    case 'nominate':
      buildNominateView(model, input, scene);
      break;
    case 'war-record':
      buildRecordView(model, input);
      break;
    case 'heralds-station': {
      model.texts.Legacy_Title = LEGACY_COPY.landmarks['heralds-station'].title;
      const notices = noticesNewestFirst(state);
      model.texts.Legacy_Subtitle = notices.length === 0
        ? LEGACY_COPY.landmarks['heralds-station'].description
        : `${LEGACY_COPY.counts.notices(notices.length)} / ${LEGACY_COPY.counts.unread(scene.unreadNotices)} / ${readinessText(state)}`;
      const total = pages(notices.length, LEGACY_NOTICE_PAGE);
      const page = Math.min(flow.noticePage, total - 1);
      for (let index = 0; index < LEGACY_NOTICE_PAGE; index++) {
        const notice = notices[page * LEGACY_NOTICE_PAGE + index];
        const id = `Legacy_Notice_${index}`;
        model.controls[id] = control(!!notice);
        if (!notice) continue;
        model.texts[`${id}_Kind`] = LEGACY_COPY.notices.kinds[notice.kind];
        model.texts[`${id}_Status`] = noticeStatus(notice);
        model.texts[`${id}_Title`] = notice.title;
        model.texts[`${id}_From`] = noticeFrom(notice, scene);
      }
      model.displays.Legacy_Herald_Empty = notices.length === 0;
      model.controls.Legacy_HeraldBack = control();
      pager(model, 'Herald', page, total);
      break;
    }
    case 'notice':
    case 'accept':
      buildNoticeView(model, input, scene);
      break;
    case 'awaiting':
      model.texts.Legacy_Title = LEGACY_COPY.awaitingBoard.title;
      model.texts.Legacy_Awaiting_Readiness = readinessText(state);
      model.controls.Legacy_AwaitingBack = control();
      model.controls.Legacy_AwaitingPlay = control();
      break;
    case 'reset':
      model.texts.Legacy_Title = LEGACY_COPY.reset.title;
      model.texts.Legacy_Subtitle = banner.name;
      model.texts.Legacy_Reset_Body = LEGACY_COPY.reset.body;
      model.texts.Legacy_ResetConfirm_Label = LEGACY_COPY.reset.confirm;
      model.texts.Legacy_ResetCancel_Label = LEGACY_COPY.reset.cancel;
      model.controls.Legacy_ResetCancel = control();
      model.controls.Legacy_ResetConfirm = control();
      break;
    default:
      break;
  }
  if (flow.view === 'overview' || flow.view === 'banner-hall') persistentNote();
}

function noticeFrom(notice: HeraldNotice, scene: LegacySceneState): string {
  const from = LEGACY_COPY.notices.from(sentenceCase(houseDisplayName(notice.fromHouseId)));
  const rival = scene.rivalHouse;
  return rival && rival.holdsCaptive && notice.fromHouseId === rival.id ? `${from} / ${LEGACY_COPY.houses.holdsCaptive}` : from;
}

/** Panel x of a lone aftermath card, centred where the pair would stand. */
export const LEGACY_LONE_CARD_LEFT = (LEGACY_UI_LAYOUT.panel.width - 330) / 2;

function buildAftermathView(model: LegacyPanelModel, input: LegacyModelInput): void {
  const { state, session } = input;
  const banner = state.banner;
  if (!banner) return;
  model.texts.Legacy_Title = LEGACY_COPY.aftermath.title;
  model.texts.Legacy_Subtitle = session.kind === 'preview' && session.title ? QUEST_LEGACY_COPY.previewOf(session.title) : banner.name;
  const aftermath = prominentAftermath(state).slice(0, LEGACY_AFTERMATH_SLOTS);
  for (let index = 0; index < LEGACY_AFTERMATH_SLOTS; index++) {
    const entry = aftermath[index];
    const id = `Legacy_Aftermath_${index}`;
    model.displays[id] = !!entry;
    if (!entry) continue;
    // Shown whole: the shared budgets keep every prominent consequence within the card.
    model.texts[`${id}_Heading`] = LEGACY_COPY.aftermath.headings[entry.kind];
    model.texts[`${id}_Title`] = entry.title;
    model.texts[`${id}_Body`] = entry.body;
  }
  model.positions.Legacy_Aftermath_0 = aftermath.length === 1 ? LEGACY_LONE_CARD_LEFT : 24;
  model.texts.Legacy_Aftermath_Note = LEGACY_COPY.aftermath.allRecorded;
  model.controls.Legacy_AftermathLater = control();
  model.controls.Legacy_AftermathDismiss = control(aftermath.length > 0);
}

function buildOverview(model: LegacyPanelModel, input: LegacyModelInput, scene: LegacySceneState): void {
  const { state, session } = input;
  const banner = state.banner;
  if (!banner) return;
  const nation = NATIONS[banner.nationId];
  model.texts.Legacy_Title = banner.name;
  model.texts.Legacy_Subtitle = `${nation.polity} / ${LEGACY_COPY.rank[scene.rank]} / ${LEGACY_COPY.recognitionLabel(state.standing.recognition)}`;
  model.heraldry = banner.heraldry;
  model.texts.Legacy_Overview_Tagline = session.kind === 'preview' && session.title ? QUEST_LEGACY_COPY.previewOf(session.title) : LEGACY_COPY.tagline;
  const pending = prominentAftermath(state);
  model.displays.Legacy_Overview_Pending = pending.length > 0;
  model.texts.Legacy_Overview_Pending = pending.length > 0 ? QUEST_LEGACY_COPY.aftermathPending(pending[0].title) : '';
  model.controls.Legacy_AftermathReview = control(pending.length > 0);
  model.displays.Legacy_Overview_Intro = pending.length === 0;
  for (const id of LEGACY_LANDMARKS) {
    model.controls[legacyLandmarkButtonId(id)] = control(true, true, input.hover === id);
    model.texts[`${legacyLandmarkButtonId(id)}_Status`] = landmarkStatus(state, scene, id);
  }
}

function buildHallView(model: LegacyPanelModel, input: LegacyModelInput, scene: LegacySceneState): void {
  const { state } = input;
  const banner = state.banner;
  if (!banner) return;
  const nation = NATIONS[banner.nationId];
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['banner-hall'].title;
  model.texts.Legacy_Hall_Name = banner.name;
  model.texts.Legacy_Hall_Polity = `${nation.polity} / ${nation.epithet}`;
  model.texts.Legacy_Hall_Motto = banner.motto ? `"${banner.motto}"` : '';
  model.displays.Legacy_Hall_Motto = !!banner.motto;
  model.texts.Legacy_Hall_Rank = `${LEGACY_COPY.rank[scene.rank]} / ${LEGACY_COPY.hallTiers[scene.hallTier]} / ${LEGACY_COPY.recognitionLabel(state.standing.recognition)}`;
  model.texts.Legacy_Hall_Blazon = describeHeraldry(banner.heraldry);
  for (let index = 0; index < LEGACY_HONOUR_SLOTS; index++) {
    const honour = scene.honours[index];
    model.texts[`Legacy_Hall_Honour_${index}`] = honour ? honour.label : '';
    model.displays[`Legacy_Hall_Honour_${index}`] = !!honour;
  }
  model.displays.Legacy_Hall_HonoursEmpty = scene.honours.length === 0;
  const allied = scene.alliedHouse;
  const rival = scene.rivalHouse;
  model.texts.Legacy_Hall_Allied = allied ? QUEST_LEGACY_COPY.house(LEGACY_COPY.houses.allied, allied.name, LEGACY_COPY.stance[allied.stance]) : '';
  model.texts.Legacy_Hall_Rival = rival
    ? QUEST_LEGACY_COPY.house(LEGACY_COPY.houses.rival, `${rival.name} / ${NATIONS[rival.nationId].name}`, LEGACY_COPY.stance[rival.stance])
    : '';
  // Absence is felt in the hall too: the rival is named as holding a member of the house.
  model.texts.Legacy_Hall_RivalNote = rival && rival.holdsCaptive ? LEGACY_COPY.houses.holdsCaptive : '';
  model.styles.Legacy_Hall_RivalNote = { color: LEGACY_UI_COLORS.warning };
  if (allied && rival) model.houses = { allied: allied.heraldry, rival: rival.heraldry };
  model.controls.Legacy_HallBack = control();
  // Development previews are fixture data: they can be neither dissolved nor saved.
  const preview = state.mode === 'preview';
  model.controls.Legacy_ResetOpen = control(!preview);
  model.displays.Legacy_Hall_Locked = preview;
  model.texts.Legacy_Hall_Locked = preview ? LEGACY_COPY.preview.locked : '';
  model.heraldry = banner.heraldry;
}

/** Claimed files grouped by the house holding them, e.g. "d, e (House Ombreval's household guard)". */
export function claimedFilesText(state: LegacyState): string {
  if (!state.banner) return '';
  const groups: { label: string; files: string[] }[] = [];
  for (const claim of MUSTER_FILE_CLAIMS[state.banner.nationId]) {
    let group: { label: string; files: string[] } | null = null;
    for (const item of groups) if (item.label === claim.label) group = item;
    if (!group) { group = { label: claim.label, files: [] }; groups.push(group); }
    group.files.push(claim.file);
  }
  return `${QUEST_LEGACY_COPY.claimed}: ${groups.map((group) => `${group.files.join(', ')} (${group.label})`).join('; ')}`;
}

/** Standard algebraic piece letters (N for the knight). */
const PIECE_LETTERS = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' } as const;

export interface LegacyFormationCell {
  square: string;
  letter: string;
  group: LegacyFormationGroup;
  /** The crown's own King and Queen, outlined in the nation's metal. */
  royal: boolean;
}

/**
 * The house's side of the formation as the current nomination fields it: ranks 2 and 1, files a to h.
 * Only the nominee belongs to the banner; an injured or captive nominee leaves a levy pawn in their place.
 */
export function formationCells(state: LegacyState): LegacyFormationCell[] {
  const banner = state.banner;
  if (!banner) return [];
  const { formation, allegiance } = createMusterFormation(state, { playerSide: 'w', opponentNationId: getRivalHouse(banner.nationId).nationId });
  const cells: LegacyFormationCell[] = [];
  for (const rank of LEGACY_FORMATION_RANKS) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const id = formation[square];
      const owner = allegiance[id];
      const kind = standardPieceAt(square)?.kind ?? 'p';
      const crown = owner.houseId.indexOf('crown:') === 0;
      cells.push({
        square,
        letter: PIECE_LETTERS[kind],
        group: owner.houseId === 'player' ? 'player' : crown ? 'crown' : 'ally',
        royal: crown && id.indexOf('crown:') === 0,
      });
    }
  }
  return cells;
}

function formationColours(state: LegacyState): Readonly<Record<LegacyFormationGroup, string>> | null {
  const banner = state.banner;
  if (!banner) return null;
  return {
    player: TINCTURE_SRGB[banner.heraldry.field[0]],
    ally: TINCTURE_SRGB[getAlliedHouse(banner.nationId).heraldry.field[0]],
    crown: LEGACY_UI_COLORS.crownCell,
  };
}

function buildMusterView(model: LegacyPanelModel, input: LegacyModelInput, scene: LegacySceneState): void {
  const { state } = input;
  const banner = state.banner;
  if (!banner) return;
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['muster-grounds'].title;
  model.texts.Legacy_Subtitle = readinessText(state);
  const rep = scene.representative;
  const nominee = findMember(state, state.nomination.memberId);
  const rows: [string, string][] = [];
  const captive = !!rep && rep.status === 'captive' && !!rep.captorName;
  if (rep && nominee) {
    const condition = representativeCondition(rep);
    model.texts.Legacy_Muster_RepName = rep.name;
    model.texts.Legacy_Muster_RepEpithet = rep.epithet;
    rows.push([LEGACY_COPY.inspector.allegiance, banner.name]);
    rows.push([LEGACY_COPY.inspector.appointment, LEGACY_COPY.inspector.pawnAppointment]);
    if (rep.file) rows.push([LEGACY_COPY.inspector.file, LEGACY_COPY.inspector.fileName(rep.file)]);
    rows.push([LEGACY_COPY.inspector.condition, conditionText(condition).label]);
    if (rep.captorName) rows.push([LEGACY_COPY.inspector.heldBy, sentenceCase(rep.captorName)]);
    if (rep.promotedTo) rows.push([LEGACY_COPY.status.promoted.label, PIECE_NAMES[rep.promotedTo]]);
    rows.push([LEGACY_COPY.inspector.musters, String(nominee.musters)]);
    rows.push([LEGACY_COPY.inspector.captures, String(nominee.captures)]);
    rows.push([LEGACY_COPY.inspector.timesCaptured, String(nominee.timesCaptured)]);
    // One note, never two: a captive's empty place, otherwise the condition as recorded.
    model.texts.Legacy_Muster_RepNote = captive ? '' : rep.promotedTo
      ? LEGACY_COPY.inspector.promotedTo(PIECE_NAMES[rep.promotedTo])
      : conditionText(condition).description;
    model.texts.Legacy_Muster_EmptyPlace_Text = captive && rep.captorName ? LEGACY_COPY.inspector.emptyPlace(sentenceCase(rep.captorName)) : '';
  } else {
    model.texts.Legacy_Muster_RepName = '';
    model.texts.Legacy_Muster_RepEpithet = '';
    model.texts.Legacy_Muster_RepNote = LEGACY_COPY.empty.representative;
    model.texts.Legacy_Muster_EmptyPlace_Text = '';
  }
  model.displays.Legacy_Muster_EmptyPlace = captive;
  model.displays.Legacy_Muster_RepNote = !captive;
  model.displays.Legacy_Muster_RepHeading = !!rep;
  // The ledger fills its rows in order, so an absent row never leaves a gap.
  for (let index = 0; index < LEGACY_LEDGER_ROWS; index++) {
    const row = rows[index];
    const id = `Legacy_Muster_Row_${index}`;
    model.displays[id] = !!row;
    model.texts[`${id}_Label`] = row ? row[0] : '';
    model.texts[`${id}_Value`] = row ? row[1] : '';
  }
  const colours = formationColours(state);
  if (!colours) return;
  const counts: Record<LegacyFormationGroup, number> = { player: 0, ally: 0, crown: 0 };
  const metal = NATIONS[banner.nationId].palette.metal;
  for (const cell of formationCells(state)) {
    counts[cell.group] += 1;
    const id = legacyFormationCellId(cell.square);
    const background = colours[cell.group];
    model.texts[`${id}_Label`] = cell.letter;
    model.styles[id] = {
      backgroundColor: background,
      borderColor: cell.group === 'player' ? LEGACY_UI_COLORS.selectedHoverBorder : cell.royal ? metal : LEGACY_UI_COLORS.surface,
    };
    model.styles[`${id}_Label`] = { color: cell.group === 'crown' ? LEGACY_UI_COLORS.crownText : textOn(background) };
  }
  const ally = getAlliedHouse(banner.nationId);
  const legend: Readonly<Record<LegacyFormationGroup, string>> = {
    player: LEGACY_COPY.inspector.yourBanner,
    ally: ally.name,
    crown: sentenceCase(CROWN_TITLES[banner.nationId]),
  };
  for (const group of LEGACY_FORMATION_LEGEND) {
    model.texts[`Legacy_Legend_${group}`] = `${legend[group]} / ${counts[group]}`;
    model.styles[`Legacy_Legend_${group}_Swatch`] = { backgroundColor: colours[group] };
  }
  model.controls.Legacy_MusterBack = control();
  model.controls.Legacy_MusterChoose = control(state.members.length > 0);
}

/** Panel x of the open-file buttons: open files fill the row from the left in board order. */
export const LEGACY_FILE_ROW = { left: 360, step: 69 } as const;

function buildNominateView(model: LegacyPanelModel, input: LegacyModelInput, scene: LegacySceneState): void {
  const { state, flow } = input;
  const banner = state.banner;
  if (!banner) return;
  model.texts.Legacy_Title = LEGACY_COPY.inspector.nominate;
  model.texts.Legacy_Subtitle = LEGACY_COPY.landmarks['muster-grounds'].description;
  for (let index = 0; index < LEGACY_MEMBER_SLOTS; index++) {
    const member = state.members[index];
    const id = `Legacy_Member_${index}`;
    model.controls[id] = control(!!member, !!member && member.status === 'available', !!member && flow.member === member.id);
    if (!member) continue;
    const nominated = state.nomination.memberId === member.id ? ` / ${LEGACY_COPY.inspector.nominated}` : '';
    model.texts[`${id}_Name`] = `${member.name}, ${member.epithet}`;
    model.texts[`${id}_Status`] = `${LEGACY_COPY.status[member.status].label}${nominated}`;
  }
  const open = eligibleMusterFiles(banner.nationId);
  for (const file of FILES) {
    const slot = open.indexOf(file);
    model.controls[legacyFileId(file)] = control(slot !== -1, true, flow.file === file);
    if (slot !== -1) model.positions[legacyFileId(file)] = LEGACY_FILE_ROW.left + slot * LEGACY_FILE_ROW.step;
  }
  model.texts.Legacy_Nominate_FileCaption = flow.file && open.indexOf(flow.file) !== -1
    ? `${LEGACY_COPY.inspector.fileName(flow.file)} / ${LEGACY_COPY.inspector.openFile}`
    : LEGACY_COPY.inspector.eligibleFiles;
  model.texts.Legacy_Nominate_Claims = claimedFilesText(state);
  const member = flow.member ? findMember(state, flow.member) : null;
  const unchanged = flow.member === state.nomination.memberId && flow.file === state.nomination.file;
  const ready = !!member && !!flow.file && nominationRefusal(state, member.id, flow.file) === null && !unchanged;
  model.texts.Legacy_Nominate_Note = scene.representative && unchanged ? LEGACY_COPY.inspector.nominated : LEGACY_COPY.inspector.formationNote;
  model.controls.Legacy_NominateBack = control();
  model.controls.Legacy_MusterNominate = control(true, ready);
}

/** One card of the War Record, whatever its section. */
export interface LegacyRecordItem {
  id: string;
  title: string;
  /** Right-aligned tag: the outcome, the matter's kind or the entry's heading. */
  kind: string;
  meta: string;
  body: string;
}

const RECORD_LABELS: Readonly<Record<LegacyRecordTab, string>> = {
  conflicts: LEGACY_COPY.sections.conflicts,
  unresolved: LEGACY_COPY.sections.unresolved,
  ledger: LEGACY_COPY.sections.ledger,
};

const RECORD_EMPTY: Readonly<Record<LegacyRecordTab, string>> = {
  conflicts: LEGACY_COPY.empty.matches,
  unresolved: LEGACY_COPY.empty.unresolved,
  ledger: LEGACY_COPY.empty.chronicle,
};

/** The section a visit to the War Record opens on: recorded conflicts, then open matters, then the ledger. */
export function defaultRecordTab(state: LegacyState): LegacyRecordTab {
  if (state.matches.length > 0) return 'conflicts';
  return state.unresolved.length > 0 ? 'unresolved' : 'ledger';
}

/** Every card of a War Record section, newest first where time matters. Nothing here is shortened. */
export function recordItems(state: LegacyState, tab: LegacyRecordTab): LegacyRecordItem[] {
  switch (tab) {
    case 'conflicts':
      return state.matches.slice().reverse().map((match) => {
        const representative = findMember(state, match.representativeId);
        const day = formatDay(match.completedAt);
        const meta = `${sentenceCase(END_REASON_PHRASES[match.reason])} / ${LEGACY_COPY.counts.moves(Math.ceil(match.plies / 2))}${day ? ` / ${day}` : ''}`;
        let body = '';
        if (representative) {
          const file = match.representativeFile ? ` (${LEGACY_COPY.inspector.fileName(match.representativeFile)})` : '';
          const captor = match.representativeCapturedBy ? ` / ${sentenceCase(houseDisplayName(match.representativeCapturedBy))}` : '';
          const captures = match.representativeCaptures > 0 ? ` / ${LEGACY_COPY.inspector.captures} ${match.representativeCaptures}` : '';
          body = `${representative.name}${file}: ${LEGACY_COPY.fate[match.representativeFate]}${captor}${captures}`;
        }
        return {
          id: match.matchId,
          title: `${LEGACY_COPY.stakes[match.stakes].label} / ${NATIONS[match.opponentNationId].name}`,
          kind: LEGACY_COPY.outcome[match.outcome],
          meta,
          body,
        };
      });
    case 'unresolved':
      return state.unresolved.map((matter) => ({ id: matter.id, title: matter.title, kind: LEGACY_COPY.unresolvedKinds[matter.kind], meta: '', body: matter.body }));
    case 'ledger':
      return chronicleNewestFirst(state).map((entry) => ({
        id: entry.id, title: entry.title, kind: LEGACY_COPY.aftermath.headings[entry.kind], meta: formatDay(entry.at), body: entry.body,
      }));
  }
}

function recordCount(state: LegacyState, tab: LegacyRecordTab): number {
  return tab === 'conflicts' ? state.matches.length : tab === 'unresolved' ? state.unresolved.length : state.chronicle.length;
}

function buildRecordView(model: LegacyPanelModel, input: LegacyModelInput): void {
  const { state, flow } = input;
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['war-record'].title;
  model.texts.Legacy_Subtitle = LEGACY_COPY.landmarks['war-record'].description;
  for (const tab of LEGACY_RECORD_TABS) {
    model.controls[legacyRecordTabId(tab)] = control(true, true, flow.recordTab === tab);
    model.texts[`${legacyRecordTabId(tab)}_Label`] = QUEST_LEGACY_COPY.tab(RECORD_LABELS[tab], recordCount(state, tab));
  }
  const items = recordItems(state, flow.recordTab);
  const total = pages(items.length, LEGACY_RECORD_PAGE);
  const page = Math.min(flow.recordPage, total - 1);
  for (let index = 0; index < LEGACY_RECORD_PAGE; index++) {
    const item = items[page * LEGACY_RECORD_PAGE + index];
    const id = `Legacy_Record_Entry_${index}`;
    model.displays[id] = !!item;
    if (!item) continue;
    model.texts[`${id}_Title`] = item.title;
    model.texts[`${id}_Kind`] = item.kind;
    model.texts[`${id}_Meta`] = item.meta;
    model.texts[`${id}_Body`] = item.body;
    model.styles[`${id}_Kind`] = { color: flow.recordTab === 'conflicts' && item.kind === LEGACY_COPY.outcome.defeat ? LEGACY_UI_COLORS.warning : LEGACY_UI_COLORS.accent };
  }
  model.displays.Legacy_Record_Empty = items.length === 0;
  model.texts.Legacy_Record_Empty = RECORD_EMPTY[flow.recordTab];
  model.controls.Legacy_RecordBack = control();
  pager(model, 'Record', page, total);
}

/** The stated terms of a Muster challenge, built from the same shared builder as the stored wager. */
export function wagerTermsFor(state: LegacyState, notice: HeraldNotice): LegacyWagerTerms | null {
  if (!state.banner || !isChallengeNotice(notice)) return null;
  const opponent = challengeOpponentNation(notice);
  if (!opponent) return null;
  return LEGACY_TEXT.wagerTerms(NATIONS[opponent].name, getAlliedHouse(state.banner.nationId).name);
}

function writeWager(model: LegacyPanelModel, prefix: 'NoticeView' | 'Accept', terms: LegacyWagerTerms | null): void {
  model.displays[`Legacy_${prefix}_Wager`] = terms !== null;
  model.texts[`Legacy_${prefix}_WagerIntro`] = terms ? terms.intro : '';
  model.texts[`Legacy_${prefix}_WagerClosing`] = terms ? terms.closing : '';
  for (let index = 0; index < LEGACY_WAGER_TERM_SLOTS; index++) {
    const term = terms ? terms.terms[index] : undefined;
    const id = legacyWagerTermId(prefix, index);
    model.texts[`${id}_When`] = term ? term.when : '';
    model.texts[`${id}_Then`] = term ? term.then : '';
  }
}

function buildNoticeView(model: LegacyPanelModel, input: LegacyModelInput, scene: LegacySceneState): void {
  const { state, flow } = input;
  const notice = flow.noticeId ? findNotice(state, flow.noticeId) : null;
  const terms = notice ? wagerTermsFor(state, notice) : null;
  if (flow.view === 'accept') {
    model.texts.Legacy_Title = LEGACY_COPY.notices.acceptTitle;
    model.texts.Legacy_Subtitle = notice ? notice.title : '';
    writeWager(model, 'Accept', terms);
    model.controls.Legacy_AcceptCancel = control();
    model.controls.Legacy_AcceptConfirm = control(true, !!notice && isChallengeNotice(notice) && (notice.status === 'unread' || notice.status === 'read'));
    return;
  }
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['heralds-station'].title;
  if (!notice) {
    model.texts.Legacy_NoticeView_Title = LEGACY_COPY.empty.notices;
    writeWager(model, 'NoticeView', null);
    model.controls.Legacy_NoticeBack = control();
    model.controls.Legacy_NoticeAccept = control(false);
    model.controls.Legacy_NoticeAwaiting = control(false);
    return;
  }
  const status = noticeStatus(notice);
  // Kind, status and sender share the subtitle so the body and the stated terms keep the room.
  model.texts.Legacy_Subtitle = [LEGACY_COPY.notices.kinds[notice.kind], status, noticeFrom(notice, scene)].filter((part) => part.length > 0).join(' / ');
  model.texts.Legacy_NoticeView_Title = notice.title;
  model.texts.Legacy_NoticeView_Body = notice.body;
  writeWager(model, 'NoticeView', terms);
  const challenge = isChallengeNotice(notice);
  model.controls.Legacy_NoticeBack = control();
  model.controls.Legacy_NoticeAccept = control(challenge && (notice.status === 'unread' || notice.status === 'read'));
  model.controls.Legacy_NoticeAwaiting = control(challenge && notice.status === 'accepted');
}

/** The tray's session line: a label only when it is true of the banner shown right now. */
function dockLabel(input: LegacyModelInput): string {
  const band = bandText(input.session);
  if (band.length > 0) return band;
  const { session, state, flow } = input;
  if (!session.persistent || !state.banner || isFoundingView(flow.view)) return '';
  if (session.saveFailed) return LEGACY_COPY.saveFailed;
  return session.saved ? QUEST_LEGACY_COPY.savedHere : '';
}

/** The tray within reach: navigation, plus the current view's Back and primary action mirrored for touch. */
export function buildLegacyDockModel(input: LegacyModelInput, panel: LegacyPanelModel = buildLegacyPanelModel(input)): LegacyDockModel {
  const paused = input.pause.paused;
  const env = input.environment;
  let status: string = env.kind === null ? QUEST_LEGACY_COPY.environment.loading
    : env.kind === 'standin' ? QUEST_LEGACY_COPY.environment.standin : QUEST_LEGACY_COPY.environment.connected;
  if (!paused && input.hover && !isFoundingView(input.flow.view)) status = QUEST_LEGACY_COPY.pointing(LEGACY_COPY.landmarks[input.hover].title);
  const candidates = LEGACY_VIEW_MIRRORS[panel.view];
  const pick = (ids: readonly LegacyPanelActionId[] | undefined): LegacyPanelActionId | null => {
    if (!ids) return null;
    for (const id of ids) if (panel.controls[id]?.visible) return id;
    return null;
  };
  const back = pick(candidates?.back);
  const primary = pick(candidates?.primary);
  const mirrored = (id: LegacyPanelActionId | null): LegacyControlState => (id ? control(true, panel.controls[id].enabled) : control(false));
  return {
    texts: {
      Legacy_DockLabel: dockLabel(input),
      Legacy_DockStatus: status,
      Legacy_DockBack_Label: back ? panel.texts[`${back}_Label`] ?? LEGACY_ACTION_LABELS[back] : '',
      Legacy_DockPrimary_Label: primary ? panel.texts[`${primary}_Label`] ?? LEGACY_ACTION_LABELS[primary] : '',
    },
    controls: {
      Legacy_DockBack: mirrored(back),
      Legacy_DockPrimary: mirrored(primary),
      Legacy_DockHome: control(!paused),
      Legacy_DockPlay: control(),
      Legacy_DockRecenter: control(input.entered),
      Legacy_DockPause: control(input.entered && !paused),
      Legacy_DockExit: control(input.entered),
    },
    mirror: { back, primary },
  };
}

