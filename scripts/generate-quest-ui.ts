/**
 * Native, live UIKitML implementation of the approved desktop1280x720 layout.
 * Generate before build; do not hand-edit public/ui/menu.uikitml.
 * Native property references: https://github.com/pmndrs/uikit/blob/main/docs/getting-started/components-and-properties.md
 * All images remain supplied artwork. SVG decorations reproduce desktop vectors.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARENAS, CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS,
  SETTINGS_CATEGORIES, SHOWCASE_CATEGORIES, getModalContent,
} from '../shared/menu/content.ts';
import { CARD_ART_POSITIONS, MENU_LAYOUT, MENU_THEME } from '../shared/menu/theme.ts';
import {
  QUEST_FIXED_ACTION_IDS, QUEST_FIXED_TEXT_IDS, QUEST_SETTING_ROWS,
  QUEST_UI_LAYOUT, QUEST_VIEW_IDS,
} from '../main-game-vr/src/ui-contract.ts';

export async function generateQuestUI(destination?: string): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const ids = new Set<string>();
  const c = MENU_THEME.colors;
  const geometry = MENU_LAYOUT;
  const ascii = (value: string): string => value.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[–—]/gu, '-').replace(/·/gu, '/');
  const escape = (value: string): string => ascii(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  const id = (value: string): string => {
    if (ids.has(value)) throw new Error(`Duplicate Quest UI ID: ${value}`);
    ids.add(value);
    return ` id="${value}"`;
  };
  const number = (value: number): string => Number(value.toFixed(6)).toString();
  const rect = (x: number, y: number, width: number, height: number): string => `position-type: absolute; position-left: ${number(x)}; position-top: ${number(y)}; width: ${number(width)}; height: ${number(height)};`;
  const node = (tag: string, elementId: string | undefined, className: string, contents: string, style = ''): string => `<${tag}${elementId ? id(elementId) : ''}${className ? ` class="${className}"` : ''}${style ? ` style="${style}"` : ''}>${contents}</${tag}>`;
  const text = (value: string, x: number, y: number, width: number, height: number, className = 'body', elementId?: string, style = ''): string => node('span', elementId, className, escape(value), `${rect(x, y, width, height)} pointer-events: none; z-index-offset: 3; ${style}`);
  const image = (source: string, x: number, y: number, width: number, height: number, elementId?: string, opacity = 1): string => `<img${elementId ? id(elementId) : ''} src="..${escape(source)}" style="${rect(x, y, width, height)} object-fit: fill; opacity: ${opacity}; z-index-offset: ${source.includes('/decorations/') ? 1 : 0}; pointer-events: none;" />`;
  const deco = (name: string, x: number, y: number, width: number, height: number, elementId?: string): string => image(`/assets/decorations/${name}.svg`, x, y, width, height, elementId);

  const dimensions = new Map<string, readonly [number, number]>();
  const sources = new Set([...ARENAS.map((item) => item.source), ...HOME_CONTENT.map((item) => item.imageSrc!).filter(Boolean)]);
  for (const source of sources) {
    const bytes = await readFile(resolve(projectRoot, 'main game/public', source.replace(/^\//u, '')));
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') dimensions.set(source, [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1]);
    else if (format === 'VP8 ') dimensions.set(source, [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]);
    else if (format === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      dimensions.set(source, [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]);
    } else throw new Error(`Expected an approved WebP artwork source: ${source}`);
  }
  const art = (source: string, width: number, height: number, elementId?: string, position = '50% 50%', fit: 'cover' | 'contain' = 'cover', opacity = 1): string => {
    const size = dimensions.get(source);
    if (!size) throw new Error(`Missing artwork metadata: ${source}`);
    const scale = (fit === 'contain' ? Math.min : Math.max)(width / size[0], height / size[1]);
    const [px, py] = position.split(' ').map((value) => parseFloat(value) / 100);
    const imageWidth = size[0] * scale;
    const imageHeight = size[1] * scale;
    return image(source, (width - imageWidth) * px, (height - imageHeight) * py, imageWidth, imageHeight, elementId, opacity);
  };
  const view = (elementId: string, contents: string, className = ''): string => node('div', elementId, `view ${className}`, contents, `display: ${elementId === 'View_Home' ? 'flex' : 'none'};`);
  const button = (elementId: string, x: number, y: number, width: number, height: number, contents: string, className = 'card', style = ''): string => node('button', elementId, className, contents, `${rect(x, y, width, height)} ${style}`);
  const title = (elementId: string, label: string, x: number, y: number, width: number, height = 24, style = ''): string => text(label, x, y, width, height, 'card-title', `${elementId}_Title`, style);
  // Keep an actual hand-sized interaction surface behind visually unboxed text.
  const hitSurface = (width: number, height: number): string => node('div', undefined, '', '', `${rect(0, 0, width, height)} background-color: #100d08; opacity: 0.001; pointer-events: auto;`);
  const plainAction = (elementId: string, label: string, x: number, y: number, width: number, visible = true): string => button(elementId, x, y, width, 50, hitSurface(width, 50) + text(label, 0, 15, width, 22, 'footer-label'), 'footer-action', `display: ${visible ? 'flex' : 'none'};`);
  const modalAction = (elementId: string, label: string, x: number, y: number): string => button(elementId, x, y - 9, 128, 50,
    hitSurface(128, 50) + node('div', `${elementId}_Plate`, 'modal-plate', '', `${rect(0, 9, 128, 32)} pointer-events: none;`) + text(label, 0, 13, 128, 24, 'modal-action-label'), 'modal-action');
  const centerCopy = (prefix: string, heading: string, body: string, note = ''): string => text(heading.toUpperCase(), 170, 160, 940, 30, 'modal-title', `${prefix}_Title`) + text(body, 260, 226, 760, 70, 'modal-body', `${prefix}_Description`) + (prefix === 'Modal' ? text(note, 260, 268, 760, 60, 'modal-note', 'Modal_Note') : '');

  const styles = `
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E3p-kc4A.ttf'); font-weight: 300; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHpv4kjgoGqM7EPCw.ttf'); font-weight: 400; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E3_-gc4A.ttf'); font-weight: 500; }
    @font-face { font-family: 'Barlow'; src: url('../fonts/7cHqv4kjgoGqM7E30-8c4A.ttf'); font-weight: 600; }
    .root { width: 1280; height: 720; position-type: relative; font-family: 'Barlow'; color: ${c.text}; }
    .view { position-type: absolute; position-left: 0; position-top: 0; width: 1280; height: 720; }
    .card { position-type: relative; overflow: hidden; padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-radius: 0; border-color: #39352a; border-width: 1; background-color: #1b1914; color: ${c.inactiveHeading}; cursor: pointer; }
    .card:hover { border-color: ${c.accent}; }
    .card-title { font-size: ${geometry.typography.cardHeading}; font-weight: 600; line-height: 1.1; }
    .card-subtitle { font-size: 8.704; line-height: 1.15; color: #d9d4c7; opacity: 0.83; }
    .card-description { font-size: 9.472; line-height: 1.2; color: #e8e0cc; opacity: 0.92; }
    .body { font-size: 16; font-weight: 400; color: #a19d91; line-height: 1.8; }
    .nav { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; color: #837f76; cursor: pointer; }
    .nav-label { font-size: 20; font-weight: 300; line-height: 1.2; text-align: center; }
    .nav-plate { background-color: ${c.activeTab}; }
    .modal-title { font-size: 20; font-weight: 600; color: ${c.modalHeading}; text-align: center; line-height: 1.2; }
    .modal-body { font-size: 16; font-weight: 400; color: ${c.modalText}; text-align: center; line-height: 1.5; }
    .modal-note { font-size: 16; font-weight: 400; color: ${c.modalText}; text-align: center; line-height: 1.5; }
    .modal-action { border-width: 0; cursor: pointer; }
    .modal-plate { background-color: #17140e; opacity: 0.15; border-color: #867650; border-width: 1; }
    .modal-action-label { font-size: 18; color: #aaa79c; text-align: center; line-height: 1.2; }
    .modal-action:hover { color: #d0c6b3; }
    .footer-action { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; cursor: pointer; }
    .footer-label { font-size: 15; font-weight: 300; color: #9b9588; line-height: 1.2; }
    .footer-action:hover { color: #e5d7bd; }
    .setting-row { padding-top: 0; padding-right: 0; padding-bottom: 0; padding-left: 0; border-width: 0; color: #a19d91; cursor: pointer; }
    .setting-label { font-size: 16; line-height: 1.2; }
    .setting-value { font-size: 16; text-align: center; line-height: 1.2; }
    .section-label { font-size: 16; font-weight: 600; color: #b3b0a6; }
    .info-title { font-size: 16; font-weight: 600; color: #ccc9bf; line-height: 1.35; }
    .arena-label { font-size: 10.88; font-weight: 600; color: #b5b2ac; }
    .archive-body { font-size: 12.16; color: #999d88; line-height: 1.45; }
  `;

  const home = view('View_Home', HOME_CONTENT.map((tile, index) => {
    const tileId = `Home_${tile.action}`;
    const left = geometry.home.x + (index ? geometry.home.leftWidth + geometry.home.gap : 0);
    const top = geometry.home.y + (index === 2 ? geometry.home.rightHeight + geometry.home.gap : 0);
    const width = index ? geometry.home.rightWidth : geometry.home.leftWidth;
    const height = index ? geometry.home.rightHeight : geometry.home.height;
    return button(tileId, left, top, width, height,
      art(tile.imageSrc!, width, height, `${tileId}_Art`, tile.imagePosition || '50% 50%', tile.imageFit || 'cover', index === 0 ? 1 : 0.82)
      + deco('home-scrim', 0, 0, width, height)
      + title(tileId, (tile.title || '').toUpperCase(), 20, 24, width - 34), 'card');
  }).join('\n'));

  const play = view('View_Play', PLAY_CARDS.map((card, index) => {
    const cardId = `Play_${card.id}`;
    const width = geometry.play.cardWidth;
    const height = geometry.play.cardHeight;
    return button(cardId, geometry.play.x + index * (width + geometry.play.gap), geometry.play.y, width, height,
      art(`/assets/environments/card-${card.artwork}.webp`, width, height, `${cardId}_Art`, CARD_ART_POSITIONS[card.artwork], 'cover', 0.82)
      + deco('play-scrim', 0, 0, width, height)
      + title(cardId, card.title, 11.008, 12.96, width - 18.688)
      + text(card.subtitle, 11.008, 34.8, width - 18.688, 30, 'card-subtitle')
      + (card.description ? text(card.description, 11.008, height - 45, width - 19.712, 34.2, 'card-description') : ''), 'card');
  }).join('\n'));

  const showcaseWidths = [(800 - 8) * 1.18 / 3.18, (800 - 8) / 3.18, (800 - 8) / 3.18];
  let showcaseLeft = geometry.play.x;
  const showcase = view('View_Showcase', SHOWCASE_CATEGORIES.map((item, index) => {
    const tileId = `Showcase_${item.id}`;
    const width = showcaseWidths[index];
    const x = showcaseLeft;
    showcaseLeft += width + 4;
    const background = item.art ? art(item.art, width, 298, `${tileId}_Art`, item.id === 'arenas' ? '60% 50%' : '35% 50%', 'cover', 0.82) : deco('showcase-archive-background', 0, 0, width, 298, `${tileId}_Art`) + deco('showcase-archive-seal', width / 2 - 83.2, 79.2, 166.4, 166.4);
    return button(tileId, x, 211, width, 298, background + deco('showcase-scrim', 0, 0, width, 298)
      + text(item.status.toUpperCase(), 16, 15.12, width - 30.08, 16, 'card-subtitle', undefined, 'font-size: 8.96;')
      + title(tileId, item.title, 16, 34.5, width - 30.08)
      + text(item.description, 16, 247, width - 30.08, 36, 'card-description', undefined, 'font-size: 11.52; line-height: 1.4;')
      + (item.id !== 'replays' ? deco(`showcase-${item.id}-inactive`, width - 69.76, 172.24, 53.76, 53.76, `${tileId}_Icon`) : ''), 'card');
  }).join('\n'));

  const arenaWidth = 800 - 153.6 - 8;
  const arenaImageHeight = 298 - 37.44;
  const arenas = view('View_Arenas', node('div', undefined, '',
    node('div', undefined, 'card', art(ARENAS[0].source, arenaWidth, arenaImageHeight, 'Arena_Image', '50% 50%', 'contain')
      + node('div', undefined, '', text(ARENAS[0].label.toUpperCase(), 12.8, 6.12, 102, 22, 'section-label', 'Arena_Title', `color: ${c.accent}; font-size: 12.8;`)
        + text('Environment artwork preview', 126, 7, 360, 18, 'card-description', undefined, 'font-size: 9.6;')
        + text('01 / 04', arenaWidth - 92, 7, 80, 18, 'card-description', 'Arena_Count', 'text-align: right;'), `${rect(0, arenaImageHeight, arenaWidth, 37.44)} background-color: #242115;`), rect(0, 0, arenaWidth, 298))
    + ARENAS.map((arena, index) => button(`Arena_${index}`, arenaWidth + 8, index * (((298 - 11.88) / 4) + 3.96), 153.6, (298 - 11.88) / 4,
      art(arena.source, 153.6, (298 - 11.88) / 4, `Arena_${index}_Art`, '50% 50%', 'cover', 0.7)
      + deco('showcase-scrim', 0, 0, 153.6, (298 - 11.88) / 4)
      + text(arena.label.toUpperCase(), 8.96, 48, 140, 18, 'arena-label'), 'card')).join(''), rect(139, 211, 800, 298)));

  const chapters = view('View_Chapters', CHAPTERS.map((chapter, index) => {
    const tileId = `Chapter_${chapter.id}`;
    const width = geometry.chapters.width / 5;
    const height = geometry.chapters.height / 3;
    return button(tileId, geometry.chapters.x + (index % 5) * width, geometry.chapters.y + Math.floor(index / 5) * height, width, height,
      art(chapter.imageSrc, width, height, `${tileId}_Art`, chapter.imagePosition, 'cover', chapter.locked ? 0.1166 : 0.4896)
      + deco(chapter.locked ? 'chapter-locked-scrim' : 'chapter-scrim', 0, 0, width, height)
      + title(tileId, chapter.title.toUpperCase(), 20, 22.32, width - 30.24, 24, chapter.locked ? 'color: #80796b; opacity: 0.65;' : '')
      + (chapter.locked ? deco('chapter-lock-inactive', width / 2 - 6.72, height / 2 - 9, 13.44, 18, `${tileId}_Lock`) : ''), 'card');
  }).join('\n'));

  const settings = view('View_Settings', SETTINGS_CATEGORIES.map((category, index) => {
    const tileId = `Settings_${category}`;
    return button(tileId, 106 + (index % 3) * 300, 158 + Math.floor(index / 3) * 219, 300, 219,
      deco('settings-pattern', 0, 0, 300, 219, `${tileId}_Art`)
      + title(tileId, category.toUpperCase(), 19, 23, 268)
      + deco(`settings-${category}-inactive`, 96, 60.12, 108, 108, `${tileId}_Icon`), 'card', 'background-color: #17150f;');
  }).join('\n'));
  const detailRows = Array.from({ length: QUEST_SETTING_ROWS }, (_, index) => button(`Setting_${index}`, 0, index * 37, 544, 35,
    node('div', `Setting_${index}_Surface`, '', '', `${rect(0, 0, 544, 35)} background-color: ${index % 2 ? '#231f19' : '#1b1813'}; opacity: ${index % 2 ? 0.45 : 0.52}; pointer-events: none;`)
    + text('Preference', 9, 7, 276, 22, 'setting-label', `Setting_Label_${index}`)
    + text('<', 298, 7, 18, 22, 'setting-value')
    + text('Value', 317, 7, 194, 22, 'setting-value', `Setting_Value_${index}`)
    + text('>', 516, 7, 18, 22, 'setting-value'), 'setting-row')).join('\n');
  const details = view('View_SettingsDetail', text('GENERAL SETTINGS', 106, 126, 544, 22, 'section-label', 'Settings_Category', 'display: none;')
    + node('div', undefined, '', detailRows, rect(106, 150, 544, 396))
    + text('Language', 787.2, 150, 294.4, 44, 'info-title', 'Settings_Title')
    + text('Pinch or touch a preference to change it.', 787.2, 209, 294.4, 336, 'body', 'Settings_Description'));

  const initialModal = getModalContent('classic');
  const modal = view('View_Modal', centerCopy('Modal', initialModal.title, initialModal.description, initialModal.note || '') + modalAction('Btn_Confirm', 'Confirm', 480, 348) + modalAction('Btn_Cancel', 'Cancel', 672, 348));
  const library = view('View_Library', node('div', undefined, 'card', art(ARENAS[0].source, 800, 298, 'Library_Art', '35% 50%', 'cover', 0.23)
    + node('div', 'Library_Archive', '', deco('showcase-library-archive-background', 0, 0, 800, 298), `${rect(0, 0, 800, 298)} display: none; pointer-events: none;`)
    + text('CINEMATIC LIBRARY', 26.88, 22.32, 500, 18, 'card-subtitle')
    + text('AI BATTLES', 26.88, 50, 530, 40, 'card-title', 'Library_Title', 'font-size: 31.36; color: #dfd2b6;')
    + text('No cinematic battles are available in this build.', 26.88, 101, 520, 82, 'archive-body', 'Library_Description')
    + button('Btn_ExploreArenas', 26.88, 200, 238, 38, text('Explore Arenas', 12.8, 9, 200, 22, 'card-description', undefined, 'color: #d7b270; font-size: 11.52;'), 'card', 'background-color: #242318; border-color: #b8893f;')
    + deco('showcase-battles-emblem', 605, 43.2, 115.2, 115.2, 'Library_Battles_Emblem')
    + node('div', 'Library_Replays_Emblem', '', deco('showcase-replays-emblem', 0, 0, 115.2, 115.2), `${rect(605, 43.2, 115.2, 115.2)} display: none; pointer-events: none;`), rect(139, 211, 800, 298)));

  const onboarding = view('View_Onboarding', text('WELCOME TO CROWNFALL', 170, 160, 940, 30, 'modal-title', 'Onboarding_Title')
    + text('Pinch a menu option to select it, or touch a button with your fingertip. This is a menu and arena-art preview; chess gameplay is not connected.', 260, 226, 760, 76, 'modal-body', 'Onboarding_Body')
    + modalAction('Btn_StartVisit', 'Start visit', 480, 348) + modalAction('Btn_SkipVisit', 'Skip visit', 672, 348));
  const visit = view('View_Visit', node('div', 'Visit_Scrim', '', '', `${rect(0, 0, 1280, 720)} background-color: #39270c; opacity: 0; pointer-events: none;`)
    + text('ARENA VISIT', 139, 118, 600, 30, 'modal-title', 'Visit_Title', 'text-align: left;')
    + text('1 / 3', 727, 118, 90, 30, 'body', 'Visit_Count', 'text-align: right;')
    + node('div', undefined, 'card', art(ARENAS[0].source, 640, 357.1875, 'Visit_Image', '50% 50%', 'contain'), rect(139, 160, 640, 357.1875))
    + text('Explore the supplied arena artwork. This visit does not start a match or change campaign progress.', 826, 211, 326, 120, 'body', 'Visit_Body')
    + modalAction('Btn_VisitBack', 'Previous', 826, 348) + modalAction('Btn_VisitNext', 'Next', 1018, 348)
    + button('Btn_VisitFinish', 826, 339, 192, 50, text('Finish visit', 0, 13, 192, 24, 'modal-action-label'), 'modal-action', 'display: none;'));
  const pause = view('View_Pause', text('PAUSED', 170, 160, 940, 30, 'modal-title', 'Pause_Title')
    + text('Take your time. Resume the menu, recenter the panel, or return Home.', 260, 226, 760, 76, 'modal-body', 'Pause_Body')
    + modalAction('Btn_Resume', 'Resume', 480, 348) + modalAction('Btn_PauseHome', 'Home', 672, 348));

  let navLeft = 128;
  const nav = NAV_TABS.map((tab, index) => {
    const navId = `Nav_${tab.aria}`;
    const width = geometry.navigation.widths[index];
    const x = navLeft;
    navLeft += width + geometry.navigation.gap;
    return button(navId, x, 68.616, width, 50, hitSurface(width, 50) + node('div', `${navId}_Plate`, 'nav-plate', '', `${rect(0, 9, width, 32.256)} opacity: ${index === 0 ? 1 : 0}; pointer-events: none;`)
      + text(tab.label, 0, 13.128, width, 24, 'nav-label', `${navId}_Title`), 'nav', index === 0 ? `color: ${c.background};` : '');
  }).join('\n');
  const footer = plainAction('Btn_Back', 'Back', 105, 610, 90)
    + plainAction('Btn_Pause', 'Pause', 580, 610, 70, false)
    + plainAction('Btn_Recenter', 'Recenter', 668, 610, 90, false)
    + plainAction('Btn_Exit', 'Exit VR', 776, 610, 70, false)
    + plainAction('Btn_VisitReplay', 'Short visit', 862, 610, 95, false)
    + plainAction('Btn_RetryCreature', 'Retry creature', 975, 610, 115, false)
    + plainAction('Btn_EnterVR', 'Enter VR', 1100, 610, 95)
    + text('Pinch or touch to select.', 105, 680, 640, 24, 'card-description', 'Status_Hint', 'display: none;')
    + text('Hands-first preview', 105, 680, 640, 24, 'card-description', 'Status_Tracking', 'display: none;')
    + text('Menu preview / gameplay unavailable', 105, 680, 1000, 24, 'card-description', 'Status_Boot', 'display: none;');
  const source = `<!-- Generated by scripts/generate-quest-ui.ts. Native live controls, supplied artwork and desktop reference geometry. -->\n<style>${styles}</style>\n<div${id('Crownfall_UI')} class="root">${node('div', 'Scene_Scrim', '', '', `${rect(0, 0, 1280, 720)} background-color: #0a0805; opacity: 0; pointer-events: none;`)}${nav}${[home, play, showcase, chapters, settings, arenas, library, modal, onboarding, visit, pause, details].join('\n')}${footer}</div>\n`;
  const required = [
    ...QUEST_VIEW_IDS, ...QUEST_FIXED_ACTION_IDS, ...QUEST_FIXED_TEXT_IDS, 'Visit_Image', 'Arena_Image', 'Btn_ExploreArenas', 'Settings_Category', 'Scene_Scrim', 'Visit_Scrim', 'Library_Archive', 'Library_Battles_Emblem', 'Library_Replays_Emblem',
    ...HOME_CONTENT.map((item) => `Home_${item.action}`), ...PLAY_CARDS.map((item) => `Play_${item.id}`),
    ...CHAPTERS.map((item) => `Chapter_${item.id}`), ...SHOWCASE_CATEGORIES.map((item) => `Showcase_${item.id}`),
    ...ARENAS.map((_, index) => `Arena_${index}`), ...SETTINGS_CATEGORIES.map((item) => `Settings_${item}`),
    ...Array.from({ length: QUEST_SETTING_ROWS }, (_, index) => [`Setting_${index}`, `Setting_Label_${index}`, `Setting_Value_${index}`]).flat(),
  ];
  for (const elementId of required) if (!ids.has(elementId)) throw new Error(`Missing required Quest UI ID: ${elementId}`);
  const output = destination ? resolve(destination) : resolve(projectRoot, 'main-game-vr/public/ui/menu.uikitml');
  await mkdir(dirname(output), { recursive: true });
  let previous = '';
  try { previous = await readFile(output, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (previous !== source) await writeFile(output, source);
  console.log(`Generated ${output}: ${ids.size} stable native elements, exact1280x720 desktop geometry.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void generateQuestUI().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
