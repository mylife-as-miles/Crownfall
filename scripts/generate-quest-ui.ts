/**
 * Generate the static native Quest UI from the same content as desktop.
 * Run with tsx before the Quest build. No intermediate compiled JSON is used.
 * UIKitML image syntax is documented at:
 * https://iwsdk.dev/guides/10-spatial-ui-uikitml.html#image-elements
 * Numeric UIKit units are centimetres before the authored 0.1 scene scale;
 * every interactive target here is at least 50 units (5 cm after scaling).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARENAS, CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS,
  SETTINGS_CATEGORIES, SHOWCASE_CATEGORIES, getModalContent,
} from '../shared/menu/content.ts';
import { MENU_LAYOUT, MENU_THEME } from '../shared/menu/theme.ts';
import {
  QUEST_FIXED_ACTION_IDS, QUEST_FIXED_TEXT_IDS, QUEST_SETTING_ROWS,
  QUEST_UI_LAYOUT, QUEST_VIEW_IDS,
} from '../main-game-vr/src/ui-contract.ts';

export async function generateQuestUI(destination?: string): Promise<void> {
  const ids = new Set<string>();
  const ascii = (value: string): string => value
    .replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-').replace(/·/gu, '/');
  const escape = (value: string): string => ascii(value)
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  const id = (value: string): string => {
    if (ids.has(value)) throw new Error(`Duplicate Quest UI ID: ${value}`);
    ids.add(value);
    return ` id="${value}"`;
  };
  const text = (value: string, className = 'body', elementId?: string): string =>
    `<span${elementId ? id(elementId) : ''} class="${className}">${escape(value)}</span>`;
  const art = (source: string, width: number, height: number, elementId?: string): string =>
    `<img${elementId ? id(elementId) : ''} src="..${escape(source)}" style="width: ${width}; height: ${height};" />`;
  const action = (elementId: string, label: string, className = 'action', extraStyle = ''): string =>
    `<button${id(elementId)} class="${className}"${extraStyle ? ` style="${extraStyle}"` : ''}>${escape(label)}</button>`;
  const view = (name: string, contents: string, extra = ''): string =>
    `<div${id(name)} class="view" style="display: ${name === 'View_Home' ? 'flex' : 'none'}; ${extra}">${contents}</div>`;
  const sectionHeading = (heading: string, subheading = ''): string =>
    `<div class="section-heading">${text(heading, 'heading')}${subheading ? text(subheading, 'muted') : ''}</div>`;
  const c = MENU_THEME.colors;
  const homeGrid = MENU_LAYOUT.home;
  const playGrid = MENU_LAYOUT.play;

  const styles = `
    .root { width: ${QUEST_UI_LAYOUT.width}; height: ${QUEST_UI_LAYOUT.height}; flex-direction: column; padding-top: 10; padding-right: 40; padding-bottom: 10; padding-left: 40; gap: 10; color: ${c.text}; }
    .header { height: 64; flex-direction: row; align-items: center; justify-content: space-between; }
    .wordmark { font-size: 40; font-weight: 700; color: ${c.text}; }
    .identity { font-size: 18; color: ${c.accent}; }
    .header-status { width: 400; flex-direction: column; align-items: flex-end; gap: 4; }
    .navigation { height: 64; flex-direction: row; gap: 20; align-items: center; }
    .nav { width: 176; height: 56; justify-content: center; align-items: center; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; border-radius: 0; font-size: 28; font-weight: 600; color: ${c.inactiveHeading}; cursor: pointer; }
    .active-nav { background-color: ${c.activeTab}; color: ${c.background}; }
    .nav:hover { border-color: ${c.tealRim}; color: ${c.text}; }
    .content { width: 1200; height: 454; flex-direction: column; }
    .view { width: 1200; height: 454; flex-direction: column; }
    .heading { font-size: 34; font-weight: 600; color: ${c.modalHeading}; }
    .body { font-size: 24; color: ${c.text}; line-height: 1.3; }
    .muted { font-size: 22; color: ${c.inactiveHeading}; line-height: 1.3; }
    .small { font-size: 20; color: ${c.inactiveHeading}; line-height: 1.3; }
    .section-heading { height: 56; flex-direction: column; justify-content: center; gap: 4; }
    .row { flex-direction: row; gap: 12; }
    .home-row { flex-direction: row; gap: ${MENU_LAYOUT.home.gap}; margin-left: 65; margin-top: 8; }
    .home-stack { width: ${homeGrid.rightWidth}; flex-direction: column; gap: ${homeGrid.gap}; }
    .home-feature { width: ${homeGrid.leftWidth}; height: ${homeGrid.height}; flex-direction: column; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; cursor: pointer; }
    .home-small { width: ${homeGrid.rightWidth}; height: ${homeGrid.rightHeight}; flex-direction: column; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; cursor: pointer; }
    .tile-label { height: 50; padding-left: 12; padding-right: 12; align-items: center; justify-content: center; font-size: 28; font-weight: 600; color: ${c.text}; }
    .play-row { flex-direction: row; gap: ${MENU_LAYOUT.play.gap}; margin-left: 99; margin-top: 64; }
    .play-card { width: ${playGrid.cardWidth}; height: ${playGrid.cardHeight}; flex-direction: column; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; cursor: pointer; }
    .card-copy { flex-direction: column; padding-top: 10; padding-right: 12; padding-bottom: 10; padding-left: 12; gap: 6; }
    .card-title { font-size: 26; font-weight: 600; color: ${c.modalHeading}; line-height: 1.15; }
    .card-subtitle { font-size: 20; color: ${c.text}; line-height: 1.2; }
    .card-description { font-size: 18; color: ${c.inactiveHeading}; line-height: 1.25; }
    .category-row { flex-direction: row; gap: 18; margin-top: 28; margin-left: 65; }
    .category { width: 280; height: 320; flex-direction: column; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; cursor: pointer; }
    .arena-gallery { width: 600; height: 454; flex-direction: column; gap: 10; margin-left: 120; }
    .arena-caption { width: 600; height: 42; flex-direction: row; justify-content: space-between; align-items: center; }
    .arena-selectors { width: 600; height: 56; flex-direction: row; gap: 12; }
    .arena { width: 141; height: 56; justify-content: center; align-items: center; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; color: ${c.text}; font-size: 26; cursor: pointer; }
    .chapter-grid { flex-direction: column; gap: 12; margin-left: 100; }
    .chapter-row { flex-direction: row; gap: 12; }
    .chapter { width: 180; height: 120; flex-direction: column; background-color: ${c.surface}; border-width: 1; border-color: ${c.accent}; cursor: pointer; }
    .chapter-label { font-size: 24; font-weight: 600; color: ${c.text}; padding-left: 8; }
    .chapter-state { font-size: 18; color: ${c.inactiveHeading}; padding-left: 8; }
    .settings-grid { flex-direction: column; gap: 18; margin-top: 40; margin-left: 65; }
    .settings-category { width: 306; height: 128; align-items: center; justify-content: center; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; font-size: 30; font-weight: 600; color: ${c.text}; cursor: pointer; }
    .settings-detail-heading { height: 136; }
    .settings-columns { flex-direction: row; gap: 20; margin-top: 10; }
    .settings-column { width: 550; flex-direction: column; gap: 6; }
    .setting-row { width: 550; height: 54; flex-direction: row; align-items: center; justify-content: space-between; padding-left: 14; padding-right: 14; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; cursor: pointer; }
    .setting-label { width: 330; font-size: 24; color: ${c.text}; }
    .setting-value { width: 190; font-size: 22; line-height: 1.1; font-weight: 600; color: ${c.modalHeading}; text-align: right; }
    .center-view { align-items: center; padding-top: 42; gap: 28; }
    .center-copy { width: 900; flex-direction: column; align-items: center; gap: 22; }
    .center-title { font-size: 34; font-weight: 600; color: ${c.modalHeading}; text-align: center; }
    .center-body { width: 900; font-size: 26; line-height: 1.4; color: ${c.modalText}; text-align: center; }
    .center-note { width: 900; font-size: 22; line-height: 1.35; color: ${c.modalText}; text-align: center; }
    .center-actions { flex-direction: row; gap: 64; justify-content: center; margin-top: 16; }
    .action { width: 208; height: 64; justify-content: center; align-items: center; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; border-radius: 0; color: ${c.text}; font-size: 26; cursor: pointer; }
    .action:hover { background-color: ${c.accent}; color: ${c.background}; border-color: ${c.focus}; }
    .action:active { background-color: ${c.activeTab}; }
    .home-feature:hover { border-color: ${c.tealRim}; }
    .home-small:hover { border-color: ${c.tealRim}; }
    .play-card:hover { border-color: ${c.tealRim}; }
    .category:hover { border-color: ${c.tealRim}; }
    .arena:hover { border-color: ${c.tealRim}; }
    .chapter:hover { border-color: ${c.tealRim}; }
    .settings-category:hover { border-color: ${c.tealRim}; }
    .setting-row:hover { border-color: ${c.tealRim}; }
    .footer { height: 88; flex-direction: column; justify-content: space-between; }
    .footer-actions { flex-direction: row; gap: 12; }
    .footer-button { width: 160; height: 56; justify-content: center; align-items: center; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; color: ${c.text}; font-size: 25; cursor: pointer; }
    .footer-button:hover { border-color: ${c.tealRim}; }
    .footer-status { flex-direction: row; gap: 24; align-items: center; }
    .tour-layout { flex-direction: row; gap: 24; margin-top: 18; }
    .tour-copy { width: 520; flex-direction: column; gap: 22; }
    .tour-buttons { flex-direction: row; gap: 12; margin-top: 16; }
    .tour-action { width: 156; height: 64; justify-content: center; align-items: center; background-color: ${c.surface}; border-color: ${c.accent}; border-width: 1; font-size: 24; color: ${c.text}; cursor: pointer; }
  `;

  const home = view('View_Home', `<div class="home-row">
    <button${id(`Home_${HOME_CONTENT[0].action}`)} class="home-feature">${art(HOME_CONTENT[0].imageSrc!, homeGrid.leftWidth - 2, homeGrid.height - 52)}${text(HOME_CONTENT[0].title!, 'tile-label')}</button>
    <div class="home-stack">${HOME_CONTENT.slice(1).map((tile) => `<button${id(`Home_${tile.action}`)} class="home-small">${art(tile.imageSrc!, homeGrid.rightWidth - 2, homeGrid.rightHeight - 52)}${text(tile.title!, 'tile-label')}</button>`).join('\n')}</div>
  </div>`);

  const play = view('View_Play', `<div class="play-row">${PLAY_CARDS.map((card) => `<button${id(`Play_${card.id}`)} class="play-card">
    ${art(`/assets/environments/card-${card.artwork}.webp`, playGrid.cardWidth - 2, 110)}
    <div class="card-copy">${text(card.title, 'card-title')}${text(card.subtitle, 'card-subtitle')}${card.description ? text(card.description, 'card-description') : ''}</div>
  </button>`).join('\n')}</div>`);

  const showcase = view('View_Showcase', `<div class="category-row">${SHOWCASE_CATEGORIES.map((item) => `<button${id(`Showcase_${item.id}`)} class="category">
    ${item.art ? art(item.art, 278, 156) : '<div style="width: 278; height: 156; background-color: #211b13; align-items: center; justify-content: center;">'+text('FUTURE', 'heading')+'</div>'}
    <div class="card-copy">${text(item.title, 'card-title')}${text(item.status, 'card-subtitle')}${text(item.description, 'card-description')}</div>
  </button>`).join('\n')}</div>`);

  // The approved arena artwork is 2048 by 1143. An exact-ratio image keeps
  // the complete frame visible without depending on undocumented fit properties.
  const arenaImageWidth = 600;
  const arenaImageHeight = arenaImageWidth * 1143 / 2048;
  const arenas = view('View_Arenas', `<div class="arena-gallery"><div class="arena-caption">${text(ARENAS[0].label, 'heading', 'Arena_Title')}${text(`1 / ${ARENAS.length}`, 'muted', 'Arena_Count')}</div>${art(ARENAS[0].source, arenaImageWidth, arenaImageHeight, 'Arena_Image')}<div class="arena-selectors">${ARENAS.map((arena, index) => action(`Arena_${index}`, arena.label, 'arena')).join('\n')}</div></div>`);

  const chapterRows = Array.from({ length: 3 }, (_, row) => `<div class="chapter-row">${CHAPTERS.slice(row * 5, row * 5 + 5).map((chapter) => `<button${id(`Chapter_${chapter.id}`)} class="chapter">${art(chapter.imageSrc, 178, 62)}${text(chapter.title, 'chapter-label')}${text(chapter.locked ? 'Locked' : 'Preview', 'chapter-state')}</button>`).join('\n')}</div>`).join('\n');
  const chapters = view('View_Chapters', `${sectionHeading('CHAPTERS', 'Selection preview only / no campaign progress is recorded.')}<div class="chapter-grid">${chapterRows}</div>`);

  const categoryLabel = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
  const settings = view('View_Settings', `${sectionHeading('SETTINGS', 'Menu preferences and hand interaction')}<div class="settings-grid">${[0, 3].map((start) => `<div class="row">${SETTINGS_CATEGORIES.slice(start, start + 3).map((category) => action(`Settings_${category}`, categoryLabel(category), 'settings-category')).join('')}</div>`).join('')}</div>`);
  const settingColumns = [0, 5].map((start) => `<div class="settings-column">${Array.from({ length: 5 }, (_, offset) => {
    const index = start + offset;
    return `<button${id(`Setting_${index}`)} class="setting-row">${text('Preference', 'setting-label', `Setting_Label_${index}`)}${text('Value', 'setting-value', `Setting_Value_${index}`)}</button>`;
  }).join('')}</div>`).join('');
  const details = view('View_SettingsDetail', `<div class="section-heading settings-detail-heading">${text('SETTINGS', 'heading', 'Settings_Title')}${text('Pinch or touch a preference to change it.', 'muted', 'Settings_Description')}</div><div class="settings-columns">${settingColumns}</div>`);

  const initialModal = getModalContent('classic');
  const modal = view('View_Modal', `<div class="center-copy">${text(initialModal.title, 'center-title', 'Modal_Title')}${text(initialModal.description, 'center-body', 'Modal_Description')}${text(initialModal.note || '', 'center-note', 'Modal_Note')}</div><div class="center-actions">${action('Btn_Confirm', 'Confirm')}${action('Btn_Cancel', 'Cancel')}</div>`, 'align-items: center; padding-top: 42; gap: 28;');
  const library = view('View_Library', `<div class="center-copy">${text('AI BATTLES', 'center-title', 'Library_Title')}${text('No cinematic battles are available in this build.', 'center-body', 'Library_Description')}${text('Use Back to return to Showcase.', 'center-note')}</div>`, 'align-items: center; padding-top: 72;');
  const onboarding = view('View_Onboarding', `<div class="center-copy">${text('WELCOME TO CROWNFALL', 'center-title', 'Onboarding_Title')}${text('Pinch a menu option to select it, or touch a button with your fingertip. This is a menu and arena-art preview; chess gameplay is not connected.', 'center-body', 'Onboarding_Body')}${text('A short three-arena visit will introduce the space. You can skip it.', 'center-note')}</div><div class="center-actions">${action('Btn_StartVisit', 'Start visit')}${action('Btn_SkipVisit', 'Skip visit')}</div>`, 'align-items: center; padding-top: 42; gap: 28;');
  const visit = view('View_Visit', `<div class="section-heading">${text('ARENA VISIT', 'heading', 'Visit_Title')}${text('1 / 3', 'muted', 'Visit_Count')}</div><div class="tour-layout">${art(ARENAS[0].source, 580, 326, 'Visit_Image')}<div class="tour-copy">${text(ARENAS[0].label, 'heading')}${text('Explore the supplied arena artwork. This visit does not start a match or change campaign progress.', 'body', 'Visit_Body')}<div class="tour-buttons">${action('Btn_VisitBack', 'Previous', 'tour-action')}${action('Btn_VisitNext', 'Next', 'tour-action')}${action('Btn_VisitFinish', 'Finish visit', 'tour-action', 'display: none;')}</div></div></div>`);
  const pause = view('View_Pause', `<div class="center-copy">${text('PAUSED', 'center-title', 'Pause_Title')}${text('Take your time. Resume the menu, recenter the panel, or return Home.', 'center-body', 'Pause_Body')}</div><div class="center-actions">${action('Btn_Resume', 'Resume')}${action('Btn_PauseHome', 'Home')}</div>`, 'align-items: center; padding-top: 72; gap: 28;');

  const nav = NAV_TABS.map((tab, index) => action(`Nav_${tab.aria}`, tab.label, `nav${index === 0 ? ' active-nav' : ''}`)).join('\n');
  const footer = `<div class="footer"><div class="footer-actions">${action('Btn_Back', 'Back', 'footer-button')}${action('Btn_Pause', 'Pause', 'footer-button', 'display: none;')}${action('Btn_Recenter', 'Recenter', 'footer-button', 'display: none;')}${action('Btn_Exit', 'Exit VR', 'footer-button', 'display: none;')}${action('Btn_RetryCreature', 'Retry creature', 'footer-button', 'display: none; width: 184;')}${action('Btn_VisitReplay', 'Short visit', 'footer-button', 'display: none;')}${action('Btn_EnterVR', 'Enter VR', 'footer-button')}</div><div class="footer-status">${text('Pinch or touch to select.', 'small', 'Status_Hint')}${text('Hands-first preview', 'small', 'Status_Tracking')}</div></div>`;
  const source = `<!-- Generated by scripts/generate-quest-ui.ts. Edit shared/menu content and this generator; do not hand-edit this static document. -->
  <style>${styles}</style>
  <div${id('Crownfall_UI')} class="root">
    <div class="header"><div><span class="wordmark">CROWNFALL</span><span class="identity">A KING'S GAMBIT STORY</span></div><div class="header-status">${text('Menu preview / gameplay unavailable', 'small', 'Status_Boot')}</div></div>
    <div class="navigation">${nav}</div>
    <div class="content">${[home, play, showcase, chapters, settings, arenas, library, modal, onboarding, visit, pause, details].join('\n')}</div>
    ${footer}
  </div>
  `;

  const required = [
    ...QUEST_VIEW_IDS, ...QUEST_FIXED_ACTION_IDS, ...QUEST_FIXED_TEXT_IDS, 'Visit_Image', 'Arena_Image',
    ...HOME_CONTENT.map((item) => `Home_${item.action}`),
    ...PLAY_CARDS.map((item) => `Play_${item.id}`),
    ...CHAPTERS.map((item) => `Chapter_${item.id}`),
    ...SHOWCASE_CATEGORIES.map((item) => `Showcase_${item.id}`),
    ...ARENAS.map((_, index) => `Arena_${index}`),
    ...SETTINGS_CATEGORIES.map((item) => `Settings_${item}`),
    ...Array.from({ length: QUEST_SETTING_ROWS }, (_, index) => [`Setting_${index}`, `Setting_Label_${index}`, `Setting_Value_${index}`]).flat(),
  ];
  for (const elementId of required) {
    if (!ids.has(elementId)) throw new Error(`Missing required Quest UI ID: ${elementId}`);
  }
  if (/[\u2013\u2014\u2018\u2019]/u.test(source)) throw new Error('Unsupported typographic punctuation in generated native UI');
  const output = destination
    ? resolve(destination)
    : resolve(dirname(fileURLToPath(import.meta.url)), '../main-game-vr/public/ui/menu.uikitml');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, source.trimEnd() + '\n');
  console.log(`Generated ${output}: ${ids.size} stable elements, ${PLAY_CARDS.length} Play cards, ${CHAPTERS.length} chapters.`);
}

// Importing this module is side-effect free. Only direct CLI invocation writes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void generateQuestUI().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
