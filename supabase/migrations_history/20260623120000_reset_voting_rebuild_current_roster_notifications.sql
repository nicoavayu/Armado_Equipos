-- Rebuild vote-call notification state from the current match roster on reset.
--
-- reset_votacion already clears votes and old voting-access rows. This version
-- also recreates the active call_to_vote rows from public.jugadores so a reset
-- after roster edits includes newly added registered players and excludes
-- removed players. Public link/code voting stays open through the same admin
-- marker used by the frontend when there are no registered recipients.

BEGIN;

CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.jugadores
  SET score = NULL
  WHERE partido_id = match_id;

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
$$;

REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role;

COMMIT;
