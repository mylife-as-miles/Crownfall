import { getChronicleRecords, getHotspotRecords } from '../../shared/chronicles/content';
import type { ChronicleCollectionId, ChronicleRecord } from '../../shared/chronicles/types';
import { MENU_LAYOUT } from '../../shared/menu/theme';

// Stable native UIKitML IDs. Runtime wiring lives in the menu system.
export const QUEST_VIEW_IDS = [
  'View_Home', 'View_Play', 'View_Showcase', 'View_Chapters',
  'View_Settings', 'View_Arenas', 'View_Library', 'View_Modal',
  'View_Onboarding', 'View_Visit', 'View_Pause', 'View_SettingsDetail',
  'View_Chronicles',
] as const;

export type QuestViewId = typeof QUEST_VIEW_IDS[number];

export const QUEST_FIXED_ACTION_IDS = [
  'Nav_Home', 'Nav_Play', 'Nav_Showcase', 'Nav_Settings',
  'Btn_Back', 'Btn_VisitReplay', 'Btn_Pause', 'Btn_Recenter', 'Btn_Exit', 'Btn_EnterVR',
  'Btn_RetryCreature',
  'Btn_ExploreArenas',
  'Btn_Confirm', 'Btn_Cancel', 'Btn_StartVisit', 'Btn_SkipVisit',
  'Btn_VisitNext', 'Btn_VisitBack', 'Btn_VisitFinish',
  'Btn_Resume', 'Btn_PauseHome',
] as const;

export const QUEST_FIXED_TEXT_IDS = [
  'Modal_Title', 'Modal_Description', 'Modal_Note',
  'Settings_Title', 'Settings_Description', 'Settings_Category',
  'Onboarding_Title', 'Onboarding_Body',
  'Visit_Title', 'Visit_Body', 'Visit_Count',
  'Arena_Title', 'Arena_Count',
  'Pause_Title', 'Pause_Body', 'Library_Title', 'Library_Description',
  'Status_Tracking', 'Status_Hint', 'Status_Boot',
  'Chronicles_Title', 'Record_Title', 'Record_Label', 'Record_Meaning', 'Record_Body',
] as const;

export const QUEST_SETTING_ROWS = 10;

// Platform adaptation shared by the generator and runtime: UIKitML builds each
// Barlow atlas with UIKit's default printable-ASCII charset, so typographic
// dashes, curly quotes and middle dots are shown in their ASCII forms on Quest.
export const questText = (value: string): string => value.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[–—]/gu, '-').replace(/·/gu, '/');

// Chronicles names its panes and controls from shared ids: one tab per exhibit
// and one button per Atlas hotspot, Interregnum stop and Laws article. The
// Atlas map itself is a world-space diorama whose objects carry the diorama,
// marker and ground names. Back closes an open record, so the record panel
// needs no close control. A wordless bar shows while the archive builds, and
// the record panel carries a chip for the canon marker of unapproved words.
const CHRONICLE_CONTROL_PREFIX = { atlas: 'Hotspot', interregnum: 'Stop', laws: 'Article' } as const;
export const QUEST_CHRONICLE_IDS = {
  record: 'Record_Panel',
  diorama: 'Atlas_Diorama',
  ground: 'Atlas_Ground',
  /** The manifest asset the diorama drapes with the painting. */
  mapAsset: 'chronicles-map',
  loading: 'Chronicles_Loading',
  loadingFill: 'Chronicles_Loading_Fill',
  failure: 'Chronicles_Load_Failure',
  recordMarker: 'Record_Marker',
  tab: (exhibit: ChronicleCollectionId): string => `Exhibit_${exhibit}`,
  pane: (exhibit: ChronicleCollectionId): string => `Chronicles_${exhibit}`,
  control: (record: Pick<ChronicleRecord, 'id' | 'exhibit'>): string => `${CHRONICLE_CONTROL_PREFIX[record.exhibit]}_${record.id}`,
  marker: (record: Pick<ChronicleRecord, 'id'>): string => `Marker_${record.id}`,
} as const;
/** Records with their own button, in exhibit order. Nation accounts have none yet. */
export const QUEST_CHRONICLE_CONTROLS: readonly ChronicleRecord[] = [
  ...getHotspotRecords(), ...getChronicleRecords('interregnum'), ...getChronicleRecords('laws'),
];
/**
 * The record panel's column and its top on each exhibit, below that exhibit's
 * controls, and the lower edge of the footer row the diorama keeps below.
 */
export const QUEST_CHRONICLE_LAYOUT = {
  record: { x: 361, width: 558 },
  recordTop: { atlas: 150, interregnum: 316, laws: 272 },
  footer: 660,
  /** The loading bar's track, between the tabs and the exhibit controls. */
  loading: { x: 128, y: 127, width: 1024, height: 8 },
} as const;
/**
 * Every region the Chronicles view draws in while the archive is open, in panel
 * units: the tab and control band, the record column at its tallest, and the
 * footer actions shown in XR (Back; Pause, Recenter and Exit VR). The control
 * surface keeps these clear of the monument, and check:sync keeps the
 * generated view inside them.
 */
export const QUEST_CHRONICLE_EXTENT: readonly { id: string; x: number; y: number; width: number; height: number }[] = [
  { id: 'band', x: 105, y: 68, width: 1070, height: 232 },
  { id: 'record', x: 361, y: 150, width: 558, height: 440 },
  { id: 'back', x: 105, y: 610, width: 90, height: 50 },
  { id: 'actions', x: 580, y: 610, width: 266, height: 50 },
];

export const QUEST_UI_LAYOUT = {
  width: MENU_LAYOUT.reference.width,
  height: MENU_LAYOUT.reference.height,
  authoredScale: 0.15,
  minimumHitSize: 50,
  manifestId: 'crownfall-menu',
  documentPath: 'ui/menu.uikitml',
} as const;
