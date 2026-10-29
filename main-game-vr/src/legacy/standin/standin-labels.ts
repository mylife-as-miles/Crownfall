// Canvas-drawn placards for the gameplay stand-in environment. They are drawn
// once when the stand-in is created (and when its copy changes), never per frame.

import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from '@iwsdk/core';

export interface PlacardLines {
  title: string;
  subtitle?: string;
}

const FONT_STACK = 'Barlow, "Segoe UI", Arial, sans-serif';

/** A dark, gold-edged placard texture. Width and height must be powers of two for mipmaps. */
export function drawPlacard(lines: PlacardLines, width: number, height: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) {
    const inset = Math.round(height * 0.06);
    context.fillStyle = 'rgba(18, 15, 10, 0.94)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#c08a34';
    context.lineWidth = Math.max(2, Math.round(height * 0.035));
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const hasSubtitle = !!lines.subtitle;
    const titleSize = Math.round(height * (hasSubtitle ? 0.3 : 0.46));
    context.fillStyle = '#efe4c8';
    context.font = `600 ${titleSize}px ${FONT_STACK}`;
    fitText(context, lines.title, width - inset * 4, titleSize, '600');
    context.fillText(lines.title, width / 2, height * (hasSubtitle ? 0.31 : 0.53));
    if (lines.subtitle) {
      // Up to two wrapped lines, so a longer note stays legible instead of shrinking onto one line.
      context.fillStyle = '#cdbf9f';
      const rows = wrapText(context, lines.subtitle, width - inset * 4, Math.round(height * 0.16), 2);
      rows.forEach((row, index) => context.fillText(row, width / 2, height * (rows.length === 1 ? 0.7 : 0.62 + index * 0.19)));
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

/** Greedy word wrap into at most `maxRows` rows, shrinking the font only when the words still do not fit. */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, maxRows: number): string[] {
  const words = text.split(' ');
  for (let current = size; ; current -= 2) {
    context.font = `400 ${current}px ${FONT_STACK}`;
    const rows: string[] = [];
    let row = '';
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (row && context.measureText(candidate).width > maxWidth) { rows.push(row); row = word; } else row = candidate;
    }
    if (row) rows.push(row);
    if (rows.length <= maxRows || current <= 12) return rows.slice(0, maxRows);
  }
}

/** Shrinks the font until the text fits the given width. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: string): void {
  let current = size;
  while (current > 8 && context.measureText(text).width > maxWidth) {
    current -= 2;
    context.font = `${weight} ${current}px ${FONT_STACK}`;
  }
}
