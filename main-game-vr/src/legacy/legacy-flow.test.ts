import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_COPY, LEGACY_TEXT } from '../../../shared/legacy/content/copy';
import { BANNER_NAME_SUGGESTIONS } from '../../../shared/legacy/content/names';
import { HERALDRY_PRESETS, defaultHeraldry } from '../../../shared/legacy/content/heraldry';
import { eligibleMusterFiles } from '../../../shared/legacy/content/muster';
import { NATIONS } from '../../../shared/legacy/content/nations';
import { getAlliedHouse, getRivalHouse } from '../../../shared/legacy/content/houses';
import { buildLegacyPreview } from '../../../shared/legacy/domain/fixtures';
import { reduceLegacy, reduceLegacyAll } from '../../../shared/legacy/domain/reducer';
import { createLegacyState } from '../../../shared/legacy/domain/state';
import type { LegacyState } from '../../../shared/legacy/types';
import {
  createLegacyFlow, cycleHeraldryPart, reduceLegacyFlow, suggestionSlots, typeNameKey, visibleHeraldryParts,
} from './legacy-flow';
import type { LegacyFlowEvent, LegacyFlowState } from './legacy-flow';
import { AFTERMATH_BODY_LIMIT, AFTERMATH_TITLE_LIMIT, buildLegacyDockModel, buildLegacyPanelModel, clampText, claimedFilesText } from './legacy-view-model';
import type { LegacyModelInput, LegacySessionInfo } from './legacy-view-model';
import { LEGACY_SUGGESTION_SLOTS } from './legacy-ui-contract';
import { isSpatialText, spatialText } from './spatial-text';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy';
import { legacyButtonStyle, legacyButtonStyleKey } from './legacy-button-style';
import { LEGACY_UI_COLORS } from './legacy-ui-contract';

const flowOf = (flow: LegacyFlowState, ...events: LegacyFlowEvent[]): LegacyFlowState => events.reduce(reduceLegacyFlow, flow);
const founding = (): LegacyFlowState => reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'begin-founding', nationId: 'korvenia', seed: 77 });
const STORED: LegacySessionInfo = { kind: 'stored', persistent: true, label: null, error: null, reason: null, title: null };
const GUEST: LegacySessionInfo = { kind: 'guest', persistent: false, label: LEGACY_COPY.guest.label, error: null, reason: null, title: null };

function foundedState(): LegacyState {
  const result = reduceLegacy(createLegacyState(), {
    type: 'found-banner', name: 'House Vauclerc', nationId: 'korvenia', heraldry: defaultHeraldry('korvenia'), at: '2026-10-29T10:00:00.000Z', seed: 77,
  });
  assert.equal(result.error, null);
  return result.state;
}

/** Every character of a panel string comes from the spatial font atlas, with no substitution mark added. */
function assertRenders(label: string, text: string): void {
  const shown = spatialText(text);
  assert.ok(isSpatialText(shown), label);
  const marks = (value: string): number => value.split('?').length - 1;
  assert.equal(marks(shown), marks(text), `${label} lost a glyph: ${text}`);
}

function input(state: LegacyState, flow: LegacyFlowState, extra: Partial<LegacyModelInput> = {}): LegacyModelInput {
  return {
    state, flow, session: STORED, pause: { paused: false, reason: '', canResume: true }, entered: true,
    environment: { kind: 'standin', ready: true, fallback: false }, hover: null, message: '', ...extra,
  };
}

test('founding moves forward only from a ready step, and the keyboard belongs to the name step', () => {
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
  const more = suggestionSlots(flowOf(flow, { type: 'more-names' }).draft);
  assert.notDeepEqual(more, slots, 'More names shows other suggestions');
  flow = flowOf(flow, { type: 'suggest', name: slots[1] }, { type: 'founding-step', view: 'arms' });
  assert.equal(flow.view, 'arms'); assert.equal(flow.draft.name, slots[1]);
  flow = flowOf(flow, { type: 'founding-step', view: 'confirm' });
  assert.equal(flow.view, 'confirm');
  flow = flowOf(flow, { type: 'founding-step', view: 'nation' });
  assert.equal(flow.view, 'nation', 'any earlier step can be revisited');
});

test('the large-key keyboard writes names in name case and respects the name rule length', () => {
  let flow = flowOf(founding(), { type: 'founding-step', view: 'name' }, { type: 'open-keyboard' });
  assert.equal(flow.view, 'keyboard');
  for (const key of ['H', 'O', 'U', 'S', 'E']) flow = reduceLegacyFlow(flow, { type: 'key', key });
  flow = flowOf(flow, { type: 'key-action', action: 'space' }, { type: 'key', key: 'O' }, { type: 'key', key: "'" }, { type: 'key-action', action: 'shift' }, { type: 'key', key: 'H' });
  assert.equal(flow.keyboard.buffer, "House O'H");
  assert.equal(flow.keyboard.shift, false, 'Shift applies to one letter');
  flow = flowOf(flow, { type: 'key-action', action: 'delete' }, { type: 'key', key: 'A' }, { type: 'key', key: 'R' }, { type: 'key', key: 'E' });
  assert.equal(flow.keyboard.buffer, "House O'are");
  assert.equal(typeNameKey('', "'", false), '', 'a name cannot start with punctuation');
  assert.equal(typeNameKey('A'.repeat(28), 'B', false), 'A'.repeat(28), 'typing stops at 28 characters');
  const cancelled = flowOf(flow, { type: 'keyboard-cancel' });
  assert.equal(cancelled.view, 'name'); assert.equal(cancelled.draft.name, '');
  const done = flowOf(flow, { type: 'key-action', action: 'space' }, { type: 'keyboard-done' });
  assert.equal(done.view, 'name'); assert.equal(done.draft.name, "House O'are", 'Done trims the name');
  assert.equal(flowOf(done, { type: 'founding-step', view: 'arms' }).view, 'arms');
  assert.equal(flowOf(flow, { type: 'key-action', action: 'clear' }).keyboard.buffer, '');
});

test('heraldry cycling steps every element, keeps unused parts hidden and divides with contrast', () => {
  const plain = defaultHeraldry('korvenia');
  assert.equal(plain.division, 'plain');
  assert.equal(visibleHeraldryParts(plain).field1, false);
  const divided = cycleHeraldryPart(plain, 'division', 1);
  assert.notEqual(divided.division, 'plain');
  assert.notEqual(divided.field[1], divided.field[0], 'a newly divided field gets a second tincture');
  assert.equal(visibleHeraldryParts(divided).field1, true);
  assert.deepEqual(cycleHeraldryPart(cycleHeraldryPart(plain, 'charge', 1), 'charge', -1), plain, 'previous undoes next');
  const noOrdinary = { ...plain, ordinary: 'none' as const };
  let flow = flowOf(founding(), { type: 'founding-step', view: 'name' }, { type: 'suggest', name: 'House Noirval' }, { type: 'founding-step', view: 'arms' });
  flow = reduceLegacyFlow(flow, { type: 'heraldry', heraldry: noOrdinary });
  assert.equal(reduceLegacyFlow(flow, { type: 'cycle-part', part: 'ordinaryTincture', step: 1 }), flow, 'a hidden element cannot change');
  const preset = HERALDRY_PRESETS.korvenia[2];
  flow = reduceLegacyFlow(flow, { type: 'heraldry', heraldry: preset.heraldry });
  assert.deepEqual(flow.draft.heraldry, preset.heraldry);
});

test('landmarks open from the overview or another inspector, never behind founding or a confirmation', () => {
  let flow = reduceLegacyFlow(founding(), { type: 'open-landmark', landmark: 'war-record', member: null, file: null });
  assert.equal(flow.view, 'nation', 'founding ignores the holding');
  flow = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
  flow = reduceLegacyFlow(flow, { type: 'open-landmark', landmark: 'muster-grounds', member: 'member-2', file: 'c' });
  assert.equal(flow.view, 'muster-grounds'); assert.equal(flow.landmark, 'muster-grounds');
  assert.equal(flow.member, 'member-2'); assert.equal(flow.file, 'c');
  flow = reduceLegacyFlow(flow, { type: 'open-landmark', landmark: 'heralds-station', member: null, file: null });
  assert.equal(flow.view, 'heralds-station');
  flow = flowOf(flow, { type: 'open-notice', noticeId: 'notice-0002' }, { type: 'request-accept' });
  assert.equal(flow.view, 'accept');
  assert.equal(reduceLegacyFlow(flow, { type: 'open-landmark', landmark: 'banner-hall', member: null, file: null }), flow, 'a confirmation stays modal');
  flow = flowOf(flow, { type: 'accepted' });
  assert.equal(flow.view, 'awaiting');
  flow = flowOf(flow, { type: 'notice-list' }, { type: 'overview' }, { type: 'request-reset' });
  assert.equal(flow.view, 'reset');
  assert.equal(flowOf(flow, { type: 'cancel-reset' }).view, 'overview');
  const paged = flowOf(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' }, { type: 'open-landmark', landmark: 'war-record', member: null, file: null });
  assert.equal(reduceLegacyFlow(paged, { type: 'page', list: 'record', delta: -1, total: 3 }), paged, 'pages stop at the first');
  assert.equal(flowOf(paged, { type: 'page', list: 'record', delta: 1, total: 3 }, { type: 'page', list: 'record', delta: 1, total: 3 }, { type: 'page', list: 'record', delta: 1, total: 3 }).recordPage, 2);
});

test('panel models draw every founding step from shared copy and gate Continue on the name rule', () => {
  const state = createLegacyState();
  let flow = founding();
  let model = buildLegacyPanelModel(input(state, flow, { session: GUEST }));
  assert.equal(model.view, 'LegacyView_Nation');
  assert.equal(model.texts.Legacy_Title, LEGACY_COPY.founding.title);
  assert.ok(model.texts.Legacy_Subtitle.startsWith(LEGACY_COPY.founding.stepCounter(1, 4)));
  assert.equal(model.texts.Legacy_Band, LEGACY_COPY.guest.label);
  assert.equal(model.displays.Legacy_BandSurface, true);
  assert.equal(model.controls.Legacy_Nation_korvenia.selected, true);
  flow = flowOf(flow, { type: 'founding-step', view: 'name' });
  model = buildLegacyPanelModel(input(state, flow));
  assert.equal(model.controls.Legacy_NameNext.enabled, false);
  assert.equal(model.texts.Legacy_Name_Rules, LEGACY_COPY.founding.nameRules);
  flow = flowOf(flow, { type: 'suggest', name: suggestionSlots(flow.draft)[0] });
  model = buildLegacyPanelModel(input(state, flow));
  assert.equal(model.controls.Legacy_NameNext.enabled, true);
  assert.equal(model.controls.Legacy_Suggestion_0.selected, true);
  flow = flowOf(flow, { type: 'founding-step', view: 'arms' });
  model = buildLegacyPanelModel(input(state, flow));
  assert.deepEqual(model.heraldry, flow.draft.heraldry, 'the live preview shows the draft arms');
  assert.equal(model.controls.Legacy_Part_field1.visible, false, 'a plain field hides the second tincture');
  assert.equal(model.texts.Legacy_Preset_0_Label, HERALDRY_PRESETS.korvenia[0].label);
  flow = flowOf(flow, { type: 'founding-step', view: 'confirm' });
  model = buildLegacyPanelModel(input(state, flow));
  assert.equal(model.texts.Legacy_Confirm_Body, LEGACY_COPY.founding.confirmBody);
  assert.equal(model.texts.Legacy_Confirm_Nation, NATIONS.korvenia.polity);
  assert.equal(buildLegacyPanelModel(input(state, flow, { session: GUEST })).texts.Legacy_Confirm_Body, LEGACY_COPY.founding.guestConfirmBody);
});

test('the four inspectors show recorded facts only, with honest empty states and the stated wager', () => {
  const state = foundedState();
  const overview = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
  let model = buildLegacyPanelModel(input(state, overview));
  assert.equal(model.texts.Legacy_Title, 'House Vauclerc');
  assert.equal(model.displays.Legacy_Aftermath_0, false, 'no aftermath without a recorded match');
  assert.equal(model.texts['Legacy_Landmark_muster-grounds_Status'], LEGACY_COPY.empty.representative);
  assert.equal(model.texts.Legacy_Message, LEGACY_COPY.noSync);
  const open = (landmark: 'banner-hall' | 'muster-grounds' | 'war-record' | 'heralds-station') =>
    reduceLegacyFlow(overview, { type: 'open-landmark', landmark, member: null, file: null });
  model = buildLegacyPanelModel(input(state, open('banner-hall')));
  assert.equal(model.displays.Legacy_Hall_HonoursEmpty, true);
  assert.match(model.texts.Legacy_Hall_Allied, new RegExp(getAlliedHouse('korvenia').name));
  assert.match(model.texts.Legacy_Hall_Rival, new RegExp(getRivalHouse('korvenia').name));
  model = buildLegacyPanelModel(input(state, open('war-record')));
  assert.equal(model.displays.Legacy_Record_Entry_0, true);
  assert.equal(model.texts.Legacy_Record_Entry_0_Title, state.chronicle[0].title);
  assert.equal(model.controls.Legacy_RecordPrev.visible, false, 'one page needs no pager');
  model = buildLegacyPanelModel(input(state, open('muster-grounds')));
  assert.equal(model.controls.Legacy_MusterNominate.enabled, false);
  const open_files = eligibleMusterFiles('korvenia');
  for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
    assert.equal(model.controls[`Legacy_File_${file}`].visible, open_files.includes(file), `${file}-file visibility`);
  }
  assert.match(claimedFilesText(state), /d, e/);
  const chosen = flowOf(open('muster-grounds'), { type: 'select-member', memberId: 'member-2' }, { type: 'select-file', file: open_files[0] });
  assert.equal(buildLegacyPanelModel(input(state, chosen)).controls.Legacy_MusterNominate.enabled, true);
  const herald = open('heralds-station');
  model = buildLegacyPanelModel(input(state, herald));
  assert.equal(model.controls.Legacy_Notice_0.visible, true);
  assert.equal(model.controls.Legacy_Notice_2.visible, false);
  assert.equal(model.texts.Legacy_Notice_0_Kind, LEGACY_COPY.notices.kinds['rival-challenge'], 'newest notice first');
  const challenge = state.notices[1];
  const noticeFlow = reduceLegacyFlow(herald, { type: 'open-notice', noticeId: challenge.id });
  model = buildLegacyPanelModel(input(state, noticeFlow));
  assert.equal(model.texts.Legacy_NoticeView_Wager, LEGACY_TEXT.wager(NATIONS.solforiz.name, getAlliedHouse('korvenia').name));
  assert.equal(model.controls.Legacy_NoticeAccept.visible, true);
  assert.equal(model.controls.Legacy_NoticeAwaiting.visible, false);
  const accepted = reduceLegacy(state, { type: 'accept-challenge', noticeId: challenge.id, at: '2026-10-29T10:05:00.000Z' }).state;
  model = buildLegacyPanelModel(input(accepted, noticeFlow));
  assert.equal(model.controls.Legacy_NoticeAccept.visible, false);
  assert.equal(model.controls.Legacy_NoticeAwaiting.visible, true);
  const awaiting = flowOf(noticeFlow, { type: 'show-awaiting' });
  model = buildLegacyPanelModel(input(accepted, awaiting));
  assert.equal(model.texts.Legacy_Title, LEGACY_COPY.awaitingBoard.title);
  assert.equal(model.texts.Legacy_Awaiting_Readiness, LEGACY_COPY.readiness.noNominee, 'no match is played or claimed');
});

test('a development preview keeps its label, at most two aftermath messages and the empty place of a captive', () => {
  const preview = buildLegacyPreview('captive');
  assert.ok(preview);
  const session: LegacySessionInfo = { kind: 'preview', persistent: false, label: LEGACY_COPY.preview.label, error: null, reason: null, title: 'Captive' };
  const overview = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
  let model = buildLegacyPanelModel(input(preview, overview, { session }));
  assert.equal(model.texts.Legacy_Band, LEGACY_COPY.preview.label);
  assert.ok(Object.keys(model.displays).filter((id) => /^Legacy_Aftermath_\d$/.test(id) && model.displays[id]).length <= 2);
  for (const index of [0, 1]) {
    if (!model.displays[`Legacy_Aftermath_${index}`]) continue;
    assert.ok(model.texts[`Legacy_Aftermath_${index}_Title`].length <= AFTERMATH_TITLE_LIMIT);
    assert.ok(model.texts[`Legacy_Aftermath_${index}_Body`].length <= AFTERMATH_BODY_LIMIT, 'an aftermath card never overflows its three lines');
  }
  const record = buildLegacyPanelModel(input(preview, reduceLegacyFlow(overview, { type: 'open-landmark', landmark: 'war-record', member: null, file: null }), { session }));
  const bodies = new Set(preview.chronicle.map((entry) => entry.body));
  for (const index of [0, 1, 2]) {
    if (record.displays[`Legacy_Record_Entry_${index}`]) assert.ok(bodies.has(record.texts[`Legacy_Record_Entry_${index}_Body`]), 'the War Record shows every message whole');
  }
  assert.equal(model.controls.Legacy_AftermathDismiss.visible, true);
  model = buildLegacyPanelModel(input(preview, reduceLegacyFlow(overview, { type: 'open-landmark', landmark: 'muster-grounds', member: null, file: null }), { session }));
  assert.match(model.texts.Legacy_Muster_RepNote, /place stands empty/);
  const dock = buildLegacyDockModel(input(preview, overview, { session, entered: false }));
  assert.equal(dock.texts.Legacy_DockLabel, LEGACY_COPY.preview.label);
  assert.equal(dock.controls.Legacy_DockExit.visible, false, 'Exit VR appears only in the headset');
  assert.equal(dock.controls.Legacy_DockHome.visible, true);
});

test('pause replaces the panel until a tracked hand can resume, and keeps the Legacy view underneath', () => {
  const state = foundedState();
  const flow = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
  let model = buildLegacyPanelModel(input(state, flow, { pause: { paused: true, reason: 'Bring a hand into view', canResume: false } }));
  assert.equal(model.view, 'LegacyView_Pause');
  assert.equal(model.controls.Legacy_Resume.visible, false);
  model = buildLegacyPanelModel(input(state, flow, { pause: { paused: true, reason: 'Bring a hand into view', canResume: true } }));
  assert.equal(model.controls.Legacy_Resume.visible, true);
  const dock = buildLegacyDockModel(input(state, flow, { pause: { paused: true, reason: '', canResume: true } }));
  assert.equal(dock.controls.Legacy_DockPause.visible, false);
  assert.equal(dock.controls.Legacy_DockRecenter.visible, true);
  assert.equal(buildLegacyPanelModel(input(state, flow)).view, 'LegacyView_Overview', 'resuming restores the same view');
});

test('every panel string renders from the spatial font atlas without substitution marks', () => {
  assert.equal(spatialText('Development preview · fixture data · not saved'), 'Development preview / fixture data / not saved');
  assert.equal(spatialText('Guest session — not saved'), 'Guest session - not saved');
  assert.equal(spatialText('Tenné'), 'Tenne');
  const states: LegacyState[] = [foundedState()];
  for (const id of ['captive', 'returned', 'honoured', 'allied-loss', 'rival-grievance', 'promoted'] as const) {
    const preview = buildLegacyPreview(id);
    assert.ok(preview);
    states.push(preview);
  }
  const accepted = reduceLegacyAll(foundedState(), [{ type: 'accept-challenge', noticeId: 'notice-0002', at: '2026-10-29T11:00:00.000Z' }]);
  states.push(accepted.state);
  for (const state of states) {
    let flow = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
    const views: LegacyFlowState[] = [flow];
    for (const landmark of ['banner-hall', 'muster-grounds', 'war-record', 'heralds-station'] as const) {
      views.push(reduceLegacyFlow(flow, { type: 'open-landmark', landmark, member: null, file: null }));
    }
    flow = reduceLegacyFlow(views[4], { type: 'open-notice', noticeId: state.notices[state.notices.length - 1].id });
    views.push(flow, reduceLegacyFlow(flow, { type: 'request-accept' }));
    for (const view of views) {
      const model = buildLegacyPanelModel(input(state, view));
      for (const [id, text] of Object.entries(model.texts)) assertRenders(id, text);
    }
  }
});

test('founding, keyboard, pause, reset, guest and dock strings also render from the spatial atlas', () => {
  const empty = createLegacyState();
  const name = flowOf(founding(), { type: 'founding-step', view: 'name' });
  const keyboard = flowOf(name, { type: 'open-keyboard' });
  const typed = flowOf(keyboard, { type: 'key', key: 'R' }, { type: 'key', key: 'O' });
  const arms = flowOf(name, { type: 'suggest', name: suggestionSlots(name.draft)[0] }, { type: 'founding-step', view: 'arms' });
  const confirm = flowOf(arms, { type: 'founding-step', view: 'confirm' });
  const views: ReadonlyArray<readonly [string, LegacyFlowState]> = [['nation', founding()], ['name', name], ['keyboard', keyboard], ['typed', typed], ['arms', arms], ['confirm', confirm]];
  for (const [label, flow] of views) {
    for (const [id, text] of Object.entries(buildLegacyPanelModel(input(empty, flow)).texts)) assertRenders(`${label} ${id}`, text);
    for (const [id, text] of Object.entries(buildLegacyDockModel(input(empty, flow)).texts)) assertRenders(`${label} dock ${id}`, text);
  }
  assert.equal(buildLegacyPanelModel(input(empty, keyboard)).texts.Legacy_Keyboard_Value, QUEST_LEGACY_COPY.keyboard.placeholder);
  assert.equal(buildLegacyPanelModel(input(empty, typed)).texts.Legacy_Keyboard_Value, 'Ro', 'typed letters show as typed, with no caret glyph');
  const founded = foundedState();
  const overview = reduceLegacyFlow(createLegacyFlow('korvenia'), { type: 'show', view: 'overview' });
  const others: ReadonlyArray<readonly [string, LegacyModelInput]> = [
    ['reset', input(founded, reduceLegacyFlow(overview, { type: 'request-reset' }))],
    ['pause', input(founded, overview, { pause: { paused: true, reason: 'Take your time. Your place is kept.', canResume: false } })],
    ['guest', input(empty, founding(), { session: GUEST })],
  ];
  for (const [label, model] of others) {
    for (const [id, text] of Object.entries(buildLegacyPanelModel(model).texts)) assertRenders(`${label} ${id}`, text);
  }
  const leaves = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [];
  for (const text of leaves(QUEST_LEGACY_COPY)) assertRenders('Quest copy', text);
});

test('control looks come from code: hover lights a control, selection outranks hover, a disabled control never lights up', () => {
  const base = legacyButtonStyle('button', { enabled: true, selected: false, hovered: false });
  const hover = legacyButtonStyle('button', { enabled: true, selected: false, hovered: true });
  assert.notEqual(hover.borderColor, base.borderColor);
  assert.notEqual(legacyButtonStyleKey(hover), legacyButtonStyleKey(base));
  assert.equal(hover.borderWidth, base.borderWidth, 'hover keeps the border width, so labels never shift');
  for (const hovered of [false, true]) {
    const selected = legacyButtonStyle('button', { enabled: true, selected: true, hovered });
    assert.equal(selected.backgroundColor, LEGACY_UI_COLORS.selected, 'a selected control stays visibly selected under the pointer');
  }
  const disabled = legacyButtonStyle('primary', { enabled: false, selected: false, hovered: true });
  assert.equal(disabled.opacity, 0.42);
  assert.equal(disabled.borderColor, legacyButtonStyle('primary', { enabled: true, selected: false, hovered: false }).borderColor);
  assert.notEqual(legacyButtonStyle('danger', { enabled: true, selected: false, hovered: true }).backgroundColor, LEGACY_UI_COLORS.danger);
});

test('long text is shortened at a word boundary only where a fixed box would overflow', () => {
  assert.equal(clampText('Short enough', 20), 'Short enough');
  const clamped = clampText('Ambroise was taken in a lost Muster conflict and is held by House Azhemar.', 40);
  assert.ok(clamped.length <= 40);
  assert.ok(clamped.endsWith('...'));
  assert.equal(clamped, 'Ambroise was taken in a lost Muster...');
});
