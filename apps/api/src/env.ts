/**
 * Worker bindings declared in wrangler.toml.
 * Centralized so route handlers can import the canonical type.
 */

export interface Env {
  // Vars
  ENV: 'dev' | 'staging' | 'production';
  APP_ORIGIN: string;
  /** When `'true'`, demoGuard middleware blocks all non-GET writes. */
  DEMO_MODE?: 'true' | 'false';

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
  INGEST_QUEUE: Queue<QueueJob>;
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

/**
 * Discriminated union over the queue's job types. Adding `kind`
 * keeps backwards compatibility — old messages without it default to
 * 'activity' in the consumer.
 */
export type QueueJob = ActivityIngestJob | ArchiveProcessJob;

export interface ActivityIngestJob {
  kind?: 'activity';
  activityId: string;
  athleteId: string;
  rawR2Path: string;
  source: 'fit' | 'tcx' | 'gpx';
  externalSource?: 'strava' | 'garmin';
  externalId?: string;
}

export interface ArchiveProcessJob {
  kind: 'archive';
  archiveId: string;
  athleteId: string;
  /** R2 key under RAW_BUCKET — full archive blob. */
  r2Path: string;
  filename: string;
}

/** @deprecated Use {@link ActivityIngestJob}. Kept for back-compat
 *  in routes that still type as `IngestJob`. */
export type IngestJob = ActivityIngestJob;
