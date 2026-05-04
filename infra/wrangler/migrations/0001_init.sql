-- 0001_init.sql — initial pacelore schema.
--
-- Conventions:
--   - All ids are TEXT (UUIDv7) — sortable by creation time.
--   - All timestamps are INTEGER unix-seconds.
--   - All `created_at` defaults to (unixepoch()).
--   - Foreign keys are declared but D1 enforces only when
--     `PRAGMA foreign_keys = ON` is set per session (Workers does this).

-- Athletes — accounts. Username (handle) is unique-and-public; email is private.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  handle          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT,
  bio             TEXT,
  location        TEXT,
  units_pref      TEXT NOT NULL DEFAULT 'metric'
                    CHECK (units_pref IN ('metric','imperial')),
  ftp             INTEGER,                  -- watts
  hr_max          INTEGER,                  -- bpm
  hr_rest         INTEGER,                  -- bpm
  weight_grams    INTEGER,
  threshold_pace_ms_x100 INTEGER,           -- run threshold pace in m/s × 100 (avoids floats)
  sex             TEXT CHECK (sex IN ('male','female','unspecified')) DEFAULT 'unspecified',
  plan_tier       TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan_tier IN ('free','supporter','pro')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- WebAuthn / passkey credentials. One user can have many keys.
CREATE TABLE webauthn_credentials (
  id                 TEXT PRIMARY KEY,        -- credential id, base64url
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key         BLOB NOT NULL,
  counter            INTEGER NOT NULL DEFAULT 0,
  transports         TEXT,                    -- JSON array
  device_name        TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at       INTEGER
);
CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_id);

-- OAuth identities for federated sign-in / migration imports.
CREATE TABLE oauth_identities (
  provider     TEXT NOT NULL CHECK (provider IN ('apple','google','garmin','strava')),
  external_id  TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at   INTEGER,
  scope        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX idx_oauth_user ON oauth_identities(user_id);

-- Social graph.
CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id);

-- Activities — one row per workout. Aggregate fields summarize the
-- record stream stored in R2.
CREATE TABLE activities (
  id            TEXT PRIMARY KEY,
  athlete_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('fit','tcx','gpx','strava-import')),
  sport         TEXT NOT NULL,
  name          TEXT,
  description   TEXT,
  started_at    INTEGER NOT NULL,
  total_seconds INTEGER NOT NULL,
  distance_m    REAL,
  ascent_m      REAL,
  descent_m     REAL,
  hr_avg        INTEGER,
  hr_max        INTEGER,
  power_avg     INTEGER,
  power_max     INTEGER,
  np            REAL,
  intensity_factor REAL,
  tss           REAL,
  kj            REAL,
  speed_avg_ms  REAL,
  speed_max_ms  REAL,
  calories      INTEGER,
  visibility    TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private','followers','public')),
  raw_r2_path     TEXT,                       -- raw FIT/TCX/GPX
  parsed_r2_path  TEXT,                       -- normalized JSON
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_activities_athlete_time ON activities(athlete_id, started_at DESC);
CREATE INDEX idx_activities_started_at ON activities(started_at DESC);

-- Long-form metric KV per activity (e.g. peak power at each duration,
-- time-in-zone bins). Avoids exploding the activities row schema.
CREATE TABLE activity_metrics (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (activity_id, key)
);

-- One row per stream type pointing into R2 (latitude_stream, hr_stream, …).
-- Decoupling stream storage from the activities row keeps D1 lean.
CREATE TABLE activity_streams (
  activity_id   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  stream_type   TEXT NOT NULL,
  sample_count  INTEGER NOT NULL,
  r2_path       TEXT NOT NULL,
  PRIMARY KEY (activity_id, stream_type)
);

-- User-created segments. Polyline stored as JSON for portability.
CREATE TABLE segments (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sport        TEXT NOT NULL,
  polyline     TEXT NOT NULL,                 -- JSON [[lat,lng],…]
  distance_m   REAL NOT NULL,
  avg_grade    REAL,
  bbox_min_lat REAL NOT NULL,
  bbox_min_lng REAL NOT NULL,
  bbox_max_lat REAL NOT NULL,
  bbox_max_lng REAL NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_segments_bbox ON segments(bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);
CREATE INDEX idx_segments_sport ON segments(sport);

CREATE TABLE segment_efforts (
  id           TEXT PRIMARY KEY,
  segment_id   TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  athlete_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  time_seconds INTEGER NOT NULL,
  power_avg    INTEGER,
  hr_avg       INTEGER,
  started_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_efforts_segment_time ON segment_efforts(segment_id, time_seconds ASC);
CREATE INDEX idx_efforts_athlete ON segment_efforts(athlete_id, started_at DESC);
CREATE INDEX idx_efforts_activity ON segment_efforts(activity_id);

-- Engagement.
CREATE TABLE kudos (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (activity_id, athlete_id)
);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  parent_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_comments_activity_time ON comments(activity_id, created_at);

-- Clubs.
CREATE TABLE clubs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  sport_focus  TEXT,
  visibility   TEXT NOT NULL DEFAULT 'public'
                 CHECK (visibility IN ('public','private')),
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE club_members (
  club_id     TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('member','admin','owner')),
  joined_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (club_id, athlete_id)
);

-- Routes (plannable, non-temporal).
CREATE TABLE routes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  polyline     TEXT NOT NULL,                 -- JSON
  distance_m   REAL NOT NULL,
  ascent_m     REAL,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  visibility   TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private','followers','public')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Events.
CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  club_id      TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL DEFAULT 'group_ride'
                 CHECK (type IN ('group_ride','race','training','social')),
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER,
  route_id     TEXT REFERENCES routes(id) ON DELETE SET NULL,
  location     TEXT,
  capacity     INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_events_starts_at ON events(starts_at);

CREATE TABLE event_invites (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited','accepted','declined','maybe','waitlisted')),
  responded_at INTEGER,
  PRIMARY KEY (event_id, athlete_id)
);

-- PMC daily rollup — one row per (athlete, date).
CREATE TABLE pmc_daily (
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  tss         REAL NOT NULL DEFAULT 0,
  ctl         REAL NOT NULL DEFAULT 0,
  atl         REAL NOT NULL DEFAULT 0,
  tsb         REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (athlete_id, date)
);
CREATE INDEX idx_pmc_athlete_date ON pmc_daily(athlete_id, date);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,                  -- JSON
  read_at     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_notifications_athlete_unread ON notifications(athlete_id, read_at);
