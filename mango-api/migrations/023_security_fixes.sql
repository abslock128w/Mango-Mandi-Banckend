-- Security fixes (SEC-6, SEC-8). Add-only.

-- SEC-8: bumped when a manager changes someone's role or password or resets
-- their two-step sign-in, so access tokens issued before stop working at once
-- instead of lasting out their 15 minutes.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

-- SEC-6: a one-time code a manager hands over, needed to set up two-step
-- sign-in where it is required, so a password alone can't enrol someone
-- else's authenticator app.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS setup_code_hash TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS setup_code_expires_at TIMESTAMPTZ;
