/**
 * Training endpoints: workouts, planned workouts, PRs, coach links.
 *
 *   GET    /api/v1/me/prs                    — personal records
 *   POST   /api/v1/workouts                  — create workout
 *   GET    /api/v1/workouts                  — list mine
 *   GET    /api/v1/workouts/:id              — fetch one
 *   PATCH  /api/v1/workouts/:id              — update
 *   DELETE /api/v1/workouts/:id              — delete
 *   GET    /api/v1/workouts/:id/export.fit   — Garmin FIT
 *   GET    /api/v1/workouts/:id/export.zwo   — Zwift workout
 *
 *   POST   /api/v1/me/calendar               — schedule workout
 *   GET    /api/v1/me/calendar?from&to       — list planned + completed
 *   DELETE /api/v1/me/calendar/:id           — remove planned slot
 *
 *   POST   /api/v1/me/coaches/invite         — invite an athlete (caller=coach)
 *   POST   /api/v1/me/coaches/:coachId/accept — athlete accepts
 *   DELETE /api/v1/me/coaches/:otherId       — revoke either side
 *   GET    /api/v1/me/athletes               — coach lists their athletes
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';
import { workoutToFit, workoutToZwo, type Workout } from '../integrations/workout-export.js';

export const trainingRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
trainingRoutes.use('*', requireSession());

// PRs ----------------------------------------------------------------
trainingRoutes.get('/me/prs', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT sport, key, value, activity_id AS activityId, achieved_at AS achievedAt
       FROM personal_records WHERE athlete_id = ?
      ORDER BY sport, key`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});

// Workouts -----------------------------------------------------------
const SPORTS = new Set(['cycling', 'running', 'swimming', 'other']);

interface WorkoutBody {
  name?: string;
  description?: string;
  sport?: string;
  steps?: Workout['steps'];
}

trainingRoutes.post('/workouts', async (c) => {
  const body = (await c.req.json()) as WorkoutBody;
  const session = c.get('session');
  if (!body.name || !body.sport || !SPORTS.has(body.sport)) {
    throw new HTTPException(400, { message: 'name + sport required' });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    throw new HTTPException(400, { message: 'steps required' });
  }
  const id = uuidv7();
  const stepsJson = JSON.stringify({ steps: body.steps });
  const { tss, duration } = estimateLoad(body.steps);
  await c.env.DB.prepare(
    `INSERT INTO workouts (id, athlete_id, name, description, sport, estimated_tss, estimated_duration_sec, steps_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.userId,
      body.name,
      body.description ?? null,
      body.sport,
      tss,
      duration,
      stepsJson,
    )
    .run();
  return c.json({ id, estimatedTss: tss, estimatedDurationSec: duration }, 201);
});

trainingRoutes.get('/workouts', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, name, sport, estimated_tss AS estimatedTss,
            estimated_duration_sec AS estimatedDurationSec, created_at AS createdAt
       FROM workouts WHERE athlete_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});

trainingRoutes.get('/workouts/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await loadWorkout(c.env, id, session.userId);
  if (!row) throw new HTTPException(404, { message: 'workout not found' });
  return c.json(row);
});

trainingRoutes.patch('/workouts/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const body = (await c.req.json()) as WorkoutBody;
  const existing = await loadWorkout(c.env, id, session.userId);
  if (!existing) throw new HTTPException(404, { message: 'workout not found' });
  const steps = body.steps ?? existing.steps;
  const stepsJson = JSON.stringify({ steps });
  const { tss, duration } = estimateLoad(steps);
  await c.env.DB.prepare(
    `UPDATE workouts SET name = ?, description = ?, sport = ?,
                          steps_json = ?, estimated_tss = ?,
                          estimated_duration_sec = ?, updated_at = unixepoch()
       WHERE id = ? AND athlete_id = ?`,
  )
    .bind(
      body.name ?? existing.name,
      body.description ?? existing.description,
      body.sport ?? existing.sport,
      stepsJson,
      tss,
      duration,
      id,
      session.userId,
    )
    .run();
  return c.json({ ok: true });
});

trainingRoutes.delete('/workouts/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare(`DELETE FROM workouts WHERE id = ? AND athlete_id = ?`)
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

trainingRoutes.get('/workouts/:id/export.fit', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const w = await loadWorkout(c.env, id, session.userId);
  if (!w) throw new HTTPException(404, { message: 'workout not found' });
  const buf = workoutToFit(w);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.fit',
      'Content-Disposition': `attachment; filename="${safeName(w.name)}.fit"`,
    },
  });
});

trainingRoutes.get('/workouts/:id/export.zwo', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const w = await loadWorkout(c.env, id, session.userId);
  if (!w) throw new HTTPException(404, { message: 'workout not found' });
  const xml = workoutToZwo(w);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${safeName(w.name)}.zwo"`,
    },
  });
});

// Calendar -----------------------------------------------------------
interface ScheduleBody {
  workoutId?: string | null;
  scheduledDate?: string;
  notes?: string;
  athleteId?: string;
}

/**
 * Calendar activities — for the TrainingPeaks-style grid view.
 * Returns every activity that started inside [from, to], plus the
 * source columns the UI uses to label per-card.
 *
 *   GET /api/v1/me/calendar/activities?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
trainingRoutes.get('/me/calendar/activities', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    throw new HTTPException(400, { message: 'from and to required (YYYY-MM-DD)' });
  }
  const fromEpoch = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const toEpoch = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  if (!Number.isFinite(fromEpoch) || !Number.isFinite(toEpoch)) {
    throw new HTTPException(400, { message: 'invalid from/to' });
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
            distance_m AS distanceM, ascent_m AS ascentM,
            hr_avg AS hrAvg, hr_max AS hrMax,
            power_avg AS powerAvg, power_max AS powerMax,
            np, intensity_factor AS intensityFactor, tss, kj,
            speed_avg_ms AS speedAvgMs,
            source, external_source AS externalSource, external_id AS externalId
       FROM activities
      WHERE athlete_id = ?
        AND started_at BETWEEN ? AND ?
      ORDER BY started_at ASC`,
  )
    .bind(session.userId, fromEpoch, toEpoch)
    .all();
  return c.json({ items: rows.results ?? [] });
});

trainingRoutes.post('/me/calendar', async (c) => {
  const body = (await c.req.json()) as ScheduleBody;
  const session = c.get('session');
  if (!body.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate)) {
    throw new HTTPException(400, { message: 'scheduledDate (YYYY-MM-DD) required' });
  }
  const targetAthlete = body.athleteId ?? session.userId;
  if (targetAthlete !== session.userId) {
    const ok = await isCoachOf(c.env, session.userId, targetAthlete);
    if (!ok) throw new HTTPException(403, { message: 'not your athlete' });
  }
  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO planned_workouts (id, athlete_id, workout_id, scheduled_date, notes, assigned_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      targetAthlete,
      body.workoutId ?? null,
      body.scheduledDate,
      body.notes ?? null,
      session.userId,
    )
    .run();
  return c.json({ id }, 201);
});

trainingRoutes.get('/me/calendar', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from') ?? '1970-01-01';
  const to = url.searchParams.get('to') ?? '9999-12-31';
  const athleteId = url.searchParams.get('athleteId') ?? session.userId;
  if (athleteId !== session.userId) {
    const ok = await isCoachOf(c.env, session.userId, athleteId);
    if (!ok) throw new HTTPException(403, { message: 'not your athlete' });
  }
  const rows = await c.env.DB.prepare(
    `SELECT pw.id, pw.scheduled_date AS scheduledDate, pw.notes,
            pw.workout_id AS workoutId, pw.completed_activity_id AS completedActivityId,
            pw.compliance_score AS complianceScore,
            w.name AS workoutName, w.sport AS sport,
            w.estimated_tss AS estimatedTss,
            w.estimated_duration_sec AS estimatedDurationSec
       FROM planned_workouts pw
       LEFT JOIN workouts w ON w.id = pw.workout_id
      WHERE pw.athlete_id = ?
        AND pw.scheduled_date BETWEEN ? AND ?
      ORDER BY pw.scheduled_date ASC`,
  )
    .bind(athleteId, from, to)
    .all();
  return c.json({ items: rows.results ?? [] });
});

trainingRoutes.delete('/me/calendar/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare(
    `DELETE FROM planned_workouts WHERE id = ? AND (athlete_id = ? OR assigned_by = ?)`,
  )
    .bind(id, session.userId, session.userId)
    .run();
  return c.json({ ok: true });
});

// Coach links --------------------------------------------------------
trainingRoutes.post('/me/coaches/invite', async (c) => {
  const session = c.get('session');
  const body = (await c.req.json()) as { athleteHandle?: string };
  if (!body.athleteHandle) throw new HTTPException(400, { message: 'athleteHandle required' });
  const athlete = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ?')
    .bind(body.athleteHandle)
    .first<{ id: string }>();
  if (!athlete) throw new HTTPException(404, { message: 'athlete not found' });
  if (athlete.id === session.userId) throw new HTTPException(400, { message: 'cannot self-coach' });
  await c.env.DB.prepare(
    `INSERT INTO coach_athletes (coach_id, athlete_id, status) VALUES (?, ?, 'pending')
     ON CONFLICT (coach_id, athlete_id) DO NOTHING`,
  )
    .bind(session.userId, athlete.id)
    .run();
  return c.json({ ok: true });
});

trainingRoutes.post('/me/coaches/:coachId/accept', async (c) => {
  const coachId = c.req.param('coachId');
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE coach_athletes SET status = 'active' WHERE coach_id = ? AND athlete_id = ?`,
  )
    .bind(coachId, session.userId)
    .run();
  return c.json({ ok: true });
});

trainingRoutes.delete('/me/coaches/:otherId', async (c) => {
  const otherId = c.req.param('otherId');
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE coach_athletes SET status = 'revoked'
       WHERE (coach_id = ? AND athlete_id = ?) OR (coach_id = ? AND athlete_id = ?)`,
  )
    .bind(session.userId, otherId, otherId, session.userId)
    .run();
  return c.json({ ok: true });
});

trainingRoutes.get('/me/athletes', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.handle, u.display_name AS displayName, ca.status, ca.created_at AS createdAt
       FROM coach_athletes ca
       JOIN users u ON u.id = ca.athlete_id
      WHERE ca.coach_id = ?
      ORDER BY ca.created_at DESC`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});

// Helpers ------------------------------------------------------------
interface WorkoutRow extends Workout {
  description: string | null;
  estimatedTss: number | null;
  estimatedDurationSec: number | null;
  createdAt: number;
}

async function loadWorkout(env: Env, id: string, userId: string): Promise<WorkoutRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, description, sport, steps_json AS stepsJson,
            estimated_tss AS estimatedTss, estimated_duration_sec AS estimatedDurationSec,
            created_at AS createdAt
       FROM workouts WHERE id = ? AND athlete_id = ?`,
  )
    .bind(id, userId)
    .first<{
      id: string;
      name: string;
      description: string | null;
      sport: Workout['sport'];
      stepsJson: string;
      estimatedTss: number | null;
      estimatedDurationSec: number | null;
      createdAt: number;
    }>();
  if (!row) return null;
  const parsed = JSON.parse(row.stepsJson) as { steps: Workout['steps'] };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sport: row.sport,
    steps: parsed.steps,
    estimatedTss: row.estimatedTss,
    estimatedDurationSec: row.estimatedDurationSec,
    createdAt: row.createdAt,
  };
}

async function isCoachOf(env: Env, coachId: string, athleteId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM coach_athletes
      WHERE coach_id = ? AND athlete_id = ? AND status = 'active'`,
  )
    .bind(coachId, athleteId)
    .first<{ x: number }>();
  return !!row;
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64) || 'workout';
}

function estimateLoad(steps: Workout['steps']): { tss: number | null; duration: number | null } {
  let dur = 0;
  let weighted = 0;
  let count = 0;
  const visit = (list: Workout['steps'], multiplier: number) => {
    for (const s of list) {
      const reps = Math.max(1, s.repeat ?? 1) * multiplier;
      if (s.children && s.children.length) {
        visit(s.children, reps);
        continue;
      }
      const stepDur = s.durationSec ?? 0;
      dur += stepDur * reps;
      const intensity = targetIntensity(s);
      if (intensity != null) {
        weighted += intensity * intensity * stepDur * reps;
        count += stepDur * reps;
      }
    }
  };
  visit(steps, 1);
  if (dur === 0) return { tss: null, duration: null };
  if (count === 0) return { tss: null, duration: dur };
  const meanIfSq = weighted / count;
  const tss = ((dur * meanIfSq) / 3600) * 100;
  return { tss: Math.round(tss * 10) / 10, duration: dur };
}

function targetIntensity(step: Workout['steps'][number]): number | null {
  const t = step.target;
  if (!t) return null;
  if (t.type === 'ftp_pct' || t.type === 'hr_pct') {
    return (t.low + t.high) / 2 / 100;
  }
  return null;
}
