// Approved Crownfall design values. Platform adapters choose physical units and
// minimum hit areas while preserving this common visual identity and hierarchy.
export const MENU_THEME = {
  fonts: { primary: "Barlow", condensed: "Barlow Condensed", headingWeight: 600 },
  colors: {
    background: "#100d08",
    surface: "#32291a",
    text: "#cdc6b8",
    inactiveHeading: "#b5b2ac",
    accent: "#bf791a",
    activeTab: "#f87b00",
    focus: "#df8a26",
    modalHeading: "#d49130",
    modalText: "#aaa79d",
    tealRim: "#63edce",
  },
} as const;

// Desktop reference geometry is retained as a design grid. XR scales the grid
// into world units and applies its own comfort and hand-target minimums.
export const MENU_LAYOUT = {
  reference: { width: 1280, height: 720 },
  play: { x: 139, y: 211, width: 800, height: 298, cardWidth: 197, cardHeight: 298, gap: 4, columns: 4 },
  home: { x: 105.3333376, y: 160, width: 600, height: 434, leftWidth: 298, rightWidth: 298, rightHeight: 215, gap: 4 },
  chapters: { x: 105, y: 112, width: 936, height: 420, columns: 5, rows: 3, gap: 0 },
  navigation: { gap: 24, widths: [96, 86.016, 156, 138] },
  typography: { cardHeading: 18.6666624, modalHeading: 20, modalBody: 16, modalAction: 18 },
  modal: { headingTop: 160, bodyTop: 226, actionTop: 348, actionWidth: 128, actionHeight: 32, actionGap: 64 },
} as const;

export const CARD_ART_POSITIONS = {
  new: "15% 50%",
  resume: "82% 50%",
  load: "58% 50%",
  browse: "64% 50%",
} as const;

export const MENU_ASSETS = {
  sorcerer: "/models/crownfall-sorcerer.glb",
  illustration: "/assets/creature.webp",
} as const;
