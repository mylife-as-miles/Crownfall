import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CHRONICLES_MAP } from "../content";
import { ARCHIVE_BLUEPRINT as B, ARCHIVE_GEOMETRY as G } from "./blueprint";
import { buildArchive } from "./kernel/assemble";
import { ARCHIVE_MATERIALS, ARCHIVE_TEXTURE_DIRECTORY, ARCHIVE_TEXTURES, getArchiveMaterial, getArchiveTexture, QUEST_PRESETS, textureFile, textureMemory, textureSizeFor } from "./materials";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PUBLIC = join(ROOT, "main game/public");
const ASSETS = join(PUBLIC, "assets/chronicles");
const MB = 1024 * 1024;

interface ProvenanceEntry { path: string; bytes: number; sha256: string; kind: string; source: string; generator: string | null; command: string | null; licence: string }
const manifest = JSON.parse(readFileSync(join(ASSETS, "provenance.json"), "utf8")) as { schema: number; files: ProvenanceEntry[] };
const byPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Width and height from a WebP file's header (lossy, lossless or extended). */
function webpSize(buffer: Buffer): [number, number] {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8X") return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
  throw new Error(`unknown WebP chunk ${chunk}`);
}

function listFiles(directory: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(relative(ASSETS, path).split("\\").join("/"));
  }
  return out.sort();
}

const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

test("every listed texture exists at every size, is a power of two and matches its manifest hash", () => {
  for (const texture of ARCHIVE_TEXTURES) {
    for (const size of texture.sizes) {
      const file = textureFile(texture.id, size);
      const path = join(PUBLIC, ARCHIVE_TEXTURE_DIRECTORY, file);
      assert.ok(existsSync(path), `${file} exists`);
      const buffer = readFileSync(path);
      const [width, height] = webpSize(buffer);
      const [expectedWidth, expectedHeight] = typeof size === "number" ? [size, size] : size;
      assert.deepEqual([width, height], [expectedWidth, expectedHeight], `${file} is ${expectedWidth}x${expectedHeight}`);
      assert.ok(isPowerOfTwo(width) && isPowerOfTwo(height), `${file} has power-of-two sides`);
      const entry = byPath.get(`textures/${file}`);
      assert.ok(entry, `${file} is in provenance.json`);
      assert.equal(entry.bytes, buffer.length, `${file} size matches the manifest`);
      assert.equal(entry.sha256, sha256(buffer), `${file} hash matches the manifest`);
    }
  }
});

test("provenance.json lists every file under assets/chronicles, and nothing that is missing", () => {
  assert.equal(manifest.schema, 1);
  const files = listFiles(ASSETS).filter((file) => file !== "provenance.json");
  for (const file of files) assert.ok(byPath.has(file), `${file} is listed in provenance.json`);
  for (const entry of manifest.files) {
    const path = join(ASSETS, entry.path);
    assert.ok(existsSync(path), `${entry.path} exists`);
    const buffer = readFileSync(path);
    assert.equal(entry.bytes, buffer.length, `${entry.path} size`);
    assert.equal(entry.sha256, sha256(buffer), `${entry.path} hash`);
    assert.ok(entry.source.length > 20 && entry.licence.length > 10, `${entry.path} states its source and licence`);
    if (entry.kind === "texture") {
      assert.ok(entry.generator && existsSync(join(ROOT, entry.generator)), `${entry.path} names a committed generator`);
      assert.ok(entry.command?.includes(entry.generator!), `${entry.path} gives the command that regenerates it`);
    }
  }
  // Every generated texture file belongs to a descriptor; nothing stray in textures/.
  const known = new Set(ARCHIVE_TEXTURES.flatMap((texture) => texture.sizes.map((size) => `textures/${textureFile(texture.id, size)}`)));
  for (const file of files.filter((name) => name.startsWith("textures/"))) assert.ok(known.has(file), `${file} has a texture descriptor`);
});

test("the creator's map is the unmodified painting and is never regenerated", () => {
  const path = CHRONICLES_MAP.src.replace("/assets/chronicles/", "");
  const entry = byPath.get(path);
  assert.ok(entry, "the map is listed");
  assert.equal(entry.kind, "painting");
  assert.equal(entry.generator, null);
  const buffer = readFileSync(join(ASSETS, path));
  assert.deepEqual(webpSize(buffer), [CHRONICLES_MAP.width, CHRONICLES_MAP.height]);
  assert.equal(entry.sha256, sha256(buffer));
});

test("material descriptors are complete and every texture they name is listed with the right colour space", () => {
  const ids = new Set<string>();
  for (const material of ARCHIVE_MATERIALS) {
    assert.ok(!ids.has(material.id), `${material.id} is unique`);
    ids.add(material.id);
    assert.ok(material.description.length > 20, `${material.id} is described`);
    assert.match(material.base.color, /^#[0-9a-f]{6}$/);
    assert.ok(material.base.roughness >= 0 && material.base.roughness <= 1 && material.base.metalness >= 0 && material.base.metalness <= 1);
    assert.ok(material.tile > 0);
    for (const [kind, id] of Object.entries(material.textures)) {
      const texture = getArchiveTexture(id!);
      assert.ok(texture, `${material.id} ${kind} texture ${id} is listed`);
      assert.equal(texture.kind, kind, `${id} is a ${kind} texture`);
      assert.equal(texture.colorSpace, kind === "albedo" || kind === "quest" ? "srgb" : "linear", `${id} colour space`);
    }
    if (material.quest === "unlit" && material.id !== "painting") assert.ok(material.textures.quest, `${material.id} has a Quest lit albedo`);
    if (material.quest === "emissive") assert.ok(material.base.emissive && (material.base.emissiveIntensity ?? 0) > 0, `${material.id} glows`);
  }
  for (const texture of ARCHIVE_TEXTURES) {
    assert.ok(texture.sizes.length > 0);
    if (texture.kind !== "mask") assert.ok(ARCHIVE_MATERIALS.some((material) => Object.values(material.textures).includes(texture.id)), `${texture.id} is used by a material`);
  }
});

test("every material the blueprint and the kernel name has a descriptor", () => {
  for (const element of B.elements) for (const id of element.materialIds) assert.ok(getArchiveMaterial(id), `${element.id} material ${id}`);
  for (const artifact of B.artifacts) for (const id of artifact.materialIds) assert.ok(getArchiveMaterial(id), `${artifact.id} material ${id}`);
  const build = buildArchive(B, G, "quest");
  for (const batch of build.batches) assert.ok(getArchiveMaterial(batch.materialId), `batch material ${batch.materialId}`);
  for (const instanced of build.instanced) for (const id of instanced.materialIds) assert.ok(getArchiveMaterial(id), `instanced material ${id}`);
});

test("texture memory: Quest stays within 64 MB on every preset, the map included", () => {
  const report: string[] = [];
  for (const preset of QUEST_PRESETS) {
    const quest = textureMemory("quest", preset), desktop = textureMemory("desktop", preset);
    assert.ok(quest.bytes <= 64 * MB, `Quest ${preset}: ${(quest.bytes / MB).toFixed(1)} MB`);
    assert.ok(desktop.bytes <= 160 * MB, `desktop ${preset}: ${(desktop.bytes / MB).toFixed(1)} MB`);
    for (const file of [...quest.files, ...desktop.files]) assert.ok(existsSync(join(PUBLIC, ARCHIVE_TEXTURE_DIRECTORY, file)), `${file} exists`);
    report.push(`${preset}: Quest ${(quest.bytes / MB).toFixed(1)} MB (${quest.files.length} files), desktop ${(desktop.bytes / MB).toFixed(1)} MB (${desktop.files.length} files)`);
  }
  assert.equal(textureSizeFor("desktop", "medium", "albedo"), 1024);
  assert.equal(textureSizeFor("desktop", "low", "albedo"), 512);
  assert.equal(textureSizeFor("quest", "medium", "quest"), 512);
  assert.equal(textureSizeFor("quest", "low", "quest"), 256);
  console.log(`  texture memory, 4 B/texel with mipmaps: ${report.join("; ")}`);
});

test("committed texture size stays small", () => {
  const total = manifest.files.filter((entry) => entry.kind === "texture").reduce((sum, entry) => sum + entry.bytes, 0);
  assert.ok(total <= 8 * MB, `generated textures total ${(total / MB).toFixed(2)} MB`);
  console.log(`  committed generated textures: ${(total / MB).toFixed(2)} MB in ${manifest.files.filter((entry) => entry.kind === "texture").length} files`);
});
