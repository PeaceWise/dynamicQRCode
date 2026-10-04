import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';

describe('scan logging', () => {
  it('logs slug, time, country and device, and increments the counter', async () => {
    const { app, db, clock, scanLogger, createLink } = setup();
    const id = createLink('agenda', 'https://example.com/');
    await app.request('/agenda', { headers: { 'cf-ipcountry': 'US', 'user-agent': IPHONE } });
    scanLogger.flush();

    const scans = db.prepare('SELECT * FROM scans').all() as Record<string, unknown>[];
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ link_id: id, scanned_at: clock.now, country: 'US', device: 'mobile' });
    expect(db.prepare('SELECT scan_count FROM links WHERE id = ?').pluck().get(id)).toBe(1);
  });

  it('never stores IP addresses', async () => {
    const { app, db, scanLogger, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    await app.request('/agenda', {
      headers: { 'cf-connecting-ip': '203.0.113.77', 'x-forwarded-for': '203.0.113.77', 'user-agent': IPHONE },
    });
    scanLogger.flush();

    const columns = (db.prepare('PRAGMA table_info(scans)').all() as { name: string }[]).map((c) => c.name);
    expect(columns.some((c) => /ip/i.test(c))).toBe(false);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[];
    for (const table of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
      expect(dump).not.toContain('203.0.113.77');
    }
  });

  it('does not block the redirect: the write happens after the response', async () => {
    const { app, db, scanLogger, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    const res = await app.request('/agenda');
    expect(res.status).toBe(302);
    // Not yet written at the moment the response was produced...
    expect(db.prepare('SELECT COUNT(*) FROM scans').pluck().get()).toBe(0);
    // ...but written shortly after.
    await new Promise((r) => setImmediate(r));
    expect(db.prepare('SELECT COUNT(*) FROM scans').pluck().get()).toBe(1);
    scanLogger.flush();
  });

  it('batches many scans and counts them all', async () => {
    const { app, db, scanLogger, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    await Promise.all(Array.from({ length: 25 }, () => app.request('/agenda')));
    scanLogger.flush();
    expect(db.prepare('SELECT COUNT(*) FROM scans').pluck().get()).toBe(25);
    expect(db.prepare("SELECT scan_count FROM links WHERE slug = 'agenda'").pluck().get()).toBe(25);
  });

  it('ignores invalid country headers and missing user agents', async () => {
    const { app, db, scanLogger, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    await app.request('/agenda', { headers: { 'cf-ipcountry': '<script>' } });
    scanLogger.flush();
    expect(db.prepare('SELECT country, device FROM scans').get()).toEqual({ country: null, device: 'unknown' });
  });

  it('does not log HEAD requests or unknown slugs', async () => {
    const { app, db, scanLogger, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    await app.request('/agenda', { method: 'HEAD' });
    await app.request('/nope');
    scanLogger.flush();
    expect(db.prepare('SELECT COUNT(*) FROM scans').pluck().get()).toBe(0);
  });

  it('survives a link being deleted before its scan is written', async () => {
    const { app, db, scanLogger, createLink } = setup();
    const id = createLink('agenda', 'https://example.com/');
    await app.request('/agenda');
    db.prepare('DELETE FROM links WHERE id = ?').run(id);
    expect(() => scanLogger.flush()).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) FROM scans').pluck().get()).toBe(0);
  });

  it('shows totals and last-30-day counts on the dashboard', async () => {
    const { app, clock, scanLogger, createLink, adminSession } = setup();
    createLink('agenda', 'https://example.com/');
    await app.request('/agenda');
    scanLogger.flush();
    clock.now += 40 * 24 * 60 * 60 * 1000; // 40 days later
    await app.request('/agenda');
    await app.request('/agenda');
    scanLogger.flush();

    const { cookie } = await adminSession();
    const page = await (await app.request('/admin', { headers: { cookie } })).text();
    expect(page).toMatch(/<b>3<\/b> total scans/);
    expect(page).toMatch(/<b>2<\/b> in last 30 days/);
  });
});
