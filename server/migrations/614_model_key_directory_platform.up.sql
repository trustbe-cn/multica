-- Platform is directory metadata the admin console filters on; compatible
-- runtimes stay the derived authorization result.
ALTER TABLE model_key_directory_entry ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT '';
