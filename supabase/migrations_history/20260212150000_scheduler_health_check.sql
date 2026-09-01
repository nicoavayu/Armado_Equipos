-- ============================================================================
-- MIGRATION: Scheduler health check RPC
-- Date: 2026-02-12
-- Purpose:
--   Expose a read-only health snapshot for backend survey scheduler monitoring.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_survey_scheduler_health(
  p_window_minutes integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_minutes integer := GREATEST(COALESCE(p_window_minutes, 60), 1);
  v_window interval := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 60), 1));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;

  v_cron_enabled boolean := false;
  v_cron_active boolean := false;
  v_cron_schedule text := NULL;
  v_last_run_started timestamptz := NULL;
  v_last_run_status text := NULL;
  v_last_success_at timestamptz := NULL;

  v_pending_matches integer := 0;
  v_recent_notifications integer := 0;

  v_status text := 'ok';
  v_message text := 'Scheduler saludable';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  )
  INTO v_cron_enabled;

  IF v_cron_enabled THEN
    BEGIN
      SELECT COALESCE(j.active, false), j.schedule
      INTO v_cron_active, v_cron_schedule
      FROM cron.job j
      WHERE j.jobname = 'survey_start_backend_scheduler'
      ORDER BY j.jobid DESC
      LIMIT 1;

      SELECT d.start_time, d.status
      INTO v_last_run_started, v_last_run_status
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE j.jobname = 'survey_start_backend_scheduler'
      ORDER BY d.start_time DESC
      LIMIT 1;

      SELECT max(d.end_time)
      INTO v_last_success_at
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE j.jobname = 'survey_start_backend_scheduler'
        AND lower(COALESCE(d.status, '')) = 'succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        v_cron_active := false;
        v_last_run_status := COALESCE(v_last_run_status, format('cron_read_error: %s', SQLERRM));
    END;
  END IF;

  WITH candidates AS (
    SELECT
      p.id,
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
  SELECT COUNT(*)::int
  INTO v_pending_matches
  FROM candidates c
  WHERE c.starts_at_local IS NOT NULL
    AND c.starts_at_local + make_interval(mins => 1) <= v_now_local
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.partido_id = c.id
        AND n.type IN ('survey_start', 'post_match_survey')
    );

  BEGIN
    SELECT COUNT(*)::int
    INTO v_recent_notifications
    FROM public.notifications n
    WHERE n.type IN ('survey_start', 'post_match_survey')
      AND n.created_at >= now() - v_window
      AND COALESCE(n.data ->> 'source', '') = 'backend_scheduler';
  EXCEPTION
    WHEN OTHERS THEN
      v_recent_notifications := 0;
  END;

  IF NOT v_cron_enabled THEN
    v_status := 'warn';
    v_message := 'pg_cron no está habilitado';
  ELSIF NOT v_cron_active THEN
    v_status := 'warn';
    v_message := 'Job del scheduler inactivo';
  ELSIF v_last_success_at IS NULL THEN
    v_status := 'warn';
    v_message := 'No hay ejecuciones exitosas registradas';
  ELSIF v_pending_matches > 0 AND v_recent_notifications = 0 THEN
    v_status := 'warn';
    v_message := 'Hay partidos pendientes y no hubo envíos recientes';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'message', v_message,
    'window_minutes', v_window_minutes,
    'now_local', v_now_local,
    'cron_enabled', v_cron_enabled,
    'cron_active', v_cron_active,
    'cron_schedule', v_cron_schedule,
    'last_run_started', v_last_run_started,
    'last_run_status', v_last_run_status,
    'last_success_at', v_last_success_at,
    'pending_matches', v_pending_matches,
    'recent_notifications', v_recent_notifications
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_scheduler_health(integer) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_survey_scheduler_health(integer) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_survey_scheduler_health(integer)
  IS 'Read-only scheduler health snapshot for survey-start backend job.';

COMMIT;
