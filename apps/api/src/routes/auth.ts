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
  const body = await readJson<{ handle?: string; email?: string }>(c.req.raw);
  const handle = body.handle?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!handle || !email) throw new HTTPException(400, { message: 'handle and email required' });
  if (!isValidHandle(handle)) throw new HTTPException(400, { message: 'invalid handle' });
  if (!isValidEmail(email)) throw new HTTPException(400, { message: 'invalid email' });

  // Email may already exist — that's a login flow, not register.
  if (await findUserByEmail(c.env, email)) {
    throw new HTTPException(409, { message: 'email already registered' });
  }

  const userId = uuidv7();
  await createUser(c.env, { id: userId, handle, email });

  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  const { challengeId, options } = await startRegistration(c.env, rp, { id: userId, handle });
  return c.json({ challengeId, userId, options });
});

authRoutes.post('/auth/register/verify', async (c) => {
  const body = await readJson<{
    challengeId?: string;
    userId?: string;
    response?: unknown;
    deviceName?: string;
  }>(c.req.raw);
  if (!body.challengeId || !body.userId || !body.response) {
    throw new HTTPException(400, { message: 'missing required fields' });
  }
  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  const verified = await finishRegistration(c.env, rp, body.challengeId, body.response as never);

  await insertCredential(c.env, {
    id: verified.credentialId,
    userId: body.userId,
    publicKey: verified.publicKey,
    counter: verified.counter,
    ...(verified.transports ? { transports: verified.transports as string[] } : {}),
    ...(body.deviceName ? { deviceName: body.deviceName } : {}),
  });

  const { cookie } = await createSession(c.env, body.userId);
  c.header('Set-Cookie', cookie);
  return c.json({ ok: true, userId: body.userId });
});

authRoutes.post('/auth/login/options', async (c) => {
  const body = await readJson<{ email?: string }>(c.req.raw);
  const rp = rpFromOrigin(c.env.APP_ORIGIN);

  let allowCredentialIds: string[] = [];
  let userId: string | undefined;
  if (body.email) {
    const user = await findUserByEmail(c.env, body.email.toLowerCase());
    if (!user) throw new HTTPException(404, { message: 'no account for that email' });
    userId = user.id;
    const creds = await listCredentialsForUser(c.env, user.id);
    allowCredentialIds = creds.map((cr) => cr.id);
  }
  const { challengeId, options } = await startAuthentication(c.env, rp, allowCredentialIds, userId);
  return c.json({ challengeId, options });
});

authRoutes.post('/auth/login/verify', async (c) => {
  const body = await readJson<{ challengeId?: string; response?: { id?: string } }>(c.req.raw);
  if (!body.challengeId || !body.response?.id) {
    throw new HTTPException(400, { message: 'missing required fields' });
  }
  const cred = await findCredentialById(c.env, body.response.id);
  if (!cred) throw new HTTPException(401, { message: 'unknown credential' });

  const rp = rpFromOrigin(c.env.APP_ORIGIN);
  const verified = await finishAuthentication(c.env, rp, body.challengeId, body.response as never, {
    id: cred.id,
    publicKey: new Uint8Array(cred.public_key),
    counter: cred.counter,
  });
  await bumpCredentialCounter(c.env, cred.id, verified.newCounter);

  const { cookie } = await createSession(c.env, cred.user_id);
  c.header('Set-Cookie', cookie);
  return c.json({ ok: true, userId: cred.user_id });
});

authRoutes.post('/auth/logout', async (c) => {
  const cookie = await destroySession(c.env, c.req.header('Cookie') ?? null);
  c.header('Set-Cookie', cookie);
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

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

void SESSION_COOKIE;
