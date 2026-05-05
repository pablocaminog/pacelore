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
  /** Resend API key for transactional email. Optional in dev. */
  RESEND_API_KEY?: string;
  /** Default `From` value, e.g. "PaceLore <noreply@notifications.pacelore.com>". */
  EMAIL_FROM?: string;

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
