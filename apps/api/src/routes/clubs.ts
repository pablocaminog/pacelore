/**
 * Clubs CRUD + members.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const clubRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
clubRoutes.use('*', requireSession());

clubRoutes.post('/clubs', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as {
    name?: string;
    description?: string;
    sportFocus?: string;
    visibility?: string;
  } | null;
  if (!body?.name || body.name.length > 200) {
    throw new HTTPException(400, { message: 'name required (max 200)' });
  }
  const visibility = body.visibility ?? 'public';
  if (!['public', 'private'].includes(visibility)) {
    throw new HTTPException(400, { message: 'invalid visibility' });
  }
  const id = uuidv7();
  await c.env.DB.prepare(
    'INSERT INTO clubs (id, name, description, sport_focus, visibility, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      body.name,
      body.description ?? null,
      body.sportFocus ?? null,
      visibility,
      session.userId,
    )
    .run();
  await c.env.DB.prepare(
    "INSERT INTO club_members (club_id, athlete_id, role) VALUES (?, ?, 'owner')",
  )
    .bind(id, session.userId)
    .run();
  return c.json({ id }, 201);
});

clubRoutes.get('/clubs/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, name, description, sport_focus AS sportFocus, visibility,
            owner_id AS ownerId, created_at AS createdAt
       FROM clubs WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) throw new HTTPException(404, { message: 'club not found' });
  const members = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?')
    .bind(id)
    .first<{ n: number }>();
  return c.json({ club: row, memberCount: members?.n ?? 0 });
});

clubRoutes.get('/clubs', async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
  const result = await c.env.DB.prepare(
    `SELECT id, name, description, sport_focus AS sportFocus, visibility, created_at AS createdAt
       FROM clubs WHERE visibility = 'public'
       ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ items: result.results ?? [] });
});

clubRoutes.post('/clubs/:id/members', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const club = await c.env.DB.prepare('SELECT id, visibility FROM clubs WHERE id = ?')
    .bind(id)
    .first<{ id: string; visibility: string }>();
  if (!club) throw new HTTPException(404, { message: 'club not found' });
  if (club.visibility !== 'public') {
    throw new HTTPException(403, { message: 'private club: invite only' });
  }
  await c.env.DB.prepare(
    "INSERT INTO club_members (club_id, athlete_id, role) VALUES (?, ?, 'member') ON CONFLICT DO NOTHING",
  )
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

clubRoutes.delete('/clubs/:id/members', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare('DELETE FROM club_members WHERE club_id = ? AND athlete_id = ?')
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

clubRoutes.get('/clubs/:id/members', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    `SELECT m.athlete_id AS athleteId, u.handle, u.display_name AS displayName, m.role
       FROM club_members m JOIN users u ON u.id = m.athlete_id
      WHERE m.club_id = ?
      ORDER BY m.joined_at ASC`,
  )
    .bind(id)
    .all();
  return c.json({ items: result.results ?? [] });
});
