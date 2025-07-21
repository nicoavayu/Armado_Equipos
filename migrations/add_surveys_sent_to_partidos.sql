-- Add surveys_sent boolean field to partidos table
ALTER TABLE partidos ADD COLUMN IF NOT EXISTS surveys_sent BOOLEAN DEFAULT FALSE;

-- Add hora_fin timestamp field to partidos table if it doesn't exist
ALTER TABLE partidos ADD COLUMN IF NOT EXISTS hora_fin TIMESTAMP WITH TIME ZONE;