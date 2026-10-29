// Desktop material factory: turns shared MaterialDefinitions into three.js physically
// based materials (textures from the baked texture library when present, flat
// fallback colours otherwise) and applies the shader patches.

import * as THREE from "three";
import type { MaterialDefinition, MaterialLibrary, TextureSetId } from "../../../../shared/legacy/environment/materials";
import { patchMaterial } from "./shaderPatches";
import type { SharedUniforms } from "./shaderPatches";
import type { TextureLibrary } from "./textures";

export interface MaterialFactoryOptions {
  lib: MaterialLibrary;
  uniforms: SharedUniforms;
  textures: TextureLibrary | null;
  atlas: THREE.Texture;
}

export interface MotionHint {
  kind: "cloth" | "sway" | "flicker" | "smoke" | "flow" | null;
  amplitude?: number;
  frequency?: number;
  rate?: number;
  depth?: number;
}

const TERRAIN_SETS: readonly TextureSetId[] = ["grass", "earth", "rock", "cobble"];

export class MaterialFactory {
  private cache = new Map<string, THREE.Material>();
  private readonly o: MaterialFactoryOptions;

  constructor(o: MaterialFactoryOptions) {
    this.o = o;
  }

  get(key: string, motion: MotionHint = { kind: null }, instanced = false): THREE.Material {
    const mk = `${key}|${motion.kind ?? "-"}|${instanced ? 1 : 0}`;
    let m = this.cache.get(mk);
    if (!m) {
      m = this.create(this.o.lib.get(key), motion);
      this.cache.set(mk, m);
    }
    return m;
  }

  private maps(def: MaterialDefinition): { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null } {
    const t = this.o.textures;
    if (!t || !def.texture) return { map: null, normalMap: null, roughnessMap: null };
    const repeat = def.uvSpace === "world" ? 1 / def.textureScale : 1;
    return {
      map: t.get(def.texture, "albedo", repeat),
      normalMap: t.get(def.texture, "normal", repeat),
      roughnessMap: t.get(def.texture, "orm", repeat),
    };
  }

  private create(def: MaterialDefinition, motion: MotionHint): THREE.Material {
    const U = this.o.uniforms;
    const textured = !!(this.o.textures && def.texture && this.o.textures.has(def.texture));
    const color = new THREE.Color(textured ? def.color : def.quest.color);
    switch (def.shading) {
      case "terrain": {
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: def.roughness, metalness: 0 });
        const t = this.o.textures;
        if (def.key === "terrain" && t) {
          patchMaterial(mat, U, {
            splat: {
              layers: TERRAIN_SETS.map((id) => (t.has(id) ? t.get(id, "albedo", 1) : null)),
              scales: [4, 4, 6, 2],
              gains: TERRAIN_SETS.map((id) => 1 / Math.max(0.03, t.meanLuminance(id))),
            },
            noHighlight: true,
          });
          if (t.has("earth")) {
            mat.normalMap = t.get("earth", "normal", 1 / 4);
            mat.normalScale.set(0.35, 0.35);
          }
        } else patchMaterial(mat, U, { noHighlight: true });
        return mat;
      }
      case "cloth": {
        const isAtlas = def.uvSpace === "unit";
        const maps = this.maps(def);
        const mat = new THREE.MeshStandardMaterial({
          color: isAtlas ? new THREE.Color(1, 1, 1) : color,
          map: isAtlas ? this.o.atlas : maps.map,
          normalMap: isAtlas ? null : maps.normalMap,
          roughness: def.roughness,
          metalness: 0,
          vertexColors: true,
          side: THREE.DoubleSide,
          alphaTest: isAtlas ? 0.5 : 0,
        });
        patchMaterial(mat, U, { cloth: { amplitude: motion.amplitude ?? 0.14, frequency: motion.frequency ?? 1.2 } });
        return mat;
      }
      case "foliage": {
        const maps = this.maps(def);
        const mat = new THREE.MeshStandardMaterial({ color, map: maps.map, roughness: def.roughness, metalness: 0, vertexColors: true });
        patchMaterial(mat, U, motion.kind === "sway" ? { sway: { amplitude: motion.amplitude ?? 0.1, frequency: motion.frequency ?? 0.45 }, noHighlight: true } : { noHighlight: true });
        return mat;
      }
      case "glass": {
        const lit = !!def.emissive;
        const mat = new THREE.MeshStandardMaterial({
          color: lit ? new THREE.Color("#3a2410") : color,
          roughness: def.roughness,
          metalness: lit ? 0 : 0.35,
          emissive: lit ? new THREE.Color(def.emissive?.color ?? "#ff9a3c") : new THREE.Color(0),
          emissiveIntensity: lit ? def.emissive?.intensity ?? 2 : 0,
          vertexColors: true,
        });
        if (lit) patchMaterial(mat, U, { flicker: { rate: 0.9, depth: 0.12 } });
        else patchMaterial(mat, U, {});
        return mat;
      }
      case "emissive": {
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(0, 0, 0),
          emissive: new THREE.Color(def.emissive?.color ?? def.color),
          emissiveIntensity: def.emissive?.intensity ?? 3,
          roughness: 1,
          metalness: 0,
          vertexColors: false,
        });
        patchMaterial(mat, U, { flicker: { rate: motion.rate ?? 8, depth: motion.depth ?? 0.35 }, noHighlight: true });
        return mat;
      }
      case "water": {
        const mat = new THREE.MeshStandardMaterial({ color, roughness: def.roughness, metalness: 0.1, envMapIntensity: 1.4 });
        patchMaterial(mat, U, { noHighlight: true });
        return mat;
      }
      case "silhouette": {
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.6 });
        patchMaterial(mat, U, { fogDistanceScale: def.key === "skyline" ? 0.07 : 0.14, noHighlight: true });
        return mat;
      }
      case "smoke": {
        // Smoke uses its own shader in life.ts; this fallback is only used if a mesh references it.
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: def.opacity ?? 0.4, depthWrite: false });
        return mat;
      }
      default: {
        const maps = this.maps(def);
        const mat = new THREE.MeshStandardMaterial({
          color,
          map: maps.map,
          normalMap: maps.normalMap,
          roughnessMap: maps.roughnessMap,
          aoMap: maps.roughnessMap,
          aoMapIntensity: 0.9,
          metalnessMap: def.metalness > 0 ? maps.roughnessMap : null,
          roughness: maps.roughnessMap ? 1 : def.roughness,
          metalness: def.metalness > 0 && maps.roughnessMap ? 1 : def.metalness,
          vertexColors: true,
          side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        if (maps.normalMap) mat.normalScale.set(def.normalScale, def.normalScale);
        if (motion.kind === "cloth") patchMaterial(mat, U, { cloth: { amplitude: motion.amplitude ?? 0.1, frequency: motion.frequency ?? 1 } });
        else if (motion.kind === "flicker") patchMaterial(mat, U, { flicker: { rate: motion.rate ?? 8, depth: motion.depth ?? 0.3 } });
        else patchMaterial(mat, U, def.key === "figure" ? { noHighlight: true } : {});
        return mat;
      }
    }
  }

  materials(): THREE.Material[] {
    return Array.from(this.cache.values());
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}
