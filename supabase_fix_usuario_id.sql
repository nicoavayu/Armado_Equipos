-- FIX: Add 'usuario_id' column to 'survey_results' to satisfy legacy triggers
-- The previous error (42703) complained about missing "usuario_id" (not user_id).
-- This is likely required by an audit trigger on the table.

ALTER TABLE survey_results
ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES auth.users(id);

-- Also ensuring user_id is there just in case, but usuario_id is the critical one from logs.
ALTER TABLE survey_results
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Grant permissions if needed (usually automatic for table owner/service_role)
-- GRANT ALL ON survey_results TO service_role;
