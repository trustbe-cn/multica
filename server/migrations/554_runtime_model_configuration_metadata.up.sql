ALTER TABLE user_model_key_grant ADD COLUMN IF NOT EXISTS api_key_name text NOT NULL DEFAULT '';
ALTER TABLE computer_runtime_model_config ADD COLUMN IF NOT EXISTS file_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE computer_runtime_model_config ADD COLUMN IF NOT EXISTS last_test_result jsonb NOT NULL DEFAULT '{}'::jsonb;
