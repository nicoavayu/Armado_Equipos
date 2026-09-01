-- Prevent late/obsolete survey reminder notifications once survey flow is already closed.
-- This keeps reminder generation aligned with the real survey lifecycle state.

BEGIN;

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

GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO service_role;
  END IF;
END;
$$;

COMMIT;
