-- FIXED Supabase RLS Policies for Guest Voting
-- Run these commands in your Supabase SQL editor

-- 1. Drop existing policies to start fresh
DROP POLICY IF EXISTS "Anyone can insert votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read votes" ON votos;
DROP POLICY IF EXISTS "Anyone can read partidos" ON partidos;
DROP POLICY IF EXISTS "Anyone can read jugadores" ON jugadores;

-- 2. Enable RLS on all tables
ALTER TABLE votos ENABLE ROW LEVEL SECURITY;
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;

-- 3. Create permissive policies for voting system

-- Allow anyone to insert votes (both authenticated and anonymous users)
CREATE POLICY "Public can insert votes" ON votos
FOR INSERT TO public
WITH CHECK (true);

-- Allow anyone to read votes (for checking voting status)
CREATE POLICY "Public can read votes" ON votos
FOR SELECT TO public
USING (true);

-- Allow anyone to read partidos (for accessing match info via link)
CREATE POLICY "Public can read partidos" ON partidos
FOR SELECT TO public
USING (true);

-- Allow anyone to read jugadores (for displaying player info)
CREATE POLICY "Public can read jugadores" ON jugadores
FOR SELECT TO public
USING (true);

-- 4. Add unique constraint to prevent duplicate votes (if not exists)
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

-- 5. Verify policies are working
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('votos', 'partidos', 'jugadores')
ORDER BY tablename, policyname;