/**
 * Write a parsed + metric'd activity to D1 and R2.
 *
 * Idempotent on activity_id — if the row already exists we leave it
 * alone (queue may redeliver). The parsed JSON in R2 is overwritten on
 * retry, which is fine since it's a deterministic function of the input.
 */

import type { ActivityRecord } from '@pacelore/fit-parser';
import { findSegmentEfforts, type ActivityPoint, type Segment } from '@pacelore/segments';
import type { Env, IngestJob } from '../env.js';
import type { ActivitySummary, MetricKv } from './metrics.js';
import { uuidv7 } from '../util/uuid.js';
import { uploadToArweave } from '../integrations/arweave.js';
import { atprotoCreateRecord } from '../integrations/atproto.js';

export interface PersistInput {
  job: IngestJob;
  activity: ActivityRecord;
  summary: ActivitySummary;
  metrics: MetricKv[];
}

export async function persistActivity(env: Env, input: PersistInput): Promise<void> {
  const { job, activity, summary, metrics } = input;

  // Existence check — first time wins.
  const existing = await env.DB.prepare('SELECT id FROM activities WHERE id = ?')
    .bind(job.activityId)
    .first<{ id: string }>();
  if (existing) return;

  const parsedKey = `parsed/${job.athleteId}/${job.activityId}.json`;
  await env.PARSED_BUCKET.put(parsedKey, JSON.stringify(activity), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      athleteId: job.athleteId,
      activityId: job.activityId,
      source: job.source,
    },
  });

  const startedAt = Math.floor(activity.session.startedAt.getTime() / 1000);

  // Pre-flight dedup against the partial unique index. A bare
  // `ON CONFLICT(...) DO NOTHING` against a partial index in SQLite
  // requires the WHERE clause to be repeated and is fragile across
  // D1 versions; an explicit existence check is simpler and avoids
  // the error path entirely.
  if (job.externalSource && job.externalId) {
    const dupe = await env.DB.prepare(
      `SELECT id FROM activities WHERE external_source = ? AND external_id = ?`,
    )
      .bind(job.externalSource, job.externalId)
      .first<{ id: string }>();
    if (dupe) return;
  }

  await env.DB.prepare(
    `INSERT INTO activities (
      id, athlete_id, source, sport,
      started_at, total_seconds,
      distance_m, ascent_m, descent_m,
      hr_avg, hr_max, power_avg, power_max,
      np, intensity_factor, tss, kj,
      speed_avg_ms, speed_max_ms,
      raw_r2_path, parsed_r2_path, visibility,
      external_source, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
  )
    .bind(
      job.activityId,
      job.athleteId,
      job.source,
      activity.session.sport,
      startedAt,
      summary.totalSeconds,
      summary.distanceM,
      activity.session.totalAscent ?? null,
      activity.session.totalDescent ?? null,
      summary.hrAvg,
      summary.hrMax,
      summary.powerAvg,
      summary.powerMax,
      summary.np,
      summary.intensityFactor,
      summary.tss,
      summary.kj,
      summary.speedAvgMs,
      summary.speedMaxMs,
      job.rawR2Path,
      parsedKey,
      job.externalSource ?? null,
      job.externalId ?? null,
    )
    .run();

  if (metrics.length > 0) {
    const stmts = metrics.map((m) =>
      env.DB.prepare(
        'INSERT INTO activity_metrics (activity_id, key, value) VALUES (?, ?, ?)',
      ).bind(job.activityId, m.key, m.value),
    );
    await env.DB.batch(stmts);
  }

  // Segment effort detection — bbox prefilter against the activity's
  // bbox via SQL, then DTW match in-process.
  await detectSegmentEfforts(env, job, activity);
  await detectPersonalRecords(env, job, activity, metrics).catch((e) =>
    console.error('PR detect fail', e),
  );
  await matchPlannedWorkout(env, job, activity, summary).catch((e) =>
    console.error('plan match fail', e),
  );
  await mirrorToArweave(env, job, summary).catch((e) => console.error('arweave fail', e));
  await mirrorToAtproto(env, job, activity, summary).catch((e) => console.error('atproto fail', e));

  // PMC: bump pmc_daily.tss for the activity's date. CTL/ATL/TSB are
  // recomputed by a periodic cron (T per architecture doc) — keeping
  // the hot path cheap.
  if (typeof summary.tss === 'number' && Number.isFinite(summary.tss)) {
    const date = new Date(activity.session.startedAt);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    await env.DB.prepare(
      `INSERT INTO pmc_daily (athlete_id, date, tss)
       VALUES (?, ?, ?)
       ON CONFLICT (athlete_id, date) DO UPDATE SET tss = pmc_daily.tss + excluded.tss`,
    )
      .bind(job.athleteId, dateStr, summary.tss)
      .run();
  }
}

async function detectSegmentEfforts(
  env: Env,
  job: IngestJob,
  activity: ActivityRecord,
): Promise<void> {
  const points: ActivityPoint[] = [];
  for (const s of activity.samples) {
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      points.push({ t: s.t, lat: s.lat, lng: s.lng });
    }
  }
  if (points.length < 10) return;

  let minLat = points[0]!.lat;
  let maxLat = minLat;
  let minLng = points[0]!.lng;
  let maxLng = minLng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const sport = activity.session.sport;
  const candidates = await env.DB.prepare(
    `SELECT id, polyline FROM segments
       WHERE sport = ?
         AND bbox_min_lat <= ? AND bbox_max_lat >= ?
         AND bbox_min_lng <= ? AND bbox_max_lng >= ?
       LIMIT 100`,
  )
    .bind(sport, maxLat, minLat, maxLng, minLng)
    .all<{ id: string; polyline: string }>();

  const segs: Segment[] = (candidates.results ?? []).map((row) => ({
    id: row.id,
    polyline: (JSON.parse(row.polyline) as [number, number][]).map((p) => ({
      lat: p[0],
      lng: p[1],
    })),
  }));
  if (segs.length === 0) return;

  const efforts = findSegmentEfforts(points, segs);
  for (const e of efforts) {
    const effortId = uuidv7();
    const startedAt =
      Math.floor(activity.session.startedAt.getTime() / 1000) + Math.floor(e.startSeconds);
    const time = Math.max(1, Math.floor(e.endSeconds - e.startSeconds));
    await env.DB.prepare(
      `INSERT INTO segment_efforts
         (id, segment_id, athlete_id, activity_id, time_seconds, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(effortId, e.segmentId, job.athleteId, job.activityId, time, startedAt)
      .run();
  }
}

interface PrefRow {
  arweave: number;
  atDid: string | null;
  atPds: string | null;
  atJwt: string | null;
}

async function loadPrefs(env: Env, userId: string): Promise<PrefRow | null> {
  return env.DB.prepare(
    `SELECT arweave_permanence AS arweave, atproto_did AS atDid,
            atproto_pds AS atPds, atproto_access_jwt AS atJwt
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<PrefRow>();
}

async function mirrorToArweave(env: Env, job: IngestJob, _summary: ActivitySummary): Promise<void> {
  if (!env.ARWEAVE_TURBO_TOKEN) return;
  const prefs = await loadPrefs(env, job.athleteId);
  if (!prefs?.arweave) return;
  const obj = await env.RAW_BUCKET.get(job.rawR2Path);
  if (!obj) return;
  const buf = (await obj.arrayBuffer()) as ArrayBuffer;
  const result = await uploadToArweave(env.ARWEAVE_TURBO_TOKEN, buf, {
    'Content-Type': contentTypeFor(job.source),
    'App-Name': 'pacelore',
    'Activity-Id': job.activityId,
    'Athlete-Id': job.athleteId,
    Source: job.source,
  });
  await env.DB.prepare('UPDATE activities SET arweave_tx = ? WHERE id = ?')
    .bind(result.id, job.activityId)
    .run();
}

async function mirrorToAtproto(
  env: Env,
  job: IngestJob,
  activity: ActivityRecord,
  summary: ActivitySummary,
): Promise<void> {
  const prefs = await loadPrefs(env, job.athleteId);
  if (!prefs?.atDid || !prefs.atPds || !prefs.atJwt) return;
  const record = {
    $type: 'com.pacelore.activity',
    activityId: job.activityId,
    sport: activity.session.sport,
    startedAt: activity.session.startedAt.toISOString(),
    durationSeconds: summary.totalSeconds,
    distanceMeters: summary.distanceM,
    tss: summary.tss,
    np: summary.np,
    source: job.source,
    createdAt: new Date().toISOString(),
  };
  const out = await atprotoCreateRecord(
    prefs.atPds,
    prefs.atJwt,
    prefs.atDid,
    'com.pacelore.activity',
    record,
  );
  await env.DB.prepare('UPDATE activities SET atproto_uri = ? WHERE id = ?')
    .bind(out.uri, job.activityId)
    .run();
}

// Personal records: peak power durations + run/swim distance bests.
const POWER_PR_KEYS: Array<{ duration: number; key: string }> = [
  { duration: 5, key: 'power:5s' },
  { duration: 60, key: 'power:60s' },
  { duration: 300, key: 'power:300s' },
  { duration: 1200, key: 'power:1200s' },
  { duration: 3600, key: 'power:3600s' },
];
const DISTANCE_PR_TARGETS = [1000, 5000, 10_000, 21_097, 42_195];

async function detectPersonalRecords(
  env: Env,
  job: IngestJob,
  activity: ActivityRecord,
  metrics: MetricKv[],
): Promise<void> {
  const sport = activity.session.sport;
  const achievedAt = Math.floor(activity.session.startedAt.getTime() / 1000);
  const candidates: { key: string; value: number; better: 'gt' | 'lt' }[] = [];

  for (const { duration, key } of POWER_PR_KEYS) {
    const m = metrics.find((x) => x.key === `power.peak.${duration}`);
    if (m && Number.isFinite(m.value) && m.value > 0) {
      candidates.push({ key, value: m.value, better: 'gt' });
    }
  }

  if (sport === 'running' || sport === 'walking') {
    const samples = activity.samples;
    for (const targetM of DISTANCE_PR_TARGETS) {
      const t = fastestDuration(samples, targetM);
      if (t != null) candidates.push({ key: `distance:${targetM}m`, value: t, better: 'lt' });
    }
  }

  for (const cand of candidates) {
    const cur = await env.DB.prepare(
      `SELECT value FROM personal_records WHERE athlete_id = ? AND sport = ? AND key = ?`,
    )
      .bind(job.athleteId, sport, cand.key)
      .first<{ value: number }>();
    const beats = !cur || (cand.better === 'gt' ? cand.value > cur.value : cand.value < cur.value);
    if (!beats) continue;
    await env.DB.prepare(
      `INSERT INTO personal_records (athlete_id, sport, key, value, activity_id, achieved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (athlete_id, sport, key) DO UPDATE
         SET value = excluded.value, activity_id = excluded.activity_id, achieved_at = excluded.achieved_at`,
    )
      .bind(job.athleteId, sport, cand.key, cand.value, job.activityId, achievedAt)
      .run();
  }
}

function fastestDuration(samples: ActivityRecord['samples'], targetMeters: number): number | null {
  // Sliding window: find min Δt such that cumulative distance ≥ targetMeters.
  const dists: number[] = [];
  const times: number[] = [];
  let cum = 0;
  let prev: { lat?: number; lng?: number } | null = null;
  for (const s of samples) {
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      if (prev && typeof prev.lat === 'number' && typeof prev.lng === 'number') {
        cum += haversine(prev.lat, prev.lng, s.lat, s.lng);
      }
      prev = { lat: s.lat, lng: s.lng };
    }
    dists.push(cum);
    times.push(s.t);
  }
  if (dists.length < 2 || cum < targetMeters) return null;

  let best = Infinity;
  let i = 0;
  for (let j = 0; j < dists.length; j++) {
    while (i < j && dists[j]! - dists[i]! >= targetMeters) {
      const dt = times[j]! - times[i]!;
      if (dt > 0 && dt < best) best = dt;
      i++;
    }
  }
  return Number.isFinite(best) ? best : null;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface PlannedRow {
  id: string;
  workout_id: string | null;
  steps_json: string | null;
  estimated_tss: number | null;
  estimated_duration_sec: number | null;
}

async function matchPlannedWorkout(
  env: Env,
  job: IngestJob,
  activity: ActivityRecord,
  summary: ActivitySummary,
): Promise<void> {
  const date = new Date(activity.session.startedAt);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const planned = await env.DB.prepare(
    `SELECT pw.id AS id, pw.workout_id AS workout_id,
            w.steps_json AS steps_json, w.estimated_tss AS estimated_tss,
            w.estimated_duration_sec AS estimated_duration_sec
       FROM planned_workouts pw
       LEFT JOIN workouts w ON w.id = pw.workout_id
      WHERE pw.athlete_id = ? AND pw.scheduled_date = ? AND pw.completed_activity_id IS NULL
      LIMIT 1`,
  )
    .bind(job.athleteId, dateStr)
    .first<PlannedRow>();
  if (!planned) return;

  let compliance: number | null = null;
  if (planned.estimated_duration_sec && summary.totalSeconds > 0) {
    const durRatio = Math.min(
      summary.totalSeconds / planned.estimated_duration_sec,
      planned.estimated_duration_sec / summary.totalSeconds,
    );
    let tssMatch = 1;
    if (planned.estimated_tss && typeof summary.tss === 'number' && summary.tss > 0) {
      tssMatch = Math.min(summary.tss / planned.estimated_tss, planned.estimated_tss / summary.tss);
    }
    compliance = Math.max(0, Math.min(1, 0.5 * durRatio + 0.5 * tssMatch));
  }

  await env.DB.prepare(
    `UPDATE planned_workouts SET completed_activity_id = ?, compliance_score = ? WHERE id = ?`,
  )
    .bind(job.activityId, compliance, planned.id)
    .run();
}

function contentTypeFor(source: 'fit' | 'tcx' | 'gpx'): string {
  switch (source) {
    case 'fit':
      return 'application/vnd.fit';
    case 'tcx':
      return 'application/tcx+xml';
    case 'gpx':
      return 'application/gpx+xml';
  }
}
