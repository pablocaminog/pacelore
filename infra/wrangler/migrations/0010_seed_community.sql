-- 0010_seed_community.sql — system-owned clubs, events, challenges.
--
-- Empty community pages aren't useful for landing visitors. Seed a
-- handful owned by a synthetic 'system' user so /clubs, /events,
-- /challenges have something visible from day one.
--
-- All entries are public. The system user has no credential — it
-- exists purely as a foreign-key target. Real athletes can join.

INSERT INTO users (id, handle, email, display_name, bio)
VALUES (
  '00000000-0000-7000-8000-000000000001',
  'pacelore',
  'system@pacelore.com',
  'pacelore',
  'Official pacelore account. Hosts community challenges, public clubs, and events.'
)
ON CONFLICT (id) DO NOTHING;

-- Clubs ----------------------------------------------------------------
INSERT INTO clubs (id, name, description, sport_focus, visibility, owner_id) VALUES
  ('019dfd00-0000-7000-8000-000000000001',
   'Sub-3 Marathon',
   'Athletes training for sub-three-hour marathons. Weekly long-run threads, threshold sessions, race-week tapers.',
   'running',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000002',
   'FTP Hunters',
   'Cyclists chasing the next watt. Sweet-spot, threshold, and VO2 sets — plus retest protocols.',
   'cycling',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000003',
   'Triathlon Open',
   'Multisport athletes 70.3 + IM. Swim-bike-run programs, brick-day logistics, race-day taper math.',
   'triathlon',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000004',
   'Gravel Nation',
   'Long days, fat tires. Training for Unbound, SBT, BWR, and the 200-mile gravel grind season.',
   'cycling',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000005',
   'Mountain Run Co.',
   'Trail and ultra runners. Vert-per-week leaderboards, fueling threads, race recaps from UTMB to Western States.',
   'running',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000006',
   'Indoor Watts',
   'Zwift, TrainerRoad, indoor structure. Race calendars, group-workout invites, off-season build blocks.',
   'cycling',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000007',
   'Open Water Crew',
   'Pool, ocean, lake. CSS sets, sighting drills, wetsuit-week race prep.',
   'swimming',
   'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd00-0000-7000-8000-000000000008',
   'Data Nerds',
   'Athletes who actually read their PMC. CTL ramp talk, decoupling thresholds, model arguments.',
   'cycling',
   'public',
   '00000000-0000-7000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Challenges (start dates set so the window covers most of 2027) -------
-- starts_at = 2027-01-01 00:00 UTC = 1798761600
-- ends_at   = 2027-12-31 23:59 UTC = 1830297599
-- Mid-year ones use Q-windows below.
INSERT INTO challenges (id, name, description, metric, goal, sport, starts_at, ends_at, visibility, created_by) VALUES
  ('019dfd01-0000-7000-8000-000000000001',
   '2027 — 5,000 km',
   'Five thousand kilometers across all bikes in 2027. About 96 km a week. Open to everyone — Zwift counts.',
   'distance_m', 5000000, 'cycling', 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000002',
   '2027 — 1,000 mi run',
   'A thousand miles on foot. Roughly 19 miles a week. Track + treadmill + trail all count.',
   'distance_m', 1609344, 'running', 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000003',
   '2027 — 100,000 m climbed',
   'Vert challenge. 100k meters in a year — about 1,920 m a week. Cycling + hike-running both count.',
   'ascent_m', 100000, NULL, 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000004',
   '2027 — 200,000 TSS',
   'Total training load. About 3,800 a week. Earned the same way TrainingPeaks counts it.',
   'tss', 200000, NULL, 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  -- Quarterly sprints
  ('019dfd01-0000-7000-8000-000000000005',
   'Q1 base — 60 hours',
   'January through March base block. Sixty hours moving — endurance and aerobic.',
   'total_seconds', 216000, NULL, 1798761600, 1806710400, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000006',
   'Spring climb — 25,000 m',
   'April through June. Twenty-five thousand meters of elevation. Open to bike + run.',
   'ascent_m', 25000, NULL, 1806710400, 1814659200, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000007',
   'Summer 1,500 km',
   'July through September. Fifteen-hundred kilometers in twelve weeks. Race-build ready.',
   'distance_m', 1500000, 'cycling', 1814659200, 1822521599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000008',
   'Off-season strength — 50 hours',
   'October through December. Fifty hours of work — recovery + strength + maintenance.',
   'total_seconds', 180000, NULL, 1822521600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000009',
   'Run streak — 365 days',
   'One activity per day for the calendar year. Walks count if HR > 110.',
   'total_seconds', 1, NULL, 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001'),
  ('019dfd01-0000-7000-8000-000000000010',
   'Swim 100 km',
   '100 km in the pool or open water in 2027. About 1.9 km/week.',
   'distance_m', 100000, 'swimming', 1798761600, 1830297599, 'public',
   '00000000-0000-7000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Events spread across 2027 -------------------------------------------
-- Epoch UTC values:
--   2027-03-14  (Sat) 2027-03-14 08:00 UTC = 1804320000
--   2027-04-25                 14:00 UTC = 1808058600  ← saturday
--   2027-05-22                 06:30 UTC = 1810362600
--   2027-06-12                 12:00 UTC = 1812110400
--   2027-07-10                 16:00 UTC = 1814620400
--   2027-08-21                 07:00 UTC = 1818140400
--   2027-09-25                 09:00 UTC = 1822462000
--   2027-10-30                 13:00 UTC = 1825650000
INSERT INTO events (id, club_id, owner_id, name, description, type, starts_at, ends_at, location) VALUES
  ('019dfd02-0000-7000-8000-000000000001',
   '019dfd00-0000-7000-8000-000000000002',
   '00000000-0000-7000-8000-000000000001',
   'Spring FTP test week',
   'Coordinated 20-min FTP retest across the FTP Hunters club. Submit your number to the leaderboard.',
   'training', 1804320000, 1804924800, 'Worldwide'),
  ('019dfd02-0000-7000-8000-000000000002',
   '019dfd00-0000-7000-8000-000000000004',
   '00000000-0000-7000-8000-000000000001',
   'Unbound 200 prep ride',
   'Eight-hour gravel day at Mid-Atlantic loop. Bring spares, food, and patience.',
   'group_ride', 1808058600, 1808092200, 'Frederick, MD'),
  ('019dfd02-0000-7000-8000-000000000003',
   '019dfd00-0000-7000-8000-000000000001',
   '00000000-0000-7000-8000-000000000001',
   'Spring Half — sub-90 attempt',
   'Coordinated half-marathon time-trial weekend. Submit your race or solo TT for the leaderboard.',
   'race', 1810362600, 1810405800, 'Worldwide'),
  ('019dfd02-0000-7000-8000-000000000004',
   '019dfd00-0000-7000-8000-000000000003',
   '00000000-0000-7000-8000-000000000001',
   'Brick day — 70.3 sim',
   '90-min ride / 30-min run race-pace simulation. Record both legs as one activity if your unit allows.',
   'training', 1812110400, 1812132000, 'Worldwide'),
  ('019dfd02-0000-7000-8000-000000000005',
   '019dfd00-0000-7000-8000-000000000005',
   '00000000-0000-7000-8000-000000000001',
   'July vert — 5k weekend',
   'Five thousand meters of climbing in a single weekend. Pick your peak.',
   'training', 1814620400, 1814793200, 'Worldwide'),
  ('019dfd02-0000-7000-8000-000000000006',
   '019dfd00-0000-7000-8000-000000000007',
   '00000000-0000-7000-8000-000000000001',
   'Open-water 5k swim',
   'Sea, lake, or river — 5k continuous. Wetsuits OK; sighting drills encouraged.',
   'race', 1818140400, 1818152400, 'Worldwide'),
  ('019dfd02-0000-7000-8000-000000000007',
   '019dfd00-0000-7000-8000-000000000002',
   '00000000-0000-7000-8000-000000000001',
   'Threshold ladder · group workout',
   'Coordinated group ride: 6 / 12 / 18 / 12 / 6 minutes at threshold. Calls every 30 sec.',
   'training', 1822462000, 1822476400, 'Zwift / Outdoor'),
  ('019dfd02-0000-7000-8000-000000000008',
   '019dfd00-0000-7000-8000-000000000006',
   '00000000-0000-7000-8000-000000000001',
   'Halloween 100 — Zwift century',
   'Hundred miles indoors. Pacelore + Zwift sync, leaderboards on actual NP.',
   'race', 1825650000, 1825682400, 'Zwift'),
  ('019dfd02-0000-7000-8000-000000000009',
   '019dfd00-0000-7000-8000-000000000008',
   '00000000-0000-7000-8000-000000000001',
   'PMC review — open call',
   'Anyone can drop their PMC. Group reviews ramp rate, taper, decoupling. Discord link on the event page.',
   'social', 1816041600, 1816052400, 'Online'),
  ('019dfd02-0000-7000-8000-000000000010',
   NULL,
   '00000000-0000-7000-8000-000000000001',
   'New Year''s Day base ride',
   'Optional kickoff. Easy 90 min Z2. Whatever bike you ride is fine.',
   'group_ride', 1798800000, 1798811000, 'Worldwide')
ON CONFLICT (id) DO NOTHING;
