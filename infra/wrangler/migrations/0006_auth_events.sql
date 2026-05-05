-- 0006_auth_events.sql — append-only audit log for security-sensitive events.
--
-- Captures register / login (success + failure) / logout / account-delete /
-- credential-add events. Used for incident review and rough rate-control
-- analytics. Kept narrow on purpose — sensitive payloads stay out of D1.

CREATE TABLE auth_events (
  id          TEXT PRIMARY KEY,
  athlete_id  TEXT,
  kind        TEXT NOT NULL,                  -- 'register' | 'login_ok' | 'login_fail' | 'logout' | 'account_delete' | 'credential_added'
  detail      TEXT,                            -- short reason, e.g. 'unknown_credential', 'invalid_email'
  ip          TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_auth_events_athlete_time ON auth_events(athlete_id, created_at);
CREATE INDEX idx_auth_events_kind_time   ON auth_events(kind, created_at);
