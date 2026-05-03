import { describe, expect, it } from 'vitest';
import { createSession, destroySession, loadSession, SESSION_COOKIE } from '../src/auth/session.js';
import { fakeEnv } from './helpers.js';

describe('session', () => {
  it('creates, signs, and round-trips a session via the cookie', async () => {
    const env = fakeEnv();
    const { cookie, sid } = await createSession(env, 'user-1');
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');

    // Extract just the cookie name=value part for the second call.
    const setVal = cookie.split(';')[0]!;
    const loaded = await loadSession(env, setVal);
    expect(loaded?.userId).toBe('user-1');
    expect(sid.length).toBeGreaterThan(20);
  });

  it('rejects a tampered signature', async () => {
    const env = fakeEnv();
    const { cookie } = await createSession(env, 'user-2');
    const setVal = cookie.split(';')[0]!;
    // Flip a character in the signature half
    const tampered = setVal.slice(0, -1) + (setVal.slice(-1) === 'A' ? 'B' : 'A');
    const loaded = await loadSession(env, tampered);
    expect(loaded).toBeNull();
  });

  it('returns null for missing cookie', async () => {
    const env = fakeEnv();
    expect(await loadSession(env, null)).toBeNull();
    expect(await loadSession(env, 'unrelated=foo')).toBeNull();
  });

  it('destroy removes the KV record and emits an expiring cookie', async () => {
    const env = fakeEnv();
    const { cookie } = await createSession(env, 'user-3');
    const setVal = cookie.split(';')[0]!;
    const cleared = await destroySession(env, setVal);
    expect(cleared).toContain('Max-Age=0');
    const after = await loadSession(env, setVal);
    expect(after).toBeNull();
  });

  it('isolates sessions per signing key', async () => {
    const a = fakeEnv({ SESSION_SIGNING_KEY: 'key-A-AAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    const b = fakeEnv({
      SESSION_SIGNING_KEY: 'key-B-BBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      KV_SESSIONS: a.KV_SESSIONS, // same KV, different key
    });
    const { cookie } = await createSession(a, 'user-4');
    const setVal = cookie.split(';')[0]!;
    expect((await loadSession(a, setVal))?.userId).toBe('user-4');
    expect(await loadSession(b, setVal)).toBeNull();
  });
});
