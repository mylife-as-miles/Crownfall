// Run only through the existing IWSDK-managed browser runner.
export default async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.evaluate(() => localStorage.removeItem('crownfall.quest.visit-complete'));
  return { viewport: page.viewportSize(), url: page.url(), purpose: 'Screenshot framing and a fresh onboarding visit; comfort preferences retained.' };
};
