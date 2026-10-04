import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('scan statistics reset', () => {
  it('deletes the scans of one link, zeroes its counter and records when', async () => {
    const { app, db, clock, scanLogger, adminSession, post, createLink } = setup();
    const agenda = createLink('agenda', 'https://example.com/a');
    const pool = createLink('pool', 'https://example.com/p');
    for (let i = 0; i < 3; i++) await app.request('/agenda');
    await app.request('/pool');
    scanLogger.flush();

    const { cookie, csrf } = await adminSession();
    const res = await post('/admin/links/agenda/reset-stats', { _csrf: csrf, confirm: 'yes' }, cookie);
    expect(res.status).toBe(303);

    expect(db.prepare('SELECT scan_count, stats_reset_at FROM links WHERE id = ?').get(agenda)).toEqual({
      scan_count: 0,
      stats_reset_at: clock.now,
    });
    expect(db.prepare('SELECT COUNT(*) FROM scans WHERE link_id = ?').pluck().get(agenda)).toBe(0);
    // Other links are untouched.
    expect(db.prepare('SELECT scan_count FROM links WHERE id = ?').pluck().get(pool)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM scans WHERE link_id = ?').pluck().get(pool)).toBe(1);

    const page = await (await app.request('/admin/links/agenda', { headers: { cookie } })).text();
    expect(page).toContain('Counting since');

    // Counting continues normally afterwards.
    await app.request('/agenda');
    scanLogger.flush();
    expect(db.prepare('SELECT scan_count FROM links WHERE id = ?').pluck().get(agenda)).toBe(1);
  });

  it('includes scans still waiting to be written', async () => {
    const { app, db, adminSession, post, createLink } = setup();
    const id = createLink('agenda', 'https://example.com/a');
    const { cookie, csrf } = await adminSession();
    await app.request('/agenda'); // queued, not yet flushed
    await post('/admin/links/agenda/reset-stats', { _csrf: csrf, confirm: 'yes' }, cookie);
    await new Promise((r) => setImmediate(r));
    expect(db.prepare('SELECT scan_count FROM links WHERE id = ?').pluck().get(id)).toBe(0);
  });

  it('requires the confirmation box and a CSRF token', async () => {
    const { app, db, scanLogger, adminSession, post, createLink } = setup();
    const id = createLink('agenda', 'https://example.com/a');
    await app.request('/agenda');
    scanLogger.flush();
    const { cookie, csrf } = await adminSession();
    expect((await post('/admin/links/agenda/reset-stats', { _csrf: csrf }, cookie)).status).toBe(400);
    expect((await post('/admin/links/agenda/reset-stats', { confirm: 'yes' }, cookie)).status).toBe(403);
    expect(db.prepare('SELECT scan_count FROM links WHERE id = ?').pluck().get(id)).toBe(1);
  });
});

describe("don't count this device", () => {
  async function ignoreCookie() {
    const ctx = setup();
    const { cookie, csrf } = await ctx.adminSession();
    const res = await ctx.post('/admin/device', { _csrf: csrf, ignore: '1', back: '/admin/links/agenda' }, cookie);
    return { ...ctx, res, adminCookie: cookie, csrf };
  }

  it('sets a long-lived SameSite=Lax cookie so it is sent when a QR scan opens the link', async () => {
    const { res } = await ignoreCookie();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/links/agenda#scans');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^qr_ignore=/);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=34560000');
  });

  it('skips logging for that device but still redirects', async () => {
    const { app, db, scanLogger, createLink, res } = await ignoreCookie();
    createLink('agenda', 'https://example.com/a');
    const ignore = (res.headers.get('set-cookie') ?? '').split(';')[0];

    const scan = await app.request('/agenda', { headers: { cookie: ignore } });
    expect(scan.status).toBe(302);
    await app.request('/agenda', { headers: { cookie: 'qr_ignore=forged' } }); // forged cookie: still counted
    await app.request('/agenda'); // other visitors: counted
    scanLogger.flush();
    expect(db.prepare('SELECT scan_count FROM links').pluck().get()).toBe(2);
  });

  it('can be turned off again', async () => {
    const { post, adminCookie, csrf } = await ignoreCookie();
    const res = await post('/admin/device', { _csrf: csrf, ignore: '0' }, adminCookie);
    expect(res.headers.get('set-cookie')).toMatch(/qr_ignore=;.*Max-Age=0/);
    expect(res.headers.get('location')).toBe('/admin#scans');
  });

  it('only redirects back to admin pages', async () => {
    const { post, adminCookie, csrf } = await ignoreCookie();
    const res = await post('/admin/device', { _csrf: csrf, ignore: '1', back: 'https://evil.example.net' }, adminCookie);
    expect(res.headers.get('location')).toBe('/admin#scans');
  });
});
