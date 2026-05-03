/**
 * D1 user + credential queries. Tiny helpers, no ORM.
 */

import type { Env } from '../env.js';

export interface User {
  id: string;
  handle: string;
  email: string;
  displayName: string | null;
}

export async function findUserByEmail(env: Env, email: string): Promise<User | null> {
  const row = await env.DB.prepare(
    'SELECT id, handle, email, display_name AS displayName FROM users WHERE email = ? COLLATE NOCASE',
  )
    .bind(email)
    .first<User>();
  return row ?? null;
}

export async function findUserById(env: Env, id: string): Promise<User | null> {
  const row = await env.DB.prepare(
    'SELECT id, handle, email, display_name AS displayName FROM users WHERE id = ?',
  )
    .bind(id)
    .first<User>();
  return row ?? null;
}

export async function createUser(
  env: Env,
  user: { id: string; handle: string; email: string; displayName?: string },
): Promise<void> {
  await env.DB.prepare('INSERT INTO users (id, handle, email, display_name) VALUES (?, ?, ?, ?)')
    .bind(user.id, user.handle, user.email, user.displayName ?? null)
    .run();
}

export interface CredentialRow {
  id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
}

export async function listCredentialsForUser(env: Env, userId: string): Promise<CredentialRow[]> {
  const result = await env.DB.prepare(
    'SELECT id, user_id, public_key, counter, transports FROM webauthn_credentials WHERE user_id = ?',
  )
    .bind(userId)
    .all<CredentialRow>();
  return result.results ?? [];
}

export async function findCredentialById(
  env: Env,
  credentialId: string,
): Promise<CredentialRow | null> {
  const row = await env.DB.prepare(
    'SELECT id, user_id, public_key, counter, transports FROM webauthn_credentials WHERE id = ?',
  )
    .bind(credentialId)
    .first<CredentialRow>();
  return row ?? null;
}

export async function insertCredential(
  env: Env,
  cred: {
    id: string;
    userId: string;
    publicKey: Uint8Array;
    counter: number;
    transports?: string[];
    deviceName?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, device_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      cred.id,
      cred.userId,
      cred.publicKey,
      cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null,
      cred.deviceName ?? null,
    )
    .run();
}

export async function bumpCredentialCounter(
  env: Env,
  credentialId: string,
  newCounter: number,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE webauthn_credentials SET counter = ?, last_used_at = unixepoch() WHERE id = ?',
  )
    .bind(newCounter, credentialId)
    .run();
}
