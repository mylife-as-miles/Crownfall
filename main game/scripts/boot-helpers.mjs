// A completed first model frame is only one part of boot. Wait for the full
// asset/font gate and its exit before looking up or activating menu controls.
export async function waitForBootReady(page, { continueOnFailure = false, timeout = 120000 } = {}) {
  await page.locator(".menu-shell").waitFor({ state: "attached", timeout });
  if (continueOnFailure) {
    await page.waitForFunction(() => {
      const loading = document.querySelector(".loading-screen");
      return !loading || [...loading.querySelectorAll("button")].some((button) => button.textContent.trim().startsWith("Continue to menu"));
    }, undefined, { timeout });
    const button = page.getByRole("button", { name: "Continue to menu", exact: true });
    if (await button.count()) await button.click();
  }
  await page.locator(".loading-screen").waitFor({ state: "detached", timeout });
}
