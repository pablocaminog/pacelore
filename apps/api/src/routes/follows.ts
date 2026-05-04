/**
 * Follow graph endpoints.
 *
 *   POST   /api/v1/follows/:athleteId        follow them
 *   DELETE /api/v1/follows/:athleteId        unfollow
 *   GET    /api/v1/athletes/:id/followers    paginated list
 *   GET    /api/v1/athletes/:id/following    paginated list
 *
 * Pagination uses an opaque cursor that encodes (created_at, id) of the
 * last edge — keyset rather than offset for stable scrolling.
 */

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';

type Ctx = Context<{ Bindings: Env; Variables: AuthVariables }>;

export const followRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

followRoutes.use('*', requireSession());

followRoutes.post('/follows/:athleteId', async (c) => {
  const target = c.req.param('athleteId');
  const session = c.get('session');
  if (target === session.userId) throw new HTTPException(400, { message: 'cannot follow self' });

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target).first();
  if (!exists) throw new HTTPException(404, { message: 'athlete not found' });

  await c.env.DB.prepare(
    'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(session.userId, target)
    .run();
  return c.json({ ok: true, followerId: session.userId, followeeId: target });
});

followRoutes.delete('/follows/:athleteId', async (c) => {
  const target = c.req.param('athleteId');
  const session = c.get('session');
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
    .bind(session.userId, target)
    .run();
  return c.json({ ok: true });
});

followRoutes.get('/athletes/:id/followers', async (c) => {
  return listEdges(c, 'follower');
});

followRoutes.get('/athletes/:id/following', async (c) => {
  return listEdges(c, 'followee');
});

async function listEdges(c: Ctx, side: 'follower' | 'followee') {
  const id = c.req.param('id');
  const url = new URL(c.req.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));

  const filter = side === 'follower' ? 'followee_id' : 'follower_id';
  const select = side === 'follower' ? 'follower_id' : 'followee_id';

  const baseQuery = `
    SELECT u.id, u.handle, u.display_name AS displayName, f.created_at AS createdAt
      FROM follows f
      JOIN users u ON u.id = f.${select}
     WHERE f.${filter} = ?`;

  const rowsResult = cursor
    ? await c.env.DB.prepare(`${baseQuery} AND f.created_at < ? ORDER BY f.created_at DESC LIMIT ?`)
        .bind(id, Number(cursor), limit + 1)
        .all<EdgeRow>()
    : await c.env.DB.prepare(`${baseQuery} ORDER BY f.created_at DESC LIMIT ?`)
        .bind(id, limit + 1)
        .all<EdgeRow>();
  const rows = rowsResult.results ?? [];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = more ? String(page[page.length - 1]!.createdAt) : null;
  return c.json({ items: page, nextCursor });
}

interface EdgeRow {
  id: string;
  handle: string;
  displayName: string | null;
  createdAt: number;
}
