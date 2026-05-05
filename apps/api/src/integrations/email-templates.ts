/**
 * Branded email templates. Match the design system tokens used in the
 * web app (ink ramp, volt accent, Geist on mono numerics, hairline
 * borders, no gradients). Email clients ignore <style> blocks
 * inconsistently, so every rule is inlined.
 *
 * Each template returns `{subject, html, text}`. Pass through sendEmail.
 */

interface Shell {
  appOrigin: string;
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
  footerNote?: string;
}

function shell(s: Shell): string {
  const origin = s.appOrigin.replace(/\/$/, '');
  const cta =
    s.ctaHref && s.ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
           <tr><td style="background:#C8FA1F;border-radius:6px;">
             <a href="${s.ctaHref}" style="display:inline-block;padding:12px 20px;color:#0E1012;font-family:Inter,system-ui,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">
               ${s.ctaLabel}
             </a>
           </td></tr>
         </table>`
      : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>${escapeHtml(s.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF7;font-family:Inter,'Segoe UI',Roboto,system-ui,sans-serif;color:#16161A;">
<span style="display:none;font-size:1px;color:#FAFAF7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
${escapeHtml(s.preheader)}
</span>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FAFAF7;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;background:#FFFFFE;border:1px solid #ECECE6;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px 8px;border-bottom:1px solid #ECECE6;">
        <a href="${origin}" style="text-decoration:none;color:#16161A;font-family:Inter,system-ui,sans-serif;font-size:18px;font-weight:600;letter-spacing:-0.02em;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:#C8FA1F;margin-right:8px;vertical-align:middle;"></span>
          pacelore
        </a>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;font-family:Inter,system-ui,sans-serif;font-size:24px;line-height:1.2;letter-spacing:-0.015em;color:#16161A;font-weight:600;">
          ${escapeHtml(s.heading)}
        </h1>
        <div style="font-size:15px;line-height:1.55;color:#16161A;">
          ${s.bodyHtml}
        </div>
        ${cta}
        ${
          s.footerNote
            ? `<p style="font-size:13px;color:#7A7A75;margin:20px 0 0;line-height:1.5;">${s.footerNote}</p>`
            : ''
        }
      </td></tr>
      <tr><td style="padding:18px 28px 22px;border-top:1px solid #ECECE6;font-size:12px;color:#9C9C95;font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;letter-spacing:0.04em;text-transform:uppercase;">
        pacelore — your data, your archive ·
        <a href="${origin}/settings" style="color:#9C9C95;text-decoration:underline;">notification settings</a>
      </td></tr>
    </table>
    <p style="font-family:Inter,system-ui,sans-serif;font-size:11px;color:#9C9C95;margin:14px 0 0;text-align:center;letter-spacing:0.02em;">
      Sent to you by pacelore. PolyForm Noncommercial 1.0.0.
    </p>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- Templates ----------------

export interface RenderArgs {
  appOrigin: string;
  athlete: { handle: string; displayName?: string | null };
}

export function welcomeEmail(a: RenderArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = 'Welcome to pacelore';
  const heading = `Welcome, ${escapeHtml(a.athlete.displayName ?? a.athlete.handle)}.`;
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: 'Your data, your archive. Connect your sources or drop a FIT to get started.',
    heading,
    bodyHtml: `
      <p style="margin:0 0 14px;">
        Account is live. Three things worth doing first:
      </p>
      <ol style="margin:0 0 14px 18px;padding:0;">
        <li style="margin-bottom:8px;">Connect Strava or Garmin and start a backfill — pacelore walks the whole history, dedups against itself, and keeps PMC consistent.</li>
        <li style="margin-bottom:8px;">Set FTP and HRmax on your settings page so TSS, IF, and zone time-in-zone numbers are real, not approximate.</li>
        <li style="margin-bottom:0;">Browse the workout library — 60 calibrated sessions, filterable by sport, duration, and intensity.</li>
      </ol>
      <p style="margin:14px 0 0;">No silent paywalls. Pricing transparent. Data exports free.</p>
    `,
    ctaHref: `${origin}/upload`,
    ctaLabel: 'Import your training history',
    footerNote:
      'You got this email because you just created a pacelore account. If that wasn\'t you, contact support.',
  });
  const text = `Welcome, ${a.athlete.displayName ?? a.athlete.handle}.

Account is live. Three things worth doing first:
1. Connect Strava or Garmin and start a backfill at ${origin}/upload.
2. Set FTP and HRmax at ${origin}/settings.
3. Browse the workout library at ${origin}/workouts.

No silent paywalls. Pricing transparent. Data exports free.
`;
  return { subject, html, text };
}

export function accountDeletedEmail(a: RenderArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = 'Your pacelore account has been deleted';
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: 'Confirmation: account closed and data scheduled for purge.',
    heading: 'Account deleted.',
    bodyHtml: `
      <p style="margin:0 0 14px;">
        We've closed the pacelore account for <strong>@${escapeHtml(a.athlete.handle)}</strong>. Activity files,
        metrics, and feed history are scheduled for purge from D1 + R2 within 30 days. Backups
        roll out within 90.
      </p>
      <p style="margin:0 0 14px;">
        If this wasn't you, reply to this email within 7 days and we'll reverse the close.
      </p>
    `,
    ctaHref: `${origin}/`,
    ctaLabel: 'Back to pacelore.com',
    footerNote: 'Need an export of anything before the purge runs? Reply and we\'ll cut a tarball.',
  });
  const text = `Account deleted.

We've closed the pacelore account for @${a.athlete.handle}. Files, metrics, and feed history are scheduled for purge from D1 + R2 within 30 days. Backups roll out within 90.

If this wasn't you, reply within 7 days and we'll reverse the close.
`;
  return { subject, html, text };
}

export interface KudosArgs extends RenderArgs {
  kudosFromHandle: string;
  kudosFromName: string;
  activityId: string;
  activityName: string;
}

export function kudosEmail(a: KudosArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = `${a.kudosFromName} gave you kudos`;
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: `${a.kudosFromName} kudoed your "${a.activityName}".`,
    heading: `${escapeHtml(a.kudosFromName)} gave you kudos.`,
    bodyHtml: `
      <p style="margin:0;">
        On your activity <a href="${origin}/activity/${escapeHtml(a.activityId)}" style="color:#16161A;text-decoration:underline;">${escapeHtml(a.activityName)}</a>.
      </p>
    `,
    ctaHref: `${origin}/activity/${a.activityId}`,
    ctaLabel: 'Open activity',
  });
  const text = `${a.kudosFromName} gave you kudos on your "${a.activityName}".\n\n${origin}/activity/${a.activityId}`;
  return { subject, html, text };
}

export interface CommentArgs extends RenderArgs {
  commenterName: string;
  activityId: string;
  activityName: string;
  body: string;
}

export function commentEmail(a: CommentArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = `${a.commenterName} commented on your activity`;
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: `${a.commenterName}: ${a.body.slice(0, 80)}`,
    heading: `${escapeHtml(a.commenterName)} commented.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">On <a href="${origin}/activity/${escapeHtml(a.activityId)}" style="color:#16161A;text-decoration:underline;">${escapeHtml(a.activityName)}</a>:</p>
      <blockquote style="margin:0;padding:12px 16px;background:#F4F4EE;border-left:3px solid #C8FA1F;border-radius:0 6px 6px 0;font-size:15px;line-height:1.55;color:#16161A;white-space:pre-wrap;">
        ${escapeHtml(a.body)}
      </blockquote>
    `,
    ctaHref: `${origin}/activity/${a.activityId}#comments`,
    ctaLabel: 'Reply',
  });
  const text = `${a.commenterName} commented on "${a.activityName}":\n\n${a.body}\n\n${origin}/activity/${a.activityId}#comments`;
  return { subject, html, text };
}

export interface FollowArgs extends RenderArgs {
  followerName: string;
  followerHandle: string;
}

export function newFollowerEmail(a: FollowArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = `${a.followerName} followed you`;
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: `@${a.followerHandle} is now following your activities.`,
    heading: `${escapeHtml(a.followerName)} followed you.`,
    bodyHtml: `
      <p style="margin:0;">
        @${escapeHtml(a.followerHandle)} will see your public activities in their feed.
      </p>
    `,
    ctaHref: `${origin}/athletes/${a.followerHandle}`,
    ctaLabel: 'View profile',
  });
  const text = `${a.followerName} (@${a.followerHandle}) followed you.\n\n${origin}/athletes/${a.followerHandle}`;
  return { subject, html, text };
}

export interface ImportDoneArgs extends RenderArgs {
  provider: 'strava' | 'garmin';
  succeeded: number;
  duplicates: number;
  failed: number;
}

export function importDoneEmail(a: ImportDoneArgs) {
  const origin = a.appOrigin.replace(/\/$/, '');
  const subject = `${a.provider} backfill complete · ${a.succeeded} activities imported`;
  const html = shell({
    appOrigin: a.appOrigin,
    preheader: `${a.succeeded} new · ${a.duplicates} duplicates skipped · ${a.failed} failed`,
    heading: `${a.provider} backfill complete.`,
    bodyHtml: `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border-collapse:collapse;font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:14px;">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #ECECE6;">imported</td>
          <td style="padding:8px 0;border-bottom:1px solid #ECECE6;text-align:right;font-weight:600;">${a.succeeded}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #ECECE6;">already had</td>
          <td style="padding:8px 0;border-bottom:1px solid #ECECE6;text-align:right;">${a.duplicates}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;">failed</td>
          <td style="padding:8px 0;text-align:right;color:${a.failed > 0 ? '#A4291C' : '#16161A'};">${a.failed}</td>
        </tr>
      </table>
      <p style="margin:0;">PMC + zone numbers have been recomputed across the imported window.</p>
    `,
    ctaHref: `${origin}/dashboard`,
    ctaLabel: 'Open PMC dashboard',
  });
  const text = `${a.provider} backfill complete.

Imported: ${a.succeeded}
Already had: ${a.duplicates}
Failed: ${a.failed}

${origin}/dashboard
`;
  return { subject, html, text };
}
