// Explicit entry keeps the actual browser user-gesture path under test when
// automatic WebXR session offers are disabled by the application.
export function enterQuestXR(cli) {
  if (cli('xr', 'status').sessionActive) return;
  let entry;
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = cli('browser', 'snapshot', {});
    entry = snapshot.elements.find(element => element.role === 'button' && element.name === 'Enter VR' && element.visible && !element.disabled);
    if (entry || snapshot.elements.some(element => element.name === 'Try again' && element.visible)) break;
  }
  if (!entry) throw Error('Crownfall browser Enter VR button is not ready');
  cli('browser', 'interact', { steps: [{ action: 'click', ref: entry.ref }] });
}
