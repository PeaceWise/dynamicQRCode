import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

const MIN = 60_000;

describe('login rate limiting', () => {
  it('locks out after 5 failed attempts, even with the right password', async () => {
    const { login } = setup();
    for (let i = 0; i < 4; i++) expect((await login('nope')).status).toBe(401);
    expect((await login('nope')).status).toBe(429);
    const res = await login(); // correct password, but locked out
    expect(res.status).toBe(429);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('Too many failed attempts');
  });

  it('unlocks after 15 minutes', async () => {
    const { login, clock } = setup();
    for (let i = 0; i < 5; i++) await login('nope');
    clock.now += 14 * MIN;
    expect((await login()).status).toBe(429);
    clock.now += 1 * MIN + 1;
    expect((await login()).status).toBe(303);
  });

  it('tracks clients separately by CF-Connecting-IP', async () => {
    const { login } = setup();
    for (let i = 0; i < 5; i++) await login('nope', '203.0.113.1');
    expect((await login(undefined, '203.0.113.1')).status).toBe(429);
    expect((await login(undefined, '203.0.113.2')).status).toBe(303);
  });

  it('forgets failures older than the 15-minute window', async () => {
    const { login, clock } = setup();
    for (let i = 0; i < 4; i++) await login('nope');
    clock.now += 16 * MIN;
    expect((await login('nope')).status).toBe(401); // counter restarted, not locked
  });

  it('resets the counter after a successful login', async () => {
    const { login } = setup();
    for (let i = 0; i < 4; i++) await login('nope');
    expect((await login()).status).toBe(303);
    for (let i = 0; i < 4; i++) expect((await login('nope')).status).toBe(401);
  });
});
