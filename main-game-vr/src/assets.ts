import { AssetType, defineAssets } from '@iwsdk/core';
import { CHRONICLES_MAP, CHRONICLES_TITLE } from '../../shared/chronicles/content';
import { ARENAS } from '../../shared/menu/content';
import { QUEST_CHRONICLE_IDS } from './ui-contract.js';
import atmosphere from './scene-assets/atmosphere.scene-asset.js';
const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
export default defineAssets({
  'crownfall-atmosphere': atmosphere,
  'crownfall-menu': { url: publicUrl('ui/menu.uikitml'), type: AssetType.UIKitML, name: 'Crownfall Menu' },
  sorcerer: { url: publicUrl('models/crownfall-sorcerer.glb'), type: AssetType.GLTF, name: 'Crownfall Sorcerer', priority: 'lazy' },
  ...Object.fromEntries(ARENAS.map((arena, index) => [`arena-${index}`, { url: publicUrl(arena.source), type: AssetType.Texture, name: arena.label, priority: 'lazy' as const }])),
  // The Atlas diorama's albedo; the Home tile draws the same synced file.
  [QUEST_CHRONICLE_IDS.mapAsset]: { url: publicUrl(CHRONICLES_MAP.src), type: AssetType.Texture, name: CHRONICLES_TITLE, priority: 'lazy' },
});
