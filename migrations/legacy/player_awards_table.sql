-- Create player_awards table for badges
CREATE TABLE IF NOT EXISTS player_awards (
  id SERIAL PRIMARY KEY,
  jugador_id UUID NOT NULL,
  partido_id INTEGER NOT NULL,
  award_type VARCHAR(50) NOT NULL,
  otorgado_por UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE player_awards ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view player awards" ON player_awards;
DROP POLICY IF EXISTS "Authenticated users can insert player awards" ON player_awards;

-- Create policies
CREATE POLICY "Anyone can view player awards" ON player_awards
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert player awards" ON player_awards
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');