-- Hotfix: some DBs don't have partidos.cupo, only partidos.cupo_jugadores.
-- Keep the function signature stable (returns `cupo`) but source it from cupo_jugadores.

CREATE OR REPLACE FUNCTION public.get_partido_by_invite(
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
  IF p_partido_id IS NULL OR p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre,
    p.fecha,
    NULLIF(p.hora::text, '')::time AS hora,
    p.sede,
    p.modalidad,
    COALESCE(p.cupo_jugadores, 0)::int AS cupo,
    NULL::text AS foto_url,
    p.codigo
  FROM public.partidos p
  WHERE p.id = p_partido_id
    AND p.codigo = trim(p_codigo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_partido_by_invite(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_partido_by_invite(bigint, text) TO authenticated;
