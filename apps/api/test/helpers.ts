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
      });
      return [];
    }
    if (trimmed.startsWith('INSERT INTO activity_metrics')) {
      const [activity_id, key, value] = params;
      this.activityMetrics.push({ activity_id, key, value });
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
