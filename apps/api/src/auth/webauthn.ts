/**
 * WebAuthn glue. Wraps @simplewebauthn/server with our env conventions.
 *
 * Challenges are short-lived KV records keyed by a temporary id we hand
 * back to the client. The client returns it on the verify call so we
 * can fetch the matching challenge.
 */

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import type { Env } from '../env.js';
import { uuidv7 } from '../util/uuid.js';

export interface RpConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

export function rpFromOrigin(origin: string): RpConfig {
  const u = new URL(origin);
  return { rpId: u.hostname, rpName: 'pacelore', origin };
}

const CHALLENGE_TTL_SECONDS = 5 * 60;

interface ChallengeRecord {
  challenge: string;
  /** For login flows, the user this challenge is associated with. */
  userId?: string;
}

async function storeChallenge(env: Env, record: ChallengeRecord): Promise<string> {
  const id = uuidv7();
  await env.KV_SESSIONS.put(`challenge:${id}`, JSON.stringify(record), {
    expirationTtl: CHALLENGE_TTL_SECONDS,
  });
  return id;
}

async function consumeChallenge(env: Env, id: string): Promise<ChallengeRecord | null> {
  const key = `challenge:${id}`;
  const raw = await env.KV_SESSIONS.get(key, 'json');
  if (raw) await env.KV_SESSIONS.delete(key);
  return (raw as ChallengeRecord | null) ?? null;
}

export interface RegOptions {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export async function startRegistration(
  env: Env,
  rp: RpConfig,
  user: { id: string; handle: string; displayName?: string },
  excludeCredentialIds: string[] = [],
): Promise<RegOptions> {
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.handle,
    userDisplayName: user.displayName ?? user.handle,
    attestationType: 'none',
    excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });
  const challengeId = await storeChallenge(env, { challenge: options.challenge, userId: user.id });
  return { challengeId, options };
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}

export async function finishRegistration(
  env: Env,
  rp: RpConfig,
  challengeId: string,
  response: RegistrationResponseJSON,
): Promise<VerifiedRegistration> {
  const ch = await consumeChallenge(env, challengeId);
  if (!ch) throw new Error('challenge expired or not found');
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('registration not verified');
  }
  const info = verification.registrationInfo;
  const out: VerifiedRegistration = {
    credentialId: info.credential.id,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
  };
  if (info.credential.transports) out.transports = info.credential.transports;
  return out;
}

export interface AuthOptions {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export async function startAuthentication(
  env: Env,
  rp: RpConfig,
  allowCredentialIds: string[] = [],
  userId?: string,
): Promise<AuthOptions> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: allowCredentialIds.map((id) => ({ id })),
    userVerification: 'preferred',
  });
  const record: ChallengeRecord = userId
    ? { challenge: options.challenge, userId }
    : { challenge: options.challenge };
  const challengeId = await storeChallenge(env, record);
  return { challengeId, options };
}

export interface VerifiedAuthentication {
  credentialId: string;
  newCounter: number;
}

export async function finishAuthentication(
  env: Env,
  rp: RpConfig,
  challengeId: string,
  response: AuthenticationResponseJSON,
  credential: { id: string; publicKey: Uint8Array; counter: number },
): Promise<VerifiedAuthentication> {
  const ch = await consumeChallenge(env, challengeId);
  if (!ch) throw new Error('challenge expired or not found');
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    credential: {
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
    },
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error('authentication not verified');
  return {
    credentialId: credential.id,
    newCounter: verification.authenticationInfo.newCounter,
  };
}
