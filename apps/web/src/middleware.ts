/**
 * Astro middleware — proxies /api/* and /mcp/* to the Worker so the
 * browser sees a single origin (no CORS, no SameSite=None cookie woes).
 *
 * The target is read from the PACELORE_API_ORIGIN env var (set in the
 * Pages dashboard or wrangler.toml). Falls back to the local dev
 * worker for `astro dev`.
 */

import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/mcp')) {
    return next();
  }

  const apiOrigin =
    (context.locals as { runtime?: { env?: { PACELORE_API_ORIGIN?: string } } }).runtime?.env
      ?.PACELORE_API_ORIGIN ??
    import.meta.env.PACELORE_API_ORIGIN ??
    (import.meta.env.PROD
      ? 'https://pacelore-api.typeauth.workers.dev'
      : 'http://127.0.0.1:8787');

  const target = `${apiOrigin.replace(/\/$/, '')}${url.pathname}${url.search}`;
  const init: RequestInit = {
    method: context.request.method,
    headers: context.request.headers,
    body:
      context.request.method === 'GET' || context.request.method === 'HEAD'
        ? undefined
        : context.request.body,
    redirect: 'manual',
  };
  return fetch(target, init);
};
