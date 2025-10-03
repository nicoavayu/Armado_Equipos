-- Database fixes for voting system
-- Run these commands in your Supabase SQL editor

-- 1. Add unique constraint to prevent duplicate votes per player per match
ALTER TABLE votos ADD CONSTRAINT unique_vote_per_match 
UNIQUE (votante_id, partido_id);

-- 2. Add NOT NULL constraint to ensure partido_id is always present
ALTER TABLE votos ALTER COLUMN partido_id SET NOT NULL;

-- 3. Clean up existing votes with null partido_id (OPTIONAL - review first)
-- WARNING: This will delete votes without partido_id. Review these records first:
-- SELECT * FROM votos WHERE partido_id IS NULL;

-- To delete votes with null partido_id (uncomment if needed):
-- DELETE FROM votos WHERE partido_id IS NULL;

-- 4. Add index for better performance on vote lookups
CREATE INDEX IF NOT EXISTS idx_votos_votante_partido 
ON votos (votante_id, partido_id);

-- 5. Add index for getting voters by match
CREATE INDEX IF NOT EXISTS idx_votos_partido 
ON votos (partido_id);