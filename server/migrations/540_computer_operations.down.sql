ALTER TABLE computer_binding DROP COLUMN IF EXISTS checked_at, DROP COLUMN IF EXISTS account_state, DROP COLUMN IF EXISTS archived_at;
DROP TABLE IF EXISTS computer_runtime_asset;
DROP TABLE IF EXISTS computer_operation;
