import { presetIconSvg } from './qr.js';
import type { QrDesign } from './qrDesign.js';

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
  qr_design: string;
  stats_reset_at: number | null;
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
  ignoringDevice: boolean;
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
    </section>

    <section class="card" id="scans">
      <h2>Test scans</h2>
      ${deviceToggle(o.csrf, o.ignoringDevice, '/admin')}
    </section>`,
  );
}

function deviceToggle(csrf: string, ignoring: boolean, back: string): Html {
  return html`<form method="post" action="/admin/device" class="device-toggle">
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="back" value="${back}">
    ${
      ignoring
        ? html`<p><span class="badge">✓ This device is not counted</span> Scans you make from this browser are not added to the statistics.</p>
          <input type="hidden" name="ignore" value="0">
          <button type="submit" class="btn">Count this device again</button>`
        : html`<p class="muted">Testing your signs? Open this page on <b>the phone you test with</b> (in the browser your camera opens, usually Safari on iPhone or Chrome on Android) and tap the button. Your own scans won't be counted.</p>
          <input type="hidden" name="ignore" value="1">
          <button type="submit" class="btn">Don't count scans from this device</button>`
    }
  </form>`;
}

function tile(name: string, value: string, current: string, label: string, visual: Html): Html {
  return html`<label class="tile">
    <input type="radio" name="${name}" value="${value}" ${value === current ? html`checked` : ''}>
    <span class="tile-visual">${visual}</span>
    <span class="tile-label">${label}</span>
  </label>`;
}

function thumb(qrBase: string, params: Record<string, string>): Html {
  const qs = new URLSearchParams({ preview: '1', thumb: '1', ...params }).toString();
  return html`<img src="${qrBase}/qr.svg?${qs}" alt="" width="64" height="64" loading="lazy">`;
}

function designSection(o: {
  csrf: string;
  slug: string;
  shortUrl: string;
  design: QrDesign;
  hasCustomLogo: boolean;
  error?: string;
}): Html {
  const d = o.design;
  const qrBase = `/admin/links/${o.slug}`;
  const color = (name: keyof QrDesign, label: string, hint: string) =>
    html`<label class="color-field"><input type="color" name="${name}" value="${String(d[name])}"><span>${label}<small class="muted">${hint}</small></span></label>`;
  const logos: [string, string, Html][] = [
    ['none', 'None', html`<span class="tile-none">✕</span>`],
    ['wayward', 'Wayward', html`<img src="/static/logo-mark.png" alt="" width="44" height="44">`],
    ...(['agenda', 'calendar', 'home', 'link'] as const).map(
      (k): [string, string, Html] => [k, k[0].toUpperCase() + k.slice(1), new Html(presetIconSvg(k, d.accent) ?? '')],
    ),
  ];
  if (o.hasCustomLogo) logos.push(['custom', 'Your logo', html`<img src="${qrBase}/logo.png" alt="" width="44" height="44">`]);

  return html`<section class="card" id="design">
    <h2>QR code</h2>
    ${o.error ? html`<p class="alert alert-error" role="alert">${o.error}</p>` : ''}
    <div class="qr-wrap">
      <div class="preview-col">
        <img id="qr-preview" class="qr" src="${qrBase}/qr.svg?inline=1" data-base="${qrBase}" alt="QR code for ${o.shortUrl}">
        <p id="design-dirty" class="small preview-note" hidden>Preview of unsaved changes. Click <b>Save design</b> to use it for downloads.</p>
        <p id="design-warning" class="alert alert-error small" hidden></p>
      </div>
      <div class="stack downloads">
        <a class="btn" href="${qrBase}/qr.svg">Download SVG <small>(best for print shops)</small></a>
        <a class="btn" href="${qrBase}/qr.png">Download PNG <small>(2400 px)</small></a>
        <a class="btn" href="${qrBase}/qr.png?label=1">Download PNG with URL text</a>
        <p class="muted small">Downloads use the saved design. Error correction level H with a quiet zone. Test with several phones before printing.</p>
      </div>
    </div>

    <form method="post" action="${qrBase}/logo" enctype="multipart/form-data" id="logo-form">
      <input type="hidden" name="_csrf" value="${o.csrf}">
    </form>

    <form method="post" action="${qrBase}/design" id="design-form">
      <input type="hidden" name="_csrf" value="${o.csrf}">
      <h3 class="design-title">Design your QR code</h3>
      <div class="tabs">
        <input type="radio" name="_tab" id="tab-frame" checked><label for="tab-frame">Frame</label>
        <input type="radio" name="_tab" id="tab-shape"><label for="tab-shape">Shape</label>
        <input type="radio" name="_tab" id="tab-logo"><label for="tab-logo">Logo</label>
        <input type="radio" name="_tab" id="tab-colors"><label for="tab-colors">Colors</label>

        <div class="panel panel-frame">
          <div class="tiles">
            ${tile('frame', 'none', d.frame, 'None', html`<span class="tile-none">✕</span>`)}
            ${tile('frame', 'box', d.frame, 'Bottom', thumb(qrBase, { frame: 'box' }))}
            ${tile('frame', 'top', d.frame, 'Top', thumb(qrBase, { frame: 'top' }))}
            ${tile('frame', 'pill', d.frame, 'Badge', thumb(qrBase, { frame: 'pill' }))}
          </div>
          <label>Frame text
            <input name="frameText" value="${d.frameText}" maxlength="24" placeholder="SCAN ME">
          </label>
          <p class="muted small">The frame color is under <b>Colors</b>.</p>
        </div>

        <div class="panel panel-shape">
          <h4>Pattern</h4>
          <div class="tiles">
            ${tile('dots', 'square', d.dots, 'Square', thumb(qrBase, { dots: 'square', frame: 'none' }))}
            ${tile('dots', 'rounded', d.dots, 'Rounded', thumb(qrBase, { dots: 'rounded', frame: 'none' }))}
            ${tile('dots', 'dots', d.dots, 'Dots', thumb(qrBase, { dots: 'dots', frame: 'none' }))}
          </div>
          <h4>Corner frames</h4>
          <div class="tiles">
            ${tile('eyeFrame', 'square', d.eyeFrame, 'Square', thumb(qrBase, { eyeFrame: 'square', frame: 'none' }))}
            ${tile('eyeFrame', 'rounded', d.eyeFrame, 'Rounded', thumb(qrBase, { eyeFrame: 'rounded', frame: 'none' }))}
            ${tile('eyeFrame', 'circle', d.eyeFrame, 'Circle', thumb(qrBase, { eyeFrame: 'circle', frame: 'none' }))}
          </div>
          <h4>Corner centers</h4>
          <div class="tiles">
            ${tile('eyeBall', 'square', d.eyeBall, 'Square', thumb(qrBase, { eyeBall: 'square', frame: 'none' }))}
            ${tile('eyeBall', 'rounded', d.eyeBall, 'Rounded', thumb(qrBase, { eyeBall: 'rounded', frame: 'none' }))}
            ${tile('eyeBall', 'circle', d.eyeBall, 'Circle', thumb(qrBase, { eyeBall: 'circle', frame: 'none' }))}
          </div>
        </div>

        <div class="panel panel-logo">
          <div class="tiles">${logos.map(([value, label, visual]) => tile('logo', value, d.logo, label, visual))}</div>
          <div class="logo-options">
            <fieldset class="segmented">
              <legend>Logo size</legend>
              ${(['small', 'medium', 'large'] as const).map(
                (size) => html`<label><input type="radio" name="logoSize" value="${size}" ${d.logoSize === size ? html`checked` : ''}><span>${size[0].toUpperCase() + size.slice(1)}</span></label>`,
              )}
            </fieldset>
            <label class="check"><input type="checkbox" name="logoClear" value="1" ${d.logoClear ? html`checked` : ''}> Remove the pattern behind the logo</label>
          </div>
          <div class="upload">
            <h4>Upload your own logo</h4>
            <p class="muted small">PNG or JPEG, up to 2 MB. A square logo with a transparent or white background works best.</p>
            <div class="upload-row">
              <input type="file" name="logo" accept="image/png,image/jpeg" form="logo-form" required>
              <button type="submit" class="btn" form="logo-form">Upload</button>
            </div>
            ${
              o.hasCustomLogo
                ? html`<button type="submit" class="btn btn-ghost small" form="logo-remove-form">Remove uploaded logo</button>`
                : ''
            }
          </div>
        </div>

        <div class="panel panel-colors">
          <div class="colors">
            ${color('fg', 'Pattern', 'the small squares')}
            ${color('eye', 'Corners', 'the three big squares')}
            ${color('bg', 'Background', 'keep it light')}
            ${color('accent', 'Frame & icon', 'any color')}
          </div>
          <p class="muted small">For reliable scanning use dark colors on a light background. Very light colors are refused when you save.</p>
        </div>
      </div>
      <div class="design-actions">
        <button type="submit" class="btn btn-primary">Save design</button>
        <a class="btn btn-ghost" href="${qrBase}#design">Discard changes</a>
      </div>
    </form>
    <form method="post" action="${qrBase}/logo/delete" id="logo-remove-form">
      <input type="hidden" name="_csrf" value="${o.csrf}">
    </form>
  </section>`;
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
  design: QrDesign;
  designError?: string;
  hasCustomLogo: boolean;
  ignoringDevice: boolean;
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

    ${designSection({ csrf: o.csrf, slug: link.slug, shortUrl: o.shortUrl, design: o.design, hasCustomLogo: o.hasCustomLogo, error: o.designError })}

    <section class="card" id="scans">
      <h2>Scans</h2>
      ${
        link.stats_reset_at
          ? html`<p class="muted small">Counting since ${formatTime(link.stats_reset_at, o.tz)}, when the statistics were reset.</p>`
          : ''
      }
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
      <div class="scan-tools">
        ${deviceToggle(o.csrf, o.ignoringDevice, `/admin/links/${link.slug}`)}
        <details class="reset">
          <summary>Reset scan statistics…</summary>
          <form method="post" action="/admin/links/${link.slug}/reset-stats" class="stack">
            <input type="hidden" name="_csrf" value="${o.csrf}">
            <p class="muted small">Use this after testing, before the sign goes up. The link and its destination are not changed.</p>
            <label class="check"><input type="checkbox" name="confirm" value="yes" required> Permanently delete all ${link.scan_count} scan${link.scan_count === 1 ? '' : 's'} of /${link.slug} and start counting from zero</label>
            <button type="submit" class="btn btn-danger">Reset to zero</button>
          </form>
        </details>
      </div>
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
