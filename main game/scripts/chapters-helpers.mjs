import { waitForMenuIdle } from "./motion-helpers.mjs";

export const chapterName = (number) => `Chapter ${String(number).padStart(2, "0")}`;
export const chaptersRegion = (page) => page.getByRole("region", { name: "Chapters", exact: true });
export const chapterGrid = (page) => chaptersRegion(page).locator(".chapters-grid");
export async function openChapters(page) {
  if (!await chapterGrid(page).count()) {
    await page.getByRole("tab", { name: "Play", exact: true }).click();
    await waitForMenuIdle(page);
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
  }
  await waitForMenuIdle(page);
  await chapterGrid(page).waitFor();
}
