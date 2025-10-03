-- Ampliar tipos de premio y contadores
ALTER TABLE player_awards
  ADD COLUMN IF NOT EXISTS award_type text;

-- Asegurar constraint con los 3 tipos
ALTER TABLE player_awards DROP CONSTRAINT IF EXISTS player_awards_award_type_check;
ALTER TABLE player_awards ADD CONSTRAINT player_awards_award_type_check
  CHECK (award_type IN ('mvp','best_gk','red_card'));

-- Agregar contador de tarjetas rojas a players
ALTER TABLE players ADD COLUMN IF NOT EXISTS red_badges int NOT NULL DEFAULT 0;

-- Si los contadores están en profiles, agregar también allí
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS red_badges int NOT NULL DEFAULT 0;