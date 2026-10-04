import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('redirects', () => {
  it('redirects a known slug with 302 and Cache-Control: no-store', async () => {
    const { app, createLink } = setup();
    createLink('agenda', 'https://docs.example.com/agenda-october');
    const res = await app.request('/agenda');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://docs.example.com/agenda-october');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never uses a permanent (301) redirect', async () => {
    const { app, createLink } = setup();
    createLink('agenda', 'https://example.com/');
    const res = await app.request('/agenda');
    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(308);
  });

  it('is forgiving about upper case and a trailing slash', async () => {
    const { app, createLink } = setup();
    createLink('agenda', 'https://example.com/a');
    expect((await app.request('/AGENDA')).headers.get('location')).toBe('https://example.com/a');
    expect((await app.request('/agenda/')).headers.get('location')).toBe('https://example.com/a');
  });

  it('follows destination changes immediately', async () => {
    const { app, db, createLink } = setup();
    const id = createLink('agenda', 'https://example.com/old');
    db.prepare('UPDATE links SET destination = ? WHERE id = ?').run('https://example.com/new', id);
    expect((await app.request('/agenda')).headers.get('location')).toBe('https://example.com/new');
  });
});

describe('404s', () => {
  it('shows a friendly 404 page for unknown slugs', async () => {
    const { app } = setup();
    const res = await app.request('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Link not found');
  });

  it('returns 404 for slugs with invalid characters and deeper paths', async () => {
    const { app } = setup();
    expect((await app.request('/bad_slug!')).status).toBe(404);
    expect((await app.request('/a/b/c')).status).toBe(404);
  });
});

describe('root and infrastructure', () => {
  it('shows a landing page at / when no default is configured', async () => {
    const { app } = setup();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('short links');
  });

  it('redirects / to DEFAULT_REDIRECT_URL when configured', async () => {
    const { app } = setup({ defaultRedirectUrl: 'https://myhoa.example.org/' });
    const res = await app.request('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://myhoa.example.org/');
  });

  it('serves robots.txt that disallows /admin', async () => {
    const { app } = setup();
    const res = await app.request('/robots.txt');
    expect(await res.text()).toContain('Disallow: /admin');
  });

  it('has a /health endpoint', async () => {
    const { app } = setup();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves static assets', async () => {
    const { app } = setup();
    const res = await app.request('/static/admin.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect((await app.request('/static/../package.json')).status).toBe(404);
  });
});
