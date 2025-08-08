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

-- Comment on table and columns
COMMENT ON TABLE public.cleared_matches IS 'Tracks matches that users have cleared from their upcoming matches list';
COMMENT ON COLUMN public.cleared_matches.id IS 'Unique identifier for the cleared match record';
COMMENT ON COLUMN public.cleared_matches.user_id IS 'User who cleared the match';
COMMENT ON COLUMN public.cleared_matches.partido_id IS 'Match that was cleared';
COMMENT ON COLUMN public.cleared_matches.created_at IS 'When the match was cleared';