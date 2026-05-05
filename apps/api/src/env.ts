/**
 * Worker bindings declared in wrangler.toml.
 * Centralized so route handlers can import the canonical type.
 */

export interface Env {
  // Vars
  ENV: 'dev' | 'staging' | 'production';
  APP_ORIGIN: string;

  // Secrets
  SESSION_SIGNING_KEY: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  GARMIN_CONSUMER_KEY?: string;
  GARMIN_CONSUMER_SECRET?: string;
  ARWEAVE_TURBO_TOKEN?: string;
  ATPROTO_PDS_URL?: string;
  /** Default `From` value, e.g. "PaceLore <noreply@notifications.pacelore.com>". */
  EMAIL_FROM?: string;

  /** Cloudflare Email Service binding (outbound transactional). */
  EMAIL?: EmailSendBinding;

  // Storage
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  PARSED_BUCKET: R2Bucket;
  EXPORTS_BUCKET: R2Bucket;

  // KV
  KV_SESSIONS: KVNamespace;
  KV_LEADERBOARDS: KVNamespace;
  KV_FEED: KVNamespace;

  // Queues
  INGEST_QUEUE: Queue<IngestJob>;
}

/**
 * Cloudflare Email Service binding shape (`send_email` in wrangler).
 * Mirrors the documented `env.EMAIL.send(...)` API.
 */
export interface EmailSendBinding {
  send(message: {
    to: string | string[];
    from: string;
    subject: string;
    html?: string;
    text?: string;
    reply_to?: string;
    headers?: Record<string, string>;
  }): Promise<unknown>;
}

export interface IngestJob {
  activityId: string;
  athleteId: string;
  rawR2Path: string;
  source: 'fit' | 'tcx' | 'gpx';
  /** Provider that originated this activity, when known. Used for
   * de-duplication on re-import. */
  externalSource?: 'strava' | 'garmin';
  /** Provider-side activity id (Strava activity id, Garmin summary id). */
  externalId?: string;
}
