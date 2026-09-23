-- Account-owned provisioning data. No workspace admin can read another user's secrets.
CREATE TABLE computer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 host text NOT NULL, port integer NOT NULL CHECK(port BETWEEN 1 AND 65535),
 ssh_user text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE computer_credential (
 user_id uuid PRIMARY KEY, ciphertext bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE computer_health_port_seq START 22000 MAXVALUE 60000 NO CYCLE;
CREATE TABLE computer_binding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), computer_id uuid NOT NULL,
 user_id uuid NOT NULL, workspace_id uuid, username text NOT NULL,
 verified boolean NOT NULL DEFAULT false,
 health_port integer NOT NULL DEFAULT nextval('computer_health_port_seq'),
 state text NOT NULL DEFAULT 'pending', last_error text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE computer_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 binding_id uuid, action text NOT NULL, outcome text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
