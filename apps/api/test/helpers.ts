/**
 * Lightweight in-memory fakes for the bindings the API worker uses.
 * Just enough surface to drive route tests without spinning up miniflare.
 */

import type { Env } from '../src/env.js';

export class FakeKV implements KVNamespace {
  private store = new Map<string, string>();

  async get<T = string>(
    key: string,
    typeOrOptions?: 'text' | 'json' | KVNamespaceGetOptions<'text' | 'json'>,
  ): Promise<string | T | null> {
    const raw = this.store.get(key) ?? null;
    if (raw === null) return null;
    const type =
      typeof typeOrOptions === 'string' ? typeOrOptions : (typeOrOptions?.type ?? 'text');
    if (type === 'json') return JSON.parse(raw) as T;
    return raw;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Surface methods we don't use but the type demands.
  list = (() =>
    Promise.resolve({ keys: [], list_complete: true })) as unknown as KVNamespace['list'];
  getWithMetadata = (() =>
    Promise.resolve({ value: null, metadata: null })) as unknown as KVNamespace['getWithMetadata'];
}

interface Row {
  [key: string]: unknown;
}

class FakeStmt implements D1PreparedStatement {
  constructor(
    private db: FakeD1,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1PreparedStatement {
    return new FakeStmt(this.db, this.sql, params);
  }

  async first<T = Row>(): Promise<T | null> {
    return (await this.db.execute(this.sql, this.params))[0] as T | null;
  }

  async run<T = Row>(): Promise<D1Response & { results?: T[] }> {
    await this.db.execute(this.sql, this.params);
    return { success: true, meta: {} as D1Meta };
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const results = (await this.db.execute(this.sql, this.params)) as T[];
    return { results, success: true, meta: {} as D1Meta };
  }

  async raw<T = unknown>(): Promise<T[]> {
    return [] as T[];
  }
}

export class FakeD1 implements D1Database {
  users: Row[] = [];
  credentials: Row[] = [];
  activities: Row[] = [];
  activityMetrics: Row[] = [];
  follows: Row[] = [];
  kudos: Row[] = [];
  comments: Row[] = [];
  segments: Row[] = [];
  segmentEfforts: Row[] = [];
  clubs: Row[] = [];
  clubMembers: Row[] = [];
  events: Row[] = [];
  eventInvites: Row[] = [];
  apiKeys: Row[] = [];
  pmcDaily: Map<string, Row> = new Map();

  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql);
  }
  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }

  async execute(sql: string, params: unknown[]): Promise<unknown[]> {
    const trimmed = sql.replace(/\s+/g, ' ').trim();
    if (trimmed.startsWith('SELECT 1')) return [{ '1': 1 }];
    if (trimmed.includes('FROM users WHERE email')) {
      const email = String(params[0] ?? '').toLowerCase();
      const u = this.users.find((r) => String(r.email).toLowerCase() === email);
      return u ? [u] : [];
    }
    if (trimmed.includes('FROM users WHERE id')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id);
      return u ? [u] : [];
    }
    if (trimmed.startsWith('INSERT INTO users')) {
      const [id, handle, email, displayName] = params;
      this.users.push({ id, handle, email, displayName: displayName ?? null });
      return [];
    }
    if (trimmed.includes('FROM webauthn_credentials WHERE user_id')) {
      const uid = params[0];
      return this.credentials.filter((r) => r.user_id === uid);
    }
    if (trimmed.includes('FROM webauthn_credentials WHERE id')) {
      const id = params[0];
      const c = this.credentials.find((r) => r.id === id);
      return c ? [c] : [];
    }
    if (trimmed.startsWith('INSERT INTO webauthn_credentials')) {
      const [id, user_id, public_key, counter, transports, device_name] = params;
      this.credentials.push({ id, user_id, public_key, counter, transports, device_name });
      return [];
    }
    if (trimmed.startsWith('UPDATE webauthn_credentials')) {
      const [counter, , id] = params;
      const cred = this.credentials.find((r) => r.id === id);
      if (cred) cred.counter = counter;
      return [];
    }
    if (trimmed.startsWith('SELECT id FROM activities WHERE id')) {
      const id = params[0];
      const a = this.activities.find((r) => r.id === id);
      return a ? [{ id: a.id }] : [];
    }
    if (trimmed.startsWith('SELECT id, athlete_id AS athleteId, visibility')) {
      const id = params[0];
      const a = this.activities.find((r) => r.id === id);
      if (!a) return [];
      return [
        {
          id: a.id,
          athleteId: a.athlete_id,
          visibility: a.visibility ?? 'private',
          parsedR2Path: a.parsed_r2_path ?? null,
        },
      ];
    }
    if (trimmed.startsWith('SELECT id, athlete_id AS athleteId, source')) {
      const id = params[0];
      const a = this.activities.find((r) => r.id === id);
      if (!a) return [];
      return [
        {
          id: a.id,
          athleteId: a.athlete_id,
          source: a.source,
          sport: a.sport,
          name: a.name ?? null,
          description: a.description ?? null,
          startedAt: a.started_at,
          totalSeconds: a.total_seconds,
          distanceM: a.distance_m,
          ascentM: a.ascent_m ?? null,
          descentM: a.descent_m ?? null,
          hrAvg: a.hr_avg ?? null,
          hrMax: a.hr_max ?? null,
          powerAvg: a.power_avg ?? null,
          powerMax: a.power_max ?? null,
          np: a.np ?? null,
          intensityFactor: a.intensity_factor ?? null,
          tss: a.tss ?? null,
          kj: a.kj ?? null,
          speedAvgMs: a.speed_avg_ms ?? null,
          speedMaxMs: a.speed_max_ms ?? null,
          calories: a.calories ?? null,
          visibility: a.visibility ?? 'private',
          parsedR2Path: a.parsed_r2_path ?? null,
        },
      ];
    }
    if (trimmed.startsWith('SELECT key, value FROM activity_metrics')) {
      const aid = params[0];
      return this.activityMetrics
        .filter((r) => r.activity_id === aid)
        .map((r) => ({ key: r.key, value: r.value }));
    }
    if (trimmed.startsWith('INSERT INTO activities')) {
      const [
        id,
        athlete_id,
        source,
        sport,
        started_at,
        total_seconds,
        distance_m,
        ascent_m,
        descent_m,
        hr_avg,
        hr_max,
        power_avg,
        power_max,
        np,
        intensity_factor,
        tss,
        kj,
        speed_avg_ms,
        speed_max_ms,
        raw_r2_path,
        parsed_r2_path,
      ] = params;
      this.activities.push({
        id,
        athlete_id,
        source,
        sport,
        started_at,
        total_seconds,
        distance_m,
        ascent_m,
        descent_m,
        hr_avg,
        hr_max,
        power_avg,
        power_max,
        np,
        intensity_factor,
        tss,
        kj,
        speed_avg_ms,
        speed_max_ms,
        raw_r2_path,
        parsed_r2_path,
        visibility: 'private',
      });
      return [];
    }
    if (trimmed.startsWith('INSERT INTO activity_metrics')) {
      const [activity_id, key, value] = params;
      this.activityMetrics.push({ activity_id, key, value });
      return [];
    }
    if (trimmed.startsWith('SELECT arweave_permanence AS arweave')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id);
      return u
        ? [
            {
              arweave: u.arweave_permanence ?? 0,
              atDid: u.atproto_did ?? null,
              atPds: u.atproto_pds ?? null,
              atJwt: u.atproto_access_jwt ?? null,
            },
          ]
        : [];
    }
    if (
      trimmed.startsWith('UPDATE activities SET arweave_tx') ||
      trimmed.startsWith('UPDATE activities SET atproto_uri')
    ) {
      const [val, id] = params;
      const a = this.activities.find((r) => r.id === id);
      if (a) {
        if (trimmed.includes('arweave_tx')) a.arweave_tx = val;
        else a.atproto_uri = val;
      }
      return [];
    }
    if (trimmed.startsWith('UPDATE users SET arweave_permanence')) {
      const [val, id] = params;
      const u = this.users.find((r) => r.id === id);
      if (u) u.arweave_permanence = val;
      return [];
    }
    if (trimmed.startsWith('SELECT arweave_permanence AS enabled')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id);
      return u ? [{ enabled: u.arweave_permanence ?? 0 }] : [];
    }
    if (trimmed.startsWith('SELECT atproto_handle')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id);
      return u
        ? [
            {
              handle: u.atproto_handle ?? null,
              did: u.atproto_did ?? null,
              pds: u.atproto_pds ?? null,
            },
          ]
        : [];
    }
    if (trimmed.startsWith('UPDATE users SET atproto_handle')) {
      const [handle, pds, pw, did, jwt, refreshJwt, id] = params;
      const u = this.users.find((r) => r.id === id);
      if (u) {
        u.atproto_handle = handle;
        u.atproto_pds = pds;
        u.atproto_app_password = pw;
        u.atproto_did = did;
        u.atproto_access_jwt = jwt;
        u.atproto_refresh_jwt = refreshJwt;
      }
      return [];
    }
    if (trimmed.startsWith('SELECT ftp, hr_max')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id) as
        | (Row & {
            ftp?: number;
            hrMax?: number;
            hrRest?: number;
            thrPace100?: number;
          })
        | undefined;
      if (!u) return [];
      return [
        {
          ftp: u.ftp ?? null,
          hrMax: u.hrMax ?? null,
          hrRest: u.hrRest ?? null,
          thrPace100: u.thrPace100 ?? null,
        },
      ];
    }
    if (trimmed.startsWith('SELECT id FROM users WHERE id')) {
      const id = params[0];
      const u = this.users.find((r) => r.id === id);
      return u ? [{ id: u.id }] : [];
    }
    if (trimmed.startsWith('INSERT INTO follows')) {
      const [follower_id, followee_id] = params;
      const exists = this.follows.find(
        (r) => r.follower_id === follower_id && r.followee_id === followee_id,
      );
      if (!exists) {
        this.follows.push({ follower_id, followee_id, created_at: Math.floor(Date.now() / 1000) });
      }
      return [];
    }
    if (trimmed.startsWith('DELETE FROM follows')) {
      const [follower_id, followee_id] = params;
      this.follows = this.follows.filter(
        (r) => !(r.follower_id === follower_id && r.followee_id === followee_id),
      );
      return [];
    }
    if (trimmed.includes('FROM follows f') && trimmed.includes('JOIN users u')) {
      const isFollowers = trimmed.includes('f.followee_id = ?');
      const filterId = params[0];
      const cursor = params.length === 3 ? Number(params[1]) : null;
      const limit = Number(params[params.length - 1]);
      const edges = this.follows
        .filter((r) => (isFollowers ? r.followee_id === filterId : r.follower_id === filterId))
        .filter((r) => (cursor != null ? Number(r.created_at) < cursor : true))
        .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        .slice(0, limit);
      return edges.map((edge) => {
        const userId = isFollowers ? edge.follower_id : edge.followee_id;
        const u = this.users.find((r) => r.id === userId);
        return {
          id: u?.id,
          handle: u?.handle,
          displayName: u?.displayName ?? null,
          createdAt: edge.created_at,
        };
      });
    }
    if (trimmed.startsWith('SELECT id FROM segments WHERE id')) {
      const id = params[0];
      const s = this.segments.find((r) => r.id === id);
      return s ? [{ id: s.id }] : [];
    }
    if (trimmed.includes('FROM segment_efforts e') && trimmed.includes('JOIN users u')) {
      const segId = params[0];
      const cutoff = params.length === 3 ? Number(params[1]) : null;
      const limit = Number(params[params.length - 1]);
      const efforts = this.segmentEfforts
        .filter((e) => e.segment_id === segId)
        .filter((e) => (cutoff != null ? Number(e.started_at) >= cutoff : true))
        .sort((a, b) => Number(a.time_seconds) - Number(b.time_seconds))
        .slice(0, limit);
      return efforts.map((e) => {
        const u = this.users.find((r) => r.id === e.athlete_id);
        return {
          effortId: e.id,
          athleteId: e.athlete_id,
          handle: u?.handle ?? null,
          displayName: u?.displayName ?? null,
          timeSeconds: e.time_seconds,
          startedAt: e.started_at,
        };
      });
    }
    if (trimmed.startsWith('SELECT id, polyline FROM segments')) {
      const [sport, maxLat, minLat, maxLng, minLng] = params as unknown as [
        string,
        number,
        number,
        number,
        number,
      ];
      return this.segments
        .filter(
          (s) =>
            s.sport === sport &&
            Number(s.bbox_min_lat) <= maxLat &&
            Number(s.bbox_max_lat) >= minLat &&
            Number(s.bbox_min_lng) <= maxLng &&
            Number(s.bbox_max_lng) >= minLng,
        )
        .map((s) => ({ id: s.id, polyline: s.polyline }));
    }
    if (trimmed.startsWith('INSERT INTO segment_efforts')) {
      const [id, segment_id, athlete_id, activity_id, time_seconds, started_at] = params;
      this.segmentEfforts.push({
        id,
        segment_id,
        athlete_id,
        activity_id,
        time_seconds,
        started_at,
        created_at: Math.floor(Date.now() / 1000),
      });
      return [];
    }
    if (trimmed.startsWith('INSERT INTO segments')) {
      const [
        id,
        name,
        sport,
        polyline,
        distance_m,
        bbox_min_lat,
        bbox_min_lng,
        bbox_max_lat,
        bbox_max_lng,
        created_by,
      ] = params;
      this.segments.push({
        id,
        name,
        sport,
        polyline,
        distance_m,
        bbox_min_lat,
        bbox_min_lng,
        bbox_max_lat,
        bbox_max_lng,
        created_by,
        created_at: Math.floor(Date.now() / 1000),
      });
      return [];
    }
    if (trimmed.startsWith('SELECT id, name, sport, polyline')) {
      const id = params[0];
      const s = this.segments.find((r) => r.id === id);
      return s
        ? [
            {
              id: s.id,
              name: s.name,
              sport: s.sport,
              polyline: s.polyline,
              distanceM: s.distance_m,
              avgGrade: null,
              bboxMinLat: s.bbox_min_lat,
              bboxMinLng: s.bbox_min_lng,
              bboxMaxLat: s.bbox_max_lat,
              bboxMaxLng: s.bbox_max_lng,
              createdBy: s.created_by,
              createdAt: s.created_at,
            },
          ]
        : [];
    }
    if (
      trimmed.startsWith('SELECT id, name, sport, distance_m') &&
      trimmed.includes('FROM segments')
    ) {
      const [maxLat, minLat, maxLng, minLng, ...rest] = params as unknown as number[];
      const sportFilter = rest.length === 2 ? String(rest[0]) : null;
      const limit = Number(rest[rest.length - 1]);
      return this.segments
        .filter(
          (s) =>
            Number(s.bbox_min_lat) <= maxLat &&
            Number(s.bbox_max_lat) >= minLat &&
            Number(s.bbox_min_lng) <= maxLng &&
            Number(s.bbox_max_lng) >= minLng &&
            (sportFilter ? s.sport === sportFilter : true),
        )
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          name: s.name,
          sport: s.sport,
          distanceM: s.distance_m,
          bboxMinLat: s.bbox_min_lat,
          bboxMinLng: s.bbox_min_lng,
          bboxMaxLat: s.bbox_max_lat,
          bboxMaxLng: s.bbox_max_lng,
        }));
    }
    if (trimmed.includes('FROM users WHERE handle = ?')) {
      const handle = String(params[0] ?? '').toLowerCase();
      const u = this.users.find((r) => String(r.handle).toLowerCase() === handle);
      return u
        ? [
            {
              id: u.id,
              handle: u.handle,
              displayName: u.displayName ?? null,
              bio: u.bio ?? null,
              location: u.location ?? null,
              createdAt: u.created_at ?? 0,
            },
          ]
        : [];
    }
    if (trimmed.includes('SELECT COUNT(*) FROM follows WHERE followee_id')) {
      const id = params[0];
      return [
        {
          followers: this.follows.filter((f) => f.followee_id === id).length,
          following: this.follows.filter((f) => f.follower_id === id).length,
          activities: this.activities.filter((a) => a.athlete_id === id).length,
        },
      ];
    }
    if (
      trimmed.startsWith('SELECT id, sport, name, started_at') &&
      trimmed.includes('FROM activities')
    ) {
      const id = params[0];
      const cursor = params.length === 3 ? Number(params[1]) : null;
      const limit = Number(params[params.length - 1]);
      const rows = this.activities
        .filter((a) => a.athlete_id === id)
        .filter((a) => (cursor != null ? Number(a.started_at) < cursor : true))
        .sort((a, b) => Number(b.started_at) - Number(a.started_at))
        .slice(0, limit);
      return rows.map((a) => ({
        id: a.id,
        sport: a.sport,
        name: a.name ?? null,
        startedAt: a.started_at,
        totalSeconds: a.total_seconds,
        distanceM: a.distance_m ?? null,
        np: a.np ?? null,
        tss: a.tss ?? null,
      }));
    }
    if (trimmed.startsWith('SELECT 1 AS x FROM follows')) {
      const [follower_id, followee_id] = params;
      const f = this.follows.find(
        (r) => r.follower_id === follower_id && r.followee_id === followee_id,
      );
      return f ? [{ x: 1 }] : [];
    }
    if (trimmed.startsWith('SELECT athlete_id AS athleteId, visibility FROM activities')) {
      const id = params[0];
      const a = this.activities.find((r) => r.id === id);
      return a ? [{ athleteId: a.athlete_id, visibility: a.visibility ?? 'private' }] : [];
    }
    if (trimmed.startsWith('SELECT athlete_id AS athleteId FROM activities')) {
      const id = params[0];
      const a = this.activities.find((r) => r.id === id);
      return a ? [{ athleteId: a.athlete_id }] : [];
    }
    if (trimmed.startsWith('UPDATE activities SET')) {
      const id = params[params.length - 1];
      const a = this.activities.find((r) => r.id === id);
      if (!a) return [];
      const setMatch = trimmed.match(/SET (.+) WHERE/);
      if (!setMatch) return [];
      const cols = setMatch[1]!.split(',').map((s) => s.trim().split(' ')[0]!);
      cols.forEach((col, i) => {
        a[col] = params[i];
      });
      return [];
    }
    if (trimmed.startsWith('INSERT INTO kudos')) {
      const [activity_id, athlete_id] = params;
      if (!this.kudos.find((r) => r.activity_id === activity_id && r.athlete_id === athlete_id)) {
        this.kudos.push({ activity_id, athlete_id, created_at: Math.floor(Date.now() / 1000) });
      }
      return [];
    }
    if (trimmed.startsWith('DELETE FROM kudos')) {
      const [activity_id, athlete_id] = params;
      this.kudos = this.kudos.filter(
        (r) => !(r.activity_id === activity_id && r.athlete_id === athlete_id),
      );
      return [];
    }
    if (trimmed.startsWith('SELECT k.athlete_id AS athleteId')) {
      const aid = params[0];
      return this.kudos
        .filter((k) => k.activity_id === aid)
        .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        .map((k) => {
          const u = this.users.find((r) => r.id === k.athlete_id);
          return {
            athleteId: k.athlete_id,
            handle: u?.handle ?? null,
            displayName: u?.displayName ?? null,
          };
        });
    }
    if (trimmed.startsWith('INSERT INTO comments')) {
      const [id, activity_id, athlete_id, body, parent_id] = params;
      this.comments.push({
        id,
        activity_id,
        athlete_id,
        body,
        parent_id,
        created_at: Math.floor(Date.now() / 1000),
      });
      return [];
    }
    if (trimmed.startsWith('SELECT c.id, c.athlete_id AS athleteId')) {
      const aid = params[0];
      return this.comments
        .filter((c) => c.activity_id === aid)
        .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        .map((c) => {
          const u = this.users.find((r) => r.id === c.athlete_id);
          return {
            id: c.id,
            athleteId: c.athlete_id,
            handle: u?.handle ?? null,
            displayName: u?.displayName ?? null,
            body: c.body,
            parentId: c.parent_id ?? null,
            createdAt: c.created_at,
          };
        });
    }
    if (trimmed.startsWith('SELECT athlete_id AS athleteId FROM comments')) {
      const id = params[0];
      const c = this.comments.find((r) => r.id === id);
      return c ? [{ athleteId: c.athlete_id }] : [];
    }
    if (trimmed.startsWith('DELETE FROM comments')) {
      const id = params[0];
      this.comments = this.comments.filter((c) => c.id !== id);
      return [];
    }
    if (trimmed.includes('FROM activities a') && trimmed.includes('JOIN users u')) {
      const selfId = params[0];
      const followerId = params[1];
      const cursor = params.length === 4 ? Number(params[2]) : null;
      const limit = Number(params[params.length - 1]);
      const followeeIds = new Set(
        this.follows.filter((f) => f.follower_id === followerId).map((f) => f.followee_id),
      );
      const visible = this.activities.filter((a) => {
        if (a.athlete_id === selfId) return true;
        if (a.visibility === 'public') return true;
        if (a.visibility === 'followers' && followeeIds.has(a.athlete_id)) return true;
        return false;
      });
      const filtered = visible.filter((a) =>
        cursor != null ? Number(a.started_at) < cursor : true,
      );
      filtered.sort((a, b) => Number(b.started_at) - Number(a.started_at));
      return filtered.slice(0, limit).map((a) => {
        const u = this.users.find((r) => r.id === a.athlete_id);
        return {
          id: a.id,
          athleteId: a.athlete_id,
          handle: u?.handle ?? null,
          displayName: u?.displayName ?? null,
          sport: a.sport,
          name: a.name ?? null,
          startedAt: a.started_at,
          totalSeconds: a.total_seconds,
          distanceM: a.distance_m ?? null,
          np: a.np ?? null,
          tss: a.tss ?? null,
          hrAvg: a.hr_avg ?? null,
        };
      });
    }
    if (trimmed.startsWith('SELECT date, tss FROM pmc_daily')) {
      const athleteId = params[0];
      const out: Row[] = [];
      for (const v of this.pmcDaily.values()) {
        if (v.athlete_id !== athleteId) continue;
        out.push({ date: v.date, tss: v.tss });
      }
      out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return out;
    }
    if (trimmed.startsWith('INSERT INTO pmc_daily')) {
      const [athlete_id, date, tss] = params as [string, string, number];
      const key = `${athlete_id}:${date}`;
      const cur = this.pmcDaily.get(key);
      if (cur) cur.tss = ((cur.tss as number) ?? 0) + tss;
      else this.pmcDaily.set(key, { athlete_id, date, tss });
      return [];
    }
    return [];
  }
}

export interface FakeR2Object {
  body: ArrayBuffer;
  customMetadata: Record<string, string>;
  httpMetadata: { contentType?: string };
}

export class FakeR2 {
  store = new Map<string, FakeR2Object>();
  put = async (
    key: string,
    body: ArrayBuffer | ArrayBufferView | string,
    opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown> => {
    let ab: ArrayBuffer;
    if (typeof body === 'string') {
      ab = new TextEncoder().encode(body).buffer as ArrayBuffer;
    } else if (body instanceof ArrayBuffer) {
      ab = body;
    } else {
      ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    }
    this.store.set(key, {
      body: ab,
      customMetadata: opts?.customMetadata ?? {},
      httpMetadata: opts?.httpMetadata ?? {},
    });
    return { key };
  };
  get = async (key: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> => {
    const obj = this.store.get(key);
    if (!obj) return null;
    return { arrayBuffer: async () => obj.body };
  };
}

export class FakeQueue<T> {
  sent: T[] = [];
  send = async (msg: T): Promise<void> => {
    this.sent.push(msg);
  };
  sendBatch = async (msgs: { body: T }[]): Promise<void> => {
    for (const m of msgs) this.sent.push(m.body);
  };
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENV: 'dev',
    APP_ORIGIN: 'http://localhost:4321',
    SESSION_SIGNING_KEY: 'test-key-do-not-use-in-prod-32b!!',
    DB: new FakeD1(),
    RAW_BUCKET: new FakeR2() as unknown as R2Bucket,
    PARSED_BUCKET: new FakeR2() as unknown as R2Bucket,
    EXPORTS_BUCKET: new FakeR2() as unknown as R2Bucket,
    KV_SESSIONS: new FakeKV() as unknown as KVNamespace,
    KV_LEADERBOARDS: new FakeKV() as unknown as KVNamespace,
    KV_FEED: new FakeKV() as unknown as KVNamespace,
    INGEST_QUEUE: new FakeQueue() as unknown as Queue,
    ...overrides,
  };
}
