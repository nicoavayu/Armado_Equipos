-- Supabase RLS Policies for Guest Voting
-- Run these commands in your Supabase SQL editor

-- 1. Enable RLS on votos table
ALTER TABLE votos ENABLE ROW LEVEL SECURITY;

-- 2. Allow anyone to insert votes (authenticated and guests)
CREATE POLICY "Anyone can insert votes" ON votos
FOR INSERT WITH CHECK (true);

-- 3. Allow anyone to read votes (for displaying voting status)
CREATE POLICY "Anyone can read votes" ON votos
FOR SELECT USING (true);

-- 4. Allow reading partidos for guests to access match info
CREATE POLICY "Anyone can read partidos" ON partidos
FOR SELECT USING (true);

-- 5. Allow reading jugadores for displaying player info
CREATE POLICY "Anyone can read jugadores" ON jugadores
FOR SELECT USING (true);

-- Optional: If you want to prevent abuse, you can add rate limiting
-- or restrict based on IP, but for now we allow all public access