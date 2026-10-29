-- A key now belongs to at most one user. Keep the earliest grant of any key
-- shared before this rule so the unique index in 616 can be built.
DELETE FROM user_model_key_grant g
USING user_model_key_grant keep
WHERE g.source_id = keep.source_id
  AND g.upstream_id = keep.upstream_id
  AND (keep.created_at, keep.user_id) < (g.created_at, g.user_id);
