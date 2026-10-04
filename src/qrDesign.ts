// QR code design options (frame, module shapes, colors, logo) and their validation.

export const DOT_STYLES = ['square', 'rounded', 'dots'] as const;
export const EYE_FRAME_STYLES = ['square', 'rounded', 'circle'] as const;
export const EYE_BALL_STYLES = ['square', 'rounded', 'circle'] as const;
export const FRAME_STYLES = ['none', 'box', 'pill', 'top'] as const;
export const LOGO_CHOICES = ['none', 'wayward', 'agenda', 'calendar', 'home', 'link', 'custom'] as const;
export const LOGO_SIZES = ['small', 'medium', 'large'] as const;

export interface QrDesign {
  dots: (typeof DOT_STYLES)[number];
  eyeFrame: (typeof EYE_FRAME_STYLES)[number];
  eyeBall: (typeof EYE_BALL_STYLES)[number];
  fg: string; // module color
  bg: string; // background color
  eye: string; // corner ("eye") color
  frame: (typeof FRAME_STYLES)[number];
  frameText: string;
  accent: string; // frame and built-in icon color
  logo: (typeof LOGO_CHOICES)[number];
  logoSize: (typeof LOGO_SIZES)[number];
  logoClear: boolean; // remove the modules behind the logo
}

export const DEFAULT_DESIGN: QrDesign = {
  dots: 'square',
  eyeFrame: 'square',
  eyeBall: 'square',
  fg: '#000000',
  bg: '#ffffff',
  eye: '#000000',
  frame: 'none',
  frameText: 'SCAN ME',
  accent: '#0877ad',
  logo: 'none',
  logoSize: 'medium',
  logoClear: true,
};

/** Minimum contrast between the code and its background. Phones struggle below this. */
export const MIN_CONTRAST = 3;

function pick<T extends readonly string[]>(options: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/**
 * Builds a design from untrusted input (form fields, query string or stored JSON).
 * Unknown or invalid values fall back to the base design, so this never throws.
 */
export function parseDesign(input: Record<string, unknown>, base: QrDesign = DEFAULT_DESIGN): QrDesign {
  const text = typeof input.frameText === 'string' ? input.frameText.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : base.frameText;
  const clear = input.logoClear;
  return {
    dots: pick(DOT_STYLES, input.dots, base.dots),
    eyeFrame: pick(EYE_FRAME_STYLES, input.eyeFrame, base.eyeFrame),
    eyeBall: pick(EYE_BALL_STYLES, input.eyeBall, base.eyeBall),
    fg: color(input.fg, base.fg),
    bg: color(input.bg, base.bg),
    eye: color(input.eye, base.eye),
    frame: pick(FRAME_STYLES, input.frame, base.frame),
    frameText: text,
    accent: color(input.accent, base.accent),
    logo: pick(LOGO_CHOICES, input.logo, base.logo),
    logoSize: pick(LOGO_SIZES, input.logoSize, base.logoSize),
    logoClear: typeof clear === 'boolean' ? clear : clear === undefined ? base.logoClear : clear === '1' || clear === 'on' || clear === 'true',
  };
}

/** Reads a design saved in the database; anything unreadable becomes the default. */
export function loadDesign(json: string | null | undefined): QrDesign {
  if (!json) return { ...DEFAULT_DESIGN };
  try {
    return parseDesign(JSON.parse(json));
  } catch {
    return { ...DEFAULT_DESIGN };
  }
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Returns a problem that would make the code hard to scan, or null if it's fine. */
export function scanProblem(d: QrDesign): string | null {
  for (const [name, c] of [['code color', d.fg], ['corner color', d.eye]] as const) {
    if (luminance(c) >= luminance(d.bg)) {
      return `The ${name} must be darker than the background. Light-on-dark QR codes don't scan on many phones.`;
    }
    if (contrastRatio(c, d.bg) < MIN_CONTRAST) {
      return `The ${name} is too close to the background color for phones to scan reliably. Pick a darker color.`;
    }
  }
  return null;
}
