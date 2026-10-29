/**
 * Native, live UIKitML panels for the Quest My Legacy destination: the primary
 * world-space reading panel (founding, aftermath, landmark inspectors, notices,
 * pause) and the touch tray staged within arm's reach (the current view's Back
 * and primary action, Return to Home, Recenter, Pause, Exit VR). Generated
 * deterministically from shared Legacy content and the Quest Legacy UI
 * contract; do not hand-edit public/ui/legacy.uikitml or public/ui/legacy-dock.uikitml.
 * Native property references: https://github.com/pmndrs/uikit/blob/main/docs/getting-started/components-and-properties.md
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { LEGACY_COPY } from '../shared/legacy/content/copy.ts';
import { FILES } from '../shared/legacy/content/muster.ts';
import { NATIONS, NATION_ORDER } from '../shared/legacy/content/nations.ts';
import { LEGACY_LANDMARKS } from '../shared/legacy/environment-contract.ts';
import { LEGACY_ACTION_LABELS } from '../main-game-vr/src/legacy/legacy-actions.ts';
import {
  LEGACY_AFTERMATH_SLOTS, LEGACY_DOCK_ACTION_IDS, LEGACY_FORMATION_LEGEND, LEGACY_FORMATION_RANKS, LEGACY_HERALDRY_IMAGE_IDS, LEGACY_HERALDRY_PARTS,
  LEGACY_HONOUR_SLOTS, LEGACY_HOUSE_SHIELD_IDS, LEGACY_KEY_ACTIONS, LEGACY_KEY_ROWS, LEGACY_LEDGER_ROWS, LEGACY_LIVE_TEXT, LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE,
  LEGACY_PANEL_ACTION_IDS, LEGACY_RECORD_PAGE, LEGACY_SUGGESTION_SLOTS, LEGACY_UI_COLORS, LEGACY_UI_LAYOUT, LEGACY_VIEW_IDS, LEGACY_WAGER_TERM_SLOTS,
  legacyFileId, legacyFormationCellId, legacyKeyActionId, legacyKeyId, legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId,
  legacyRecordTabId, legacyWagerTermId,
} from '../main-game-vr/src/legacy/legacy-ui-contract.ts';
import type { LegacyHeraldryPart, LegacyKeyAction, LegacyPanelActionId } from '../main-game-vr/src/legacy/legacy-ui-contract.ts';
import { QUEST_LEGACY_COPY } from '../main-game-vr/src/legacy/quest-legacy-copy.ts';
import { isSpatialText, spatialText } from '../main-game-vr/src/legacy/spatial-text.ts';

interface Rect { x: number; y: number; width: number; height: number }

/** A 1x1 fully transparent PNG, encoded deterministically so the generated panel stays byte-stable. */
function transparentPixel(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4); check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
const TRANSPARENT_PIXEL = transparentPixel();

export interface LegacyUIReport {
  panelElements: number;
  dockElements: number;
  hitTargets: number;
  smallestHitTarget: number;
  /** Smallest control and text, in degrees, at each document's nominal viewing distance. */
  smallestHitDegrees: number;
  smallestTextDegrees: number;
  /** Smallest tray control edge, in metres, for fingertip touch. */
  smallestTouchMetres: number;
}

/** Angular size, in degrees, of `units` of a document authored at `scale` and seen from `distance` metres. */
const degreesOf = (units: number, scale: number, distance: number): number => 2 * Math.atan(units / 100 * scale / 2 / distance) * 180 / Math.PI;

export async function generateQuestLegacyUI(destinations: { panel?: string; dock?: string } = {}): Promise<LegacyUIReport> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const c = LEGACY_UI_COLORS;
  const layout = LEGACY_UI_LAYOUT;
  const W = layout.panel.width;
  const H = layout.panel.height;
  let ids = new Set<string>();
  let hitTargets: { id: string; width: number; height: number }[] = [];
  const documentTargets: { scale: number; distance: number; touch: boolean; targets: { id: string; width: number; height: number }[] }[] = [];
  const fontSizes: number[] = [];

  const id = (value: string): string => {
    if (ids.has(value)) throw new Error(`Duplicate Quest Legacy UI ID: ${value}`);
    ids.add(value);
    return ` id="${value}"`;
  };
  const number = (value: number): string => Number(value.toFixed(4)).toString();
  const escape = (value: string): string => {
    const safe = spatialText(value);
    if (!isSpatialText(safe)) throw new Error(`Copy cannot render in spatial text: ${value}`);
    return safe.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  };
  const rect = (r: Rect): string =>
    `position-type: absolute; position-left: ${number(r.x)}; position-top: ${number(r.y)}; width: ${number(r.width)}; height: ${number(r.height)};`;
  const node = (tag: string, elementId: string | undefined, className: string, contents: string, style = ''): string =>
    `<${tag}${elementId ? id(elementId) : ''}${className ? ` class="${className}"` : ''}${style ? ` style="${style}"` : ''}>${contents}</${tag}>`;
  /**
   * Text never takes pointer input, so the button behind it receives the whole hit area. A live text
   * (empty here, set at runtime) starts with a placeholder so UIKitML gives it a text node to draw.
   */
  const text = (value: string, r: Rect, className: string, elementId?: string, style = ''): string => {
    const live = value.length === 0;
    if (live && !elementId) throw new Error('A live Quest Legacy text needs an id');
    const classes = live ? `${className} ${LEGACY_LIVE_TEXT.className}`.trim() : className;
    return node('span', elementId, classes, escape(live ? LEGACY_LIVE_TEXT.placeholder : value), `${rect(r)} pointer-events: none; z-index-offset: 3; ${style}`);
  };
  const box = (elementId: string | undefined, r: Rect, contents: string, style = ''): string =>
    node('div', elementId, '', contents, `${rect(r)} ${style}`);
  /**
   * Controls are plain containers: hover, selection and disabled looks are set from code
   * (src/legacy/legacy-button-style.ts), because class :hover conditionals and the kit button's
   * own hover/pressed conditionals could stay applied after a control was hidden while hovered.
   */
  const button = (elementId: string, r: Rect, contents: string, className = 'lg-btn', style = ''): string => {
    hitTargets.push({ id: elementId, width: r.width, height: r.height });
    return node('div', elementId, className, contents, `${rect(r)} ${style}`);
  };
  /** A labelled button whose label is centred across its whole hit area. */
  const action = (elementId: string, label: string, r: Rect, className = 'lg-btn', labelClass = 'lg-btn-label'): string =>
    button(elementId, r, text(label, { x: 0, y: (r.height - 24) / 2, width: r.width, height: 24 }, labelClass, `${elementId}_Label`), className);
  /** A fixed panel action: its label is the one the touch tray mirrors. */
  const fixed = (elementId: LegacyPanelActionId, r: Rect, className = 'lg-btn'): string => action(elementId, LEGACY_ACTION_LABELS[elementId], r, className);
  /**
   * The live heraldry raster replaces this source as a texture at runtime. UIKitML requires a static
   * source, so each image starts as one transparent pixel; its box matches the raster's aspect.
   */
  const image = (elementId: string, r: Rect): string =>
    `<img${id(elementId)} src="${TRANSPARENT_PIXEL}" style="${rect(r)} object-fit: fill; pointer-events: none; z-index-offset: 2;" />`;
  const view = (elementId: string, contents: string): string =>
    node('div', elementId, 'lg-view', contents, `display: ${elementId === 'LegacyView_Loading' ? 'flex' : 'none'};`);

  const fontSize = (value: number): number => { fontSizes.push(value); return value; };
  const styles = `
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHpv4kjgoGqM7EPCw.ttf'); font-weight: 400; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E30-8c4A.ttf'); font-weight: 600; }
    .lg-root { width: ${W}; height: ${H}; position-type: relative; overflow: hidden; font-family: 'Barlow'; color: ${c.text}; background-color: ${c.surface}; border-color: ${c.surfaceBorder}; border-width: 1.5; border-radius: 8; }
    .lg-dock { width: ${layout.tray.width}; height: ${layout.tray.height}; position-type: relative; overflow: hidden; font-family: 'Barlow'; color: ${c.text}; background-color: ${c.surface}; border-color: ${c.surfaceBorder}; border-width: 2; border-radius: 10; }
    .lg-view { position-type: absolute; position-left: 0; position-top: 0; width: ${W}; height: ${H}; }
    .lg-title { font-size: ${fontSize(26)}; font-weight: 600; color: ${c.heading}; line-height: 1.2; }
    .lg-subtitle { font-size: ${fontSize(15)}; color: ${c.secondary}; line-height: 1.3; }
    .lg-band { font-size: ${fontSize(15)}; font-weight: 600; color: ${c.bandText}; line-height: 1.3; }
    .lg-message { font-size: ${fontSize(15)}; color: ${c.warning}; line-height: 1.3; }
    .lg-heading { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.accent}; line-height: 1.3; }
    .lg-label { font-size: ${fontSize(15)}; color: ${c.accent}; line-height: 1.3; }
    .lg-body { font-size: ${fontSize(16)}; color: ${c.text}; line-height: 1.3; }
    .lg-body-large { font-size: ${fontSize(18)}; color: ${c.text}; line-height: 1.35; }
    .lg-small { font-size: ${fontSize(15)}; color: ${c.secondary}; line-height: 1.3; }
    .lg-name { font-size: ${fontSize(28)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-strong { font-size: ${fontSize(17)}; font-weight: 600; color: ${c.text}; line-height: 1.3; }
    .lg-card-title { font-size: ${fontSize(20)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-term-when { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.accent}; line-height: 1.3; }
    .lg-term-then { font-size: ${fontSize(16)}; color: ${c.text}; line-height: 1.3; }
    .lg-aftermath-title { font-size: ${fontSize(18)}; font-weight: 600; color: ${c.text}; line-height: 1.25; }
    .lg-aftermath-body { font-size: ${fontSize(17)}; color: ${c.text}; line-height: 1.35; }
    .lg-ledger-label { font-size: ${fontSize(15)}; color: ${c.secondary}; line-height: 1.25; }
    .lg-ledger-value { font-size: ${fontSize(15)}; font-weight: 600; color: ${c.text}; line-height: 1.25; }
    .lg-principle { font-size: ${fontSize(16)}; color: ${c.bandText}; line-height: 1.3; }
    .lg-cell-letter { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.2; }
    .lg-btn { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.buttonBorder}; border-width: 1.5; background-color: ${c.button}; color: ${c.text}; cursor: pointer; }
    .lg-btn-primary { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.primaryBorder}; border-width: 2; background-color: ${c.primary}; color: ${c.text}; cursor: pointer; }
    .lg-btn-danger { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.dangerBorder}; border-width: 1.5; background-color: ${c.danger}; color: ${c.text}; cursor: pointer; }
    .lg-btn-label { font-size: ${fontSize(17)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.2; }
    .lg-nav-label { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.2; }
    .lg-key-label { font-size: ${fontSize(22)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.1; }
    .lg-cell-label { font-size: ${fontSize(15)}; color: ${c.secondary}; line-height: 1.2; }
    .lg-cell-value { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-center { text-align: center; }
    .${LEGACY_LIVE_TEXT.className} { pointer-events: none; }
  `;

  // Shared frame: development/guest band, title, subtitle and the message line above the footer.
  const frame = text('', { x: 24, y: 4, width: W - 48, height: 20 }, 'lg-band', 'Legacy_Band')
    + text(LEGACY_COPY.title, { x: 24, y: 30, width: W - 48, height: 34 }, 'lg-title', 'Legacy_Title')
    + text('', { x: 24, y: 66, width: W - 48, height: 22 }, 'lg-subtitle', 'Legacy_Subtitle')
    + text('', { x: 24, y: 436, width: W - 48, height: 22 }, 'lg-message', 'Legacy_Message');
  const FOOTER_Y = 464;
  const footerLeft: Rect = { x: 24, y: FOOTER_Y, width: 200, height: 50 };
  const footerMiddle: Rect = { x: 260, y: FOOTER_Y, width: 200, height: 50 };
  const footerRight: Rect = { x: 496, y: FOOTER_Y, width: 200, height: 50 };
  const band = node('div', 'Legacy_BandSurface', '', '', `${rect({ x: 0, y: 0, width: W, height: 26 })} background-color: ${c.band}; display: none; pointer-events: none;`);
  const inset = `background-color: ${c.inset}; border-color: ${c.buttonBorder}; border-width: 1; border-radius: 5;`;
  const card = `background-color: ${c.card}; border-radius: 5;`;

  const loading = view('LegacyView_Loading',
    text(QUEST_LEGACY_COPY.loading.body, { x: 24, y: 96, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Loading_Body'));

  const recovery = view('LegacyView_Recovery',
    text(LEGACY_COPY.invalidSave.body, { x: 24, y: 96, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Recovery_Body')
    + text(LEGACY_COPY.invalidSave.startNewNote, { x: 24, y: 162, width: W - 48, height: 44 }, 'lg-body', 'Legacy_Recovery_Note')
    + text('', { x: 24, y: 212, width: W - 48, height: 80 }, 'lg-small', 'Legacy_Recovery_Detail')
    + fixed('Legacy_RecoveryHome', footerLeft)
    + fixed('Legacy_RecoveryGuest', footerMiddle)
    + fixed('Legacy_RecoveryNew', footerRight, 'lg-btn-primary'));

  const nationCards = NATION_ORDER.map((nationId, index) => {
    const nation = NATIONS[nationId];
    const elementId = legacyNationId(nationId);
    const r = { x: 24 + (index % 2) * 342, y: 146 + Math.floor(index / 2) * 88, width: 330, height: 82 };
    // Buttons centre their text by default; a card reads as one left-aligned block with its status on the right.
    return button(elementId, r,
      text(nation.name, { x: 14, y: 10, width: 200, height: 26 }, 'lg-card-title', `${elementId}_Title`, 'text-align: left;')
      + text('', { x: 196, y: 13, width: 120, height: 20 }, 'lg-label', `${elementId}_Status`, 'text-align: right;')
      + text(nation.epithet, { x: 14, y: 46, width: 302, height: 24 }, 'lg-body', `${elementId}_Epithet`, 'text-align: left;'));
  }).join('');
  const nationView = view('LegacyView_Nation',
    text(LEGACY_COPY.founding.intro, { x: 24, y: 96, width: W - 48, height: 44 }, 'lg-body', 'Legacy_Nation_Intro')
    + nationCards
    + text(NATIONS[NATION_ORDER[0]].summary, { x: 24, y: 326, width: W - 48, height: 104 }, 'lg-body', 'Legacy_Nation_Summary')
    + fixed('Legacy_FoundingHome', footerLeft)
    + fixed('Legacy_NationNext', footerRight, 'lg-btn-primary'));

  const nameBox = box('Legacy_Name_Box', { x: 24, y: 122, width: W - 48, height: 54 },
    text('', { x: 0, y: 12, width: W - 48, height: 32 }, 'lg-name lg-center', 'Legacy_Name_Value'), inset);
  const suggestions = Array.from({ length: LEGACY_SUGGESTION_SLOTS }, (_, index) =>
    action(`Legacy_Suggestion_${index}`, '', { x: 24 + (index % 2) * 342, y: 206 + Math.floor(index / 2) * 60, width: 330, height: 54 })).join('');
  const nameView = view('LegacyView_Name',
    text(LEGACY_COPY.founding.steps[1].hint, { x: 24, y: 96, width: W - 48, height: 22 }, 'lg-body', 'Legacy_Name_Hint')
    + nameBox
    + text(LEGACY_COPY.founding.suggestionsLabel, { x: 24, y: 184, width: W - 48, height: 20 }, 'lg-label', 'Legacy_Name_SuggestionsLabel')
    + suggestions
    + fixed('Legacy_MoreNames', { x: 24, y: 328, width: 330, height: 50 })
    + fixed('Legacy_OpenKeyboard', { x: 366, y: 328, width: 330, height: 50 })
    + text(LEGACY_COPY.founding.nameRules, { x: 24, y: 388, width: W - 48, height: 22 }, 'lg-small', 'Legacy_Name_Rules')
    + fixed('Legacy_NameBack', footerLeft)
    + fixed('Legacy_NameNext', footerRight, 'lg-btn-primary'));

  const KEY = { width: 58, height: 50, gap: 6 };
  const keyRows = LEGACY_KEY_ROWS.map((row, rowIndex) => {
    const rowWidth = row.length * KEY.width + (row.length - 1) * KEY.gap;
    const left = (W - rowWidth) / 2;
    return row.map((key, index) => button(legacyKeyId(key), { x: left + index * (KEY.width + KEY.gap), y: 156 + rowIndex * 56, width: KEY.width, height: KEY.height },
      text(key, { x: 0, y: 12, width: KEY.width, height: 26 }, 'lg-key-label'))).join('');
  }).join('');
  const actionWidths: Readonly<Record<LegacyKeyAction, number>> = { shift: 110, space: 260, delete: 120, clear: 120 };
  const actionLabels: Readonly<Record<LegacyKeyAction, string>> = {
    shift: QUEST_LEGACY_COPY.keyboard.shift, space: QUEST_LEGACY_COPY.keyboard.space,
    delete: QUEST_LEGACY_COPY.keyboard.delete, clear: QUEST_LEGACY_COPY.keyboard.clear,
  };
  const actionRowWidth = LEGACY_KEY_ACTIONS.reduce((sum, key) => sum + actionWidths[key], 0) + (LEGACY_KEY_ACTIONS.length - 1) * KEY.gap;
  let actionLeft = (W - actionRowWidth) / 2;
  const keyActions = LEGACY_KEY_ACTIONS.map((keyAction) => {
    const r = { x: actionLeft, y: 156 + LEGACY_KEY_ROWS.length * 56, width: actionWidths[keyAction], height: KEY.height };
    actionLeft += actionWidths[keyAction] + KEY.gap;
    return action(legacyKeyActionId(keyAction), actionLabels[keyAction], r);
  }).join('');
  const keyboardView = view('LegacyView_Keyboard',
    box('Legacy_Keyboard_Box', { x: 24, y: 96, width: W - 48, height: 52 },
      text('', { x: 0, y: 11, width: W - 48, height: 32 }, 'lg-name lg-center', 'Legacy_Keyboard_Value'), inset)
    + keyRows + keyActions
    + text(LEGACY_COPY.founding.nameRules, { x: 24, y: 388, width: W - 48, height: 22 }, 'lg-small', 'Legacy_Keyboard_Hint')
    + fixed('Legacy_KeyboardCancel', footerLeft)
    + fixed('Legacy_KeyboardDone', footerRight, 'lg-btn-primary'));

  const presets = Array.from({ length: 4 }, (_, index) =>
    action(`Legacy_Preset_${index}`, '', { x: 190 + index * 128, y: 96, width: 121, height: 50 })).join('');
  const partColumn: Readonly<Record<LegacyHeraldryPart, readonly [number, number]>> = {
    division: [0, 0], field0: [0, 1], field1: [0, 2],
    ordinary: [1, 0], ordinaryTincture: [1, 1], charge: [1, 2], chargeTincture: [1, 3],
  };
  const partLabels: Readonly<Record<LegacyHeraldryPart, string>> = {
    division: LEGACY_COPY.founding.parts.division,
    field0: LEGACY_COPY.founding.parts.field,
    field1: LEGACY_COPY.founding.parts.secondField,
    ordinary: LEGACY_COPY.founding.parts.ordinary,
    ordinaryTincture: LEGACY_COPY.founding.parts.ordinaryTincture,
    charge: LEGACY_COPY.founding.parts.charge,
    chargeTincture: LEGACY_COPY.founding.parts.chargeTincture,
  };
  const cyclers = LEGACY_HERALDRY_PARTS.map((part) => {
    const [column, row] = partColumn[part];
    const x = 190 + column * 256;
    const y = 154 + row * 56;
    const valueId = legacyPartId(part);
    return button(legacyPartPreviousId(part), { x, y, width: 50, height: 50 }, text('<', { x: 0, y: 12, width: 50, height: 26 }, 'lg-key-label'))
      + button(valueId, { x: x + 56, y, width: 194, height: 50 },
        text(partLabels[part], { x: 10, y: 5, width: 160, height: 18 }, 'lg-cell-label', `${valueId}_Name`)
        + text('', { x: 10, y: 24, width: 160, height: 22 }, 'lg-cell-value', `${valueId}_Value`)
        + text('>', { x: 166, y: 13, width: 22, height: 24 }, 'lg-key-label'));
  }).join('');
  const armsView = view('LegacyView_Arms',
    image('Legacy_Arms_Preview', { x: 24, y: 96, width: 150, height: 225 })
    + text('', { x: 24, y: 326, width: 150, height: 104 }, 'lg-small', 'Legacy_Arms_Blazon')
    + presets + cyclers
    + text('', { x: 190, y: 324, width: 250, height: 106 }, 'lg-small', 'Legacy_Arms_Advice')
    + text(LEGACY_COPY.founding.advisoryNote, { x: 446, y: 382, width: 250, height: 44 }, 'lg-small', 'Legacy_Arms_AdviceNote')
    + fixed('Legacy_ArmsBack', footerLeft)
    + fixed('Legacy_ArmsNext', footerRight, 'lg-btn-primary'));

  const confirmView = view('LegacyView_Confirm',
    image('Legacy_Confirm_Preview', { x: 24, y: 96, width: 150, height: 225 })
    + text('', { x: 190, y: 96, width: 506, height: 36 }, 'lg-name', 'Legacy_Confirm_Name')
    + text('', { x: 190, y: 136, width: 506, height: 22 }, 'lg-body', 'Legacy_Confirm_Nation')
    + text('', { x: 190, y: 160, width: 506, height: 44 }, 'lg-small', 'Legacy_Confirm_Blazon')
    + text(LEGACY_COPY.founding.mottoLabel, { x: 190, y: 210, width: 506, height: 20 }, 'lg-label', 'Legacy_Confirm_MottoLabel')
    + text('', { x: 190, y: 232, width: 506, height: 24 }, 'lg-body', 'Legacy_Confirm_Motto')
    + fixed('Legacy_ConfirmMotto', { x: 190, y: 262, width: 230, height: 50 })
    + fixed('Legacy_ConfirmClearMotto', { x: 430, y: 262, width: 130, height: 50 })
    + text(LEGACY_COPY.sections.sworn, { x: 190, y: 320, width: 506, height: 20 }, 'lg-label', 'Legacy_Confirm_MembersTitle')
    + text('', { x: 190, y: 342, width: 506, height: 44 }, 'lg-body', 'Legacy_Confirm_Members')
    + text('', { x: 190, y: 390, width: 506, height: 40 }, 'lg-small', 'Legacy_Confirm_Body')
    + fixed('Legacy_ConfirmBack', footerLeft)
    + fixed('Legacy_ConfirmRaise', footerRight, 'lg-btn-primary'));

  // The raising beat: the new arms and the founding line, before the Bannerhold.
  const raisedView = view('LegacyView_Raised',
    image('Legacy_Raised_Preview', { x: (W - 120) / 2, y: 94, width: 120, height: 180 })
    + text('', { x: 24, y: 282, width: W - 48, height: 22 }, 'lg-heading lg-center', 'Legacy_Raised_Heading')
    + text('', { x: 24, y: 306, width: W - 48, height: 36 }, 'lg-name lg-center', 'Legacy_Raised_Name')
    + text('', { x: 24, y: 344, width: W - 48, height: 24 }, 'lg-body lg-center', 'Legacy_Raised_Motto')
    + text('', { x: 60, y: 372, width: W - 120, height: 58 }, 'lg-body lg-center', 'Legacy_Raised_Body')
    + fixed('Legacy_RaisedContinue', footerRight, 'lg-btn-primary'));

  // At most two prominent consequences, each shown whole; every fact stays in the War Record.
  const aftermathCards = Array.from({ length: LEGACY_AFTERMATH_SLOTS }, (_, index) => {
    const elementId = `Legacy_Aftermath_${index}`;
    return box(elementId, { x: 24 + index * 342, y: 96, width: 330, height: 300 },
      text('', { x: 14, y: 12, width: 302, height: 20 }, 'lg-label', `${elementId}_Heading`)
      + text('', { x: 14, y: 36, width: 302, height: 48 }, 'lg-aftermath-title', `${elementId}_Title`)
      + text('', { x: 14, y: 90, width: 302, height: 196 }, 'lg-aftermath-body', `${elementId}_Body`),
      `background-color: ${c.card}; border-color: ${c.primaryBorder}; border-width: 1.5; border-radius: 6; display: none;`);
  }).join('');
  const aftermathView = view('LegacyView_Aftermath',
    aftermathCards
    + text(LEGACY_COPY.aftermath.allRecorded, { x: 24, y: 404, width: W - 48, height: 24 }, 'lg-small lg-center', 'Legacy_Aftermath_Note')
    + fixed('Legacy_AftermathLater', footerLeft)
    + fixed('Legacy_AftermathDismiss', footerRight, 'lg-btn-primary'));

  const landmarkButtons = LEGACY_LANDMARKS.map((landmark, index) => {
    const elementId = legacyLandmarkButtonId(landmark);
    return button(elementId, { x: 24 + (index % 2) * 342, y: 206 + Math.floor(index / 2) * 100, width: 330, height: 94 },
      text(LEGACY_COPY.landmarks[landmark].title, { x: 14, y: 10, width: 302, height: 26 }, 'lg-card-title', `${elementId}_Title`)
      + text(LEGACY_COPY.landmarks[landmark].action, { x: 14, y: 42, width: 302, height: 44 }, 'lg-small', `${elementId}_Status`));
  }).join('');
  const overviewView = view('LegacyView_Overview',
    image('Legacy_Overview_Crest', { x: 24, y: 96, width: 64, height: 96 })
    + text(LEGACY_COPY.tagline, { x: 104, y: 100, width: W - 128, height: 24 }, 'lg-heading', 'Legacy_Overview_Tagline')
    + text(QUEST_LEGACY_COPY.overviewIntro, { x: 104, y: 130, width: W - 128, height: 44 }, 'lg-body', 'Legacy_Overview_Intro')
    + text('', { x: 104, y: 130, width: 470, height: 44 }, 'lg-body', 'Legacy_Overview_Pending', `color: ${c.warning}; display: none;`)
    + fixed('Legacy_AftermathReview', { x: 586, y: 128, width: 110, height: 50 }, 'lg-btn-primary')
    + landmarkButtons);

  const honours = Array.from({ length: LEGACY_HONOUR_SLOTS }, (_, index) =>
    text('', { x: 24, y: 284 + index * 22, width: 330, height: 20 }, 'lg-body', `Legacy_Hall_Honour_${index}`)).join('');
  const hallView = view('LegacyView_Hall',
    image('Legacy_Hall_Preview', { x: 24, y: 96, width: 100, height: 150 })
    + text('', { x: 140, y: 96, width: 556, height: 34 }, 'lg-name', 'Legacy_Hall_Name')
    + text('', { x: 140, y: 132, width: 556, height: 22 }, 'lg-body', 'Legacy_Hall_Polity')
    + text('', { x: 140, y: 156, width: 556, height: 22 }, 'lg-body', 'Legacy_Hall_Motto')
    + text('', { x: 140, y: 180, width: 556, height: 22 }, 'lg-body', 'Legacy_Hall_Rank')
    + text('', { x: 140, y: 204, width: 556, height: 44 }, 'lg-small', 'Legacy_Hall_Blazon')
    + text(LEGACY_COPY.sections.honours, { x: 24, y: 258, width: 330, height: 22 }, 'lg-heading', 'Legacy_Hall_HonoursTitle')
    + honours
    + text(LEGACY_COPY.empty.honours, { x: 24, y: 284, width: 330, height: 44 }, 'lg-small', 'Legacy_Hall_HonoursEmpty')
    + text(LEGACY_COPY.houses.heading, { x: 366, y: 258, width: 330, height: 22 }, 'lg-heading', 'Legacy_Hall_HousesTitle')
    + image(LEGACY_HOUSE_SHIELD_IDS.allied, { x: 366, y: 286, width: 40, height: 48 })
    + text('', { x: 414, y: 286, width: 282, height: 44 }, 'lg-small', 'Legacy_Hall_Allied')
    + image(LEGACY_HOUSE_SHIELD_IDS.rival, { x: 366, y: 342, width: 40, height: 48 })
    + text('', { x: 414, y: 342, width: 282, height: 44 }, 'lg-small', 'Legacy_Hall_Rival')
    + text('', { x: 414, y: 388, width: 282, height: 40 }, 'lg-small', 'Legacy_Hall_RivalNote')
    + fixed('Legacy_HallBack', footerLeft)
    + fixed('Legacy_ResetOpen', footerRight, 'lg-btn-danger')
    + text('', { x: 430, y: FOOTER_Y + 4, width: 266, height: 44 }, 'lg-small', 'Legacy_Hall_Locked', 'text-align: right; display: none;'));

  // Muster Grounds: the representative's ledger beside the house's side of the formation.
  const ledgerRows = Array.from({ length: LEGACY_LEDGER_ROWS }, (_, index) => {
    const elementId = `Legacy_Muster_Row_${index}`;
    return box(elementId, { x: 24, y: 170 + index * 21, width: 360, height: 21 },
      text('', { x: 0, y: 0, width: 130, height: 20 }, 'lg-ledger-label', `${elementId}_Label`)
      + text('', { x: 132, y: 0, width: 228, height: 20 }, 'lg-ledger-value', `${elementId}_Value`), 'display: none;');
  }).join('');
  const CELL = { left: 400, top: 186, width: 33, height: 34, step: 37.5, rowStep: 38 };
  const formationCells = LEGACY_FORMATION_RANKS.flatMap((rank, row) => FILES.map((file, column) => {
    const elementId = legacyFormationCellId(`${file}${rank}`);
    return box(elementId, { x: CELL.left + column * CELL.step, y: CELL.top + row * CELL.rowStep, width: CELL.width, height: CELL.height },
      text('', { x: 0, y: 7, width: CELL.width, height: 20 }, 'lg-cell-letter', `${elementId}_Label`),
      `background-color: ${c.crownCell}; border-color: ${c.surface}; border-width: 2; border-radius: 4;`);
  })).join('');
  const legend = LEGACY_FORMATION_LEGEND.map((group, index) =>
    box(`Legacy_Legend_${group}_Swatch`, { x: 400, y: 268 + index * 22, width: 14, height: 14 }, '', `background-color: ${c.crownCell}; border-radius: 3;`)
    + text('', { x: 420, y: 264 + index * 22, width: 276, height: 20 }, 'lg-small', `Legacy_Legend_${group}`)).join('');
  const musterView = view('LegacyView_Muster',
    text(LEGACY_COPY.inspector.nominated, { x: 24, y: 94, width: 360, height: 20 }, 'lg-label', 'Legacy_Muster_RepHeading')
    + text('', { x: 24, y: 114, width: 360, height: 28 }, 'lg-card-title', 'Legacy_Muster_RepName')
    + text('', { x: 24, y: 144, width: 360, height: 22 }, 'lg-body', 'Legacy_Muster_RepEpithet')
    + ledgerRows
    + text('', { x: 24, y: 362, width: 360, height: 66 }, 'lg-small', 'Legacy_Muster_RepNote')
    + box('Legacy_Muster_EmptyPlace', { x: 24, y: 360, width: 360, height: 70 },
      text('', { x: 12, y: 8, width: 336, height: 54 }, 'lg-body', 'Legacy_Muster_EmptyPlace_Text', `color: ${c.warning};`),
      `background-color: ${c.empty}; border-color: ${c.emptyBorder}; border-width: 1.5; border-radius: 5; display: none;`)
    + text(LEGACY_COPY.principle, { x: 400, y: 94, width: 296, height: 62 }, 'lg-principle', 'Legacy_Muster_Principle')
    + text(LEGACY_COPY.inspector.formationHeading, { x: 400, y: 162, width: 296, height: 20 }, 'lg-label', 'Legacy_Muster_FormationHeading')
    + formationCells + legend
    + text(LEGACY_COPY.inspector.formationNote, { x: 400, y: 334, width: 296, height: 60 }, 'lg-small', 'Legacy_Muster_Formation')
    + text(LEGACY_COPY.inspector.futureAppointments, { x: 400, y: 396, width: 296, height: 38 }, 'lg-small', 'Legacy_Muster_Future')
    + fixed('Legacy_MusterBack', footerLeft)
    + fixed('Legacy_MusterChoose', footerRight, 'lg-btn-primary'));

  const members = Array.from({ length: LEGACY_MEMBER_SLOTS }, (_, index) => {
    const elementId = `Legacy_Member_${index}`;
    return button(elementId, { x: 24, y: 116 + index * 60, width: 330, height: 56 },
      text('', { x: 12, y: 6, width: 306, height: 24 }, 'lg-strong', `${elementId}_Name`)
      + text('', { x: 12, y: 31, width: 306, height: 20 }, 'lg-cell-label', `${elementId}_Status`));
  }).join('');
  const files = FILES.map((file, index) => {
    const elementId = legacyFileId(file);
    return button(elementId, { x: 360 + (index % 5) * 69, y: 116, width: 60, height: 50 },
      text(LEGACY_COPY.inspector.fileName(file), { x: 0, y: 14, width: 60, height: 22 }, 'lg-cell-value lg-center', `${elementId}_Label`), 'lg-btn', 'display: none;');
  }).join('');
  const nominateView = view('LegacyView_Nominate',
    text(LEGACY_COPY.inspector.chooseMember, { x: 24, y: 94, width: 330, height: 20 }, 'lg-label', 'Legacy_Nominate_MembersLabel')
    + members
    + text('', { x: 24, y: 304, width: 330, height: 120 }, 'lg-small', 'Legacy_Nominate_Note')
    + text(LEGACY_COPY.inspector.chooseFile, { x: 360, y: 94, width: 336, height: 20 }, 'lg-label', 'Legacy_Nominate_FilesLabel')
    + files
    + text('', { x: 360, y: 176, width: 336, height: 22 }, 'lg-body', 'Legacy_Nominate_FileCaption')
    + text('', { x: 360, y: 204, width: 336, height: 104 }, 'lg-small', 'Legacy_Nominate_Claims')
    + fixed('Legacy_NominateBack', footerLeft)
    + fixed('Legacy_MusterNominate', footerRight, 'lg-btn-primary'));

  const pager = (prefix: 'Record' | 'Herald'): string =>
    fixed(`Legacy_${prefix}Prev`, { x: 376, y: FOOTER_Y, width: 120, height: 50 })
    + text('', { x: 500, y: FOOTER_Y + 14, width: 72, height: 22 }, 'lg-body lg-center', `Legacy_${prefix}_Page`)
    + fixed(`Legacy_${prefix}Next`, { x: 576, y: FOOTER_Y, width: 120, height: 50 });
  const recordTabs = (['conflicts', 'unresolved', 'ledger'] as const).map((tab, index) =>
    action(legacyRecordTabId(tab), '', { x: 24 + index * 228, y: 94, width: 216, height: 50 })).join('');
  const entries = Array.from({ length: LEGACY_RECORD_PAGE }, (_, index) => {
    const elementId = `Legacy_Record_Entry_${index}`;
    return box(elementId, { x: 24, y: 152 + index * 94, width: W - 48, height: 90 },
      text('', { x: 12, y: 6, width: 440, height: 24 }, 'lg-strong', `${elementId}_Title`)
      + text('', { x: 456, y: 8, width: W - 48 - 468, height: 20 }, 'lg-label', `${elementId}_Kind`, 'text-align: right;')
      + text('', { x: 12, y: 31, width: W - 72, height: 20 }, 'lg-small', `${elementId}_Meta`)
      + text('', { x: 12, y: 51, width: W - 72, height: 38 }, 'lg-ledger-label', `${elementId}_Body`, `color: ${c.text};`),
      `${card} display: none;`);
  }).join('');
  const recordView = view('LegacyView_Record',
    recordTabs + entries
    + text('', { x: 24, y: 152, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Record_Empty')
    + fixed('Legacy_RecordBack', { x: 24, y: FOOTER_Y, width: 180, height: 50 })
    + pager('Record'));

  const notices = Array.from({ length: LEGACY_NOTICE_PAGE }, (_, index) => {
    const elementId = `Legacy_Notice_${index}`;
    return button(elementId, { x: 24, y: 94 + index * 84, width: W - 48, height: 78 },
      text('', { x: 14, y: 6, width: 440, height: 20 }, 'lg-label', `${elementId}_Kind`)
      + text('', { x: 460, y: 6, width: 198, height: 20 }, 'lg-cell-label', `${elementId}_Status`, 'text-align: right;')
      + text('', { x: 14, y: 28, width: 644, height: 24 }, 'lg-strong', `${elementId}_Title`)
      + text('', { x: 14, y: 54, width: 644, height: 20 }, 'lg-cell-label', `${elementId}_From`), 'lg-btn', 'display: none;');
  }).join('');
  const heraldView = view('LegacyView_Herald',
    notices
    + text(LEGACY_COPY.empty.notices, { x: 24, y: 94, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Herald_Empty')
    + fixed('Legacy_HeraldBack', { x: 24, y: FOOTER_Y, width: 180, height: 50 })
    + pager('Herald'));

  /**
   * The wager as four stated terms, each a condition beside what follows, in the primary text colour.
   * One block layout serves the notice and its acceptance, so the terms read the same in both.
   */
  const wager = (prefix: 'NoticeView' | 'Accept', top: number): string => {
    const terms = Array.from({ length: LEGACY_WAGER_TERM_SLOTS }, (_, index) => {
      const elementId = legacyWagerTermId(prefix, index);
      return box(elementId, { x: 0, y: 28 + index * 48, width: W - 48, height: 46 },
        text('', { x: 0, y: 0, width: 220, height: 44 }, 'lg-term-when', `${elementId}_When`)
        + text('', { x: 236, y: 0, width: W - 48 - 236, height: 44 }, 'lg-term-then', `${elementId}_Then`));
    }).join('');
    return box(`Legacy_${prefix}_Wager`, { x: 24, y: top, width: W - 48, height: 246 },
      text(LEGACY_COPY.notices.wagerHeading, { x: 0, y: 0, width: 120, height: 22 }, 'lg-heading', `Legacy_${prefix}_WagerHeading`)
      + text('', { x: 124, y: 1, width: W - 48 - 124, height: 22 }, 'lg-small', `Legacy_${prefix}_WagerIntro`)
      + terms
      + text('', { x: 0, y: 224, width: W - 48, height: 20 }, 'lg-small', `Legacy_${prefix}_WagerClosing`),
      'display: none;');
  };
  const noticeView = view('LegacyView_Notice',
    text('', { x: 24, y: 94, width: W - 48, height: 26 }, 'lg-card-title', 'Legacy_NoticeView_Title')
    + text('', { x: 24, y: 122, width: W - 48, height: 64 }, 'lg-body', 'Legacy_NoticeView_Body')
    + wager('NoticeView', 188)
    + fixed('Legacy_NoticeBack', footerLeft)
    + fixed('Legacy_NoticeAccept', footerRight, 'lg-btn-primary')
    + fixed('Legacy_NoticeAwaiting', footerRight));

  const acceptView = view('LegacyView_Accept',
    text(LEGACY_COPY.notices.acceptBody, { x: 24, y: 94, width: W - 48, height: 50 }, 'lg-body-large', 'Legacy_Accept_Body')
    + wager('Accept', 152)
    + fixed('Legacy_AcceptCancel', footerLeft)
    + fixed('Legacy_AcceptConfirm', footerRight, 'lg-btn-primary'));

  const awaitingView = view('LegacyView_Awaiting',
    text(LEGACY_COPY.awaitingBoard.body, { x: 24, y: 96, width: W - 48, height: 84 }, 'lg-body-large', 'Legacy_Awaiting_Body')
    + text(LEGACY_COPY.awaitingBoard.hint, { x: 24, y: 186, width: W - 48, height: 44 }, 'lg-body', 'Legacy_Awaiting_Hint')
    + text('', { x: 24, y: 238, width: W - 48, height: 44 }, 'lg-heading', 'Legacy_Awaiting_Readiness')
    + fixed('Legacy_AwaitingBack', footerLeft));

  const resetView = view('LegacyView_Reset',
    text(LEGACY_COPY.reset.body, { x: 24, y: 96, width: W - 48, height: 84 }, 'lg-body-large', 'Legacy_Reset_Body')
    + fixed('Legacy_ResetCancel', footerLeft)
    + fixed('Legacy_ResetConfirm', footerRight, 'lg-btn-danger'));

  const pauseView = view('LegacyView_Pause',
    text('', { x: 24, y: 120, width: W - 48, height: 64 }, 'lg-body-large lg-center', 'Legacy_Pause_Reason', `font-size: ${fontSize(20)};`)
    + text(QUEST_LEGACY_COPY.pause.hint, { x: 24, y: 200, width: W - 48, height: 60 }, 'lg-body lg-center', 'Legacy_Pause_Hint')
    + fixed('Legacy_PauseHome', footerLeft)
    + fixed('Legacy_Resume', footerRight, 'lg-btn-primary'));

  const panelSource = `<!-- Generated by scripts/generate-quest-legacy-ui.ts from shared Legacy content. Do not hand-edit. -->\n<style>${styles}</style>\n`
    + `<div${id('Legacy_Root')} class="lg-root">${band}${frame}${[
      loading, recovery, nationView, nameView, keyboardView, armsView, confirmView, raisedView, aftermathView, overviewView,
      hallView, musterView, nominateView, recordView, heraldView, noticeView, acceptView, awaitingView, resetView, pauseView,
    ].join('\n')}</div>\n`;

  const panelRequired = [
    'Legacy_Root', 'Legacy_Band', 'Legacy_BandSurface', 'Legacy_Title', 'Legacy_Subtitle', 'Legacy_Message',
    LEGACY_HOUSE_SHIELD_IDS.allied, LEGACY_HOUSE_SHIELD_IDS.rival, 'Legacy_Muster_EmptyPlace', 'Legacy_NoticeView_Wager', 'Legacy_Accept_Wager',
    ...LEGACY_VIEW_IDS, ...LEGACY_PANEL_ACTION_IDS, ...LEGACY_HERALDRY_IMAGE_IDS,
    ...NATION_ORDER.map(legacyNationId), ...LEGACY_LANDMARKS.map(legacyLandmarkButtonId),
    ...LEGACY_HERALDRY_PARTS.flatMap((part) => [legacyPartId(part), legacyPartPreviousId(part), `${legacyPartId(part)}_Value`]),
    ...LEGACY_KEY_ROWS.flat().map(legacyKeyId), ...LEGACY_KEY_ACTIONS.map(legacyKeyActionId), ...FILES.map(legacyFileId),
    ...(['conflicts', 'unresolved', 'ledger'] as const).map(legacyRecordTabId),
    ...LEGACY_FORMATION_RANKS.flatMap((rank) => FILES.map((file) => legacyFormationCellId(`${file}${rank}`))),
    ...LEGACY_FORMATION_LEGEND.flatMap((group) => [`Legacy_Legend_${group}`, `Legacy_Legend_${group}_Swatch`]),
    ...(['NoticeView', 'Accept'] as const).flatMap((prefix) => Array.from({ length: LEGACY_WAGER_TERM_SLOTS }, (_, index) => `${legacyWagerTermId(prefix, index)}_Then`)),
    ...Array.from({ length: LEGACY_SUGGESTION_SLOTS }, (_, index) => `Legacy_Suggestion_${index}`),
    ...Array.from({ length: 4 }, (_, index) => `Legacy_Preset_${index}`),
    ...Array.from({ length: LEGACY_MEMBER_SLOTS }, (_, index) => `Legacy_Member_${index}`),
    ...Array.from({ length: LEGACY_LEDGER_ROWS }, (_, index) => `Legacy_Muster_Row_${index}`),
    ...Array.from({ length: LEGACY_RECORD_PAGE }, (_, index) => `Legacy_Record_Entry_${index}`),
    ...Array.from({ length: LEGACY_NOTICE_PAGE }, (_, index) => `Legacy_Notice_${index}`),
    ...Array.from({ length: LEGACY_AFTERMATH_SLOTS }, (_, index) => `Legacy_Aftermath_${index}`),
    ...Array.from({ length: LEGACY_HONOUR_SLOTS }, (_, index) => `Legacy_Hall_Honour_${index}`),
  ];
  for (const elementId of panelRequired) if (!ids.has(elementId)) throw new Error(`Missing required Quest Legacy UI ID: ${elementId}`);
  const panelElements = ids.size;
  documentTargets.push({ scale: layout.authoredScale, distance: layout.nominalPanelDistance, touch: false, targets: hitTargets });

  // The touch tray is a separate document and scene node, so it keeps its own id set and hit targets.
  ids = new Set<string>();
  hitTargets = [];
  const TW = layout.tray.width;
  const navButton = (elementId: string, label: string, index: number): string =>
    action(elementId, label, { x: 8 + index * 137, y: 76, width: 132, height: 56 }, 'lg-btn', 'lg-nav-label');
  const dockSource = `<!-- Generated by scripts/generate-quest-legacy-ui.ts from shared Legacy content. Do not hand-edit. -->\n<style>${styles}</style>\n`
    + `<div${id('LegacyDock_Root')} class="lg-dock">`
    // Back and the primary action mirror the reading panel's current view; their labels are set from it.
    + action('Legacy_DockBack', '', { x: 8, y: 8, width: (TW - 24) / 2, height: 60 })
    + action('Legacy_DockPrimary', '', { x: 16 + (TW - 24) / 2, y: 8, width: (TW - 24) / 2, height: 60 }, 'lg-btn-primary')
    + navButton('Legacy_DockHome', QUEST_LEGACY_COPY.dock.home, 0)
    + navButton('Legacy_DockRecenter', QUEST_LEGACY_COPY.dock.recenter, 1)
    + navButton('Legacy_DockPause', QUEST_LEGACY_COPY.dock.pause, 2)
    + navButton('Legacy_DockExit', QUEST_LEGACY_COPY.dock.exit, 3)
    + text('', { x: 12, y: 140, width: 300, height: 24 }, 'lg-band', 'Legacy_DockLabel')
    + text('', { x: 316, y: 140, width: TW - 328, height: 24 }, 'lg-small', 'Legacy_DockStatus', 'text-align: right;')
    + '</div>\n';
  for (const elementId of ['LegacyDock_Root', ...LEGACY_DOCK_ACTION_IDS, 'Legacy_DockLabel', 'Legacy_DockStatus', 'Legacy_DockBack_Label', 'Legacy_DockPrimary_Label']) {
    if (!ids.has(elementId)) throw new Error(`Missing required Quest Legacy dock ID: ${elementId}`);
  }
  const dockElements = ids.size;
  documentTargets.push({ scale: layout.trayScale, distance: layout.nominalTrayDistance, touch: true, targets: hitTargets });

  // Comfort gates: every control is a comfortable hand target at its document's viewing distance (and a
  // fingertip target on the tray), and no readable copy is set below the spatial minimum on either document.
  let smallestHitTarget = Number.POSITIVE_INFINITY;
  let smallestHitDegrees = Number.POSITIVE_INFINITY;
  let smallestTouchMetres = Number.POSITIVE_INFINITY;
  let targetCount = 0;
  for (const document of documentTargets) {
    for (const target of document.targets) {
      targetCount += 1;
      const smallest = Math.min(target.width, target.height);
      const angle = degreesOf(smallest, document.scale, document.distance);
      smallestHitTarget = Math.min(smallestHitTarget, smallest);
      smallestHitDegrees = Math.min(smallestHitDegrees, angle);
      if (angle < layout.minimumHitDegrees) {
        throw new Error(`Quest Legacy control ${target.id} is ${target.width}x${target.height} (${angle.toFixed(2)} degrees); the minimum is ${layout.minimumHitDegrees}.`);
      }
      if (document.scale === layout.authoredScale && smallest < layout.minimumHitSize) {
        throw new Error(`Quest Legacy control ${target.id} is ${target.width}x${target.height}; the minimum is ${layout.minimumHitSize}.`);
      }
      if (document.touch) {
        const metres = smallest / 100 * document.scale;
        smallestTouchMetres = Math.min(smallestTouchMetres, metres);
        if (metres < layout.minimumTouchMetres) throw new Error(`Quest Legacy tray control ${target.id} is ${(metres * 100).toFixed(1)} cm; fingertips need ${layout.minimumTouchMetres * 100} cm.`);
      }
    }
  }
  let smallestTextDegrees = Number.POSITIVE_INFINITY;
  for (const size of fontSizes) {
    if (size < layout.minimumFontSize) throw new Error(`Quest Legacy font size ${size} is below the spatial minimum ${layout.minimumFontSize}.`);
    for (const document of documentTargets) {
      const angle = degreesOf(size, document.scale, document.distance);
      smallestTextDegrees = Math.min(smallestTextDegrees, angle);
      if (angle < layout.minimumTextDegrees) throw new Error(`Quest Legacy text of ${size} units reads at ${angle.toFixed(2)} degrees; the minimum is ${layout.minimumTextDegrees}.`);
    }
  }
  // An empty span is instantiated without a text node, so text set on it later never renders. Controls are
  // containers whose looks are set from code; a kit <button> or a :hover rule would bring back conditional styling.
  for (const source of [panelSource, dockSource]) {
    const empty = /<span id="([^"]+)"[^>]*>\s*<\/span>/u.exec(source);
    if (empty) throw new Error(`Quest Legacy text ${empty[1]} is empty; live texts need a placeholder to render.`);
    if (/<button\b|:hover/u.test(source)) throw new Error('Quest Legacy controls must not use <button> or :hover styles.');
  }

  const outputs: [string, string][] = [
    [destinations.panel ? resolve(destinations.panel) : resolve(projectRoot, 'main-game-vr/public', layout.panelDocumentPath), panelSource],
    [destinations.dock ? resolve(destinations.dock) : resolve(projectRoot, 'main-game-vr/public', layout.dockDocumentPath), dockSource],
  ];
  for (const [output, source] of outputs) {
    await mkdir(dirname(output), { recursive: true });
    let previous = '';
    try { previous = await readFile(output, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous !== source) await writeFile(output, source);
  }
  const report: LegacyUIReport = {
    panelElements, dockElements, hitTargets: targetCount, smallestHitTarget,
    smallestHitDegrees: Number(smallestHitDegrees.toFixed(2)), smallestTextDegrees: Number(smallestTextDegrees.toFixed(2)),
    smallestTouchMetres: Number(smallestTouchMetres.toFixed(3)),
  };
  console.log(`Generated Quest My Legacy panels: ${panelElements} + ${dockElements} stable native elements, ${targetCount} controls of at least ${report.smallestHitDegrees} degrees (tray: ${(report.smallestTouchMetres * 100).toFixed(1)} cm), text of at least ${report.smallestTextDegrees} degrees.`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void generateQuestLegacyUI().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
