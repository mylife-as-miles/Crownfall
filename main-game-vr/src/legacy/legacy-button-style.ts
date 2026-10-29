// Button visuals for the Legacy panels, applied from code. UIKit's class-based
// :hover conditional could stay applied after a button was hidden while hovered
// (its colours no longer followed the pointer), and the kit's <button> adds its
// own hover and pressed conditionals. The generated controls are therefore plain
// containers with base classes only, and every state change sets explicit
// properties chosen here.

import { LEGACY_UI_COLORS } from './legacy-ui-contract.js';

export type LegacyButtonVariant = 'button' | 'primary' | 'danger';

export interface LegacyButtonState {
  enabled: boolean;
  /** Only meaningful for selectable controls (nations, names, presets, members, files, landmarks, Shift). */
  selected: boolean;
  hovered: boolean;
}

export interface LegacyButtonStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  opacity: number;
}

const c = LEGACY_UI_COLORS;

const BASE: Readonly<Record<LegacyButtonVariant, LegacyButtonStyle>> = {
  button: { backgroundColor: c.button, borderColor: c.buttonBorder, borderWidth: 1.5, opacity: 1 },
  primary: { backgroundColor: c.primary, borderColor: c.primaryBorder, borderWidth: 2, opacity: 1 },
  danger: { backgroundColor: c.danger, borderColor: c.dangerBorder, borderWidth: 1.5, opacity: 1 },
};

const HOVER: Readonly<Record<LegacyButtonVariant, Pick<LegacyButtonStyle, 'backgroundColor' | 'borderColor'>>> = {
  button: { backgroundColor: c.buttonHover, borderColor: c.primaryBorder },
  primary: { backgroundColor: c.primaryHover, borderColor: c.selectedBorder },
  danger: { backgroundColor: c.dangerHover, borderColor: c.dangerHoverBorder },
};

/** The explicit look of a control: selection outranks hover, and a disabled control never lights up. */
export function legacyButtonStyle(variant: LegacyButtonVariant, state: LegacyButtonState): LegacyButtonStyle {
  const base = BASE[variant];
  if (!state.enabled) return { ...base, opacity: 0.42 };
  if (state.selected) {
    return { backgroundColor: c.selected, borderColor: state.hovered ? c.selectedHoverBorder : c.selectedBorder, borderWidth: 2.5, opacity: 1 };
  }
  if (state.hovered) return { ...base, ...HOVER[variant] };
  return base;
}

/** A compact cache key, so unchanged styles are never re-applied. */
export function legacyButtonStyleKey(style: LegacyButtonStyle): string {
  return `${style.backgroundColor}${style.borderColor}${style.borderWidth}${style.opacity}`;
}
