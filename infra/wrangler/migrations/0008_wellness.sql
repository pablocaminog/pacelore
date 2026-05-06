-- 0008_wellness.sql — Garmin / Apple Health daily wellness metrics.
--
-- Activities live in `activities`; this table holds non-activity
-- numbers an athlete tracks day-to-day: sleep, RHR, HRV, body battery,
-- stress, steps, weight. One row per (athlete, date) per source.
-- Source kept granular so we can show "Garmin" vs "Apple Health"
-- attribution on the wellness widget without aggregating away.

CREATE TABLE wellness_daily (
  id              TEXT PRIMARY KEY,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,                       -- YYYY-MM-DD athlete-local
  source          TEXT NOT NULL CHECK (source IN ('garmin','apple','manual')),

  -- Sleep
  sleep_seconds   INTEGER,                              -- total nightly sleep
  sleep_score     INTEGER,                              -- 0-100 (Garmin)
  deep_seconds    INTEGER,
  light_seconds   INTEGER,
  rem_seconds     INTEGER,
  awake_seconds   INTEGER,

  -- Heart
  rhr             INTEGER,                              -- resting HR, bpm
  hrv_overnight   REAL,                                 -- rMSSD ms

  -- Daily activity
  steps           INTEGER,
  calories_active INTEGER,
  calories_total  INTEGER,
  body_battery    INTEGER,                              -- 0-100 Garmin
  stress_avg      INTEGER,                              -- 0-100 Garmin

  -- Body comp
  weight_kg       REAL,
  body_fat_pct    REAL,
  vo2max          REAL,

  raw_payload     TEXT,                                 -- JSON, source-specific
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE (athlete_id, date, source)
);
CREATE INDEX idx_wellness_athlete_date ON wellness_daily(athlete_id, date DESC);

-- Body composition events (per-weigh-in, not per-day). Keeps a
-- denser history for athletes who weigh in multiple times a day.
CREATE TABLE body_composition (
  id              TEXT PRIMARY KEY,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at     INTEGER NOT NULL,                    -- epoch seconds
  source          TEXT NOT NULL,
  weight_kg       REAL,
  body_fat_pct    REAL,
  muscle_mass_kg  REAL,
  bone_mass_kg    REAL,
  body_water_pct  REAL,
  visceral_fat    REAL,
  raw_payload     TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_body_comp_athlete_time ON body_composition(athlete_id, measured_at DESC);
