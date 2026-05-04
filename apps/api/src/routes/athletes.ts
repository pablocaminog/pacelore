/**
 * Athlete-scoped read endpoints.
 *
 *   GET /api/v1/athletes/:id/pmc?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the daily CTL/ATL/TSB series, computed on the fly from
 * pmc_daily.tss so the table only needs to track raw stress.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { pmcDaily } from '@pacelore/metrics';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';

export const athleteRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

athleteRoutes.use('*', requireSession());

athleteRoutes.get('/athletes/by-handle/:handle', async (c) => {
  const handle = c.req.param('handle');
  const row = await c.env.DB.prepare(
    `SELECT id, handle, display_name AS displayName, bio, location, created_at AS createdAt
       FROM users WHERE handle = ? COLLATE NOCASE`,
  )
    .bind(handle)
    .first<{
      id: string;
      handle: string;
      displayName: string | null;
      bio: string | null;
      location: string | null;
      createdAt: number;
    }>();
  if (!row) throw new HTTPException(404, { message: 'athlete not found' });

  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
       (SELECT COUNT(*) FROM activities WHERE athlete_id = ?) AS activities`,
  )
    .bind(row.id, row.id, row.id)
    .first<{ followers: number; following: number; activities: number }>();

  const session = c.get('session');
  const isFollowingRow = await c.env.DB.prepare(
    'SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?',
  )
    .bind(session.userId, row.id)
    .first<{ x: number }>();

  return c.json({
    athlete: row,
    counts: counts ?? { followers: 0, following: 0, activities: 0 },
    isSelf: session.userId === row.id,
    isFollowing: !!isFollowingRow,
  });
});

athleteRoutes.get('/athletes/:id/activities', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const url = new URL(c.req.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));

  const isSelf = id === session.userId;
  let isFollower = false;
  if (!isSelf) {
    const f = await c.env.DB.prepare(
      'SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?',
    )
      .bind(session.userId, id)
      .first<{ x: number }>();
    isFollower = !!f;
  }
  const visible = isSelf
    ? "('private','followers','public')"
    : isFollower
      ? "('followers','public')"
      : "('public')";

  const cursorClause = cursor ? 'AND started_at < ?' : '';
  const sql = `
    SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
           distance_m AS distanceM, np, tss
      FROM activities
     WHERE athlete_id = ? AND visibility IN ${visible} ${cursorClause}
     ORDER BY started_at DESC LIMIT ?`;
  const stmt = cursor
    ? c.env.DB.prepare(sql).bind(id, Number(cursor), limit + 1)
    : c.env.DB.prepare(sql).bind(id, limit + 1);
  const result = await stmt.all<{
    id: string;
    sport: string;
    name: string | null;
    startedAt: number;
    totalSeconds: number;
    distanceM: number | null;
    np: number | null;
    tss: number | null;
  }>();
  const rows = result.results ?? [];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = more ? String(page[page.length - 1]!.startedAt) : null;
  return c.json({ items: page, nextCursor });
});

athleteRoutes.get('/athletes/:id/pmc', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  if (id !== session.userId) {
    throw new HTTPException(403, { message: 'PMC access limited to self' });
  }

  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to') ?? today();
  if (!isValidDate(to) || (from && !isValidDate(from))) {
    throw new HTTPException(400, { message: 'from/to must be YYYY-MM-DD' });
  }

  const stmt = from
    ? c.env.DB.prepare(
        'SELECT date, tss FROM pmc_daily WHERE athlete_id = ? AND date >= ? AND date <= ? ORDER BY date',
      ).bind(id, from, to)
    : c.env.DB.prepare(
        'SELECT date, tss FROM pmc_daily WHERE athlete_id = ? AND date <= ? ORDER BY date',
      ).bind(id, to);

  const rows = await stmt.all<{ date: string; tss: number }>();
  const entries = (rows.results ?? []).map((r) => ({ date: r.date, tss: r.tss }));
  const series = pmcDaily(entries, { endDate: to });
  return c.json({ athleteId: id, from: series[0]?.date ?? from ?? to, to, days: series });
});

function today(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
