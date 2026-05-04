/**
 * Events + RSVPs.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const eventRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
eventRoutes.use('*', requireSession());

const EVENT_TYPES = ['group_ride', 'race', 'training', 'social'] as const;
const RSVP_STATUSES = ['invited', 'accepted', 'declined', 'maybe', 'waitlisted'] as const;

eventRoutes.post('/events', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as {
    name?: string;
    description?: string;
    type?: string;
    startsAt?: number;
    endsAt?: number;
    clubId?: string;
    routeId?: string;
    location?: string;
    capacity?: number;
  } | null;
  if (!body?.name || body.name.length > 200) {
    throw new HTTPException(400, { message: 'name required (max 200)' });
  }
  if (typeof body.startsAt !== 'number') {
    throw new HTTPException(400, { message: 'startsAt (unix seconds) required' });
  }
  const type = body.type ?? 'group_ride';
  if (!EVENT_TYPES.includes(type as never)) {
    throw new HTTPException(400, { message: 'invalid type' });
  }
  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO events (id, club_id, owner_id, name, description, type, starts_at, ends_at, route_id, location, capacity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.clubId ?? null,
      session.userId,
      body.name,
      body.description ?? null,
      type,
      body.startsAt,
      body.endsAt ?? null,
      body.routeId ?? null,
      body.location ?? null,
      body.capacity ?? null,
    )
    .run();
  return c.json({ id }, 201);
});

eventRoutes.get('/events/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, club_id AS clubId, owner_id AS ownerId, name, description, type,
            starts_at AS startsAt, ends_at AS endsAt, route_id AS routeId,
            location, capacity, created_at AS createdAt
       FROM events WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) throw new HTTPException(404, { message: 'event not found' });
  const counts = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
       SUM(CASE WHEN status = 'maybe' THEN 1 ELSE 0 END) AS maybe,
       SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS declined,
       SUM(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) AS waitlisted
     FROM event_invites WHERE event_id = ?`,
  )
    .bind(id)
    .first();
  return c.json({ event: row, rsvpCounts: counts ?? {} });
});

eventRoutes.get('/events', async (c) => {
  const url = new URL(c.req.url);
  const after = Number(url.searchParams.get('after') ?? Math.floor(Date.now() / 1000));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
  const result = await c.env.DB.prepare(
    `SELECT id, name, type, starts_at AS startsAt, location
       FROM events
      WHERE starts_at >= ?
      ORDER BY starts_at ASC LIMIT ?`,
  )
    .bind(after, limit)
    .all();
  return c.json({ items: result.results ?? [] });
});

eventRoutes.post('/events/:id/rsvp', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status ?? 'accepted';
  if (!RSVP_STATUSES.includes(status as never)) {
    throw new HTTPException(400, { message: 'invalid status' });
  }
  const event = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!event) throw new HTTPException(404, { message: 'event not found' });
  await c.env.DB.prepare(
    `INSERT INTO event_invites (event_id, athlete_id, status, responded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, athlete_id) DO UPDATE
         SET status = excluded.status, responded_at = excluded.responded_at`,
  )
    .bind(id, session.userId, status, Math.floor(Date.now() / 1000))
    .run();
  return c.json({ ok: true, status });
});
