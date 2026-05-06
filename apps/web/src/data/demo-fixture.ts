/**
 * Read-only demo fixture used by /demo. Lives in the web project so we
 * can render it without an API call. The shape mirrors what the live
 * dashboard receives from /athletes/:id/pmc and /me/calendar/activities.
 *
 * Data is fictional but plausible — a 12-week build for a hypothetical
 * Cat-2 cyclist + half-marathoner.
 */

export interface DemoActivity {
  id: string;
  date: string; // YYYY-MM-DD
  sport: 'cycling' | 'running' | 'swimming';
  name: string;
  durationSec: number;
  distanceM: number;
  hrAvg?: number;
  powerAvg?: number;
  np?: number;
  tss: number;
  ascentM?: number;
  source: 'strava' | 'garmin';
}

export interface DemoPmcDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface DemoFixture {
  athlete: { handle: string; displayName: string };
  pmc: DemoPmcDay[];
  activities: DemoActivity[];
}

function buildPmc(): { pmc: DemoPmcDay[]; tssByDay: Map<string, number> } {
  // 90 days ending today, athlete-local UTC.
  const days = 90;
  const out: DemoPmcDay[] = [];
  const tssByDay = new Map<string, number>();
  // Pseudo-random TSS by day-of-week + week-of-block.
  let ctl = 38;
  let atl = 42;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    // Block weekly pattern: hard tue/thu, long sat, easy mon/wed, off sun.
    let tss = 0;
    const wob = Math.floor(i / 7);
    if (dow === 2) tss = 78 + (wob % 3) * 12;
    else if (dow === 4) tss = 92 + (wob % 4) * 8;
    else if (dow === 6) tss = 130 + (wob % 5) * 18;
    else if (dow === 1 || dow === 3) tss = 45 + (wob % 2) * 8;
    else if (dow === 5) tss = 22;
    else tss = 0;
    // Recovery week every 4th week — drop everything 40%.
    if (wob > 0 && wob % 4 === 0) tss = Math.round(tss * 0.6);
    // EMA: CTL 42d, ATL 7d.
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({
      date: iso,
      tss,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    });
    tssByDay.set(iso, tss);
  }
  return { pmc: out, tssByDay };
}

function buildActivities(tssByDay: Map<string, number>): DemoActivity[] {
  const out: DemoActivity[] = [];
  const titles = {
    hard: ['VO2 5×5 intervals', 'Threshold 2×20', 'Sweet spot 3×15', 'Hill repeats 6×3'],
    long: [
      'Long endurance · group ride',
      'Sunday gravel',
      'Coffee shop loop',
      'North canyon out-and-back',
    ],
    tempo: ['Tempo cruise', 'Marathon-pace 60', 'Cruise intervals 3×2 km'],
    easy: ['Recovery spin', 'Easy run', 'Z2 commute'],
    weekend: ['Half-marathon-pace 80', 'Big-gear strength', 'Z2 sandwich · 2h'],
  };
  let id = 1;
  for (const [iso, tss] of tssByDay) {
    if (tss <= 0) continue;
    const d = new Date(iso + 'T00:00:00Z');
    const dow = d.getUTCDay();
    const cycling = dow !== 1 && dow !== 4;
    const sport: DemoActivity['sport'] = cycling ? 'cycling' : 'running';
    let name: string;
    let durationSec: number;
    let distanceM: number;
    let hrAvg: number | undefined;
    let powerAvg: number | undefined;
    let np: number | undefined;
    let ascentM: number | undefined;
    if (tss > 100 && dow === 6) {
      name = titles.long[id % titles.long.length]!;
      durationSec = 3 * 3600 + 14 * 60;
      distanceM = 84_200;
      hrAvg = 138;
      powerAvg = 196;
      np = 218;
      ascentM = 1420;
    } else if (tss > 80) {
      name = titles.hard[id % titles.hard.length]!;
      durationSec = 75 * 60;
      distanceM = sport === 'cycling' ? 38_000 : 12_500;
      hrAvg = 156;
      powerAvg = sport === 'cycling' ? 248 : undefined;
      np = sport === 'cycling' ? 263 : undefined;
      ascentM = 280;
    } else if (tss > 50) {
      name = titles.tempo[id % titles.tempo.length]!;
      durationSec = 60 * 60;
      distanceM = sport === 'cycling' ? 28_400 : 11_200;
      hrAvg = 142;
      powerAvg = sport === 'cycling' ? 215 : undefined;
      np = sport === 'cycling' ? 228 : undefined;
    } else if (tss > 30) {
      name = titles.weekend[id % titles.weekend.length]!;
      durationSec = 50 * 60;
      distanceM = sport === 'cycling' ? 22_000 : 9_400;
      hrAvg = 134;
      powerAvg = sport === 'cycling' ? 178 : undefined;
    } else {
      name = titles.easy[id % titles.easy.length]!;
      durationSec = 35 * 60;
      distanceM = sport === 'cycling' ? 14_500 : 5_800;
      hrAvg = 118;
    }
    out.push({
      id: `demo-${id++}`,
      date: iso,
      sport,
      name,
      durationSec,
      distanceM,
      hrAvg,
      powerAvg,
      np,
      tss,
      ascentM,
      source: id % 2 === 0 ? 'strava' : 'garmin',
    });
  }
  return out;
}

const built = buildPmc();
const fixture: DemoFixture = {
  athlete: { handle: 'demo', displayName: 'Demo Athlete' },
  pmc: built.pmc,
  activities: buildActivities(built.tssByDay),
};

export const DEMO = fixture;
