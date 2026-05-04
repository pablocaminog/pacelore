/**
 * Athlete settings + API keys.
 *
 *   GET  /api/v1/me/settings
 *   PATCH /api/v1/me/settings
 *   GET  /api/v1/me/api-keys
 *   POST /api/v1/me/api-keys     { name, scopes: ["read:activities",…] }
 *   DELETE /api/v1/me/api-keys/:id
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { mintApiKey } from '../auth/apiKey.js';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
settingsRoutes.use('*', requireSession());

const VALID_SCOPES = new Set([
  'read:activities',
  'write:activities',
  'read:social',
  'write:social',
  'read:profile',
  'write:profile',
]);

settingsRoutes.get('/me/settings', async (c) => {
  const session = c.get('session');
  const row = await c.env.DB.prepare(
    `SELECT id, handle, email, display_name AS displayName, bio, location, units_pref AS unitsPref,
            ftp, hr_max AS hrMax, hr_rest AS hrRest,
            threshold_pace_ms_x100 AS thresholdPaceMsX100, sex
       FROM users WHERE id = ?`,
  )
    .bind(session.userId)
    .first();
  if (!row) throw new HTTPException(404, { message: 'user not found' });
  return c.json({ user: row });
});

settingsRoutes.patch('/me/settings', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new HTTPException(400, { message: 'invalid JSON' });
  const allowed: [string, string][] = [
    ['displayName', 'display_name'],
    ['bio', 'bio'],
    ['location', 'location'],
    ['unitsPref', 'units_pref'],
    ['ftp', 'ftp'],
    ['hrMax', 'hr_max'],
    ['hrRest', 'hr_rest'],
    ['thresholdPaceMsX100', 'threshold_pace_ms_x100'],
    ['sex', 'sex'],
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of allowed) {
    if (key in body) {
      sets.push(`${col} = ?`);
      vals.push(body[key]);
    }
  }
  if (sets.length === 0) return c.json({ ok: true, changed: false });
  sets.push('updated_at = unixepoch()');
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals, session.userId)
    .run();
  return c.json({ ok: true, changed: true });
});

settingsRoutes.get('/me/api-keys', async (c) => {
  const session = c.get('session');
  const result = await c.env.DB.prepare(
    `SELECT id, name, scopes, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: result.results ?? [] });
});

settingsRoutes.post('/me/api-keys', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as {
    name?: string;
    scopes?: string[];
  } | null;
  const scopes = body?.scopes ?? ['read:activities'];
  for (const s of scopes) {
    if (!VALID_SCOPES.has(s)) throw new HTTPException(400, { message: `unknown scope: ${s}` });
  }
  const minted = await mintApiKey(c.env, session.userId, scopes, body?.name);
  return c.json(minted, 201);
});

settingsRoutes.delete('/me/api-keys/:id', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ? AND user_id = ?',
  )
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});
