// Quest-only My Legacy copy: the headset adaptations (large-key keyboard, touch
// tray, pagers, pause and staging) that have no desktop equivalent. Shared
// labels always come from LEGACY_COPY so the two platforms never fork common
// wording; the entries below that only re-export it keep the panel generator
// and the view model reading one table.

import { LEGACY_COPY } from '../../../shared/legacy/content/copy';

export const QUEST_LEGACY_COPY = {
  loading: {
    title: LEGACY_COPY.environment.preparing,
    body: 'Your holding is being set out in front of you. The panels stay usable while it loads.',
  },
  typeName: 'Type a name',
  typeMotto: 'Type a motto',
  namePrompt: 'Choose a suggested name or type your own',
  previewOf: (title: string): string => `Showing: ${title}`,
  keyboard: {
    title: 'Name your banner',
    mottoTitle: LEGACY_COPY.founding.mottoLabel,
    done: 'Done',
    cancel: 'Cancel',
    shift: 'Shift',
    space: 'Space',
    delete: 'Delete',
    clear: 'Clear',
    placeholder: 'Type with the keys below',
  },
  overviewIntro: 'Point at a landmark in the holding and pinch, or choose one below.',
  aftermathPending: (title: string): string => `${LEGACY_COPY.aftermath.title}: ${title}`,
  back: LEGACY_COPY.founding.back,
  previous: 'Previous',
  next: 'Next',
  page: (page: number, total: number): string => `${page} / ${total}`,
  tab: (label: string, count: number): string => `${label} / ${count}`,
  awaitingButton: LEGACY_COPY.awaitingBoard.title,
  dock: {
    home: LEGACY_COPY.backToHome,
    play: LEGACY_COPY.navigation.play,
    recenter: 'Recenter',
    pause: 'Pause',
    exit: 'Exit VR',
  },
  pause: {
    title: 'Paused',
    resume: 'Resume',
    home: LEGACY_COPY.backToHome,
    hint: 'Resume returns you to the same place in My Legacy.',
    noHand: 'Resume appears as soon as a hand is tracked again.',
  },
  environment: {
    standin: 'Environment stand-in',
    standinNote: 'A placeholder holding. The Bannerhold is not connected in this build.',
    connected: 'Bannerhold environment',
    loading: 'Preparing the holding...',
    fallback: LEGACY_COPY.environment.fallback,
  },
  savedHere: 'Saved on this device',
  pointing: (title: string): string => `Pointing at ${title}. Pinch to inspect.`,
  claimed: 'Claimed files',
  /** "Allied Great House: House Ombreval (Disdainful)" and its rival counterpart, from shared labels. */
  house: (kind: string, name: string, stance: string): string => `${kind}: ${name} (${stance})`,
  record: (musters: number, captures: number, taken: number): string =>
    `${LEGACY_COPY.inspector.musters} ${musters} / ${LEGACY_COPY.inspector.captures} ${captures} / ${LEGACY_COPY.inspector.timesCaptured} ${taken}`,
} as const;
