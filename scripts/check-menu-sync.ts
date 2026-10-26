import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateQuestUI } from './generate-quest-ui.ts';
import { sharedAssetPaths, menuPublicSource, questPublicDestination } from './sync-menu-assets.mjs';
import { CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS, ARENAS } from '../shared/menu/content.ts';
import { MENU_LAYOUT, MENU_THEME } from '../shared/menu/theme.ts';
import { applyMenuTheme } from '../main game/src/theme.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'crownfall-sync-'));
try {
  const output = join(scratch, 'menu.uikitml');
  await generateQuestUI(output);
  const expected = await readFile(output, 'utf8');
  assert.equal(await readFile(join(root, 'main-game-vr/public/ui/menu.uikitml'), 'utf8'), expected, 'Quest UI is stale; rebuild both experiences');
  for (const item of NAV_TABS) assert.ok(expected.includes(`id="Nav_${item.aria}"`));
  for (const item of PLAY_CARDS) assert.ok(expected.includes(`id="Play_${item.id}"`));
  for (const item of HOME_CONTENT) assert.ok(expected.includes(`id="Home_${item.action}"`));
  for (const item of CHAPTERS) assert.ok(expected.includes(`id="Chapter_${item.id}"`));
  ARENAS.forEach((_, index) => assert.ok(expected.includes(`id="Arena_${index}"`)));
  const variables = new Map<string, string>();
  applyMenuTheme({ style: { setProperty: (name: string, value: string) => variables.set(name, value) } } as unknown as HTMLElement);
  assert.equal(variables.get('--menu-accent'), MENU_THEME.colors.accent);
  assert.equal(variables.get('--menu-play-card-width'), `${MENU_LAYOUT.play.cardWidth / MENU_LAYOUT.reference.width * 100}cqw`);
  const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
  let verifiedFiles = 0;
  const compare = async (relative: string) => {
    const source = join(menuPublicSource, relative), destination = join(questPublicDestination, relative);
    try {
      for (const child of await readdir(source)) await compare(join(relative, child));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
      assert.equal(await digest(destination), await digest(source), `Shared asset differs: ${relative}`); verifiedFiles++;
    }
  };
  for (const path of sharedAssetPaths) await compare(path);
  console.log(`PASS shared desktop/Quest content, design tokens and ${verifiedFiles} byte-identical assets`);
} finally { await rm(scratch, { recursive: true, force: true }); }
