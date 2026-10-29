CREATE UNIQUE INDEX CONCURRENTLY idx_user_model_key_grant_key_owner ON user_model_key_grant (source_id, upstream_id);
