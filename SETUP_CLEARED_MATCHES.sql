-- Execute this SQL in your Supabase SQL Editor to set up the cleared_matches table

-- Create cleared_matches table to track users who cleared matches from their list
CREATE TABLE IF NOT EXISTS public.cleared_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partido_id INTEGER NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, partido_id)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS cleared_matches_user_id_idx ON public.cleared_matches(user_id);
CREATE INDEX IF NOT EXISTS cleared_matches_partido_id_idx ON public.cleared_matches(partido_id);

-- Add RLS policies
ALTER TABLE public.cleared_matches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own cleared matches" ON public.cleared_matches;
DROP POLICY IF EXISTS "Users can insert their own cleared matches" ON public.cleared_matches;
DROP POLICY IF EXISTS "Users can delete their own cleared matches" ON public.cleared_matches;

-- Policy to allow users to view only their own cleared matches
CREATE POLICY "Users can view their own cleared matches" 
  ON public.cleared_matches 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Policy to allow users to insert their own cleared matches
CREATE POLICY "Users can insert their own cleared matches" 
  ON public.cleared_matches 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Policy to allow users to delete their own cleared matches
CREATE POLICY "Users can delete their own cleared matches" 
  ON public.cleared_matches 
  FOR DELETE 
  USING (auth.uid() = user_id);