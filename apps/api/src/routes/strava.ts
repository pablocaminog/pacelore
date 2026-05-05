/**
 * Strava OAuth + activity import.
 *
 *   GET  /api/v1/auth/strava/start         — issues authorize-URL (302 redirect)
 *   GET  /api/v1/auth/strava/callback      — exchanges ?code, persists token
 *   POST /api/v1/me/import/strava          — backfill activities. Query params:
 *                                              scope=all  → walk back to account creation
 *                                              scope=90d  → last 90 days (default)
 *                                              since=ISO  → custom cutoff
 *   GET  /api/v1/me/imports                — list this athlete's import jobs
 *   GET  /api/v1/me/imports/:id            — fetch one job (poll for progress)
 *   POST /api/v1/me/imports/:id/cancel     — pause/cancel
 *
 * Rate limits (Strava, October 2024 docs): 100 requests / 15 min and
 * 1000 / day per access token. Each activity in a backfill is one
 * /export_tcx call plus one /athlete/activities list call per page.
 *
 * The backfill is implemented as an `import_jobs` row + per-tick worker.
 * The first POST kicks one tick synchronously and returns the job id.
 * The cron processor in scheduled.ts picks up `status='running'` jobs and
 * advances them tick-by-tick until done or the daily budget is consumed.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, IngestJob } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';
import { sendEmail } from '../integrations/email.js';
import { importDoneEmail } from '../integrations/email-templates.js';

export const stravaRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const STRAVA_AUTH = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';

// Rate-limit windows.
const RATE_WINDOW_SEC = 15 * 60;
const RATE_WINDOW_MAX = 95; // leave headroom under Strava's 100/15min cap
const DAILY_WINDOW_SEC = 24 * 60 * 60;
const DAILY_WINDOW_MAX = 950; // headroom under 1000/day
// Per tick: one list call + this many activity fetches.
const TICK_BATCH = 25;

// --------------------------- OAuth ---------------------------

stravaRoutes.get('/auth/strava/start', requireSession(), (c) => {
  const env = c.env;
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    throw new HTTPException(503, {
      message:
        'Strava integration not configured on this instance. Admin: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.',
    });
  }
  const redirect = `${env.APP_ORIGIN.replace(/\/$/, '')}/api/v1/auth/strava/callback`;
  const url = new URL(STRAVA_AUTH);
  url.searchParams.set('client_id', env.STRAVA_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all');
  return c.redirect(url.toString());
});

stravaRoutes.get('/auth/strava/callback', requireSession(), async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  if (!code) throw new HTTPException(400, { message: 'missing code' });

  const tokenRes = await fetch(STRAVA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.STRAVA_CLIENT_ID,
      client_secret: c.env.STRAVA_CLIENT_SECRET,
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
       SET user_id = excluded.user_id,
           access_token = excluded.access_token,
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
  return c.redirect('/upload');
});

// ------------------------- Backfill jobs --------------------------

stravaRoutes.use('/me/*', requireSession());
stravaRoutes.use('/me/imports*', requireSession());

stravaRoutes.post('/me/import/strava', async (c) => {
  const session = c.get('session');
  const tok = await loadStravaToken(c.env, session.userId);
  if (!tok) throw new HTTPException(400, { message: 'connect Strava first' });

  const url = new URL(c.req.url);
  const scope = url.searchParams.get('scope') ?? '90d';
  const sinceParam = url.searchParams.get('since');
  const stopAt =
    scope === 'all'
      ? 0
      : sinceParam
        ? Math.floor(Date.parse(sinceParam) / 1000)
        : Math.floor(Date.now() / 1000) - 90 * 86_400;

  // Collapse on an existing running job for the same provider — don't
  // start a parallel one that fights for the same rate-limit budget.
  const existing = await c.env.DB.prepare(
    `SELECT id FROM import_jobs
      WHERE athlete_id = ? AND provider = 'strava' AND status = 'running'`,
  )
    .bind(session.userId)
    .first<{ id: string }>();
  let jobId = existing?.id;
  if (!jobId) {
    jobId = uuidv7();
    await c.env.DB.prepare(
      `INSERT INTO import_jobs (id, athlete_id, provider, scope, status, cursor, stop_at)
       VALUES (?, ?, 'strava', ?, 'running', ?, ?)`,
    )
      .bind(jobId, session.userId, scope, Math.floor(Date.now() / 1000), stopAt)
      .run();
  }

  // Run one tick now so the user sees immediate progress; cron continues.
  await stravaTickOnce(c.env, jobId);

  return c.json(await fetchJob(c.env, jobId, session.userId));
});

stravaRoutes.get('/me/imports', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, scope, status, cursor, stop_at AS stopAt,
            total_seen AS totalSeen, succeeded, duplicates, failed,
            last_error AS lastError, updated_at AS updatedAt, created_at AS createdAt
       FROM import_jobs
      WHERE athlete_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});

stravaRoutes.get('/me/imports/:id', async (c) => {
  const session = c.get('session');
  return c.json(await fetchJob(c.env, c.req.param('id'), session.userId));
});

stravaRoutes.post('/me/imports/:id/cancel', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE import_jobs SET status = 'paused', updated_at = unixepoch()
      WHERE id = ? AND athlete_id = ?`,
  )
    .bind(c.req.param('id'), session.userId)
    .run();
  return c.json({ ok: true });
});

// ------------------------- Tick worker --------------------------

interface ImportJobRow {
  id: string;
  athlete_id: string;
  provider: 'strava' | 'garmin';
  status: 'running' | 'paused' | 'done' | 'error';
  cursor: number | null;
  stop_at: number | null;
  total_seen: number;
  succeeded: number;
  duplicates: number;
  failed: number;
  rate_window_started_at: number;
  rate_window_used: number;
  daily_window_started_at: number;
  daily_window_used: number;
}

/**
 * Run one tick of a Strava import job. Caller is responsible for picking
 * jobs in `running` state and respecting cadence (cron drives this once
 * per minute per active job).
 */
export async function stravaTickOnce(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT id, athlete_id, provider, status, cursor, stop_at,
            total_seen, succeeded, duplicates, failed,
            rate_window_started_at, rate_window_used,
            daily_window_started_at, daily_window_used
       FROM import_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<ImportJobRow>();
  if (!job || job.status !== 'running' || job.provider !== 'strava') return;

  const now = Math.floor(Date.now() / 1000);

  // Reset rolling windows.
  let rateStart = job.rate_window_started_at;
  let rateUsed = job.rate_window_used;
  if (now - rateStart > RATE_WINDOW_SEC) {
    rateStart = now;
    rateUsed = 0;
  }
  let dailyStart = job.daily_window_started_at;
  let dailyUsed = job.daily_window_used;
  if (now - dailyStart > DAILY_WINDOW_SEC) {
    dailyStart = now;
    dailyUsed = 0;
  }
  const reqBudget = Math.min(RATE_WINDOW_MAX - rateUsed, DAILY_WINDOW_MAX - dailyUsed);
  if (reqBudget <= 1) {
    // No budget — leave the job running, cron will retry next tick.
    await env.DB.prepare(
      `UPDATE import_jobs
          SET rate_window_started_at = ?, rate_window_used = ?,
              daily_window_started_at = ?, daily_window_used = ?,
              updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(rateStart, rateUsed, dailyStart, dailyUsed, job.id)
      .run();
    return;
  }
  const batchSize = Math.min(TICK_BATCH, Math.max(1, reqBudget - 1));

  const tok = await loadStravaToken(env, job.athlete_id);
  if (!tok) {
    await markError(env, job.id, 'token unavailable');
    return;
  }

  // Cursor walks backwards: `before` = next cutoff (oldest seen so far).
  const beforeEpoch = job.cursor ?? Math.floor(Date.now() / 1000);
  const listUrl = new URL(`${STRAVA_API}/athlete/activities`);
  listUrl.searchParams.set('before', String(beforeEpoch));
  // `after` enforces the user-set lower bound (90d / since-date / 0 for all).
  listUrl.searchParams.set('after', String(job.stop_at ?? 0));
  listUrl.searchParams.set('per_page', String(batchSize));
  listUrl.searchParams.set('page', '1');

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  rateUsed++;
  dailyUsed++;
  if (!listRes.ok) {
    await markError(env, job.id, `list HTTP ${listRes.status}`);
    return;
  }
  const items = (await listRes.json()) as StravaSummary[];

  let succeeded = job.succeeded;
  let duplicates = job.duplicates;
  let failed = job.failed;
  let oldestSeen = job.cursor ?? beforeEpoch;

  for (const it of items) {
    const startEpoch = Math.floor(Date.parse(it.start_date) / 1000);
    if (startEpoch < oldestSeen) oldestSeen = startEpoch;

    const externalId = String(it.id);
    const dupe = await env.DB.prepare(
      `SELECT id FROM activities WHERE external_source = 'strava' AND external_id = ?`,
    )
      .bind(externalId)
      .first<{ id: string }>();
    if (dupe) {
      duplicates++;
      continue;
    }

    if (rateUsed >= RATE_WINDOW_MAX || dailyUsed >= DAILY_WINDOW_MAX) break;

    const tcxRes = await fetch(`${STRAVA_API}/activities/${it.id}/export_tcx`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/xml' },
    });
    rateUsed++;
    dailyUsed++;
    if (!tcxRes.ok) {
      failed++;
      continue;
    }
    const text = await tcxRes.text();
    const activityId = uuidv7();
    const date = new Date(it.start_date);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const rawPath = `raw/${job.athlete_id}/${yyyy}/${mm}/${activityId}.tcx`;
    await env.RAW_BUCKET.put(rawPath, text, {
      httpMetadata: { contentType: 'application/tcx+xml' },
      customMetadata: {
        athleteId: job.athlete_id,
        activityId,
        source: 'strava-import',
        stravaActivityId: externalId,
      },
    });
    const ingest: IngestJob = {
      activityId,
      athleteId: job.athlete_id,
      rawR2Path: rawPath,
      source: 'tcx',
      externalSource: 'strava',
      externalId,
    };
    await env.INGEST_QUEUE.send(ingest);
    succeeded++;
  }

  const totalSeen = job.total_seen + items.length;
  // Advance cursor to the oldest activity timestamp − 1 so we don't re-list it.
  const nextCursor = items.length > 0 ? oldestSeen - 1 : oldestSeen;
  // Done when Strava returned fewer than the requested page size or we've
  // crossed the stop_at floor.
  const reachedFloor = job.stop_at != null && nextCursor <= job.stop_at;
  const reachedEnd = items.length < batchSize || reachedFloor;
  const status: ImportJobRow['status'] = reachedEnd ? 'done' : 'running';

  await env.DB.prepare(
    `UPDATE import_jobs
        SET cursor = ?, total_seen = ?, succeeded = ?, duplicates = ?, failed = ?,
            rate_window_started_at = ?, rate_window_used = ?,
            daily_window_started_at = ?, daily_window_used = ?,
            status = ?,
            last_error = NULL,
            updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(
      nextCursor,
      totalSeen,
      succeeded,
      duplicates,
      failed,
      rateStart,
      rateUsed,
      dailyStart,
      dailyUsed,
      status,
      job.id,
    )
    .run();

  if (status === 'done') {
    await sendImportDoneEmail(env, job.athlete_id, 'strava', succeeded, duplicates, failed).catch(
      () => {},
    );
  }
}

export async function sendImportDoneEmail(
  env: Env,
  athleteId: string,
  provider: 'strava' | 'garmin',
  succeeded: number,
  duplicates: number,
  failed: number,
): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT email, handle, display_name AS displayName FROM users WHERE id = ?`,
  )
    .bind(athleteId)
    .first<{ email: string; handle: string; displayName: string | null }>();
  if (!user) return;
  const tpl = importDoneEmail({
    appOrigin: env.APP_ORIGIN,
    athlete: { handle: user.handle, displayName: user.displayName },
    provider,
    succeeded,
    duplicates,
    failed,
  });
  await sendEmail(env, {
    to: user.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    idempotencyKey: `import-done:${provider}:${athleteId}:${succeeded}`,
  });
}

interface StravaSummary {
  id: number;
  start_date: string;
  type: string;
}

// ------------------------- Helpers --------------------------

async function fetchJob(env: Env, jobId: string, athleteId: string) {
  const row = await env.DB.prepare(
    `SELECT id, provider, scope, status, cursor, stop_at AS stopAt,
            total_seen AS totalSeen, succeeded, duplicates, failed,
            last_error AS lastError, updated_at AS updatedAt, created_at AS createdAt
       FROM import_jobs WHERE id = ? AND athlete_id = ?`,
  )
    .bind(jobId, athleteId)
    .first();
  if (!row) throw new HTTPException(404, { message: 'job not found' });
  return row;
}

async function markError(env: Env, jobId: string, message: string) {
  await env.DB.prepare(
    `UPDATE import_jobs
        SET status = 'error', last_error = ?, updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(message, jobId)
    .run();
}

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
