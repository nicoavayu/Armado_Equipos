-- Create player_awards table for storing player badges and awards
CREATE TABLE IF NOT EXISTS player_awards (
  id BIGSERIAL PRIMARY KEY,
  jugador_id UUID NOT NULL,
  partido_id BIGINT NOT NULL,
  award_type VARCHAR(50) NOT NULL,
  otorgado_por UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign key constraints
  CONSTRAINT fk_player_awards_partido 
    FOREIGN KEY (partido_id) 
    REFERENCES partidos(id) 
    ON DELETE CASCADE,
    
  -- Ensure only one award of each type per player per match
  CONSTRAINT unique_award_per_player_per_match 
    UNIQUE (jugador_id, partido_id, award_type)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_player_awards_jugador_id ON player_awards(jugador_id);
CREATE INDEX IF NOT EXISTS idx_player_awards_partido_id ON player_awards(partido_id);
CREATE INDEX IF NOT EXISTS idx_player_awards_award_type ON player_awards(award_type);

-- Add RLS (Row Level Security) policies
ALTER TABLE player_awards ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to read all awards
CREATE POLICY "Allow authenticated users to read awards" ON player_awards
  FOR SELECT TO authenticated
  USING (true);

-- Policy to allow authenticated users to insert awards
CREATE POLICY "Allow authenticated users to insert awards" ON player_awards
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Policy to allow users to update awards they created
CREATE POLICY "Allow users to update their awards" ON player_awards
  FOR UPDATE TO authenticated
  USING (otorgado_por = auth.uid());

-- Policy to allow users to delete awards they created
CREATE POLICY "Allow users to delete their awards" ON player_awards
  FOR DELETE TO authenticated
  USING (otorgado_por = auth.uid());

-- Insert sample award types (optional - for reference)
COMMENT ON TABLE player_awards IS 'Stores player awards and badges earned in matches';
COMMENT ON COLUMN player_awards.award_type IS 'Types: mvp, guante_dorado, tarjeta_roja';