-- Drop and recreate player_awards table without otorgado_por column
DROP TABLE IF EXISTS player_awards;

CREATE TABLE player_awards (
  id SERIAL PRIMARY KEY,
  jugador_id UUID NOT NULL,
  partido_id INTEGER NOT NULL,
  award_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE player_awards ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view player awards" ON player_awards
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert player awards" ON player_awards
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');