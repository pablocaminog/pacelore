import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

function seedUsers(env: ReturnType<typeof fakeEnv>, ids: string[]) {
  const db = env.DB as unknown as FakeD1;
  for (const id of ids) {
    db.users.push({ id, handle: id, email: `${id}@x`, displayName: null });
  }
}

describe('follows', () => {
  it('rejects following self', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedUsers(env, ['u1']);
    const app = buildApp();
    const res = await app.request(
      '/api/v1/follows/u1',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('404s for unknown athlete', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedUsers(env, ['u1']);
    const app = buildApp();
    const res = await app.request(
      '/api/v1/follows/missing',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('follows + unfollows + idempotent', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedUsers(env, ['u1', 'u2']);
    const app = buildApp();
    const a = await app.request(
      '/api/v1/follows/u2',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(a.status).toBe(200);
    const b = await app.request(
      '/api/v1/follows/u2',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(b.status).toBe(200); // idempotent
    expect((env.DB as unknown as FakeD1).follows).toHaveLength(1);

    const c = await app.request(
      '/api/v1/follows/u2',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(c.status).toBe(200);
    expect((env.DB as unknown as FakeD1).follows).toHaveLength(0);
  });

  it('lists followers + following', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedUsers(env, ['u1', 'u2', 'u3']);
    const app = buildApp();
    await app.request('/api/v1/follows/u2', { method: 'POST', headers: { Cookie: cookie } }, env);
    await app.request('/api/v1/follows/u3', { method: 'POST', headers: { Cookie: cookie } }, env);

    const followingRes = await app.request(
      '/api/v1/athletes/u1/following',
      { headers: { Cookie: cookie } },
      env,
    );
    const following = (await followingRes.json()) as { items: { id: string }[] };
    expect(following.items.map((i) => i.id).sort()).toEqual(['u2', 'u3']);

    const followersRes = await app.request(
      '/api/v1/athletes/u2/followers',
      { headers: { Cookie: cookie } },
      env,
    );
    const followers = (await followersRes.json()) as { items: { id: string }[] };
    expect(followers.items.map((i) => i.id)).toEqual(['u1']);
  });
});
