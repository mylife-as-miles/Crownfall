import { MENU_LAYOUT, MENU_THEME } from "../../shared/menu/theme";

const widthUnit = (value: number): string => `${value / MENU_LAYOUT.reference.width * 100}cqw`;
const heightUnit = (value: number): string => `${value / MENU_LAYOUT.reference.height * 100}cqh`;

// Run before React mounts so desktop and immersive adapters read the same
// canonical palette and design grid without a first-frame theme change.
export function applyMenuTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(MENU_THEME.colors)) {
    const token = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    root.style.setProperty(`--menu-${token}`, value);
  }
  const tokens: Record<string, string> = {
    "--menu-font-primary": JSON.stringify(MENU_THEME.fonts.primary),
    "--menu-font-condensed": JSON.stringify(MENU_THEME.fonts.condensed),
    "--menu-heading-weight": String(MENU_THEME.fonts.headingWeight),
    "--menu-play-width": widthUnit(MENU_LAYOUT.play.width),
    "--menu-play-height": heightUnit(MENU_LAYOUT.play.height),
    "--menu-play-card-width": widthUnit(MENU_LAYOUT.play.cardWidth),
    "--menu-play-gap": widthUnit(MENU_LAYOUT.play.gap),
    "--menu-home-width": widthUnit(MENU_LAYOUT.home.width),
    "--menu-home-height": heightUnit(MENU_LAYOUT.home.height),
    "--menu-home-gap": widthUnit(MENU_LAYOUT.home.gap),
    "--menu-card-heading-size": widthUnit(MENU_LAYOUT.typography.cardHeading),
    "--menu-modal-heading-size": widthUnit(MENU_LAYOUT.typography.modalHeading),
    "--menu-modal-body-size": widthUnit(MENU_LAYOUT.typography.modalBody),
    "--menu-modal-action-size": widthUnit(MENU_LAYOUT.typography.modalAction),
    "--menu-modal-action-width": widthUnit(MENU_LAYOUT.modal.actionWidth),
    "--menu-modal-action-height": heightUnit(MENU_LAYOUT.modal.actionHeight),
    "--menu-modal-action-gap": widthUnit(MENU_LAYOUT.modal.actionGap),
  };
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
