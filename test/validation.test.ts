import { describe, expect, it } from 'vitest';
import { deviceType, validateDestination, validateSlug } from '../src/validation.js';

describe('slug validation', () => {
  it.each(['agenda', 'pool-hours', 'a', '2026-budget', 'x'.repeat(50)])('accepts %s', (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: true, value: slug });
  });

  it.each([
    ['', 'empty'],
    ['Agenda', 'upper case'],
    ['pool hours', 'space'],
    ['pool_hours', 'underscore'],
    ['agenda.pdf', 'dot'],
    ['café', 'non-ascii'],
    ['x'.repeat(51), 'too long'],
  ])('rejects %j (%s)', (slug) => {
    expect(validateSlug(slug).ok).toBe(false);
  });

  it.each(['admin', 'api', 'login', 'logout', 'static', 'health', 'favicon.ico', 'robots.txt'])(
    'rejects reserved slug %s',
    (slug) => {
      const result = validateSlug(slug);
      expect(result.ok).toBe(false);
    },
  );
});

describe('destination validation', () => {
  it.each(['https://example.com', 'http://example.com/path?q=1#x', 'https://docs.google.com/document/d/abc/edit'])(
    'accepts %s',
    (url) => {
      expect(validateDestination(url).ok).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com/file',
    'mailto:me@example.com',
    'file:///etc/passwd',
    'example.com',
    '',
    'https://',
  ])('rejects %j', (url) => {
    expect(validateDestination(url).ok).toBe(false);
  });
});

describe('device type', () => {
  it('classifies common user agents', () => {
    expect(deviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('tablet');
    expect(deviceType('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36')).toBe('tablet');
    expect(deviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15')).toBe('desktop');
    expect(deviceType('Googlebot/2.1')).toBe('bot');
    expect(deviceType(undefined)).toBe('unknown');
  });
});
