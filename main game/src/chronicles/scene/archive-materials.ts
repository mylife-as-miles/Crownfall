import * as THREE from "three";
import {
  ARCHIVE_MATERIALS, getArchiveTexture, texturePath, textureSizeFor, type MaterialDescriptor, type TextureKind,
} from "../../../../shared/chronicles/archive/materials";
import type { Quality } from "../../settings-types";

// The archive's material family on desktop, built from the shared descriptors
// and the generated textures. Stone and bronze are physically based, with
// albedo, normal and ORM maps (occlusion, roughness and metalness in R, G and
// B) at the preset's size; UVs are in metres, so each map repeats once per the
// material's tile. Lamp cores and the sky are plain glowing colours. The
// "quest-preview" mode reproduces Quest's unlit look (its baked lit albedo) for
// the harness, so both platforms' materials can be compared side by side.

export type ArchiveMaterialMode = "desktop" | "quest-preview";

export interface ArchiveMaterialsOptions {
  quality: Quality;
  mode?: ArchiveMaterialMode;
  anisotropy: number;
  /** Multiplies every surface by the vertex colours (the baked light). */
  vertexColors?: boolean;
  /** Reflections for bronze and the polished floor. */
  environment?: THREE.Texture | null;
}

export interface ArchiveMaterials {
  /** Fetches and decodes every texture the preset needs, reporting a monotonic share. */
  load(onProgress?: (share: number) => void): Promise<void>;
  /** The material for a descriptor id; created once, after load. */
  get(id: string): THREE.Material;
  /** Uploads every texture now, so no upload lands on an interactive frame. */
  upload(renderer: THREE.WebGLRenderer): void;
  readonly textureCount: number;
  /** Estimated GPU bytes: 4 per texel with mipmaps. */
  readonly textureBytes: number;
  dispose(): void;
}

/** Reflection strength per material: stone reflects a little, polished floor and bronze more. */
const ENVIRONMENT: Readonly<Record<string, number>> = { "floor-stone": 0.9, bronze: 1.1, basalt: 0.5 };

function linearColor(hex: string, scale = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(scale);
}

export function createArchiveMaterials(options: ArchiveMaterialsOptions): ArchiveMaterials {
  const mode = options.mode ?? "desktop";
  const platform = mode === "desktop" ? "desktop" : "quest";
  const bitmaps = new Map<string, Promise<ImageBitmap>>();
  const decoded = new Map<string, ImageBitmap>();
  const textures: THREE.Texture[] = [];
  const materials = new Map<string, THREE.Material>();
  let textureBytes = 0;
  let disposed = false;

  const sizeFor = (descriptor: MaterialDescriptor, kind: TextureKind) => {
    const texture = getArchiveTexture(descriptor.textures[kind]!)!;
    return texture.kind === "mask" ? texture.sizes[0] : textureSizeFor(platform, options.quality, kind);
  };
  const kindsFor = (): TextureKind[] => (mode === "desktop" ? ["albedo", "normal", "orm", "mask"] : ["quest", "mask"]);

  // Every file this preset uses, once.
  const wanted: { url: string; width: number; height: number }[] = [];
  for (const descriptor of ARCHIVE_MATERIALS) {
    for (const kind of kindsFor()) {
      const id = descriptor.textures[kind];
      if (!id) continue;
      const size = sizeFor(descriptor, kind);
      const url = texturePath(id, size);
      if (!wanted.some((item) => item.url === url)) {
        const [width, height] = typeof size === "number" ? [size, size] : size;
        wanted.push({ url, width, height });
      }
    }
  }

  const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });

  function texture(descriptor: MaterialDescriptor, kind: TextureKind): THREE.Texture | null {
    const id = descriptor.textures[kind];
    if (!id) return null;
    const size = sizeFor(descriptor, kind);
    const url = texturePath(id, size);
    const bitmap = decoded.get(url);
    if (!bitmap) throw new Error(`texture ${url} is not loaded`);
    const info = getArchiveTexture(id)!;
    const map = new THREE.Texture(bitmap);
    map.flipY = false;
    map.colorSpace = info.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (info.kind === "mask") {
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1 / descriptor.tile, 1 / descriptor.tile);
    }
    map.anisotropy = options.anisotropy;
    map.needsUpdate = true;
    textures.push(map);
    return map;
  }

  function create(descriptor: MaterialDescriptor): THREE.Material {
    const base = descriptor.base;
    if (descriptor.quest === "emissive") {
      // A glowing colour, unlit on both platforms; desktop keeps its brightness for tone mapping.
      const color = mode === "desktop" ? linearColor(base.emissive ?? base.color, base.emissiveIntensity ?? 1) : linearColor(base.emissive ?? base.color);
      return new THREE.MeshBasicMaterial({ color, fog: descriptor.id !== "sky", toneMapped: true });
    }
    if (mode === "quest-preview") {
      return new THREE.MeshBasicMaterial({
        color: linearColor(base.color),
        map: texture(descriptor, "quest"),
        alphaMap: texture(descriptor, "mask"),
        alphaTest: descriptor.alphaTest ?? 0,
        vertexColors: !!options.vertexColors,
        side: descriptor.alphaTest ? THREE.DoubleSide : THREE.FrontSide,
      });
    }
    const orm = texture(descriptor, "orm");
    const material = new THREE.MeshStandardMaterial({
      color: linearColor(base.color),
      roughness: orm ? 1 : base.roughness,
      metalness: orm ? 1 : base.metalness,
      map: texture(descriptor, "albedo"),
      normalMap: texture(descriptor, "normal"),
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      alphaMap: texture(descriptor, "mask"),
      alphaTest: descriptor.alphaTest ?? 0,
      vertexColors: !!options.vertexColors,
      envMap: options.environment ?? null,
      envMapIntensity: ENVIRONMENT[descriptor.id] ?? 0.35,
      side: descriptor.alphaTest ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (material.normalMap) material.normalScale.set(descriptor.normalScale ?? 1, descriptor.normalScale ?? 1);
    return material;
  }

  return {
    async load(onProgress) {
      let done = 0;
      onProgress?.(0);
      await Promise.all(wanted.map(async (item) => {
        let pending = bitmaps.get(item.url);
        if (!pending) bitmaps.set(item.url, (pending = loader.loadAsync(item.url) as Promise<ImageBitmap>));
        const bitmap = await pending;
        if (disposed) {
          bitmap.close();
          return;
        }
        decoded.set(item.url, bitmap);
        textureBytes += item.width * item.height * 4 * (4 / 3);
        done++;
        onProgress?.(done / wanted.length);
      }));
    },
    get(id) {
      let material = materials.get(id);
      if (!material) {
        const descriptor = ARCHIVE_MATERIALS.find((item) => item.id === id);
        if (!descriptor) throw new Error(`no archive material "${id}"`);
        materials.set(id, (material = create(descriptor)));
      }
      return material;
    },
    upload(renderer) {
      for (const map of textures) renderer.initTexture(map);
    },
    get textureCount() { return decoded.size; },
    get textureBytes() { return textureBytes; },
    dispose() {
      disposed = true;
      for (const material of materials.values()) material.dispose();
      for (const map of textures) map.dispose();
      for (const bitmap of decoded.values()) bitmap.close();
      materials.clear();
      decoded.clear();
      textures.length = 0;
    },
  };
}
