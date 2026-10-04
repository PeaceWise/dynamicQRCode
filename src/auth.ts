import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'qr_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface SessionPayload {
  sid: string; // random id, also the basis of the CSRF token
  exp: number; // expiry, unix epoch milliseconds
  pv: string; // fingerprint of ADMIN_PASSWORD: changing the password logs everyone out
}

export interface Session {
  sid: string;
  exp: number;
}

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function passwordFingerprint(secret: string, password: string): string {
  return hmac(secret, `pw:${password}`).slice(0, 16);
}

export function checkPassword(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}

export function createSessionToken(secret: string, password: string, now: number): string {
  const payload: SessionPayload = {
    sid: randomBytes(18).toString('base64url'),
    exp: now + SESSION_MAX_AGE_SECONDS * 1000,
    pv: passwordFingerprint(secret, password),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, `session:${body}`)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  password: string,
  now: number,
): Session | null {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(secret, `session:${body}`))) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.sid !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;
  if (payload.pv !== passwordFingerprint(secret, password)) return null;
  return { sid: payload.sid, exp: payload.exp };
}

// "Don't count scans from this device": a long-lived cookie set on the admin's own
// phone/browser. SameSite=Lax so it is sent when a QR scan opens the link.
export const IGNORE_DEVICE_COOKIE = 'qr_ignore';
export const IGNORE_DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // browsers cap cookies at 400 days

export function ignoreDeviceToken(secret: string): string {
  return hmac(secret, 'ignore-device:v1');
}

export function isIgnoredDevice(secret: string, cookie: string | undefined): boolean {
  return typeof cookie === 'string' && cookie.length > 0 && safeEqual(cookie, ignoreDeviceToken(secret));
}

export function csrfToken(secret: string, sid: string): string {
  return hmac(secret, `csrf:${sid}`);
}

export function verifyCsrf(secret: string, sid: string, given: unknown): boolean {
  return typeof given === 'string' && given.length > 0 && safeEqual(given, csrfToken(secret, sid));
}
