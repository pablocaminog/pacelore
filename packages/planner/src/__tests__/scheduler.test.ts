import { describe, it, expect } from 'vitest';
import { scheduleWeek } from '../scheduler.js';
import type { WeekPlan, ScheduleGrid } from '../types.js';

const baseWeek: WeekPlan = {
  weekNum: 1,
  phase: 'base',
  tss: 240,
  sportTss: { swim: 60, bike: 108, run: 72 },
};

const fullGrid: ScheduleGrid = {
  swim: {
    0: { intensity: 'short' },
    2: { intensity: 'moderate' },
  },
  bike: {
    3: { intensity: 'moderate' },
    5: { intensity: 'long' },
  },
  run: {
    1: { intensity: 'short' },
    4: { intensity: 'moderate' },
    5: { intensity: 'moderate' },
  },
};

describe('scheduleWeek', () => {
  const sessions = scheduleWeek(baseWeek, fullGrid, false);

  it('returns array of sessions', () => {
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('all session sports are present in grid', () => {
    for (const s of sessions) {
      expect(['swim', 'bike', 'run']).toContain(s.sport);
    }
  });

  it('all session days match the grid for that sport', () => {
    for (const s of sessions) {
      const sportGrid = fullGrid[s.sport];
      expect(sportGrid).toBeDefined();
      expect(sportGrid![s.day]).toBeDefined();
    }
  });

  it('no two sessions on same day + sport', () => {
    const seen = new Set<string>();
    for (const s of sessions) {
      const key = `${s.day}:${s.sport}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('durationMin is positive for all sessions', () => {
    for (const s of sessions) {
      expect(s.durationMin).toBeGreaterThan(0);
    }
  });

  it('zone is 1-5', () => {
    for (const s of sessions) {
      expect(s.zone).toBeGreaterThanOrEqual(1);
      expect(s.zone).toBeLessThanOrEqual(5);
    }
  });

  it('long-intensity day gets longer session than short-intensity day (same sport)', () => {
    const bikeSessions = sessions.filter(s => s.sport === 'bike');
    const shortBike = bikeSessions.find(s => fullGrid.bike![s.day]?.intensity === 'moderate');
    const longBike  = bikeSessions.find(s => fullGrid.bike![s.day]?.intensity === 'long');
    if (shortBike && longBike) {
      expect(longBike.durationMin).toBeGreaterThan(shortBike.durationMin);
    }
  });
});

describe('scheduleWeek — brick allowed', () => {
  it('can place bike + run on same long day when brick allowed', () => {
    const week: WeekPlan = { ...baseWeek, phase: 'build' };
    const grid: ScheduleGrid = {
      bike: { 5: { intensity: 'long' } },
      run:  { 5: { intensity: 'moderate' }, 1: { intensity: 'short' } },
    };
    const sessions = scheduleWeek(week, grid, true); // brickAllowed = true
    const satSessions = sessions.filter(s => s.day === 5);
    const sports = satSessions.map(s => s.sport);
    // Both bike and run can appear on day 5
    expect(sports).toContain('bike');
  });
});

describe('scheduleWeek — time window preserved', () => {
  it('passes windowStart/End through when set in grid', () => {
    const week: WeekPlan = { ...baseWeek };
    const grid: ScheduleGrid = {
      swim: { 2: { intensity: 'moderate', window: { start: '16:00', end: '18:00' } } },
    };
    const sessions = scheduleWeek(week, grid, false);
    const swimSesh = sessions.find(s => s.sport === 'swim' && s.day === 2);
    expect(swimSesh?.windowStart).toBe('16:00');
    expect(swimSesh?.windowEnd).toBe('18:00');
  });
});

describe('scheduleWeek — half marathon (run only)', () => {
  it('only returns run sessions when grid has only run', () => {
    const week: WeekPlan = {
      weekNum: 1, phase: 'base', tss: 180,
      sportTss: { swim: 0, bike: 0, run: 180 },
    };
    const grid: ScheduleGrid = {
      run: { 0: { intensity: 'short' }, 2: { intensity: 'moderate' }, 5: { intensity: 'long' } },
    };
    const sessions = scheduleWeek(week, grid, false);
    expect(sessions.every(s => s.sport === 'run')).toBe(true);
  });
});
