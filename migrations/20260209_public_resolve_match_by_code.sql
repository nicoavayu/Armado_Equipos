-- ============================================================================
-- PUBLIC RPC: resolve match ID by code (for anonymous voting links)
-- Date: 2026-02-09
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_match_by_code(p_codigo text)
RETURNS bigint
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
  v_code text := upper(trim(coalesce(p_codigo, '')));
BEGIN
  IF v_code = '' THEN
    RETURN NULL;
  END IF;

  SELECT p.id
  INTO v_id
  FROM public.partidos p
  WHERE upper(trim(p.codigo)) = v_code
    AND coalesce(p.estado, 'active') NOT IN ('cancelado', 'deleted')
  ORDER BY p.id DESC
  LIMIT 1;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_match_by_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_match_by_code(text) TO authenticated;
