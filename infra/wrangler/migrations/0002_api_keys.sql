-- 0002_api_keys.sql — third-party API keys.
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,             -- public key id (`osk_...`)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_key   TEXT NOT NULL,                -- SHA-256(secret), hex
  scopes       TEXT NOT NULL DEFAULT 'read:activities',
                                              -- comma-separated list
  name         TEXT,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at   INTEGER
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
