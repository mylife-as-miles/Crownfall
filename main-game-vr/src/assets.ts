import { AssetType, defineAssets } from '@iwsdk/core';
import { ARENAS } from '../../shared/menu/content';
import atmosphere from './scene-assets/atmosphere.scene-asset.js';
import { LEGACY_UI_LAYOUT } from './legacy/legacy-ui-contract.js';
const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
export default defineAssets({
  'crownfall-atmosphere': atmosphere,
  'crownfall-menu': { url: publicUrl('ui/menu.uikitml'), type: AssetType.UIKitML, name: 'Crownfall Menu' },
  [LEGACY_UI_LAYOUT.panelManifestId]: { url: publicUrl(LEGACY_UI_LAYOUT.panelDocumentPath), type: AssetType.UIKitML, name: 'My Legacy Panel' },
  [LEGACY_UI_LAYOUT.dockManifestId]: { url: publicUrl(LEGACY_UI_LAYOUT.dockDocumentPath), type: AssetType.UIKitML, name: 'My Legacy Dock' },
  sorcerer: { url: publicUrl('models/crownfall-sorcerer.glb'), type: AssetType.GLTF, name: 'Crownfall Sorcerer', priority: 'lazy' },
  ...Object.fromEntries(ARENAS.map((arena, index) => [`arena-${index}`, { url: publicUrl(arena.source), type: AssetType.Texture, name: arena.label, priority: 'lazy' as const }])),
});
