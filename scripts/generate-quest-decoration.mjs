/**
 * Exact, text-free Quest decoration derived from approved desktop SVG/CSS.
 * Generated files live only in the ignored Quest public asset mirror.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRequire = createRequire(resolve(repository, 'main game/package.json'));
const source = (name) => readFileSync(resolve(repository, 'main game/src', name), 'utf8');
const number = (value) => String(Number(value.toFixed(6)));
const quoted = (value) => String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function declaration(css, selector, property) {
  const blocks = new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]+)\\}`, 'gu');
  for (const block of css.matchAll(blocks)) {
    const match = block[1].match(new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`, 'u'));
    if (match) return match[1].trim();
  }
  throw new Error(`Desktop decoration source missing ${selector} { ${property} }`);
}

function functionSource(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Desktop SVG function missing: ${name}`);
  const remainder = text.slice(start + marker.length);
  const end = remainder.search(/\n(?:export |function |const |class |interface |type )/u);
  return end < 0 ? text.slice(start) : text.slice(start, start + marker.length + end);
}

function components(text, names, React, ts) {
  const input = names.map(name => functionSource(text, name)).join('\n');
  const output = ts.transpileModule(input, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  const error = output.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  // Only the named pure, repository-owned SVG functions are evaluated here.
  return Function('React', `${output.outputText}\nreturn { ${names.join(', ')} };`)(React);
}

function sharedModule(name, ts) {
  const input = readFileSync(resolve(repository, 'shared/menu', name), 'utf8');
  const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  Function('exports', output.outputText)(exports);
  return exports;
}

function decorateSVG(markup, attributes) {
  if (!/^<svg\b/u.test(markup) || /<(?:text|foreignObject)\b/iu.test(markup)) throw new Error('Decoration must be text-free SVG');
  return markup.replace(/^<svg\b/u, `<svg xmlns="http://www.w3.org/2000/svg" ${Object.entries(attributes).map(([name, value]) => `${name}="${quoted(value)}"`).join(' ')}`)
    .replace(/\sclass="[^"]*"/gu, '') + '\n';
}

function splitArguments(value) {
  const result = []; let depth = 0; let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++;
    if (value[index] === ')') depth--;
    if (value[index] === ',' && depth === 0) { result.push(value.slice(start, index).trim()); start = index + 1; }
  }
  result.push(value.slice(start).trim()); return result;
}

function firstFunction(value, name) {
  const start = value.indexOf(`${name}(`); let depth = 0;
  if (start < 0) throw new Error(`Desktop decoration missing ${name}`);
  for (let index = start + name.length; index < value.length; index++) {
    if (value[index] === '(') depth++;
    if (value[index] === ')' && --depth === 0) return value.slice(start + name.length + 1, index);
  }
  throw new Error(`Unclosed desktop ${name}`);
}

function rgba(value) {
  if (value === 'transparent') return ['#000000', 0];
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(character => character.repeat(2)).join('');
    return [`#${hex.slice(0, 6)}`, hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1];
  }
  const channels = value.match(/[\d.]+/gu)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported desktop color: ${value}`);
  return [`rgb(${channels.slice(0, 3).join(',')})`, channels[3] ?? 1];
}

function linearGradient(value, width, height, id = 'shade') {
  const [angle, ...items] = splitArguments(firstFunction(value, 'linear-gradient'));
  const radians = Number.parseFloat(angle) * Math.PI / 180;
  const dx = Math.sin(radians), dy = -Math.cos(radians);
  const extent = Math.abs(width * dx) + Math.abs(height * dy);
  const attributes = { x1: width / 2 - dx * extent / 2, y1: height / 2 - dy * extent / 2, x2: width / 2 + dx * extent / 2, y2: height / 2 + dy * extent / 2 };
  const stops = items.map((item, index) => {
    const match = item.match(/^(#[\da-f]+|rgba?\([^)]*\)|transparent)(?:\s+([\d.]+)%)?$/iu);
    if (!match) throw new Error(`Unsupported desktop gradient stop: ${item}`);
    const [color, alpha] = rgba(match[1]);
    const offset = match[2] === undefined ? (index === 0 ? 0 : index === items.length - 1 ? 100 : NaN) : Number(match[2]);
    if (!Number.isFinite(offset)) throw new Error(`Desktop gradient needs an explicit middle stop: ${item}`);
    return `<stop offset="${number(offset)}%" stop-color="${color}" stop-opacity="${number(alpha)}"/>`;
  }).join('');
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${Object.entries(attributes).map(([key, value]) => `${key}="${number(value)}"`).join(' ')}>${stops}</linearGradient>`;
}

const svg = (width, height, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}" preserveAspectRatio="none">${content}</svg>\n`;
const scrim = (width, height, css) => svg(width, height, `<defs>${linearGradient(css, width, height)}</defs><rect width="100%" height="100%" fill="url(#shade)"/>`);

export function generateQuestDecorations(destination = resolve(repository, 'main-game-vr/public/assets/decorations')) {
  const React = desktopRequire('react');
  const { renderToStaticMarkup } = desktopRequire('react-dom/server');
  const ts = desktopRequire('typescript');
  const { MENU_LAYOUT } = sharedModule('theme.ts', ts);
  const { SETTINGS_CATEGORIES } = sharedModule('content.ts', ts);
  const settings = source('SettingsGrid.tsx'), settingsCSS = source('SettingsGrid.css');
  const showcase = source('Showcase.tsx'), showcaseCSS = source('Showcase.css');
  const chapter = source('Chapters.tsx'), chapterCSS = source('Chapters.css');
  const { CategoryIcon } = components(settings, ['Gear', 'CategoryIcon'], React, ts);
  const { ShowcaseIcon, ArchiveArt } = components(showcase, ['ShowcaseIcon', 'ArchiveArt'], React, ts);
  const { ChapterLock } = components(chapter, ['ChapterLock'], React, ts);
  const output = new Map();
  const settingColor = declaration(settingsCSS, '.settings-tile', 'color');
  const settingSelected = declaration(settingsCSS, '.settings-tile.is-selected', 'color');
  const settingOpacity = declaration(settingsCSS, '.settings-tile-icon', 'opacity');
  const cutout = declaration(settingsCSS, '.settings-icon-cutout', 'fill');
  for (const category of SETTINGS_CATEGORIES) {
    const markup = renderToStaticMarkup(React.createElement(CategoryIcon, { category }))
      .replace(/class="settings-icon-cutout"/gu, `fill="${cutout}"`);
    for (const state of ['inactive', 'selected']) output.set(`settings-${category}-${state}.svg`, decorateSVG(markup, {
      width: 100, height: 100, fill: state === 'selected' ? settingSelected : settingColor, opacity: state === 'selected' ? 1 : settingOpacity,
    }));
  }
  for (const kind of ['battles', 'arenas', 'replays']) {
    const markup = renderToStaticMarkup(React.createElement(ShowcaseIcon, { kind }))
      .replace(/class="showcase-icon-accent"/gu, `stroke="${declaration(showcaseCSS, '.showcase-icon-accent', 'stroke')}"`);
    for (const state of ['inactive', 'selected', 'emblem']) {
      output.set(`showcase-${kind}-${state}.svg`, decorateSVG(markup, {
        width: 64, height: 64,
        stroke: declaration(showcaseCSS, state === 'emblem' ? '.showcase-library-emblem' : '.showcase-tile > .showcase-icon', 'color'),
        'stroke-width': declaration(showcaseCSS, state === 'emblem' ? '.showcase-library-emblem > .showcase-icon' : '.showcase-icon', 'stroke-width'),
        'stroke-linecap': declaration(showcaseCSS, '.showcase-icon', 'stroke-linecap'),
        'stroke-linejoin': declaration(showcaseCSS, '.showcase-icon', 'stroke-linejoin'),
        opacity: declaration(showcaseCSS, state === 'emblem' ? '.showcase-library-emblem' : '.showcase-tile > .showcase-icon', 'opacity'),
      }));
    }
  }
  const lock = renderToStaticMarkup(React.createElement(ChapterLock));
  for (const state of ['inactive', 'selected']) {
    const selector = state === 'selected' ? '.chapter-tile.is-selected.is-locked .chapter-lock' : '.chapter-lock';
    output.set(`chapter-lock-${state}.svg`, decorateSVG(lock, {
      width: 24, height: 28, color: declaration(chapterCSS, selector, 'color'), opacity: declaration(chapterCSS, selector, 'opacity'),
    }));
  }
  const plusSource = declaration(settingsCSS, '.settings-tile', 'background-image');
  const encoded = plusSource.match(/url\("data:image\/svg\+xml,([^"]+)"\)/u)?.[1];
  if (!encoded) throw new Error('Desktop settings SVG background was not found');
  const plus = decodeURIComponent(encoded).match(/<svg\b[^>]*>([\s\S]*)<\/svg>/u)?.[1];
  if (!plus) throw new Error('Desktop settings SVG background is not valid');
  const plusRepeat = splitArguments(declaration(settingsCSS, '.settings-tile', 'background-size'))[1].split(/\s+/u).map(value => parseFloat(value) / 100 * MENU_LAYOUT.reference.width);
  const plusViewBox = decodeURIComponent(encoded).match(/viewBox='([^']+)'/u)?.[1] || '0 0 44 44';
  output.set('settings-pattern.svg', svg(300, 219, `<defs><pattern id="plus" width="${number(plusRepeat[0])}" height="${number(plusRepeat[1])}" viewBox="${plusViewBox}" patternUnits="userSpaceOnUse">${plus}</pattern>${linearGradient(plusSource, 300, 219)}</defs><rect width="300" height="219" fill="url(#plus)"/><rect width="300" height="219" fill="url(#shade)"/>`));

  const archive = renderToStaticMarkup(React.createElement(ArchiveArt)).match(/<svg\b[\s\S]*?<\/svg>/u)?.[0];
  if (!archive) throw new Error('Desktop archive seal SVG was not found');
  output.set('showcase-archive-seal.svg', decorateSVG(archive, {
    width: 160, height: 160, stroke: declaration(showcaseCSS, '.showcase-archive-seal', 'stroke'),
    'stroke-width': declaration(showcaseCSS, '.showcase-archive-seal', 'stroke-width'), opacity: declaration(showcaseCSS, '.showcase-archive-seal', 'opacity'),
  }));

  // Exact CSS checker geometry at the shared 1280px design grid: 44.8px
  // squares, -15% overscan, -18deg rotation, and the original ellipse fade.
  const fractions = [...declaration(showcaseCSS, '.showcase-overview', 'grid-template-columns').matchAll(/([\d.]+)fr/gu)].map(match => Number(match[1]));
  const tileWidth = (MENU_LAYOUT.play.width - (fractions.length - 1) * MENU_LAYOUT.play.gap) * fractions.at(-1) / fractions.reduce((sum, value) => sum + value, 0);
  const height = MENU_LAYOUT.play.height;
  for (const [archiveName, width] of [['showcase-archive-background.svg', tileWidth], ['showcase-library-archive-background.svg', MENU_LAYOUT.play.width]]) {
  const checkerBackground = declaration(showcaseCSS, '.showcase-board-pattern', 'background');
  const tile = Number(checkerBackground.match(/\/\s*([\d.]+)cqw/u)?.[1]) / 100 * MENU_LAYOUT.reference.width;
  const inset = parseFloat(declaration(showcaseCSS, '.showcase-board-pattern', 'inset')) / 100;
  const rotation = Number(declaration(showcaseCSS, '.showcase-board-pattern', 'transform').match(/rotate\(([\d.-]+)deg\)/u)?.[1]);
  const x = width * inset, y = height * inset, boxWidth = width * (1 - inset * 2), boxHeight = height * (1 - inset * 2);
  const patternColor = checkerBackground.match(/repeating-conic-gradient\((#[\da-f]+)/iu)?.[1];
  if (!patternColor) throw new Error('Desktop archive checker color was not found');
  const checker = `<pattern id="checker" x="${number(width / 2 - tile / 2)}" y="${number(height / 2 - tile / 2)}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><path d="M${number(tile / 2)} 0h${number(tile / 2)}v${number(tile / 2)}H${number(tile / 2)}zM0 ${number(tile / 2)}h${number(tile / 2)}v${number(tile / 2)}H0z" fill="${patternColor}"/></pattern>`;
  const fade = `<radialGradient id="fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${number(boxWidth / 2 * Math.SQRT2)} 0 0 ${number(boxHeight / 2 * Math.SQRT2)} ${number(width / 2)} ${number(height / 2)})"><stop stop-color="white"/><stop offset="75%" stop-color="white" stop-opacity="0"/></radialGradient>`;
  const mask = `<mask id="checker-mask" maskUnits="userSpaceOnUse" x="${number(x)}" y="${number(y)}" width="${number(boxWidth)}" height="${number(boxHeight)}"><rect x="${number(x)}" y="${number(y)}" width="${number(boxWidth)}" height="${number(boxHeight)}" fill="url(#fade)"/></mask>`;
  const checkerGroup = `<g opacity="${declaration(showcaseCSS, '.showcase-board-pattern', 'opacity')}" transform="rotate(${rotation} ${number(width / 2)} ${number(height / 2)})" mask="url(#checker-mask)"><rect x="${number(x)}" y="${number(y)}" width="${number(boxWidth)}" height="${number(boxHeight)}" fill="url(#checker)"/></g>`;
  if (width === tileWidth) output.set('showcase-board-pattern.svg', svg(width, height, `<defs>${checker}${fade}${mask}</defs>${checkerGroup}`));
  const archiveStops = splitArguments(firstFunction(declaration(showcaseCSS, '.showcase-archive-art', 'background'), 'radial-gradient'));
  const center = [...archiveStops[0].matchAll(/([\d.]+)%/gu)].map(match => Number(match[1]) / 100);
  const radius = Math.hypot(Math.max(center[0], 1 - center[0]), Math.max(center[1], 1 - center[1]));
  const background = `<radialGradient id="archive" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${number(width * radius)} 0 0 ${number(height * radius)} ${number(width * center[0])} ${number(height * center[1])})"><stop stop-color="${archiveStops[1]}"/><stop offset="${archiveStops[2].match(/[\d.]+%/u)?.[0]}" stop-color="${archiveStops[2].match(/#[\da-f]+/iu)?.[0]}"/></radialGradient>`;
  output.set(archiveName, svg(width, height, `<defs>${background}${checker}${fade}${mask}</defs><rect width="100%" height="100%" fill="url(#archive)"/>${checkerGroup}`));
  }

  const shades = [
    ['play-scrim.svg', MENU_LAYOUT.play.cardWidth, MENU_LAYOUT.play.cardHeight, source('styles.css'), '.card-shade'],
    ['home-scrim.svg', MENU_LAYOUT.home.leftWidth, MENU_LAYOUT.home.height, source('HomeGrid.css'), '.home-tile-shade'],
    ['showcase-scrim.svg', 300, MENU_LAYOUT.play.height, showcaseCSS, '.showcase-tile-shade'],
    ['chapter-scrim.svg', MENU_LAYOUT.chapters.width / MENU_LAYOUT.chapters.columns, MENU_LAYOUT.chapters.height / MENU_LAYOUT.chapters.rows, chapterCSS, '.chapter-shade'],
    ['chapter-locked-scrim.svg', MENU_LAYOUT.chapters.width / MENU_LAYOUT.chapters.columns, MENU_LAYOUT.chapters.height / MENU_LAYOUT.chapters.rows, chapterCSS, '.chapter-tile.is-locked .chapter-shade'],
  ];
  for (const [name, shadeWidth, shadeHeight, css, selector] of shades) {
    output.set(name, scrim(shadeWidth, shadeHeight, declaration(css, selector, 'background')));
  }

  mkdirSync(destination, { recursive: true });
  let written = 0;
  for (const [name, value] of output) {
    if (/<(?:text|foreignObject|image)\b/iu.test(value)) throw new Error(`Decoration contains rendered text or substituted artwork: ${name}`);
    const path = resolve(destination, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== value) { writeFileSync(path, value); written++; }
  }
  return { files: [...output.keys()], written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateQuestDecorations(process.argv[2] && resolve(process.argv[2]));
  console.log(`Generated ${result.files.length} desktop-derived SVG decorations (${result.written} changed).`);
}
