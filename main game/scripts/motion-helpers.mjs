// Screen transitions may retain an inert outgoing layer briefly. Wait for the
// active screen before using CSS selectors that intentionally include both.
export async function waitForMenuIdle(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".menu-transition")]
    .every((element) => element.getAttribute("data-transition-state") === "idle"));
}

export async function waitForDialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  await waitForMenuIdle(page);
}
