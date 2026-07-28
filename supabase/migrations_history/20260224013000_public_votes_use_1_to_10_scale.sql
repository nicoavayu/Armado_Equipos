BEGIN;

-- Remove legacy CHECK constraints that cap public vote score at 5.
DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'votos_publicos'
      AND c.contype = 'c'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%puntaje%<= 5%'
        OR pg_get_constraintdef(c.oid) ILIKE '%puntaje <= 5%'
        OR pg_get_constraintdef(c.oid) ILIKE '%between 1 and 5%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.votos_publicos DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END
$$;

-- Keep puntaje range consistent with the product scale (1..10).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'votos_publicos'
      AND c.conname = 'votos_publicos_puntaje_1_10_chk'
  ) THEN
    ALTER TABLE public.votos_publicos
      ADD CONSTRAINT votos_publicos_puntaje_1_10_chk
      CHECK (puntaje = 0 OR (puntaje BETWEEN 1 AND 10)) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.public_submit_player_rating(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text,
  p_votado_jugador_id bigint,
  p_puntaje integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voter_id bigint;
  v_norm text;
BEGIN
  IF p_partido_id IS NULL
     OR p_codigo IS NULL OR trim(p_codigo) = ''
     OR p_votante_nombre IS NULL OR trim(p_votante_nombre) = ''
     OR p_votado_jugador_id IS NULL
     OR p_puntaje IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF p_puntaje < 1 OR p_puntaje > 10 THEN
    RETURN 'invalid_score';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.partidos
    WHERE id = p_partido_id
      AND codigo = trim(p_codigo)
  ) THEN
    RETURN 'invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jugadores
    WHERE id = p_votado_jugador_id
      AND partido_id = p_partido_id
  ) THEN
    RETURN 'invalid_player';
  END IF;

  v_voter_id := public.public_get_or_create_voter(
    p_partido_id,
    trim(p_codigo),
    p_votante_nombre
  );

  IF v_voter_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.public_voters
    WHERE id = v_voter_id
      AND completed_at IS NOT NULL
  ) THEN
    RETURN 'already_voted_for_match';
  END IF;

  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  INSERT INTO public.votos_publicos(
    partido_id,
    public_voter_id,
    votado_jugador_id,
    puntaje,
    votante_nombre,
    votante_nombre_norm
  )
  VALUES (
    p_partido_id,
    v_voter_id,
    p_votado_jugador_id,
    p_puntaje,
    trim(p_votante_nombre),
    v_norm
  );

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'already_voted_for_player';
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_submit_player_rating(bigint, text, text, bigint, integer)
  TO anon, authenticated, service_role;

COMMIT;
