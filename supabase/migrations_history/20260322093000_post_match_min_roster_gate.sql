BEGIN;

-- Canonical post-match gate:
-- A match only qualifies for post-match actions if its final roster reaches
-- the minimum required players for its format/capacity.
--
-- The roster must match the exact starter capacity required by the match
-- format. Any incomplete roster is assumed as not played.

CREATE OR REPLACE FUNCTION public.resolve_partido_starter_slots(
  p_modalidad text,
  p_cupo_jugadores integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_explicit_capacity integer := GREATEST(COALESCE(p_cupo_jugadores, 0), 0);
  v_token text := upper(regexp_replace(COALESCE(p_modalidad, ''), '\s+', '', 'g'));
  v_match text[];
  v_players_per_team integer;
BEGIN
  IF v_explicit_capacity > 0 THEN
    RETURN v_explicit_capacity;
  END IF;

  v_match := regexp_match(v_token, '^F([0-9]+)$');
  IF v_match IS NOT NULL THEN
    v_players_per_team := COALESCE(v_match[1], '0')::integer;
    IF v_players_per_team > 0 THEN
      RETURN GREATEST(2, v_players_per_team * 2);
    END IF;
  END IF;

  CASE v_token
    WHEN 'F5' THEN RETURN 10;
    WHEN 'F6' THEN RETURN 12;
    WHEN 'F7' THEN RETURN 14;
    WHEN 'F8' THEN RETURN 16;
    WHEN 'F9' THEN RETURN 18;
    WHEN 'F11' THEN RETURN 22;
    ELSE RETURN 10;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_post_match_required_players(
  p_starter_slots integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(COALESCE(p_starter_slots, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_match_post_match_gate(
  p_partido_id bigint
)
RETURNS TABLE (
  qualifies boolean,
  reason text,
  modalidad text,
  cupo_jugadores integer,
  starter_slots integer,
  required_players integer,
  roster_count integer,
  registered_roster_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modalidad text;
  v_cupo integer;
  v_starter_slots integer;
  v_required_players integer;
  v_roster_count integer := 0;
  v_registered_roster_count integer := 0;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN QUERY
    SELECT
      false,
      'invalid_match_id'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  SELECT p.modalidad, p.cupo_jugadores
  INTO v_modalidad, v_cupo
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false,
      'match_not_found'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  v_starter_slots := public.resolve_partido_starter_slots(v_modalidad, v_cupo);
  v_required_players := public.resolve_post_match_required_players(v_starter_slots);

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE j.usuario_id IS NOT NULL)::integer
  INTO v_roster_count, v_registered_roster_count
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id;

  RETURN QUERY
  SELECT
    v_roster_count = v_required_players,
    CASE
      WHEN v_roster_count = v_required_players THEN 'ok'
      ELSE 'incomplete_roster_for_match_type'
    END::text,
    v_modalidad,
    v_cupo,
    v_starter_slots,
    v_required_players,
    v_roster_count,
    v_registered_roster_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_match_assumed_not_played(
  p_partido_id bigint,
  p_reason text DEFAULT 'match_assumed_not_played'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'match_assumed_not_played');
  v_deleted_notifications integer := 0;
  v_row record;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_match_id');
  END IF;

  UPDATE public.partidos p
  SET
    estado = 'cancelado',
    survey_status = 'closed',
    survey_opened_at = NULL,
    survey_closes_at = NULL,
    survey_expected_voters = 0,
    surveys_sent = true,
    result_status = 'not_played',
    winner_team = NULL,
    finished_at = COALESCE(p.finished_at, now())
  WHERE p.id = p_partido_id
  RETURNING
    p.id,
    p.estado,
    p.survey_status,
    p.result_status,
    p.finished_at
  INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  DELETE FROM public.notifications n
  WHERE n.partido_id = p_partido_id
    AND n.type IN (
      'call_to_vote',
      'survey_start',
      'post_match_survey',
      'survey_reminder',
      'survey_reminder_12h',
      'survey_results_ready',
      'awards_ready',
      'survey_finished'
    );
  GET DIAGNOSTICS v_deleted_notifications = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'reason', v_reason,
    'match_id', p_partido_id,
    'deleted_notifications', v_deleted_notifications,
    'survey_status', v_row.survey_status,
    'result_status', v_row.result_status,
    'estado', v_row.estado,
    'finished_at', v_row.finished_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_partido_starter_slots(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_post_match_required_players(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_post_match_gate(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_match_assumed_not_played(bigint, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_partido_starter_slots(text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.resolve_post_match_required_players(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_match_post_match_gate(bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mark_match_assumed_not_played(bigint, text) TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
  v_gate record;
BEGIN
  SELECT codigo
  INTO v_match_code
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  SELECT *
  INTO v_gate
  FROM public.get_match_post_match_gate(p_partido_id);

  IF COALESCE(v_gate.qualifies, false) = false THEN
    PERFORM public.mark_match_assumed_not_played(
      p_partido_id,
      COALESCE(v_gate.reason, 'match_assumed_not_played')
    );

    RETURN jsonb_build_object(
      'success', false,
      'reason', COALESCE(v_gate.reason, 'incomplete_roster_for_match_type'),
      'match_assumed_not_played', true,
      'modalidad', v_gate.modalidad,
      'cupo_jugadores', v_gate.cupo_jugadores,
      'starter_slots', v_gate.starter_slots,
      'required_players', v_gate.required_players,
      'roster_count', v_gate.roster_count,
      'registered_roster_count', v_gate.registered_roster_count
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE (
      (data ->> 'match_id')::text = p_partido_id::text
      OR (data ->> 'matchId')::text = p_partido_id::text
    )
    AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
  END IF;

  WITH recipients AS (
    SELECT DISTINCT j.usuario_id AS user_id
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  upserted AS (
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
      p_title,
      p_message,
      'call_to_vote',
      p_partido_id,
      jsonb_build_object(
        'match_id', p_partido_id::text,
        'matchId', p_partido_id,
        'matchCode', v_match_code
      ),
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = false,
      send_at = now()
    RETURNING id
  )
  SELECT count(*) INTO v_rows_affected FROM upserted;

  RETURN jsonb_build_object('success', true, 'inserted', v_rows_affected);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_survey_start_notifications_backend(
  p_delay_minutes integer DEFAULT 60,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 60), 0));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;
  v_match record;
  v_result jsonb;
  v_gate record;
  v_scanned int := 0;
  v_notified int := 0;
  v_skipped int := 0;
  v_errors int := 0;
BEGIN
  FOR v_match IN
    WITH candidates AS (
      SELECT
        p.id,
        p.nombre,
        p.fecha,
        p.hora,
        CASE
          WHEN replace(trim(p.hora), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
            p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
          ELSE NULL::timestamp
        END AS starts_at_local
      FROM public.partidos p
      WHERE p.fecha IS NOT NULL
        AND p.hora IS NOT NULL
        AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo', 'finalizado', 'finished')
        AND COALESCE(p.surveys_sent, false) = false
    )
    SELECT
      c.id,
      c.nombre,
      c.fecha,
      c.hora,
      c.starts_at_local,
      c.starts_at_local + v_delay AS survey_start_local,
      c.starts_at_local + v_delay + interval '24 hours' AS survey_deadline_local
    FROM candidates c
    WHERE c.starts_at_local IS NOT NULL
      AND c.starts_at_local + v_delay <= v_now_local
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.partido_id = c.id
          AND n.type IN ('survey_start', 'post_match_survey')
      )
    ORDER BY c.starts_at_local ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    v_scanned := v_scanned + 1;

    SELECT *
    INTO v_gate
    FROM public.get_match_post_match_gate(v_match.id);

    IF COALESCE(v_gate.qualifies, false) = false THEN
      PERFORM public.mark_match_assumed_not_played(
        v_match.id,
        COALESCE(v_gate.reason, 'match_assumed_not_played')
      );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        'survey_start',
        '¡Encuesta lista!',
        'La encuesta ya está lista para completar sobre el partido ' || COALESCE(NULLIF(v_match.nombre, ''), v_match.id::text) || '.',
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.nombre,
          'match_date', v_match.fecha,
          'match_time', v_match.hora,
          'link', '/encuesta/' || v_match.id,
          'survey_opened_at', (v_match.survey_start_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'survey_deadline_at', (v_match.survey_deadline_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'source', 'backend_scheduler'
        )
      );

      UPDATE public.partidos
      SET surveys_sent = true
      WHERE id = v_match.id;

      IF COALESCE((v_result ->> 'recipients_count')::int, 0) > 0 THEN
        v_notified := v_notified + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'now_local', v_now_local,
    'delay_minutes', GREATEST(COALESCE(p_delay_minutes, 60), 0),
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_survey_reminder_notifications_backend(
  p_delay_minutes integer DEFAULT 60,
  p_window_minutes integer DEFAULT 5,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 60), 0));
  v_window interval := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 5), 1));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;
  v_match record;
  v_result jsonb;
  v_gate record;
  v_scanned int := 0;
  v_notified int := 0;
  v_skipped int := 0;
  v_errors int := 0;
BEGIN
  FOR v_match IN
    WITH candidates AS (
      SELECT
        p.id,
        p.nombre,
        p.fecha,
        p.hora,
        p.survey_status,
        p.result_status,
        p.survey_closes_at,
        CASE
          WHEN replace(trim(p.hora), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
            p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
          ELSE NULL::timestamp
        END AS starts_at_local
      FROM public.partidos p
      WHERE p.fecha IS NOT NULL
        AND p.hora IS NOT NULL
        AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo', 'finalizado', 'finished')
    ),
    normalized AS (
      SELECT
        c.id,
        c.nombre,
        c.fecha,
        c.hora,
        c.survey_status,
        c.result_status,
        c.survey_closes_at,
        c.starts_at_local + v_delay AS survey_start_local
      FROM candidates c
      WHERE c.starts_at_local IS NOT NULL
    ),
    reminder_candidates AS (
      SELECT
        n.id,
        n.nombre,
        n.fecha,
        n.hora,
        n.survey_status,
        n.result_status,
        n.survey_closes_at,
        n.survey_start_local,
        n.survey_start_local + interval '24 hours' AS survey_deadline_local,
        n.survey_start_local + interval '12 hours' AS reminder_at_local,
        'survey_reminder_12h'::text AS reminder_notification_type,
        '12h_before_deadline'::text AS reminder_payload_type
      FROM normalized n
      UNION ALL
      SELECT
        n.id,
        n.nombre,
        n.fecha,
        n.hora,
        n.survey_status,
        n.result_status,
        n.survey_closes_at,
        n.survey_start_local,
        n.survey_start_local + interval '24 hours' AS survey_deadline_local,
        n.survey_start_local + interval '23 hours' AS reminder_at_local,
        'survey_reminder'::text AS reminder_notification_type,
        '1h_before_deadline'::text AS reminder_payload_type
      FROM normalized n
    )
    SELECT
      r.id,
      r.nombre,
      r.fecha,
      r.hora,
      r.survey_start_local,
      r.survey_deadline_local,
      r.reminder_at_local,
      r.reminder_notification_type,
      r.reminder_payload_type
    FROM reminder_candidates r
    WHERE r.survey_start_local <= v_now_local
      AND r.survey_deadline_local > v_now_local
      AND r.reminder_at_local <= v_now_local + v_window
      AND COALESCE(lower(r.survey_status), 'open') IN ('open', 'abierta')
      AND COALESCE(lower(r.result_status), 'pending') IN ('pending', 'pendiente')
      AND (r.survey_closes_at IS NULL OR r.survey_closes_at > now())
      AND EXISTS (
        SELECT 1
        FROM public.notifications x
        WHERE x.partido_id = r.id
          AND x.type IN ('survey_start', 'post_match_survey')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications y
        WHERE y.partido_id = r.id
          AND y.type = r.reminder_notification_type
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications z
        WHERE z.partido_id = r.id
          AND z.type = 'survey_finished'
      )
    ORDER BY r.survey_start_local ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    v_scanned := v_scanned + 1;

    SELECT *
    INTO v_gate
    FROM public.get_match_post_match_gate(v_match.id);

    IF COALESCE(v_gate.qualifies, false) = false THEN
      PERFORM public.mark_match_assumed_not_played(
        v_match.id,
        COALESCE(v_gate.reason, 'match_assumed_not_played')
      );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        v_match.reminder_notification_type,
        'Recordatorio de encuesta',
        CASE
          WHEN v_match.reminder_payload_type = '12h_before_deadline' THEN
            'Recordatorio: te quedan 12 horas para completar la encuesta del partido ' || COALESCE(NULLIF(v_match.nombre, ''), v_match.id::text) || '.'
          ELSE
            'Recordatorio: te queda 1 hora para completar la encuesta del partido ' || COALESCE(NULLIF(v_match.nombre, ''), v_match.id::text) || '.'
        END,
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.nombre,
          'match_date', v_match.fecha,
          'match_time', v_match.hora,
          'link', '/encuesta/' || v_match.id,
          'reminder_type', v_match.reminder_payload_type,
          'survey_deadline_at', (v_match.survey_deadline_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'source', 'backend_scheduler'
        )
      );

      IF COALESCE((v_result ->> 'recipients_count')::int, 0) > 0 THEN
        v_notified := v_notified + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'now_local', v_now_local,
    'window_minutes', GREATEST(COALESCE(p_window_minutes, 5), 1),
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

COMMIT;
