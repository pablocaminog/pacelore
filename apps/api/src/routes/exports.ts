/**
 * User data export.
 *
 *   POST /api/v1/me/export       — schedules a full data dump
 *   GET  /api/v1/me/export       — list past exports
 *
 * Build runs synchronously here (small accounts). For very large
 * accounts a Queue-backed background job is straightforward to bolt on.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const exportRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
exportRoutes.use('*', requireSession());

exportRoutes.post('/me/export', async (c) => {
  const session = c.get('session');
  const userRow = await c.env.DB.prepare(
    `SELECT id, handle, email, display_name AS displayName, bio, location, units_pref AS unitsPref,
            ftp, hr_max AS hrMax, hr_rest AS hrRest, threshold_pace_ms_x100 AS thresholdPaceMsX100,
            sex, created_at AS createdAt
       FROM users WHERE id = ?`,
  )
    .bind(session.userId)
    .first();
  const activities = await c.env.DB.prepare('SELECT * FROM activities WHERE athlete_id = ?')
    .bind(session.userId)
    .all();
  const metricsRows = await c.env.DB.prepare(
    `SELECT m.* FROM activity_metrics m JOIN activities a ON a.id = m.activity_id WHERE a.athlete_id = ?`,
  )
    .bind(session.userId)
    .all();
  const follows = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_id = ? OR followee_id = ?',
  )
    .bind(session.userId, session.userId)
    .all();
  const segments = await c.env.DB.prepare('SELECT * FROM segments WHERE created_by = ?')
    .bind(session.userId)
    .all();

  const exportId = uuidv7();
  const payload = {
    schemaVersion: 1,
    exportedAt: Math.floor(Date.now() / 1000),
    user: userRow,
    activities: activities.results ?? [],
    activityMetrics: metricsRows.results ?? [],
    follows: follows.results ?? [],
    segments: segments.results ?? [],
  };
  const key = `exports/${session.userId}/${exportId}.json`;
  await c.env.EXPORTS_BUCKET.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { athleteId: session.userId, exportId },
  });
  return c.json({
    id: exportId,
    r2Path: key,
    activities: payload.activities.length,
    schemaVersion: 1,
  });
});
