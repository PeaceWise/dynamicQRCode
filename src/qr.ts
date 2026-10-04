import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import QRCode from 'qrcode';

const QUIET_ZONE = 4; // modules of white border, as recommended by the QR spec
export const PNG_MIN_SIZE = 2400;

const FONT_FILES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].filter((f) => existsSync(f));

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Builds an SVG path for the dark modules, merging horizontal runs to keep it small. */
function modulePath(text: string): { path: string; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const parts: string[] = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!qr.modules.get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && qr.modules.get(y, x)) x++;
      parts.push(`M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`);
    }
  }
  return { path: parts.join(''), size: n + QUIET_ZONE * 2 };
}

/** Vector QR code (error correction H, 4-module quiet zone). Scales to any print size. */
export function qrSvg(text: string): string {
  const { path, size } = modulePath(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<path fill="#000000" d="${path}"/>` +
    `</svg>`
  );
}

/**
 * High-resolution PNG (at least 2400 px wide). With `label`, the text is printed
 * below the code, outside the quiet zone, so it never interferes with scanning.
 */
export function qrPng(text: string, label?: string): Buffer {
  const { path, size } = modulePath(text);
  const moduleSize = Math.ceil(PNG_MIN_SIZE / size); // whole pixels per module keeps edges sharp
  const width = moduleSize * size;

  let band = 0;
  let labelSvg = '';
  if (label) {
    // Shrink the font for long URLs so the text always fits the width.
    const fontSize = Math.round(Math.min(width * 0.065, (width * 0.9) / (label.length * 0.66)));
    band = Math.round(fontSize * 2.2);
    labelSvg =
      `<text x="${width / 2}" y="${width + band * 0.45}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#000000">${escapeXml(label)}</text>`;
  }
  const height = width + band;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<g transform="scale(${moduleSize})" shape-rendering="crispEdges"><path fill="#000000" d="${path}"/></g>` +
    labelSvg +
    `</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: FONT_FILES, loadSystemFonts: FONT_FILES.length === 0, defaultFontFamily: 'DejaVu Sans' },
  });
  return resvg.render().asPng();
}
