// Labels of the fixed panel actions, and which of them the touch tray mirrors
// in each view. The panel generator writes these labels into the UIKitML and
// the view model writes the same strings onto the tray's mirrored buttons, so
// a mirrored action always reads exactly like the control it presses.

import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import type { LegacyPanelActionId, LegacyViewId } from './legacy-ui-contract.js';
import { QUEST_LEGACY_COPY } from './quest-legacy-copy.js';

export const LEGACY_ACTION_LABELS: Readonly<Record<LegacyPanelActionId, string>> = {
  Legacy_RecoveryNew: LEGACY_COPY.invalidSave.startNew,
  Legacy_RecoveryGuest: LEGACY_COPY.invalidSave.guest,
  Legacy_RecoveryHome: LEGACY_COPY.backToHome,
  Legacy_FoundingHome: LEGACY_COPY.founding.cancel,
  Legacy_NationNext: LEGACY_COPY.founding.next,
  Legacy_MoreNames: LEGACY_COPY.founding.moreSuggestions,
  Legacy_OpenKeyboard: QUEST_LEGACY_COPY.typeName,
  Legacy_NameBack: LEGACY_COPY.founding.back,
  Legacy_NameNext: LEGACY_COPY.founding.next,
  Legacy_KeyboardCancel: QUEST_LEGACY_COPY.keyboard.cancel,
  Legacy_KeyboardDone: QUEST_LEGACY_COPY.keyboard.done,
  Legacy_ArmsBack: LEGACY_COPY.founding.back,
  Legacy_ArmsNext: LEGACY_COPY.founding.next,
  Legacy_ConfirmMotto: QUEST_LEGACY_COPY.typeMotto,
  Legacy_ConfirmClearMotto: QUEST_LEGACY_COPY.keyboard.clear,
  Legacy_ConfirmBack: LEGACY_COPY.founding.back,
  Legacy_ConfirmRaise: LEGACY_COPY.founding.confirmAction,
  Legacy_RaisedContinue: LEGACY_COPY.founding.next,
  Legacy_AftermathLater: LEGACY_COPY.founding.back,
  Legacy_AftermathDismiss: LEGACY_COPY.aftermath.dismiss,
  Legacy_AftermathReview: LEGACY_COPY.aftermath.title,
  Legacy_HallBack: QUEST_LEGACY_COPY.back,
  Legacy_ResetOpen: LEGACY_COPY.reset.action,
  Legacy_MusterBack: QUEST_LEGACY_COPY.back,
  Legacy_MusterChoose: LEGACY_COPY.inspector.chooseMember,
  Legacy_NominateBack: QUEST_LEGACY_COPY.back,
  Legacy_MusterNominate: LEGACY_COPY.inspector.nominate,
  Legacy_RecordBack: QUEST_LEGACY_COPY.back,
  Legacy_RecordPrev: QUEST_LEGACY_COPY.previous,
  Legacy_RecordNext: QUEST_LEGACY_COPY.next,
  Legacy_HeraldBack: QUEST_LEGACY_COPY.back,
  Legacy_HeraldPrev: QUEST_LEGACY_COPY.previous,
  Legacy_HeraldNext: QUEST_LEGACY_COPY.next,
  Legacy_NoticeBack: QUEST_LEGACY_COPY.back,
  Legacy_NoticeAccept: LEGACY_COPY.notices.accept,
  Legacy_NoticeAwaiting: QUEST_LEGACY_COPY.awaitingButton,
  Legacy_AcceptCancel: LEGACY_COPY.founding.back,
  Legacy_AcceptConfirm: LEGACY_COPY.notices.accept,
  Legacy_AwaitingBack: QUEST_LEGACY_COPY.back,
  Legacy_AwaitingPlay: LEGACY_COPY.navigation.play,
  Legacy_ResetCancel: LEGACY_COPY.reset.cancel,
  Legacy_ResetConfirm: LEGACY_COPY.reset.confirm,
  Legacy_Resume: QUEST_LEGACY_COPY.pause.resume,
  Legacy_PauseHome: QUEST_LEGACY_COPY.pause.home,
};

export interface LegacyMirrorCandidates {
  back: readonly LegacyPanelActionId[];
  /** The first visible candidate is mirrored. Destructive actions are never mirrored. */
  primary: readonly LegacyPanelActionId[];
}

export const LEGACY_VIEW_MIRRORS: Readonly<Partial<Record<LegacyViewId, LegacyMirrorCandidates>>> = {
  LegacyView_Recovery: { back: ['Legacy_RecoveryHome'], primary: ['Legacy_RecoveryNew'] },
  LegacyView_Nation: { back: [], primary: ['Legacy_NationNext'] },
  LegacyView_Name: { back: ['Legacy_NameBack'], primary: ['Legacy_NameNext'] },
  LegacyView_Keyboard: { back: ['Legacy_KeyboardCancel'], primary: ['Legacy_KeyboardDone'] },
  LegacyView_Arms: { back: ['Legacy_ArmsBack'], primary: ['Legacy_ArmsNext'] },
  LegacyView_Confirm: { back: ['Legacy_ConfirmBack'], primary: ['Legacy_ConfirmRaise'] },
  LegacyView_Raised: { back: [], primary: ['Legacy_RaisedContinue'] },
  LegacyView_Aftermath: { back: ['Legacy_AftermathLater'], primary: ['Legacy_AftermathDismiss'] },
  LegacyView_Overview: { back: [], primary: ['Legacy_AftermathReview'] },
  LegacyView_Hall: { back: ['Legacy_HallBack'], primary: [] },
  LegacyView_Muster: { back: ['Legacy_MusterBack'], primary: ['Legacy_MusterChoose'] },
  LegacyView_Nominate: { back: ['Legacy_NominateBack'], primary: ['Legacy_MusterNominate'] },
  LegacyView_Record: { back: ['Legacy_RecordBack'], primary: [] },
  LegacyView_Herald: { back: ['Legacy_HeraldBack'], primary: [] },
  LegacyView_Notice: { back: ['Legacy_NoticeBack'], primary: ['Legacy_NoticeAccept', 'Legacy_NoticeAwaiting'] },
  LegacyView_Accept: { back: ['Legacy_AcceptCancel'], primary: ['Legacy_AcceptConfirm'] },
  LegacyView_Awaiting: { back: ['Legacy_AwaitingBack'], primary: ['Legacy_AwaitingPlay'] },
  LegacyView_Reset: { back: ['Legacy_ResetCancel'], primary: [] },
  LegacyView_Pause: { back: ['Legacy_PauseHome'], primary: ['Legacy_Resume'] },
};
