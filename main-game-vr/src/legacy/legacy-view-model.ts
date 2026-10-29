// Pure view model for the Quest My Legacy panels: every string, visibility and
// selection the runtime writes into UIKit, derived from the shared Legacy state,
// shared copy and the panel flow. Keeping it free of IWSDK makes the panel
// content testable and keeps the four landmark inspectors in step with desktop,
// which renders the same shared data.

import { LEGACY_COPY, PIECE_NAMES, sentenceCase } from '../../../shared/legacy/content/copy';
import type { RepresentativeCondition } from '../../../shared/legacy/content/copy';
import {
  CHARGE_LABELS, DIVISION_LABELS, HERALDRY_PRESETS, ORDINARY_LABELS, describeHeraldry, heraldryEquals, tinctureAdvisory, tinctureInfo,
} from '../../../shared/legacy/content/heraldry';
import { MUSTER_FILE_CLAIMS, eligibleMusterFiles, FILES } from '../../../shared/legacy/content/muster';
import { LEGACY_NATION_AVAILABILITY, NATIONS, NATION_ORDER } from '../../../shared/legacy/content/nations';
import { prominentAftermath } from '../../../shared/legacy/domain/aftermath';
import { chronicleNewestFirst } from '../../../shared/legacy/domain/chronicle';
import { generateFoundingMembers, validateBannerName } from '../../../shared/legacy/domain/founding';
import { musterReadiness } from '../../../shared/legacy/domain/formation';
import { houseDisplayName } from '../../../shared/legacy/domain/identity';
import { nominationRefusal } from '../../../shared/legacy/domain/nomination';
import { findNotice, isChallengeNotice } from '../../../shared/legacy/domain/notices';
import { presentBannerhold, representativeCondition } from '../../../shared/legacy/domain/presentation';
import { findMember } from '../../../shared/legacy/domain/state';
import { LEGACY_LANDMARKS } from '../../../shared/legacy/environment-contract';
import type { LegacySceneState } from '../../../shared/legacy/environment-contract';
import type { LegacySession } from '../../../shared/legacy/domain/persistence';
import type { HeraldNotice, Heraldry, LandmarkId, LegacyState, Tincture } from '../../../shared/legacy/types';
import {
  LEGACY_FOUNDING_STEP, LEGACY_FOUNDING_STEP_COUNT, isFoundingView, landmarkOfView, suggestionSlots, visibleHeraldryParts,
} from './legacy-flow.js';
import type { LegacyFlowState } from './legacy-flow.js';
import {
  LEGACY_AFTERMATH_SLOTS, LEGACY_HERALDRY_PARTS, LEGACY_HONOUR_SLOTS, LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE, LEGACY_RECORD_PAGE,
  legacyFileId, legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId,
} from './legacy-ui-contract.js';
import type { LegacyHeraldryPart, LegacyViewId } from './legacy-ui-contract.js';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy.js';

export type LegacyEnvironmentKind = 'environment' | 'standin';

export interface LegacySessionInfo {
  kind: LegacySession['kind'];
  persistent: boolean;
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

export interface LegacyPanelModel {
  view: LegacyViewId;
  texts: Record<string, string>;
  controls: Record<string, LegacyControlState>;
  /** Visibility of non-interactive containers (cards, ledger entries, the session band). */
  displays: Record<string, boolean>;
  /** positionLeft overrides, in panel units, for controls laid out by data (open files). */
  positions: Record<string, number>;
  /** The heraldry the panel's preview image should show, if any. */
  heraldry: Heraldry | null;
}

export interface LegacyDockModel {
  texts: Record<string, string>;
  controls: Record<string, LegacyControlState>;
}

const VIEW_ELEMENT: Readonly<Record<LegacyFlowState['view'], LegacyViewId>> = {
  loading: 'LegacyView_Loading',
  recovery: 'LegacyView_Recovery',
  nation: 'LegacyView_Nation',
  name: 'LegacyView_Name',
  keyboard: 'LegacyView_Keyboard',
  arms: 'LegacyView_Arms',
  confirm: 'LegacyView_Confirm',
  overview: 'LegacyView_Overview',
  'banner-hall': 'LegacyView_Hall',
  'muster-grounds': 'LegacyView_Muster',
  'war-record': 'LegacyView_Record',
  'heralds-station': 'LegacyView_Herald',
  notice: 'LegacyView_Notice',
  accept: 'LegacyView_Accept',
  awaiting: 'LegacyView_Awaiting',
  reset: 'LegacyView_Reset',
};

export const control = (visible = true, enabled = true, selected = false): LegacyControlState => ({ visible, enabled, selected });

/** Short labels that fit a hand-sized cycler: explanations in parentheses are dropped when long. */
/** Shortens text at a word boundary with "..." when it would overflow a fixed spatial box; the full text lives elsewhere. */
export function clampText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, '')}...`;
}

/** Aftermath cards hold one title line and three body lines; the War Record keeps every message whole. */
export const AFTERMATH_TITLE_LIMIT = 44;
export const AFTERMATH_BODY_LIMIT = 125;

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

function noticeFrom(notice: HeraldNotice): string {
  return LEGACY_COPY.notices.from(sentenceCase(houseDisplayName(notice.fromHouseId)));
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
  if (!isFoundingView(flow.view)) return '';
  const step = LEGACY_FOUNDING_STEP[flow.view];
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

/** Builds the primary panel for the current flow view, or the pause view while paused. */
export function buildLegacyPanelModel(input: LegacyModelInput): LegacyPanelModel {
  const { flow, session } = input;
  const view: LegacyViewId = input.pause.paused ? 'LegacyView_Pause' : VIEW_ELEMENT[flow.view];
  const model: LegacyPanelModel = { view, texts: {}, controls: {}, displays: {}, positions: {}, heraldry: null };
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
    case 'nation':
      model.texts.Legacy_Title = LEGACY_COPY.founding.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      for (const nationId of NATION_ORDER) {
        const availability = LEGACY_NATION_AVAILABILITY[nationId];
        model.controls[legacyNationId(nationId)] = control(availability !== 'unavailable', true, nationId === draft.nationId);
        model.texts[`${legacyNationId(nationId)}_Status`] = availability === 'available' ? '' : LEGACY_COPY.founding.availability[availability];
      }
      model.texts.Legacy_Nation_Summary = NATIONS[draft.nationId].summary;
      // The dock's Return to Home sits directly below; a second identical control on the panel only competes with it.
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
    case 'keyboard':
      model.texts.Legacy_Title = QUEST_LEGACY_COPY.keyboard.title;
      model.texts.Legacy_Subtitle = stepSubtitle(flow);
      // No caret glyph: the spatial font atlas has neither '_' nor '|', and typing always appends at the end.
      model.texts.Legacy_Keyboard_Value = flow.keyboard.buffer.length > 0 ? flow.keyboard.buffer : QUEST_LEGACY_COPY.keyboard.placeholder;
      model.texts.Legacy_Keyboard_Hint = nameHint(flow.keyboard.buffer);
      model.controls.Legacy_Key_Shift = control(true, true, flow.keyboard.shift);
      model.controls.Legacy_KeyboardCancel = control();
      model.controls.Legacy_KeyboardDone = control();
      break;
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
      model.texts.Legacy_Confirm_Nation = NATIONS[draft.nationId].polity;
      model.texts.Legacy_Confirm_Blazon = describeHeraldry(draft.heraldry);
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
      const file = rep.file ? ` / ${LEGACY_COPY.inspector.fileName(rep.file)}` : '';
      return `${rep.name} / ${conditionText(representativeCondition(rep)).label}${file}`;
    }
    case 'war-record':
      return state.chronicle.length === 0
        ? LEGACY_COPY.empty.matches
        : `${QUEST_LEGACY_COPY.counts.entries(state.chronicle.length)} / ${QUEST_LEGACY_COPY.counts.conflicts(state.matches.length)}`;
    case 'heralds-station':
      if (state.notices.length === 0) return LEGACY_COPY.empty.notices;
      return scene.unreadNotices > 0
        ? `${QUEST_LEGACY_COPY.counts.unread(scene.unreadNotices)} / ${QUEST_LEGACY_COPY.counts.notices(state.notices.length)}`
        : QUEST_LEGACY_COPY.counts.notices(state.notices.length);
  }
}

function readinessText(state: LegacyState): string {
  return musterReadiness(state).reason ?? LEGACY_COPY.notices.accepted;
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
  switch (flow.view) {
    case 'overview': {
      model.texts.Legacy_Title = banner.name;
      model.texts.Legacy_Subtitle = `${nation.polity} / ${LEGACY_COPY.rank[scene.rank]} / ${LEGACY_COPY.recognitionLabel(state.standing.recognition)}`;
      const aftermath = prominentAftermath(state).slice(0, LEGACY_AFTERMATH_SLOTS);
      for (let index = 0; index < LEGACY_AFTERMATH_SLOTS; index++) {
        const entry = aftermath[index];
        const id = `Legacy_Aftermath_${index}`;
        model.displays[id] = !!entry;
        if (!entry) continue;
        model.texts[`${id}_Heading`] = LEGACY_COPY.aftermath.headings[entry.kind];
        model.texts[`${id}_Title`] = clampText(entry.title, AFTERMATH_TITLE_LIMIT);
        model.texts[`${id}_Body`] = clampText(entry.body, AFTERMATH_BODY_LIMIT);
      }
      model.displays.Legacy_Overview_Tagline = aftermath.length === 0;
      model.displays.Legacy_Overview_Intro = aftermath.length === 0;
      model.texts.Legacy_Overview_Tagline = session.kind === 'preview' && session.title ? QUEST_LEGACY_COPY.previewOf(session.title) : LEGACY_COPY.tagline;
      for (const id of LEGACY_LANDMARKS) {
        model.controls[legacyLandmarkButtonId(id)] = control(true, true, input.hover === id);
        model.texts[`${legacyLandmarkButtonId(id)}_Status`] = landmarkStatus(state, scene, id);
      }
      model.controls.Legacy_ResetOpen = control();
      model.controls.Legacy_AftermathDismiss = control(aftermath.length > 0);
      if (model.texts.Legacy_Message === '') {
        model.texts.Legacy_Message = aftermath.length > 0 ? LEGACY_COPY.aftermath.allRecorded : session.persistent ? LEGACY_COPY.noSync : '';
      }
      break;
    }
    case 'banner-hall': {
      model.texts.Legacy_Title = LEGACY_COPY.landmarks['banner-hall'].title;
      model.texts.Legacy_Hall_Name = banner.name;
      model.texts.Legacy_Hall_Polity = nation.polity;
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
      model.texts.Legacy_Hall_Allied = allied ? QUEST_LEGACY_COPY.houses.allied(allied.name, LEGACY_COPY.stance[allied.stance]) : '';
      model.texts.Legacy_Hall_Rival = rival
        ? QUEST_LEGACY_COPY.houses.rival(rival.name, NATIONS[rival.nationId].name, LEGACY_COPY.stance[rival.stance], rival.holdsCaptive)
        : '';
      model.controls.Legacy_HallBack = control();
      model.heraldry = banner.heraldry;
      break;
    }
    case 'muster-grounds':
      buildMusterView(model, input);
      break;
    case 'war-record': {
      model.texts.Legacy_Title = LEGACY_COPY.landmarks['war-record'].title;
      model.texts.Legacy_Subtitle = `${QUEST_LEGACY_COPY.counts.entries(state.chronicle.length)} / ${QUEST_LEGACY_COPY.counts.conflicts(state.matches.length)} / ${QUEST_LEGACY_COPY.counts.unresolved(state.unresolved.length)}`;
      const entries = chronicleNewestFirst(state);
      const total = pages(entries.length, LEGACY_RECORD_PAGE);
      const page = Math.min(flow.recordPage, total - 1);
      for (let index = 0; index < LEGACY_RECORD_PAGE; index++) {
        const entry = entries[page * LEGACY_RECORD_PAGE + index];
        const id = `Legacy_Record_Entry_${index}`;
        model.displays[id] = !!entry;
        if (!entry) continue;
        const day = formatDay(entry.at);
        model.texts[`${id}_Kind`] = day ? `${LEGACY_COPY.aftermath.headings[entry.kind]} / ${day}` : LEGACY_COPY.aftermath.headings[entry.kind];
        model.texts[`${id}_Title`] = entry.title;
        model.texts[`${id}_Body`] = entry.body;
      }
      model.displays.Legacy_Record_Empty = entries.length === 0;
      model.controls.Legacy_RecordBack = control();
      pager(model, 'Record', page, total);
      break;
    }
    case 'heralds-station': {
      model.texts.Legacy_Title = LEGACY_COPY.landmarks['heralds-station'].title;
      const notices = noticesNewestFirst(state);
      model.texts.Legacy_Subtitle = notices.length === 0
        ? LEGACY_COPY.landmarks['heralds-station'].description
        : `${QUEST_LEGACY_COPY.counts.notices(notices.length)} / ${QUEST_LEGACY_COPY.counts.unread(scene.unreadNotices)}`;
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
        model.texts[`${id}_From`] = noticeFrom(notice);
      }
      model.displays.Legacy_Herald_Empty = notices.length === 0;
      model.controls.Legacy_HeraldBack = control();
      pager(model, 'Herald', page, total);
      break;
    }
    case 'notice':
    case 'accept':
      buildNoticeView(model, input);
      break;
    case 'awaiting':
      model.texts.Legacy_Title = LEGACY_COPY.awaitingBoard.title;
      model.texts.Legacy_Awaiting_Readiness = readinessText(state);
      model.controls.Legacy_AwaitingBack = control();
      break;
    case 'reset':
      model.texts.Legacy_Title = LEGACY_COPY.reset.title;
      model.texts.Legacy_Subtitle = banner.name;
      model.controls.Legacy_ResetCancel = control();
      model.controls.Legacy_ResetConfirm = control();
      break;
    default:
      break;
  }
}

/** Claimed files grouped by the house holding them, e.g. "d, e: House Ombreval's household guard". */
export function claimedFilesText(state: LegacyState): string {
  if (!state.banner) return '';
  const groups: { label: string; files: string[] }[] = [];
  for (const claim of MUSTER_FILE_CLAIMS[state.banner.nationId]) {
    let group = groups.find((item) => item.label === claim.label);
    if (!group) { group = { label: claim.label, files: [] }; groups.push(group); }
    group.files.push(claim.file);
  }
  return `${QUEST_LEGACY_COPY.claimed}: ${groups.map((group) => `${group.files.join(', ')} (${group.label})`).join('; ')}`;
}

/** Panel x of the open-file buttons: open files fill the row from the left in board order. */
export const LEGACY_FILE_ROW = { left: 360, step: 69 } as const;

function buildMusterView(model: LegacyPanelModel, input: LegacyModelInput): void {
  const { state, flow } = input;
  const banner = state.banner;
  if (!banner) return;
  const scene = presentBannerhold(state);
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['muster-grounds'].title;
  model.texts.Legacy_Subtitle = readinessText(state);
  const rep = scene.representative;
  if (rep) {
    const condition = representativeCondition(rep);
    const notes = [conditionText(condition).description];
    if (rep.status === 'captive' && rep.captorName) notes.push(LEGACY_COPY.inspector.emptyPlace(sentenceCase(rep.captorName)));
    if (rep.promotedTo) notes.push(LEGACY_COPY.inspector.promotedTo(PIECE_NAMES[rep.promotedTo]));
    model.texts.Legacy_Muster_RepName = rep.name;
    model.texts.Legacy_Muster_RepEpithet = rep.epithet;
    model.texts.Legacy_Muster_RepCondition = `${LEGACY_COPY.inspector.condition}: ${conditionText(condition).label}`;
    model.texts.Legacy_Muster_RepNote = notes.join(' ');
    model.texts.Legacy_Muster_RepFile = rep.file ? `${LEGACY_COPY.inspector.file}: ${LEGACY_COPY.inspector.fileName(rep.file)}` : '';
  } else {
    model.texts.Legacy_Muster_RepName = '';
    model.texts.Legacy_Muster_RepEpithet = '';
    model.texts.Legacy_Muster_RepCondition = '';
    model.texts.Legacy_Muster_RepNote = LEGACY_COPY.empty.representative;
    model.texts.Legacy_Muster_RepFile = '';
  }
  for (let index = 0; index < LEGACY_MEMBER_SLOTS; index++) {
    const member = state.members[index];
    const id = `Legacy_Member_${index}`;
    model.controls[id] = control(!!member, !!member && member.status === 'available', !!member && flow.member === member.id);
    if (!member) continue;
    const nominated = state.nomination.memberId === member.id ? ` / ${LEGACY_COPY.inspector.nominated}` : '';
    model.texts[`${id}_Name`] = member.name;
    model.texts[`${id}_Status`] = `${LEGACY_COPY.status[member.status].label}${nominated}`;
  }
  const open = eligibleMusterFiles(banner.nationId);
  for (const file of FILES) {
    const slot = open.indexOf(file);
    model.controls[legacyFileId(file)] = control(slot !== -1, true, flow.file === file);
    if (slot !== -1) model.positions[legacyFileId(file)] = LEGACY_FILE_ROW.left + slot * LEGACY_FILE_ROW.step;
  }
  model.texts.Legacy_Muster_Claims = claimedFilesText(state);
  const member = flow.member ? findMember(state, flow.member) : null;
  const unchanged = flow.member === state.nomination.memberId && flow.file === state.nomination.file;
  const ready = !!member && !!flow.file && nominationRefusal(state, member.id, flow.file) === null && !unchanged;
  model.controls.Legacy_MusterBack = control();
  model.controls.Legacy_MusterNominate = control(true, ready);
}

function buildNoticeView(model: LegacyPanelModel, input: LegacyModelInput): void {
  const { state, flow } = input;
  const notice = flow.noticeId ? findNotice(state, flow.noticeId) : null;
  const wager = notice?.wager ?? '';
  if (flow.view === 'accept') {
    model.texts.Legacy_Title = LEGACY_COPY.notices.acceptTitle;
    model.texts.Legacy_Accept_Wager = wager;
    model.controls.Legacy_AcceptCancel = control();
    model.controls.Legacy_AcceptConfirm = control(!!notice && isChallengeNotice(notice) && (notice.status === 'unread' || notice.status === 'read'));
    return;
  }
  model.texts.Legacy_Title = LEGACY_COPY.landmarks['heralds-station'].title;
  if (!notice) {
    model.texts.Legacy_NoticeView_Title = LEGACY_COPY.empty.notices;
    model.controls.Legacy_NoticeBack = control();
    model.controls.Legacy_NoticeAccept = control(false);
    model.controls.Legacy_NoticeAwaiting = control(false);
    return;
  }
  const status = noticeStatus(notice);
  model.texts.Legacy_NoticeView_Kind = status ? `${LEGACY_COPY.notices.kinds[notice.kind]} / ${status}` : LEGACY_COPY.notices.kinds[notice.kind];
  model.texts.Legacy_NoticeView_Title = notice.title;
  model.texts.Legacy_NoticeView_From = noticeFrom(notice);
  model.texts.Legacy_NoticeView_Body = notice.body;
  model.texts.Legacy_NoticeView_Wager = wager;
  model.displays.Legacy_NoticeView_WagerHeading = wager.length > 0;
  model.displays.Legacy_NoticeView_Wager = wager.length > 0;
  const challenge = isChallengeNotice(notice);
  model.controls.Legacy_NoticeBack = control();
  model.controls.Legacy_NoticeAccept = control(challenge && (notice.status === 'unread' || notice.status === 'read'));
  model.controls.Legacy_NoticeAwaiting = control(challenge && notice.status === 'accepted');
}

/** The dock under the panel: navigation always in reach, plus the session label and staging status. */
export function buildLegacyDockModel(input: LegacyModelInput): LegacyDockModel {
  const paused = input.pause.paused;
  const band = bandText(input.session);
  const env = input.environment;
  let status: string = env.kind === null ? QUEST_LEGACY_COPY.environment.loading
    : env.kind === 'standin' ? QUEST_LEGACY_COPY.environment.standin : QUEST_LEGACY_COPY.environment.connected;
  if (!paused && input.hover && !isFoundingView(input.flow.view)) status = QUEST_LEGACY_COPY.pointing(LEGACY_COPY.landmarks[input.hover].title);
  return {
    texts: {
      Legacy_DockLabel: band.length > 0 ? band : input.session.persistent ? QUEST_LEGACY_COPY.savedHere : '',
      Legacy_DockStatus: status,
    },
    controls: {
      Legacy_DockHome: control(!paused),
      Legacy_DockRecenter: control(input.entered),
      Legacy_DockPause: control(input.entered && !paused),
      Legacy_DockExit: control(input.entered),
    },
  };
}
