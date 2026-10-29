import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_COPY, LEGACY_TEXT } from '../../../shared/legacy/content/copy';
import { BANNER_NAME_SUGGESTIONS } from '../../../shared/legacy/content/names';
import { HERALDRY_PRESETS, defaultHeraldry } from '../../../shared/legacy/content/heraldry';
import { eligibleMusterFiles } from '../../../shared/legacy/content/muster';
import { NATIONS, NATION_ORDER } from '../../../shared/legacy/content/nations';
import { getAlliedHouse, getRivalHouse } from '../../../shared/legacy/content/houses';
import { prominentAftermath } from '../../../shared/legacy/domain/aftermath';
import { buildLegacyPreview, listLegacyPreviews } from '../../../shared/legacy/domain/fixtures';
import { MOTTO_MAX } from '../../../shared/legacy/domain/founding';
import { reduceLegacy, reduceLegacyAll } from '../../../shared/legacy/domain/reducer';
import { createLegacyState } from '../../../shared/legacy/domain/state';
import type { LegacyState, NationId } from '../../../shared/legacy/types';
import {
  createLegacyFlow, cycleHeraldryPart, reduceLegacyFlow, suggestionSlots, typeMottoKey, typeNameKey, visibleHeraldryParts,
} from './legacy-flow';
import type { LegacyFlowEvent, LegacyFlowState } from './legacy-flow';
import { LEGACY_ACTION_LABELS, LEGACY_VIEW_MIRRORS } from './legacy-actions';
import {
  buildLegacyDockModel, buildLegacyPanelModel, claimedFilesText, defaultRecordTab, formationCells, recordItems, wagerTermsFor,
} from './legacy-view-model';
import type { LegacyModelInput, LegacyPanelModel, LegacySessionInfo } from './legacy-view-model';
import { LEGACY_PANEL_ACTION_IDS, LEGACY_SUGGESTION_SLOTS, LEGACY_UI_COLORS, LEGACY_VIEW_IDS } from './legacy-ui-contract';
import { isSpatialText, spatialText } from './spatial-text';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy';
import { legacyButtonStyle, legacyButtonStyleKey } from './legacy-button-style';

const flowOf = (flow: LegacyFlowState, ...events: LegacyFlowEvent[]): LegacyFlowState => events.reduce(reduceLegacyFlow, flow);
const founding = (nationId: NationId = 'korvenia'): LegacyFlowState => reduceLegacyFlow(createLegacyFlow(nationId), { type: 'begin-founding', nationId, seed: 77 });
const SESSION_BASE = { saved: false, saveFailed: false, label: null, error: null, reason: null, title: null } as const;
const STORED: LegacySessionInfo = { ...SESSION_BASE, kind: 'stored', persistent: true, saved: true };
const NEW: LegacySessionInfo = { ...SESSION_BASE, kind: 'new', persistent: true };
const GUEST: LegacySessionInfo = { ...SESSION_BASE, kind: 'guest', persistent: false, label: LEGACY_COPY.guest.label };
const previewSession = (title: string): LegacySessionInfo => ({ ...SESSION_BASE, kind: 'preview', persistent: false, label: LEGACY_COPY.preview.label, title });
const PREVIEW_IDS = listLegacyPreviews().map((listing) => listing.id);

function foundedState(nationId: NationId = 'korvenia'): LegacyState {
  const result = reduceLegacy(createLegacyState(), {
    type: 'found-banner', name: 'House Vauclerc', nationId, heraldry: defaultHeraldry(nationId), motto: 'We keep the watch', at: '2026-10-29T10:00:00.000Z', seed: 77,
  });
  assert.equal(result.error, null);
  return result.state;
}

function preview(id: string): LegacyState {
  const state = buildLegacyPreview(id);
  assert.ok(state, `preview ${id} exists`);
  return state;
}

/** Every character of a panel string comes from the spatial font atlas, with no substitution mark added. */
function assertRenders(label: string, text: string): void {
  const shown = spatialText(text);
  assert.ok(isSpatialText(shown), label);
  const marks = (value: string): number => value.split('?').length - 1;
  assert.equal(marks(shown), marks(text), `${label} lost a glyph: ${text}`);
}

/** No panel string repeats a sentence, and none is cut short with an ellipsis. */
function assertWhole(label: string, model: LegacyPanelModel): void {
  for (const [id, text] of Object.entries(model.texts)) {
    assert.equal(/\.\.\.$|…$/u.test(text) && id !== 'Legacy_DockStatus', false, `${label} ${id} is shortened: ${text}`);
    const sentences = text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim().toLowerCase()).filter((sentence) => sentence.length > 12);
    assert.equal(new Set(sentences).size, sentences.length, `${label} ${id} repeats a sentence: ${text}`);
  }
}

function input(state: LegacyState, flow: LegacyFlowState, extra: Partial<LegacyModelInput> = {}): LegacyModelInput {
  return {
    state, flow, session: STORED, pause: { paused: false, reason: '', canResume: true }, entered: true,
    environment: { kind: 'standin', ready: true, fallback: false }, hover: null, message: '', ...extra,
  };
}

const overviewFlow = (): LegacyFlowState => reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
const open = (state: LegacyState, landmark: 'banner-hall' | 'muster-grounds' | 'war-record' | 'heralds-station'): LegacyFlowState =>
  reduceLegacyFlow(overviewFlow(), {
    type: 'open-landmark', landmark, member: state.nomination.memberId, file: state.nomination.file, recordTab: defaultRecordTab(state),
  });

/** Every view a state can show, for whole-panel checks. */
function viewsOf(state: LegacyState): LegacyFlowState[] {
  const views: LegacyFlowState[] = [overviewFlow(), reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'aftermath' })];
  for (const landmark of ['banner-hall', 'muster-grounds', 'war-record', 'heralds-station'] as const) views.push(open(state, landmark));
  for (const tab of ['conflicts', 'unresolved', 'ledger'] as const) views.push(reduceLegacyFlow(open(state, 'war-record'), { type: 'record-tab', tab }));
  views.push(reduceLegacyFlow(open(state, 'muster-grounds'), { type: 'open-nominate' }));
  for (const notice of state.notices) {
    const noticeFlow = reduceLegacyFlow(open(state, 'heralds-station'), { type: 'open-notice', noticeId: notice.id });
    views.push(noticeFlow, reduceLegacyFlow(noticeFlow, { type: 'request-accept' }));
  }
  views.push(reduceLegacyFlow(open(state, 'banner-hall'), { type: 'request-reset' }));
  return views;
}

test('founding moves forward only from a ready step, and the keyboard belongs to the step it edits', () => {
  let flow = founding();
  assert.equal(flow.view, 'nation');
  flow = flowOf(flow, { type: 'choose-nation', nationId: 'solforiz' });
  assert.equal(flow.draft.nationId, 'solforiz');
  assert.deepEqual(flow.draft.heraldry, defaultHeraldry('solforiz'), 'a new nation starts from its default arms');
  assert.equal(reduceLegacyFlow(flow, { type: 'founding-step', view: 'arms' }), flow, 'steps cannot be skipped');
  flow = flowOf(flow, { type: 'founding-step', view: 'name' });
  assert.equal(flow.view, 'name');
  assert.equal(reduceLegacyFlow(flow, { type: 'founding-step', view: 'arms' }), flow, 'an empty name cannot advance');
  const slots = suggestionSlots(flow.draft);
  assert.equal(slots.length, LEGACY_SUGGESTION_SLOTS);
  assert.equal(new Set(slots).size, slots.length);
  for (const name of slots) assert.ok(BANNER_NAME_SUGGESTIONS.solforiz.includes(name));
  assert.notDeepEqual(suggestionSlots(flowOf(flow, { type: 'more-names' }).draft), slots, 'Other names shows other suggestions');
  flow = flowOf(flow, { type: 'suggest', name: slots[1] }, { type: 'founding-step', view: 'arms' }, { type: 'founding-step', view: 'confirm' });
  assert.equal(flow.view, 'confirm');
  const motto = flowOf(flow, { type: 'open-motto' });
  assert.equal(motto.view, 'keyboard');
  assert.equal(motto.keyboard.target, 'motto');
  assert.equal(buildLegacyPanelModel(input(createLegacyState(), motto)).texts.Legacy_Subtitle.startsWith(LEGACY_COPY.founding.stepCounter(4, 4)), true,
    'the motto keyboard belongs to step 4');
  assert.equal(flowOf(flow, { type: 'founding-step', view: 'nation' }).view, 'nation', 'any earlier step can be revisited');
  const raised = flowOf(flow, { type: 'founded' });
  assert.equal(raised.view, 'raised', 'raising the banner shows the raising beat');
  assert.equal(flowOf(raised, { type: 'raised-done' }).view, 'overview');
});

test('the large-key keyboard writes names in name case and mottos in sentence case, within each rule', () => {
  let flow = flowOf(founding(), { type: 'founding-step', view: 'name' }, { type: 'open-keyboard' });
  assert.equal(flow.view, 'keyboard');
  for (const key of ['H', 'O', 'U', 'S', 'E']) flow = reduceLegacyFlow(flow, { type: 'key', key });
  flow = flowOf(flow, { type: 'key-action', action: 'space' }, { type: 'key', key: 'O' }, { type: 'key', key: "'" }, { type: 'key-action', action: 'shift' }, { type: 'key', key: 'H' });
  assert.equal(flow.keyboard.buffer, "House O'H");
  assert.equal(flow.keyboard.shift, false, 'Shift applies to one letter');
  assert.equal(reduceLegacyFlow(flow, { type: 'key', key: ',' }), flow, 'a banner name takes no comma');
  assert.equal(typeNameKey('', "'", false), '', 'a name cannot start with punctuation');
  assert.equal(typeNameKey('A'.repeat(28), 'B', false), 'A'.repeat(28), 'typing stops at 28 characters');
  const done = flowOf(flow, { type: 'key-action', action: 'space' }, { type: 'keyboard-done' });
  assert.equal(done.view, 'name'); assert.equal(done.draft.name, "House O'H", 'Done trims the name');
  let motto = flowOf(done, { type: 'founding-step', view: 'arms' }, { type: 'founding-step', view: 'confirm' }, { type: 'open-motto' });
  for (const key of ['W', 'E', ',', 'T', 'O', 'O', '.']) motto = reduceLegacyFlow(motto, { type: 'key', key });
  assert.equal(motto.keyboard.buffer, 'We,too.');
  assert.equal(typeMottoKey('We hold. ', 'A', false), 'We hold. A', 'a new sentence opens with a capital');
  assert.equal(typeMottoKey('x'.repeat(MOTTO_MAX), 'A', false), 'x'.repeat(MOTTO_MAX), 'typing stops at the motto limit');
  const kept = flowOf(motto, { type: 'keyboard-done' });
  assert.equal(kept.view, 'confirm'); assert.equal(kept.draft.motto, 'We,too.');
  assert.equal(flowOf(kept, { type: 'clear-motto' }).draft.motto, '');
  assert.equal(flowOf(kept, { type: 'open-motto' }, { type: 'keyboard-cancel' }).view, 'confirm', 'cancelling the motto returns to step 4');
});

test('heraldry cycling steps every element, keeps unused parts hidden and divides with contrast', () => {
  const plain = defaultHeraldry('korvenia');
  assert.equal(plain.division, 'plain');
  assert.equal(visibleHeraldryParts(plain).field1, false);
  const divided = cycleHeraldryPart(plain, 'division', 1);
  assert.notEqual(divided.division, 'plain');
  assert.notEqual(divided.field[1], divided.field[0], 'a newly divided field gets a second tincture');
  assert.deepEqual(cycleHeraldryPart(cycleHeraldryPart(plain, 'charge', 1), 'charge', -1), plain, 'previous undoes next');
  let flow = flowOf(founding(), { type: 'founding-step', view: 'name' }, { type: 'suggest', name: 'House Noirval' }, { type: 'founding-step', view: 'arms' });
  flow = reduceLegacyFlow(flow, { type: 'heraldry', heraldry: { ...plain, ordinary: 'none' } });
  assert.equal(reduceLegacyFlow(flow, { type: 'cycle-part', part: 'ordinaryTincture', step: 1 }), flow, 'a hidden element cannot change');
  const preset = HERALDRY_PRESETS.korvenia[2];
  assert.deepEqual(reduceLegacyFlow(flow, { type: 'heraldry', heraldry: preset.heraldry }).draft.heraldry, preset.heraldry);
});

test('landmarks open from the overview, the aftermath or another inspector, never behind founding or a confirmation', () => {
  let flow = reduceLegacyFlow(founding(), { type: 'open-landmark', landmark: 'war-record', member: null, file: null });
  assert.equal(flow.view, 'nation', 'founding ignores the holding');
  flow = reduceLegacyFlow(overviewFlow(), { type: 'open-landmark', landmark: 'muster-grounds', member: 'member-2', file: 'c' });
  assert.equal(flow.view, 'muster-grounds'); assert.equal(flow.member, 'member-2'); assert.equal(flow.file, 'c');
  flow = reduceLegacyFlow(flow, { type: 'open-nominate' });
  assert.equal(flow.view, 'nominate');
  assert.equal(flowOf(flow, { type: 'close-nominate' }).view, 'muster-grounds');
  flow = flowOf(flow, { type: 'open-landmark', landmark: 'heralds-station', member: null, file: null }, { type: 'open-notice', noticeId: 'notice-0002' }, { type: 'request-accept' });
  assert.equal(flow.view, 'accept');
  assert.equal(reduceLegacyFlow(flow, { type: 'open-landmark', landmark: 'banner-hall', member: null, file: null }), flow, 'a confirmation stays modal');
  flow = flowOf(flow, { type: 'accepted' });
  assert.equal(flow.view, 'awaiting');
  flow = flowOf(flow, { type: 'notice-list' }, { type: 'overview' }, { type: 'open-landmark', landmark: 'banner-hall', member: null, file: null }, { type: 'request-reset' });
  assert.equal(flow.view, 'reset', 'Dissolve banner lives in the Banner Hall');
  assert.equal(flowOf(flow, { type: 'cancel-reset' }).view, 'banner-hall');
  assert.equal(reduceLegacyFlow(overviewFlow(), { type: 'request-reset' }).view, 'overview', 'the overview has no dissolve control');
  const aftermath = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'aftermath' });
  const deferred = flowOf(aftermath, { type: 'defer-aftermath' });
  assert.equal(deferred.view, 'overview'); assert.equal(deferred.aftermathDeferred, true);
  assert.equal(flowOf(deferred, { type: 'review-aftermath' }).view, 'aftermath');
  assert.equal(flowOf(aftermath, { type: 'acknowledged' }).aftermathDeferred, false);
  assert.equal(flowOf(aftermath, { type: 'open-landmark', landmark: 'war-record', member: null, file: null }).aftermathDeferred, true,
    'opening a landmark sets the aftermath aside, as Back does');
  const record = reduceLegacyFlow(overviewFlow(), { type: 'open-landmark', landmark: 'war-record', member: null, file: null, recordTab: 'unresolved' });
  assert.equal(record.recordTab, 'unresolved');
  assert.equal(flowOf(record, { type: 'page', list: 'record', delta: 1, total: 3 }, { type: 'record-tab', tab: 'ledger' }).recordPage, 0, 'a new section starts on its first page');
});

test('panel models draw every founding step from shared copy, with the motto and the raising beat', () => {
  const state = createLegacyState();
  let flow = founding();
  let model = buildLegacyPanelModel(input(state, flow, { session: GUEST }));
  assert.equal(model.view, 'LegacyView_Nation');
  assert.equal(model.texts.Legacy_Title, LEGACY_COPY.founding.title);
  assert.ok(model.texts.Legacy_Subtitle.startsWith(LEGACY_COPY.founding.stepCounter(1, 4)));
  assert.equal(model.texts.Legacy_Band, LEGACY_COPY.guest.label);
  assert.equal(model.controls.Legacy_Nation_korvenia.selected, true);
  flow = flowOf(flow, { type: 'founding-step', view: 'name' });
  model = buildLegacyPanelModel(input(state, flow));
  assert.equal(model.controls.Legacy_NameNext.enabled, false);
  flow = flowOf(flow, { type: 'suggest', name: suggestionSlots(flow.draft)[0] });
  assert.equal(buildLegacyPanelModel(input(state, flow)).controls.Legacy_NameNext.enabled, true);
  flow = flowOf(flow, { type: 'founding-step', view: 'arms' });
  model = buildLegacyPanelModel(input(state, flow));
  assert.deepEqual(model.heraldry, flow.draft.heraldry, 'the live preview shows the draft arms');
  assert.equal(model.controls.Legacy_Part_field1.visible, false, 'a plain field hides the second tincture');
  flow = flowOf(flow, { type: 'founding-step', view: 'confirm' });
  model = buildLegacyPanelModel(input(state, flow, { session: NEW }));
  assert.equal(model.texts.Legacy_Confirm_Body, LEGACY_COPY.founding.confirmBody);
  assert.equal(model.texts.Legacy_Confirm_Motto, LEGACY_COPY.founding.mottoPlaceholder, 'an empty motto shows the hint');
  assert.equal(model.styles.Legacy_Confirm_Motto.color, LEGACY_UI_COLORS.muted, 'in the muted colour, never as a chosen motto');
  assert.equal(model.controls.Legacy_ConfirmClearMotto.visible, false);
  assert.equal(buildLegacyPanelModel(input(state, flow, { session: GUEST })).texts.Legacy_Confirm_Body, LEGACY_COPY.founding.guestConfirmBody);
  const withMotto = flowOf(flow, { type: 'open-motto' }, { type: 'key', key: 'W' }, { type: 'key', key: 'E' }, { type: 'keyboard-done' });
  assert.equal(buildLegacyPanelModel(input(state, withMotto)).texts.Legacy_Confirm_Motto, '"We"');
  const founded = foundedState();
  const raised = buildLegacyPanelModel(input(founded, { ...overviewFlow(), view: 'raised' }));
  assert.equal(raised.view, 'LegacyView_Raised');
  assert.equal(raised.texts.Legacy_Raised_Heading, LEGACY_COPY.aftermath.headings.founding);
  assert.equal(raised.texts.Legacy_Raised_Name, 'House Vauclerc');
  assert.equal(raised.texts.Legacy_Raised_Motto, '"We keep the watch"', 'the founded motto is shown');
  assert.equal(raised.texts.Legacy_Raised_Body, LEGACY_TEXT.founding('House Vauclerc', NATIONS.korvenia.polity).body);
  assert.deepEqual(raised.heraldry, founded.banner?.heraldry);
});

test('the four inspectors show recorded facts only, with honest empty states and the stated wager as terms', () => {
  const state = foundedState();
  let model = buildLegacyPanelModel(input(state, overviewFlow()));
  assert.equal(model.texts.Legacy_Title, 'House Vauclerc');
  assert.deepEqual(model.heraldry, state.banner?.heraldry, 'the overview shows the house crest');
  assert.equal(model.displays.Legacy_Overview_Pending, false, 'no aftermath without a recorded match');
  assert.equal(model.texts['Legacy_Landmark_muster-grounds_Status'], LEGACY_COPY.empty.representative);
  assert.equal(model.texts.Legacy_Message, LEGACY_COPY.noSync);
  model = buildLegacyPanelModel(input(state, open(state, 'banner-hall')));
  assert.equal(model.displays.Legacy_Hall_HonoursEmpty, true);
  assert.equal(model.texts.Legacy_Hall_Motto, '"We keep the watch"');
  assert.match(model.texts.Legacy_Hall_Allied, new RegExp(`^${LEGACY_COPY.houses.allied}: ${getAlliedHouse('korvenia').name}`));
  assert.match(model.texts.Legacy_Hall_Rival, new RegExp(`^${LEGACY_COPY.houses.rival}: ${getRivalHouse('korvenia').name}`));
  assert.deepEqual(model.houses, { allied: getAlliedHouse('korvenia').heraldry, rival: getRivalHouse('korvenia').heraldry }, 'both houses show their arms');
  assert.equal(model.controls.Legacy_ResetOpen.visible, true);
  assert.equal(LEGACY_ACTION_LABELS.Legacy_ResetOpen, LEGACY_COPY.reset.action, 'the dissolve control uses the shared label');
  model = buildLegacyPanelModel(input(state, open(state, 'war-record')));
  assert.equal(state.matches.length, 0);
  assert.equal(model.controls.Legacy_RecordTab_unresolved.selected, true, 'with no conflicts the War Record opens on its open matters');
  assert.equal(model.texts.Legacy_Record_Entry_0_Title, state.unresolved[0].title, 'the open challenge is listed, not only counted');
  assert.equal(model.texts.Legacy_RecordTab_conflicts_Label, QUEST_LEGACY_COPY.tab(LEGACY_COPY.sections.conflicts, 0));
  const conflicts = buildLegacyPanelModel(input(state, reduceLegacyFlow(open(state, 'war-record'), { type: 'record-tab', tab: 'conflicts' })));
  assert.equal(conflicts.texts.Legacy_Record_Empty, LEGACY_COPY.empty.matches);
  assert.equal(conflicts.displays.Legacy_Record_Empty, true);
  model = buildLegacyPanelModel(input(state, open(state, 'muster-grounds')));
  assert.equal(model.texts.Legacy_Muster_RepNote, LEGACY_COPY.empty.representative);
  assert.equal(model.texts.Legacy_Legend_player, `${LEGACY_COPY.inspector.yourBanner} / 0`, 'no nominee: nobody on the board belongs to the house yet');
  const nominate = reduceLegacyFlow(open(state, 'muster-grounds'), { type: 'open-nominate' });
  model = buildLegacyPanelModel(input(state, nominate));
  assert.equal(model.controls.Legacy_MusterNominate.enabled, false);
  const openFiles = eligibleMusterFiles('korvenia');
  for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
    assert.equal(model.controls[`Legacy_File_${file}`].visible, openFiles.includes(file), `${file}-file visibility`);
  }
  assert.match(claimedFilesText(state), /d, e/);
  const chosen = flowOf(nominate, { type: 'select-member', memberId: 'member-2' }, { type: 'select-file', file: openFiles[0] });
  assert.equal(buildLegacyPanelModel(input(state, chosen)).controls.Legacy_MusterNominate.enabled, true);
  const herald = open(state, 'heralds-station');
  model = buildLegacyPanelModel(input(state, herald));
  assert.equal(model.controls.Legacy_Notice_0.visible, true);
  assert.equal(model.texts.Legacy_Notice_0_Kind, LEGACY_COPY.notices.kinds['rival-challenge'], 'newest notice first');
  const challenge = state.notices[1];
  const noticeFlow = reduceLegacyFlow(herald, { type: 'open-notice', noticeId: challenge.id });
  model = buildLegacyPanelModel(input(state, noticeFlow));
  const terms = LEGACY_TEXT.wagerTerms(NATIONS.solforiz.name, getAlliedHouse('korvenia').name);
  assert.deepEqual(wagerTermsFor(state, challenge), terms);
  assert.equal(model.displays.Legacy_NoticeView_Wager, true);
  assert.equal(model.texts.Legacy_NoticeView_WagerIntro, terms.intro);
  terms.terms.forEach((term, index) => {
    assert.equal(model.texts[`Legacy_NoticeView_Term_${index}_When`], term.when);
    assert.equal(model.texts[`Legacy_NoticeView_Term_${index}_Then`], term.then);
  });
  assert.equal(challenge.wager, LEGACY_TEXT.wager(NATIONS.solforiz.name, getAlliedHouse('korvenia').name), 'the stored wager states the same terms');
  assert.match(model.texts.Legacy_Subtitle, new RegExp(LEGACY_COPY.notices.kinds['rival-challenge']));
  assert.equal(model.controls.Legacy_NoticeAccept.visible, true);
  const accept = buildLegacyPanelModel(input(state, reduceLegacyFlow(noticeFlow, { type: 'request-accept' })));
  assert.equal(accept.texts.Legacy_Accept_Term_0_Then, terms.terms[0].then, 'the acceptance repeats the same terms');
  const accepted = reduceLegacy(state, { type: 'accept-challenge', noticeId: challenge.id, at: '2026-10-29T10:05:00.000Z' }).state;
  model = buildLegacyPanelModel(input(accepted, noticeFlow));
  assert.equal(model.controls.Legacy_NoticeAccept.visible, false);
  assert.equal(model.controls.Legacy_NoticeAwaiting.visible, true);
  model = buildLegacyPanelModel(input(accepted, flowOf(noticeFlow, { type: 'show-awaiting' })));
  assert.equal(model.texts.Legacy_Title, LEGACY_COPY.awaitingBoard.title);
  assert.equal(model.texts.Legacy_Awaiting_Readiness, LEGACY_COPY.readiness.noNominee, 'no match is played or claimed');
});

test('the wager terms are short enough to read whole in the panel for every nation', () => {
  for (const nationId of NATION_ORDER) {
    const rival = getRivalHouse(nationId);
    const terms = LEGACY_TEXT.wagerTerms(NATIONS[rival.nationId].name, getAlliedHouse(nationId).name);
    assert.equal(terms.terms.length, 4);
    for (const term of terms.terms) {
      assert.ok(term.when.length <= 50, `${nationId} condition fits two lines: ${term.when}`);
      assert.ok(term.then.length <= 90, `${nationId} term fits two lines: ${term.then}`);
    }
    assert.ok(terms.intro.length <= 70, `${nationId} intro fits one line`);
  }
});

test('a captive preview shows both aftermath messages whole, the empty place once, and absence beyond the Muster Grounds', () => {
  const state = preview('captive');
  const session = previewSession('Captive');
  const aftermath = prominentAftermath(state);
  assert.ok(aftermath.length >= 1 && aftermath.length <= 2);
  let model = buildLegacyPanelModel(input(state, reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'aftermath' }), { session }));
  assert.equal(model.view, 'LegacyView_Aftermath');
  assert.equal(model.texts.Legacy_Band, LEGACY_COPY.preview.label);
  aftermath.forEach((entry, index) => {
    assert.equal(model.texts[`Legacy_Aftermath_${index}_Title`], entry.title, 'the title is never shortened');
    assert.equal(model.texts[`Legacy_Aftermath_${index}_Body`], entry.body, 'the body is never shortened');
  });
  const captivity = aftermath.find((entry) => entry.kind === 'captivity');
  assert.ok(captivity, 'the captivity is prominent');
  assert.match(captivity.body, /until your house wins a Muster against/u, 'the condition for coming home is part of the message');
  assert.equal(model.controls.Legacy_AftermathDismiss.visible, true);
  assert.equal(model.controls.Legacy_AftermathLater.visible, true);
  const rep = state.members.find((member) => member.id === state.nomination.memberId);
  assert.ok(rep && rep.status === 'captive' && rep.captiveOf);
  model = buildLegacyPanelModel(input(state, open(state, 'muster-grounds'), { session }));
  assert.equal(model.displays.Legacy_Muster_EmptyPlace, true, 'the empty place is a visible marker');
  assert.equal(model.displays.Legacy_Muster_RepNote, false, 'and the only note');
  const note = model.texts.Legacy_Muster_EmptyPlace_Text;
  assert.equal(note.split('Their place stands empty.').length - 1, 1, `the empty place is stated once: ${note}`);
  assert.equal(note, LEGACY_COPY.inspector.emptyPlace(model.texts.Legacy_Muster_Row_4_Value), 'held by the captor named in the ledger');
  assert.equal(model.texts.Legacy_Legend_player.endsWith(' / 0'), true, 'a captive leaves no one of the house on the board');
  model = buildLegacyPanelModel(input(state, overviewFlow(), { session }));
  assert.match(model.texts['Legacy_Landmark_muster-grounds_Status'], /Their place stands empty\./u, 'the overview names the empty place');
  assert.equal(model.displays.Legacy_Overview_Pending, true, 'a set-aside aftermath can be reviewed from the overview');
  model = buildLegacyPanelModel(input(state, open(state, 'banner-hall'), { session }));
  assert.equal(model.texts.Legacy_Hall_RivalNote, LEGACY_COPY.houses.holdsCaptive, 'the hall names the rival holding a member');
  assert.equal(model.controls.Legacy_ResetOpen.visible, false, 'a development preview cannot be dissolved');
  assert.equal(model.texts.Legacy_Hall_Locked, LEGACY_COPY.preview.locked, 'and says why');
  model = buildLegacyPanelModel(input(state, open(state, 'heralds-station'), { session }));
  const rivalNotice = [0, 1, 2, 3].map((index) => model.texts[`Legacy_Notice_${index}_From`]).find((from) => from?.includes(getRivalHouse('korvenia').name));
  assert.ok(rivalNotice?.endsWith(LEGACY_COPY.houses.holdsCaptive), 'the rival\'s notices carry the captivity too');
  model = buildLegacyPanelModel(input(state, open(state, 'war-record'), { session }));
  assert.equal(model.controls.Legacy_RecordTab_conflicts.selected, true, 'recorded conflicts come first');
  const conflicts = recordItems(state, 'conflicts');
  assert.equal(conflicts.length, state.matches.length);
  assert.equal(model.texts.Legacy_Record_Entry_0_Kind, LEGACY_COPY.outcome[state.matches[state.matches.length - 1].outcome], 'newest conflict first, with its outcome');
  assert.match(model.texts.Legacy_Record_Entry_0_Body, new RegExp(LEGACY_COPY.fate.captured), 'with the representative\'s fate');
  const unresolved = buildLegacyPanelModel(input(state, reduceLegacyFlow(open(state, 'war-record'), { type: 'record-tab', tab: 'unresolved' }), { session }));
  assert.equal(unresolved.texts.Legacy_Record_Entry_0_Title, state.unresolved[0].title, 'open threads are listed whole');
});

test('every development preview reads whole: no shortened text and no repeated sentence in any view', () => {
  for (const id of PREVIEW_IDS) {
    const state = preview(id);
    const session = previewSession(id);
    for (const flow of viewsOf(state)) assertWhole(`${id} ${flow.view}`, buildLegacyPanelModel(input(state, flow, { session })));
  }
  const founded = foundedState();
  for (const flow of viewsOf(founded)) assertWhole(`founded ${flow.view}`, buildLegacyPanelModel(input(founded, flow)));
});

test('formation cells follow the shared Muster formation: only the nominee belongs to the house', () => {
  const state = reduceLegacy(foundedState(), { type: 'nominate', memberId: 'member-1', file: 'a', at: '2026-10-29T10:01:00.000Z' }).state;
  const cells = formationCells(state);
  assert.equal(cells.length, 16);
  assert.deepEqual(cells.filter((cell) => cell.group === 'player').map((cell) => cell.square), ['a2'], 'the nominee stands on the nominated file');
  assert.ok(cells.some((cell) => cell.group === 'ally'), 'the allied house has its own people on the board');
  assert.equal(cells.filter((cell) => cell.royal).map((cell) => cell.letter).sort().join(''), 'KQ');
  const model = buildLegacyPanelModel(input(state, open(state, 'muster-grounds')));
  assert.equal(model.texts.Legacy_Legend_player, `${LEGACY_COPY.inspector.yourBanner} / 1`);
  assert.equal(model.texts.Legacy_Formation_a2_Label, 'P');
  assert.equal(model.styles.Legacy_Formation_a2.borderColor, LEGACY_UI_COLORS.selectedHoverBorder, 'the house\'s piece is outlined');
  assert.equal(model.texts.Legacy_Muster_Row_0_Value, 'House Vauclerc', 'the ledger names the banner allegiance');
  assert.equal(model.texts.Legacy_Muster_Row_1_Value, LEGACY_COPY.inspector.pawnAppointment);
});

test('the tray says "saved" only when the banner shown is on this device, and mirrors the view\'s actions', () => {
  const empty = createLegacyState();
  const flow = founding();
  assert.equal(buildLegacyDockModel(input(empty, flow, { session: NEW })).texts.Legacy_DockLabel, '', 'nothing is saved during founding');
  assert.equal(buildLegacyDockModel(input(foundedState(), overviewFlow(), { session: NEW })).texts.Legacy_DockLabel, '', 'nor before the first save');
  assert.equal(buildLegacyDockModel(input(foundedState(), overviewFlow(), { session: STORED })).texts.Legacy_DockLabel, QUEST_LEGACY_COPY.savedHere);
  assert.equal(buildLegacyDockModel(input(foundedState(), overviewFlow(), { session: { ...STORED, saved: false, saveFailed: true } })).texts.Legacy_DockLabel, LEGACY_COPY.saveFailed);
  assert.equal(buildLegacyDockModel(input(empty, flow, { session: GUEST })).texts.Legacy_DockLabel, LEGACY_COPY.guest.label);
  const nation = buildLegacyDockModel(input(empty, flow));
  assert.equal(nation.mirror.primary, 'Legacy_NationNext');
  assert.equal(nation.texts.Legacy_DockPrimary_Label, LEGACY_COPY.founding.next);
  assert.equal(nation.controls.Legacy_DockBack.visible, false, 'the first step has nothing to go back to but Home');
  const name = buildLegacyDockModel(input(empty, flowOf(flow, { type: 'founding-step', view: 'name' })));
  assert.equal(name.mirror.back, 'Legacy_NameBack');
  assert.equal(name.controls.Legacy_DockPrimary.enabled, false, 'a mirrored action is disabled exactly when its control is');
  const reset = buildLegacyDockModel(input(foundedState(), reduceLegacyFlow(open(foundedState(), 'banner-hall'), { type: 'request-reset' })));
  assert.equal(reset.mirror.primary, null, 'a destructive confirmation is never mirrored');
  const paused = buildLegacyDockModel(input(foundedState(), overviewFlow(), { pause: { paused: true, reason: 'Paused', canResume: true } }));
  assert.equal(paused.mirror.primary, 'Legacy_Resume');
  assert.equal(paused.controls.Legacy_DockPause.visible, false);
  assert.equal(buildLegacyDockModel(input(empty, flow, { entered: false })).controls.Legacy_DockExit.visible, false, 'Exit VR appears only in the headset');
  for (const [view, mirror] of Object.entries(LEGACY_VIEW_MIRRORS)) {
    assert.ok((LEGACY_VIEW_IDS as readonly string[]).includes(view), view);
    for (const id of [...(mirror?.back ?? []), ...(mirror?.primary ?? [])]) assert.ok((LEGACY_PANEL_ACTION_IDS as readonly string[]).includes(id), id);
    for (const id of mirror?.primary ?? []) assert.ok(!/Reset|Dissolve/.test(id), `${view} never mirrors ${id}`);
  }
});

test('pause replaces the panel until a tracked hand can resume, and keeps the Legacy view underneath', () => {
  const state = foundedState();
  const flow = overviewFlow();
  let model = buildLegacyPanelModel(input(state, flow, { pause: { paused: true, reason: 'Bring a hand into view', canResume: false } }));
  assert.equal(model.view, 'LegacyView_Pause');
  assert.equal(model.controls.Legacy_Resume.visible, false);
  model = buildLegacyPanelModel(input(state, flow, { pause: { paused: true, reason: 'Bring a hand into view', canResume: true } }));
  assert.equal(model.controls.Legacy_Resume.visible, true);
  assert.equal(buildLegacyPanelModel(input(state, flow)).view, 'LegacyView_Overview', 'resuming restores the same view');
});

test('every panel and tray string renders from the spatial font atlas without substitution marks', () => {
  assert.equal(spatialText('Development preview · fixture data · not saved'), 'Development preview / fixture data / not saved');
  assert.equal(spatialText('Guest session — not saved'), 'Guest session - not saved');
  assert.equal(spatialText('Tenné'), 'Tenne');
  const states: LegacyState[] = [foundedState(), ...PREVIEW_IDS.map(preview)];
  states.push(reduceLegacyAll(foundedState(), [{ type: 'accept-challenge', noticeId: 'notice-0002', at: '2026-10-29T11:00:00.000Z' }]).state);
  for (const state of states) {
    for (const flow of viewsOf(state)) {
      const model = buildLegacyPanelModel(input(state, flow));
      for (const [id, text] of Object.entries(model.texts)) assertRenders(id, text);
      for (const [id, text] of Object.entries(buildLegacyDockModel(input(state, flow), model).texts)) assertRenders(id, text);
    }
  }
  const empty = createLegacyState();
  const name = flowOf(founding(), { type: 'founding-step', view: 'name' });
  const arms = flowOf(name, { type: 'suggest', name: suggestionSlots(name.draft)[0] }, { type: 'founding-step', view: 'arms' });
  for (const flow of [founding(), name, flowOf(name, { type: 'open-keyboard' }), arms, flowOf(arms, { type: 'founding-step', view: 'confirm' })]) {
    for (const [id, text] of Object.entries(buildLegacyPanelModel(input(empty, flow)).texts)) assertRenders(`${flow.view} ${id}`, text);
  }
  const leaves = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [];
  for (const text of leaves(QUEST_LEGACY_COPY)) assertRenders('Quest copy', text);
  for (const text of Object.values(LEGACY_ACTION_LABELS)) assertRenders('action label', text);
});

test('control looks come from code: hover lights a control, selection outranks hover, a disabled control never lights up', () => {
  const base = legacyButtonStyle('button', { enabled: true, selected: false, hovered: false });
  const hover = legacyButtonStyle('button', { enabled: true, selected: false, hovered: true });
  assert.notEqual(hover.borderColor, base.borderColor);
  assert.notEqual(legacyButtonStyleKey(hover), legacyButtonStyleKey(base));
  assert.equal(hover.borderWidth, base.borderWidth, 'hover keeps the border width, so labels never shift');
  for (const hovered of [false, true]) {
    assert.equal(legacyButtonStyle('button', { enabled: true, selected: true, hovered }).backgroundColor, LEGACY_UI_COLORS.selected);
  }
  const disabled = legacyButtonStyle('primary', { enabled: false, selected: false, hovered: true });
  assert.equal(disabled.opacity, 0.42);
  assert.equal(disabled.borderColor, legacyButtonStyle('primary', { enabled: true, selected: false, hovered: false }).borderColor);
});
