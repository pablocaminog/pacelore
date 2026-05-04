/**
 * Strava OAuth + activity import.
 *
 *   GET  /api/v1/auth/strava/start         — issues authorize-URL (302 redirect)
 *   GET  /api/v1/auth/strava/callback      — exchanges ?code, persists token
 *   POST /api/v1/me/import/strava          — backfills activities (last 90 days
 *                                            by default; ?since=YYYY-MM-DD)
 *
 * Secrets required (set with `wrangler secret put`):
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *
 * Strava activities are pulled as TCX via the /activities/{id}/export_tcx
 * endpoint and routed through the same ingest queue used by manual
 * uploads, tagged with source='strava-import'.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, IngestJob } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const stravaRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
stravaRoutes.use('*', requireSession());

const STRAVA_AUTH = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';

stravaRoutes.get('/auth/strava/start', (c) => {
  const { STRAVA_CLIENT_ID, APP_ORIGIN } = c.env;
  if (!STRAVA_CLIENT_ID) throw new HTTPException(500, { message: 'STRAVA_CLIENT_ID not set' });
  const redirect = `${APP_ORIGIN.replace(/\/$/, '')}/api/v1/auth/strava/callback`;
  const url = new URL(STRAVA_AUTH);
  url.searchParams.set('client_id', STRAVA_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all');
  url.searchParams.set('state', c.get('session').userId);
  return c.redirect(url.toString());
});

stravaRoutes.get('/auth/strava/callback', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || state !== session.userId) {
    throw new HTTPException(400, { message: 'invalid OAuth callback' });
  }
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = c.env;
  const tokenRes = await fetch(STRAVA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    throw new HTTPException(502, { message: `Strava token exchange failed (${tokenRes.status})` });
  }
  const tok = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: { id: number };
  };
  await c.env.DB.prepare(
    `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
     VALUES ('strava', ?, ?, ?, ?, ?, 'read,activity:read_all')
     ON CONFLICT(provider, external_id) DO UPDATE
       SET access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at`,
  )
    .bind(
      String(tok.athlete.id),
      session.userId,
      tok.access_token,
      tok.refresh_token,
      tok.expires_at,
    )
    .run();
  return c.redirect('/settings');
});

stravaRoutes.post('/me/import/strava', async (c) => {
  const session = c.get('session');
  const tok = await loadStravaToken(c.env, session.userId);
  if (!tok) throw new HTTPException(400, { message: 'connect Strava first' });

  const url = new URL(c.req.url);
  const sinceParam = url.searchParams.get('since');
  const after = sinceParam
    ? Math.floor(Date.parse(sinceParam) / 1000)
    : Math.floor(Date.now() / 1000) - 90 * 86_400;

  let page = 1;
  let queued = 0;
  while (true) {
    const listUrl = new URL(`${STRAVA_API}/athlete/activities`);
    listUrl.searchParams.set('after', String(after));
    listUrl.searchParams.set('per_page', '100');
    listUrl.searchParams.set('page', String(page));
    const list = await fetch(listUrl, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!list.ok) {
      throw new HTTPException(502, { message: `Strava activities list failed (${list.status})` });
    }
    const items = (await list.json()) as { id: number; start_date: string; type: string }[];
    if (items.length === 0) break;

    for (const it of items) {
      const tcxRes = await fetch(`${STRAVA_API}/activities/${it.id}/export_tcx`, {
        headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/xml' },
      });
      if (!tcxRes.ok) continue;
      const text = await tcxRes.text();
      const activityId = uuidv7();
      const date = new Date(it.start_date);
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const rawPath = `raw/${session.userId}/${yyyy}/${mm}/${activityId}.tcx`;
      await c.env.RAW_BUCKET.put(rawPath, text, {
        httpMetadata: { contentType: 'application/tcx+xml' },
        customMetadata: {
          athleteId: session.userId,
          activityId,
          source: 'strava-import',
          stravaActivityId: String(it.id),
        },
      });
      const job: IngestJob = {
        activityId,
        athleteId: session.userId,
        rawR2Path: rawPath,
        source: 'tcx',
      };
      await c.env.INGEST_QUEUE.send(job);
      queued++;
    }
    if (items.length < 100) break;
    page++;
  }
  return c.json({ ok: true, queued });
});

interface StravaTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function loadStravaToken(env: Env, userId: string): Promise<StravaTokenRow | null> {
  const row = await env.DB.prepare(
    `SELECT access_token, refresh_token, expires_at
       FROM oauth_identities
      WHERE provider = 'strava' AND user_id = ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<StravaTokenRow>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000) + 60) {
    const refreshed = await refresh(env, row.refresh_token);
    if (refreshed) return refreshed;
  }
  return row;
}

async function refresh(env: Env, refreshToken: string): Promise<StravaTokenRow | null> {
  const res = await fetch(STRAVA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  await env.DB.prepare(
    `UPDATE oauth_identities
        SET access_token = ?, refresh_token = ?, expires_at = ?
      WHERE provider = 'strava' AND refresh_token = ?`,
  )
    .bind(body.access_token, body.refresh_token, body.expires_at, refreshToken)
    .run();
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
  };
}
