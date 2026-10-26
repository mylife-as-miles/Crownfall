export type Quality = "low" | "medium" | "high";
export type FrameLimit = 0 | 30 | 60 | 120;
export type SettingsCategory = "general" | "controls" | "input" | "video" | "audio" | "credits";
export type Direction = "left" | "right" | "up" | "down";
export type BindingAction = Direction | "select" | "back" | "previousTab" | "nextTab" | "first" | "last";
export type MenuBindings = Record<BindingAction, string>;

export const DEFAULT_BINDINGS: MenuBindings = {
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  select: "Enter", back: "Escape", previousTab: "KeyQ", nextTab: "KeyE", first: "Home", last: "End",
};

export const BINDING_LABELS: Record<BindingAction, string> = {
  left: "Move left", right: "Move right", up: "Move up", down: "Move down",
  select: "Select", back: "Back", previousTab: "Previous tab", nextTab: "Next tab", first: "First option", last: "Last option",
};

export interface Preferences {
  quality: Quality;
  volume: number;
  motion: boolean;
  showHints: boolean;
  renderScale: number;
  frameLimit: FrameLimit;
  bindings: MenuBindings;
}

export const INITIAL_PREFERENCES: Preferences = {
  quality: "high", volume: 65, motion: true, showHints: true,
  renderScale: 100, frameLimit: 0, bindings: { ...DEFAULT_BINDINGS },
};

export function normalizeBindings(value: unknown): MenuBindings {
  if (!value || typeof value !== "object") return { ...DEFAULT_BINDINGS };
  const candidate = value as Record<string, unknown>;
  const codes = Object.keys(DEFAULT_BINDINGS).map((key) => candidate[key]);
  if (codes.some((code) => typeof code !== "string" || !/^(Arrow(?:Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|Enter|Space|Escape|Home|End|Backspace|Delete|PageUp|PageDown)$/.test(code)) || new Set(codes).size !== codes.length) return { ...DEFAULT_BINDINGS };
  if (Object.entries(candidate).some(([key, code]) => key !== "back" && code === "Escape")) return { ...DEFAULT_BINDINGS };
  return Object.fromEntries(Object.keys(DEFAULT_BINDINGS).map((key) => [key, candidate[key]])) as MenuBindings;
}

export function keyLabel(code: string): string {
  const labels: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Space: "Space", Enter: "Enter", PageUp: "Page Up", PageDown: "Page Down" };
  return labels[code] || code.replace(/^Key|^Digit/, "");
}

export interface SettingsPageHandle {
  move(direction: Direction): void;
  edge?(last: boolean): void;
  activate(): void;
  reset(): void;
  focus(): void;
  cancel(): boolean;
}
