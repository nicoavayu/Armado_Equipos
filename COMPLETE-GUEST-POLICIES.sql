-- Complete Supabase RLS Policies for Guest Match Creation and Voting
-- Run these commands in your Supabase SQL editor

-- 1. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Public can create matches" ON partidos;
DROP POLICY IF EXISTS "Public can update match players" ON partidos;
DROP POLICY IF EXISTS "Public can insert votes" ON votos;
DROP POLICY IF EXISTS "Public can read votes" ON votos;
DROP POLICY IF EXISTS "Public can read partidos" ON partidos;
DROP POLICY IF EXISTS "Public can read jugadores" ON jugadores;

-- 2. Enable RLS on all tables
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE votos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;

-- 3. PARTIDOS table policies (for match creation and management)

-- Allow anyone to create new matches
CREATE POLICY "Public can create matches" ON partidos
FOR INSERT TO public
WITH CHECK (true);

-- Allow anyone to read match information
CREATE POLICY "Public can read partidos" ON partidos
FOR SELECT TO public
USING (true);

-- Allow anyone to update match players and basic info
CREATE POLICY "Public can update match players" ON partidos
FOR UPDATE TO public
USING (true)
WITH CHECK (true);

-- 4. VOTOS table policies (for voting system)

-- Allow anyone to insert votes
CREATE POLICY "Public can insert votes" ON votos
FOR INSERT TO public
WITH CHECK (true);

-- Allow anyone to read votes (for checking voting status)
CREATE POLICY "Public can read votes" ON votos
FOR SELECT TO public
USING (true);

-- 5. JUGADORES table policies (for player management)

-- Allow anyone to read player information
CREATE POLICY "Public can read jugadores" ON jugadores
FOR SELECT TO public
USING (true);

-- 6. Add unique constraint to prevent duplicate votes (if not exists)
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

-- 7. Verify all policies are created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('votos', 'partidos', 'jugadores')
ORDER BY tablename, policyname;