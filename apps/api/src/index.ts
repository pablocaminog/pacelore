/**
 * open-strava API worker.
 *
 * Hono router with:
 *   - request id stamping
 *   - CORS for the Pages origin
 *   - error → JSON envelope
 *   - /healthz, /readyz
 *
 * Domain routes (auth, activities, pmc) attach as the matching
 * tasks land.
 */

import { Hono } from 'hono';
import { errorMiddleware } from './middleware/error.js';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { activityRoutes } from './routes/activities.js';
import { athleteRoutes } from './routes/athletes.js';
import { followRoutes } from './routes/follows.js';
import type { Env } from './env.js';

export function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requestIdMiddleware());
  app.use('*', errorMiddleware());
  app.use('*', corsMiddleware());

  app.get('/', (c) =>
    c.json({
      name: 'open-strava-api',
      env: c.env.ENV,
      docs: 'https://github.com/pablocaminog/open-strava',
    }),
  );

  app.route('/', healthRoutes);
  app.route('/api/v1', authRoutes);
  app.route('/api/v1', activityRoutes);
  app.route('/api/v1', athleteRoutes);
  app.route('/api/v1', followRoutes);

  app.notFound((c) => c.json({ error: 'not_found', status: 404 }, 404));
  return app;
}

const app = buildApp();

import { queueHandler } from './pipeline/index.js';
import type { IngestJob } from './env.js';

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<IngestJob>, env: Env) => queueHandler(batch, env),
} satisfies ExportedHandler<Env, IngestJob>;
