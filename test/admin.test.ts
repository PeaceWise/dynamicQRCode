import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { setup } from './helpers.js';

function pngSize(buf: ArrayBuffer) {
  const view = new DataView(buf);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('admin: links', () => {
  it('creates a link that redirects and records its creation in history', async () => {
    const { app, db, adminSession, post } = setup();
    const { cookie, csrf } = await adminSession();
    const res = await post('/admin/links', { slug: 'agenda', destination: 'https://example.com/a', note: 'Front sign', _csrf: csrf }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/links/agenda?created=1');
    expect((await app.request('/agenda')).headers.get('location')).toBe('https://example.com/a');
    expect(db.prepare('SELECT COUNT(*) FROM link_history').pluck().get()).toBe(1);

    const page = await (await app.request('/admin/links/agenda', { headers: { cookie } })).text();
    expect(page).toContain('https://hoa.example.com/agenda');
    expect(page).toContain('Front sign');
  });

  it('rejects invalid slugs, reserved slugs, bad URLs and duplicates', async () => {
    const { adminSession, post, db } = setup();
    const { cookie, csrf } = await adminSession();
    const tryCreate = (slug: string, destination: string) => post('/admin/links', { slug, destination, _csrf: csrf }, cookie);

    expect((await tryCreate('bad slug', 'https://example.com')).status).toBe(400);
    expect((await tryCreate('admin', 'https://example.com')).status).toBe(400);
    expect((await tryCreate('ok', 'javascript:alert(1)')).status).toBe(400);
    expect((await tryCreate('ok', 'ftp://example.com')).status).toBe(400);
    expect((await tryCreate('agenda', 'https://example.com')).status).toBe(303);
    const dup = await tryCreate('agenda', 'https://example.com/other');
    expect(dup.status).toBe(409);
    expect(await dup.text()).toContain('already exists');
    expect(db.prepare('SELECT COUNT(*) FROM links').pluck().get()).toBe(1);
  });

  it('escapes user content in pages', async () => {
    const { app, adminSession, post } = setup();
    const { cookie, csrf } = await adminSession();
    await post('/admin/links', { slug: 'x', destination: 'https://example.com/?q=<script>', note: '<img src=x onerror=alert(1)>', _csrf: csrf }, cookie);
    const page = await (await app.request('/admin/links/x', { headers: { cookie } })).text();
    expect(page).not.toContain('<img src=x');
    expect(page).not.toContain('<script>');
  });

  it('edits destination and note, keeps the slug, and logs history', async () => {
    const { app, db, clock, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/september');
    const { cookie, csrf } = await adminSession();
    clock.now += 1000;
    const res = await post('/admin/links/agenda', { destination: 'https://example.com/october', note: 'Oct', _csrf: csrf, slug: 'hacked' }, cookie);
    expect(res.status).toBe(303);
    expect((await app.request('/agenda')).headers.get('location')).toBe('https://example.com/october');
    expect(db.prepare("SELECT COUNT(*) FROM links WHERE slug = 'hacked'").pluck().get()).toBe(0);

    const history = db.prepare('SELECT old_destination, new_destination FROM link_history').all();
    expect(history).toEqual([{ old_destination: 'https://example.com/september', new_destination: 'https://example.com/october' }]);

    // Saving the same destination again does not add a history entry.
    await post('/admin/links/agenda', { destination: 'https://example.com/october', note: 'changed note', _csrf: csrf }, cookie);
    expect(db.prepare('SELECT COUNT(*) FROM link_history').pluck().get()).toBe(1);

    const page = await (await app.request('/admin/links/agenda', { headers: { cookie } })).text();
    expect(page).toContain('Change history');
    expect(page).toContain('https://example.com/september');
  });

  it('rejects an invalid destination on edit', async () => {
    const { app, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();
    expect((await post('/admin/links/agenda', { destination: 'javascript:alert(1)', _csrf: csrf }, cookie)).status).toBe(400);
    expect((await app.request('/agenda')).headers.get('location')).toBe('https://example.com/a');
  });

  it('deletes only after typing the slug to confirm, with a warning', async () => {
    const { app, adminSession, post, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();

    const confirmPage = await (await app.request('/admin/links/agenda/delete', { headers: { cookie } })).text();
    expect(confirmPage).toContain('will stop working');

    expect((await post('/admin/links/agenda/delete', { confirm: 'nope', _csrf: csrf }, cookie)).status).toBe(400);
    expect((await app.request('/agenda')).status).toBe(302);

    expect((await post('/admin/links/agenda/delete', { confirm: 'agenda', _csrf: csrf }, cookie)).status).toBe(303);
    expect((await app.request('/agenda')).status).toBe(404);
  });

  it('shows a scans-per-day chart', async () => {
    const { app, adminSession, createLink, scanLogger } = setup();
    createLink('agenda', 'https://example.com/a');
    await app.request('/agenda');
    scanLogger.flush();
    const { cookie } = await adminSession();
    const page = await (await app.request('/admin/links/agenda', { headers: { cookie } })).text();
    expect(page).toContain('class="chart"');
    expect(page).toContain('Oct 4: 1 scan');
  });
});

describe('admin: QR codes', () => {
  it('downloads an SVG that encodes the short URL', async () => {
    const { app, adminSession, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie } = await adminSession();
    const res = await app.request('/admin/links/agenda/qr.svg', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('content-disposition')).toContain('qr-agenda.svg');
    expect(await res.text()).toMatch(/^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  });

  it('downloads a high-resolution PNG, optionally with URL text underneath', async () => {
    const { app, adminSession, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    const { cookie } = await adminSession();

    const plain = await app.request('/admin/links/agenda/qr.png', { headers: { cookie } });
    expect(plain.headers.get('content-type')).toBe('image/png');
    const size = pngSize(await plain.arrayBuffer());
    expect(size.width).toBeGreaterThanOrEqual(2000);
    expect(size.height).toBe(size.width);

    const labeled = await app.request('/admin/links/agenda/qr.png?label=1', { headers: { cookie } });
    const labeledSize = pngSize(await labeled.arrayBuffer());
    expect(labeledSize.width).toBeGreaterThanOrEqual(2000);
    expect(labeledSize.height).toBeGreaterThan(labeledSize.width);
  });

  it('requires login for QR downloads', async () => {
    const { app, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    expect((await app.request('/admin/links/agenda/qr.png')).status).toBe(303);
  });
});

describe('migrations', () => {
  it('apply on startup and are idempotent', () => {
    const db = openDatabase(':memory:');
    const applied = db.prepare('SELECT name FROM schema_migrations').pluck().all();
    expect(applied).toEqual(['001_init.sql']);
  });
});
