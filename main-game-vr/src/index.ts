import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CrownfallMenuSystem } from './crownfall-system.js';
import './entry.css';
const container = document.getElementById('scene-container');
const status = document.getElementById('quest-status');
if (!container) throw new Error('Crownfall scene container is missing');
World.create(container as HTMLDivElement, projectOptions).then(world => {
  world.registerSystem(CrownfallMenuSystem);
  document.body.dataset.boot = 'ready';
  if (status) status.textContent = 'Point and pinch, or touch a button. No controller required.';
}).catch(() => {
  document.body.dataset.boot = 'failed';
  if (status) status.textContent = 'Crownfall could not open. Check your connection and try again.';
  const retry = document.getElementById('retry-app'); if (retry) retry.hidden = false;
});
document.getElementById('retry-app')?.addEventListener('click', () => window.location.reload());
