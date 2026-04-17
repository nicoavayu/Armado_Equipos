BEGIN;

CREATE OR REPLACE FUNCTION public.notification_event_channel(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(p_type, '')));
BEGIN
  CASE v_type
    WHEN 'match_invite' THEN RETURN 'INVITATION';
    WHEN 'match_cancelled' THEN RETURN 'CANCELLATION';
    WHEN 'match_deleted' THEN RETURN 'CANCELLATION';
    WHEN 'match_kicked' THEN RETURN 'CANCELLATION';
    WHEN 'survey_start' THEN RETURN 'SURVEY';
    WHEN 'post_match_survey' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder_12h' THEN RETURN 'SURVEY';
    WHEN 'match_join_approved' THEN RETURN 'ACCEPTED';
    WHEN 'match_join_request' THEN RETURN 'JOIN_REQUEST';
    WHEN 'call_to_vote' THEN RETURN 'VOTE_REQUEST';
    WHEN 'match_reminder_1h' THEN RETURN 'REMINDER';
    WHEN 'award_won' THEN RETURN 'REMINDER';
    WHEN 'no_show_penalty_applied' THEN RETURN 'REMINDER';
    WHEN 'no_show_recovery_applied' THEN RETURN 'REMINDER';
    WHEN 'awards_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_results_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_finished' THEN RETURN 'ACTIVITY';
    WHEN 'friend_request' THEN RETURN 'INVITATION';
    WHEN 'friend_accepted' THEN RETURN 'INFO';
    WHEN 'friend_rejected' THEN RETURN 'INFO';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_survey_notification_match_name(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(trim(COALESCE(p_nombre, '')), '') IS NULL THEN 'este partido'
    WHEN trim(COALESCE(p_nombre, '')) ~ '^[0-9]+$' THEN 'este partido'
    ELSE trim(COALESCE(p_nombre, ''))
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
        public.resolve_survey_notification_match_name(p.nombre) AS match_display_name,
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
      c.match_display_name,
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
        'La encuesta ya está lista para completar sobre el partido ' || v_match.match_display_name || '.',
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.match_display_name,
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
  p_window_minutes integer DEFAULT 1,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 60), 0));
  v_window interval := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 1), 1));
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
        public.resolve_survey_notification_match_name(p.nombre) AS match_display_name,
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
        c.match_display_name,
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
        n.match_display_name,
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
        n.match_display_name,
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
      r.match_display_name,
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
      AND r.reminder_at_local <= v_now_local
      AND r.reminder_at_local > v_now_local - v_window
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
            'Recordatorio: te quedan 12 horas para completar la encuesta del partido ' || v_match.match_display_name || '.'
          ELSE
            'Recordatorio: te queda 1 hora para completar la encuesta del partido ' || v_match.match_display_name || '.'
        END,
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.match_display_name,
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
    'window_minutes', GREATEST(COALESCE(p_window_minutes, 1), 1),
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO service_role;
  END IF;
END
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'Skipping survey reminder cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$
      SELECT jobid
      FROM cron.job
      WHERE jobname IN ('survey_reminder_backend_scheduler')
    $sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'survey_reminder_backend_scheduler',
      '* * * * *',
      'SELECT public.process_survey_reminder_notifications_backend(60, 1, 200);'
    )
  $sql$;
END
$$;

COMMIT;
