ALTER TABLE computer_binding ADD COLUMN daemon_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE computer_binding ADD COLUMN daemon_checked_at timestamptz;
