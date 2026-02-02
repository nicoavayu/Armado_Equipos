-- RPC function for public invitation access
-- Allows anonymous users to fetch match details using id + codigo validation
-- SECURITY DEFINER bypasses RLS while maintaining security through codigo validation

CREATE OR REPLACE FUNCTION get_partido_by_invite(
  p_partido_id bigint,
  p_codigo text
)
RETURNS TABLE (
  id bigint,
  nombre text,
  fecha date,
  hora time,
  sede text,
  modalidad text,
  cupo integer,
  foto_url text,
  codigo text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    cupo_jugadores smallint,
  IF p_partido_id IS NULL OR p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN;
  END IF;

  -- Return match only if id AND codigo match
  RETURN QUERY
  SELECT 
    p.id,
    p.nombre,
    p.fecha,
    p.hora,
    p.sede,
    p.modalidad,
    p.cupo,
    p.foto_url,
    p.codigo
  FROM partidos p
  WHERE p.id = p_partido_id 
    AND p.codigo = trim(p_codigo);
END;
      p.cupo_jugadores,

-- Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION get_partido_by_invite(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION get_partido_by_invite(bigint, text) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_partido_by_invite IS 'Public RPC for invitation flow - returns match details only if id + codigo match';
