-- MINIMAL FIX: Allow anonymous users to create matches
-- Run this in your Supabase SQL editor

-- Enable RLS on partidos table
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert new matches
CREATE POLICY "Allow public insert on partidos" ON partidos
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- Allow anyone to read matches
CREATE POLICY "Allow public select on partidos" ON partidos
FOR SELECT TO anon, authenticated
USING (true);

-- Allow anyone to update matches
CREATE POLICY "Allow public update on partidos" ON partidos
FOR UPDATE TO anon, authenticated
USING (true)
WITH CHECK (true);