import type { WeekPlan, SessionPlan, ScheduleGrid, Sport, Phase } from './types.js';

// TSS per hour estimates per sport (zone 2 baseline)
const TSS_PER_HOUR: Record<Sport, number> = {
  swim: 40,
  bike: 55,
  run:  55,
};

const INTENSITY_WEIGHTS = { short: 1, moderate: 1.8, long: 3 } as const;

const ZONE_BY_PHASE: Record<Phase, 1 | 2 | 3 | 4 | 5> = {
  base:     2,
  build:    3,
  peak:     4,
  'race-sp':3,
  taper:    2,
  recovery: 1,
};

export function scheduleWeek(
  week: WeekPlan,
  grid: ScheduleGrid,
  brickAllowed: boolean,
): SessionPlan[] {
  const sessions: SessionPlan[] = [];
  const zone = ZONE_BY_PHASE[week.phase];

  const sports: Sport[] = ['swim', 'bike', 'run'];

  for (const sport of sports) {
    const sportGrid = grid[sport];
    if (!sportGrid) continue;

    const sportTss = week.sportTss[sport];
    if (sportTss <= 0) continue;

    const days = Object.entries(sportGrid)
      .filter(([, cell]) => cell.intensity !== null)
      .map(([day, cell]) => ({ day: Number(day), cell }));

    if (days.length === 0) continue;

    // Total weight for duration distribution
    const totalWeight = days.reduce(
      (sum, { cell }) => sum + INTENSITY_WEIGHTS[cell.intensity!],
      0,
    );

    const tssPerHour = TSS_PER_HOUR[sport];
    const totalHours = sportTss / tssPerHour;

    for (const { day, cell } of days) {
      // Skip if this day already has a session of same sport
      if (sessions.some(s => s.day === day && s.sport === sport)) continue;

      // Skip brick conflict if not allowed: run on same day as bike long
      if (!brickAllowed && sport === 'run') {
        const bikeOnDay = sessions.some(s => s.day === day && s.sport === 'bike');
        if (bikeOnDay) {
          continue;
        }
      }

      const weight = INTENSITY_WEIGHTS[cell.intensity!];
      const sessionHours = (weight / totalWeight) * totalHours;
      const durationMin = Math.max(20, Math.round(sessionHours * 60));

      sessions.push({
        day,
        sport,
        durationMin,
        zone,
        phase: week.phase,
        description: buildDescription(sport, week.phase, cell.intensity!),
        windowStart: cell.window?.start,
        windowEnd: cell.window?.end,
      });
    }
  }

  return sessions;
}

function buildDescription(sport: Sport, phase: Phase, intensity: string): string {
  const sportName = { swim: 'Swim', bike: 'Ride', run: 'Run' }[sport];
  const phaseDesc: Record<Phase, string> = {
    base:     'aerobic base',
    build:    'building threshold',
    peak:     'race-specific intensity',
    'race-sp':'race-simulation',
    taper:    'race sharpening',
    recovery: 'easy recovery',
  };
  return `${sportName} — ${intensity} ${phaseDesc[phase]}`;
}
