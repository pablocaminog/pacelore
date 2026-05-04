-- 0003_decentralization.sql — Arweave permanence + ATProto export prefs.

ALTER TABLE users ADD COLUMN arweave_permanence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN atproto_handle TEXT;
ALTER TABLE users ADD COLUMN atproto_pds TEXT;
ALTER TABLE users ADD COLUMN atproto_app_password TEXT;     -- stored as ciphertext IRL; placeholder
ALTER TABLE users ADD COLUMN atproto_did TEXT;
ALTER TABLE users ADD COLUMN atproto_access_jwt TEXT;
ALTER TABLE users ADD COLUMN atproto_refresh_jwt TEXT;

ALTER TABLE activities ADD COLUMN arweave_tx TEXT;
ALTER TABLE activities ADD COLUMN atproto_uri TEXT;
