// Texture library loader: reads the baked texture manifest written by
// scripts/generate-legacy-environment-textures.ts and loads albedo, normal and ORM
// maps per texture set at the resolution the quality preset asks for. Images decode
// off the main thread with ImageBitmapLoader where available.

import * as THREE from "three";
import type { TextureSetId } from "../../../../shared/legacy/environment/materials";

export type TextureMap = "albedo" | "normal" | "orm";

export interface TextureManifest {
  version: 1;
  generator: string;
  sets: Record<string, { tileMetres: number; meanLuminance?: number; files: Record<string, { file: string; size: number; sha256: string }> }>;
}

export class TextureLibrary {
  private base = new Map<string, THREE.Texture>();
  private repeated = new Map<string, THREE.Texture>();
  private readonly ids = new Set<string>();
  private readonly means = new Map<string, number>();

  static async load(baseUrl: string, variant: "high" | "512", anisotropy: number): Promise<TextureLibrary | null> {
    let manifest: TextureManifest;
    try {
      const res = await fetch(`${baseUrl}manifest.json`, { cache: "no-cache" });
      if (!res.ok) return null;
      manifest = (await res.json()) as TextureManifest;
    } catch {
      return null;
    }
    const lib = new TextureLibrary();
    const loader = typeof createImageBitmap === "function" ? new THREE.ImageBitmapLoader() : null;
    if (loader) loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const fallback = new THREE.TextureLoader();
    const jobs: Promise<void>[] = [];
    for (const id of Object.keys(manifest.sets)) {
      const set = manifest.sets[id];
      lib.means.set(id, set.meanLuminance ?? 0.2);
      for (const map of ["albedo", "normal", "orm"] as const) {
        const key = variant === "high" ? `${map}` : `${map}_512`;
        const entry = set.files[key] ?? set.files[`${map}_512`] ?? set.files[map];
        if (!entry) continue;
        const url = `${baseUrl}${entry.file}`;
        jobs.push(
          (async () => {
            let tex: THREE.Texture;
            if (loader) {
              const bmp = await loader.loadAsync(url);
              tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
              tex.flipY = false;
            } else {
              tex = await fallback.loadAsync(url);
            }
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.colorSpace = map === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            tex.anisotropy = anisotropy;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.needsUpdate = true;
            lib.base.set(`${id}:${map}`, tex);
            lib.ids.add(id);
          })().catch(() => undefined),
        );
      }
    }
    await Promise.all(jobs);
    return lib.ids.size > 0 ? lib : null;
  }

  /** Mean linear luminance of a set's albedo (terrain detail gain = 1 / mean). */
  meanLuminance(id: TextureSetId): number {
    return this.means.get(id) ?? 0.2;
  }

  has(id: TextureSetId): boolean {
    return this.ids.has(id);
  }

  /** Texture with a repeat for world-metre UVs (clones share the GPU image). */
  get(id: TextureSetId, map: TextureMap, repeat: number): THREE.Texture | null {
    const base = this.base.get(`${id}:${map}`);
    if (!base) return null;
    const key = `${id}:${map}:${repeat.toFixed(4)}`;
    let t = this.repeated.get(key);
    if (!t) {
      t = base.clone();
      t.repeat.set(repeat, repeat);
      t.needsUpdate = true;
      this.repeated.set(key, t);
    }
    return t;
  }

  count(): number {
    return this.base.size;
  }

  /**
   * Estimated GPU memory of the loaded images (RGBA8 plus a third for mipmaps). Repeat clones
   * share their source image on the GPU, so only base textures count.
   */
  gpuBytes(): number {
    let bytes = 0;
    this.base.forEach((t) => {
      const img = t.image as { width?: number; height?: number } | null;
      if (img && img.width && img.height) bytes += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
    });
    return Math.round(bytes);
  }

  dispose(): void {
    this.repeated.forEach((t) => t.dispose());
    this.base.forEach((t) => {
      t.dispose();
      const img = t.image as { close?: () => void } | null;
      if (img && typeof img.close === "function") img.close();
    });
    this.repeated.clear();
    this.base.clear();
  }
}
