/**
 * Garmin Connect Developer / Wellness API integration.
 *
 *   GET  /api/v1/auth/garmin/start          — OAuth1.0a request token + 302
 *   GET  /api/v1/auth/garmin/callback       — exchange verifier → access token
 *   POST /api/v1/webhooks/garmin/activities — push notification (Garmin → us)
 *
 * Garmin still uses OAuth1.0a (HMAC-SHA1) for both Connect Developer
 * and Health API. Production access requires partner approval; the
 * route shape matches the documented contract.
 *
 * Webhook payload contains activity summaries with `callbackURL` fields
 * pointing at the FIT file. We download the FIT, store in R2, queue
 * the same ingest job manual uploads use.
 *
 * Secrets:
 *   GARMIN_CONSUMER_KEY
 *   GARMIN_CONSUMER_SECRET
 *
 * KV stash for request_token → tokenSecret mapping during the OAuth
 * dance lives in KV_SESSIONS under `garmin:reqtok:<token>`.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, IngestJob } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { loadSession } from '../auth/session.js';
import { parseFormBody, signOAuth1 } from '../integrations/oauth1.js';
import { uuidv7 } from '../util/uuid.js';
import { sendImportDoneEmail } from './strava.js';

export const garminRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const REQ_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const AUTHORIZE_URL = 'https://connect.garmin.com/oauthConfirm';

function consumer(env: Env) {
  if (!env.GARMIN_CONSUMER_KEY || !env.GARMIN_CONSUMER_SECRET) {
    throw new HTTPException(503, {
      message:
        'Garmin integration not configured on this instance. Admin: set GARMIN_CONSUMER_KEY and GARMIN_CONSUMER_SECRET.',
    });
  }
  return {
    consumerKey: env.GARMIN_CONSUMER_KEY,
    consumerSecret: env.GARMIN_CONSUMER_SECRET,
  };
}

garminRoutes.get('/auth/garmin/start', async (c) => {
  const session = await loadSession(c.env, c.req.header('Cookie') ?? null);
  if (!session) {
    return c.redirect(`${c.env.APP_ORIGIN.replace(/\/$/, '')}/login?next=/upload`);
  }
  const callback = `${c.env.APP_ORIGIN.replace(/\/$/, '')}/api/v1/auth/garmin/callback`;

  const signed = await signOAuth1(consumer(c.env), 'POST', REQ_TOKEN_URL, {
    oauth_callback: callback,
  });
  const res = await fetch(signed.url, { method: 'POST', headers: signed.headers });
  if (!res.ok) {
    throw new HTTPException(502, { message: `Garmin request_token failed (${res.status})` });
  }
  const body = parseFormBody(await res.text());
  const token = body.oauth_token;
  const secret = body.oauth_token_secret;
  if (!token || !secret) throw new HTTPException(502, { message: 'malformed request_token' });

  await c.env.KV_SESSIONS.put(
    `garmin:reqtok:${token}`,
    JSON.stringify({ secret, userId: session.userId }),
    {
      expirationTtl: 600,
    },
  );

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('oauth_token', token);
  return c.redirect(url.toString());
});

garminRoutes.get('/auth/garmin/callback', async (c) => {
  const url = new URL(c.req.url);
  const oauthToken = url.searchParams.get('oauth_token');
  const verifier = url.searchParams.get('oauth_verifier');
  if (!oauthToken || !verifier) {
    throw new HTTPException(400, { message: 'missing oauth_token or oauth_verifier' });
  }

  const stash = await c.env.KV_SESSIONS.get(`garmin:reqtok:${oauthToken}`, 'json' as const);
  if (!stash) throw new HTTPException(400, { message: 'unknown request token' });
  const { secret, userId } = stash as { secret: string; userId: string };

  const cons = consumer(c.env);
  const signed = await signOAuth1(
    { ...cons, token: oauthToken, tokenSecret: secret },
    'POST',
    ACCESS_TOKEN_URL,
    { oauth_verifier: verifier },
  );
  const res = await fetch(signed.url, { method: 'POST', headers: signed.headers });
  if (!res.ok) {
    throw new HTTPException(502, { message: `Garmin access_token failed (${res.status})` });
  }
  const body = parseFormBody(await res.text());
  const accessToken = body.oauth_token;
  const accessSecret = body.oauth_token_secret;
  const garminUserId = body.user_id ?? body.userId ?? oauthToken;
  if (!accessToken || !accessSecret) {
    throw new HTTPException(502, { message: 'malformed access_token response' });
  }

  await c.env.DB.prepare(
    `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
     VALUES ('garmin', ?, ?, ?, ?, 0, 'wellness:read')
     ON CONFLICT(provider, external_id) DO UPDATE
       SET user_id = excluded.user_id,
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token`,
  )
    .bind(String(garminUserId), userId, accessToken, accessSecret)
    .run();

  await c.env.KV_SESSIONS.delete(`garmin:reqtok:${oauthToken}`);
  return c.redirect('/settings');
});

interface GarminActivityPush {
  userId: string;
  userAccessToken?: string;
  summaryId: string;
  activityId?: number;
  activityFileType?: 'FIT' | 'TCX' | 'GPX';
  callbackURL: string;
  startTimeInSeconds?: number;
}

interface GarminWebhookBody {
  activityFiles?: GarminActivityPush[];
  activities?: GarminActivityPush[];
}

// ------------------------- Backfill --------------------------
//
// Garmin Wellness API exposes paginated activity summaries via 24h
// upload-time windows. Each summary item carries a `callbackURL`
// pointing to the raw FIT. We slide a 24h window backwards starting
// at the upload-time of the last seen activity, stash callbacks, and
// pull the FITs as budget allows.
//
// Rate limits (Garmin docs): roughly 5 req/sec per partner. We stay
// well under by capping per-tick fetches.

const GARMIN_RATE_WINDOW_SEC = 60;
const GARMIN_RATE_WINDOW_MAX = 200; // generous; partner-keyed
const GARMIN_TICK_BATCH = 10;
const GARMIN_WINDOW_SEC = 24 * 60 * 60; // 24h slice per list call
const GARMIN_SUMMARY_URL = 'https://apis.garmin.com/wellness-api/rest/activitySummary';

garminRoutes.post('/me/import/garmin', requireSession(), async (c) => {
  const session = c.get('session');
  const ident = await c.env.DB.prepare(
    `SELECT external_id AS externalId, access_token AS accessToken, refresh_token AS tokenSecret
       FROM oauth_identities WHERE provider = 'garmin' AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(session.userId)
    .first<{ externalId: string; accessToken: string; tokenSecret: string }>();
  if (!ident) throw new HTTPException(400, { message: 'connect Garmin first' });

  const url = new URL(c.req.url);
  const scope = url.searchParams.get('scope') ?? 'all';
  const sinceParam = url.searchParams.get('since');
  const stopAt = sinceParam
    ? Math.floor(Date.parse(sinceParam) / 1000)
    : scope === 'all'
      ? 0
      : Math.floor(Date.now() / 1000) - 90 * 86_400;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM import_jobs
      WHERE athlete_id = ? AND provider = 'garmin' AND status = 'running'`,
  )
    .bind(session.userId)
    .first<{ id: string }>();
  let jobId = existing?.id;
  if (!jobId) {
    jobId = uuidv7();
    await c.env.DB.prepare(
      `INSERT INTO import_jobs (id, athlete_id, provider, scope, status, cursor, stop_at)
       VALUES (?, ?, 'garmin', ?, 'running', ?, ?)`,
    )
      .bind(jobId, session.userId, scope, Math.floor(Date.now() / 1000), stopAt)
      .run();
  }
  await garminTickOnce(c.env, jobId);
  const row = await c.env.DB.prepare(
    `SELECT id, provider, scope, status, cursor, stop_at AS stopAt,
            total_seen AS totalSeen, succeeded, duplicates, failed,
            last_error AS lastError, updated_at AS updatedAt, created_at AS createdAt
       FROM import_jobs WHERE id = ? AND athlete_id = ?`,
  )
    .bind(jobId, session.userId)
    .first();
  return c.json(row);
});

interface GarminImportJobRow {
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
}

interface GarminSummaryItem {
  summaryId: string;
  activityFileType?: 'FIT' | 'TCX' | 'GPX';
  callbackURL?: string;
  fileURL?: string;
  startTimeInSeconds?: number;
  uploadStartTimeInSeconds?: number;
}

export async function garminTickOnce(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT id, athlete_id, provider, status, cursor, stop_at,
            total_seen, succeeded, duplicates, failed,
            rate_window_started_at, rate_window_used
       FROM import_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<GarminImportJobRow>();
  if (!job || job.status !== 'running' || job.provider !== 'garmin') return;

  const ident = await env.DB.prepare(
    `SELECT external_id AS externalId, access_token AS accessToken, refresh_token AS tokenSecret
       FROM oauth_identities WHERE provider = 'garmin' AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(job.athlete_id)
    .first<{ externalId: string; accessToken: string; tokenSecret: string }>();
  if (!ident) {
    await markGarminError(env, job.id, 'identity unavailable');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let rateStart = job.rate_window_started_at;
  let rateUsed = job.rate_window_used;
  if (now - rateStart > GARMIN_RATE_WINDOW_SEC) {
    rateStart = now;
    rateUsed = 0;
  }
  if (rateUsed >= GARMIN_RATE_WINDOW_MAX) return;

  const windowEnd = job.cursor ?? now;
  const windowStart = Math.max(job.stop_at ?? 0, windowEnd - GARMIN_WINDOW_SEC);

  const listUrl = new URL(GARMIN_SUMMARY_URL);
  listUrl.searchParams.set('uploadStartTimeInSeconds', String(windowStart));
  listUrl.searchParams.set('uploadEndTimeInSeconds', String(windowEnd));

  const listSigned = await signOAuth1(
    {
      consumerKey: env.GARMIN_CONSUMER_KEY!,
      consumerSecret: env.GARMIN_CONSUMER_SECRET!,
      token: ident.accessToken,
      tokenSecret: ident.tokenSecret,
    },
    'GET',
    listUrl.toString(),
  );
  const listRes = await fetch(listSigned.url, { headers: listSigned.headers });
  rateUsed++;
  if (!listRes.ok) {
    await markGarminError(env, job.id, `list HTTP ${listRes.status}`);
    return;
  }
  const items = ((await listRes.json()) as GarminSummaryItem[]) ?? [];

  let succeeded = job.succeeded;
  let duplicates = job.duplicates;
  let failed = job.failed;
  let processed = 0;

  for (const it of items) {
    if (processed >= GARMIN_TICK_BATCH) break;
    if (rateUsed >= GARMIN_RATE_WINDOW_MAX) break;
    const externalId = String(it.summaryId);
    const dupe = await env.DB.prepare(
      `SELECT id FROM activities WHERE external_source = 'garmin' AND external_id = ?`,
    )
      .bind(externalId)
      .first<{ id: string }>();
    if (dupe) {
      duplicates++;
      continue;
    }
    const fileUrl = it.callbackURL ?? it.fileURL;
    if (!fileUrl) {
      failed++;
      continue;
    }
    const fileSigned = await signOAuth1(
      {
        consumerKey: env.GARMIN_CONSUMER_KEY!,
        consumerSecret: env.GARMIN_CONSUMER_SECRET!,
        token: ident.accessToken,
        tokenSecret: ident.tokenSecret,
      },
      'GET',
      fileUrl,
    );
    const fileRes = await fetch(fileSigned.url, { headers: fileSigned.headers });
    rateUsed++;
    if (!fileRes.ok) {
      failed++;
      continue;
    }
    const buf = await fileRes.arrayBuffer();
    const ext = (it.activityFileType ?? 'FIT').toLowerCase();
    const source: IngestJob['source'] = ext === 'tcx' ? 'tcx' : ext === 'gpx' ? 'gpx' : 'fit';
    const activityId = uuidv7();
    const ts = it.startTimeInSeconds ? new Date(it.startTimeInSeconds * 1000) : new Date();
    const yyyy = ts.getUTCFullYear();
    const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
    const rawPath = `raw/${job.athlete_id}/${yyyy}/${mm}/${activityId}.${source}`;
    await env.RAW_BUCKET.put(rawPath, buf, {
      httpMetadata: {
        contentType:
          source === 'fit'
            ? 'application/vnd.fit'
            : source === 'tcx'
              ? 'application/tcx+xml'
              : 'application/gpx+xml',
      },
      customMetadata: {
        athleteId: job.athlete_id,
        activityId,
        source: 'garmin-import',
        garminSummaryId: externalId,
      },
    });
    await env.INGEST_QUEUE.send({
      activityId,
      athleteId: job.athlete_id,
      rawR2Path: rawPath,
      source,
      externalSource: 'garmin',
      externalId,
    });
    succeeded++;
    processed++;
  }

  const totalSeen = job.total_seen + items.length;
  const nextCursor = windowStart - 1;
  const reachedFloor = (job.stop_at ?? 0) >= windowStart;
  const reachedEnd = items.length === 0 && reachedFloor;
  const status: GarminImportJobRow['status'] = reachedEnd ? 'done' : 'running';

  await env.DB.prepare(
    `UPDATE import_jobs
        SET cursor = ?, total_seen = ?, succeeded = ?, duplicates = ?, failed = ?,
            rate_window_started_at = ?, rate_window_used = ?,
            status = ?, last_error = NULL, updated_at = unixepoch()
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
      status,
      job.id,
    )
    .run();

  if (status === 'done') {
    await sendImportDoneEmail(env, job.athlete_id, 'garmin', succeeded, duplicates, failed).catch(
      () => {},
    );
  }
}

async function markGarminError(env: Env, jobId: string, message: string) {
  await env.DB.prepare(
    `UPDATE import_jobs
        SET status = 'error', last_error = ?, updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(message, jobId)
    .run();
}

// ------------------------- Webhook --------------------------

garminRoutes.post('/webhooks/garmin/activities', async (c) => {
  const payload = (await c.req.json()) as GarminWebhookBody;
  const items = [...(payload.activityFiles ?? []), ...(payload.activities ?? [])];
  let queued = 0;
  for (const it of items) {
    const ident = await c.env.DB.prepare(
      `SELECT user_id AS userId, access_token AS accessToken, refresh_token AS tokenSecret
         FROM oauth_identities WHERE provider = 'garmin' AND external_id = ?`,
    )
      .bind(String(it.userId))
      .first<{ userId: string; accessToken: string; tokenSecret: string }>();
    if (!ident) continue;

    const signed = await signOAuth1(
      {
        consumerKey: c.env.GARMIN_CONSUMER_KEY!,
        consumerSecret: c.env.GARMIN_CONSUMER_SECRET!,
        token: ident.accessToken,
        tokenSecret: ident.tokenSecret,
      },
      'GET',
      it.callbackURL,
    );
    const fileRes = await fetch(signed.url, { headers: signed.headers });
    if (!fileRes.ok) continue;
    const buf = await fileRes.arrayBuffer();

    const ext = (it.activityFileType ?? 'FIT').toLowerCase();
    const source: IngestJob['source'] = ext === 'tcx' ? 'tcx' : ext === 'gpx' ? 'gpx' : 'fit';
    const activityId = uuidv7();
    const ts = it.startTimeInSeconds ? new Date(it.startTimeInSeconds * 1000) : new Date();
    const yyyy = ts.getUTCFullYear();
    const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
    const rawPath = `raw/${ident.userId}/${yyyy}/${mm}/${activityId}.${source}`;
    await c.env.RAW_BUCKET.put(rawPath, buf, {
      httpMetadata: {
        contentType:
          source === 'fit'
            ? 'application/vnd.fit'
            : source === 'tcx'
              ? 'application/tcx+xml'
              : 'application/gpx+xml',
      },
      customMetadata: {
        athleteId: ident.userId,
        activityId,
        source: 'garmin-webhook',
        garminSummaryId: String(it.summaryId),
      },
    });
    const job: IngestJob = {
      activityId,
      athleteId: ident.userId,
      rawR2Path: rawPath,
      source,
      externalSource: 'garmin',
      externalId: String(it.summaryId),
    };
    await c.env.INGEST_QUEUE.send(job);
    queued++;
  }
  return c.json({ ok: true, queued });
});

// ------------------------- Wellness webhooks --------------------------
//
// Garmin's Health/Wellness API pushes daily summaries, sleep, body comp,
// HRV, etc. Each push wraps an array under a typed key. We resolve the
// athlete via oauth_identities → user_id, then upsert into
// wellness_daily / body_composition.
//
// Each route is best-effort idempotent on (athlete_id, date, source) or
// (athlete_id, measured_at) — a re-push of the same day overwrites.

interface GarminDailySummary {
  userId: string;
  calendarDate: string; // YYYY-MM-DD
  steps?: number;
  activeKilocalories?: number;
  bmrKilocalories?: number;
  averageStressLevel?: number;
  restingHeartRateInBeatsPerMinute?: number;
  bodyBatteryChargedValue?: number;
  bodyBatteryDrainedValue?: number;
}
interface GarminSleepSummary {
  userId: string;
  calendarDate: string;
  durationInSeconds?: number;
  deepSleepDurationInSeconds?: number;
  lightSleepDurationInSeconds?: number;
  remSleepInSeconds?: number;
  awakeDurationInSeconds?: number;
  overallSleepScore?: { value?: number };
  hrvSummary?: { lastNightAvg?: number };
}
interface GarminBodyComp {
  userId: string;
  measurementTimeInSeconds: number;
  weightInGrams?: number;
  bodyFatInPercent?: number;
  bodyWaterInPercent?: number;
  muscleMassInGrams?: number;
  boneMassInGrams?: number;
  visceralFatRating?: number;
}
interface GarminUserMetrics {
  userId: string;
  calendarDate: string;
  vo2Max?: number;
}

async function resolveAthleteId(env: Env, garminUserId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT user_id AS userId FROM oauth_identities
      WHERE provider = 'garmin' AND external_id = ?`,
  )
    .bind(garminUserId)
    .first<{ userId: string }>();
  return row?.userId ?? null;
}

async function upsertWellnessDaily(
  env: Env,
  athleteId: string,
  date: string,
  patch: Record<string, number | null>,
  rawPayload: unknown,
): Promise<void> {
  // SQLite-friendly upsert: pull existing row (if any) and merge.
  const existing = await env.DB.prepare(
    `SELECT id FROM wellness_daily WHERE athlete_id = ? AND date = ? AND source = 'garmin'`,
  )
    .bind(athleteId, date)
    .first<{ id: string }>();

  const cols = Object.keys(patch);
  if (cols.length === 0) return;

  if (existing) {
    const sets = cols.map((c) => `${c} = COALESCE(?, ${c})`).join(', ');
    await env.DB.prepare(
      `UPDATE wellness_daily SET ${sets}, updated_at = unixepoch(), raw_payload = ?
       WHERE id = ?`,
    )
      .bind(...cols.map((c) => patch[c] ?? null), JSON.stringify(rawPayload), existing.id)
      .run();
    return;
  }
  const id = uuidv7();
  await env.DB.prepare(
    `INSERT INTO wellness_daily (id, athlete_id, date, source, ${cols.join(', ')}, raw_payload)
     VALUES (?, ?, ?, 'garmin', ${cols.map(() => '?').join(', ')}, ?)`,
  )
    .bind(
      id,
      athleteId,
      date,
      ...cols.map((c) => patch[c] ?? null),
      JSON.stringify(rawPayload),
    )
    .run();
}

garminRoutes.post('/webhooks/garmin/dailies', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { dailies?: GarminDailySummary[] };
  let processed = 0;
  for (const d of body.dailies ?? []) {
    const athleteId = await resolveAthleteId(c.env, String(d.userId));
    if (!athleteId) continue;
    await upsertWellnessDaily(
      c.env,
      athleteId,
      d.calendarDate,
      {
        steps: d.steps ?? null,
        calories_active: d.activeKilocalories ?? null,
        calories_total:
          d.activeKilocalories != null && d.bmrKilocalories != null
            ? d.activeKilocalories + d.bmrKilocalories
            : null,
        rhr: d.restingHeartRateInBeatsPerMinute ?? null,
        body_battery: d.bodyBatteryChargedValue ?? null,
        stress_avg: d.averageStressLevel ?? null,
      },
      d,
    );
    processed++;
  }
  return c.json({ ok: true, processed });
});

garminRoutes.post('/webhooks/garmin/sleeps', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { sleeps?: GarminSleepSummary[] };
  let processed = 0;
  for (const s of body.sleeps ?? []) {
    const athleteId = await resolveAthleteId(c.env, String(s.userId));
    if (!athleteId) continue;
    await upsertWellnessDaily(
      c.env,
      athleteId,
      s.calendarDate,
      {
        sleep_seconds: s.durationInSeconds ?? null,
        deep_seconds: s.deepSleepDurationInSeconds ?? null,
        light_seconds: s.lightSleepDurationInSeconds ?? null,
        rem_seconds: s.remSleepInSeconds ?? null,
        awake_seconds: s.awakeDurationInSeconds ?? null,
        sleep_score: s.overallSleepScore?.value ?? null,
        hrv_overnight: s.hrvSummary?.lastNightAvg ?? null,
      },
      s,
    );
    processed++;
  }
  return c.json({ ok: true, processed });
});

garminRoutes.post('/webhooks/garmin/body-comp', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    bodyComps?: GarminBodyComp[];
  };
  let processed = 0;
  for (const b of body.bodyComps ?? []) {
    const athleteId = await resolveAthleteId(c.env, String(b.userId));
    if (!athleteId) continue;
    const weightKg = b.weightInGrams != null ? b.weightInGrams / 1000 : null;
    const muscleKg = b.muscleMassInGrams != null ? b.muscleMassInGrams / 1000 : null;
    const boneKg = b.boneMassInGrams != null ? b.boneMassInGrams / 1000 : null;
    await c.env.DB.prepare(
      `INSERT INTO body_composition (id, athlete_id, measured_at, source,
         weight_kg, body_fat_pct, muscle_mass_kg, bone_mass_kg,
         body_water_pct, visceral_fat, raw_payload)
       VALUES (?, ?, ?, 'garmin', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuidv7(),
        athleteId,
        b.measurementTimeInSeconds,
        weightKg,
        b.bodyFatInPercent ?? null,
        muscleKg,
        boneKg,
        b.bodyWaterInPercent ?? null,
        b.visceralFatRating ?? null,
        JSON.stringify(b),
      )
      .run();
    if (weightKg != null) {
      const date = new Date(b.measurementTimeInSeconds * 1000).toISOString().slice(0, 10);
      await upsertWellnessDaily(
        c.env,
        athleteId,
        date,
        {
          weight_kg: weightKg,
          body_fat_pct: b.bodyFatInPercent ?? null,
        },
        b,
      );
    }
    processed++;
  }
  return c.json({ ok: true, processed });
});

garminRoutes.post('/webhooks/garmin/user-metrics', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userMetrics?: GarminUserMetrics[] };
  let processed = 0;
  for (const m of body.userMetrics ?? []) {
    const athleteId = await resolveAthleteId(c.env, String(m.userId));
    if (!athleteId) continue;
    await upsertWellnessDaily(
      c.env,
      athleteId,
      m.calendarDate,
      { vo2max: m.vo2Max ?? null },
      m,
    );
    processed++;
  }
  return c.json({ ok: true, processed });
});

// Wellness query for the calendar / dashboard.
garminRoutes.get('/me/wellness', requireSession(), async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    throw new HTTPException(400, { message: 'from and to required' });
  }
  const rows = await c.env.DB.prepare(
    `SELECT date, source, sleep_seconds AS sleepSeconds, sleep_score AS sleepScore,
            deep_seconds AS deepSeconds, light_seconds AS lightSeconds,
            rem_seconds AS remSeconds, awake_seconds AS awakeSeconds,
            rhr, hrv_overnight AS hrv, steps,
            calories_active AS caloriesActive, calories_total AS caloriesTotal,
            body_battery AS bodyBattery, stress_avg AS stressAvg,
            weight_kg AS weightKg, body_fat_pct AS bodyFatPct, vo2max
       FROM wellness_daily
      WHERE athlete_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC`,
  )
    .bind(session.userId, from, to)
    .all();
  return c.json({ items: rows.results ?? [] });
});
