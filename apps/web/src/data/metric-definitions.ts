/**
 * Canonical glossary of every metric, abbreviation, and acronym surfaced
 * in the UI. One source of truth so a hover-tooltip on /dashboard,
 * /calendar, /activity/:id, /settings all show the same definition.
 *
 * Each entry has:
 *   - title        formal name
 *   - official     what a coach / sports-science textbook would say
 *   - plain        same idea explained without jargon
 *   - source       where the metric came from / who coined it (when known)
 *
 * Keys are lowercase tokens. The component does its own match-and-render.
 */

export interface MetricDef {
  key: string;
  title: string;
  official: string;
  plain: string;
  source?: string;
}

export const METRICS: Record<string, MetricDef> = {
  tss: {
    key: 'tss',
    title: 'Training Stress Score (TSS)',
    official:
      'Coggan-derived training load: (seconds × NP × IF) / (FTP × 3600) × 100. One hour at FTP = 100 TSS.',
    plain:
      'A single score for how hard a workout was. 100 means an all-out hour at threshold; 50 is half that effort.',
    source: 'Andrew Coggan',
  },
  np: {
    key: 'np',
    title: 'Normalized Power (NP)',
    official:
      'A 30-second rolling average of power, raised to the 4th power, averaged, then 4th-rooted. Approximates the metabolic cost of variable efforts.',
    plain:
      'A "fairer" average watts that accounts for surges. Two rides with the same average power but different attack patterns will have different NP.',
    source: 'Andrew Coggan',
  },
  if: {
    key: 'if',
    title: 'Intensity Factor (IF)',
    official: 'NP divided by FTP. 1.0 = exactly at threshold for the duration.',
    plain:
      'How hard the ride was relative to your sustainable hour. 0.7 is endurance, 0.85 tempo, 0.95+ near-threshold.',
    source: 'Andrew Coggan',
  },
  vi: {
    key: 'vi',
    title: 'Variability Index (VI)',
    official: 'NP divided by average power.',
    plain:
      'How "spiky" the ride was. 1.00 = perfectly steady; 1.10 = lots of surges. Crit racers hit 1.20+; TT riders stay under 1.05.',
  },
  kj: {
    key: 'kj',
    title: 'Kilojoules of work',
    official: 'Total mechanical work performed during the activity, in kilojoules.',
    plain:
      'The total energy your legs put into the pedals. Roughly equals calories burned for cyclists since human efficiency is ~24%.',
  },
  ftp: {
    key: 'ftp',
    title: 'Functional Threshold Power (FTP)',
    official:
      'The highest average power you can sustain for one hour without fatigue. The anchor for IF and TSS.',
    plain:
      'Your "all-out hour" wattage. Set it in Settings; every load number depends on it.',
    source: 'Allen & Coggan',
  },
  ctl: {
    key: 'ctl',
    title: 'Chronic Training Load (CTL) · Fitness',
    official:
      'A 42-day exponentially-weighted moving average of daily TSS. Banister "long-term fitness" track.',
    plain:
      'How fit you are. Climbs slowly when you train consistently. A higher number = a deeper aerobic base.',
    source: 'Tim Banister',
  },
  atl: {
    key: 'atl',
    title: 'Acute Training Load (ATL) · Fatigue',
    official:
      'A 7-day exponentially-weighted moving average of daily TSS. Banister "short-term fatigue" track.',
    plain:
      'How tired you are right now. Goes up fast after hard weeks, drops fast on rest days.',
    source: 'Tim Banister',
  },
  tsb: {
    key: 'tsb',
    title: 'Training Stress Balance (TSB) · Form',
    official: 'CTL minus ATL. The "form" track in the Performance Manager Chart.',
    plain:
      'How fresh you feel. Negative = loaded and slow; near zero = rested-and-ready; very positive = fresh but losing fitness.',
    source: 'Tim Banister',
  },
  pmc: {
    key: 'pmc',
    title: 'Performance Manager Chart (PMC)',
    official: 'A time-series of CTL, ATL, and TSB used to plan training load.',
    plain:
      'The fitness/fatigue/form chart. CTL up = fitter. TSB low = tired. Race well by getting CTL high and TSB at +5 to +15.',
    source: 'Tim Banister · TrainingPeaks',
  },
  trimp: {
    key: 'trimp',
    title: 'TRIMP (Training Impulse)',
    official:
      'Banister TRIMP: duration × HR-reserve fraction × an exponential weighting (b ≈ 1.92 male, 1.67 female).',
    plain:
      'A heart-rate-only version of TSS. Useful when you don\'t have a power meter.',
    source: 'Eric Banister',
  },
  hrtss: {
    key: 'hrtss',
    title: 'hrTSS (Heart-rate TSS)',
    official:
      'TSS estimated from TRIMP and your threshold heart rate. Used when no power data is available.',
    plain:
      'The same load score as TSS, but computed from your heart rate. Less precise than power-based TSS.',
  },
  rtss: {
    key: 'rtss',
    title: 'rTSS (Run TSS)',
    official:
      'Run-specific TSS using NGP (normalized graded pace) and threshold pace. (seconds × NGP × IF) / (threshold pace × 3600) × 100.',
    plain:
      'TSS for runs — corrects for hills via grade-adjusted pace. 100 = an all-out hour of running.',
  },
  ngp: {
    key: 'ngp',
    title: 'Normalized Graded Pace (NGP)',
    official:
      'Pace adjusted for grade using the Minetti energy-cost model. Equivalent flat-ground pace at the same metabolic cost.',
    plain:
      'What your pace would have been on flat ground. A 7:00 mile up a hill might equal 6:20 NGP.',
    source: 'Alberto Minetti',
  },
  gap: {
    key: 'gap',
    title: 'Grade-Adjusted Pace (GAP)',
    official:
      'Pace converted to flat-ground equivalent via Minetti\'s energy-cost-of-running curve.',
    plain:
      'Same idea as NGP — flat-pace equivalent. Lets you compare hilly and flat runs honestly.',
    source: 'Alberto Minetti',
  },
  vo2max: {
    key: 'vo2max',
    title: 'VO₂max',
    official:
      'Maximal oxygen uptake, mL O₂ per kg of body weight per minute. The aerobic ceiling.',
    plain:
      'The biggest lung+heart number — how much oxygen your body can use at max effort. Higher = bigger engine.',
  },
  hrv: {
    key: 'hrv',
    title: 'Heart-Rate Variability (HRV)',
    official:
      'Beat-to-beat variation in heart rate, typically measured as overnight rMSSD in milliseconds.',
    plain:
      'How variable your heart\'s pacing is at rest. Higher = more recovered. A trend that drops for 3+ nights = real fatigue building up.',
  },
  rhr: {
    key: 'rhr',
    title: 'Resting Heart Rate (RHR)',
    official: 'Heart rate measured at rest (typically the lowest reading during overnight sleep).',
    plain:
      'How fast your heart beats when you\'re not doing anything. Lower over time = fitter; spikes = poor sleep, illness, or overreaching.',
  },
  hrmax: {
    key: 'hrmax',
    title: 'HR max',
    official:
      'Highest sustainable heart rate during all-out effort. Used as the upper anchor for HR zones.',
    plain:
      'Your top heart rate. Anchors the zone math; set it from a real all-out test, not the 220-age formula.',
  },
  hrrest: {
    key: 'hrrest',
    title: 'HR rest',
    official: 'Same as RHR — resting heart rate, used as the lower anchor for HRR-based zones.',
    plain:
      'Your at-rest baseline. Combined with HR max, it gives the "heart-rate reserve" range your zones live in.',
  },
  zone1: {
    key: 'zone1',
    title: 'Zone 1 · Recovery',
    official: '< 55% FTP / < 68% HR max. Active recovery, regenerative.',
    plain: 'Easy spinning or jogging. Should feel like nothing — that\'s the point.',
  },
  zone2: {
    key: 'zone2',
    title: 'Zone 2 · Endurance',
    official: '55–75% FTP / 69–83% HR max. All-day aerobic pace.',
    plain: 'Conversational pace. The bread-and-butter of base training.',
  },
  zone3: {
    key: 'zone3',
    title: 'Zone 3 · Tempo',
    official: '76–90% FTP / 84–94% HR max. "Sweet spot" / comfortably hard.',
    plain: 'Comfortably hard. Can talk in short sentences, not paragraphs.',
  },
  zone4: {
    key: 'zone4',
    title: 'Zone 4 · Threshold',
    official: '91–105% FTP / 95–105% HR max. Around lactate threshold.',
    plain: 'The "burning legs, can barely talk" zone. Sustainable for 30–60 min if fit.',
  },
  zone5: {
    key: 'zone5',
    title: 'Zone 5 · VO₂max',
    official: '106–120% FTP / >105% HR max. Anaerobic / VO₂max work.',
    plain: 'Hard intervals, 3–8 min repeats. Heavy breathing, no talking.',
  },
  decoupling: {
    key: 'decoupling',
    title: 'Decoupling (Pw:HR drift)',
    official:
      'The percentage drift between the first half and second half of a steady ride\'s power-to-HR ratio.',
    plain:
      'How much your heart rate drifted up while power stayed steady. Under 5% = aerobically strong; over 8% = needs more base.',
  },
  swolf: {
    key: 'swolf',
    title: 'SWOLF',
    official:
      'Strokes per length + seconds per length. A swimming-economy index — lower is better.',
    plain:
      '"Swim golf score". The fewer strokes + seconds you take per pool length, the more efficient your stroke.',
  },
  css: {
    key: 'css',
    title: 'Critical Swim Speed (CSS)',
    official:
      'The pace you can swim continuously for ~1 hour without fatigue. Threshold-equivalent for swimming.',
    plain:
      'Your "all-out hour" swim pace. Most CSS sets target this pace with short rests.',
  },
  pace: {
    key: 'pace',
    title: 'Pace',
    official: 'Time per unit distance — typically minutes per kilometer or per mile.',
    plain: 'How long it takes you to cover one km (or mile). Lower = faster.',
  },
  ascent: {
    key: 'ascent',
    title: 'Ascent / Elevation gain',
    official: 'Total cumulative elevation climbed during the activity, in meters or feet.',
    plain: 'How much vertical you went up over the whole ride or run.',
  },
  load: {
    key: 'load',
    title: 'Load',
    official: 'Sum of TSS for all activities in the period.',
    plain:
      'Total training load over the week. Compare across weeks to see if you\'re ramping up too hard.',
  },
  steps: {
    key: 'steps',
    title: 'Steps',
    official: 'Daily step count from a wrist or pocket activity tracker.',
    plain: 'How many steps you took today.',
  },
  bodybattery: {
    key: 'bodybattery',
    title: 'Body Battery',
    official:
      'A 0–100 daily energy index Garmin computes from HRV, stress, activity, and sleep.',
    plain:
      'A green-bar "how charged are you" score. Goes up with sleep, down with stress and exercise.',
    source: 'Garmin / Firstbeat',
  },
  sleepscore: {
    key: 'sleepscore',
    title: 'Sleep Score',
    official:
      'Garmin\'s 0–100 sleep-quality index combining duration, deep / light / REM proportions, and HRV.',
    plain: 'A score for last night\'s sleep. 80+ = solid; under 60 = poor.',
    source: 'Garmin / Firstbeat',
  },
  ramp: {
    key: 'ramp',
    title: 'Ramp Rate',
    official: 'Week-over-week change in CTL.',
    plain:
      'How fast your fitness is climbing. +3 to +5 per week is sustainable; +8 risks injury or burnout.',
  },
  form: {
    key: 'form',
    title: 'Form',
    official: 'Synonym for TSB. CTL minus ATL.',
    plain:
      'How fresh you are. Race-day target: +5 to +15. Negative = fatigued; >+25 means you\'ve detrained.',
  },
  fitness: {
    key: 'fitness',
    title: 'Fitness',
    official: 'Synonym for CTL. 42-day exponentially weighted average of TSS.',
    plain: 'Your aerobic engine size. Builds slowly; protect it during taper.',
  },
  fatigue: {
    key: 'fatigue',
    title: 'Fatigue',
    official: 'Synonym for ATL. 7-day exponentially weighted average of TSS.',
    plain: 'How beat-up you are right now. High after a heavy block; resets in days.',
  },
  pr: {
    key: 'pr',
    title: 'Personal Record (PR)',
    official: 'Best-ever effort across some duration or distance for this athlete.',
    plain: 'Your fastest / strongest effort to date for that distance or duration.',
  },
  kom: {
    key: 'kom',
    title: 'KOM / QOM',
    official: 'King / Queen of the Mountain — the fastest recorded effort on a segment.',
    plain: 'The all-time #1 time on a segment leaderboard.',
  },
  segment: {
    key: 'segment',
    title: 'Segment',
    official:
      'A defined stretch of road or trail with a leaderboard tracking everyone\'s effort.',
    plain:
      'A favorite climb or sprint that gets matched on every ride and ranked against the field.',
  },
};
