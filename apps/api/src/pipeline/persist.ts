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

  await env.DB.prepare(
    `INSERT INTO activities (
      id, athlete_id, source, sport,
      started_at, total_seconds,
      distance_m, ascent_m, descent_m,
      hr_avg, hr_max, power_avg, power_max,
      np, intensity_factor, tss, kj,
      speed_avg_ms, speed_max_ms,
      raw_r2_path, parsed_r2_path, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
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
