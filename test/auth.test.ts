import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('authentication', () => {
  it('redirects to /login when not signed in', async () => {
    const { app } = setup();
    const res = await app.request('/admin');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('rejects a wrong password', async () => {
    const { login } = setup();
    const res = await login('wrong password');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('not correct');
  });

  it('sets an HttpOnly, Secure, SameSite=Strict, 30-day cookie on success', async () => {
    const { login } = setup();
    const res = await login();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^qr_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('keeps cookies Secure behind Cloudflare even though the app sees plain HTTP', async () => {
    const { app } = setup();
    const res = await app.request('http://hoa.example.com/login', {
      method: 'POST',
      headers: {
        host: 'hoa.example.com',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'password=correct+horse+battery',
    });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('lets a valid session into the dashboard', async () => {
    const { app, adminSession } = setup();
    const { cookie, csrf } = await adminSession();
    const res = await app.request('/admin', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Your links');
    expect(csrf).not.toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects tampered cookies', async () => {
    const { app, adminSession } = setup();
    const { cookie } = await adminSession();
    const [name, value] = cookie.split('=');
    const [body, sig] = value.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sid: 'x', exp: 9e15, pv: 'x' })).toString('base64url');
    for (const bad of [`${forgedBody}.${sig}`, `${body}.${sig}x`, 'garbage', `${body}`]) {
      const res = await app.request('/admin', { headers: { cookie: `${name}=${bad}` } });
      expect(res.status).toBe(303);
    }
  });

  it('expires sessions after 30 days', async () => {
    const { app, clock, adminSession } = setup();
    const { cookie } = await adminSession();
    clock.now += 29 * 24 * 60 * 60 * 1000;
    expect((await app.request('/admin', { headers: { cookie } })).status).toBe(200);
    clock.now += 2 * 24 * 60 * 60 * 1000;
    expect((await app.request('/admin', { headers: { cookie } })).status).toBe(303);
  });

  it('logs out', async () => {
    const { app, adminSession, post } = setup();
    const { cookie, csrf } = await adminSession();
    const res = await post('/logout', { _csrf: csrf }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toMatch(/qr_session=;.*Max-Age=0/);
  });
});

describe('CSRF protection', () => {
  it('rejects admin POSTs without a valid CSRF token', async () => {
    const { adminSession, post, db } = setup();
    const { cookie } = await adminSession();
    const data = { slug: 'agenda', destination: 'https://example.com/' };
    expect((await post('/admin/links', data, cookie)).status).toBe(403);
    expect((await post('/admin/links', { ...data, _csrf: 'forged' }, cookie)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) FROM links').pluck().get()).toBe(0);
  });

  it('accepts admin POSTs with the right token', async () => {
    const { adminSession, post } = setup();
    const { cookie, csrf } = await adminSession();
    const res = await post('/admin/links', { slug: 'agenda', destination: 'https://example.com/', _csrf: csrf }, cookie);
    expect(res.status).toBe(303);
  });

  it('rejects a token from a different session', async () => {
    const { adminSession, post } = setup();
    const first = await adminSession();
    const second = await adminSession();
    const res = await post('/admin/links', { slug: 'agenda', destination: 'https://example.com/', _csrf: first.csrf }, second.cookie);
    expect(res.status).toBe(403);
  });

  it('rejects cross-site form posts by Origin', async () => {
    const { adminSession, post } = setup();
    const { cookie, csrf } = await adminSession();
    const res = await post(
      '/admin/links',
      { slug: 'agenda', destination: 'https://example.com/', _csrf: csrf },
      cookie,
      { origin: 'https://evil.example.net', host: 'hoa.example.com' },
    );
    expect(res.status).toBe(403);
  });

  it('rejects admin POSTs without a session', async () => {
    const { post } = setup();
    expect((await post('/admin/links', { slug: 'x', destination: 'https://e.com' }, '')).status).toBe(401);
  });
});
