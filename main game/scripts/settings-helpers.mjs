import assert from "node:assert/strict";

export const categoryName = (name) => new RegExp(`^${name}$`, "i");
export const grid = (page) => page.getByRole("region", { name: "Settings categories", exact: true });
export async function openCategory(page, name) {
  if (await page.locator("dialog").evaluate((dialog) => dialog.open)) await page.keyboard.press("Escape");
  for (let attempt = 0; attempt < 3 && await page.locator(".settings-detail").count(); attempt++) await page.keyboard.press("Escape");
  if (!await page.locator(".settings-grid").count()) await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await grid(page).waitFor();
  await grid(page).getByRole("button", { name: categoryName(name) }).click();
  await page.locator(".settings-detail").waitFor();
}
export async function leaveSettings(page) {
  for (let attempt = 0; attempt < 4 && await page.locator(".settings-detail, .settings-grid").count(); attempt++) await page.keyboard.press("Escape");
  assert.equal(await page.locator(".settings-detail, .settings-grid").count(), 0);
}
export async function setMotion(page, enabled) {
  await openCategory(page, "General");
  const toggle = page.getByRole("switch", { name: /^Ambient Motion$/i });
  if ((await toggle.getAttribute("aria-checked") === "true") !== enabled) await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), String(enabled));
}
