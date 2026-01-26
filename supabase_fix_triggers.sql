-- FIX: Add missing 'user_id' column to 'survey_results'
-- Logic: A trigger on this table (likely for auditing or RLS) is referencing NEW.user_id,
-- but the column does not exist, causing "record new has no field user_id".
-- We add it as nullable to satisfy the trigger.

ALTER TABLE survey_results
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Optional: If needed, you might want to create the missing awards columns too,
-- but our JS code now handles their absence gracefully.
-- ALTER TABLE survey_results ADD COLUMN IF NOT EXISTS awards_status TEXT;
-- ALTER TABLE survey_results ADD COLUMN IF NOT EXISTS awards_applied_at TIMESTAMPTZ(6);
