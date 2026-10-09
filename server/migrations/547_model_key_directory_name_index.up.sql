CREATE INDEX CONCURRENTLY idx_model_key_directory_entry_name
    ON model_key_directory_entry (source_id, api_key_name);
