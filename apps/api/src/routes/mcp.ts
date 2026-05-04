/**
 * Model Context Protocol (MCP) server — JSON-RPC 2.0 over HTTP.
 *
 * Exposes a curated tool surface so an agentic AI can read + act on
 * the user's pacelore data. Authentication is via the same
 * X-Api-Key header used by the public REST API. The agent's effective
 * user is the API key's owner; scope checks on each tool.
 *
 * Methods implemented:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - resources/list  (read-only listing of activity ids)
 *   - resources/read  (fetches a single activity)
 *
 * The `mcp/` route is mounted directly on the worker; transport is
 * Streamable HTTP per the MCP 2025-06 spec, but for v1 we accept the
 * simpler JSON-RPC POST shape that almost every MCP client supports.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../env.js';
import { requireApiKey, type ApiKeyVariables } from '../auth/apiKey.js';

type Ctx = Context<{ Bindings: Env; Variables: ApiKeyVariables }>;

export const mcpRoutes = new Hono<{ Bindings: Env; Variables: ApiKeyVariables }>();

const SERVER_INFO = {
  name: 'pacelore',
  version: '0.1.0',
};

const TOOLS = [
  {
    name: 'list_activities',
    description: "List the authenticated athlete's activities, newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        cursor: { type: 'string' },
      },
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'get_activity',
    description: 'Fetch one activity, with summary metrics.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'get_pmc',
    description: 'CTL / ATL / TSB time series for the athlete over a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'list_segments_in_bbox',
    description: 'List segments whose bbox intersects the supplied area.',
    inputSchema: {
      type: 'object',
      properties: {
        minLat: { type: 'number' },
        minLng: { type: 'number' },
        maxLat: { type: 'number' },
        maxLng: { type: 'number' },
        sport: { type: 'string' },
      },
      required: ['minLat', 'minLng', 'maxLat', 'maxLng'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'segment_leaderboard',
    description: 'Top efforts on a segment.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        window: { type: 'string', enum: ['all', '90d', 'year'] },
      },
      required: ['id'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'kudos_activity',
    description: 'Give kudos to an activity (must be visible to the caller).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'comment_on_activity',
    description: 'Post a comment on a visible activity (≤2000 chars).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: { type: 'string' } },
      required: ['id', 'body'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'follow',
    description: 'Follow an athlete by id.',
    inputSchema: {
      type: 'object',
      properties: { athleteId: { type: 'string' } },
      required: ['athleteId'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'unfollow',
    description: 'Unfollow an athlete by id.',
    inputSchema: {
      type: 'object',
      properties: { athleteId: { type: 'string' } },
      required: ['athleteId'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'get_feed',
    description: 'Return the recent feed (self + followees).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
        cursor: { type: 'string' },
      },
    },
    requiredScope: 'read:social',
  },
] as const;

mcpRoutes.use('*', requireApiKey());

mcpRoutes.post('/', async (c) => {
  const req = (await c.req.raw.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  } | null;
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return c.json(
      { jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'invalid request' } },
      400,
    );
  }

  const { method, id = null } = req;
  const params = req.params ?? {};
  const apiKey = c.get('apiKey');

  try {
    if (method === 'initialize') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
        },
      });
    }
    if (method === 'tools/list') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS.map(({ requiredScope: _s, ...t }) => t) },
      });
    }
    if (method === 'resources/list') {
      const activities = await c.env.DB.prepare(
        'SELECT id, name, sport, started_at FROM activities WHERE athlete_id = ? ORDER BY started_at DESC LIMIT 100',
      )
        .bind(apiKey.userId)
        .all<{ id: string; name: string | null; sport: string; started_at: number }>();
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: (activities.results ?? []).map((a) => ({
            uri: `pacelore://activities/${a.id}`,
            name:
              a.name ?? `${a.sport} ${new Date(a.started_at * 1000).toISOString().slice(0, 10)}`,
            mimeType: 'application/json',
          })),
        },
      });
    }
    if (method === 'resources/read') {
      const uri = String(params.uri ?? '');
      const m = uri.match(/^pacelore:\/\/activities\/([^/]+)$/);
      if (!m) return jsonRpcError(c, id, -32602, 'unsupported uri');
      return runTool(c, id, 'get_activity', { id: m[1]! });
    }
    if (method === 'tools/call') {
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return jsonRpcError(c, id, -32601, `unknown tool: ${name}`);
      if (!apiKey.scopes.includes(tool.requiredScope)) {
        return jsonRpcError(c, id, -32004, `missing scope: ${tool.requiredScope}`);
      }
      return runTool(c, id, name, args);
    }
    return jsonRpcError(c, id, -32601, `unknown method: ${method}`);
  } catch (err) {
    return jsonRpcError(c, id, -32603, (err as Error).message);
  }
});

function jsonRpcError(c: Ctx, id: unknown, code: number, message: string) {
  return c.json({ jsonrpc: '2.0', id, error: { code, message } });
}

async function runTool(c: Ctx, id: unknown, name: string, args: Record<string, unknown>) {
  const env: Env = c.env;
  const userId = c.get('apiKey').userId as string;
  const ok = (data: unknown) =>
    c.json({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
    });

  switch (name) {
    case 'list_activities': {
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const cursor = args.cursor ? Number(args.cursor) : null;
      const stmt = cursor
        ? env.DB.prepare(
            `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
                    distance_m AS distanceM, np, tss
               FROM activities WHERE athlete_id = ? AND started_at < ?
               ORDER BY started_at DESC LIMIT ?`,
          ).bind(userId, cursor, limit + 1)
        : env.DB.prepare(
            `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
                    distance_m AS distanceM, np, tss
               FROM activities WHERE athlete_id = ?
               ORDER BY started_at DESC LIMIT ?`,
          ).bind(userId, limit + 1);
      const rows = await stmt.all<{ id: string; startedAt: number }>();
      const results = rows.results ?? [];
      const more = results.length > limit;
      const page = results.slice(0, limit);
      return ok({
        items: page,
        nextCursor: more ? String(page[page.length - 1]!.startedAt) : null,
      });
    }
    case 'get_activity': {
      const aid = String(args.id ?? '');
      const row = await env.DB.prepare(
        `SELECT id, athlete_id AS athleteId, sport, name, started_at AS startedAt,
                total_seconds AS totalSeconds, distance_m AS distanceM,
                np, tss, hr_avg AS hrAvg, power_avg AS powerAvg, visibility
           FROM activities WHERE id = ?`,
      )
        .bind(aid)
        .first<{ athleteId: string; visibility: string }>();
      if (!row) return jsonRpcError(c, id, -32004, 'not found');
      if (row.athleteId !== userId && row.visibility !== 'public') {
        return jsonRpcError(c, id, -32004, 'not allowed');
      }
      const m = await env.DB.prepare(
        'SELECT key, value FROM activity_metrics WHERE activity_id = ?',
      )
        .bind(aid)
        .all();
      return ok({ activity: row, metrics: m.results ?? [] });
    }
    case 'get_pmc': {
      const from = typeof args.from === 'string' ? args.from : null;
      const to = typeof args.to === 'string' ? args.to : todayIso();
      const stmt = from
        ? env.DB.prepare(
            'SELECT date, tss, ctl, atl, tsb FROM pmc_daily WHERE athlete_id = ? AND date >= ? AND date <= ? ORDER BY date',
          ).bind(userId, from, to)
        : env.DB.prepare(
            'SELECT date, tss, ctl, atl, tsb FROM pmc_daily WHERE athlete_id = ? AND date <= ? ORDER BY date',
          ).bind(userId, to);
      const rows = await stmt.all();
      return ok({ days: rows.results ?? [] });
    }
    case 'list_segments_in_bbox': {
      const { minLat, minLng, maxLat, maxLng, sport } = args as Record<string, number | string>;
      const baseSql = `SELECT id, name, sport, distance_m AS distanceM
        FROM segments WHERE bbox_min_lat <= ? AND bbox_max_lat >= ? AND bbox_min_lng <= ? AND bbox_max_lng >= ?`;
      const stmt = sport
        ? env.DB.prepare(`${baseSql} AND sport = ? LIMIT 100`).bind(
            maxLat,
            minLat,
            maxLng,
            minLng,
            sport,
          )
        : env.DB.prepare(`${baseSql} LIMIT 100`).bind(maxLat, minLat, maxLng, minLng);
      const rows = await stmt.all();
      return ok({ items: rows.results ?? [] });
    }
    case 'segment_leaderboard': {
      const sid = String(args.id ?? '');
      const window = String(args.window ?? 'all');
      let cutoff: number | null = null;
      if (window === '90d') cutoff = Math.floor(Date.now() / 1000) - 90 * 86_400;
      const sql = `SELECT e.athlete_id AS athleteId, u.handle, e.time_seconds AS timeSeconds
                     FROM segment_efforts e JOIN users u ON u.id = e.athlete_id
                    WHERE e.segment_id = ? ${cutoff ? 'AND e.started_at >= ?' : ''}
                    ORDER BY e.time_seconds ASC LIMIT 50`;
      const stmt = cutoff ? env.DB.prepare(sql).bind(sid, cutoff) : env.DB.prepare(sql).bind(sid);
      const rows = await stmt.all();
      return ok({ items: rows.results ?? [] });
    }
    case 'kudos_activity': {
      const aid = String(args.id ?? '');
      const v = await env.DB.prepare(
        'SELECT athlete_id AS athleteId, visibility FROM activities WHERE id = ?',
      )
        .bind(aid)
        .first<{ athleteId: string; visibility: string }>();
      if (!v) return jsonRpcError(c, id, -32004, 'not found');
      if (v.athleteId !== userId && v.visibility === 'private') {
        return jsonRpcError(c, id, -32004, 'not allowed');
      }
      await env.DB.prepare(
        'INSERT INTO kudos (activity_id, athlete_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(aid, userId)
        .run();
      return ok({ ok: true });
    }
    case 'comment_on_activity': {
      const aid = String(args.id ?? '');
      const body = String(args.body ?? '').trim();
      if (!body || body.length > 2000) {
        return jsonRpcError(c, id, -32602, 'body 1–2000 chars');
      }
      const cid = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO comments (id, activity_id, athlete_id, body) VALUES (?, ?, ?, ?)',
      )
        .bind(cid, aid, userId, body)
        .run();
      return ok({ id: cid });
    }
    case 'follow': {
      const target = String(args.athleteId ?? '');
      if (target === userId) return jsonRpcError(c, id, -32602, 'cannot follow self');
      await env.DB.prepare(
        'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(userId, target)
        .run();
      return ok({ ok: true });
    }
    case 'unfollow': {
      const target = String(args.athleteId ?? '');
      await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
        .bind(userId, target)
        .run();
      return ok({ ok: true });
    }
    case 'get_feed': {
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 25)));
      const cursor = args.cursor ? Number(args.cursor) : null;
      const sql = `SELECT a.id, a.athlete_id AS athleteId, u.handle, a.sport, a.name,
                          a.started_at AS startedAt, a.total_seconds AS totalSeconds,
                          a.distance_m AS distanceM, a.np, a.tss
                     FROM activities a JOIN users u ON u.id = a.athlete_id
                    WHERE (a.athlete_id = ?
                       OR (a.athlete_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
                           AND a.visibility IN ('followers','public'))
                       OR a.visibility = 'public')
                       ${cursor ? 'AND a.started_at < ?' : ''}
                    ORDER BY a.started_at DESC LIMIT ?`;
      const stmt = cursor
        ? env.DB.prepare(sql).bind(userId, userId, cursor, limit + 1)
        : env.DB.prepare(sql).bind(userId, userId, limit + 1);
      const rows = await stmt.all<{ startedAt: number }>();
      const results = rows.results ?? [];
      const more = results.length > limit;
      const page = results.slice(0, limit);
      return ok({
        items: page,
        nextCursor: more ? String(page[page.length - 1]!.startedAt) : null,
      });
    }
    default:
      return jsonRpcError(c, id, -32601, `unknown tool: ${name}`);
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
