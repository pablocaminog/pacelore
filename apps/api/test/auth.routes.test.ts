import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { fakeEnv } from './helpers.js';

async function postJson(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof fakeEnv>,
  path: string,
  body: unknown,
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('auth routes', () => {
  it('rejects registration without handle/email', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const res = await postJson(app, env, '/api/v1/auth/register/options', {});
    expect(res.status).toBe(400);
  });

  it('rejects invalid handle format', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const res = await postJson(app, env, '/api/v1/auth/register/options', {
      handle: 'no spaces allowed',
      email: 'a@b.co',
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate email', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const ok = await postJson(app, env, '/api/v1/auth/register/options', {
      handle: 'alice',
      email: 'a@b.co',
    });
    expect(ok.status).toBe(200);
    const dup = await postJson(app, env, '/api/v1/auth/register/options', {
      handle: 'alice2',
      email: 'a@b.co',
    });
    expect(dup.status).toBe(409);
  });

  it('issues registration options for a fresh email', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const res = await postJson(app, env, '/api/v1/auth/register/options', {
      handle: 'alice',
      email: 'alice@example.com',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      challengeId: string;
      userId: string;
      options: { challenge: string };
    };
    expect(body.challengeId).toBeTruthy();
    expect(body.userId).toBeTruthy();
    expect(body.options.challenge).toBeTruthy();
  });

  it('GET /api/v1/auth/me without session returns 401', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const res = await app.request('/api/v1/auth/me', {}, env);
    expect(res.status).toBe(401);
  });

  it('logout always returns ok and clears cookie', async () => {
    const app = buildApp();
    const env = fakeEnv();
    const res = await postJson(app, env, '/api/v1/auth/logout', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
