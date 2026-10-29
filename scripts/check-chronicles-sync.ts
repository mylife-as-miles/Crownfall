import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedAssetPaths, menuPublicSource, questPublicDestination } from './sync-menu-assets.mjs';
import { HOME_CONTENT } from '../shared/menu/content.ts';
import { CHRONICLE_EXHIBITS, CHRONICLE_RECORDS, CHRONICLES_MAP, CHRONICLES_TITLE, getChronicleRecords, getChronicleShortTitle, getHotspotRecords } from '../shared/chronicles/content.ts';
import { QUEST_CHRONICLE_CONTROLS, QUEST_CHRONICLE_IDS, questText } from '../main-game-vr/src/ui-contract.ts';

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
  return ids;
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
  console.log(`PASS Chronicles: ${ids} Quest UI ids, the Home tile and the shared Atlas map`);
}
