/**
 * Arweave permanence backup — opt-in.
 *
 *   POST /api/v1/me/permanence/enable
 *   POST /api/v1/me/permanence/disable
 *   GET  /api/v1/me/permanence
 *
 * Heavy lifting (actual upload to Arweave via Bundlr/Turbo) lives in
 * the pipeline persist step, gated by users.arweave_permanence.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';

export const permanenceRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
permanenceRoutes.use('*', requireSession());

permanenceRoutes.get('/me/permanence', async (c) => {
  const session = c.get('session');
  const row = await c.env.DB.prepare('SELECT arweave_permanence AS enabled FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ enabled: number }>();
  return c.json({ enabled: !!row?.enabled });
});

permanenceRoutes.post('/me/permanence/enable', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare('UPDATE users SET arweave_permanence = 1 WHERE id = ?')
    .bind(session.userId)
    .run();
  return c.json({ ok: true, enabled: true });
});

permanenceRoutes.post('/me/permanence/disable', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare('UPDATE users SET arweave_permanence = 0 WHERE id = ?')
    .bind(session.userId)
    .run();
  return c.json({ ok: true, enabled: false });
});
