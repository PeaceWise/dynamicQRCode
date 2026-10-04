import { Resvg } from '@resvg/resvg-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { DEFAULT_DESIGN, contrastRatio, type QrDesign } from './qrDesign.js';

const QUIET_ZONE = 4; // modules of empty border, as recommended by the QR spec
export const PNG_MIN_SIZE = 2400;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const FONT_FILES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].filter((f) => existsSync(f));
const FONT_FAMILY = 'DejaVu Sans, Arial, Helvetica, sans-serif';

const BRAND_LOGO = `data:image/png;base64,${readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo-mark.png'),
).toString('base64')}`;

// Logo width as a share of the code's width. Error correction level H can
// recover ~30% damage; even "large" covers well under 10% of the modules.
const LOGO_SCALE = { small: 0.16, medium: 0.21, large: 0.26 } as const;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const n = (v: number) => Number(v.toFixed(3)).toString();

function rectPath(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
  return (
    `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}` +
    `v${n(h - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}` +
    `h${n(-(w - 2 * r))}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}` +
    `v${n(-(h - 2 * r))}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}z`
  );
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`;
}

/** A module whose corners are rounded only where it has no dark neighbour, giving a smooth "liquid" look. */
function roundedModulePath(x: number, y: number, up: boolean, right: boolean, down: boolean, left: boolean): string {
  const r = 0.5;
  const tl = !up && !left ? r : 0;
  const tr = !up && !right ? r : 0;
  const br = !down && !right ? r : 0;
  const bl = !down && !left ? r : 0;
  let p = `M${n(x + tl)} ${n(y)}H${n(x + 1 - tr)}`;
  if (tr) p += `a${r} ${r} 0 0 1 ${r} ${r}`;
  p += `V${n(y + 1 - br)}`;
  if (br) p += `a${r} ${r} 0 0 1 ${-r} ${r}`;
  p += `H${n(x + bl)}`;
  if (bl) p += `a${r} ${r} 0 0 1 ${-r} ${-r}`;
  p += `V${n(y + tl)}`;
  if (tl) p += `a${r} ${r} 0 0 1 ${r} ${-r}`;
  return p + 'z';
}

// Built-in icons, drawn in white on an accent-colored circle (100 x 100 box).
const PRESET_ICONS: Record<string, (accent: string) => string> = {
  agenda: (a) =>
    `<rect x="31" y="22" width="38" height="56" rx="5" fill="#fff"/>` +
    [36, 46, 56, 66].map((y, i) => `<rect x="38" y="${y}" width="${i === 3 ? 14 : 24}" height="4" rx="2" fill="${a}"/>`).join(''),
  calendar: (a) =>
    `<rect x="24" y="30" width="52" height="46" rx="7" fill="#fff"/><rect x="24" y="30" width="52" height="12" rx="6" fill="#fff"/>` +
    `<rect x="35" y="21" width="7" height="16" rx="3.5" fill="#fff" stroke="${a}" stroke-width="3"/>` +
    `<rect x="58" y="21" width="7" height="16" rx="3.5" fill="#fff" stroke="${a}" stroke-width="3"/>` +
    [0, 1, 2].flatMap((c) => [0, 1].map((r) => `<rect x="${33 + c * 13}" y="${48 + r * 12}" width="8" height="7" rx="1.5" fill="${a}"/>`)).join(''),
  home: () => `<path d="M50 22 80 48H71V77H57V60H43V77H29V48H20Z" fill="#fff" stroke-linejoin="round"/>`,
  link: () =>
    `<g transform="rotate(-45 50 50)" fill="none" stroke="#fff" stroke-width="7.5">` +
    `<rect x="18" y="39" width="36" height="22" rx="11"/><rect x="46" y="39" width="36" height="22" rx="11"/></g>`,
};

export interface RenderOptions {
  /** Data URI of an uploaded logo (PNG), used when design.logo === 'custom'. */
  customLogo?: string | null;
  /** Text printed under the code, e.g. the short URL. */
  label?: string;
  /** Leave out the logo (used for small option thumbnails). */
  noLogo?: boolean;
}

interface Built {
  body: string;
  width: number; // in module units
  height: number;
  codeSize: number; // modules incl. quiet zone
}

function build(text: string, d: QrDesign, opts: RenderOptions): Built {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const N = qr.modules.size;
  const S = N + QUIET_ZONE * 2;

  // ---- Logo area (centered, aligned to the module grid) ----
  let logoHref: string | null = null;
  let logoIcon: string | null = null;
  if (!opts.noLogo) {
    if (d.logo === 'wayward') logoHref = BRAND_LOGO;
    else if (d.logo === 'custom') logoHref = opts.customLogo ?? null;
    else if (d.logo in PRESET_ICONS) logoIcon = PRESET_ICONS[d.logo](d.accent);
  }
  const hasLogo = Boolean(logoHref || logoIcon);
  let L = Math.round(N * LOGO_SCALE[d.logoSize]);
  if ((N - L) % 2 !== 0) L += 1;
  const lo = (N - L) / 2; // first module index inside the logo box
  const cleared = (r: number, c: number) => hasLogo && d.logoClear && r >= lo && r < lo + L && c >= lo && c < lo + L;

  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
  // isReserved() exists at runtime but is missing from @types/qrcode.
  const matrix = qr.modules as typeof qr.modules & { isReserved(r: number, c: number): boolean };
  const reserved = (r: number, c: number) => matrix.isReserved(r, c);
  const dark = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < N && c < N && !finder(r, c) && !cleared(r, c) && qr.modules.get(r, c) === 1;

  // ---- Data modules ----
  const parts: string[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!dark(r, c)) continue;
      const x = c + QUIET_ZONE;
      const y = r + QUIET_ZONE;
      if (d.dots === 'square') {
        const start = c;
        while (c + 1 < N && dark(r, c + 1)) c++;
        parts.push(`M${x} ${y}h${c - start + 1}v1h${-(c - start + 1)}z`);
      } else if (d.dots === 'dots') {
        // Timing lines and alignment patterns stay solid: decoders depend on them.
        if (reserved(r, c)) parts.push(rectPath(x, y, 1, 1, 0));
        else parts.push(circlePath(x + 0.5, y + 0.5, 0.46));
      } else {
        parts.push(roundedModulePath(x, y, dark(r - 1, c), dark(r, c + 1), dark(r + 1, c), dark(r, c - 1)));
      }
    }
  }

  // ---- Corner "eyes" (finder patterns) ----
  const eyes: string[] = [];
  for (const [er, ec] of [[0, 0], [0, N - 7], [N - 7, 0]]) {
    const x = ec + QUIET_ZONE;
    const y = er + QUIET_ZONE;
    if (d.eyeFrame === 'circle') eyes.push(circlePath(x + 3.5, y + 3.5, 3.5) + circlePath(x + 3.5, y + 3.5, 2.5));
    else {
      const [ro, ri] = d.eyeFrame === 'rounded' ? [2.2, 1.4] : [0, 0];
      eyes.push(rectPath(x, y, 7, 7, ro) + rectPath(x + 1, y + 1, 5, 5, ri));
    }
    if (d.eyeBall === 'circle') eyes.push(circlePath(x + 3.5, y + 3.5, 1.5));
    else eyes.push(rectPath(x + 2, y + 2, 3, 3, d.eyeBall === 'rounded' ? 0.9 : 0));
  }

  let code =
    `<path fill="${d.fg}" d="${parts.join('')}"/>` +
    `<path fill="${d.eye}" fill-rule="evenodd" d="${eyes.join('')}"/>`;

  if (hasLogo) {
    const box = lo + QUIET_ZONE;
    const pad = d.logoClear ? 0.5 : 0;
    const x = box + pad;
    const size = L - pad * 2;
    if (logoHref) {
      if (!d.logoClear) code += `<rect x="${n(x)}" y="${n(x)}" width="${n(size)}" height="${n(size)}" rx="${n(size * 0.12)}" fill="${d.bg}"/>`;
      code += `<image x="${n(x)}" y="${n(x)}" width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid meet" xlink:href="${logoHref}"/>`;
    } else {
      code += `<svg x="${n(x)}" y="${n(x)}" width="${n(size)}" height="${n(size)}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${d.accent}"/>${logoIcon}</svg>`;
    }
  }

  // ---- Frame around the code ----
  const frameInk = contrastRatio(d.accent, '#ffffff') >= 3 ? '#ffffff' : '#000000';
  const frameText = escapeXml(d.frameText || ' ');
  const textSize = (width: number, height: number) => Math.min(height * 0.55, (width * 0.82) / (Math.max(d.frameText.length, 4) * 0.68));
  let body = '';
  let width = S;
  let height = S;

  if (d.frame === 'none') {
    body = `<rect width="${S}" height="${S}" fill="${d.bg}"/>${code}`;
  } else if (d.frame === 'box' || d.frame === 'top') {
    const t = 1;
    const bar = Math.round(S * 0.22);
    width = S + 2 * t;
    height = S + t + bar;
    const codeY = d.frame === 'box' ? t : bar;
    const barMid = d.frame === 'box' ? S + t + bar / 2 : bar / 2;
    body =
      `<rect width="${width}" height="${height}" rx="${n(t * 2)}" fill="${d.accent}"/>` +
      `<rect x="${t}" y="${codeY}" width="${S}" height="${S}" rx="0.6" fill="${d.bg}"/>` +
      `<g transform="translate(${t} ${codeY})">${code}</g>` +
      `<text x="${n(width / 2)}" y="${n(barMid)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-weight="bold" font-size="${n(textSize(width, bar))}" fill="${frameInk}">${frameText}</text>`;
  } else {
    // pill: thin rounded border around the code and a separate rounded label below
    const t = 1;
    const gap = 1;
    const pill = Math.round(S * 0.18);
    width = S + 2 * t;
    height = S + 2 * t + gap + pill;
    const pillW = width * 0.78;
    body =
      `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
      `<rect width="${width}" height="${S + 2 * t}" rx="${n(t * 2.5)}" fill="${d.accent}"/>` +
      `<rect x="${t}" y="${t}" width="${S}" height="${S}" rx="${n(t * 1.5)}" fill="${d.bg}"/>` +
      `<g transform="translate(${t} ${t})">${code}</g>` +
      `<rect x="${n((width - pillW) / 2)}" y="${S + 2 * t + gap}" width="${n(pillW)}" height="${pill}" rx="${n(pill / 2)}" fill="${d.accent}"/>` +
      `<text x="${n(width / 2)}" y="${n(S + 2 * t + gap + pill / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-weight="bold" font-size="${n(textSize(pillW, pill))}" fill="${frameInk}">${frameText}</text>`;
  }

  // ---- Optional URL text under everything ----
  if (opts.label) {
    const fontSize = Math.min(width * 0.065, (width * 0.9) / (opts.label.length * 0.66));
    const band = fontSize * 2.2;
    body =
      `<rect width="${width}" height="${n(height + band)}" fill="#ffffff"/>${body}` +
      `<text x="${n(width / 2)}" y="${n(height + band * 0.45)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-weight="bold" font-size="${n(fontSize)}" fill="${d.fg}">${escapeXml(opts.label)}</text>`;
    height += band;
  }

  return { body, width, height, codeSize: S };
}

function wrap(b: Built, scale: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${n(b.width * scale)}" height="${n(b.height * scale)}" viewBox="0 0 ${n(b.width)} ${n(b.height)}">` +
    b.body +
    `</svg>`
  );
}

/** Vector QR code (error correction H, 4-module quiet zone). Scales to any print size. */
export function qrSvg(text: string, design: QrDesign = DEFAULT_DESIGN, opts: RenderOptions = {}): string {
  return wrap(build(text, design, opts), 10);
}

/**
 * High-resolution PNG. The code itself is at least `minSize` px (2400 by default)
 * and every module is a whole number of pixels, so edges stay razor sharp.
 */
export function qrPng(text: string, design: QrDesign = DEFAULT_DESIGN, opts: RenderOptions = {}, minSize = PNG_MIN_SIZE): Buffer {
  const built = build(text, design, opts);
  const svg = wrap(built, Math.ceil(minSize / built.codeSize));
  return new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: FONT_FILES, loadSystemFonts: FONT_FILES.length === 0, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng();
}

/**
 * Checks an uploaded logo and re-encodes it as a clean 512 x 512 PNG
 * (transparent padding keeps the aspect ratio). Only PNG and JPEG are accepted;
 * re-encoding strips metadata and anything that isn't image data.
 */
export function normalizeLogo(data: Uint8Array): { ok: true; png: Buffer } | { ok: false; error: string } {
  if (data.byteLength === 0) return { ok: false, error: 'Please choose an image file.' };
  if (data.byteLength > LOGO_MAX_BYTES) return { ok: false, error: 'The logo file is too big (max 2 MB).' };
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!isPng && !isJpeg) return { ok: false, error: 'Please upload a PNG or JPEG image.' };

  const href = `data:image/${isPng ? 'png' : 'jpeg'};base64,${Buffer.from(data).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512">` +
    `<image width="512" height="512" preserveAspectRatio="xMidYMid meet" xlink:href="${href}"/></svg>`;
  try {
    const rendered = new Resvg(svg, { fitTo: { mode: 'original' } }).render();
    const pixels = rendered.pixels;
    let visible = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        visible = true;
        break;
      }
    }
    if (!visible) return { ok: false, error: 'That image could not be read. Try saving it again as PNG.' };
    return { ok: true, png: rendered.asPng() };
  } catch {
    return { ok: false, error: 'That image could not be read. Try saving it again as PNG.' };
  }
}

/** Standalone SVG of a built-in logo icon, for the option tiles in the dashboard. */
export function presetIconSvg(name: string, accent: string): string | null {
  const icon = PRESET_ICONS[name];
  if (!icon) return null;
  return `<svg viewBox="0 0 100 100" width="44" height="44" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="${accent}"/>${icon(accent)}</svg>`;
}
