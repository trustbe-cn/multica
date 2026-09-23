-- Last connectivity check per computer, shown in the instance admin list.
ALTER TABLE computer ADD COLUMN checked_at timestamptz;
ALTER TABLE computer ADD COLUMN check_ok boolean;
ALTER TABLE computer ADD COLUMN check_detail text NOT NULL DEFAULT '';
