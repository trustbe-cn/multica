-- Central sub2api source, administrator-owned key grants, and runtime config metadata.
-- Secrets and remote file contents stay outside these tables.
CREATE TABLE model_key_source (
    id smallint NOT NULL CHECK (id = 1),
    base_url text NOT NULL,
    directory_token_ciphertext bytea NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'unverified',
    last_checked_at timestamptz,
    last_error_code text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL
);

CREATE TABLE model_key_directory_entry (
    source_id smallint NOT NULL,
    upstream_id text NOT NULL,
    api_key_name text NOT NULL,
    status text NOT NULL,
    allowed_runtimes jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_revision bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_model_key_grant (
    user_id uuid NOT NULL,
    source_id smallint NOT NULL,
    upstream_id text NOT NULL,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime_config_template (
    runtime_kind text NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    files jsonb NOT NULL DEFAULT '[]'::jsonb,
    supported_api_types jsonb NOT NULL DEFAULT '[]'::jsonb,
    default_model text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL
);

CREATE TABLE computer_runtime_model_config (
    binding_id uuid NOT NULL,
    runtime_kind text NOT NULL,
    source_id smallint,
    upstream_id text,
    model_id text NOT NULL DEFAULT '',
    template_revision bigint,
    file_revision text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'unconfigured',
    last_test_status text NOT NULL DEFAULT 'untested',
    last_test_error_code text NOT NULL DEFAULT '',
    last_tested_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
