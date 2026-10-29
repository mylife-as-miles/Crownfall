/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateQuestUI } from '../scripts/generate-quest-ui';
import { menuPublicSource, syncMenuAssets } from '../scripts/sync-menu-assets.mjs';

// Optional hook owned by the Legacy environment workflow (docs/legacy/WORKFLOWS.md):
// mirrors canonical environment assets from the desktop app once that script exists.
const environmentAssets = fileURLToPath(new URL('../scripts/sync-legacy-environment-assets.mjs', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'crownfall-shared-menu',
    async configResolved() {
      syncMenuAssets();
      if (existsSync(environmentAssets)) await (await import(pathToFileURL(environmentAssets).href)).syncLegacyEnvironmentAssets();
      await generateQuestUI(fileURLToPath(new URL('./public/ui/menu.uikitml', import.meta.url)));
    },
    configureServer(server) {
      const shared = fileURLToPath(new URL('../shared/menu/', import.meta.url));
      server.watcher.add([shared, menuPublicSource]);
      const update = (file: string) => {
        if (file.startsWith(shared) || file.startsWith(menuPublicSource)) void server.restart();
      };
      server.watcher.on('change', update);
      server.httpServer?.once('close', () => server.watcher.off('change', update));
    },
  }, iwsdkDev()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
