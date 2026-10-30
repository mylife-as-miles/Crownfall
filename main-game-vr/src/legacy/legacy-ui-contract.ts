// Stable native UIKitML ids and the physical layout of the Quest My Legacy
// panels. scripts/generate-quest-legacy-ui.ts builds public/ui/legacy*.uikitml
// from these and the shared Legacy content; the runtime addresses the same ids.

import { MAX_PROMINENT_AFTERMATH } from '../../../shared/legacy/domain/aftermath';
import { FOUNDING_MEMBER_COUNT } from '../../../shared/legacy/domain/founding';
import type { FileLetter, LandmarkId, NationId } from '../../../shared/legacy/types';
import { QUEST_UI_LAYOUT } from '../ui-contract.js';
import { LEGACY_MANIFEST } from './legacy-manifest.js';

export const LEGACY_UI_LAYOUT = {
  /** UIKit units (centimetres at scale 1) of the primary world-space reading panel. */
  panel: { width: 720, height: 520 },
  /** The touch tray: navigation and the current view's actions, staged within arm's reach. */
  tray: { width: 560, height: 172 },
  /** The Home menu's unit, so hit sizes compare directly with QUEST_UI_LAYOUT.minimumHitSize. */
  authoredScale: QUEST_UI_LAYOUT.authoredScale,
  /** The tray is read and touched at about 0.6 m, so it is authored at half the panel's physical unit. */
  trayScale: QUEST_UI_LAYOUT.authoredScale / 2,
  minimumHitSize: QUEST_UI_LAYOUT.minimumHitSize,
  /** Smallest font size, in units, used for any readable copy. */
  minimumFontSize: 15,
  /** Comfort gates the generator enforces at the default viewing distances below. */
  minimumHitDegrees: 3,
  minimumTouchMetres: 0.035,
  minimumTextDegrees: 0.9,
  nominalPanelDistance: 1.4,
  nominalTrayDistance: 0.62,
  ...LEGACY_MANIFEST,
} as const;

/** Legacy palette: the Home menu's warm gold on an opaque, high-contrast night surface. */
export const LEGACY_UI_COLORS = {
  surface: '#120f0a',
  surfaceBorder: '#6b5230',
  inset: '#0b0906',
  card: '#1d1811',
  button: '#2a2216',
  buttonBorder: '#7a5a2a',
  buttonHover: '#3a2e1c',
  selected: '#4d3714',
  selectedBorder: '#f0a040',
  selectedHoverBorder: '#ffc46a',
  primary: '#6b4a14',
  primaryHover: '#7d5818',
  primaryBorder: '#d49130',
  danger: '#4a1d16',
  dangerHover: '#5c251c',
  dangerBorder: '#b0503c',
  dangerHoverBorder: '#e07058',
  band: '#3a2a10',
  bandText: '#f2c672',
  heading: '#d49130',
  text: '#ece4d0',
  secondary: '#c9c1ae',
  muted: '#9f9888',
  accent: '#e0a03c',
  warning: '#f0b860',
  empty: '#07060a',
  emptyBorder: '#8a6a3a',
  crownCell: '#2a2520',
  crownText: '#b8b0a0',
} as const;

/** Scene node ids authored in public/scenes/main.iwsdk.scene.json; the panels are created at runtime under the anchor. */
export const LEGACY_SCENE_NODES = { anchor: 'legacy-anchor' } as const;
/** Object3D names of the runtime-created panels, which ECS and the IWSDK tools address by name. */
export const LEGACY_PANEL_NAMES = { panel: 'My Legacy Panel', dock: 'My Legacy Dock' } as const;

/**
 * UIKitML only creates a text node for non-empty content: an empty <span> becomes a plain container
 * whose `text` property is stored but never drawn. Every live text therefore starts with a placeholder
 * and carries this class, and the runtime clears all of them before a panel is first shown.
 */
export const LEGACY_LIVE_TEXT = { className: 'lg-live', placeholder: '-' } as const;

export const LEGACY_VIEW_IDS = [
  'LegacyView_Loading', 'LegacyView_Recovery',
  'LegacyView_Nation', 'LegacyView_Name', 'LegacyView_Keyboard', 'LegacyView_Arms', 'LegacyView_Confirm', 'LegacyView_Raised',
  'LegacyView_Aftermath', 'LegacyView_Overview', 'LegacyView_Hall', 'LegacyView_Muster', 'LegacyView_Nominate', 'LegacyView_Record',
  'LegacyView_Herald', 'LegacyView_Notice', 'LegacyView_Accept', 'LegacyView_Awaiting', 'LegacyView_Reset', 'LegacyView_Pause',
] as const;
export type LegacyViewId = typeof LEGACY_VIEW_IDS[number];

export const LEGACY_SUGGESTION_SLOTS = 4;
export const LEGACY_RECORD_PAGE = 3;
export const LEGACY_NOTICE_PAGE = 4;
export const LEGACY_HONOUR_SLOTS = 4;
export const LEGACY_AFTERMATH_SLOTS = MAX_PROMINENT_AFTERMATH;
export const LEGACY_MEMBER_SLOTS = FOUNDING_MEMBER_COUNT;
/** Stated terms of a Muster wager, laid out two by two. */
export const LEGACY_WAGER_TERM_SLOTS = 4;
/** Rows of the representative's ledger at the Muster Grounds. */
export const LEGACY_LEDGER_ROWS = 9;
/** The house's side of the formation: ranks 2 and 1, files a to h, as the player sees it. */
export const LEGACY_FORMATION_RANKS = ['2', '1'] as const;
export const LEGACY_FORMATION_LEGEND = ['player', 'ally', 'crown'] as const;
export type LegacyFormationGroup = typeof LEGACY_FORMATION_LEGEND[number];

/** Large-key keyboard for custom banner names and mottos; comma and full stop serve the motto only. */
export const LEGACY_KEY_ROWS: readonly (readonly string[])[] = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ','],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', "'", '-', '.'],
];
export type LegacyKeyAction = 'shift' | 'space' | 'delete' | 'clear';
export const LEGACY_KEY_ACTIONS: readonly LegacyKeyAction[] = ['shift', 'space', 'delete', 'clear'];

export const LEGACY_HERALDRY_PARTS = ['division', 'field0', 'field1', 'ordinary', 'ordinaryTincture', 'charge', 'chargeTincture'] as const;
export type LegacyHeraldryPart = typeof LEGACY_HERALDRY_PARTS[number];

const KEY_NAMES: Readonly<Record<string, string>> = { "'": 'Apostrophe', '-': 'Hyphen', ',': 'Comma', '.': 'Period' };
export const legacyKeyId = (key: string): string => `Legacy_Key_${KEY_NAMES[key] ?? key}`;
export const legacyKeyActionId = (action: LegacyKeyAction): string => `Legacy_Key_${action.charAt(0).toUpperCase()}${action.slice(1)}`;
export const legacyNationId = (nation: NationId): string => `Legacy_Nation_${nation}`;
export const legacyLandmarkButtonId = (landmark: LandmarkId): string => `Legacy_Landmark_${landmark}`;
export const legacyPartId = (part: LegacyHeraldryPart): string => `Legacy_Part_${part}`;
export const legacyPartPreviousId = (part: LegacyHeraldryPart): string => `Legacy_PartPrev_${part}`;
export const legacyFileId = (file: FileLetter): string => `Legacy_File_${file}`;
export const legacyRecordTabId = (tab: 'conflicts' | 'unresolved' | 'ledger'): string => `Legacy_RecordTab_${tab}`;
export const legacyFormationCellId = (square: string): string => `Legacy_Formation_${square}`;
export const legacyWagerTermId = (prefix: 'NoticeView' | 'Accept', index: number): string => `Legacy_${prefix}_Term_${index}`;
/** Object3D name of a stand-in landmark proxy, also its hand target name. */
export const legacyLandmarkTargetName = (landmark: LandmarkId): string => `Landmark_${landmark}`;

/** Fixed actions on the primary panel; slot-indexed controls use the helpers above. */
export const LEGACY_PANEL_ACTION_IDS = [
  'Legacy_RecoveryNew', 'Legacy_RecoveryGuest', 'Legacy_RecoveryHome',
  'Legacy_FoundingHome', 'Legacy_NationNext',
  'Legacy_MoreNames', 'Legacy_OpenKeyboard', 'Legacy_NameBack', 'Legacy_NameNext',
  'Legacy_KeyboardCancel', 'Legacy_KeyboardDone',
  'Legacy_ArmsBack', 'Legacy_ArmsNext',
  'Legacy_ConfirmMotto', 'Legacy_ConfirmClearMotto', 'Legacy_ConfirmBack', 'Legacy_ConfirmRaise',
  'Legacy_RaisedContinue',
  'Legacy_AftermathLater', 'Legacy_AftermathDismiss', 'Legacy_AftermathReview',
  'Legacy_HallBack', 'Legacy_ResetOpen',
  'Legacy_MusterBack', 'Legacy_MusterChoose',
  'Legacy_NominateBack', 'Legacy_MusterNominate',
  'Legacy_RecordBack', 'Legacy_RecordPrev', 'Legacy_RecordNext',
  'Legacy_HeraldBack', 'Legacy_HeraldPrev', 'Legacy_HeraldNext',
  'Legacy_NoticeBack', 'Legacy_NoticeAccept', 'Legacy_NoticeAwaiting',
  'Legacy_AcceptCancel', 'Legacy_AcceptConfirm', 'Legacy_AwaitingBack', 'Legacy_AwaitingPlay',
  'Legacy_ResetCancel', 'Legacy_ResetConfirm',
  'Legacy_Resume', 'Legacy_PauseHome',
] as const;
export type LegacyPanelActionId = typeof LEGACY_PANEL_ACTION_IDS[number];

/** The tray's navigation, always in reach; Back and the primary action mirror the panel's current view. */
export const LEGACY_DOCK_ACTION_IDS = ['Legacy_DockBack', 'Legacy_DockPrimary', 'Legacy_DockHome', 'Legacy_DockPlay', 'Legacy_DockRecenter', 'Legacy_DockPause', 'Legacy_DockExit'] as const;
export type LegacyDockActionId = typeof LEGACY_DOCK_ACTION_IDS[number];

/** Images that show the live heraldry raster. */
export const LEGACY_HERALDRY_IMAGE_IDS = ['Legacy_Arms_Preview', 'Legacy_Confirm_Preview', 'Legacy_Raised_Preview', 'Legacy_Overview_Crest', 'Legacy_Hall_Preview'] as const;
/** The allied and rival houses' shields in the Banner Hall, each with its own small raster. */
export const LEGACY_HOUSE_SHIELD_IDS = { allied: 'Legacy_Hall_AlliedShield', rival: 'Legacy_Hall_RivalShield' } as const;
/** Raster size of a house shield (shield aspect 1:1.2). */
export const LEGACY_SHIELD_RASTER = { width: 120, height: 144 } as const;
/** Raster size of the live heraldry preview (banner aspect 1:1.5). */
export const LEGACY_HERALDRY_RASTER = { width: 256, height: 384 } as const;
