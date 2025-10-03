-- Registro de penalizaciones (evita duplicados)
CREATE TABLE IF NOT EXISTS no_show_penalties (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT -0.3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

-- Asegurar columna de ranking en profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ranking NUMERIC NOT NULL DEFAULT 0;

-- Si también usas players table para ranking
-- ALTER TABLE players ADD COLUMN IF NOT EXISTS ranking NUMERIC NOT NULL DEFAULT 0;