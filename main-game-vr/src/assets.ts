import { AssetType, defineAssets } from '@iwsdk/core';
import { ARENAS } from '../../shared/menu/content';
import atmosphere from './scene-assets/atmosphere.scene-asset.js';
import { LEGACY_MANIFEST } from './legacy/legacy-manifest.js';
const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
export default defineAssets({
  'crownfall-atmosphere': atmosphere,
  'crownfall-menu': { url: publicUrl('ui/menu.uikitml'), type: AssetType.UIKitML, name: 'Crownfall Menu' },
  // My Legacy's panels load on its first entry, never before Home is interactive.
  [LEGACY_MANIFEST.panelManifestId]: { url: publicUrl(LEGACY_MANIFEST.panelDocumentPath), type: AssetType.UIKitML, name: 'My Legacy Panel', priority: 'lazy' },
  [LEGACY_MANIFEST.dockManifestId]: { url: publicUrl(LEGACY_MANIFEST.dockDocumentPath), type: AssetType.UIKitML, name: 'My Legacy Dock', priority: 'lazy' },
  sorcerer: { url: publicUrl('models/crownfall-sorcerer.glb'), type: AssetType.GLTF, name: 'Crownfall Sorcerer', priority: 'lazy' },
  ...Object.fromEntries(ARENAS.map((arena, index) => [`arena-${index}`, { url: publicUrl(arena.source), type: AssetType.Texture, name: arena.label, priority: 'lazy' as const }])),
});
