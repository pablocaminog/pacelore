/**
 * Cron handler (configured via wrangler.toml [triggers]).
 *
 *   nightly: recompute pmc_daily ctl/atl/tsb for every athlete that
 *     trained in the last 90 days. Cheap — D1 EMA in JS over the last
 *     ~120 days of TSS rows, written back as a batch.
 */

import { pmcDaily } from '@open-strava/metrics';
import type { Env } from './env.js';

export async function scheduledHandler(
  _event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  await recomputePmcForActiveAthletes(env);
}

async function recomputePmcForActiveAthletes(env: Env): Promise<void> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT athlete_id FROM pmc_daily WHERE date >= date('now', '-90 days')`,
  ).all<{ athlete_id: string }>();
  const ids = (result.results ?? []).map((r) => r.athlete_id);
  for (const id of ids) {
    const tssRows = await env.DB.prepare(
      `SELECT date, tss FROM pmc_daily
        WHERE athlete_id = ? AND date >= date('now', '-180 days')
        ORDER BY date`,
    )
      .bind(id)
      .all<{ date: string; tss: number }>();
    const series = pmcDaily(tssRows.results ?? [], { endDate: today() });
    const stmts = series.map((d) =>
      env.DB.prepare(
        `INSERT INTO pmc_daily (athlete_id, date, tss, ctl, atl, tsb)
           VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(athlete_id, date) DO UPDATE
           SET ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb`,
      ).bind(id, d.date, d.tss, d.ctl, d.atl, d.tsb),
    );
    if (stmts.length > 0) await env.DB.batch(stmts);
  }
}

function today(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
