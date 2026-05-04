import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import type { Env } from '../src/env.js';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  const ok = async () => ({}) as unknown;
  const db = {
    prepare: () => ({
      first: ok,
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ success: true }),
      bind: () => ({ first: ok, all: ok, run: ok }),
    }),
  } as unknown as D1Database;
  return {
    ENV: 'dev',
    APP_ORIGIN: 'http://localhost:4321',
    SESSION_SIGNING_KEY: 'test-key',
    DB: db,
    RAW_BUCKET: {} as R2Bucket,
    PARSED_BUCKET: {} as R2Bucket,
    EXPORTS_BUCKET: {} as R2Bucket,
    KV_SESSIONS: {} as KVNamespace,
    KV_LEADERBOARDS: {} as KVNamespace,
    KV_FEED: {} as KVNamespace,
    INGEST_QUEUE: {
      send: () => Promise.resolve(),
      sendBatch: () => Promise.resolve(),
    } as unknown as Queue,
    ...overrides,
  };
}

describe('API worker', () => {
  it('GET / returns service descriptor', async () => {
    const app = buildApp();
    const res = await app.request('/', {}, fakeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; env: string };
    expect(body.name).toBe('pacelore-api');
    expect(body.env).toBe('dev');
  });

  it('GET /healthz returns ok', async () => {
    const app = buildApp();
    const res = await app.request('/healthz', {}, fakeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('GET /readyz returns 503 when D1 throws', async () => {
    const app = buildApp();
    const env = fakeEnv({
      DB: {
        prepare: () => ({
          first: () => {
            throw new Error('db down');
          },
        }),
      } as unknown as D1Database,
    });
    const res = await app.request('/readyz', {}, env);
    expect(res.status).toBe(503);
  });

  it('returns 404 envelope for unknown routes', async () => {
    const app = buildApp();
    const res = await app.request('/no-such-route', {}, fakeEnv());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('stamps X-Request-Id header on the response', async () => {
    const app = buildApp();
    const res = await app.request('/', {}, fakeEnv());
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('echoes incoming X-Request-Id', async () => {
    const app = buildApp();
    const res = await app.request('/', { headers: { 'X-Request-Id': 'abc-123' } }, fakeEnv());
    expect(res.headers.get('X-Request-Id')).toBe('abc-123');
  });
});
