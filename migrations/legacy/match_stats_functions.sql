-- Función para incrementar partidos_jugados
CREATE OR REPLACE FUNCTION increment_matches_played(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE usuarios 
  SET partidos_jugados = COALESCE(partidos_jugados, 0) + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Función para incrementar partidos_abandonados  
CREATE OR REPLACE FUNCTION increment_matches_abandoned(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE usuarios 
  SET partidos_abandonados = COALESCE(partidos_abandonados, 0) + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;