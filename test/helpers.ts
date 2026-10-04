import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { LoginLimiter } from '../src/rateLimit.js';

export const PASSWORD = 'correct horse battery';

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://hoa.example.com',
    adminPassword: PASSWORD,
    sessionSecret: 'test-secret-0123456789abcdef0123456789abcdef',
    defaultRedirectUrl: null,
    port: 3000,
    tz: 'America/New_York',
    databasePath: ':memory:',
    ...overrides,
  };
}

export function setup(overrides: Partial<Config> = {}) {
  const clock = { now: Date.UTC(2026, 9, 4, 16, 0, 0) };
  const db = openDatabase(':memory:');
  const config = makeConfig(overrides);
  const limiter = new LoginLimiter();
  const { app, scanLogger } = createApp({ db, config, now: () => clock.now, limiter });

  const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

  async function login(password = PASSWORD, ip = '198.51.100.1') {
    return app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
      body: form({ password }),
    });
  }

  /** Logs in and returns the session cookie and a CSRF token for that session. */
  async function adminSession() {
    const res = await login();
    const setCookie = res.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0];
    const page = await (await app.request('/admin', { headers: { cookie } })).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
    return { cookie, csrf };
  }

  async function post(path: string, data: Record<string, string>, cookie: string, headers: Record<string, string> = {}) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...headers },
      body: form(data),
    });
  }

  function createLink(slug: string, destination: string, note = '') {
    const t = clock.now;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO links (slug, destination, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(slug, destination, note, t, t);
    return Number(lastInsertRowid);
  }

  return { app, db, config, clock, limiter, scanLogger, login, adminSession, post, createLink };
}
