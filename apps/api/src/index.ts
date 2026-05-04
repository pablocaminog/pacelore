/**
 * open-strava API worker.
 *
 * Hono router. Domain routes attach in `buildApp`.
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
import { feedRoutes } from './routes/feed.js';
import { segmentRoutes } from './routes/segments.js';
import { clubRoutes } from './routes/clubs.js';
import { eventRoutes } from './routes/events.js';
import { exportRoutes } from './routes/exports.js';
import { settingsRoutes } from './routes/settings.js';
import { mcpRoutes } from './routes/mcp.js';
import { queueHandler } from './pipeline/index.js';
import { scheduledHandler } from './scheduled.js';
import type { Env, IngestJob } from './env.js';

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
  app.route('/api/v1', feedRoutes);
  app.route('/api/v1', segmentRoutes);
  app.route('/api/v1', clubRoutes);
  app.route('/api/v1', eventRoutes);
  app.route('/api/v1', exportRoutes);
  app.route('/api/v1', settingsRoutes);
  app.route('/mcp', mcpRoutes);

  app.notFound((c) => c.json({ error: 'not_found', status: 404 }, 404));
  return app;
}

const app = buildApp();

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<IngestJob>, env: Env) => queueHandler(batch, env),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    scheduledHandler(event, env, ctx),
} satisfies ExportedHandler<Env, IngestJob>;
