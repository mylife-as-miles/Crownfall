import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedAssetPaths, menuPublicSource, questPublicDestination } from './sync-menu-assets.mjs';
import { HOME_CONTENT } from '../shared/menu/content.ts';
import { CHRONICLE_EXHIBITS, CHRONICLE_RECORDS, CHRONICLES_MAP, CHRONICLES_TITLE, getChronicleRecords, getChronicleShortTitle, getHotspotRecords } from '../shared/chronicles/content.ts';
import { textureFile, textureMemory, QUEST_PRESETS } from '../shared/chronicles/archive/materials.ts';
import { CHRONICLE_REGISTRY } from '../shared/chronicles/registry.ts';
import { CANON_MARKERS, isCreatorApproved } from '../shared/chronicles/status.ts';
import type { ContentPolicy } from '../shared/chronicles/status.ts';
import { QUEST_CHRONICLE_CONTROLS, QUEST_CHRONICLE_EXTENT, QUEST_CHRONICLE_IDS, QUEST_UI_LAYOUT, questText } from '../main-game-vr/src/ui-contract.ts';

// Chronicles parity for `npm run check:sync`, owned by the Chronicles workflow
// (docs/chronicles/ARCHITECTURE.md). scripts/check-menu-sync.ts calls
// checkChroniclesSync with the freshly generated Quest UI.

/**
 * Chronicles parity in the generated Quest UI: every exhibit, hotspot, stop
 * and article has its control and visible copy, every record has a button,
 * the archive keeps its Home tile's title, and the Home tile and the Atlas
 * diorama draw the one shared map. Throws on drift; returns the ids checked.
 */
export function assertChroniclesSync(uikitml: string, quest: { assets: string; diorama: string }): number {
  const escape = (value: string): string => questText(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  const pattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  let ids = 0;
  const control = (id: string, what: string) => { assert.ok(uikitml.includes(` id="${id}"`), `Quest Chronicles is missing ${what} (${id})`); ids++; };
  const copy = (value: string, what: string) => assert.ok(uikitml.includes(`>${escape(value)}</span>`), `Quest Chronicles does not show ${what}: ${value}`);
  control('View_Chronicles', 'its view');
  for (const id of ['Chronicles_Title', QUEST_CHRONICLE_IDS.record, 'Record_Label', 'Record_Meaning', 'Record_Title', 'Record_Body']) control(id, 'a record target');
  control(QUEST_CHRONICLE_IDS.recordMarker, 'the canon marker chip');
  control(QUEST_CHRONICLE_IDS.loading, 'the loading bar');
  control(QUEST_CHRONICLE_IDS.loadingFill, 'the loading bar fill');
  // The loading bar is wordless, and the marker chip is generated empty: the runtime fills it from the content policy.
  const loadingBar = chroniclesElement(uikitml, QUEST_CHRONICLE_IDS.loading);
  assert.doesNotMatch(loadingBar.replace(/<[^>]*>/gu, ''), /\S/u, 'The Chronicles loading bar must carry no text');
  assert.match(uikitml, new RegExp(` id="${QUEST_CHRONICLE_IDS.recordMarker}"[^>]*></span>`), 'The canon marker chip must be generated empty');
  for (const exhibit of CHRONICLE_EXHIBITS) {
    control(QUEST_CHRONICLE_IDS.tab(exhibit.id), `the ${exhibit.id} tab`);
    control(QUEST_CHRONICLE_IDS.pane(exhibit.id), `the ${exhibit.id} exhibit`);
    copy(exhibit.title, 'an exhibit title');
  }
  for (const record of CHRONICLE_RECORDS) {
    assert.ok(QUEST_CHRONICLE_CONTROLS.includes(record), `Quest Chronicles has no control for record ${record.id}`);
    control(QUEST_CHRONICLE_IDS.control(record), `the ${record.exhibit} control for ${record.id}`);
  }
  for (const record of getHotspotRecords()) copy(getChronicleShortTitle(record), 'a hotspot');
  for (const record of getChronicleRecords('interregnum')) copy(getChronicleShortTitle(record), 'a timeline stop');
  for (const record of getChronicleRecords('laws')) copy(record.title, 'an article');
  const tile = HOME_CONTENT.find((item) => item.destination === 'chronicles');
  assert.ok(tile, 'Chronicles has no Home tile');
  assert.equal(tile.title, CHRONICLES_TITLE, 'The Chronicles Home tile and the archive must share one title');
  assert.match(uikitml, new RegExp(` id="Chronicles_Title"[^>]*>${pattern(escape(CHRONICLES_TITLE))}</span>`), 'Quest Chronicles must be titled as its Home tile');
  assert.equal(tile.imageSrc, CHRONICLES_MAP.src, 'The Chronicles Home tile must draw the Atlas map');
  assert.match(uikitml, new RegExp(` id="Home_${pattern(tile.action!)}_Art" src="\\.\\.${pattern(CHRONICLES_MAP.src)}"`), 'The Quest Home tile must draw the Atlas map');
  assert.match(quest.assets, /\[QUEST_CHRONICLE_IDS\.mapAsset\]: \{ url: publicUrl\(CHRONICLES_MAP\.src\)/u, 'The Quest asset manifest must register the Atlas map');
  assert.ok(quest.diorama.includes('AssetManager.loadTextureById(QUEST_CHRONICLE_IDS.mapAsset)'), 'The Quest Atlas diorama must drape the registered Atlas map');
  assert.match(quest.assets, /^\s*\.\.\.archiveAssets\(publicUrl\),\s*$/mu, 'The Quest asset manifest must spread the archive room textures');
  return ids;
}

/** The markup of one element, by id, through its matching close tag. */
function chroniclesElement(uikitml: string, id: string): string {
  const start = uikitml.indexOf(` id="${id}"`);
  assert.ok(start >= 0, `Quest Chronicles is missing ${id}`);
  const open = uikitml.lastIndexOf('<', start), tag = /^<(\w+)/u.exec(uikitml.slice(open))![1];
  let depth = 0;
  for (const match of uikitml.slice(open).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gu'))) {
    if (match[2]) continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return uikitml.slice(open, open + match.index! + match[0].length);
  }
  throw new Error(`Quest Chronicles element ${id} is not closed`);
}

/**
 * Every absolutely placed element of View_Chronicles, and the footer actions
 * shown in XR, lies inside QUEST_CHRONICLE_EXTENT: the regions the control
 * surface keeps clear of the monument. Returns the number of boxes checked.
 */
export function assertChroniclesExtent(uikitml: string): number {
  const inside = (x: number, y: number, width: number, height: number) => QUEST_CHRONICLE_EXTENT.some((region) =>
    x >= region.x - 0.5 && y >= region.y - 0.5 && x + width <= region.x + region.width + 0.5 && y + height <= region.y + region.height + 0.5);
  const view = chroniclesElement(uikitml, 'View_Chronicles');
  const stack: { x: number; y: number; tag: string }[] = [{ x: 0, y: 0, tag: '' }];
  let boxes = 0;
  for (const match of view.matchAll(/<(\/?)(\w+)\b([^>]*?)(\/?)>/gu)) {
    const [, closing, tag, attributes, selfClosing] = match;
    if (closing) { stack.pop(); continue; }
    const style = /style="([^"]*)"/u.exec(attributes)?.[1] ?? '', id = /id="([^"]*)"/u.exec(attributes)?.[1] ?? tag;
    const number = (name: string) => { const found = new RegExp(`(?:^|;)\\s*${name}:\\s*([-\\d.]+)`, 'u').exec(style); return found ? Number(found[1]) : undefined; };
    const parent = stack[stack.length - 1];
    const absolute = /position-type:\s*absolute/u.test(style);
    const x = parent.x + (absolute ? number('position-left') ?? 0 : 0), y = parent.y + (absolute ? number('position-top') ?? 0 : 0);
    const width = number('width'), height = number('height');
    const container = width === QUEST_UI_LAYOUT.width && height === QUEST_UI_LAYOUT.height;
    if (absolute && !container && width !== undefined) {
      // The record panel grows with its copy; its column and top are checked, its depth is the record region's.
      assert.ok(inside(x, y, width, height ?? 1), `Quest Chronicles ${id} at ${x}, ${y} (${width} x ${height ?? 'auto'}) leaves the control surface's drawn extent`);
      boxes++;
    }
    if (!selfClosing && tag !== 'img') stack.push({ x: absolute ? x : parent.x, y: absolute ? y : parent.y, tag });
  }
  for (const id of ['Btn_Back', 'Btn_Pause', 'Btn_Recenter', 'Btn_Exit']) {
    const style = new RegExp(` id="${id}"[^>]*style="([^"]*)"`, 'u').exec(uikitml)?.[1] ?? '';
    const value = (name: string) => Number(new RegExp(`${name}:\\s*([-\\d.]+)`, 'u').exec(style)?.[1]);
    assert.ok(inside(value('position-left'), value('position-top'), value('width'), value('height')), `The ${id} footer action leaves the control surface's drawn extent`);
    boxes++;
  }
  return boxes;
}

/**
 * With the switch off, nothing unapproved can reach the Quest panel: the
 * generated UI holds no unapproved title, body or marker text, its record
 * controls are exactly the entries the switch-off registry shows, and the
 * marker chip is filled only at runtime. Returns the strings checked.
 */
export function assertChroniclesSwitchOff(uikitml: string): number {
  const off: ContentPolicy = { showUnapproved: false };
  const hidden = [
    ...CHRONICLE_REGISTRY.all.filter((entry) => !isCreatorApproved(entry.canonStatus)).flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(CANON_MARKERS).map((marker) => marker.text),
  ];
  const escape = (value: string): string => questText(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  for (const value of hidden) assert.ok(!uikitml.includes(escape(value)), `The Quest UI shows unapproved text with the switch off: ${value}`);
  const shown = CHRONICLE_REGISTRY.entries(off).filter((entry) => entry.collection !== 'atlas' || !!getHotspotRecords().find((record) => record.id === entry.id));
  assert.deepEqual(QUEST_CHRONICLE_CONTROLS.map((record) => record.id), shown.map((entry) => entry.id), 'Quest record controls must be the entries the switch-off registry shows');
  assert.ok(shown.every((entry) => isCreatorApproved(entry.canonStatus)), 'The switch-off registry must show only creator-approved entries');
  return hidden.length + shown.length;
}

/**
 * Every texture the Quest room can load is registered once, exists in the
 * desktop source and its synced Quest copy byte for byte, and is listed in the
 * provenance manifest; every texture the Quest estimate counts is registered.
 */
async function checkArchiveTextures(root: string, digest: (path: string) => Promise<string>): Promise<number> {
  const { archiveTextureAssetId, questArchiveTextures } = await import('../main-game-vr/src/chronicles/archive-textures.ts');
  const textures = questArchiveTextures();
  const registered = new Set(textures.map(({ id, size }) => archiveTextureAssetId(id, size)));
  assert.equal(registered.size, textures.length, 'Each Quest archive texture must have its own manifest id');
  // The manifest maps this same list (main-game-vr/src/chronicles/archive-assets.ts), each id to its texture path.
  const manifest = await readFile(join(root, 'main-game-vr/src/chronicles/archive-assets.ts'), 'utf8');
  assert.match(manifest, /questArchiveTextures\(\)\.map\(\(\{ id, size \}\) => \[\s*archiveTextureAssetId\(id, size\),\s*\{ url: publicUrl\(texturePath\(id, size\)\), type: AssetType\.Texture/u, 'The Quest manifest must register every archive texture by its id and path');
  const provenance = JSON.parse(await readFile(join(menuPublicSource, 'assets/chronicles/provenance.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
  for (const { id, size } of textures) {
    const file = `assets/chronicles/textures/${textureFile(id, size)}`, assetId = archiveTextureAssetId(id, size);
    assert.ok(registered.has(assetId), `The Quest manifest is missing ${assetId}`);
    const source = await digest(join(menuPublicSource, file));
    assert.equal(await digest(join(questPublicDestination, file)), source, `The Quest copy of ${file} differs from the desktop source`);
    const listed = provenance.files.find((entry) => `assets/chronicles/${entry.path}` === file);
    assert.ok(listed, `${file} is missing from provenance.json`);
    assert.equal(listed.sha256, source, `provenance.json has a stale hash for ${file}`);
  }
  for (const preset of QUEST_PRESETS) {
    for (const file of textureMemory('quest', preset).files) {
      assert.ok(textures.some(({ id, size }) => textureFile(id, size) === file), `The Quest ${preset} preset counts ${file}, which is not registered`);
    }
  }
  return textures.length;
}

/**
 * Runs every Chronicles parity check against the generated Quest UI, the Quest
 * manifest, the Atlas diorama and the synced Atlas map, and prints one PASS
 * line. Throws on drift.
 */
export async function checkChroniclesSync(uikitml: string, root: string): Promise<void> {
  const ids = assertChroniclesSync(uikitml, {
    assets: await readFile(join(root, 'main-game-vr/src/assets.ts'), 'utf8'),
    diorama: await readFile(join(root, 'main-game-vr/src/chronicles/scene/atlas-diorama.ts'), 'utf8'),
  });
  const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
  // The Atlas map is one synced file on both platforms, never a Quest-only copy.
  const map = CHRONICLES_MAP.src.replace(/^\//u, '');
  assert.ok(sharedAssetPaths.some(path => map === path || map.startsWith(`${path}/`)), 'The Atlas map must be a synced shared asset');
  assert.equal(await digest(join(questPublicDestination, map)), await digest(join(menuPublicSource, map)), 'The Quest copy of the Atlas map differs from the desktop source');
  const boxes = assertChroniclesExtent(uikitml);
  const textures = await checkArchiveTextures(root, digest);
  const strings = assertChroniclesSwitchOff(uikitml);
  console.log(`PASS Chronicles: ${ids} Quest UI ids, the Home tile, the shared Atlas map, ${boxes} boxes inside the control surface's extent, ${textures} registered room textures, and ${strings} switch-off checks with no unapproved text`);
}
