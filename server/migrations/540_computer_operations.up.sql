-- Durable metadata only: never persist passwords, credential payloads or raw output.
CREATE TABLE computer_operation (
 id uuid NOT NULL DEFAULT gen_random_uuid(), binding_id uuid NOT NULL,
 computer_id uuid NOT NULL, username text NOT NULL, user_id uuid NOT NULL,
 kind text NOT NULL, runtime_id text NOT NULL DEFAULT '',
 requested_version text NOT NULL DEFAULT '', actual_version text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
 step text NOT NULL DEFAULT 'queued', error_code text NOT NULL DEFAULT '', error_summary text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 deadline_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes'
);
CREATE TABLE computer_runtime_asset (
 binding_id uuid NOT NULL, runtime_id text NOT NULL, executable_path text NOT NULL DEFAULT '',
 install_dir text NOT NULL DEFAULT '', requested_version text NOT NULL DEFAULT '',
 actual_version text NOT NULL DEFAULT '', installer_source text NOT NULL DEFAULT '',
 installed_at timestamptz, checked_at timestamptz NOT NULL DEFAULT now(),
 probe_state text NOT NULL DEFAULT 'unknown', error_code text NOT NULL DEFAULT '',
 probe_environment text NOT NULL DEFAULT ''
);
ALTER TABLE computer_binding ADD COLUMN archived_at timestamptz;
ALTER TABLE computer_binding ADD COLUMN account_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE computer_binding ADD COLUMN checked_at timestamptz;
