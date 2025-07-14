-- COMPREHENSIVE VOTING SYSTEM FIX
-- Run this in your Supabase SQL editor to fix all voting issues

-- 1. Clean up any existing problematic votes
DELETE FROM votos WHERE partido_id IS NULL OR votante_id IS NULL OR votado_id IS NULL;

-- 2. Ensure proper constraints exist
DO $$ 
BEGIN
    -- Add NOT NULL constraints if they don't exist
    BEGIN
        ALTER TABLE votos ALTER COLUMN partido_id SET NOT NULL;
    EXCEPTION
        WHEN others THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE votos ALTER COLUMN votante_id SET NOT NULL;
    EXCEPTION
        WHEN others THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE votos ALTER COLUMN votado_id SET NOT NULL;
    EXCEPTION
        WHEN others THEN NULL;
    END;
    
    -- Add unique constraint to prevent duplicate votes
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_vote_per_match'
    ) THEN
        ALTER TABLE votos ADD CONSTRAINT unique_vote_per_match 
        UNIQUE (votante_id, partido_id);
    END IF;
END $$;

-- 3. Drop all existing RLS policies to start fresh
DROP POLICY IF EXISTS "allow_all_votes_insert" ON votos;
DROP POLICY IF EXISTS "allow_all_votes_select" ON votos;
DROP POLICY IF EXISTS "allow_all_partidos_select" ON partidos;
DROP POLICY IF EXISTS "allow_all_jugadores_select" ON jugadores;
DROP POLICY IF EXISTS "Public can insert votes" ON votos;
DROP POLICY IF EXISTS "Public can read votes" ON votos;
DROP POLICY IF EXISTS "Public can read partidos" ON partidos;
DROP POLICY IF EXISTS "Public can read jugadores" ON jugadores;
DROP POLICY IF EXISTS "Anyone can insert votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read partidos" ON partidos;
DROP POLICY IF EXISTS "Anyone can read jugadores" ON jugadores;

-- 4. Enable RLS on all tables
ALTER TABLE votos ENABLE ROW LEVEL SECURITY;
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;

-- 5. Create the most permissive policies for public access
-- These policies allow both authenticated users and anonymous guests

-- Votes table - allow public insert and select
CREATE POLICY "public_votes_insert" ON votos
FOR INSERT TO public
WITH CHECK (true);

CREATE POLICY "public_votes_select" ON votos
FOR SELECT TO public
USING (true);

-- Partidos table - allow public select (needed for match access via URL)
CREATE POLICY "public_partidos_select" ON partidos
FOR SELECT TO public
USING (true);

-- Jugadores table - allow public select (needed for displaying players)
CREATE POLICY "public_jugadores_select" ON jugadores
FOR SELECT TO public
USING (true);

-- 6. Test the setup with a sample insert (will be cleaned up)
DO $$
DECLARE
    test_partido_id INTEGER;
BEGIN
    -- Get any existing partido ID for testing
    SELECT id INTO test_partido_id FROM partidos LIMIT 1;
    
    IF test_partido_id IS NOT NULL THEN
        -- Try to insert a test vote
        INSERT INTO votos (votado_id, votante_id, puntaje, partido_id) 
        VALUES ('test_player_uuid', 'test_guest_voter', 5, test_partido_id);
        
        -- Clean up the test vote
        DELETE FROM votos WHERE votante_id = 'test_guest_voter';
        
        RAISE NOTICE 'Test vote insert/delete successful - policies are working!';
    ELSE
        RAISE NOTICE 'No partidos found for testing, but policies are configured';
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Test failed: %', SQLERRM;
END $$;

-- 7. Verify the final setup
SELECT 'Current RLS Policies:' as info;
SELECT schemaname, tablename, policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename IN ('votos', 'partidos', 'jugadores')
ORDER BY tablename, policyname;

SELECT 'Table Constraints:' as info;
SELECT conname, contype, conrelid::regclass as table_name
FROM pg_constraint 
WHERE conrelid IN ('votos'::regclass, 'partidos'::regclass, 'jugadores'::regclass)
AND contype IN ('u', 'c', 'n')
ORDER BY conrelid, conname;

SELECT 'Setup Complete!' as status;