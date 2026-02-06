-- Fix public_get_or_create_voter function to remove codigo column
-- and properly populate nombre_norm column
-- The public_voters table doesn't have a 'codigo' column, so we need to remove it from the INSERT

CREATE OR REPLACE FUNCTION public.public_get_or_create_voter(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_norm text;
  v_id bigint;
BEGIN
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  SELECT id INTO v_id
  FROM public.public_voters
  WHERE partido_id = p_partido_id
    AND votante_nombre_norm = v_norm
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- FIXED: Removed 'codigo' column and properly populate nombre_norm
  INSERT INTO public.public_voters (partido_id, nombre, nombre_norm, votante_nombre_norm, created_at)
  VALUES (p_partido_id, trim(p_votante_nombre), v_norm, v_norm, now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Also check schema of votos_publicos to prevent future errors
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'votos_publicos' 
AND table_schema = 'public'
ORDER BY ordinal_position;
