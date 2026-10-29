// Quest-only My Legacy copy: the headset adaptations (large-key keyboard, dock,
// pause and staging) that have no desktop equivalent. Shared labels always come
// from LEGACY_COPY so the two platforms never fork common wording.

import { LEGACY_COPY } from '../../../shared/legacy/content/copy';

export const QUEST_LEGACY_COPY = {
  loading: {
    title: 'Preparing the Bannerhold',
    body: 'Your holding is being set out in front of you. The panels stay usable while it loads.',
  },
  typeName: 'Type a name',
  namePrompt: 'Choose a suggested name or type your own',
  previewOf: (title: string): string => `Showing: ${title}`,
  keyboard: {
    title: 'Name your banner',
    done: 'Done',
    cancel: 'Cancel',
    shift: 'Shift',
    space: 'Space',
    delete: 'Delete',
    clear: 'Clear',
    placeholder: 'Type with the keys below',
  },
  overviewIntro: 'Point at a landmark in the holding and pinch, or choose one below.',
  dissolve: 'Dissolve banner',
  back: LEGACY_COPY.founding.back,
  previous: 'Previous',
  next: 'Next',
  page: (page: number, total: number): string => `${page} / ${total}`,
  awaitingButton: LEGACY_COPY.awaitingBoard.title,
  dock: {
    home: LEGACY_COPY.backToHome,
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
    fallback: 'The Bannerhold environment could not open, so the stand-in is shown.',
  },
  savedHere: 'Saved on this device',
  pointing: (title: string): string => `Pointing at ${title}. Pinch to inspect.`,
  honoursTitle: 'Honours',
  houses: {
    allied: (name: string, stance: string): string => `Allied Great House: ${name} (${stance})`,
    rival: (name: string, nation: string, stance: string, holdsCaptive: boolean): string =>
      `Rival house: ${name} of ${nation} (${stance})${holdsCaptive ? ', holding a captive of your house' : ''}`,
  },
  membersTitle: 'Sworn members',
  claimed: 'Claimed files',
  counts: {
    entries: (count: number): string => `${count} ${count === 1 ? 'entry' : 'entries'}`,
    conflicts: (count: number): string => `${count} ${count === 1 ? 'conflict' : 'conflicts'} recorded`,
    unresolved: (count: number): string => `${count} unresolved`,
    unread: (count: number): string => `${count} unread`,
    notices: (count: number): string => `${count} ${count === 1 ? 'notice' : 'notices'}`,
  },
} as const;
