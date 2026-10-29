// Playwright step for capture-chronicles.mjs, run through `iwsdk browser run`
// (the runtime must start with --allow-browser-automation). CROWNFALL_STEP picks:
// - frame (default): a 1280 x 720 frame of the runtime app;
// - preferences: a reload with saved comfort preferences, applied at start without a recentre;
// - visibility: the emulated headset's own visibility state (visible or visible-blurred),
//   so a blur reaches the app through the XR session exactly as a system menu would;
// - probe: CDP heap sampling and long tasks over idle frames, with every sampled
//   allocation attributed to the call stack that made it.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const step = process.env.CROWNFALL_STEP;
  if (step === 'preferences') {
    await app.evaluate((preferences) => {
      localStorage.setItem('crownfall.quest.preferences', preferences);
      localStorage.setItem('crownfall.quest.visit-complete', 'true');
      setTimeout(() => location.reload(), 50);
    }, process.env.CROWNFALL_PREFERENCES);
    return { preferences: JSON.parse(process.env.CROWNFALL_PREFERENCES) };
  }
  if (step === 'visibility') {
    return app.evaluate((state) => {
      const device = window.IWER_DEVICE;
      if (!device || typeof device.updateVisibilityState !== 'function') return { applied: false, reason: 'no emulated device' };
      device.updateVisibilityState(state);
      return { applied: true, state, deviceVisibility: device.visibilityState ?? null };
    }, process.env.CROWNFALL_VISIBILITY);
  }
  if (step === 'entry-card') {
    // The page's browser entry card overlays the lower left of the canvas, where the
    // monument sits in the browser preview; captures and clicks there hide it.
    return app.evaluate((visibility) => {
      const card = document.querySelector('.quest-entry');
      if (card) card.style.visibility = visibility === 'hidden' ? 'hidden' : '';
      return { card: !!card, visibility };
    }, process.env.CROWNFALL_CARD);
  }
  if (step === 'shot') {
    // A frame at the managed window's own size, for XR: resizing would change the emulator's canvas.
    const switcher = await page.$('.workspace-view-switcher');
    await switcher?.evaluate((element) => { element.style.visibility = 'hidden'; });
    try {
      const iframe = await page.$('iframe'), box = await iframe.boundingBox(), started = Date.now();
      await iframe.screenshot({ path: process.env.CROWNFALL_FRAME, timeout: 90000 });
      return { path: process.env.CROWNFALL_FRAME, width: Math.round(box.width), height: Math.round(box.height), ms: Date.now() - started };
    } finally { await switcher?.evaluate((element) => { element.style.visibility = ''; }); }
  }
  if (step === 'probe') return probe(page, app);
  if (step === 'click-frame') return clickFrame(page);
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

// A real click followed by a frame a moment later, in one lease, at the managed
// window's own size. A frame takes several seconds to capture on this software
// renderer, longer than the room takes to build, so the step can hold the page's
// CPU at a CDP throttle (CROWNFALL_THROTTLE, recorded in the manifest) while the
// frame is taken: the loading bar is the app's own, it simply lasts longer, as it
// would on a slower device.
async function clickFrame(page) {
  const switcher = await page.$('.workspace-view-switcher');
  await switcher?.evaluate((element) => { element.style.visibility = 'hidden'; });
  const iframe = await page.$('iframe'), box = await iframe.boundingBox();
  const x = box.x + Number(process.env.CROWNFALL_CLICK_X), y = box.y + Number(process.env.CROWNFALL_CLICK_Y);
  const throttle = Number(process.env.CROWNFALL_THROTTLE || 1);
  const cdp = throttle > 1 ? await page.context().newCDPSession(page) : null;
  try {
    // The canvas pointer system reads input once per frame: move, then press and release a frame apart.
    await page.mouse.move(x, y);
    await page.waitForTimeout(350);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    const clickedAt = Date.now();
    // The click itself is unthrottled; only the build that follows runs under the throttle.
    if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.waitForTimeout(Number(process.env.CROWNFALL_AFTER_CLICK || 500));
    await iframe.screenshot({ path: process.env.CROWNFALL_FRAME, timeout: 60000 });
    return { path: process.env.CROWNFALL_FRAME, width: Math.round(box.width), height: Math.round(box.height), click: { x: Number(process.env.CROWNFALL_CLICK_X), y: Number(process.env.CROWNFALL_CLICK_Y) }, capturedAfterMs: Date.now() - clickedAt, cpuThrottle: throttle };
  } finally {
    if (cdp) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
    await switcher?.evaluate((element) => { element.style.visibility = ''; });
  }
}

// Idle frames with the archive open: sample allocations (including those the
// garbage collector already took) and long tasks, then attribute every sample
// by its stack to the Chronicles modules, the menu system, IWSDK and the rest.
async function probe(page, app) {
  const frames = Number(process.env.CROWNFALL_FRAMES || 600);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await app.evaluate(() => {
    window.__chroniclesLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__chroniclesLongTasks.push(Math.round(entry.duration)); });
      observer.observe({ type: 'longtask', buffered: false });
      window.__chroniclesLongTaskObserver = observer;
    } catch { window.__chroniclesLongTasks = null; }
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = await app.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const started = Date.now();
  const counted = await app.evaluate((target) => new Promise((resolve) => {
    let count = 0;
    const t0 = performance.now();
    const tick = () => { count++; if (count >= target) resolve({ frames: count, ms: Math.round(performance.now() - t0) }); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // Managed browser scripts are leased for at most 110 s; a window ends at 90 s.
    setTimeout(() => resolve({ frames: count, ms: Math.round(performance.now() - t0), timedOut: true }), 90000);
  }), frames);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await app.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
  const longTasks = await app.evaluate(() => { window.__chroniclesLongTaskObserver?.disconnect(); return window.__chroniclesLongTasks; });
  await cdp.detach();

  // Index the sampled call tree, then classify every sample by its stack: the owner of
  // its deepest attributable frame, and for samples with a Chronicles frame on the
  // stack, that frame's file (the controller, the interim room or the room's renderer).
  const nodes = new Map(), byOwner = {}, byChroniclesFile = {};
  let total = 0, sampleCount = 0;
  const owner = (url) => (/\/src\/chronicles\//u.test(url) ? 'chronicles'
    : /\/src\/crownfall-system\.ts/u.test(url) ? 'menu-system'
      : /\/src\//u.test(url) ? 'app'
        : /iwsdk|elics|uikit|pointer-events|preact|signals/u.test(url) ? 'iwsdk-uikit'
          : /three/u.test(url) ? 'three' : url ? 'other' : 'native');
  const index = (node, stack) => {
    const here = { fn: node.callFrame.functionName || '(anonymous)', url: node.callFrame.url.replace(/^https?:\/\/[^/]+/u, '').replace(/\?.*$/u, ''), line: node.callFrame.lineNumber + 1 };
    const path = stack.concat(here);
    nodes.set(node.id, path);
    for (const child of node.children) index(child, path);
  };
  index(profile.head, []);
  const chronicles = new Map(), updates = new Map();
  for (const sample of profile.samples || []) {
    const path = nodes.get(sample.nodeId) || [];
    const here = path[path.length - 1] || { fn: '(unknown)', url: '', line: 0 };
    total += sample.size; sampleCount++;
    const attributed = [...path].reverse().find((item) => !['native', 'other'].includes(owner(item.url))) ?? here;
    const bucket = owner(attributed.url);
    byOwner[bucket] = byOwner[bucket] || { samples: 0, bytes: 0 };
    byOwner[bucket].samples++; byOwner[bucket].bytes += sample.size;
    const ours = path.filter((item) => /\/src\/chronicles\//u.test(item.url));
    if (!ours.length) continue;
    const deepest = ours[ours.length - 1], file = deepest.url.replace(/^.*\/src\/chronicles\//u, '');
    byChroniclesFile[file] = byChroniclesFile[file] || { samples: 0, bytes: 0, underUpdate: 0 };
    byChroniclesFile[file].samples++; byChroniclesFile[file].bytes += sample.size;
    const key = `${deepest.fn} ${deepest.url} <- top ${here.fn}`;
    chronicles.set(key, (chronicles.get(key) || 0) + 1);
    if (path.some((item) => /update/u.test(item.fn))) {
      byChroniclesFile[file].underUpdate++;
      const trail = path.slice(-6).map((item) => `${item.fn} ${item.url}`).join(' <- ');
      updates.set(trail, (updates.get(trail) || 0) + 1);
    }
  }
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([where, samples]) => ({ where, samples }));
  const underUpdate = Object.values(byChroniclesFile).reduce((sum, item) => sum + item.underUpdate, 0);
  return {
    frames: counted, wallMs: Date.now() - started, samplingIntervalBytes: 256,
    samples: sampleCount, sampledBytes: total, estimatedAllocatedBytes: sampleCount * 256,
    byOwner, byChroniclesFile, chroniclesTop: top(chronicles), roomOrControllerUpdateSamples: underUpdate, roomOrControllerUpdateTop: top(updates),
    heapBefore, heapAfter, longTasks,
  };
}
