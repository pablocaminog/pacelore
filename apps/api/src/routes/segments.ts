/**
 * Segments CRUD.
 *
 *   POST /api/v1/segments
 *     { name, sport, polyline: [[lat,lng],…] }
 *   GET  /api/v1/segments/:id
 *   GET  /api/v1/segments?bbox=minLat,minLng,maxLat,maxLng[&sport=]
 *
 * Polyline stored as JSON. Bbox computed at insert and indexed for fast
 * spatial queries.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bboxOf, type LatLng } from '@pacelore/segments';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const segmentRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

segmentRoutes.use('*', requireSession());

interface SegmentRow {
  id: string;
  name: string;
  sport: string;
  polyline: string;
  distanceM: number;
  avgGrade: number | null;
  bboxMinLat: number;
  bboxMinLng: number;
  bboxMaxLat: number;
  bboxMaxLng: number;
  createdBy: string;
  createdAt: number;
}

segmentRoutes.post('/segments', async (c) => {
  const session = c.get('session');
  if (!c.req.header('content-type')?.includes('application/json')) {
    throw new HTTPException(415, { message: 'expected application/json' });
  }
  const body = (await c.req.raw.json().catch(() => null)) as {
    name?: string;
    sport?: string;
    polyline?: [number, number][];
  } | null;
  if (!body) throw new HTTPException(400, { message: 'invalid JSON' });
  const name = body.name?.trim();
  const sport = body.sport?.trim();
  const polyline = body.polyline;
  if (!name || name.length > 200) throw new HTTPException(400, { message: 'invalid name' });
  if (!sport) throw new HTTPException(400, { message: 'sport required' });
  if (!Array.isArray(polyline) || polyline.length < 2) {
    throw new HTTPException(400, { message: 'polyline needs at least 2 points' });
  }
  const points: LatLng[] = polyline.map((p) => ({ lat: p[0], lng: p[1] }));
  const bb = bboxOf(points);
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += haversineMeters(points[i - 1]!, points[i]!);
  }

  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO segments
       (id, name, sport, polyline, distance_m, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      sport,
      JSON.stringify(polyline),
      dist,
      bb.minLat,
      bb.minLng,
      bb.maxLat,
      bb.maxLng,
      session.userId,
    )
    .run();
  return c.json({ id, name, sport, distanceM: dist, bbox: bb }, 201);
});

segmentRoutes.get('/segments/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, name, sport, polyline, distance_m AS distanceM, avg_grade AS avgGrade,
            bbox_min_lat AS bboxMinLat, bbox_min_lng AS bboxMinLng,
            bbox_max_lat AS bboxMaxLat, bbox_max_lng AS bboxMaxLng,
            created_by AS createdBy, created_at AS createdAt
       FROM segments WHERE id = ?`,
  )
    .bind(id)
    .first<SegmentRow>();
  if (!row) throw new HTTPException(404, { message: 'segment not found' });
  return c.json({ ...row, polyline: JSON.parse(row.polyline) });
});

segmentRoutes.get('/segments', async (c) => {
  const url = new URL(c.req.url);
  const bbox = url.searchParams.get('bbox');
  const sport = url.searchParams.get('sport');
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));

  if (!bbox)
    throw new HTTPException(400, { message: '?bbox=minLat,minLng,maxLat,maxLng required' });
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new HTTPException(400, { message: 'invalid bbox' });
  }
  const [minLat, minLng, maxLat, maxLng] = parts as [number, number, number, number];

  const sportClause = sport ? 'AND sport = ?' : '';
  const sql = `
    SELECT id, name, sport, distance_m AS distanceM,
           bbox_min_lat AS bboxMinLat, bbox_min_lng AS bboxMinLng,
           bbox_max_lat AS bboxMaxLat, bbox_max_lng AS bboxMaxLng
      FROM segments
     WHERE bbox_min_lat <= ? AND bbox_max_lat >= ?
       AND bbox_min_lng <= ? AND bbox_max_lng >= ?
       ${sportClause}
     LIMIT ?`;
  const stmt = sport
    ? c.env.DB.prepare(sql).bind(maxLat, minLat, maxLng, minLng, sport, limit)
    : c.env.DB.prepare(sql).bind(maxLat, minLat, maxLng, minLng, limit);
  const result =
    await stmt.all<Omit<SegmentRow, 'polyline' | 'avgGrade' | 'createdBy' | 'createdAt'>>();
  return c.json({ items: result.results ?? [] });
});

segmentRoutes.get('/segments/:id/leaderboard', async (c) => {
  const id = c.req.param('id');
  const url = new URL(c.req.url);
  const window = url.searchParams.get('window') ?? 'all'; // 'all' | '90d' | 'year'
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  const seg = await c.env.DB.prepare('SELECT id FROM segments WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!seg) throw new HTTPException(404, { message: 'segment not found' });

  const cacheKey = `leaderboard:${id}:${window}:${limit}`;
  const cached = await c.env.KV_LEADERBOARDS.get(cacheKey, 'json');
  if (cached) return c.json(cached);

  let cutoff: number | null = null;
  const now = Math.floor(Date.now() / 1000);
  if (window === '90d') cutoff = now - 90 * 86_400;
  else if (window === 'year') {
    const d = new Date();
    cutoff = Math.floor(Date.UTC(d.getUTCFullYear(), 0, 1) / 1000);
  }
  const cutoffClause = cutoff ? 'AND e.started_at >= ?' : '';
  const sql = `
    SELECT e.id AS effortId, e.athlete_id AS athleteId,
           u.handle, u.display_name AS displayName,
           e.time_seconds AS timeSeconds, e.started_at AS startedAt
      FROM segment_efforts e
      JOIN users u ON u.id = e.athlete_id
     WHERE e.segment_id = ? ${cutoffClause}
     ORDER BY e.time_seconds ASC LIMIT ?`;
  const stmt = cutoff
    ? c.env.DB.prepare(sql).bind(id, cutoff, limit)
    : c.env.DB.prepare(sql).bind(id, limit);
  const rows = await stmt.all<{
    effortId: string;
    athleteId: string;
    handle: string;
    displayName: string | null;
    timeSeconds: number;
    startedAt: number;
  }>();
  const payload = { segmentId: id, window, items: rows.results ?? [] };
  await c.env.KV_LEADERBOARDS.put(cacheKey, JSON.stringify(payload), { expirationTtl: 86_400 });
  return c.json(payload);
});

function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
