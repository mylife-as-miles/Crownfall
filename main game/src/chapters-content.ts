import type { Direction } from "./settings-types";

export interface ChapterItem {
  id: string;
  title: string;
  imageSrc: string;
  imagePosition: string;
  previewable: boolean;
  locked: boolean;
}

export const CHAPTER_COLUMNS = 5;
const artwork = ["new", "resume", "load", "browse"] as const;
const positions = ["42% 50%", "53% 50%", "60% 50%", "42% 50%", "75% 45%", "22% 50%", "15% 50%", "78% 50%", "12% 50%", "84% 50%", "36% 50%", "18% 50%", "62% 50%", "65% 50%"];

// These are numbered preview slots, not saved campaign progress. Final chapter
// titles and dedicated artwork can replace the supplied environment placeholders.
export const CHAPTERS: readonly ChapterItem[] = Array.from({ length: 14 }, (_, index) => ({
  id: `chapter-${String(index + 1).padStart(2, "0")}`,
  title: `Chapter ${String(index + 1).padStart(2, "0")}`,
  imageSrc: `/assets/environments/card-${artwork[index % artwork.length]}.webp`,
  imagePosition: positions[index],
  previewable: index < 2,
  locked: index >= 2,
}));

export function getNextChapter(index: number, direction: Direction, preferredColumn = index % CHAPTER_COLUMNS): number {
  const current = Math.max(0, Math.min(CHAPTERS.length - 1, index));
  const row = Math.floor(current / CHAPTER_COLUMNS);
  if (direction === "left" || direction === "right") {
    const first = row * CHAPTER_COLUMNS;
    const last = Math.min(first + CHAPTER_COLUMNS - 1, CHAPTERS.length - 1);
    return Math.max(first, Math.min(last, current + (direction === "left" ? -1 : 1)));
  }
  const lastRow = Math.floor((CHAPTERS.length - 1) / CHAPTER_COLUMNS);
  const nextRow = Math.max(0, Math.min(lastRow, row + (direction === "up" ? -1 : 1)));
  return Math.min(nextRow * CHAPTER_COLUMNS + preferredColumn, CHAPTERS.length - 1);
}
