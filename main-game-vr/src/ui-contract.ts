import { MENU_LAYOUT } from '../../shared/menu/theme';

// Stable native UIKitML IDs. Runtime wiring lives in the menu system.
export const QUEST_VIEW_IDS = [
  'View_Home', 'View_Play', 'View_Showcase', 'View_Chapters',
  'View_Settings', 'View_Arenas', 'View_Library', 'View_Modal',
  'View_Onboarding', 'View_Visit', 'View_Pause', 'View_SettingsDetail',
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
] as const;

export const QUEST_SETTING_ROWS = 10;

export const QUEST_UI_LAYOUT = {
  width: MENU_LAYOUT.reference.width,
  height: MENU_LAYOUT.reference.height,
  authoredScale: 0.15,
  minimumHitSize: 50,
  manifestId: 'crownfall-menu',
  documentPath: 'ui/menu.uikitml',
} as const;
