-- ============================================================================
-- Challenge result conflict resolution
-- Date: 2026-06-16
--
-- Adds the missing conflict-resolution half of the captain-only result flow:
--   * team_matches gains result_resolved_by_user_id / result_resolved_at.
--   * rpc_resolve_challenge_result lets ONLY the challenge creator
--     (challenges.created_by_user_id) break a result_conflict tie, which finally
--     confirms the result and lets statistics count it.
--   * rpc_report_challenge_result now notifies (in-app + queued push) the
--     challenge creator the moment two captains disagree, so they know they have
--     to resolve it.
--   * One-time idempotent cleanup resolves stale challenge_result_conflict
--     prompts for matches that are no longer in conflict.
-- ============================================================================

BEGIN;

ALTER TABLE public.team_matches
  ADD COLUMN IF NOT EXISTS result_resolved_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result_resolved_at timestamptz NULL;

-- ----------------------------------------------------------------------------
-- Report RPC: same per-team report logic as before, but the conflict branch now
-- notifies the challenge creator so they can resolve the tie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(
  p_challenge_id uuid,
  p_result_status text
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_reporter_team_id uuid;
  v_can_report_for_challenger boolean := false;
  v_can_report_for_accepted boolean := false;
  v_report_count integer := 0;
  v_distinct_status_count integer := 0;
  v_resolved_status text := NULL;
  v_team_a_name text;
  v_team_b_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_result_status IS NULL OR p_result_status NOT IN ('team_a_win', 'team_b_win', 'draw') THEN
    RAISE EXCEPTION 'Resultado invalido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado en desafios confirmados';
  END IF;

  IF v_challenge.status = 'accepted'
     AND (v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()) THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado cuando el desafio ya se jugo';
  END IF;

  v_can_report_for_challenger := public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.challenger_team_id, v_uid);
  v_can_report_for_accepted := public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.accepted_team_id, v_uid);

  IF NOT (v_can_report_for_challenger OR v_can_report_for_accepted) THEN
    RAISE EXCEPTION 'Solo owner/capitan/admin involucrado puede responder el resultado';
  END IF;

  IF v_can_report_for_challenger AND v_can_report_for_accepted THEN
    RAISE EXCEPTION 'No se pudo identificar un unico equipo para responder el resultado';
  END IF;

  IF v_can_report_for_challenger THEN
    v_reporter_team_id := v_challenge.challenger_team_id;
  ELSE
    v_reporter_team_id := v_challenge.accepted_team_id;
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = p_challenge_id
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_match.result_conflict, false) THEN
      RAISE EXCEPTION 'El resultado del desafio esta en conflicto y requiere revision manual';
    END IF;

    IF COALESCE(v_match.result_confirmed, false) THEN
      RAISE EXCEPTION 'El resultado del desafio ya fue confirmado';
    END IF;
  ELSE
    INSERT INTO public.team_matches (
      origin_type,
      challenge_id,
      team_a_id,
      team_b_id,
      played_at,
      scheduled_at,
      format,
      mode,
      location,
      location_name,
      status,
      result_status,
      result_confirmed,
      result_conflict,
      result_reported_by_team_id,
      result_reported_at,
      result_updated_at,
      updated_at
    ) VALUES (
      'challenge',
      v_challenge.id,
      v_challenge.challenger_team_id,
      v_challenge.accepted_team_id,
      now(),
      COALESCE(v_challenge.scheduled_at, now()),
      v_challenge.format,
      v_challenge.mode,
      COALESCE(v_challenge.location, v_challenge.location_name),
      COALESCE(v_challenge.location, v_challenge.location_name),
      'played',
      NULL,
      false,
      false,
      NULL,
      NULL,
      NULL,
      now()
    )
    RETURNING * INTO v_match;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.challenge_result_reports r
    WHERE r.team_match_id = v_match.id
      AND r.reporting_team_id = v_reporter_team_id
  ) THEN
    RAISE EXCEPTION 'Tu equipo ya cargo el resultado de este desafio';
  END IF;

  INSERT INTO public.challenge_result_reports (
    team_match_id,
    challenge_id,
    reporting_team_id,
    reported_by_user_id,
    reported_result_status,
    created_at,
    updated_at
  ) VALUES (
    v_match.id,
    v_challenge.id,
    v_reporter_team_id,
    v_uid,
    p_result_status,
    now(),
    now()
  );

  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT r.reported_result_status)::integer,
    MIN(r.reported_result_status)
  INTO
    v_report_count,
    v_distinct_status_count,
    v_resolved_status
  FROM public.challenge_result_reports r
  WHERE r.team_match_id = v_match.id;

  IF v_report_count >= 2 AND v_distinct_status_count = 1 THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = v_resolved_status,
      result_confirmed = true,
      result_conflict = false,
      result_conflict_at = NULL,
      result_reported_by_team_id = NULL,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSIF v_report_count >= 2 THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = NULL,
      result_confirmed = false,
      result_conflict = true,
      result_conflict_at = now(),
      result_reported_by_team_id = NULL,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;

    -- Conflict just appeared: tell the challenge creator they must resolve it.
    IF v_challenge.created_by_user_id IS NOT NULL THEN
      SELECT name INTO v_team_a_name FROM public.teams WHERE id = v_match.team_a_id;
      SELECT name INTO v_team_b_name FROM public.teams WHERE id = v_match.team_b_id;
      v_team_a_name := COALESCE(v_team_a_name, 'Equipo A');
      v_team_b_name := COALESCE(v_team_b_name, 'Equipo B');

      IF NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = v_challenge.created_by_user_id
          AND n.type = 'challenge_result_conflict'
          AND COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId') = v_match.id::text
          AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
      ) THEN
        WITH new_conflict_notification AS (
          INSERT INTO public.notifications (
            user_id,
            partido_id,
            type,
            title,
            message,
            data,
            status,
            read,
            send_at,
            created_at
          ) VALUES (
            v_challenge.created_by_user_id,
            v_match.partido_id,
            'challenge_result_conflict',
            'Resultado en conflicto',
            'Los capitanes cargaron resultados distintos. Resolvé el resultado.',
            jsonb_build_object(
              'source', 'team_challenge',
              'source_detail', 'rpc_report_challenge_result',
              'action', 'open_challenge_resolve_modal',
              'team_match_id', v_match.id,
              'teamMatchId', v_match.id,
              'challenge_id', v_challenge.id,
              'challengeId', v_challenge.id,
              'partido_id', v_match.partido_id,
              'partidoId', v_match.partido_id,
              'challenger_team_id', v_challenge.challenger_team_id,
              'accepted_team_id', v_challenge.accepted_team_id,
              'team_a_id', v_match.team_a_id,
              'team_b_id', v_match.team_b_id,
              'team_a_name', v_team_a_name,
              'team_b_name', v_team_b_name,
              'target_path', '/desafios/equipos/partidos/' || v_match.id::text || '?action=open_challenge_resolve_modal',
              'route', '/desafios/equipos/partidos/' || v_match.id::text || '?action=open_challenge_resolve_modal',
              'link', '/desafios/equipos/partidos/' || v_match.id::text || '?action=open_challenge_resolve_modal'
            ),
            'sent',
            false,
            now(),
            now()
          )
          RETURNING id, user_id, partido_id, data
        )
        INSERT INTO public.notification_delivery_log (
          partido_id,
          user_id,
          notification_type,
          payload_json,
          channel,
          status
        )
        SELECT
          n.partido_id,
          n.user_id,
          'challenge_result_conflict',
          n.data || jsonb_build_object(
            'event_channel', 'ACTION',
            'notification_id', n.id,
            'source_notification_type', 'challenge_result_conflict',
            'notification_type', 'challenge_result_conflict',
            'title', 'Resultado en conflicto',
            'message', 'Los capitanes cargaron resultados distintos. Resolvé el resultado.',
            'source', 'rpc_report_challenge_result'
          ),
          'push',
          'queued'
        FROM new_conflict_notification n;
      END IF;
    END IF;
  ELSE
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = p_result_status,
      result_confirmed = false,
      result_conflict = false,
      result_conflict_at = NULL,
      result_reported_by_team_id = v_reporter_team_id,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  END IF;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_report_challenge_result(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Resolve RPC: only the challenge creator can break the tie. Confirms the
-- chosen result so that statistics finally count it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_resolve_challenge_result(
  p_challenge_id uuid,
  p_result_status text
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_result_status IS NULL OR p_result_status NOT IN ('team_a_win', 'team_b_win', 'draw') THEN
    RAISE EXCEPTION 'Resultado invalido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.created_by_user_id IS NULL
     OR v_challenge.created_by_user_id <> v_uid THEN
    RAISE EXCEPTION 'Solo el creador del desafio puede resolver el conflicto';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido del desafio no encontrado';
  END IF;

  IF NOT COALESCE(v_match.result_conflict, false) THEN
    RAISE EXCEPTION 'No hay un conflicto para resolver';
  END IF;

  UPDATE public.team_matches tm
  SET
    status = 'played',
    played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
    result_status = p_result_status,
    result_confirmed = true,
    result_conflict = false,
    result_conflict_at = NULL,
    result_reported_by_team_id = NULL,
    result_resolved_by_user_id = v_uid,
    result_resolved_at = now(),
    result_reported_at = COALESCE(tm.result_reported_at, now()),
    result_updated_at = now(),
    updated_at = now()
  WHERE tm.id = v_match.id
  RETURNING * INTO v_match;

  -- The result is final now: close any pending report/conflict prompts.
  UPDATE public.notifications n
  SET
    read = true,
    status = 'resolved'
  WHERE n.type IN ('challenge_result_survey', 'challenge_result_pending', 'challenge_result_conflict')
    AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
    AND COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId') = v_match.id::text;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_resolve_challenge_result(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Safety net: resolve any orphaned conflict prompts whose match is no longer in
-- conflict (e.g. resolved on another device before this migration ran).
-- ----------------------------------------------------------------------------
UPDATE public.notifications n
SET
  read = true,
  status = 'resolved'
FROM public.team_matches tm
WHERE n.type = 'challenge_result_conflict'
  AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
  AND tm.id::text = COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId')
  AND (COALESCE(tm.result_confirmed, false) = true OR COALESCE(tm.result_conflict, false) = false);

COMMIT;
