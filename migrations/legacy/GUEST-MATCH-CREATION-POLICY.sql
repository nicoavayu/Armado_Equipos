-- Supabase RLS Policy to Allow Guest Match Creation
-- Run this command in your Supabase SQL editor

-- Allow anyone (authenticated and anonymous) to insert new matches
CREATE POLICY "Public can create matches" ON partidos
FOR INSERT TO public
WITH CHECK (true);

-- Allow anyone to update match players (for adding/removing players)
CREATE POLICY "Public can update match players" ON partidos
FOR UPDATE TO public
USING (true)
WITH CHECK (true);