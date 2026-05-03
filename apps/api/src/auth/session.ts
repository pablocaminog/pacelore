/**
 * Session management.
 *
 *   - 32-byte random session id
 *   - signed (HMAC-SHA256) and stored in an HttpOnly cookie
 *   - server-side state lives in KV_SESSIONS with a configurable TTL
 *
 * The cookie value is `<sid>.<sig>` where sig is base64url(HMAC(sid)).
 * Both halves must verify before we trust the lookup. This blocks
 * tampering with the sid even if a session record is leaked elsewhere.
 */

import type { Env } from '../env.js';

export interface SessionRecord {
  userId: string;
  /** Unix seconds when the record was issued. */
  issuedAt: number;
  /** Optional metadata (UA fingerprint hash, ip, etc.). */
  meta?: Record<string, string>;
}

export const SESSION_COOKIE = 'osr_sid';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d
const SIGNING_ALGO = { name: 'HMAC', hash: 'SHA-256' } as const;

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), SIGNING_ALGO, false, [
    'sign',
    'verify',
  ]);
}

function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBuf(s: string): ArrayBuffer {
  const norm = s.replaceAll('-', '+').replaceAll('_', '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function randomSid(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bufToBase64Url(buf.buffer);
}

async function sign(secret: string, sid: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(SIGNING_ALGO, key, encoder.encode(sid));
  return bufToBase64Url(sig);
}

async function verify(secret: string, sid: string, sig: string): Promise<boolean> {
  const key = await importKey(secret);
  try {
    return await crypto.subtle.verify(SIGNING_ALGO, key, base64UrlToBuf(sig), encoder.encode(sid));
  } catch {
    return false;
  }
}

export async function createSession(
  env: Env,
  userId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  meta?: Record<string, string>,
): Promise<{ sid: string; cookie: string; record: SessionRecord }> {
  const sid = randomSid();
  const record: SessionRecord = {
    userId,
    issuedAt: Math.floor(Date.now() / 1000),
    ...(meta ? { meta } : {}),
  };
  await env.KV_SESSIONS.put(`session:${sid}`, JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });
  const sig = await sign(env.SESSION_SIGNING_KEY, sid);
  const value = `${sid}.${sig}`;
  const cookie = formatCookie(value, ttlSeconds, env.ENV !== 'dev');
  return { sid, cookie, record };
}

export async function loadSession(
  env: Env,
  cookieHeader: string | null,
): Promise<SessionRecord | null> {
  const value = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const sid = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!(await verify(env.SESSION_SIGNING_KEY, sid, sig))) return null;
  const raw = await env.KV_SESSIONS.get(`session:${sid}`, 'json');
  return (raw as SessionRecord | null) ?? null;
}

export async function destroySession(env: Env, cookieHeader: string | null): Promise<string> {
  const value = parseCookie(cookieHeader, SESSION_COOKIE);
  if (value) {
    const sid = value.split('.', 1)[0];
    if (sid) await env.KV_SESSIONS.delete(`session:${sid}`);
  }
  return formatCookie('', 0, env.ENV !== 'dev');
}

function formatCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  flags.push(`Max-Age=${maxAgeSeconds}`);
  return `${SESSION_COOKIE}=${value}; ${flags.join('; ')}`;
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === name) return p.slice(eq + 1).trim();
  }
  return null;
}
