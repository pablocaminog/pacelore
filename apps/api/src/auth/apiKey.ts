/**
 * API key auth — third parties hit the public API with a header
 * `X-Api-Key: osk_<id>.<secret>`. Server fetches the row by id, verifies
 * SHA-256(secret) matches hashed_key, and exposes the resolved user
 * id via Hono context.
 */

import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';

const encoder = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ApiKeyContext {
  userId: string;
  scopes: string[];
}

export interface ApiKeyVariables {
  apiKey: ApiKeyContext;
}

export function requireApiKey(
  requiredScope?: string,
): MiddlewareHandler<{ Bindings: Env; Variables: ApiKeyVariables }> {
  return async (c, next) => {
    const header = c.req.header('X-Api-Key');
    if (!header) throw new HTTPException(401, { message: 'X-Api-Key required' });
    const dot = header.indexOf('.');
    if (dot <= 0) throw new HTTPException(401, { message: 'malformed key' });
    const id = header.slice(0, dot);
    const secret = header.slice(dot + 1);
    const row = await c.env.DB.prepare(
      'SELECT id, user_id AS userId, hashed_key AS hashedKey, scopes, revoked_at AS revokedAt FROM api_keys WHERE id = ?',
    )
      .bind(id)
      .first<{
        id: string;
        userId: string;
        hashedKey: string;
        scopes: string;
        revokedAt: number | null;
      }>();
    if (!row) throw new HTTPException(401, { message: 'unknown key' });
    if (row.revokedAt) throw new HTTPException(401, { message: 'revoked' });
    const hash = await sha256Hex(secret);
    if (hash !== row.hashedKey) throw new HTTPException(401, { message: 'bad secret' });
    const scopes = row.scopes.split(',').map((s) => s.trim());
    if (requiredScope && !scopes.includes(requiredScope)) {
      throw new HTTPException(403, { message: `missing scope: ${requiredScope}` });
    }
    c.set('apiKey', { userId: row.userId, scopes });
    // Async last_used_at update — don't block the request.
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?')
        .bind(id)
        .run(),
    );
    await next();
  };
}

export async function mintApiKey(
  env: Env,
  userId: string,
  scopes: string[],
  name?: string,
): Promise<{ id: string; secret: string; key: string }> {
  // id: 16 random bytes prefixed; secret: 32 random bytes
  const idBytes = new Uint8Array(12);
  crypto.getRandomValues(idBytes);
  const id = 'osk_' + base32(idBytes);
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = base32(secretBytes);
  const hashed = await sha256Hex(secret);
  await env.DB.prepare(
    'INSERT INTO api_keys (id, user_id, hashed_key, scopes, name) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, hashed, scopes.join(','), name ?? null)
    .run();
  return { id, secret, key: `${id}.${secret}` };
}

function base32(bytes: Uint8Array): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += alpha[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += alpha[(value << (5 - bits)) & 0x1f];
  return out;
}
