import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env.js';

/**
 * When the worker runs against the demo environment (`DEMO_MODE=true`),
 * block every state-changing request from reaching downstream handlers.
 *
 * Read methods (GET/HEAD/OPTIONS) pass through.
 * Write methods (POST/PUT/PATCH/DELETE) return 403 unless the path matches
 * an explicit allowlist (e.g. session creation for the auto-login flow,
 * or any future "sandbox" endpoints we want visitors to exercise).
 *
 * Mount globally in apps/api/src/index.ts BEFORE route handlers so it
 * short-circuits before auth, ratelimit, or DB work runs.
 */

export interface DemoGuardOptions {
  /** Paths (exact or prefix-matched with trailing `/`) that bypass the guard. */
  allowlist?: string[];
}

const DEFAULT_ALLOWLIST = [
  // Auto-login endpoint that mints a read-only session for demo visitors.
  '/api/v1/auth/demo-session',
  // Sandbox-only namespace if/when we add it.
  '/api/v1/demo/sandbox/',
];

export function demoGuard(options: DemoGuardOptions = {}): MiddlewareHandler<{
  Bindings: Env;
}> {
  const allow = options.allowlist ?? DEFAULT_ALLOWLIST;

  return async (c, next) => {
    if (c.env.DEMO_MODE !== 'true') {
      return next();
    }

    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const path = c.req.path;
    const allowed = allow.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p));
    if (allowed) {
      return next();
    }

    return c.json(
      {
        error: 'demo_read_only',
        message:
          'This is the pacelore demo. The sample athlete is read-only. Sign up at https://pacelore.com to create your own account.',
      },
      403,
    );
  };
}
