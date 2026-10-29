/**
 * Native, live UIKitML panels for the Quest My Legacy destination: the primary
 * world-space panel (founding, landmark inspectors, notices, pause) and the
 * dock (Return to Home, Recenter, Pause, Exit VR). Generated deterministically
 * from shared Legacy content and the Quest Legacy UI contract; do not hand-edit
 * public/ui/legacy.uikitml or public/ui/legacy-dock.uikitml.
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
import {
  LEGACY_AFTERMATH_SLOTS, LEGACY_DOCK_ACTION_IDS, LEGACY_UI_COLORS, LEGACY_HERALDRY_IMAGE_IDS, LEGACY_HERALDRY_PARTS, LEGACY_HONOUR_SLOTS,
  LEGACY_KEY_ACTIONS, LEGACY_KEY_ROWS, LEGACY_MEMBER_SLOTS, LEGACY_NOTICE_PAGE, LEGACY_PANEL_ACTION_IDS, LEGACY_RECORD_PAGE,
  LEGACY_LIVE_TEXT, LEGACY_SUGGESTION_SLOTS, LEGACY_UI_LAYOUT, LEGACY_VIEW_IDS, legacyFileId, legacyKeyActionId, legacyKeyId,
  legacyLandmarkButtonId, legacyNationId, legacyPartId, legacyPartPreviousId,
} from '../main-game-vr/src/legacy/legacy-ui-contract.ts';
import type { LegacyHeraldryPart, LegacyKeyAction } from '../main-game-vr/src/legacy/legacy-ui-contract.ts';
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
}

export async function generateQuestLegacyUI(destinations: { panel?: string; dock?: string } = {}): Promise<LegacyUIReport> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const c = LEGACY_UI_COLORS;
  const layout = LEGACY_UI_LAYOUT;
  const W = layout.panel.width;
  const H = layout.panel.height;
  let ids = new Set<string>();
  const hitTargets: { id: string; width: number; height: number }[] = [];
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
  /**
   * The live heraldry raster replaces this source as a texture at runtime. UIKitML requires a static
   * source, so each preview starts as one transparent pixel; its box matches the 1:1.5 banner aspect.
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
    .lg-dock { width: ${layout.dock.width}; height: ${layout.dock.height}; position-type: relative; overflow: hidden; font-family: 'Barlow'; color: ${c.text}; background-color: ${c.surface}; border-color: ${c.surfaceBorder}; border-width: 1.5; border-radius: 8; }
    .lg-view { position-type: absolute; position-left: 0; position-top: 0; width: ${W}; height: ${H}; }
    .lg-title { font-size: ${fontSize(26)}; font-weight: 600; color: ${c.heading}; line-height: 1.2; }
    .lg-subtitle { font-size: ${fontSize(14)}; color: ${c.secondary}; line-height: 1.3; }
    .lg-band { font-size: ${fontSize(14)}; font-weight: 600; color: ${c.bandText}; line-height: 1.3; }
    .lg-message { font-size: ${fontSize(14)}; color: ${c.warning}; line-height: 1.3; }
    .lg-heading { font-size: ${fontSize(15)}; font-weight: 600; color: ${c.accent}; line-height: 1.3; }
    .lg-label { font-size: ${fontSize(14)}; color: ${c.accent}; line-height: 1.3; }
    .lg-body { font-size: ${fontSize(15)}; color: ${c.text}; line-height: 1.35; }
    .lg-body-large { font-size: ${fontSize(17)}; color: ${c.text}; line-height: 1.4; }
    .lg-small { font-size: ${fontSize(14)}; color: ${c.secondary}; line-height: 1.3; }
    .lg-name { font-size: ${fontSize(28)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-strong { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.text}; line-height: 1.3; }
    .lg-card-title { font-size: ${fontSize(20)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-btn { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.buttonBorder}; border-width: 1.5; background-color: ${c.button}; color: ${c.text}; cursor: pointer; }
    .lg-btn-primary { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.primaryBorder}; border-width: 2; background-color: ${c.primary}; color: ${c.text}; cursor: pointer; }
    .lg-btn-danger { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 5; border-color: ${c.dangerBorder}; border-width: 1.5; background-color: ${c.danger}; color: ${c.text}; cursor: pointer; }
    .lg-btn-label { font-size: ${fontSize(17)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.2; }
    .lg-key-label { font-size: ${fontSize(22)}; font-weight: 600; color: ${c.text}; text-align: center; line-height: 1.1; }
    .lg-cell-label { font-size: ${fontSize(14)}; color: ${c.secondary}; line-height: 1.2; }
    .lg-cell-value { font-size: ${fontSize(16)}; font-weight: 600; color: ${c.text}; line-height: 1.2; }
    .lg-center { text-align: center; }
    .${LEGACY_LIVE_TEXT.className} { pointer-events: none; }
  `;

  // Shared frame: development/guest band, title, subtitle and the message line above the footer.
  const frame = text('', { x: 24, y: 4, width: W - 48, height: 20 }, 'lg-band', 'Legacy_Band')
    + text(LEGACY_COPY.title, { x: 24, y: 30, width: W - 48, height: 34 }, 'lg-title', 'Legacy_Title')
    + text('', { x: 24, y: 66, width: W - 48, height: 20 }, 'lg-subtitle', 'Legacy_Subtitle')
    + text('', { x: 24, y: 404, width: W - 48, height: 22 }, 'lg-message', 'Legacy_Message');
  const footerLeft: Rect = { x: 24, y: 430, width: 200, height: 50 };
  const footerMiddle: Rect = { x: 260, y: 430, width: 200, height: 50 };
  const footerRight: Rect = { x: 496, y: 430, width: 200, height: 50 };
  const band = node('div', 'Legacy_BandSurface', '', '', `${rect({ x: 0, y: 0, width: W, height: 26 })} background-color: ${c.band}; display: none; pointer-events: none;`);

  const loading = view('LegacyView_Loading',
    text(QUEST_LEGACY_COPY.loading.body, { x: 24, y: 94, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Loading_Body'));

  const recovery = view('LegacyView_Recovery',
    text(LEGACY_COPY.invalidSave.body, { x: 24, y: 94, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Recovery_Body')
    + text(LEGACY_COPY.invalidSave.startNewNote, { x: 24, y: 160, width: W - 48, height: 40 }, 'lg-body', 'Legacy_Recovery_Note')
    + text('', { x: 24, y: 210, width: W - 48, height: 60 }, 'lg-small', 'Legacy_Recovery_Detail')
    + action('Legacy_RecoveryHome', LEGACY_COPY.backToHome, footerLeft)
    + action('Legacy_RecoveryGuest', LEGACY_COPY.invalidSave.guest, footerMiddle)
    + action('Legacy_RecoveryNew', LEGACY_COPY.invalidSave.startNew, footerRight, 'lg-btn-primary'));

  const nationCards = NATION_ORDER.map((nationId, index) => {
    const nation = NATIONS[nationId];
    const elementId = legacyNationId(nationId);
    const r = { x: 24 + (index % 2) * 342, y: 140 + Math.floor(index / 2) * 86, width: 330, height: 80 };
    // Buttons centre their text by default; a card reads as one left-aligned block with its status on the right.
    return button(elementId, r,
      text(nation.name, { x: 14, y: 10, width: 200, height: 26 }, 'lg-card-title', `${elementId}_Title`, 'text-align: left;')
      + text('', { x: 196, y: 13, width: 120, height: 20 }, 'lg-label', `${elementId}_Status`, 'text-align: right;')
      + text(nation.epithet, { x: 14, y: 44, width: 302, height: 22 }, 'lg-body', `${elementId}_Epithet`, 'text-align: left;'));
  }).join('');
  const nationView = view('LegacyView_Nation',
    text(LEGACY_COPY.founding.intro, { x: 24, y: 94, width: W - 48, height: 40 }, 'lg-body', 'Legacy_Nation_Intro')
    + nationCards
    + text(NATIONS[NATION_ORDER[0]].summary, { x: 24, y: 316, width: W - 48, height: 84 }, 'lg-body', 'Legacy_Nation_Summary')
    + action('Legacy_FoundingHome', LEGACY_COPY.founding.cancel, footerLeft)
    + action('Legacy_NationNext', LEGACY_COPY.founding.next, footerRight, 'lg-btn-primary'));

  const nameBox = box('Legacy_Name_Box', { x: 24, y: 118, width: W - 48, height: 54 },
    text('', { x: 0, y: 12, width: W - 48, height: 32 }, 'lg-name lg-center', 'Legacy_Name_Value'),
    `background-color: ${c.inset}; border-color: ${c.buttonBorder}; border-width: 1; border-radius: 5;`);
  const suggestions = Array.from({ length: LEGACY_SUGGESTION_SLOTS }, (_, index) => {
    const elementId = `Legacy_Suggestion_${index}`;
    return action(elementId, '', { x: 24 + (index % 2) * 342, y: 200 + Math.floor(index / 2) * 60, width: 330, height: 54 });
  }).join('');
  const nameView = view('LegacyView_Name',
    text(LEGACY_COPY.founding.steps[1].hint, { x: 24, y: 94, width: W - 48, height: 20 }, 'lg-body', 'Legacy_Name_Hint')
    + nameBox
    + text(LEGACY_COPY.founding.suggestionsLabel, { x: 24, y: 178, width: W - 48, height: 20 }, 'lg-label', 'Legacy_Name_SuggestionsLabel')
    + suggestions
    + action('Legacy_MoreNames', LEGACY_COPY.founding.moreSuggestions, { x: 24, y: 320, width: 330, height: 50 })
    + action('Legacy_OpenKeyboard', QUEST_LEGACY_COPY.typeName, { x: 366, y: 320, width: 330, height: 50 })
    + text(LEGACY_COPY.founding.nameRules, { x: 24, y: 376, width: W - 48, height: 20 }, 'lg-small', 'Legacy_Name_Rules')
    + action('Legacy_NameBack', LEGACY_COPY.founding.back, footerLeft)
    + action('Legacy_NameNext', LEGACY_COPY.founding.next, footerRight, 'lg-btn-primary'));

  const KEY = { width: 58, height: 50, gap: 6 };
  const keyRows = LEGACY_KEY_ROWS.map((row, rowIndex) => {
    const rowWidth = row.length * KEY.width + (row.length - 1) * KEY.gap;
    const left = (W - rowWidth) / 2;
    return row.map((key, index) => button(legacyKeyId(key), { x: left + index * (KEY.width + KEY.gap), y: 152 + rowIndex * 56, width: KEY.width, height: KEY.height },
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
    const r = { x: actionLeft, y: 152 + LEGACY_KEY_ROWS.length * 56, width: actionWidths[keyAction], height: KEY.height };
    actionLeft += actionWidths[keyAction] + KEY.gap;
    return action(legacyKeyActionId(keyAction), actionLabels[keyAction], r);
  }).join('');
  const keyboardView = view('LegacyView_Keyboard',
    box('Legacy_Keyboard_Box', { x: 24, y: 94, width: W - 48, height: 52 },
      text('', { x: 0, y: 11, width: W - 48, height: 32 }, 'lg-name lg-center', 'Legacy_Keyboard_Value'),
      `background-color: ${c.inset}; border-color: ${c.buttonBorder}; border-width: 1; border-radius: 5;`)
    + keyRows + keyActions
    + text(LEGACY_COPY.founding.nameRules, { x: 24, y: 376, width: W - 48, height: 20 }, 'lg-small', 'Legacy_Keyboard_Hint')
    + action('Legacy_KeyboardCancel', QUEST_LEGACY_COPY.keyboard.cancel, footerLeft)
    + action('Legacy_KeyboardDone', QUEST_LEGACY_COPY.keyboard.done, footerRight, 'lg-btn-primary'));

  const presets = Array.from({ length: 4 }, (_, index) =>
    action(`Legacy_Preset_${index}`, '', { x: 190 + index * 128, y: 94, width: 121, height: 50 })).join('');
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
    const y = 152 + row * 56;
    const valueId = legacyPartId(part);
    return button(legacyPartPreviousId(part), { x, y, width: 50, height: 50 }, text('<', { x: 0, y: 12, width: 50, height: 26 }, 'lg-key-label'))
      + button(valueId, { x: x + 56, y, width: 194, height: 50 },
        text(partLabels[part], { x: 10, y: 5, width: 160, height: 18 }, 'lg-cell-label', `${valueId}_Name`)
        + text('', { x: 10, y: 24, width: 160, height: 22 }, 'lg-cell-value', `${valueId}_Value`)
        + text('>', { x: 166, y: 13, width: 22, height: 24 }, 'lg-key-label'));
  }).join('');
  const armsView = view('LegacyView_Arms',
    image('Legacy_Arms_Preview', { x: 24, y: 94, width: 150, height: 225 })
    + text('', { x: 24, y: 324, width: 150, height: 76 }, 'lg-small', 'Legacy_Arms_Blazon')
    + presets + cyclers
    + text('', { x: 190, y: 320, width: 250, height: 80 }, 'lg-small', 'Legacy_Arms_Advice')
    + text(LEGACY_COPY.founding.advisoryNote, { x: 446, y: 376, width: 250, height: 20 }, 'lg-small', 'Legacy_Arms_AdviceNote')
    + action('Legacy_ArmsBack', LEGACY_COPY.founding.back, footerLeft)
    + action('Legacy_ArmsNext', LEGACY_COPY.founding.next, footerRight, 'lg-btn-primary'));

  const confirmView = view('LegacyView_Confirm',
    image('Legacy_Confirm_Preview', { x: 24, y: 94, width: 150, height: 225 })
    + text('', { x: 190, y: 94, width: 506, height: 36 }, 'lg-name', 'Legacy_Confirm_Name')
    + text('', { x: 190, y: 134, width: 506, height: 22 }, 'lg-body', 'Legacy_Confirm_Nation')
    + text('', { x: 190, y: 160, width: 506, height: 40 }, 'lg-body', 'Legacy_Confirm_Blazon')
    + text(QUEST_LEGACY_COPY.membersTitle, { x: 190, y: 206, width: 506, height: 20 }, 'lg-label', 'Legacy_Confirm_MembersTitle')
    + text('', { x: 190, y: 228, width: 506, height: 62 }, 'lg-body', 'Legacy_Confirm_Members')
    + text('', { x: 190, y: 296, width: 506, height: 62 }, 'lg-body', 'Legacy_Confirm_Body')
    + action('Legacy_ConfirmBack', LEGACY_COPY.founding.back, footerLeft)
    + action('Legacy_ConfirmRaise', LEGACY_COPY.founding.confirmAction, footerRight, 'lg-btn-primary'));

  const aftermath = Array.from({ length: LEGACY_AFTERMATH_SLOTS }, (_, index) => {
    const elementId = `Legacy_Aftermath_${index}`;
    // Three body lines; longer messages are shortened by the view model and kept whole in the War Record.
    return box(elementId, { x: 24 + index * 342, y: 94, width: 330, height: 112 },
      text('', { x: 12, y: 8, width: 306, height: 18 }, 'lg-label', `${elementId}_Heading`)
      + text('', { x: 12, y: 28, width: 306, height: 22 }, 'lg-strong', `${elementId}_Title`)
      + text('', { x: 12, y: 52, width: 306, height: 56 }, 'lg-small', `${elementId}_Body`),
      `background-color: ${c.card}; border-color: ${c.primaryBorder}; border-width: 1; border-radius: 5; display: none;`);
  }).join('');
  const landmarkButtons = LEGACY_LANDMARKS.map((landmark, index) => {
    const elementId = legacyLandmarkButtonId(landmark);
    return button(elementId, { x: 24 + (index % 2) * 342, y: 214 + Math.floor(index / 2) * 88, width: 330, height: 82 },
      text(LEGACY_COPY.landmarks[landmark].title, { x: 14, y: 8, width: 302, height: 26 }, 'lg-card-title', `${elementId}_Title`)
      + text(LEGACY_COPY.landmarks[landmark].action, { x: 14, y: 38, width: 302, height: 38 }, 'lg-small', `${elementId}_Status`));
  }).join('');
  const overviewView = view('LegacyView_Overview',
    text(LEGACY_COPY.tagline, { x: 24, y: 100, width: W - 48, height: 22 }, 'lg-heading', 'Legacy_Overview_Tagline')
    + text(QUEST_LEGACY_COPY.overviewIntro, { x: 24, y: 128, width: W - 48, height: 44 }, 'lg-body', 'Legacy_Overview_Intro')
    + aftermath + landmarkButtons
    + action('Legacy_ResetOpen', QUEST_LEGACY_COPY.dissolve, footerLeft, 'lg-btn-danger')
    + action('Legacy_AftermathDismiss', LEGACY_COPY.aftermath.dismiss, footerRight, 'lg-btn-primary'));

  const honours = Array.from({ length: LEGACY_HONOUR_SLOTS }, (_, index) =>
    text('', { x: 160, y: 266 + index * 22, width: 536, height: 20 }, 'lg-body', `Legacy_Hall_Honour_${index}`)).join('');
  const hallView = view('LegacyView_Hall',
    image('Legacy_Hall_Preview', { x: 24, y: 94, width: 120, height: 180 })
    + text('', { x: 160, y: 94, width: 536, height: 32 }, 'lg-name', 'Legacy_Hall_Name')
    + text('', { x: 160, y: 128, width: 536, height: 20 }, 'lg-body', 'Legacy_Hall_Polity')
    + text('', { x: 160, y: 150, width: 536, height: 20 }, 'lg-body', 'Legacy_Hall_Motto')
    + text('', { x: 160, y: 174, width: 536, height: 20 }, 'lg-body', 'Legacy_Hall_Rank')
    + text('', { x: 160, y: 198, width: 536, height: 40 }, 'lg-small', 'Legacy_Hall_Blazon')
    + text(QUEST_LEGACY_COPY.honoursTitle, { x: 160, y: 244, width: 536, height: 20 }, 'lg-heading', 'Legacy_Hall_HonoursTitle')
    + honours
    + text(LEGACY_COPY.empty.honours, { x: 160, y: 266, width: 536, height: 40 }, 'lg-small', 'Legacy_Hall_HonoursEmpty')
    + text('', { x: 24, y: 358, width: W - 48, height: 20 }, 'lg-small', 'Legacy_Hall_Allied')
    + text('', { x: 24, y: 380, width: W - 48, height: 20 }, 'lg-small', 'Legacy_Hall_Rival')
    + action('Legacy_HallBack', QUEST_LEGACY_COPY.back, footerLeft));

  const members = Array.from({ length: LEGACY_MEMBER_SLOTS }, (_, index) => {
    const elementId = `Legacy_Member_${index}`;
    return button(elementId, { x: 360, y: 114 + index * 54, width: 336, height: 50 },
      text('', { x: 12, y: 5, width: 312, height: 22 }, 'lg-strong', `${elementId}_Name`)
      + text('', { x: 12, y: 27, width: 312, height: 18 }, 'lg-cell-label', `${elementId}_Status`));
  }).join('');
  const files = FILES.map((file, index) => {
    const elementId = legacyFileId(file);
    return button(elementId, { x: 360 + (index % 5) * 69, y: 298, width: 60, height: 50 },
      text(LEGACY_COPY.inspector.fileName(file), { x: 0, y: 14, width: 60, height: 22 }, 'lg-cell-value lg-center', `${elementId}_Label`), 'lg-btn', 'display: none;');
  }).join('');
  const musterView = view('LegacyView_Muster',
    text(LEGACY_COPY.inspector.nominated, { x: 24, y: 94, width: 320, height: 18 }, 'lg-label', 'Legacy_Muster_RepHeading')
    + text('', { x: 24, y: 114, width: 320, height: 28 }, 'lg-card-title', 'Legacy_Muster_RepName')
    + text('', { x: 24, y: 144, width: 320, height: 20 }, 'lg-body', 'Legacy_Muster_RepEpithet')
    + text('', { x: 24, y: 168, width: 320, height: 22 }, 'lg-heading', 'Legacy_Muster_RepCondition')
    + text('', { x: 24, y: 192, width: 320, height: 56 }, 'lg-small', 'Legacy_Muster_RepNote')
    + text('', { x: 24, y: 250, width: 320, height: 20 }, 'lg-body', 'Legacy_Muster_RepFile')
    + text(LEGACY_COPY.inspector.formationNote, { x: 24, y: 274, width: 320, height: 74 }, 'lg-small', 'Legacy_Muster_Formation')
    + text(LEGACY_COPY.inspector.futureAppointments, { x: 24, y: 350, width: 320, height: 40 }, 'lg-small', 'Legacy_Muster_Future')
    + text(LEGACY_COPY.inspector.chooseMember, { x: 360, y: 94, width: 336, height: 18 }, 'lg-label', 'Legacy_Muster_MembersLabel')
    + members
    + text(LEGACY_COPY.inspector.chooseFile, { x: 360, y: 278, width: 336, height: 18 }, 'lg-label', 'Legacy_Muster_FilesLabel')
    + files
    + text('', { x: 360, y: 354, width: 336, height: 44 }, 'lg-small', 'Legacy_Muster_Claims')
    + action('Legacy_MusterBack', QUEST_LEGACY_COPY.back, footerLeft)
    + action('Legacy_MusterNominate', LEGACY_COPY.inspector.nominate, footerRight, 'lg-btn-primary'));

  const pager = (prefix: 'Record' | 'Herald'): string =>
    action(`Legacy_${prefix}Prev`, QUEST_LEGACY_COPY.previous, { x: 376, y: 430, width: 120, height: 50 })
    + text('', { x: 500, y: 444, width: 72, height: 22 }, 'lg-body lg-center', `Legacy_${prefix}_Page`)
    + action(`Legacy_${prefix}Next`, QUEST_LEGACY_COPY.next, { x: 576, y: 430, width: 120, height: 50 });
  const entries = Array.from({ length: LEGACY_RECORD_PAGE }, (_, index) => {
    const elementId = `Legacy_Record_Entry_${index}`;
    // Kind and day share the title row, leaving three full-width lines so every entry reads whole.
    return box(elementId, { x: 24, y: 94 + index * 98, width: W - 48, height: 92 },
      text('', { x: 12, y: 6, width: 440, height: 24 }, 'lg-strong', `${elementId}_Title`)
      + text('', { x: 460, y: 8, width: W - 72 - 448, height: 20 }, 'lg-label', `${elementId}_Kind`, 'text-align: right;')
      + text('', { x: 12, y: 32, width: W - 72, height: 56 }, 'lg-small', `${elementId}_Body`),
      `background-color: ${c.card}; border-radius: 5; display: none;`);
  }).join('');
  const recordView = view('LegacyView_Record',
    entries
    + text(LEGACY_COPY.empty.chronicle, { x: 24, y: 94, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Record_Empty')
    + action('Legacy_RecordBack', QUEST_LEGACY_COPY.back, { x: 24, y: 430, width: 180, height: 50 })
    + pager('Record'));

  const notices = Array.from({ length: LEGACY_NOTICE_PAGE }, (_, index) => {
    const elementId = `Legacy_Notice_${index}`;
    return button(elementId, { x: 24, y: 94 + index * 76, width: W - 48, height: 70 },
      text('', { x: 14, y: 6, width: 440, height: 18 }, 'lg-label', `${elementId}_Kind`)
      + text('', { x: 460, y: 6, width: 198, height: 18 }, 'lg-cell-label', `${elementId}_Status`, 'text-align: right;')
      + text('', { x: 14, y: 26, width: 644, height: 22 }, 'lg-strong', `${elementId}_Title`)
      + text('', { x: 14, y: 48, width: 644, height: 18 }, 'lg-cell-label', `${elementId}_From`), 'lg-btn', 'display: none;');
  }).join('');
  const heraldView = view('LegacyView_Herald',
    notices
    + text(LEGACY_COPY.empty.notices, { x: 24, y: 94, width: W - 48, height: 60 }, 'lg-body-large', 'Legacy_Herald_Empty')
    + action('Legacy_HeraldBack', QUEST_LEGACY_COPY.back, { x: 24, y: 430, width: 180, height: 50 })
    + pager('Herald'));

  const noticeView = view('LegacyView_Notice',
    text('', { x: 24, y: 94, width: W - 48, height: 18 }, 'lg-label', 'Legacy_NoticeView_Kind')
    + text('', { x: 24, y: 114, width: W - 48, height: 26 }, 'lg-card-title', 'Legacy_NoticeView_Title')
    + text('', { x: 24, y: 142, width: W - 48, height: 18 }, 'lg-small', 'Legacy_NoticeView_From')
    + text('', { x: 24, y: 164, width: W - 48, height: 62 }, 'lg-body', 'Legacy_NoticeView_Body')
    + text(LEGACY_COPY.notices.wagerHeading, { x: 24, y: 230, width: W - 48, height: 20 }, 'lg-heading', 'Legacy_NoticeView_WagerHeading')
    + text('', { x: 24, y: 252, width: W - 48, height: 148 }, 'lg-small', 'Legacy_NoticeView_Wager')
    + action('Legacy_NoticeBack', QUEST_LEGACY_COPY.back, footerLeft)
    + action('Legacy_NoticeAccept', LEGACY_COPY.notices.accept, footerRight, 'lg-btn-primary')
    + action('Legacy_NoticeAwaiting', QUEST_LEGACY_COPY.awaitingButton, footerRight));

  const acceptView = view('LegacyView_Accept',
    text(LEGACY_COPY.notices.acceptBody, { x: 24, y: 94, width: W - 48, height: 46 }, 'lg-body-large', 'Legacy_Accept_Body')
    + text(LEGACY_COPY.notices.wagerHeading, { x: 24, y: 146, width: W - 48, height: 20 }, 'lg-heading', 'Legacy_Accept_WagerHeading')
    + text('', { x: 24, y: 168, width: W - 48, height: 150 }, 'lg-small', 'Legacy_Accept_Wager')
    + action('Legacy_AcceptCancel', QUEST_LEGACY_COPY.keyboard.cancel, footerLeft)
    + action('Legacy_AcceptConfirm', LEGACY_COPY.notices.accept, footerRight, 'lg-btn-primary'));

  const awaitingView = view('LegacyView_Awaiting',
    text(LEGACY_COPY.awaitingBoard.body, { x: 24, y: 94, width: W - 48, height: 80 }, 'lg-body-large', 'Legacy_Awaiting_Body')
    + text(LEGACY_COPY.awaitingBoard.hint, { x: 24, y: 182, width: W - 48, height: 44 }, 'lg-body', 'Legacy_Awaiting_Hint')
    + text('', { x: 24, y: 234, width: W - 48, height: 44 }, 'lg-heading', 'Legacy_Awaiting_Readiness')
    + action('Legacy_AwaitingBack', QUEST_LEGACY_COPY.back, footerLeft));

  const resetView = view('LegacyView_Reset',
    text(LEGACY_COPY.reset.body, { x: 24, y: 94, width: W - 48, height: 80 }, 'lg-body-large', 'Legacy_Reset_Body')
    + action('Legacy_ResetCancel', LEGACY_COPY.reset.cancel, footerLeft)
    + action('Legacy_ResetConfirm', LEGACY_COPY.reset.confirm, footerRight, 'lg-btn-danger'));

  const pauseView = view('LegacyView_Pause',
    text('', { x: 24, y: 120, width: W - 48, height: 64 }, 'lg-body-large lg-center', 'Legacy_Pause_Reason', `font-size: ${fontSize(20)};`)
    + text(QUEST_LEGACY_COPY.pause.hint, { x: 24, y: 200, width: W - 48, height: 60 }, 'lg-body lg-center', 'Legacy_Pause_Hint')
    + action('Legacy_PauseHome', QUEST_LEGACY_COPY.pause.home, footerLeft)
    + action('Legacy_Resume', QUEST_LEGACY_COPY.pause.resume, footerRight, 'lg-btn-primary'));

  const panelSource = `<!-- Generated by scripts/generate-quest-legacy-ui.ts from shared Legacy content. Do not hand-edit. -->\n<style>${styles}</style>\n`
    + `<div${id('Legacy_Root')} class="lg-root">${band}${frame}${[
      loading, recovery, nationView, nameView, keyboardView, armsView, confirmView, overviewView,
      hallView, musterView, recordView, heraldView, noticeView, acceptView, awaitingView, resetView, pauseView,
    ].join('\n')}</div>\n`;

  const panelRequired = [
    'Legacy_Root', 'Legacy_Band', 'Legacy_BandSurface', 'Legacy_Title', 'Legacy_Subtitle', 'Legacy_Message',
    ...LEGACY_VIEW_IDS, ...LEGACY_PANEL_ACTION_IDS, ...LEGACY_HERALDRY_IMAGE_IDS,
    ...NATION_ORDER.map(legacyNationId), ...LEGACY_LANDMARKS.map(legacyLandmarkButtonId),
    ...LEGACY_HERALDRY_PARTS.flatMap((part) => [legacyPartId(part), legacyPartPreviousId(part), `${legacyPartId(part)}_Value`]),
    ...LEGACY_KEY_ROWS.flat().map(legacyKeyId), ...LEGACY_KEY_ACTIONS.map(legacyKeyActionId), ...FILES.map(legacyFileId),
    ...Array.from({ length: LEGACY_SUGGESTION_SLOTS }, (_, index) => `Legacy_Suggestion_${index}`),
    ...Array.from({ length: 4 }, (_, index) => `Legacy_Preset_${index}`),
    ...Array.from({ length: LEGACY_MEMBER_SLOTS }, (_, index) => `Legacy_Member_${index}`),
    ...Array.from({ length: LEGACY_RECORD_PAGE }, (_, index) => `Legacy_Record_Entry_${index}`),
    ...Array.from({ length: LEGACY_NOTICE_PAGE }, (_, index) => `Legacy_Notice_${index}`),
    ...Array.from({ length: LEGACY_AFTERMATH_SLOTS }, (_, index) => `Legacy_Aftermath_${index}`),
    ...Array.from({ length: LEGACY_HONOUR_SLOTS }, (_, index) => `Legacy_Hall_Honour_${index}`),
  ];
  for (const elementId of panelRequired) if (!ids.has(elementId)) throw new Error(`Missing required Quest Legacy UI ID: ${elementId}`);
  const panelElements = ids.size;

  // The dock is a separate document and scene node, so it keeps its own id set.
  ids = new Set<string>();
  const dockButton = (elementId: string, label: string, index: number): string =>
    action(elementId, label, { x: 12 + index * 177, y: 8, width: 165, height: 56 });
  const dockSource = `<!-- Generated by scripts/generate-quest-legacy-ui.ts from shared Legacy content. Do not hand-edit. -->\n<style>${styles}</style>\n`
    + `<div${id('LegacyDock_Root')} class="lg-dock">`
    + dockButton('Legacy_DockHome', QUEST_LEGACY_COPY.dock.home, 0)
    + dockButton('Legacy_DockRecenter', QUEST_LEGACY_COPY.dock.recenter, 1)
    + dockButton('Legacy_DockPause', QUEST_LEGACY_COPY.dock.pause, 2)
    + dockButton('Legacy_DockExit', QUEST_LEGACY_COPY.dock.exit, 3)
    + text('', { x: 14, y: 70, width: 400, height: 22 }, 'lg-band', 'Legacy_DockLabel')
    + text('', { x: 420, y: 70, width: 286, height: 22 }, 'lg-small', 'Legacy_DockStatus', 'text-align: right;')
    + '</div>\n';
  for (const elementId of ['LegacyDock_Root', ...LEGACY_DOCK_ACTION_IDS, 'Legacy_DockLabel', 'Legacy_DockStatus']) {
    if (!ids.has(elementId)) throw new Error(`Missing required Quest Legacy dock ID: ${elementId}`);
  }
  const dockElements = ids.size;

  // Comfort gates: every control is at least the Home menu's hand-sized minimum in both
  // directions, and no readable copy is set below the spatial minimum.
  let smallestHitTarget = Number.POSITIVE_INFINITY;
  for (const target of hitTargets) {
    const smallest = Math.min(target.width, target.height);
    smallestHitTarget = Math.min(smallestHitTarget, smallest);
    if (smallest < layout.minimumHitSize) {
      throw new Error(`Quest Legacy control ${target.id} is ${target.width}x${target.height}; the minimum is ${layout.minimumHitSize}.`);
    }
  }
  for (const size of fontSizes) {
    if (size < layout.minimumFontSize) throw new Error(`Quest Legacy font size ${size} is below the spatial minimum ${layout.minimumFontSize}.`);
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
  const report: LegacyUIReport = { panelElements, dockElements, hitTargets: hitTargets.length, smallestHitTarget };
  console.log(`Generated Quest My Legacy panels: ${panelElements} + ${dockElements} stable native elements, ${hitTargets.length} controls of at least ${smallestHitTarget} units.`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void generateQuestLegacyUI().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
