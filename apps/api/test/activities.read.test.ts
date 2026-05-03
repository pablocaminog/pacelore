import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'user-1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  const setVal = cookie.split(';')[0]!;
  return { env, cookie: setVal };
}

function seedActivity(
  env: ReturnType<typeof fakeEnv>,
  opts: {
    id: string;
    athleteId: string;
    visibility?: string;
  },
) {
  const db = env.DB as unknown as FakeD1;
  db.activities.push({
    id: opts.id,
    athlete_id: opts.athleteId,
    source: 'gpx',
    sport: 'cycling',
    started_at: 1714723200,
    total_seconds: 3600,
    distance_m: 30000,
    visibility: opts.visibility ?? 'private',
    parsed_r2_path: `parsed/${opts.athleteId}/${opts.id}.json`,
  });
  db.activityMetrics.push({ activity_id: opts.id, key: 'power.np', value: 220 });
}

describe('GET /api/v1/activities/:id', () => {
  it('returns 404 for unknown id', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request('/api/v1/activities/none', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session', async () => {
    const env = fakeEnv();
    seedActivity(env, { id: 'a1', athleteId: 'user-1' });
    const app = buildApp();
    const res = await app.request('/api/v1/activities/a1', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the activity + metrics for the owner', async () => {
    const { env, cookie } = await authedEnv('user-1');
    seedActivity(env, { id: 'a1', athleteId: 'user-1' });
    const app = buildApp();
    const res = await app.request('/api/v1/activities/a1', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activity: { id: string; sport: string };
      metrics: { key: string; value: number }[];
    };
    expect(body.activity.id).toBe('a1');
    expect(body.activity.sport).toBe('cycling');
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics[0]).toEqual({ key: 'power.np', value: 220 });
  });

  it('refuses a private activity owned by someone else', async () => {
    const { env, cookie } = await authedEnv('user-1');
    seedActivity(env, { id: 'a2', athleteId: 'user-2', visibility: 'private' });
    const app = buildApp();
    const res = await app.request('/api/v1/activities/a2', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
  });

  it('allows public activities for any signed-in user', async () => {
    const { env, cookie } = await authedEnv('user-1');
    seedActivity(env, { id: 'a3', athleteId: 'user-2', visibility: 'public' });
    const app = buildApp();
    const res = await app.request('/api/v1/activities/a3', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });
});
