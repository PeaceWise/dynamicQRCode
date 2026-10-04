import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { normalizeLogo, qrPng, qrSvg } from '../src/qr.js';
import { DEFAULT_DESIGN, parseDesign, scanProblem, type QrDesign } from '../src/qrDesign.js';
import { setup } from './helpers.js';

const URL_TEXT = 'https://hoa.example.com/agenda';

function decode(png: Buffer): string | null {
  const img = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
}

function svgToPng(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
}

const toDataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
// Worst case for scanning: a solid, fully opaque logo.
const solidLogo = toDataUri(
  svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1cbbfc"/></svg>'),
);

describe('QR design rendering stays scannable', () => {
  const variants: [string, Partial<QrDesign>][] = [
    ['default', {}],
    ['rounded pattern', { dots: 'rounded' }],
    ['dot pattern', { dots: 'dots' }],
    ['rounded corners', { eyeFrame: 'rounded', eyeBall: 'rounded' }],
    ['circle corners', { eyeFrame: 'circle', eyeBall: 'circle' }],
    ['bottom frame', { frame: 'box', frameText: 'SCAN FOR AGENDA' }],
    ['top frame', { frame: 'top' }],
    ['badge frame', { frame: 'pill' }],
    ['brand colors', { fg: '#0877ad', eye: '#23282b', bg: '#ffffff', accent: '#1cbbfc' }],
    ...(['wayward', 'agenda', 'calendar', 'home', 'link'] as const).flatMap((logo): [string, Partial<QrDesign>][] => [
      [`${logo} logo, large`, { logo, logoSize: 'large' }],
      [`${logo} logo, large, pattern kept`, { logo, logoSize: 'large', logoClear: false }],
    ]),
    ['custom solid logo, large, pattern kept', { logo: 'custom', logoSize: 'large', logoClear: false }],
    [
      'everything at once',
      {
        dots: 'dots',
        eyeFrame: 'circle',
        eyeBall: 'circle',
        frame: 'pill',
        fg: '#0877ad',
        eye: '#23282b',
        logo: 'custom',
        logoSize: 'large',
        logoClear: false,
      },
    ],
    ['everything at once, rounded', { dots: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', frame: 'box', logo: 'wayward', logoSize: 'large' }],
  ];

  it.each(variants)('%s', (_name, overrides) => {
    const design = { ...DEFAULT_DESIGN, ...overrides };
    const png = qrPng(URL_TEXT, design, { customLogo: solidLogo, label: 'hoa.example.com/agenda' }, 600);
    expect(decode(png)).toBe(URL_TEXT);
  });

  it('keeps longer URLs scannable with the largest logo', () => {
    const long = 'https://my-homeowners-association.example.com/annual-meeting-2026';
    const png = qrPng(long, { ...DEFAULT_DESIGN, dots: 'rounded', logo: 'custom', logoSize: 'large', logoClear: false }, { customLogo: solidLogo }, 600);
    expect(decode(png)).toBe(long);
  });

  it('renders full-size PNGs at 2400 px or more', () => {
    const png = qrPng(URL_TEXT, { ...DEFAULT_DESIGN, frame: 'box' });
    const { width, height } = PNG.sync.read(png);
    expect(width).toBeGreaterThanOrEqual(2400);
    expect(height).toBeGreaterThan(width); // frame bar adds height
  });

  it('produces SVGs with the chosen colors and frame text, escaped', () => {
    const svg = qrSvg(URL_TEXT, { ...DEFAULT_DESIGN, fg: '#112233', frame: 'box', frameText: 'A <b> & "c"' });
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('A &#60;b&#62; &#38; &#34;c&#34;');
    expect(svg).not.toContain('<b>');
  });

  it('leaves out the logo for option thumbnails', () => {
    const svg = qrSvg(URL_TEXT, { ...DEFAULT_DESIGN, logo: 'wayward' }, { noLogo: true });
    expect(svg).not.toContain('<image');
  });
});

describe('design options', () => {
  it('falls back to defaults for unknown or invalid values', () => {
    const d = parseDesign({ dots: 'hexagons', fg: 'red', frame: '<script>', logoSize: 'huge', frameText: 'x'.repeat(50) });
    expect(d.dots).toBe('square');
    expect(d.fg).toBe('#000000');
    expect(d.frame).toBe('none');
    expect(d.logoSize).toBe('medium');
    expect(d.frameText).toHaveLength(24);
  });

  it('refuses color combinations that do not scan', () => {
    expect(scanProblem(DEFAULT_DESIGN)).toBeNull();
    expect(scanProblem({ ...DEFAULT_DESIGN, fg: '#1cbbfc' })).toMatch(/too close/); // light blue on white
    expect(scanProblem({ ...DEFAULT_DESIGN, fg: '#ffffff', bg: '#000000' })).toMatch(/darker than the background/);
    expect(scanProblem({ ...DEFAULT_DESIGN, eye: '#dddddd' })).toMatch(/corner color/);
    expect(scanProblem({ ...DEFAULT_DESIGN, fg: '#0877ad' })).toBeNull(); // dark brand blue is fine
  });
});

describe('logo upload processing', () => {
  it('accepts PNG and re-encodes it as a 512 px PNG', () => {
    const result = normalizeLogo(readFileSync('public/logo.png'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(PNG.sync.read(result.png).width).toBe(512);
  });

  it('rejects other file types, empty files, corrupt images and oversized files', () => {
    expect(normalizeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok).toBe(false);
    expect(normalizeLogo(Buffer.from('GIF89a......')).ok).toBe(false);
    expect(normalizeLogo(new Uint8Array()).ok).toBe(false);
    expect(normalizeLogo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])).ok).toBe(false);
    const big = Buffer.alloc(3 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    expect(normalizeLogo(big).ok).toBe(false);
  });
});

describe('admin: QR design', () => {
  it('saves a design and uses it for downloads', async () => {
    const { app, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();
    const res = await post(
      '/admin/links/agenda/design',
      { _csrf: csrf, dots: 'rounded', frame: 'box', frameText: 'AGENDA', fg: '#0877ad', bg: '#ffffff', eye: '#000000', accent: '#1cbbfc', logo: 'agenda', logoSize: 'medium', logoClear: '1' },
      cookie,
    );
    expect(res.status).toBe(303);
    const svg = await (await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } })).text();
    expect(svg).toContain('AGENDA');
    expect(svg).toContain('fill="#0877ad"');

    const png = Buffer.from(await (await app.request('/admin/links/agenda/qr.png', { headers: { cookie } })).arrayBuffer());
    expect(decode(png)).toBe('https://hoa.example.com/agenda');
  });

  it('refuses to save colors that would not scan', async () => {
    const { app, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();
    const res = await post('/admin/links/agenda/design', { _csrf: csrf, fg: '#eeeeee', bg: '#ffffff' }, cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('too close');
    const svg = await (await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } })).text();
    expect(svg).toContain('fill="#000000"');
  });

  it('requires a CSRF token to save a design', async () => {
    const { adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie } = await adminSession();
    expect((await post('/admin/links/agenda/design', { frame: 'box' }, cookie)).status).toBe(403);
  });

  it('previews unsaved changes without saving them', async () => {
    const { app, adminSession, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie } = await adminSession();
    const preview = await app.request('/admin/links/agenda/qr.svg?preview=1&frame=box&frameText=PREVIEW', { headers: { cookie } });
    expect(preview.headers.get('content-disposition')).toBeNull();
    expect(await preview.text()).toContain('PREVIEW');
    const saved = await (await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } })).text();
    expect(saved).not.toContain('PREVIEW');
  });

  it('uploads a custom logo, selects it, and can remove it again', async () => {
    const { app, db, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();

    // Choosing "custom" before uploading anything is refused.
    expect((await post('/admin/links/agenda/design', { _csrf: csrf, logo: 'custom' }, cookie)).status).toBe(400);

    const form = new FormData();
    form.set('_csrf', csrf);
    form.set('logo', new File([readFileSync('public/logo.png')], 'logo.png', { type: 'image/png' }));
    const upload = await app.request('/admin/links/agenda/logo', { method: 'POST', headers: { cookie }, body: form });
    expect(upload.status).toBe(303);
    expect(db.prepare('SELECT COUNT(*) FROM link_logos').pluck().get()).toBe(1);

    const logo = await app.request('/admin/links/agenda/logo.png', { headers: { cookie } });
    expect(logo.headers.get('content-type')).toBe('image/png');
    const svg = await (await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } })).text();
    expect(svg).toContain('data:image/png;base64,');

    expect((await post('/admin/links/agenda/logo/delete', { _csrf: csrf }, cookie)).status).toBe(303);
    expect(db.prepare('SELECT COUNT(*) FROM link_logos').pluck().get()).toBe(0);
    const after = await (await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } })).text();
    expect(after).not.toContain('<image');
  });

  it('rejects non-image uploads', async () => {
    const { app, db, adminSession, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();
    const form = new FormData();
    form.set('_csrf', csrf);
    form.set('logo', new File(['<svg onload="alert(1)"/>'], 'evil.svg', { type: 'image/svg+xml' }));
    const res = await app.request('/admin/links/agenda/logo', { method: 'POST', headers: { cookie }, body: form });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('PNG or JPEG');
    expect(db.prepare('SELECT COUNT(*) FROM link_logos').pluck().get()).toBe(0);
  });

  it('shows the design editor on the link page', async () => {
    const { app, adminSession, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie } = await adminSession();
    const page = await (await app.request('/admin/links/agenda', { headers: { cookie } })).text();
    for (const text of ['Design your QR code', 'Frame', 'Shape', 'Logo', 'Colors', 'Save design']) {
      expect(page).toContain(text);
    }
  });
});
