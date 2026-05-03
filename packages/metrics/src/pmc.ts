/**
 * Performance Management Chart — CTL, ATL, TSB.
 *
 * Standard exponentially weighted moving averages of daily TSS:
 *   CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) / τ_CTL    (τ_CTL = 42)
 *   ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) / τ_ATL    (τ_ATL = 7)
 *   TSB_t = CTL_{t-1} - ATL_{t-1}                        (yesterday's form)
 *
 * Input dates are ISO 'YYYY-MM-DD' (UTC). Days without activity are
 * filled in with TSS = 0 so the EMAs decay correctly across rest days.
 */

export interface PmcInput {
  date: string; // YYYY-MM-DD
  tss: number;
}

export interface PmcDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  /** Yesterday's CTL − yesterday's ATL. Positive = freshness, negative = fatigue. */
  tsb: number;
}

export interface PmcOptions {
  initialCtl?: number;
  initialAtl?: number;
  ctlConstant?: number;
  atlConstant?: number;
  /**
   * If set, extend the rolled-up series to this end date (YYYY-MM-DD).
   * Useful for showing decay through "today" when the last activity was
   * a week ago.
   */
  endDate?: string;
}

const MS_PER_DAY = 86_400_000;

function parseDate(s: string): number {
  // 'YYYY-MM-DD' → UTC midnight epoch ms.
  const [y, m, d] = s.split('-').map((x) => Number(x));
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    y === undefined ||
    m === undefined ||
    d === undefined
  ) {
    throw new Error(`invalid PMC date: ${s}`);
  }
  return Date.UTC(y, m - 1, d);
}

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function pmcDaily(entries: PmcInput[], opts: PmcOptions = {}): PmcDay[] {
  const tauCtl = opts.ctlConstant ?? 42;
  const tauAtl = opts.atlConstant ?? 7;
  if (tauCtl <= 0 || tauAtl <= 0) throw new Error('time constants must be positive');

  if (entries.length === 0 && !opts.endDate) return [];

  // Aggregate same-day TSS, sort by date.
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (!Number.isFinite(e.tss)) continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.tss);
  }

  let firstEpoch = entries.length > 0 ? Math.min(...entries.map((e) => parseDate(e.date))) : NaN;
  let lastEpoch = entries.length > 0 ? Math.max(...entries.map((e) => parseDate(e.date))) : NaN;
  if (opts.endDate) {
    const ep = parseDate(opts.endDate);
    if (Number.isNaN(firstEpoch) || ep < firstEpoch) firstEpoch = ep;
    if (Number.isNaN(lastEpoch) || ep > lastEpoch) lastEpoch = ep;
  }

  let ctlPrev = opts.initialCtl ?? 0;
  let atlPrev = opts.initialAtl ?? 0;
  const out: PmcDay[] = [];

  for (let t = firstEpoch; t <= lastEpoch; t += MS_PER_DAY) {
    const date = formatDate(t);
    const tss = byDate.get(date) ?? 0;
    const ctl = ctlPrev + (tss - ctlPrev) / tauCtl;
    const atl = atlPrev + (tss - atlPrev) / tauAtl;
    const tsb = ctlPrev - atlPrev;
    out.push({ date, tss, ctl, atl, tsb });
    ctlPrev = ctl;
    atlPrev = atl;
  }
  return out;
}
