/**
 * Athlete settings + API keys + account close.
 *
 *   GET    /api/v1/me/settings
 *   PATCH  /api/v1/me/settings
 *   GET    /api/v1/me/api-keys
 *   POST   /api/v1/me/api-keys     { name, scopes: ["read:activities",…] }
 *   DELETE /api/v1/me/api-keys/:id
 *   DELETE /api/v1/me               { confirm: handle }   — close account
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { mintApiKey } from '../auth/apiKey.js';
import { sendEmail } from '../integrations/email.js';
import { accountDeletedEmail } from '../integrations/email-templates.js';

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

/**
 * Close account. Requires `?confirm=<handle>` in the request body so a
 * stray double-click can't nuke an athlete's data. Cascading FK rules
 * on the schema take care of activities, comments, follows, etc.
 */
settingsRoutes.delete('/me', async (c) => {
  const session = c.get('session');
  const body = await c.req.json().catch(() => ({})) as { confirm?: string };
  const user = await c.env.DB.prepare(
    `SELECT email, handle, display_name AS displayName FROM users WHERE id = ?`,
  )
    .bind(session.userId)
    .first<{ email: string; handle: string; displayName: string | null }>();
  if (!user) throw new HTTPException(404, { message: 'user not found' });
  if (body.confirm !== user.handle) {
    throw new HTTPException(400, {
      message: `confirm must equal your handle "${user.handle}"`,
    });
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(session.userId).run();

  // Best-effort goodbye email. After this point the row is gone so we
  // can't recover the address — captured above.
  try {
    const tpl = accountDeletedEmail({
      appOrigin: c.env.APP_ORIGIN,
      athlete: { handle: user.handle, displayName: user.displayName },
    });
    await sendEmail(c.env, {
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      idempotencyKey: `goodbye:${session.userId}`,
    });
  } catch (err) {
    console.warn('goodbye email failed', err);
  }

  // Clear the session cookie so the browser doesn't keep replaying it.
  c.header(
    'Set-Cookie',
    'pacelore_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
  );
  return c.json({ ok: true });
});
