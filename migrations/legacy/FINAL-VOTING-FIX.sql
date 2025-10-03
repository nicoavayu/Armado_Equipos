-- FINAL VOTING SYSTEM FIX - Complete Database Setup
-- Run ALL of these commands in your Supabase SQL editor

-- 1. First, let's see what policies currently exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('votos', 'partidos', 'jugadores')
ORDER BY tablename, policyname;

-- 2. Drop ALL existing policies to start completely fresh
DROP POLICY IF EXISTS "Anyone can insert votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read votes" ON votos;
DROP POLICY IF EXISTS "Public can insert votes" ON votos;
DROP POLICY IF EXISTS "Public can read votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read partidos" ON partidos;
DROP POLICY IF EXISTS "Public can read partidos" ON partidos;
DROP POLICY IF EXISTS "Anyone can read jugadores" ON jugadores;
DROP POLICY IF EXISTS "Public can read jugadores" ON jugadores;

-- 3. Disable RLS temporarily to ensure clean setup
ALTER TABLE votos DISABLE ROW LEVEL SECURITY;
ALTER TABLE partidos DISABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores DISABLE ROW LEVEL SECURITY;

-- 4. Clean up any votes with null partido_id
DELETE FROM votos WHERE partido_id IS NULL;

-- 5. Add NOT NULL constraint to prevent future null partido_id
ALTER TABLE votos ALTER COLUMN partido_id SET NOT NULL;

-- 6. Add unique constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_vote_per_match'
    ) THEN
        ALTER TABLE votos ADD CONSTRAINT unique_vote_per_match 
        UNIQUE (votante_id, partido_id);
    END IF;
END $$;

-- 7. Re-enable RLS
ALTER TABLE votos ENABLE ROW LEVEL SECURITY;
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;

-- 8. Create the most permissive policies possible for public access
CREATE POLICY "allow_all_votes_insert" ON votos
FOR INSERT TO public
WITH CHECK (true);

CREATE POLICY "allow_all_votes_select" ON votos
FOR SELECT TO public
USING (true);

CREATE POLICY "allow_all_partidos_select" ON partidos
FOR SELECT TO public
USING (true);

CREATE POLICY "allow_all_jugadores_select" ON jugadores
FOR SELECT TO public
USING (true);

-- 9. Verify the setup worked
SELECT 'Policies created:' as status;
SELECT schemaname, tablename, policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename IN ('votos', 'partidos', 'jugadores')
ORDER BY tablename, policyname;

SELECT 'Constraints:' as status;
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'votos'::regclass;

-- 10. Test insert (this should work)
-- INSERT INTO votos (votado_id, votante_id, puntaje, partido_id) 
-- VALUES ('test_player', 'test_voter', 5, 1);
-- DELETE FROM votos WHERE votante_id = 'test_voter';

SELECT 'Setup complete!' as status;