/**
 * ATProto export — connect a Bluesky/PDS account; activity summaries
 * mirror as `com.pacelore.activity` records on the user's PDS.
 *
 *   POST /api/v1/me/atproto/connect    { handle, appPassword, pdsUrl? }
 *   POST /api/v1/me/atproto/disconnect
 *   GET  /api/v1/me/atproto
 *
 * The actual record-creation happens in the ingest pipeline once the
 * activity is parsed — not here.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { atprotoLogin } from '../integrations/atproto.js';

export const atprotoRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
atprotoRoutes.use('*', requireSession());

atprotoRoutes.get('/me/atproto', async (c) => {
  const session = c.get('session');
  const row = await c.env.DB.prepare(
    'SELECT atproto_handle AS handle, atproto_did AS did, atproto_pds AS pds FROM users WHERE id = ?',
  )
    .bind(session.userId)
    .first<{ handle: string | null; did: string | null; pds: string | null }>();
  return c.json({
    connected: !!row?.did,
    handle: row?.handle ?? null,
    did: row?.did ?? null,
    pds: row?.pds ?? null,
  });
});

atprotoRoutes.post('/me/atproto/connect', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as {
    handle?: string;
    appPassword?: string;
    pdsUrl?: string;
  } | null;
  if (!body?.handle || !body?.appPassword) {
    throw new HTTPException(400, { message: 'handle + appPassword required' });
  }
  const pds = body.pdsUrl ?? c.env.ATPROTO_PDS_URL ?? 'https://bsky.social';
  const result = await atprotoLogin(pds, body.handle, body.appPassword);
  await c.env.DB.prepare(
    `UPDATE users
        SET atproto_handle = ?, atproto_pds = ?, atproto_app_password = ?,
            atproto_did = ?, atproto_access_jwt = ?, atproto_refresh_jwt = ?
      WHERE id = ?`,
  )
    .bind(
      body.handle,
      pds,
      body.appPassword,
      result.did,
      result.accessJwt,
      result.refreshJwt,
      session.userId,
    )
    .run();
  return c.json({ ok: true, did: result.did });
});

atprotoRoutes.post('/me/atproto/disconnect', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE users
        SET atproto_handle = NULL, atproto_pds = NULL, atproto_app_password = NULL,
            atproto_did = NULL, atproto_access_jwt = NULL, atproto_refresh_jwt = NULL
      WHERE id = ?`,
  )
    .bind(session.userId)
    .run();
  return c.json({ ok: true });
});
