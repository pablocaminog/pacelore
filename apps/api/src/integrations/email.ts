/**
 * Transactional email sender — Cloudflare Email Service.
 *
 *   Binding: `EMAIL` (configured in wrangler as `send_email`).
 *   Sender:  pacelore.com (verified at the account level).
 *
 * Falls back to a no-op + console warning when the binding is missing
 * (local `astro dev` without the worker running, or a fresh deploy
 * before the binding is wired). Caller never has to wrap a try/catch.
 */

import type { Env } from '../env.js';

export interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional reply-to address. Defaults to the from address. */
  replyTo?: string;
  /** Stable identifier; passed through as the Message-ID header so a
   * retry deterministically lands as the same message. */
  idempotencyKey?: string;
}

export interface EmailResult {
  ok: boolean;
  error?: string;
}

export async function sendEmail(env: Env, req: EmailRequest): Promise<EmailResult> {
  if (!env.EMAIL) {
    console.warn('email skipped (EMAIL binding not configured)', {
      to: req.to,
      subject: req.subject,
    });
    return { ok: false, error: 'email binding not configured' };
  }
  const from = env.EMAIL_FROM ?? 'PaceLore <noreply@pacelore.com>';
  const headers: Record<string, string> = {
    'List-Unsubscribe': `<${env.APP_ORIGIN.replace(/\/$/, '')}/settings>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  if (req.idempotencyKey) {
    headers['Message-ID'] = `<${req.idempotencyKey}@pacelore.com>`;
  }
  try {
    await env.EMAIL.send({
      from,
      to: req.to,
      subject: req.subject,
      html: req.html,
      text: req.text,
      reply_to: req.replyTo ?? from,
      headers,
    });
    return { ok: true };
  } catch (err) {
    console.warn('email send failed', err);
    return { ok: false, error: (err as Error).message };
  }
}
