/**
 * Tiny KV-backed sliding-window rate limiter.
 *
 * Trades absolute precision for cheap deploys. Each key is a counter
 * that resets after the window TTL. Good enough to deflect credential
 * stuffing or registration spam from a single IP without standing up a
 * Durable Object.
 *
 * Usage:
 *   const { ok, retryAfter } = await rateLimit(env, `register:${ip}`, 5, 60);
 *   if (!ok) throw new HTTPException(429, { message: 'too many requests' });
 */

import type { Env } from '../env.js';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

export async function rateLimit(
  env: Env,
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const fullKey = `ratelimit:${key}`;
  const raw = await env.KV_SESSIONS.get(fullKey);
  const now = Math.floor(Date.now() / 1000);
  let count = 0;
  let resetAt = now + windowSec;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; resetAt: number };
      if (parsed.resetAt > now) {
        count = parsed.count;
        resetAt = parsed.resetAt;
      }
    } catch {
      // bad record — drop it.
    }
  }
  if (count >= max) {
    return { ok: false, remaining: 0, retryAfter: resetAt - now };
  }
  count++;
  await env.KV_SESSIONS.put(
    fullKey,
    JSON.stringify({ count, resetAt }),
    { expirationTtl: Math.max(1, resetAt - now) },
  );
  return { ok: true, remaining: max - count, retryAfter: resetAt - now };
}

/**
 * Best-effort client IP extraction from CF + standard headers. Falls
 * back to a constant so the limiter still applies in unexpected
 * environments — better one shared bucket than no protection.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
