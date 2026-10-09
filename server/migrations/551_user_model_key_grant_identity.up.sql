CREATE UNIQUE INDEX CONCURRENTLY idx_user_model_key_grant_identity ON user_model_key_grant (user_id, source_id, upstream_id);
