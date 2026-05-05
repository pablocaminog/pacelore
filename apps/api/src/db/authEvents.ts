/**
 * Append-only audit log for security-sensitive events. Best-effort —
 * a write failure must never block the auth flow.
 */

import type { Env } from '../env.js';
import { uuidv7 } from '../util/uuid.js';

export type AuthEventKind =
  | 'register'
  | 'login_ok'
  | 'login_fail'
  | 'logout'
  | 'account_delete'
  | 'credential_added';

export interface LogAuthEventInput {
  kind: AuthEventKind;
  athleteId?: string | null;
  detail?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logAuthEvent(env: Env, ev: LogAuthEventInput): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO auth_events (id, athlete_id, kind, detail, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuidv7(),
        ev.athleteId ?? null,
        ev.kind,
        ev.detail ?? null,
        ev.ip ?? null,
        ev.userAgent ? ev.userAgent.slice(0, 200) : null,
      )
      .run();
  } catch (err) {
    console.warn('auth event write failed', err);
  }
}
