import { describe, expect, it } from 'vitest';
import { pmcDaily } from '../src/pmc.js';

describe('pmcDaily', () => {
  it('returns empty array for no input and no end date', () => {
    expect(pmcDaily([])).toEqual([]);
  });

  it('rises CTL and ATL on TSS days, decays on rest days', () => {
    const out = pmcDaily(
      [
        { date: '2026-01-01', tss: 100 },
        { date: '2026-01-02', tss: 100 },
      ],
      { endDate: '2026-01-30' },
    );
    expect(out).toHaveLength(30);
    expect(out[0]?.tss).toBe(100);
    // After two days of TSS=100, ATL should exceed CTL (faster EMA).
    expect(out[1]?.atl).toBeGreaterThan(out[1]?.ctl ?? 0);
    // ATL decays much faster (τ=7) than CTL (τ=42); after several weeks of
    // rest, CTL > ATL → TSB positive.
    const last = out[out.length - 1]!;
    expect(last.tsb).toBeGreaterThan(0);
  });

  it('TSB on day 1 is zero with default initial conditions', () => {
    const out = pmcDaily([{ date: '2026-01-01', tss: 100 }]);
    expect(out[0]?.tsb).toBe(0);
  });

  it('respects custom time constants', () => {
    const fast = pmcDaily([{ date: '2026-01-01', tss: 100 }], { ctlConstant: 7, atlConstant: 1 });
    const slow = pmcDaily([{ date: '2026-01-01', tss: 100 }]);
    expect(fast[0]?.ctl ?? 0).toBeGreaterThan(slow[0]?.ctl ?? 0);
  });

  it('respects initial CTL/ATL', () => {
    const out = pmcDaily([{ date: '2026-01-01', tss: 0 }], { initialCtl: 70, initialAtl: 50 });
    // With TSS = 0, CTL decays toward 0 — a 1/42 step from 70 ≈ 68.33
    expect(out[0]?.ctl).toBeCloseTo(70 - 70 / 42, 5);
    expect(out[0]?.atl).toBeCloseTo(50 - 50 / 7, 5);
    expect(out[0]?.tsb).toBe(20);
  });

  it('rejects bad time constants', () => {
    expect(() => pmcDaily([], { ctlConstant: 0 })).toThrow();
    expect(() => pmcDaily([], { atlConstant: -1 })).toThrow();
  });

  it('aggregates multiple activities on the same date', () => {
    const a = pmcDaily([{ date: '2026-01-01', tss: 200 }]);
    const b = pmcDaily([
      { date: '2026-01-01', tss: 100 },
      { date: '2026-01-01', tss: 100 },
    ]);
    expect(a[0]?.ctl).toBeCloseTo(b[0]?.ctl ?? 0, 8);
  });

  it('throws on invalid date strings', () => {
    expect(() => pmcDaily([{ date: 'not-a-date', tss: 50 }])).toThrow();
  });
});
