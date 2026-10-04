export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'login',
  'logout',
  'static',
  'health',
  'favicon.ico',
  'robots.txt',
]);

const SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateSlug(input: unknown): Result<string> {
  const slug = typeof input === 'string' ? input.trim() : '';
  if (!slug) return { ok: false, error: 'Please enter a short name (slug).' };
  if (slug.length > 50) return { ok: false, error: 'The slug can be at most 50 characters.' };
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, error: 'The slug may only contain lowercase letters, numbers, and hyphens.' };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `"${slug}" is reserved. Please pick another slug.` };
  return { ok: true, value: slug };
}

export function validateDestination(input: unknown): Result<string> {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: false, error: 'Please enter a destination URL.' };
  if (raw.length > 2048) return { ok: false, error: 'The destination URL is too long (max 2048 characters).' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL. It should start with https://' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// links are allowed.' };
  }
  if (!url.hostname) return { ok: false, error: 'The URL is missing a domain name.' };
  return { ok: true, value: url.toString() };
}

export function validateNote(input: unknown): Result<string> {
  const note = typeof input === 'string' ? input.trim() : '';
  if (note.length > 500) return { ok: false, error: 'The note can be at most 500 characters.' };
  return { ok: true, value: note };
}

/** Rough device classification from a User-Agent string. */
export function deviceType(userAgent: string | undefined | null): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|curl|wget|python-requests/.test(ua)) return 'bot';
  if (/ipad|tablet|kindle|silk|playbook/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/.test(ua)) return 'mobile';
  return 'desktop';
}
