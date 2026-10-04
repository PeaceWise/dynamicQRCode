// Server-rendered HTML. Every interpolated value is HTML-escaped unless it is
// itself the output of the `html` tag.

export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Child = Html | string | number | null | undefined | false | Child[];

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function render(child: Child): string {
  if (child === null || child === undefined || child === false) return '';
  if (child instanceof Html) return child.value;
  if (Array.isArray(child)) return child.map(render).join('');
  return escapeHtml(String(child));
}

export function html(strings: TemplateStringsArray, ...values: Child[]): Html {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Html(out);
}

// ---------------------------------------------------------------------------

export interface LinkRow {
  id: number;
  slug: string;
  destination: string;
  note: string;
  scan_count: number;
  created_at: number;
  updated_at: number;
}

export interface LinkListItem extends LinkRow {
  scans_30d: number;
}

export interface HistoryRow {
  old_destination: string | null;
  new_destination: string;
  changed_at: number;
}

export interface LinkStats {
  last30: number;
  daily: { day: string; label: string; count: number }[];
  countries: { name: string; count: number }[];
  devices: { name: string; count: number }[];
}

interface LayoutOptions {
  title: string;
  admin?: { csrf: string };
}

function layout(opts: LayoutOptions, body: Html): Html {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${opts.title} · Wayward Solutions</title>
<link rel="icon" type="image/png" href="/static/favicon.png">
<link rel="stylesheet" href="/static/admin.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="${opts.admin ? '/admin' : '/'}">
    <img src="/static/logo.png" alt="" width="36" height="36">
    <span><strong>Wayward</strong> Solutions<small>Dynamic QR</small></span>
  </a>
  ${
    opts.admin
      ? html`<form method="post" action="/logout" class="logout">
          <input type="hidden" name="_csrf" value="${opts.admin.csrf}">
          <button type="submit" class="btn btn-ghost">Log out</button>
        </form>`
      : ''
  }
</header>
<main class="container">
${body}
</main>
<script src="/static/admin.js" defer></script>
</body>
</html>`;
}

export function formatTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// --- Public pages -------------------------------------------------------------

export function landingPage(): Html {
  return layout(
    { title: 'Welcome' },
    html`<section class="card center">
      <h1>Nothing to see here</h1>
      <p class="muted">This address hosts short links. Scan a QR code to be taken to your destination.</p>
    </section>`,
  );
}

export function notFoundPage(): Html {
  return layout(
    { title: 'Link not found' },
    html`<section class="card center">
      <h1>Link not found</h1>
      <p class="muted">Sorry, this QR code or short link isn't active right now. Please check back later.</p>
    </section>`,
  );
}

export function errorPage(title: string, message: string): Html {
  return layout(
    { title },
    html`<section class="card center">
      <h1>${title}</h1>
      <p class="muted">${message}</p>
      <p><a class="btn" href="/admin">Back to dashboard</a></p>
    </section>`,
  );
}

export function loginPage(error?: string): Html {
  return layout(
    { title: 'Sign in' },
    html`<section class="card narrow">
      <h1>Admin sign in</h1>
      ${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}
      <form method="post" action="/login" class="stack">
        <label>Password
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        <button type="submit" class="btn btn-primary">Sign in</button>
      </form>
    </section>`,
  );
}

// --- Admin pages ------------------------------------------------------------

interface DashboardOptions {
  csrf: string;
  baseUrl: string;
  tz: string;
  links: LinkListItem[];
  error?: string;
  form?: { slug?: string; destination?: string; note?: string };
  flash?: string;
}

export function dashboardPage(o: DashboardOptions): Html {
  const form = o.form ?? {};
  return layout(
    { title: 'Dashboard', admin: { csrf: o.csrf } },
    html`
    ${o.flash ? html`<p class="alert alert-ok" role="status">${o.flash}</p>` : ''}
    <section class="card">
      <h1>Your links</h1>
      ${
        o.links.length === 0
          ? html`<p class="muted">No links yet. Create your first one below. A good start is <code>agenda</code>.</p>`
          : html`<ul class="link-list">
          ${o.links.map(
            (l) => html`<li>
              <a class="link-row" href="/admin/links/${l.slug}">
                <span class="link-slug">/${l.slug}</span>
                <span class="link-dest">${displayUrl(l.destination)}</span>
                <span class="link-meta">
                  <span><b>${l.scan_count}</b> total scans</span>
                  <span><b>${l.scans_30d}</b> in last 30 days</span>
                  <span>Updated ${formatTime(l.updated_at, o.tz)}</span>
                </span>
              </a>
            </li>`,
          )}
          </ul>`
      }
    </section>

    <section class="card" id="create">
      <h2>Create a new link</h2>
      ${o.error ? html`<p class="alert alert-error" role="alert">${o.error}</p>` : ''}
      <form method="post" action="/admin/links" class="stack">
        <input type="hidden" name="_csrf" value="${o.csrf}">
        <label>Short name (slug)
          <span class="slug-input"><span class="prefix">${displayUrl(o.baseUrl)}/</span><input name="slug" value="${form.slug ?? ''}" required maxlength="50" pattern="[a-z0-9\\-]{1,50}" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="agenda"></span>
          <small class="muted">Lowercase letters, numbers, and hyphens. This can't be changed later, since it may be printed.</small>
        </label>
        <label>Destination URL
          <input name="destination" type="url" value="${form.destination ?? ''}" required placeholder="https://docs.google.com/...">
        </label>
        <label>Note <small class="muted">(optional, only you see this)</small>
          <input name="note" value="${form.note ?? ''}" maxlength="500" placeholder="e.g. Sign at the front entrance">
        </label>
        <button type="submit" class="btn btn-primary">Create link</button>
      </form>
    </section>`,
  );
}

function scanChart(daily: LinkStats['daily']): Html {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const barW = 10;
  const gap = 2;
  const h = 80;
  const width = daily.length * (barW + gap);
  const bars = daily.map((d, i) => {
    const bh = d.count === 0 ? 1 : Math.max(3, Math.round((d.count / max) * h));
    return html`<rect x="${i * (barW + gap)}" y="${h - bh}" width="${barW}" height="${bh}" rx="2" class="${d.count === 0 ? 'bar-empty' : 'bar'}"><title>${d.label}: ${d.count} scan${d.count === 1 ? '' : 's'}</title></rect>`;
  });
  return html`<svg class="chart" viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" role="img" aria-label="Scans per day for the last 30 days">${bars}</svg>
    <div class="chart-axis"><span>${daily[0]?.label}</span><span>max ${max}/day</span><span>${daily[daily.length - 1]?.label}</span></div>`;
}

interface LinkPageOptions {
  csrf: string;
  shortUrl: string;
  tz: string;
  link: LinkRow;
  stats: LinkStats;
  history: HistoryRow[];
  error?: string;
  flash?: string;
  form?: { destination?: string; note?: string };
}

export function linkPage(o: LinkPageOptions): Html {
  const { link, stats } = o;
  const qrBase = `/admin/links/${link.slug}`;
  const form = o.form ?? {};
  return layout(
    { title: `/${link.slug}`, admin: { csrf: o.csrf } },
    html`
    <p><a href="/admin" class="back">← All links</a></p>
    ${o.flash ? html`<p class="alert alert-ok" role="status">${o.flash}</p>` : ''}

    <section class="card">
      <h1>/${link.slug}</h1>
      <div class="copy-row">
        <input id="short-url" value="${o.shortUrl}" readonly aria-label="Short URL">
        <button type="button" class="btn" data-copy="#short-url">Copy</button>
      </div>
      <p class="muted">Currently goes to: <a href="${link.destination}" target="_blank" rel="noopener noreferrer" class="break">${link.destination}</a></p>
    </section>

    <section class="card">
      <h2>Change destination</h2>
      ${o.error ? html`<p class="alert alert-error" role="alert">${o.error}</p>` : ''}
      <form method="post" action="/admin/links/${link.slug}" class="stack">
        <input type="hidden" name="_csrf" value="${o.csrf}">
        <label>Destination URL
          <input name="destination" type="url" value="${form.destination ?? link.destination}" required>
        </label>
        <label>Note <small class="muted">(optional)</small>
          <input name="note" value="${form.note ?? link.note}" maxlength="500">
        </label>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </form>
      <p class="muted small">The printed QR code keeps working. Scans go to the new destination right away.</p>
    </section>

    <section class="card">
      <h2>QR code</h2>
      <div class="qr-wrap">
        <img class="qr" src="${qrBase}/qr.svg?inline=1" alt="QR code for ${o.shortUrl}" width="240" height="240">
        <div class="stack">
          <a class="btn" href="${qrBase}/qr.svg">Download SVG <small>(best for print shops)</small></a>
          <a class="btn" href="${qrBase}/qr.png">Download PNG <small>(2400 px)</small></a>
          <a class="btn" href="${qrBase}/qr.png?label=1">Download PNG with URL text</a>
          <p class="muted small">Error correction level H with a white quiet zone. Test with several phones before printing.</p>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Scans</h2>
      <div class="stats">
        <div><b>${link.scan_count}</b><span>total</span></div>
        <div><b>${stats.last30}</b><span>last 30 days</span></div>
      </div>
      ${scanChart(stats.daily)}
      <details>
        <summary>Show scans per day as a table</summary>
        <table class="table">
          <thead><tr><th>Day</th><th class="num">Scans</th></tr></thead>
          <tbody>${[...stats.daily].reverse().map((d) => html`<tr><td>${d.label}</td><td class="num">${d.count}</td></tr>`)}</tbody>
        </table>
      </details>
      ${
        stats.countries.length || stats.devices.length
          ? html`<div class="breakdown">
          <div><h3>Devices (30 days)</h3><ul>${stats.devices.map((d) => html`<li><span>${d.name}</span><b>${d.count}</b></li>`)}</ul></div>
          <div><h3>Countries (30 days)</h3><ul>${stats.countries.map((d) => html`<li><span>${d.name}</span><b>${d.count}</b></li>`)}</ul></div>
        </div>`
          : ''
      }
    </section>

    <section class="card">
      <h2>Change history</h2>
      ${
        o.history.length === 0
          ? html`<p class="muted">No changes yet.</p>`
          : html`<ul class="history">
        ${o.history.map(
          (h) => html`<li>
            <time>${formatTime(h.changed_at, o.tz)}</time>
            ${
              h.old_destination === null
                ? html`<span>Created → <span class="break">${h.new_destination}</span></span>`
                : html`<span><s class="break">${h.old_destination}</s><br>→ <span class="break">${h.new_destination}</span></span>`
            }
          </li>`,
        )}
      </ul>`
      }
      <p class="muted small">Created ${formatTime(link.created_at, o.tz)}${link.note ? html` · Note: ${link.note}` : ''}</p>
    </section>

    <section class="card danger">
      <h2>Delete link</h2>
      <p class="muted">Deleting this link breaks every printed QR code that points to it.</p>
      <a class="btn btn-danger" href="${qrBase}/delete">Delete /${link.slug}…</a>
    </section>`,
  );
}

export function deleteConfirmPage(o: { csrf: string; link: LinkRow; shortUrl: string; error?: string }): Html {
  return layout(
    { title: `Delete /${o.link.slug}`, admin: { csrf: o.csrf } },
    html`<section class="card danger narrow">
      <h1>Delete /${o.link.slug}?</h1>
      ${o.error ? html`<p class="alert alert-error" role="alert">${o.error}</p>` : ''}
      <p class="alert alert-error"><strong>Warning:</strong> any printed QR code or sign that uses
        <code>${o.shortUrl}</code> will stop working and show "Link not found".
        Its scan history and change log are deleted too. This cannot be undone.</p>
      <p class="muted">If you only want to point the sign somewhere else, change the destination instead.</p>
      <form method="post" action="/admin/links/${o.link.slug}/delete" class="stack">
        <input type="hidden" name="_csrf" value="${o.csrf}">
        <label>Type <code>${o.link.slug}</code> to confirm
          <input name="confirm" required autocapitalize="none" autocorrect="off" spellcheck="false">
        </label>
        <button type="submit" class="btn btn-danger">Yes, delete permanently</button>
        <a class="btn" href="/admin/links/${o.link.slug}">Cancel</a>
      </form>
    </section>`,
  );
}
