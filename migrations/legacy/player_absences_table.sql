-- Create player_absences table to track player absence notifications
-- This table helps determine if a player should receive rating penalties

CREATE TABLE IF NOT EXISTS player_absences (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  partido_id BIGINT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  found_replacement BOOLEAN DEFAULT FALSE,
  notified_in_time BOOLEAN DEFAULT FALSE,
  hours_before_match DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one absence record per user per match
  UNIQUE(user_id, partido_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_player_absences_user_id ON player_absences(user_id);
CREATE INDEX IF NOT EXISTS idx_player_absences_partido_id ON player_absences(partido_id);
CREATE INDEX IF NOT EXISTS idx_player_absences_created_at ON player_absences(created_at);

-- Add RLS (Row Level Security) policies
ALTER TABLE player_absences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own absence records
CREATE POLICY "Users can view own absences" ON player_absences
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can only insert their own absence records
CREATE POLICY "Users can insert own absences" ON player_absences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only update their own absence records
CREATE POLICY "Users can update own absences" ON player_absences
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Allow match admins to view absences for their matches
CREATE POLICY "Match admins can view match absences" ON player_absences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM partidos 
      WHERE partidos.id = player_absences.partido_id 
      AND partidos.creado_por = auth.uid()
    )
  );

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_player_absences_updated_at 
  BEFORE UPDATE ON player_absences 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE player_absences IS 'Tracks player absence notifications to determine rating penalties';
COMMENT ON COLUMN player_absences.user_id IS 'User who is absent';
COMMENT ON COLUMN player_absences.partido_id IS 'Match they are absent from';
COMMENT ON COLUMN player_absences.reason IS 'Reason for absence';
COMMENT ON COLUMN player_absences.found_replacement IS 'Whether player found a replacement';
COMMENT ON COLUMN player_absences.notified_in_time IS 'Whether player notified 4+ hours before match';
COMMENT ON COLUMN player_absences.hours_before_match IS 'How many hours before match the notification was made';