BEGIN;

CREATE OR REPLACE FUNCTION public.is_public_voting_open(p_partido_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = p_partido_id
      AND lower(COALESCE(p.estado, '')) = 'votacion'
      AND EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.type IN ('call_to_vote', 'pre_match_vote')
          AND (
            n.partido_id = p_partido_id
            OR COALESCE(n.data ->> 'match_id', '') = p_partido_id::text
            OR COALESCE(n.data ->> 'matchId', '') = p_partido_id::text
            OR COALESCE(n.data ->> 'partido_id', '') = p_partido_id::text
            OR COALESCE(n.data ->> 'partidoId', '') = p_partido_id::text
          )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_voting_open(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_voting_open(bigint) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_voting_access_state(p_partido_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE type IN ('call_to_vote', 'pre_match_vote')
    AND (
      partido_id = p_partido_id
      OR COALESCE(data ->> 'match_id', '') = p_partido_id::text
      OR COALESCE(data ->> 'matchId', '') = p_partido_id::text
      OR COALESCE(data ->> 'partido_id', '') = p_partido_id::text
      OR COALESCE(data ->> 'partidoId', '') = p_partido_id::text
    );

  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    DELETE FROM public.notification_delivery_log
    WHERE partido_id = p_partido_id
      AND (
        notification_type IN ('call_to_vote', 'pre_match_vote')
        OR COALESCE(payload_json ->> 'event_channel', '') = 'VOTE_REQUEST'
        OR COALESCE(payload_json ->> 'eventType', '') = 'call_to_vote'
        OR COALESCE(payload_json ->> 'match_id', '') = p_partido_id::text
        OR COALESCE(payload_json ->> 'matchId', '') = p_partido_id::text
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.votos
  WHERE partido_id = match_id;

  DELETE FROM public.votos_publicos
  WHERE partido_id = match_id;

  DELETE FROM public.public_voters
  WHERE partido_id = match_id;

  UPDATE public.jugadores
  SET score = NULL
  WHERE partido_id = match_id;

  PERFORM public.cleanup_voting_access_state(match_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role, anon;

ALTER TABLE IF EXISTS public.public_voters
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE IF EXISTS public.public_voters
  ADD COLUMN IF NOT EXISTS nombre_norm text;

ALTER TABLE IF EXISTS public.public_voters
  ADD COLUMN IF NOT EXISTS votante_nombre_norm text;

ALTER TABLE IF EXISTS public.votos_publicos
  ADD COLUMN IF NOT EXISTS no_lo_conozco boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.votos_publicos
  ADD COLUMN IF NOT EXISTS votante_nombre_norm text;

CREATE OR REPLACE FUNCTION public.public_normalize_voter_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g')), '');
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_voters'
      AND column_name = 'nombre'
  ) THEN
    UPDATE public.public_voters
    SET
      nombre_norm = COALESCE(NULLIF(nombre_norm, ''), public.public_normalize_voter_name(nombre)),
      votante_nombre_norm = COALESCE(NULLIF(votante_nombre_norm, ''), public.public_normalize_voter_name(nombre))
    WHERE
      COALESCE(NULLIF(nombre_norm, ''), '') = ''
      OR COALESCE(NULLIF(votante_nombre_norm, ''), '') = '';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'votos_publicos'
      AND column_name = 'votante_nombre'
  ) THEN
    UPDATE public.votos_publicos
    SET votante_nombre_norm = COALESCE(NULLIF(votante_nombre_norm, ''), public.public_normalize_voter_name(votante_nombre))
    WHERE COALESCE(NULLIF(votante_nombre_norm, ''), '') = '';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_get_or_create_voter(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_id bigint;
  v_display_name text;
BEGIN
  v_display_name := trim(COALESCE(p_votante_nombre, ''));
  v_norm := public.public_normalize_voter_name(v_display_name);

  IF p_partido_id IS NULL OR v_norm IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_id
  FROM public.public_voters
  WHERE partido_id = p_partido_id
    AND (
      COALESCE(votante_nombre_norm, '') = v_norm
      OR COALESCE(nombre_norm, '') = v_norm
    )
  ORDER BY id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.public_voters
    SET
      nombre = COALESCE(NULLIF(v_display_name, ''), nombre),
      nombre_norm = v_norm,
      votante_nombre_norm = v_norm
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.public_voters (
    partido_id,
    nombre,
    nombre_norm,
    votante_nombre_norm
  )
  VALUES (
    p_partido_id,
    v_display_name,
    v_norm,
    v_norm
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id
    INTO v_id
    FROM public.public_voters
    WHERE partido_id = p_partido_id
      AND (
        COALESCE(votante_nombre_norm, '') = v_norm
        OR COALESCE(nombre_norm, '') = v_norm
      )
    ORDER BY id
    LIMIT 1;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_get_or_create_voter(bigint, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_has_voter_already_voted(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  IF p_partido_id IS NULL
     OR p_codigo IS NULL OR trim(p_codigo) = ''
     OR v_norm IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.partidos
    WHERE id = p_partido_id
      AND codigo = trim(p_codigo)
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.public_voters
    WHERE partido_id = p_partido_id
      AND (
        COALESCE(votante_nombre_norm, '') = v_norm
        OR COALESCE(nombre_norm, '') = v_norm
      )
      AND completed_at IS NOT NULL
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.votos_publicos
    WHERE partido_id = p_partido_id
      AND COALESCE(votante_nombre_norm, public.public_normalize_voter_name(votante_nombre)) = v_norm
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.votos
    WHERE partido_id = p_partido_id
      AND public.public_normalize_voter_name(jugador_nombre) = v_norm
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_has_voter_already_voted(bigint, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_mark_voter_completed(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_voter_id bigint;
  v_completed_at timestamptz;
BEGIN
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  IF p_partido_id IS NULL
     OR p_codigo IS NULL OR trim(p_codigo) = ''
     OR v_norm IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.partidos
    WHERE id = p_partido_id
      AND codigo = trim(p_codigo)
  ) THEN
    RETURN 'invalid';
  END IF;

  SELECT id, completed_at
  INTO v_voter_id, v_completed_at
  FROM public.public_voters
  WHERE partido_id = p_partido_id
    AND (
      COALESCE(votante_nombre_norm, '') = v_norm
      OR COALESCE(nombre_norm, '') = v_norm
    )
  ORDER BY id
  LIMIT 1;

  IF v_voter_id IS NULL THEN
    v_voter_id := public.public_get_or_create_voter(p_partido_id, trim(p_codigo), p_votante_nombre);
    v_completed_at := NULL;
  END IF;

  IF v_voter_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF v_completed_at IS NOT NULL THEN
    RETURN 'already_completed';
  END IF;

  UPDATE public.public_voters
  SET
    completed_at = now(),
    nombre = trim(p_votante_nombre),
    nombre_norm = v_norm,
    votante_nombre_norm = v_norm
  WHERE id = v_voter_id;

  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_mark_voter_completed(bigint, text, text) TO anon, authenticated, service_role;

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
  IF NOT public.is_public_voting_open(p_partido_id) THEN
    RETURN 'voting_not_open';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.public_submit_player_rating(bigint, text, text, bigint, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_submit_no_lo_conozco(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text,
  p_votado_jugador_id bigint
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
  IF NOT public.is_public_voting_open(p_partido_id) THEN
    RETURN 'voting_not_open';
  END IF;

  IF p_partido_id IS NULL
     OR p_codigo IS NULL OR trim(p_codigo) = ''
     OR p_votante_nombre IS NULL OR trim(p_votante_nombre) = ''
     OR p_votado_jugador_id IS NULL THEN
    RETURN 'invalid';
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
    votante_nombre,
    votante_nombre_norm,
    no_lo_conozco,
    puntaje
  )
  VALUES (
    p_partido_id,
    v_voter_id,
    p_votado_jugador_id,
    trim(p_votante_nombre),
    v_norm,
    true,
    0
  );

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'already_voted_for_player';
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_submit_no_lo_conozco(bigint, text, text, bigint) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_voting_open_before_vote_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.partido_id IS NULL OR NOT public.is_public_voting_open(NEW.partido_id) THEN
    RAISE EXCEPTION 'voting_not_open' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_votos_require_open_voting ON public.votos;
CREATE TRIGGER trg_votos_require_open_voting
BEFORE INSERT ON public.votos
FOR EACH ROW
EXECUTE FUNCTION public.enforce_voting_open_before_vote_insert();

COMMIT;
