ALTER TABLE computer_runtime_model_config DROP COLUMN IF EXISTS last_test_result;
ALTER TABLE computer_runtime_model_config DROP COLUMN IF EXISTS file_manifest;
ALTER TABLE user_model_key_grant DROP COLUMN IF EXISTS api_key_name;
