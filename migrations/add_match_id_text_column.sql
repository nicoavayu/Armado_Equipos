-- Add generated column for matchId from JSONB data field
-- This avoids 406 errors from using data->>matchId or data=cs.{...} in queries

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS match_id_text TEXT GENERATED ALWAYS AS (data->>'matchId') STORED;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS notifications_match_id_text_idx ON notifications(match_id_text);

-- Add comment for documentation
COMMENT ON COLUMN notifications.match_id_text IS 'Generated column extracting matchId from JSONB data field for efficient querying';
