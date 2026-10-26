import { AssetType, defineAssets } from '@iwsdk/core';
import { ARENAS } from '../../shared/menu/content';
import atmosphere from './scene-assets/atmosphere.scene-asset.js';
const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
export default defineAssets({
  'crownfall-atmosphere': atmosphere,
  'crownfall-menu': { url: publicUrl('ui/menu.uikitml'), type: AssetType.UIKitML, name: 'Crownfall Menu' },
  sorcerer: { url: publicUrl('models/crownfall-sorcerer.glb'), type: AssetType.GLTF, name: 'Crownfall Sorcerer', priority: 'lazy' },
  ...Object.fromEntries(ARENAS.map((arena, index) => [`arena-${index}`, { url: publicUrl(arena.source), type: AssetType.Texture, name: arena.label, priority: 'lazy' as const }])),
});
