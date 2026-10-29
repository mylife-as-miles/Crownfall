// Playwright step for capture-chronicles.mjs, run through `iwsdk browser run`:
// either a 1280 x 720 frame of the runtime app or a reload with saved
// comfort preferences, which the app applies at start without a recenter.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  if (process.env.CROWNFALL_STEP === 'preferences') {
    await app.evaluate((preferences) => {
      localStorage.setItem('crownfall.quest.preferences', preferences);
      localStorage.setItem('crownfall.quest.visit-complete', 'true');
      setTimeout(() => location.reload(), 50);
    }, process.env.CROWNFALL_PREFERENCES);
    return { preferences: JSON.parse(process.env.CROWNFALL_PREFERENCES) };
  }
  const resize = (width, height) => page.evaluate(([w, h]) => {
    const switcher = document.querySelector('.workspace-view-switcher');
    if (switcher) switcher.style.visibility = w ? 'hidden' : '';
    for (const element of document.querySelectorAll('iframe')) { element.style.width = w; element.style.height = h; }
  }, [width, height]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await resize('1280px', '720px');
  // Software rendering is slow; let several frames draw at the new size.
  await page.waitForTimeout(Number(process.env.CROWNFALL_SETTLE || 9000));
  await (await page.$('iframe')).screenshot({ path: process.env.CROWNFALL_FRAME, timeout: 60000 });
  await resize('', '');
  await page.setViewportSize({ width: 780, height: 493 });
  return { path: process.env.CROWNFALL_FRAME, width: 1280, height: 720 };
}
