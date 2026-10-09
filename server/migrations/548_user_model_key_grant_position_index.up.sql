CREATE INDEX CONCURRENTLY idx_user_model_key_grant_user_position
    ON user_model_key_grant (user_id, position, upstream_id);
