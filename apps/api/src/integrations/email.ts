/**
 * Transactional email sender.
 *
 * Provider: Resend (https://resend.com). Reasons:
 *   - clean REST API, single-call send
 *   - works fine from a Cloudflare Worker (no SMTP)
 *   - DKIM/SPF setup happens once on the sending subdomain
 *
 * Sending domain: notifications.pacelore.com — verified separately
 * with Resend (TXT + DKIM CNAMEs added on the zone).
 *
 * If RESEND_API_KEY is unset (e.g. local dev) this module logs and
 * returns ok=false instead of throwing so callers don't have to
 * wrap every send in try/catch.
 */

import type { Env } from '../env.js';

export interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional reply-to address. Defaults to the from address. */
  replyTo?: string;
  /** Stable identifier used for idempotency (Resend de-dups). */
  idempotencyKey?: string;
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';

export async function sendEmail(env: Env, req: EmailRequest): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) {
    console.warn('email skipped (RESEND_API_KEY not set)', { to: req.to, subject: req.subject });
    return { ok: false, error: 'email provider not configured' };
  }
  const from =
    env.EMAIL_FROM ?? 'PaceLore <noreply@notifications.pacelore.com>';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
  };
  if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: [req.to],
        subject: req.subject,
        html: req.html,
        text: req.text,
        reply_to: req.replyTo ?? from,
        headers: {
          'List-Unsubscribe': `<${env.APP_ORIGIN.replace(/\/$/, '')}/settings>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('email send failed', res.status, detail);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { id?: string };
    return body.id ? { ok: true, id: body.id } : { ok: true };
  } catch (err) {
    console.warn('email send threw', err);
    return { ok: false, error: (err as Error).message };
  }
}
