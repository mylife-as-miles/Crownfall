export type HomeTileId = "feature" | "upper" | "lower";
export type HomeTileAction = "legacy" | "chronicles" | "herald";
export type HomeDirection = "left" | "right" | "up" | "down";

// The tall tile occupies both rows. Returning right restores the last right
// tile; outer edges clamp rather than wrapping across an unrelated cell.
export function getNextHomeTile(
  current: number,
  direction: HomeDirection,
  lastRightIndex = 1,
): number {
  if (direction === "left") return 0;
  if (direction === "right")
    return current === 0 ? (lastRightIndex === 2 ? 2 : 1) : current;
  if (direction === "up") return current === 2 ? 1 : current;
  return current === 1 ? 2 : current;
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

// Titles and images are supplied content. Actions open the matching Home
// information panel; they do not claim a completed progression or news system.
export const HOME_CONTENT: HomeContent = [
  {
    id: "feature",
    title: "My Legacy",
    imageSrc: "/assets/home/my-legacy.webp",
    action: "legacy",
  },
  {
    id: "upper",
    title: "Chronicles",
    imageSrc: "/assets/home/chronicles.webp",
    imageFit: "contain",
    action: "chronicles",
  },
  {
    id: "lower",
    title: "Herald Board",
    imageSrc: "/assets/home/herald-board.webp",
    action: "herald",
  },
];
