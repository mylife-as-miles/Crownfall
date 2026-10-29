// Spatial UIKit text is drawn from an MSDF atlas that UIKit generates from the
// Barlow TTF files with a fixed ASCII charset. Every Legacy string shown in a
// spatial panel passes through spatialText so a glyph outside that charset can
// never render as an empty box. Typographic punctuation maps to the same ASCII
// stand-ins the Home menu already uses (· becomes /, dashes become -).

/** The glyphs UIKit's TTF loader generates by default (space and tab included). */
export const SPATIAL_TEXT_CHARSET =
  ' \tABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,;:\'"()-[]{}@#$%&*+=/\\<>';

const SUPPORTED = new Set(SPATIAL_TEXT_CHARSET);
const COMBINING_MARK = /[̀-ͯ]/g;
const REPLACEMENTS: Readonly<Record<string, string>> = {
  '‘': "'", '’': "'", '‚': "'", 'ʼ': "'",
  '“': '"', '”': '"', '„': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
  '·': '/', '•': '/',
  '…': '...', '×': 'x', ' ': ' ', '\n': ' ',
  'æ': 'ae', 'Æ': 'Ae', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ß': 'ss',
  'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L',
};

/** True when every character renders from the spatial atlas as-is. */
export function isSpatialText(value: string): boolean {
  for (const character of value) if (!SUPPORTED.has(character)) return false;
  return true;
}

/**
 * Maps text onto the spatial charset: typographic punctuation to ASCII,
 * accented letters to their base letter, and anything else to "?".
 */
export function spatialText(value: string): string {
  if (isSpatialText(value)) return value;
  let out = '';
  for (const character of value) {
    if (SUPPORTED.has(character)) { out += character; continue; }
    const replacement = REPLACEMENTS[character];
    if (replacement !== undefined) { out += replacement; continue; }
    const base = character.normalize('NFD').replace(COMBINING_MARK, '');
    out += base.length > 0 && isSpatialText(base) ? base : '?';
  }
  return out;
}
