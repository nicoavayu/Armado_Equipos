-- Core: public voting accepts only the voters the voting screen offers.
--
-- Public voting (/votar-equipos?codigo=…) identifies a voter by name — on purpose: the
-- WhatsApp link plus picking your name is the product, and picking someone else's name
-- is an accepted limitation (the server cannot tell who is holding the phone). The
-- screen only offers the match's guest starters (no account, not a substitute: the
-- screen tells substitutes they do not need to vote), but the RPCs accepted ANY name:
-- whoever has the match code could create unlimited fictitious voters, skewing the
-- ratings used to balance teams. So the server enforces the screen's roster rule:
--   * public_get_or_create_voter (service-only, shared by public_submit_player_rating,
--     public_submit_no_lo_conozco and public_mark_voter_completed) resolves a voter
--     only for a guest starter of that match; anything else returns NULL → 'invalid'.
-- Self-rating is deliberately NOT changed here: the screen leaves the voter out of the
-- players to rate, and the RPCs keep accepting what they accepted before.
-- Signatures, SECURITY DEFINER, search_path, return values and grants are unchanged;
-- bodies are the current definitions plus the roster check.

CREATE OR REPLACE FUNCTION public.public_get_or_create_voter(p_partido_id bigint, p_codigo text, p_votante_nombre text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- A public voter is one of the match's guest starters (no account, not a substitute):
  -- exactly who the voting screen lets people pick. Any other name is not a voter.
  IF NOT EXISTS (
    SELECT 1
    FROM public.jugadores roster_player
    WHERE roster_player.partido_id = p_partido_id
      AND roster_player.usuario_id IS NULL
      AND COALESCE(roster_player.is_substitute, false) = false
      AND public.public_normalize_voter_name(roster_player.nombre) = v_norm
  ) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.public_submit_player_rating(p_partido_id bigint, p_codigo text, p_votante_nombre text, p_votado_jugador_id bigint, p_puntaje integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.public_submit_no_lo_conozco(p_partido_id bigint, p_codigo text, p_votante_nombre text, p_votado_jugador_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Only the voting RPCs (SECURITY DEFINER) create voters; no client calls this directly (checked
-- in 1.1.21 and the web). Core Production still granted it to everyone.
select app_private.alignment_save_function_acl('public.public_get_or_create_voter(bigint,text,text)'::regprocedure);
revoke execute on function public.public_get_or_create_voter(bigint, text, text) from public, anon, authenticated;

do $public_voting_identity_check$
begin
  if position('roster_player.usuario_id IS NULL' in pg_get_functiondef('public.public_get_or_create_voter(bigint,text,text)'::regprocedure)) = 0 then
    raise exception 'public voting roster check did not install';
  end if;
  if has_function_privilege('anon', 'public.public_get_or_create_voter(bigint,text,text)', 'execute') then
    raise exception 'public_get_or_create_voter must stay service-only';
  end if;
end
$public_voting_identity_check$;
