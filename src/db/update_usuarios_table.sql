-- Add MVP, red cards, and rating columns to usuarios table if they don't exist

-- Add mvps column (MVP count)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'usuarios' AND column_name = 'mvps') THEN
    ALTER TABLE usuarios ADD COLUMN mvps INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add tarjetas_rojas column (red cards count)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'usuarios' AND column_name = 'tarjetas_rojas') THEN
    ALTER TABLE usuarios ADD COLUMN tarjetas_rojas INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add rating column (player rating)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'usuarios' AND column_name = 'rating') THEN
    ALTER TABLE usuarios ADD COLUMN rating DECIMAL(3,1) DEFAULT 5.0;
  END IF;
END $$;

-- Add surveys_processed column to partidos table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'partidos' AND column_name = 'surveys_processed') THEN
    ALTER TABLE partidos ADD COLUMN surveys_processed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add constraints to ensure valid values
DO $$
BEGIN
  -- MVP count should be non-negative
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                 WHERE constraint_name = 'usuarios_mvps_check') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_mvps_check CHECK (mvps >= 0);
  END IF;
  
  -- Red cards count should be non-negative
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                 WHERE constraint_name = 'usuarios_tarjetas_rojas_check') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_tarjetas_rojas_check CHECK (tarjetas_rojas >= 0);
  END IF;
  
  -- Rating should be between 1.0 and 10.0
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                 WHERE constraint_name = 'usuarios_rating_check') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_rating_check CHECK (rating >= 1.0 AND rating <= 10.0);
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_usuarios_mvps ON usuarios(mvps) WHERE mvps > 0;
CREATE INDEX IF NOT EXISTS idx_usuarios_tarjetas_rojas ON usuarios(tarjetas_rojas) WHERE tarjetas_rojas > 0;
CREATE INDEX IF NOT EXISTS idx_usuarios_rating ON usuarios(rating);

-- Add comments for documentation
COMMENT ON COLUMN usuarios.mvps IS 'Number of MVP awards received from post-match surveys';
COMMENT ON COLUMN usuarios.tarjetas_rojas IS 'Number of red cards (violent behavior) from post-match surveys';
COMMENT ON COLUMN usuarios.rating IS 'Player rating (1.0-10.0), affected by absences and performance';
COMMENT ON COLUMN partidos.surveys_processed IS 'Whether post-match surveys have been processed for this match';