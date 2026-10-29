// Quest material factory: shared MaterialDefinitions → unlit MeshBasicMaterials with
// baked vertex light, 512 px albedo maps loaded through the IWSDK AssetManager, the
// heraldry atlas for alpha-tested cloth, and the shared shader patch.

import { AssetManager, Color, DoubleSide, FrontSide, LinearMipmapLinearFilter, MeshBasicMaterial, RepeatWrapping, SRGBColorSpace } from '@iwsdk/core';
import type { Material, Texture, WebGLRenderer } from '@iwsdk/core';
import type { MaterialDefinition, MaterialLibrary, TextureSetId } from '../../../../shared/legacy/environment/materials';
import type { MeshMotion } from '../../../../shared/legacy/environment/kernel/mesh';
import { VR_SECTION_MATERIAL } from '../../../../shared/legacy/environment/vr/miniature';
import { patchQuestMaterial } from './shaderPatch';
import type { QuestUniforms } from './shaderPatch';

interface TextureManifest {
  version: 1;
  sets: Record<string, { tileMetres: number; files: Record<string, { file: string; size: number }> }>;
}

const publicUrl = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;

/** Albedo maps (512 px) per texture set, loaded through AssetManager; repeat clones share the GPU image. */
export class QuestTextureLibrary {
  private base = new Map<string, Texture>();
  private clones = new Map<string, Texture>();

  static async load(baseUrl: string, wanted: ReadonlySet<TextureSetId>): Promise<QuestTextureLibrary> {
    const lib = new QuestTextureLibrary();
    let manifest: TextureManifest | null = null;
    try {
      const res = await fetch(publicUrl(`${baseUrl}manifest.json`), { cache: 'no-cache' });
      if (res.ok) manifest = (await res.json()) as TextureManifest;
    } catch {
      manifest = null;
    }
    if (!manifest) return lib;
    const jobs: Promise<void>[] = [];
    for (const id of Array.from(wanted)) {
      const set = manifest.sets[id];
      const entry = set ? set.files.albedo_512 ?? set.files.albedo : undefined;
      if (!entry) continue;
      jobs.push(AssetManager.loadTexture(publicUrl(`${baseUrl}${entry.file}`)).then((t) => {
        lib.base.set(id, t);
      }).catch(() => undefined));
    }
    await Promise.all(jobs);
    return lib;
  }

  has(id: TextureSetId): boolean {
    return this.base.has(id);
  }

  /** A clone configured for sRGB albedo with a world-metre repeat. */
  get(id: TextureSetId, repeat: number): Texture | null {
    const base = this.base.get(id);
    if (!base) return null;
    const key = `${id}:${repeat.toFixed(4)}`;
    let t = this.clones.get(key);
    if (!t) {
      t = base.clone();
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = 2;
      t.needsUpdate = true;
      this.clones.set(key, t);
    }
    return t;
  }

  /** Uploads every clone now (one texture per yield) so the first frames never stall on uploads. */
  async upload(renderer: WebGLRenderer, alive: () => boolean): Promise<void> {
    for (const t of Array.from(this.clones.values())) {
      if (!alive()) return;
      renderer.initTexture(t);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Estimated GPU bytes (RGBA8 + mips) of the distinct images. */
  gpuBytes(): number {
    let bytes = 0;
    this.base.forEach((t) => {
      const img = t.image as { width?: number; height?: number } | null;
      if (img && img.width && img.height) bytes += img.width * img.height * 4 * (4 / 3);
    });
    return Math.round(bytes);
  }

  count(): number {
    return this.base.size;
  }

  dispose(): void {
    // Clones release their GPU textures; the AssetManager keeps the cached source images.
    this.clones.forEach((t) => t.dispose());
    this.clones.clear();
    this.base.clear();
  }
}

/** Texture sets the given material keys resolve to. */
export function texturesFor(lib: MaterialLibrary, keys: Iterable<string>): Set<TextureSetId> {
  const out = new Set<TextureSetId>();
  for (const key of Array.from(keys)) {
    if (key === VR_SECTION_MATERIAL) {
      out.add('rock');
      continue;
    }
    const def = lib.get(key);
    if (def.texture && def.quest.textured && def.shading !== 'terrain' && def.shading !== 'silhouette') out.add(def.texture);
  }
  return out;
}

export interface QuestMaterialFactoryOptions {
  lib: MaterialLibrary;
  uniforms: QuestUniforms;
  textures: QuestTextureLibrary;
  atlas: Texture;
}

function linear(hex: string, intensity = 1): Color {
  return new Color(hex).multiplyScalar(intensity);
}

export class QuestMaterialFactory {
  private cache = new Map<string, Material>();
  private readonly o: QuestMaterialFactoryOptions;

  constructor(o: QuestMaterialFactoryOptions) {
    this.o = o;
  }

  /** Whether a material key may dissolve for the occlusion reveal (never figures, ground, water, sky or light sources). */
  revealable(key: string): boolean {
    if (key === VR_SECTION_MATERIAL || key === 'figure') return false;
    const shading = this.o.lib.get(key).shading;
    return shading === 'standard' || shading === 'foliage' || shading === 'cloth' || (shading === 'glass' && !this.o.lib.get(key).emissive);
  }

  get(key: string, motion: MeshMotion | null, instancedSway: { amplitude: number; frequency: number } | null, reveal = false): Material {
    const mk = `${key}|${motion ? JSON.stringify(motion) : '-'}|${instancedSway ? `${instancedSway.amplitude}:${instancedSway.frequency}` : '-'}|${reveal ? 'r' : ''}`;
    let m = this.cache.get(mk);
    if (!m) {
      m = this.create(key, motion, instancedSway, reveal);
      m.name = `bannerhold:${mk}`;
      this.cache.set(mk, m);
    }
    return m;
  }

  private map(def: MaterialDefinition): Texture | null {
    if (!def.texture || !def.quest.textured) return null;
    const repeat = def.uvSpace === 'world' ? 1 / Math.max(0.05, def.textureScale) : 1;
    return this.o.textures.get(def.texture, repeat);
  }

  private create(key: string, motion: MeshMotion | null, sway: { amplitude: number; frequency: number } | null, reveal: boolean): Material {
    const U = this.o.uniforms;
    if (key === VR_SECTION_MATERIAL) {
      const mat = new MeshBasicMaterial({ color: new Color(1, 1, 1), map: this.o.textures.get('rock', 1 / 6), vertexColors: true });
      patchQuestMaterial(mat, U, { relight: true, section: true });
      return mat;
    }
    const def = this.o.lib.get(key);
    const cloth = motion && motion.kind === 'cloth' ? { amplitude: motion.amplitude, frequency: motion.frequency } : undefined;
    const flicker = motion && motion.kind === 'flicker' ? { rate: motion.rate, depth: motion.depth } : undefined;
    switch (def.shading) {
      case 'terrain': {
        const mat = new MeshBasicMaterial({ color: new Color(1, 1, 1), vertexColors: true });
        patchQuestMaterial(mat, U, {});
        return mat;
      }
      case 'cloth': {
        const atlas = def.uvSpace === 'unit';
        const map = atlas ? this.o.atlas : this.map(def);
        const mat = new MeshBasicMaterial({
          color: atlas ? new Color(0.92, 0.9, 0.88) : linear(map ? def.color : def.quest.color),
          map,
          vertexColors: true,
          side: DoubleSide,
          alphaTest: atlas ? 0.5 : 0,
        });
        patchQuestMaterial(mat, U, { highlight: true, relight: true, reveal, cloth: cloth ?? { amplitude: 0.1, frequency: 1.1 } });
        return mat;
      }
      case 'foliage': {
        const map = this.map(def);
        const mat = new MeshBasicMaterial({ color: linear(map ? def.color : def.quest.color), map, vertexColors: true, side: def.doubleSided ? DoubleSide : FrontSide });
        patchQuestMaterial(mat, U, sway ? { sway, relight: true, reveal } : { relight: true, reveal });
        return mat;
      }
      case 'glass': {
        const lit = !!def.emissive;
        const mat = new MeshBasicMaterial({ color: lit ? linear(def.emissive?.color ?? '#f08a32', (def.emissive?.intensity ?? 1.3) * 1.6) : linear(def.color, 0.9), vertexColors: !lit });
        patchQuestMaterial(mat, U, lit ? { highlight: true, flicker: { rate: 0.9, depth: 0.12 } } : { highlight: true, relight: true, reveal });
        return mat;
      }
      case 'emissive': {
        const mat = new MeshBasicMaterial({ color: linear(def.emissive?.color ?? def.color, (def.emissive?.intensity ?? 3) * 0.9) });
        patchQuestMaterial(mat, U, { flicker: flicker ?? { rate: 8, depth: 0.35 } });
        return mat;
      }
      case 'water': {
        const mat = new MeshBasicMaterial({ color: linear(def.quest.color, 0.8) });
        patchQuestMaterial(mat, U, { water: true });
        return mat;
      }
      case 'silhouette': {
        const mat = new MeshBasicMaterial({ color: linear(def.quest.color, 1.1), vertexColors: true });
        patchQuestMaterial(mat, U, {});
        return mat;
      }
      default: {
        const map = this.map(def);
        const metal = def.metalness > 0.5;
        const base = map ? def.color : def.quest.color;
        // Metals have no specular here: lift them slightly so gilt and bronze still read as accents.
        const mat = new MeshBasicMaterial({ color: linear(base, metal ? 1.35 : 1), map, vertexColors: true, side: def.doubleSided ? DoubleSide : FrontSide });
        const highlight = key !== 'figure';
        const rv = reveal && key !== 'figure';
        patchQuestMaterial(mat, U, cloth ? { highlight, relight: true, cloth, reveal: rv } : flicker ? { highlight, flicker } : { highlight, relight: true, reveal: rv });
        return mat;
      }
    }
  }

  materials(): Material[] {
    return Array.from(this.cache.values());
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}
