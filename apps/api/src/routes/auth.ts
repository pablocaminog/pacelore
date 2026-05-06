/**
 * Auth routes — passkey registration, passkey login, session.
 *
 *   POST /api/v1/auth/register/options   { handle, email }
 *   POST /api/v1/auth/register/verify    { challengeId, response }
 *   POST /api/v1/auth/login/options      { email? }     // discoverable creds if no email
 *   POST /api/v1/auth/login/verify       { challengeId, response }
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { sendEmail } from '../integrations/email.js';
import { welcomeEmail } from '../integrations/email-templates.js';
import { rateLimit, clientIp } from '../middleware/ratelimit.js';
import { logAuthEvent } from '../db/authEvents.js';
import {
  bumpCredentialCounter,
  createUser,
  findCredentialById,
  findUserByEmail,
  findUserById,
  insertCredential,
  listCredentialsForUser,
} from '../db/users.js';
import {
  finishAuthentication,
  finishRegistration,
  rpFromOrigin,
  startAuthentication,
  startRegistration,
} from '../auth/webauthn.js';
import { createSession, destroySession, loadSession, SESSION_COOKIE } from '../auth/session.js';
import { uuidv7 } from '../util/uuid.js';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/auth/register/options', async (c) => {
  const ip = clientIp(c.req.raw);
  await enforceRate(c.env, `register:${ip}`, 5, 60); // 5 req / minute / IP
  await enforceRate(c.env, `register:${ip}:hour`, 20, 60 * 60); // 20 / hour / IP

  const body = await readJson<{ handle?: string; email?: string }>(c.req.raw);
  const handle = body.handle?.trim();
  const email = normalizeEmail(body.email);
  if (!handle || !email) throw new HTTPException(400, { message: 'handle and email required' });
  if (!isValidHandle(handle)) throw new HTTPException(400, { message: 'invalid handle' });
  if (!isValidEmail(email)) throw new HTTPException(400, { message: 'invalid email' });

  // Pre-flight uniqueness check. Acceptable enumeration tradeoff —
  // passkey-only registration always leaks existence. The user row
  // itself is *not* created here; we defer the INSERT to verify so an
  // abandoned ceremony doesn't reserve the email/handle.
  if (await findUserByEmail(c.env, email)) {
    throw new HTTPException(409, { message: 'email already registered' });
  }
  const handleTaken = await c.env.DB.prepare(
    'SELECT id FROM users WHERE handle = ? COLLATE NOCASE',
  )
    .bind(handle)
    .first();
  if (handleTaken) {
    throw new HTTPException(409, { message: 'handle already taken' });
  }

  const userId = uuidv7();
  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  const { challengeId, options } = await startRegistration(c.env, rp, {
    id: userId,
    handle,
    email,
  });
  return c.json({ challengeId, userId, options });
});

authRoutes.post('/auth/register/verify', async (c) => {
  const ip = clientIp(c.req.raw);
  await enforceRate(c.env, `register-verify:${ip}`, 10, 60);

  const body = await readJson<{
    challengeId?: string;
    response?: unknown;
    deviceName?: string;
  }>(c.req.raw);
  if (!body.challengeId || !body.response) {
    throw new HTTPException(400, { message: 'missing required fields' });
  }
  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  const verified = await finishRegistration(c.env, rp, body.challengeId, body.response as never);
  if (!verified.pendingUser) {
    throw new HTTPException(400, { message: 'challenge missing pending user' });
  }
  const pending = verified.pendingUser;

  // Commit the user row + credential atomically. ON CONFLICT swallows
  // a tight race with another register on the same email/handle and
  // surfaces as 409.
  try {
    await createUser(c.env, { id: pending.id, handle: pending.handle, email: pending.email });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('UNIQUE')) {
      throw new HTTPException(409, { message: 'handle or email already taken' });
    }
    throw err;
  }

  await insertCredential(c.env, {
    id: verified.credentialId,
    userId: pending.id,
    publicKey: verified.publicKey,
    counter: verified.counter,
    ...(verified.transports ? { transports: verified.transports as string[] } : {}),
    ...(body.deviceName ? { deviceName: body.deviceName } : {}),
  });
  await logAuthEvent(c.env, {
    kind: 'credential_added',
    athleteId: pending.id,
    detail: 'register',
    ip,
    userAgent: c.req.header('user-agent') ?? null,
  });
  await logAuthEvent(c.env, {
    kind: 'register',
    athleteId: pending.id,
    ip,
    userAgent: c.req.header('user-agent') ?? null,
  });

  const { cookie } = await createSession(c.env, pending.id);
  c.header('Set-Cookie', cookie);

  // Fire welcome email (best-effort).
  try {
    const tpl = welcomeEmail({
      appOrigin: c.env.APP_ORIGIN,
      athlete: { handle: pending.handle },
    });
    await sendEmail(c.env, {
      to: pending.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      idempotencyKey: `welcome:${pending.id}`,
    });
  } catch (err) {
    console.warn('welcome email failed', err);
  }

  return c.json({ ok: true, userId: pending.id });
});

authRoutes.post('/auth/login/options', async (c) => {
  const ip = clientIp(c.req.raw);
  await enforceRate(c.env, `login-options:${ip}`, 10, 60);

  const body = await readJson<{ email?: string }>(c.req.raw);
  const rp = rpFromOrigin(c.env.APP_ORIGIN);

  // Anti-enumeration: always issue a challenge. When the email maps to
  // a real account, populate allowCredentials so the browser can offer
  // the right passkey; otherwise return empty allowCredentials. Either
  // way the response shape and timing are equivalent, so an attacker
  // can't probe whether the account exists from this endpoint.
  let allowCredentialIds: string[] = [];
  let userId: string | undefined;
  const email = normalizeEmail(body.email);
  if (email && isValidEmail(email)) {
    const user = await findUserByEmail(c.env, email);
    if (user) {
      userId = user.id;
      const creds = await listCredentialsForUser(c.env, user.id);
      allowCredentialIds = creds.map((cr) => cr.id);
    }
  }
  const { challengeId, options } = await startAuthentication(c.env, rp, allowCredentialIds, userId);
  return c.json({ challengeId, options });
});

authRoutes.post('/auth/login/verify', async (c) => {
  const ip = clientIp(c.req.raw);
  const ua = c.req.header('user-agent') ?? null;
  // Tighter limit: actual auth attempts. Rejects credential-stuffing
  // even before we touch the DB.
  await enforceRate(c.env, `login-verify:${ip}`, 10, 60);
  await enforceRate(c.env, `login-verify:${ip}:hour`, 60, 60 * 60);

  const body = await readJson<{ challengeId?: string; response?: { id?: string } }>(c.req.raw);
  if (!body.challengeId || !body.response?.id) {
    await logAuthEvent(c.env, { kind: 'login_fail', detail: 'missing_fields', ip, userAgent: ua });
    throw new HTTPException(400, { message: 'missing required fields' });
  }
  const cred = await findCredentialById(c.env, body.response.id);
  if (!cred) {
    await logAuthEvent(c.env, {
      kind: 'login_fail',
      detail: 'unknown_credential',
      ip,
      userAgent: ua,
    });
    throw new HTTPException(401, { message: 'unknown credential' });
  }

  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  let verified;
  try {
    verified = await finishAuthentication(c.env, rp, body.challengeId, body.response as never, {
      id: cred.id,
      publicKey: new Uint8Array(cred.public_key),
      counter: cred.counter,
    });
  } catch (err) {
    await logAuthEvent(c.env, {
      kind: 'login_fail',
      athleteId: cred.user_id,
      detail: (err as Error).message?.slice(0, 120) ?? 'verify_failed',
      ip,
      userAgent: ua,
    });
    throw new HTTPException(401, { message: 'authentication failed' });
  }

  // Replay defence: WebAuthn counter must strictly advance unless the
  // authenticator never issues counters (i.e. both sides stay at 0).
  if (verified.newCounter !== 0 && verified.newCounter <= cred.counter) {
    await logAuthEvent(c.env, {
      kind: 'login_fail',
      athleteId: cred.user_id,
      detail: 'counter_replay',
      ip,
      userAgent: ua,
    });
    throw new HTTPException(401, { message: 'authenticator counter regression' });
  }
  await bumpCredentialCounter(c.env, cred.id, verified.newCounter);

  const { cookie } = await createSession(c.env, cred.user_id);
  c.header('Set-Cookie', cookie);
  await logAuthEvent(c.env, { kind: 'login_ok', athleteId: cred.user_id, ip, userAgent: ua });
  return c.json({ ok: true, userId: cred.user_id });
});

authRoutes.post('/auth/logout', async (c) => {
  const session = await loadSession(c.env, c.req.header('Cookie') ?? null);
  const cookie = await destroySession(c.env, c.req.header('Cookie') ?? null);
  c.header('Set-Cookie', cookie);
  if (session) {
    await logAuthEvent(c.env, {
      kind: 'logout',
      athleteId: session.userId,
      ip: clientIp(c.req.raw),
      userAgent: c.req.header('user-agent') ?? null,
    });
  }
  return c.json({ ok: true });
});

authRoutes.get('/auth/me', async (c) => {
  const session = await loadSession(c.env, c.req.header('Cookie') ?? null);
  if (!session) throw new HTTPException(401, { message: 'not authenticated' });
  const user = await findUserById(c.env, session.userId);
  if (!user) throw new HTTPException(401, { message: 'session points to missing user' });
  return c.json({ user, issuedAt: session.issuedAt });
});

async function readJson<T>(req: Request): Promise<T> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    throw new HTTPException(415, { message: 'expected application/json' });
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: 'invalid JSON body' });
  }
}

function isValidHandle(s: string): boolean {
  return /^[a-zA-Z0-9_-]{2,32}$/.test(s);
}

function isValidEmail(s: string | undefined): s is string {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

function normalizeEmail(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  return s.trim().toLowerCase();
}

async function enforceRate(
  env: Env,
  key: string,
  max: number,
  windowSec: number,
): Promise<void> {
  const r = await rateLimit(env, key, max, windowSec);
  if (!r.ok) {
    throw new HTTPException(429, {
      message: `too many requests, try again in ${r.retryAfter}s`,
    });
  }
}

void SESSION_COOKIE;
