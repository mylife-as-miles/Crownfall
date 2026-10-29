// Every piece of shared My Legacy copy. Desktop and Quest render these strings
// verbatim, and the domain builds chronicle entries and notices from the
// builders below, so wording never forks between platforms. Concise,
// ceremonial and truthful: nothing here may claim a match, sync or result
// that did not happen. Muster consequences are always phrased as the stated
// terms of a specific Muster or challenge.

import type {
  ChronicleKind, FileLetter, HouseRank, HouseStance, LandmarkId, MatchEndReason, MatchOutcome,
  MatchStakes, MemberStatus, NationAvailability, NoticeKind, PieceKind, UnresolvedKind,
} from "../types";

/** Presentation condition of a representative: the stored status plus the derived returned/promoted states. */
export type RepresentativeCondition = MemberStatus | "returned" | "promoted";

export const PIECE_NAMES: Readonly<Record<PieceKind, string>> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

export const END_REASON_PHRASES: Readonly<Record<MatchEndReason, string>> = {
  checkmate: "by checkmate",
  stalemate: "by stalemate",
  resignation: "by resignation",
  timeout: "on time",
  threefold: "by threefold repetition",
  insufficient: "for want of mating material",
  fiftymove: "under the fifty-move rule",
  objective: "by objective",
  draw: "by agreement",
};

/** Capitalises the first letter, for names such as "the Kwind Zaibatsu" that open a sentence or heading. */
export function sentenceCase(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Lowercases a leading "The " so a formal title such as a nation's polity reads mid-sentence. */
export function inSentence(text: string): string {
  return text.indexOf("The ") === 0 ? `the ${text.slice(4)}` : text;
}

export const LEGACY_COPY = {
  title: "My Legacy",
  tagline: "Your Banner. Your People. Your Place in Crownfall.",
  backToHome: "Return to Home",
  founding: {
    title: "Found a Minor Banner",
    intro: "Raise a small house within one of Crownfall's four nations. Choose its nation, its name and its arms.",
    steps: [
      { id: "nation", title: "Nation", hint: "Every banner serves a nation far older than itself." },
      { id: "name", title: "Banner name", hint: "The name your people will carry to the Muster." },
      { id: "heraldry", title: "Arms", hint: "Choose a division, an ordinary and a charge, and the tincture of each." },
      { id: "confirm", title: "Raise the banner", hint: "Review the arms, then enter the banner in the rolls of its nation." },
    ],
    stepCounter: (step: number, total: number) => `Step ${step} of ${total}`,
    availability: {
      available: "Open",
      preview: "Preview",
      unavailable: "Closed in this build",
    } satisfies Record<NationAvailability, string>,
    launchArmiesNote: "The launch armies await approval. Every nation is open in this build.",
    nameLabel: "Banner name",
    namePlaceholder: "House Ashgrove",
    nameRules: "2–28 letters, spaces, apostrophes or hyphens.",
    suggestionsLabel: "Suggested names",
    moreSuggestions: "Other names",
    mottoLabel: "Motto (optional)",
    mottoPlaceholder: "We keep the watch",
    parts: { division: "Division", field: "Field", secondField: "Second field", ordinary: "Ordinary", ordinaryTincture: "Ordinary tincture", charge: "Charge", chargeTincture: "Charge tincture" },
    presetsLabel: "Heraldic presets",
    advisoryTitle: "Herald's advice",
    advisoryNote: "Advice only. You may keep any design.",
    advisoryClear: "These arms follow the rule of tincture.",
    draftLabel: "Founding preview · not yet saved",
    confirmTitle: "Raise this banner?",
    confirmBody: "Your banner, its arms and its three sworn members will be saved on this device.",
    guestConfirmBody: "This guest banner lasts for this visit only and will not be saved.",
    confirmAction: "Raise the banner",
    back: "Back",
    next: "Continue",
    cancel: "Return to Home",
  },
  landmarks: {
    "banner-hall": {
      title: "Banner Hall",
      description: "The seat of your house: its name, its standard and the recognition it has earned.",
      action: "Inspect the hall",
    },
    "muster-grounds": {
      title: "Muster Grounds",
      description: "Where your house presents its named Pawn to the National Muster.",
      action: "Inspect the muster",
    },
    "war-record": {
      title: "War Record",
      description: "The record of every completed conflict, capture, promotion and grievance.",
      action: "Open the chronicle",
    },
    "heralds-station": {
      title: "Herald's Station",
      description: "Summons, challenges and notices from the houses of your nation and beyond.",
      action: "Read the notices",
    },
  } satisfies Record<LandmarkId, { title: string; description: string; action: string }>,
  inspector: {
    name: "Name",
    epithet: "Epithet",
    origin: "Origin",
    allegiance: "Banner",
    file: "Muster file",
    condition: "Condition",
    appointment: "Appointment",
    musters: "Musters served",
    captures: "Captures",
    timesCaptured: "Times taken",
    promotions: "Battlefield promotions",
    heldBy: "Held by",
    nominate: "Nominate",
    nominated: "Nominated representative",
    chooseFile: "Choose a file",
    chooseMember: "Choose a member",
    eligibleFiles: "Open files",
    claimedBy: (label: string) => `Claimed by ${label}`,
    fileName: (file: FileLetter) => `${file}-file`,
    promotedTo: (pieceName: string) => `Promoted to ${pieceName} on the battlefield`,
    emptyPlace: (captorName: string) => `Their place stands empty. Held by ${captorName}.`,
    pawnAppointment: "Pawn of the National Muster",
    futureAppointments: "Knight, Bishop, Rook and Queen appointments are not part of this release.",
    formationNote: "The national formation follows standard chess. Your file decides who stands there, not how many pieces you move.",
  },
  status: {
    available: { label: "Available", description: "Stands among the house levy, ready for the Muster." },
    injured: { label: "Injured", description: "Wounded in a recorded Muster conflict and recovering in the holding." },
    captive: { label: "Captive", description: "Held by a rival after a recorded Muster defeat. Their place stands empty." },
    returned: { label: "Returned", description: "Home again after a Muster victory. The Chronicle keeps the captivity on record." },
    promoted: { label: "Promoted", description: "Promoted on the battlefield. The house's political standing is unchanged." },
  } satisfies Record<RepresentativeCondition, { label: string; description: string }>,
  stance: {
    hostile: "Hostile",
    disdainful: "Disdainful",
    wary: "Wary",
    cordial: "Cordial",
    loyal: "Loyal",
  } satisfies Record<HouseStance, string>,
  outcome: { victory: "Victory", defeat: "Defeat", draw: "Draw" } satisfies Record<MatchOutcome, string>,
  stakes: {
    classic: { label: "Classic match", description: "Captures are recorded. Taken pieces leave the board unharmed; no one is wounded or held." },
    muster: { label: "Muster conflict", description: "High stakes, with the wager stated before the match. A representative taken in defeat is held captive." },
  } satisfies Record<MatchStakes, { label: string; description: string }>,
  rank: {
    "minor-banner": "Minor Banner",
    "sworn-banner": "Sworn Banner",
    "landed-house": "Landed House",
    "great-house": "Great House",
  } satisfies Record<HouseRank, string>,
  hallTiers: ["Founding hall", "Recognised hall", "Honoured hall", "Renowned hall"] as const,
  recognitionLabel: (recognition: number) => `Recognition ${recognition}`,
  readiness: {
    noBanner: "Found a banner first.",
    noNominee: "Nominate a member and an open file for the Muster.",
    nomineeUnfit: (memberName: string, status: MemberStatus) =>
      `${memberName} is ${status} and cannot take the field. Nominate another member.`,
    noChallenge: "No Muster challenge is open.",
    notAccepted: "Accept the challenge and its wager first.",
  },
  empty: {
    chronicle: "The Chronicle is unwritten. Only real, recorded matches will fill it.",
    matches: "No conflicts recorded yet.",
    notices: "No notices await the herald.",
    unresolved: "No unresolved matters.",
    honours: "No honours yet. Honours come only from recorded results.",
    levy: "No other members stand in the levy.",
    representative: "No representative nominated. Choose a member and an open file.",
    unfounded: "No banner has been raised on this device.",
  },
  notices: {
    kinds: {
      "muster-summons": "Muster summons",
      "rival-challenge": "Formal challenge",
      "allied-demand": "Allied demand",
      "rival-vow": "Rival vow",
      "captivity-notice": "Captivity notice",
      "return-notice": "Return notice",
    } satisfies Record<NoticeKind, string>,
    wagerHeading: "The wager",
    read: "Mark as read",
    accept: "Accept the challenge",
    acceptTitle: "Accept this challenge?",
    acceptBody: "Your house accepts the wager as stated. The match itself still waits for the board.",
    accepted: "Accepted · awaiting the board",
    resolved: "Resolved",
    unread: "Unread",
    from: (name: string) => `From ${name}`,
  },
  unresolvedKinds: {
    captive: "Captive",
    grievance: "Grievance",
    "allied-accounting": "Allied accounting",
    challenge: "Open challenge",
  } satisfies Record<UnresolvedKind, string>,
  aftermath: {
    title: "Aftermath",
    headings: {
      founding: "A banner is raised",
      nomination: "A representative is named",
      notice: "Word from the herald",
      "challenge-accepted": "The challenge is accepted",
      match: "The board records the move",
      capture: "A capture is recorded",
      captivity: "Taken captive",
      injury: "Wounded in the Muster",
      recovery: "Recovered",
      return: "Returned home",
      promotion: "Battlefield promotion",
      grievance: "A rival remembers",
      "allied-reaction": "The Great House counts its loss",
    } satisfies Record<ChronicleKind, string>,
    dismiss: "Acknowledge",
    allRecorded: "Every fact is kept in the War Record.",
  },
  awaitingBoard: {
    title: "Awaiting the board",
    body:
      "The King's Gambit match integration is not connected to My Legacy in this build, so no match can be " +
      "played or recorded here yet. Your challenge stays open and nothing has been decided.",
    hint: "Consequences in this build appear only in clearly labelled development previews.",
  },
  guest: {
    label: "Guest session — not saved",
    description: "A fresh banner for this visit only. Nothing is read from or written to this device.",
  },
  preview: {
    label: "Development preview · fixture data · not saved",
    description: "Scripted fixture matches run through the real Legacy rules. Not a production record.",
    listTitle: "Development previews",
    missing: (previewId: string) => `There is no development preview named "${previewId}".`,
  },
  reset: {
    title: "Dissolve this banner?",
    body: "Your banner, its members, its chronicle and any captives will be erased from this device. This cannot be undone.",
    confirm: "Dissolve the banner",
    cancel: "Keep the banner",
  },
  newBanner: {
    title: "Raise a new banner?",
    body: "The current banner will be dissolved and erased from this device before a new founding begins.",
    confirm: "Dissolve and begin anew",
    cancel: "Keep the current banner",
  },
  invalidSave: {
    title: "The banner rolls cannot be read",
    body: "The saved banner on this device could not be read safely. It has been left untouched.",
    startNew: "Raise a new banner",
    startNewNote: "Raising a new banner replaces the unreadable record.",
    guest: "Continue as a guest",
    details: "Details",
  },
  futureSave: {
    title: "Saved by a newer version",
    body: "This banner was saved by a newer version of Crownfall and has been left untouched. Update Crownfall to continue it.",
    replaceNote: "Raising a new banner here would replace it.",
  },
  storageUnavailable: {
    title: "Saving is unavailable",
    body: "This device refused to store the banner. Your progress lasts only for this visit.",
  },
  saveFailed: "The banner could not be saved on this device.",
  noSync: "Saves stay on this device. Crownfall does not sync banners between devices.",
} as const;

export interface LegacyText {
  title: string;
  body: string;
}

export type ChallengeContext = "first" | "renewed" | "captive" | "vow";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function ordinal(n: number): string {
  if (n >= 1 && n <= ORDINALS.length) return ORDINALS[n - 1];
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * Builders for every sentence the domain writes into chronicle entries,
 * notices and unresolved matters. Inputs are names already resolved by the
 * domain, so the same facts always produce the same words. Names that may
 * begin with a lowercase "the" go through sentenceCase where they open a sentence.
 */
export const LEGACY_TEXT = {
  founding: (bannerName: string, polity: string): LegacyText => ({
    title: `${bannerName} is raised`,
    body: `${bannerName} is entered in the rolls of ${inSentence(polity)} as a minor banner. In the capital, few yet know its name.`,
  }),
  summons: (alliedName: string, bannerName: string, nationName: string): LegacyText => ({
    title: `Summons from ${alliedName}`,
    body:
      `${alliedName} calls ${bannerName} to the National Muster of ${nationName}. Name one Pawn of your house to stand ` +
      `in the formation. They think little of so new a banner, and they will judge it by how the Muster goes.`,
  }),
  challenge: (context: ChallengeContext, rivalName: string, rivalNationName: string, bannerName: string, number: number, captiveName: string | null): LegacyText => {
    switch (context) {
      case "first":
        return {
          title: `A formal challenge from ${rivalName}`,
          body: `${rivalName} of ${rivalNationName} names ${bannerName} in a formal challenge at the next Muster. A new banner, they say, must prove it belongs on the field.`,
        };
      case "captive":
        return {
          title: `${rivalName} offers the field again`,
          body: `${rivalName} of ${rivalNationName} agrees to meet ${bannerName} in a ${ordinal(number)} Muster conflict. ${captiveName ?? "Your representative"} remains in ${rivalNationName}'s keeping until your house wins a Muster against them.`,
        };
      case "vow":
        return {
          title: `${rivalName} demands an answer`,
          body: `${rivalName} of ${rivalNationName} has not forgotten the last field and calls ${bannerName} to a ${ordinal(number)} Muster conflict.`,
        };
      case "renewed":
        return {
          title: `${rivalName} renews the challenge`,
          body: `${rivalName} of ${rivalNationName} calls ${bannerName} to a ${ordinal(number)} Muster conflict.`,
        };
    }
  },
  /** The plain-language wager stated on every Muster challenge, before any match. */
  wager: (opponentNationName: string, alliedName: string): string =>
    `These are the terms of this Muster conflict against ${opponentNationName}. If your representative is taken and ` +
    `${opponentNationName} wins, they are held captive until your house wins a later Muster against ${opponentNationName}. ` +
    `If your representative is taken but your side wins or draws, they come home wounded and recover after one further ` +
    `recorded match. Victory earns your house recognition and the favour of ${alliedName}; defeat costs that favour, and ` +
    `${alliedName} will demand an accounting if its own representative is taken. The rules of chess do not change.`,
  nomination: (memberName: string, file: FileLetter): LegacyText => ({
    title: `${memberName} is named to the Muster`,
    body: `${memberName} will stand on the ${file}-file of the national formation.`,
  }),
  challengeAccepted: (rivalName: string): LegacyText => ({
    title: `The challenge of ${rivalName} is accepted`,
    body: "The terms have been heard and accepted. The field awaits the board.",
  }),
  match: (stakes: MatchStakes, outcome: MatchOutcome, reason: MatchEndReason, plies: number, opponentNationName: string, representativeName: string | null): LegacyText => {
    const kind = stakes === "muster" ? "Muster conflict" : "Classic match";
    const result = outcome === "victory" ? "won" : outcome === "defeat" ? "lost" : "drawn";
    const moves = Math.ceil(plies / 2);
    const rep = representativeName ? ` ${representativeName} stood for the house.` : "";
    return {
      title: `${kind} against ${opponentNationName}: ${LEGACY_COPY.outcome[outcome]}`,
      body: `The ${kind} was ${result} ${END_REASON_PHRASES[reason]} after ${moves} ${moves === 1 ? "move" : "moves"}.${rep}`,
    };
  },
  classicCapture: (memberName: string, square: string, captorLabel: string): LegacyText => ({
    title: `${memberName} yielded on ${square}`,
    body: `Taken by ${captorLabel} in a Classic match. ${memberName} laid down arms and left the board unharmed.`,
  }),
  representativeCaptures: (memberName: string, count: number): LegacyText => ({
    title: `${memberName} made ${count === 1 ? "a capture" : `${count} captures`}`,
    body: `The board records ${count === 1 ? "one capture" : `${count} captures`} by ${memberName}.`,
  }),
  captivity: (memberName: string, captorName: string, opponentNationName: string): LegacyText => ({
    title: `${memberName} is held by ${captorName}`,
    body: `${memberName} was taken in a lost Muster conflict and is held by ${captorName}. Their place at the Muster Grounds stands empty until your house wins a Muster against ${opponentNationName}.`,
  }),
  captivityNotice: (memberName: string, captorName: string, opponentNationName: string): LegacyText => ({
    title: `${sentenceCase(captorName)} holds ${memberName}`,
    body: `${sentenceCase(captorName)} confirms that ${memberName} is in its keeping. Under the terms of the Muster, ${memberName} returns after a Muster victory over ${opponentNationName}.`,
  }),
  injury: (memberName: string, outcome: MatchOutcome): LegacyText => ({
    title: `${memberName} is wounded`,
    body: outcome === "victory"
      ? `${memberName} was taken on the board and carried from the field after the victory. They recover after one further recorded match.`
      : `${memberName} was taken on the board and exchanged under truce after the draw. They recover after one further recorded match.`,
  }),
  recovery: (memberName: string): LegacyText => ({
    title: `${memberName} has recovered`,
    body: `${memberName} is fit to stand in the levy again.`,
  }),
  returned: (memberName: string, opponentNationName: string): LegacyText => ({
    title: `${memberName} returns home`,
    body: `The Muster victory over ${opponentNationName} brings ${memberName} home. Their place is restored, and the Chronicle keeps the captivity.`,
  }),
  returnNotice: (memberName: string, captorName: string): LegacyText => ({
    title: `${memberName} is released`,
    body: `${sentenceCase(captorName)} releases ${memberName} under the terms of the Muster.`,
  }),
  promotion: (memberName: string, pieceName: string, laterCaptured: boolean): LegacyText => ({
    title: `${memberName} is promoted on the battlefield`,
    body: laterCaptured
      ? `${memberName} reached the last rank and rose to ${pieceName}, before being taken later in the match. Political standing is unchanged.`
      : `${memberName} reached the last rank and rose to ${pieceName}. Political standing is unchanged.`,
  }),
  alliedReaction: (alliedName: string, representativeName: string, opponentNationName: string): LegacyText => ({
    title: `${alliedName} counts its loss`,
    body: `${representativeName} of ${alliedName} was taken in the Muster against ${opponentNationName}. The Great House holds your banner to account for the loss.`,
  }),
  alliedDemand: (alliedName: string, representativeName: string): LegacyText => ({
    title: `${alliedName} demands an accounting`,
    body: `${alliedName} expects your house to answer for the loss of ${representativeName}. They will remember it.`,
  }),
  grievance: (rivalName: string, representativeName: string): LegacyText => ({
    title: `${rivalName} nurses a grievance`,
    body: `${representativeName} of ${rivalName} was taken by your side in the Muster. The house will remember it.`,
  }),
  rivalVow: (rivalName: string, representativeName: string): LegacyText => ({
    title: `${rivalName} swears a vow`,
    body: `${rivalName} vows that the taking of ${representativeName} will be answered on a future field.`,
  }),
  matters: {
    captive: (memberName: string, captorName: string): LegacyText => ({
      title: `${memberName} is held captive`,
      body: `Held by ${captorName}. Win a Muster against their nation to bring ${memberName} home.`,
    }),
    grievance: (rivalName: string): LegacyText => ({
      title: `Grievance of ${rivalName}`,
      body: `${rivalName} remembers the representative taken from them.`,
    }),
    accounting: (alliedName: string): LegacyText => ({
      title: `Accounting owed to ${alliedName}`,
      body: `${alliedName} lost its representative in the Muster and awaits an accounting.`,
    }),
    challenge: (rivalName: string): LegacyText => ({
      title: `Open challenge from ${rivalName}`,
      body: "A Muster conflict awaits the board.",
    }),
  },
  honours: {
    musterVictory: (opponentNationName: string) => `Muster victory over ${opponentNationName}`,
    returned: (memberName: string) => `${memberName} brought home`,
    promotion: (memberName: string, pieceName: string) => `${memberName}, promoted to ${pieceName} on the field`,
    recognition: (tier: 1 | 2 | 3) => (tier === 1 ? "Recognised by the Muster" : tier === 2 ? "Honoured by the Muster" : "Renowned in the Muster"),
  },
} as const;
