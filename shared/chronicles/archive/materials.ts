// The archive's material family: descriptors both renderers read, the
// textures generated for them by scripts/chronicles/textures, and the texture
// memory each preset costs. Original materials only: warm limestone ashlar,
// carved astronomical panels, dark polished floor stone, basalt, patinated
// bronze, the oculus screen, glowing lamp cores and the sky's light. The
// painting is the creator's map, used unmodified.

import { CHRONICLES_MAP } from "../content";
import type { ArchiveQuality, DesktopQuality } from "./types";

export type TextureKind = "albedo" | "normal" | "orm" | "quest" | "mask";

/** A generated texture: one file per size, named `<id>-<size>.webp` (or `<id>-<w>x<h>.webp`). */
export interface TextureDescriptor {
  id: string;
  kind: TextureKind;
  /** Square sizes, or [width, height] pairs for non-square masks; powers of two. */
  sizes: readonly (number | readonly [number, number])[];
  /** sRGB colour data (albedo, quest) or linear data (normal, orm, masks). */
  colorSpace: "srgb" | "linear";
}

export interface MaterialDescriptor {
  id: string;
  /** What it is, for the provenance manifest and the docs (never on screen). */
  description: string;
  base: { color: string; roughness: number; metalness: number; emissive?: string; emissiveIntensity?: number };
  /** Metres one texture tile covers; UVs are in metres. */
  tile: number;
  /** Texture ids by kind. Desktop uses albedo, normal and ORM; Quest uses its baked lit albedo. */
  textures: Readonly<Partial<Record<TextureKind, string>>>;
  /** Quest: unlit with the baked light (vertex colours and the lit albedo), or a plain emissive colour. */
  quest: "unlit" | "emissive";
  alphaTest?: number;
  /** Strength of the normal map on desktop. */
  normalScale?: number;
}

const DESKTOP_SIZES = [1024, 512] as const;
const QUEST_SIZES = [512, 256] as const;

/** Every generated texture. The map is listed separately: it is the creator's painting, not generated. */
export const ARCHIVE_TEXTURES: readonly TextureDescriptor[] = [
  ...(["limestone", "limestone-dressed", "limestone-carved", "floor-stone", "basalt", "bronze"] as const).flatMap((id): TextureDescriptor[] => [
    { id: `${id}-albedo`, kind: "albedo", sizes: DESKTOP_SIZES, colorSpace: "srgb" },
    { id: `${id}-normal`, kind: "normal", sizes: DESKTOP_SIZES, colorSpace: "linear" },
    { id: `${id}-orm`, kind: "orm", sizes: DESKTOP_SIZES, colorSpace: "linear" },
    { id: `${id}-quest`, kind: "quest", sizes: QUEST_SIZES, colorSpace: "srgb" },
  ]),
  // The key light's cookie: what the oculus screen passes, seen from the key.
  { id: "oculus-cookie", kind: "mask", sizes: [512], colorSpace: "linear" },
  // The screen's own alpha, in polar coordinates across its pierced band.
  { id: "tracery-mask", kind: "mask", sizes: [[1024, 256]], colorSpace: "linear" },
];

export const ARCHIVE_MATERIALS: readonly MaterialDescriptor[] = [
  {
    id: "limestone",
    description: "Warm limestone ashlar in coursed blocks, with tooling, chipped arrises and soot-dark weathering.",
    base: { color: "#ffffff", roughness: 0.86, metalness: 0 },
    tile: 2.4,
    textures: { albedo: "limestone-albedo", normal: "limestone-normal", orm: "limestone-orm", quest: "limestone-quest" },
    quest: "unlit",
    normalScale: 1,
  },
  {
    id: "limestone-dressed",
    description: "Finely dressed limestone without coursing, for mouldings, ribs, capitals and the oculus screen.",
    base: { color: "#ffffff", roughness: 0.8, metalness: 0 },
    tile: 1.2,
    textures: { albedo: "limestone-dressed-albedo", normal: "limestone-dressed-normal", orm: "limestone-dressed-orm", quest: "limestone-dressed-quest" },
    quest: "unlit",
    normalScale: 0.8,
  },
  {
    id: "limestone-carved",
    description: "Pale limestone carved in low relief with abstract astronomical rosettes, concentric bands and graduations.",
    base: { color: "#ffffff", roughness: 0.82, metalness: 0 },
    tile: 1.2,
    textures: { albedo: "limestone-carved-albedo", normal: "limestone-carved-normal", orm: "limestone-carved-orm", quest: "limestone-carved-quest" },
    quest: "unlit",
    normalScale: 1.2,
  },
  {
    id: "floor-stone",
    description: "Dark polished floor stone in large slabs with faint veining, its polish worn along the walking paths.",
    base: { color: "#ffffff", roughness: 0.32, metalness: 0 },
    tile: 3.2,
    textures: { albedo: "floor-stone-albedo", normal: "floor-stone-normal", orm: "floor-stone-orm", quest: "floor-stone-quest" },
    quest: "unlit",
    normalScale: 0.6,
  },
  {
    id: "basalt",
    description: "Dark basalt with a fine grain and chisel marks, for the plinth, steps, voussoir bands and the dais.",
    base: { color: "#ffffff", roughness: 0.7, metalness: 0 },
    tile: 1.6,
    textures: { albedo: "basalt-albedo", normal: "basalt-normal", orm: "basalt-orm", quest: "basalt-quest" },
    quest: "unlit",
    normalScale: 0.9,
  },
  {
    id: "bronze",
    description: "Cast bronze with a fine skin and faint hammer dimples, worn bright by handling, with verdigris crusted in a few spots; engraving is modelled in the geometry.",
    base: { color: "#ffffff", roughness: 0.42, metalness: 0.9 },
    tile: 0.8,
    textures: { albedo: "bronze-albedo", normal: "bronze-normal", orm: "bronze-orm", quest: "bronze-quest" },
    quest: "unlit",
    normalScale: 0.7,
  },
  {
    id: "tracery",
    description: "The oculus screen: limestone pierced with star-shaped holes, drawn with an alpha mask.",
    base: { color: "#d8c8ae", roughness: 0.9, metalness: 0 },
    tile: 1,
    textures: { albedo: "limestone-dressed-albedo", mask: "tracery-mask", quest: "limestone-dressed-quest" },
    quest: "unlit",
    alphaTest: 0.5,
  },
  {
    id: "lamp-core",
    description: "The small glowing cores of the bronze lamps.",
    base: { color: "#ffcf8f", roughness: 1, metalness: 0, emissive: "#ffb366", emissiveIntensity: 4 },
    tile: 1,
    textures: {},
    quest: "emissive",
  },
  {
    id: "sky",
    description: "The light seen through the oculus: a soft bright disc, no exterior.",
    base: { color: "#fff6e6", roughness: 1, metalness: 0, emissive: "#fff3dc", emissiveIntensity: 3.2 },
    tile: 1,
    textures: {},
    quest: "emissive",
  },
  {
    id: "painting",
    description: "The creator's painted map, unmodified, as the relief's albedo.",
    base: { color: "#ffffff", roughness: 0.86, metalness: 0 },
    tile: 1,
    textures: {},
    quest: "unlit",
  },
];

export const ARCHIVE_TEXTURE_DIRECTORY = "/assets/chronicles/textures";

/** The file name of a texture at a size. */
export function textureFile(id: string, size: number | readonly [number, number]): string {
  return typeof size === "number" ? `${id}-${size}.webp` : `${id}-${size[0]}x${size[1]}.webp`;
}

/** The public URL path of a texture at a size. */
export function texturePath(id: string, size: number | readonly [number, number]): string {
  return `${ARCHIVE_TEXTURE_DIRECTORY}/${textureFile(id, size)}`;
}

export function getArchiveMaterial(id: string): MaterialDescriptor | undefined {
  return ARCHIVE_MATERIALS.find((material) => material.id === id);
}

export function getArchiveTexture(id: string): TextureDescriptor | undefined {
  return ARCHIVE_TEXTURES.find((texture) => texture.id === id);
}

/** The texture size each preset loads for a kind: desktop medium and high use 1024, low 512; Quest uses 512, and 256 on low. */
export function textureSizeFor(platform: "desktop" | "quest", preset: DesktopQuality, kind: TextureKind): number {
  if (kind === "quest") return preset === "low" ? 256 : 512;
  if (platform === "quest") return 512;
  return preset === "low" ? 512 : 1024;
}

const MIP = 4 / 3;
const bytes = (width: number, height: number) => width * height * 4 * MIP;
const MAP_BYTES = bytes(CHRONICLES_MAP.width, CHRONICLES_MAP.height);

/**
 * Estimated GPU texture memory for a platform and preset, at 4 bytes per texel
 * with mipmaps counted, the map included. Quest loads each material's baked lit
 * albedo and the screen mask; desktop loads albedo, normal and ORM, the cookie
 * and the mask.
 */
export function textureMemory(platform: "desktop" | "quest", preset: DesktopQuality): { bytes: number; files: string[] } {
  const files: string[] = [];
  let total = MAP_BYTES;
  const add = (id: string, size: number | readonly [number, number]) => {
    const file = textureFile(id, size);
    if (files.includes(file)) return;
    files.push(file);
    total += typeof size === "number" ? bytes(size, size) : bytes(size[0], size[1]);
  };
  for (const material of ARCHIVE_MATERIALS) {
    const kinds: TextureKind[] = platform === "quest" ? ["quest", "mask"] : ["albedo", "normal", "orm", "mask"];
    for (const kind of kinds) {
      const id = material.textures[kind];
      if (!id) continue;
      const descriptor = getArchiveTexture(id)!;
      const size = descriptor.kind === "mask" ? descriptor.sizes[0] : textureSizeFor(platform, preset, kind);
      add(id, size);
    }
  }
  if (platform === "desktop") add("oculus-cookie", 512);
  return { bytes: total, files };
}

/** Quest presets by archive quality name, for budgets. */
export const QUEST_PRESETS: readonly DesktopQuality[] = ["low", "medium", "high"];
export type { ArchiveQuality };
