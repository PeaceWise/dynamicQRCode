import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  checkPassword,
  createSessionToken,
  csrfToken,
  verifyCsrf,
  verifySessionToken,
  type Session,
} from './auth.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { qrPng, qrSvg } from './qr.js';
import { LoginLimiter } from './rateLimit.js';
import { ScanLogger } from './scans.js';
import { deviceType, validateDestination, validateNote, validateSlug } from './validation.js';
import {
  dashboardPage,
  deleteConfirmPage,
  errorPage,
  landingPage,
  linkPage,
  loginPage,
  notFoundPage,
  type HistoryRow,
  type LinkListItem,
  type LinkRow,
  type LinkStats,
} from './views.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};
const STATIC_FILES = ['admin.css', 'admin.js', 'logo.png', 'favicon.png'];

type AppEnv = { Variables: { session: Session; csrf: string } };

export interface AppDeps {
  db: DB;
  config: Config;
  now?: () => number;
  limiter?: LoginLimiter;
}

/**
 * The client's IP, used ONLY as a key for login rate limiting and never stored.
 * Cloudflare sets CF-Connecting-IP; everything reaches us through cloudflared.
 */
function clientKey(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}

function isLocalHost(c: Context): boolean {
  const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Cloudflare terminates HTTPS and cloudflared forwards plain HTTP, so we trust the
 * forwarded protocol headers. Cookies are always Secure except for plain-HTTP
 * access on localhost (local testing), where browsers would otherwise drop them.
 */
function useSecureCookie(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const visitor = c.req.header('cf-visitor') ?? '';
  const https = proto === 'https' || visitor.includes('"https"') || new URL(c.req.url).protocol === 'https:';
  return https || !isLocalHost(c);
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function createApp({ db, config, now = Date.now, limiter = new LoginLimiter() }: AppDeps) {
  const app = new Hono<AppEnv>({ strict: false });
  const scanLogger = new ScanLogger(db);
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

  const staticFiles = new Map(
    STATIC_FILES.map((f) => [f, { body: readFileSync(join(PUBLIC_DIR, f)), type: STATIC_TYPES[extname(f)] }]),
  );

  const q = {
    linkBySlug: db.prepare<[string], LinkRow>('SELECT * FROM links WHERE slug = ?'),
    redirectBySlug: db.prepare<[string], { id: number; destination: string }>(
      'SELECT id, destination FROM links WHERE slug = ?',
    ),
    listLinks: db.prepare<[number], LinkListItem>(
      `SELECT l.*, (SELECT COUNT(*) FROM scans s WHERE s.link_id = l.id AND s.scanned_at >= ?) AS scans_30d
       FROM links l ORDER BY l.slug`,
    ),
    insertLink: db.prepare(
      'INSERT INTO links (slug, destination, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ),
    updateLink: db.prepare('UPDATE links SET destination = ?, note = ?, updated_at = ? WHERE id = ?'),
    deleteLink: db.prepare('DELETE FROM links WHERE id = ?'),
    insertHistory: db.prepare(
      'INSERT INTO link_history (link_id, old_destination, new_destination, changed_at) VALUES (?, ?, ?, ?)',
    ),
    history: db.prepare<[number], HistoryRow>(
      'SELECT old_destination, new_destination, changed_at FROM link_history WHERE link_id = ? ORDER BY changed_at DESC, id DESC',
    ),
    recentScans: db.prepare<[number, number], { scanned_at: number; country: string | null; device: string }>(
      'SELECT scanned_at, country, device FROM scans WHERE link_id = ? AND scanned_at >= ?',
    ),
  };

  function shortUrl(slug: string): string {
    return `${config.baseUrl}/${slug}`;
  }

  function linkStats(linkId: number): LinkStats {
    const t = now();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

    // The last 30 calendar days in the configured time zone, oldest first.
    const [y, m, d] = dayKey.format(t).split('-').map(Number);
    const daily: LinkStats['daily'] = [];
    const index = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.UTC(y, m - 1, d - i));
      const key = date.toISOString().slice(0, 10);
      index.set(key, daily.length);
      daily.push({ day: key, label: label.format(date), count: 0 });
    }

    const rows = q.recentScans.all(linkId, t - 30 * DAY_MS);
    const countries = new Map<string, number>();
    const devices = new Map<string, number>();
    for (const r of rows) {
      const i = index.get(dayKey.format(r.scanned_at));
      if (i !== undefined) daily[i].count++;
      const country = r.country ?? 'Unknown';
      countries.set(country, (countries.get(country) ?? 0) + 1);
      devices.set(r.device, (devices.get(r.device) ?? 0) + 1);
    }
    const sorted = (m: Map<string, number>, name: (k: string) => string) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, count]) => ({ name: name(k), count }));
    const countryName = (code: string) => {
      if (code === 'Unknown' || code === 'XX') return 'Unknown';
      if (code === 'T1') return 'Tor network';
      try {
        return regionNames.of(code) ?? code;
      } catch {
        return code;
      }
    };
    return {
      last30: rows.length,
      daily,
      countries: sorted(countries, countryName).slice(0, 10),
      devices: sorted(devices, (k) => k[0].toUpperCase() + k.slice(1)),
    };
  }

  function currentSession(c: Context): Session | null {
    return verifySessionToken(getCookie(c, SESSION_COOKIE), config.sessionSecret, config.adminPassword, now());
  }

  // --- Global middleware ---------------------------------------------------

  // Reject cross-site form posts. Browsers always send Origin on POST.
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin');
      if (origin !== undefined) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          /* "null" or malformed */
        }
        if (originHost !== c.req.header('host')) {
          return c.html(errorPage('Request blocked', 'This form was submitted from another website.').value, 403);
        }
      }
    }
    await next();
  });

  // Admin pages: never cache, never frame, only load our own scripts and styles.
  app.use('*', async (c, next) => {
    await next();
    const p = c.req.path;
    if (p === '/login' || p === '/logout' || p === '/admin' || p.startsWith('/admin/')) {
      c.header('Cache-Control', 'no-store');
      c.header('X-Frame-Options', 'DENY');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'same-origin');
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      );
    }
  });

  // --- Infrastructure routes -----------------------------------------------

  app.get('/health', (c) => {
    try {
      db.prepare('SELECT 1').get();
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'error' }, 503);
    }
  });

  app.get('/robots.txt', (c) =>
    c.text('User-agent: *\nDisallow: /admin\nDisallow: /login\n', 200, { 'Cache-Control': 'public, max-age=86400' }),
  );

  const serveStatic = (c: Context, name: string) => {
    const file = staticFiles.get(name);
    if (!file) return c.html(notFoundPage().value, 404);
    return c.body(file.body, 200, { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=3600' });
  };
  app.get('/favicon.ico', (c) => serveStatic(c, 'favicon.png'));
  app.get('/static/:file', (c) => serveStatic(c, c.req.param('file')));

  app.get('/', (c) => {
    if (config.defaultRedirectUrl) {
      c.header('Cache-Control', 'no-store');
      return c.redirect(config.defaultRedirectUrl, 302);
    }
    return c.html(landingPage().value);
  });

  // --- Login / logout ------------------------------------------------------

  app.get('/login', (c) => {
    if (currentSession(c)) return c.redirect('/admin', 303);
    return c.html(loginPage().value);
  });

  app.post('/login', async (c) => {
    const key = clientKey(c);
    const t = now();
    const lockedMs = limiter.lockedFor(key, t);
    if (lockedMs > 0) {
      const minutes = Math.ceil(lockedMs / 60_000);
      return c.html(loginPage(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`).value, 429);
    }

    const body = await c.req.parseBody();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!checkPassword(password, config.adminPassword)) {
      limiter.recordFailure(key, t);
      if (limiter.lockedFor(key, t) > 0) {
        return c.html(loginPage('Too many failed attempts. Try again in 15 minutes.').value, 429);
      }
      return c.html(loginPage('That password is not correct.').value, 401);
    }

    limiter.recordSuccess(key);
    setCookie(c, SESSION_COOKIE, createSessionToken(config.sessionSecret, config.adminPassword, t), {
      httpOnly: true,
      secure: useSecureCookie(c),
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return c.redirect('/admin', 303);
  });

  app.post('/logout', async (c) => {
    const session = currentSession(c);
    if (session) {
      const body = await c.req.parseBody();
      if (!verifyCsrf(config.sessionSecret, session.sid, body._csrf)) {
        return c.html(errorPage('Session expired', 'Please reload the page and try again.').value, 403);
      }
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: useSecureCookie(c), httpOnly: true, sameSite: 'Strict' });
    return c.redirect('/login', 303);
  });

  // --- Admin (requires login + CSRF token on every POST) -------------------

  const requireAdmin = async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const session = currentSession(c);
    if (!session) {
      if (c.req.method === 'GET') return c.redirect('/login', 303);
      return c.html(errorPage('Signed out', 'Your session has expired. Please sign in again.').value, 401);
    }
    const csrf = csrfToken(config.sessionSecret, session.sid);
    if (c.req.method === 'POST') {
      const body = await c.req.parseBody();
      if (!verifyCsrf(config.sessionSecret, session.sid, body._csrf)) {
        return c.html(errorPage('Session expired', 'Please reload the page and try again.').value, 403);
      }
    }
    c.set('session', session);
    c.set('csrf', csrf);
    await next();
  };
  app.use('/admin', requireAdmin);
  app.use('/admin/*', requireAdmin);

  const renderDashboard = (c: Context<AppEnv>, extra: { error?: string; form?: Record<string, string>; flash?: string } = {}) =>
    dashboardPage({
      csrf: c.get('csrf'),
      baseUrl: config.baseUrl,
      tz: config.tz,
      links: q.listLinks.all(now() - 30 * DAY_MS),
      ...extra,
    }).value;

  app.get('/admin', (c) => {
    const flash = c.req.query('deleted') ? `Deleted /${c.req.query('deleted')}.` : undefined;
    return c.html(renderDashboard(c, { flash }));
  });

  app.post('/admin/links', async (c) => {
    const body = await c.req.parseBody();
    const form = {
      slug: String(body.slug ?? '').trim().toLowerCase(),
      destination: String(body.destination ?? ''),
      note: String(body.note ?? ''),
    };
    const slug = validateSlug(form.slug);
    const destination = validateDestination(form.destination);
    const note = validateNote(form.note);
    const error = !slug.ok ? slug.error : !destination.ok ? destination.error : !note.ok ? note.error : null;
    if (error || !slug.ok || !destination.ok || !note.ok) {
      return c.html(renderDashboard(c, { error: error ?? 'Invalid input.', form }), 400);
    }
    if (q.linkBySlug.get(slug.value)) {
      return c.html(renderDashboard(c, { error: `/${slug.value} already exists. Pick another slug.`, form }), 409);
    }
    const t = now();
    db.transaction(() => {
      const { lastInsertRowid } = q.insertLink.run(slug.value, destination.value, note.value, t, t);
      q.insertHistory.run(lastInsertRowid, null, destination.value, t);
    })();
    return c.redirect(`/admin/links/${slug.value}?created=1`, 303);
  });

  const findLink = (c: Context<AppEnv>) => q.linkBySlug.get(c.req.param('slug') ?? '');

  const renderLink = (
    c: Context<AppEnv>,
    link: LinkRow,
    extra: { error?: string; flash?: string; form?: { destination?: string; note?: string } } = {},
  ) =>
    linkPage({
      csrf: c.get('csrf'),
      shortUrl: shortUrl(link.slug),
      tz: config.tz,
      link,
      stats: linkStats(link.id),
      history: q.history.all(link.id),
      ...extra,
    }).value;

  app.get('/admin/links/:slug', (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    const flash = c.req.query('created')
      ? 'Link created. Download the QR code below.'
      : c.req.query('saved')
        ? 'Saved. The QR code now sends people to the new destination.'
        : undefined;
    return c.html(renderLink(c, link, { flash }));
  });

  app.post('/admin/links/:slug', async (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    const body = await c.req.parseBody();
    const form = { destination: String(body.destination ?? ''), note: String(body.note ?? '') };
    const destination = validateDestination(form.destination);
    const note = validateNote(form.note);
    if (!destination.ok) return c.html(renderLink(c, link, { error: destination.error, form }), 400);
    if (!note.ok) return c.html(renderLink(c, link, { error: note.error, form }), 400);

    const t = now();
    db.transaction(() => {
      q.updateLink.run(destination.value, note.value, t, link.id);
      if (destination.value !== link.destination) {
        q.insertHistory.run(link.id, link.destination, destination.value, t);
      }
    })();
    return c.redirect(`/admin/links/${link.slug}?saved=1`, 303);
  });

  app.get('/admin/links/:slug/delete', (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    return c.html(deleteConfirmPage({ csrf: c.get('csrf'), link, shortUrl: shortUrl(link.slug) }).value);
  });

  app.post('/admin/links/:slug/delete', async (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    const body = await c.req.parseBody();
    if (String(body.confirm ?? '').trim().toLowerCase() !== link.slug) {
      return c.html(
        deleteConfirmPage({
          csrf: c.get('csrf'),
          link,
          shortUrl: shortUrl(link.slug),
          error: `Type "${link.slug}" exactly to confirm.`,
        }).value,
        400,
      );
    }
    q.deleteLink.run(link.id);
    return c.redirect(`/admin?deleted=${encodeURIComponent(link.slug)}`, 303);
  });

  app.get('/admin/links/:slug/qr.svg', (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    const headers: Record<string, string> = { 'Content-Type': 'image/svg+xml; charset=utf-8' };
    if (!c.req.query('inline')) headers['Content-Disposition'] = `attachment; filename="qr-${link.slug}.svg"`;
    return c.body(qrSvg(shortUrl(link.slug)), 200, headers);
  });

  app.get('/admin/links/:slug/qr.png', (c) => {
    const link = findLink(c);
    if (!link) return c.html(errorPage('Link not found', 'That link does not exist.').value, 404);
    const withLabel = Boolean(c.req.query('label'));
    const png = qrPng(shortUrl(link.slug), withLabel ? displayUrl(shortUrl(link.slug)) : undefined);
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-${link.slug}${withLabel ? '-with-url' : ''}.png"`,
    });
  });

  // --- Public redirects (must be registered last) --------------------------

  app.get('/:slug', (c) => {
    const slug = c.req.param('slug').toLowerCase();
    const link = validateSlug(slug).ok ? q.redirectBySlug.get(slug) : undefined;
    if (!link) {
      c.header('Cache-Control', 'no-store');
      return c.html(notFoundPage().value, 404);
    }
    if (c.req.method === 'GET') {
      const country = c.req.header('cf-ipcountry')?.toUpperCase();
      scanLogger.record({
        linkId: link.id,
        scannedAt: now(),
        country: country && /^[A-Z0-9]{2}$/.test(country) ? country : null,
        device: deviceType(c.req.header('user-agent')),
      });
    }
    c.header('Cache-Control', 'no-store');
    return c.redirect(link.destination, 302);
  });

  app.notFound((c) => c.html(notFoundPage().value, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.html(errorPage('Something went wrong', 'An unexpected error occurred. Please try again.').value, 500);
  });

  return { app, scanLogger };
}
