// Shared menu contracts contain no browser, renderer, or framework dependencies.
export type Direction = "left" | "right" | "up" | "down";
export type MenuScreen = "home" | "play" | "showcase" | "settings" | "chapters";
export type PlayCardId = "classic" | "local-duel" | "chapters" | "online-duel";
export type HomeTileId = "feature" | "upper" | "lower";
export type HomeTileAction = "legacy" | "chronicles" | "herald";
export type HomeDirection = Direction;
export type MenuPanel = Exclude<PlayCardId, "chapters"> | "chapter-preview" | HomeTileAction | "quit" | null;
export type ShowcaseView = "overview" | "battles" | "arenas" | "replays";
export type SettingsCategory = "general" | "controls" | "input" | "video" | "audio" | "credits";

export interface PlayCard {
  id: PlayCardId;
  artwork: "new" | "resume" | "load" | "browse";
  title: string;
  label: string;
  subtitle: string;
  description: string;
  preview: string;
}

export interface HomeTileContent {
  id: HomeTileId;
  eyebrow?: string;
  title?: string;
  description?: string;
  imageSrc?: string;
  imageFit?: "cover" | "contain";
  imagePosition?: string;
  action?: HomeTileAction;
}

export type HomeContent = readonly [
  HomeTileContent & { id: "feature" },
  HomeTileContent & { id: "upper" },
  HomeTileContent & { id: "lower" },
];

export interface ChapterItem {
  id: string;
  title: string;
  imageSrc: string;
  imagePosition: string;
  previewable: boolean;
  locked: boolean;
}

export interface ModalContent {
  title: string;
  description: string;
  note?: string;
}
