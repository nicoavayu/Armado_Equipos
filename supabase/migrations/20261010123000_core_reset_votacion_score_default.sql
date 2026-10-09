-- Core: "Resetear votación" really resets.
--
-- reset_votacion (the organizer's RPC) clears votes, public voters and vote
-- notifications, then sets jugadores.score = NULL. jugadores.score is NOT NULL DEFAULT 5
-- in the canonical schema, so on every database built from the repo the RPC aborted on
-- the first match with players (23502) and the app fell back to client-side deletes that
-- RLS silently turns into no-ops: the screen said "Votación reseteada" while every vote
-- and every "ya votó" stayed, and nobody could vote again.
-- Fix: reset the score to the column default where the column is NOT NULL; keep NULL
-- where it is nullable (a database where the old body already worked behaves as before).
-- Signature, SECURITY DEFINER, search_path, authorization and grants are unchanged.

CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_admin_id uuid;
  v_match_code text;
  v_rebuilt_notifications integer := 0;
  v_public_markers integer := 0;
BEGIN
  IF match_id IS NULL THEN
    RAISE EXCEPTION 'match_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.creado_por, p.codigo
  INTO v_admin_id, v_match_code
  FROM public.partidos p
  WHERE p.id = match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', match_id USING ERRCODE = 'P0002';
  END IF;

  -- Only the match admin may reset voting. service_role / backend jobs run with
  -- auth.uid() = NULL and are allowed through for maintenance.
  IF v_uid IS NOT NULL AND v_admin_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized: solo el admin del partido puede resetear la votacion'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.votos
  WHERE partido_id = match_id;

  DELETE FROM public.votos_publicos
  WHERE partido_id = match_id;

  DELETE FROM public.public_voters
  WHERE partido_id = match_id;

  -- Where jugadores.score is NOT NULL (every database built from the repo) the old
  -- `score = NULL` aborted the whole reset; there the column default is "no votes yet".
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.jugadores'::regclass AND attname = 'score' AND attnotnull
  ) THEN
    UPDATE public.jugadores
    SET score = DEFAULT
    WHERE partido_id = match_id;
  ELSE
    UPDATE public.jugadores
    SET score = NULL
    WHERE partido_id = match_id;
  END IF;

  PERFORM public.cleanup_voting_access_state(match_id);

  WITH current_roster AS (
    SELECT DISTINCT j.usuario_id AS user_id
    FROM public.jugadores j
    WHERE j.partido_id = match_id
      AND j.usuario_id IS NOT NULL
      AND COALESCE(j.is_substitute, false) = false
  ),
  rebuilt_vote_notifications AS (
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      partido_id,
      data,
      read,
      created_at,
      send_at
    )
    SELECT
      r.user_id,
      '¡Hora de votar!',
      'Entrá a la app y calificá a los jugadores para armar los equipos.',
      'call_to_vote',
      match_id,
      jsonb_build_object(
        'match_id', match_id::text,
        'matchId', match_id,
        'matchCode', v_match_code
      ),
      false,
      now(),
      now()
    FROM current_roster r
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = false,
      send_at = now()
    RETURNING id
  ),
  public_voting_marker AS (
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      partido_id,
      data,
      read,
      created_at,
      send_at
    )
    SELECT
      v_admin_id,
      'Votación abierta',
      'Link público de votación habilitado.',
      'pre_match_vote',
      match_id,
      jsonb_build_object(
        'match_id', match_id::text,
        'matchId', match_id,
        'matchCode', v_match_code
      ),
      true,
      now(),
      now()
    WHERE NOT EXISTS (SELECT 1 FROM current_roster)
      AND v_admin_id IS NOT NULL
      AND NULLIF(trim(COALESCE(v_match_code, '')), '') IS NOT NULL
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = true,
      send_at = now()
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM rebuilt_vote_notifications),
    (SELECT count(*) FROM public_voting_marker)
  INTO v_rebuilt_notifications, v_public_markers;
END;
$function$;


do $reset_votacion_check$
begin
  if position('attnotnull' in pg_get_functiondef('public.reset_votacion(bigint)'::regprocedure)) = 0 then
    raise exception 'reset_votacion score reset did not install';
  end if;
  if has_function_privilege('anon', 'public.reset_votacion(bigint)', 'execute') then
    raise exception 'reset_votacion must not be executable by anon';
  end if;
end
$reset_votacion_check$;
