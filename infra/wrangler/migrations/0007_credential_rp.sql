-- 0007_credential_rp.sql — record rpId per WebAuthn credential.
--
-- Passkeys are bound to the relying-party ID at the moment they're
-- created. If the canonical domain changes (e.g. pages.dev → custom
-- apex), browsers + password managers won't surface the old keys
-- against the new rpId and login silently fails. Storing rp_id lets
-- the API detect this case and tell the athlete clearly.

ALTER TABLE webauthn_credentials ADD COLUMN rp_id TEXT;
CREATE INDEX idx_webauthn_credentials_rp ON webauthn_credentials(rp_id);
