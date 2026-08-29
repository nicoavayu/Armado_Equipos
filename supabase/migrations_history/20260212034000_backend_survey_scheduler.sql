-- ============================================================================
-- MIGRATION: Backend Survey Start Scheduler (cron)
-- Date: 2026-02-12
-- Purpose:
--   1) Move survey-start fanout to backend (no client polling)
--   2) Schedule periodic execution using pg_cron when available
-- ============================================================================

BEGIN;

-- Legacy guard used by older notification flows
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS surveys_sent boolean NOT NULL DEFAULT false;

-- Keep flag aligned for already-notified matches.
UPDATE public.partidos p
SET surveys_sent = true
WHERE COALESCE(p.surveys_sent, false) = false
  AND EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.partido_id = p.id
      AND n.type IN ('survey_start', 'post_match_survey')
  );

CREATE OR REPLACE FUNCTION public.process_survey_start_notifications_backend(
  p_delay_minutes integer DEFAULT 1,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 1), 0));
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
    SELECT c.id, c.nombre, c.starts_at_local
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

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        'survey_start',
        '¡Encuesta lista!',
        'La encuesta ya está lista para completar sobre el partido ' || COALESCE(NULLIF(v_match.nombre, ''), v_match.id::text) || '.',
        jsonb_build_object(
          'match_id', v_match.id,
          'link', '/encuesta/' || v_match.id,
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
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO service_role;
  END IF;
END;
$$;

-- Try enabling pg_cron when available. If environment does not allow it, continue without failing migration.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available or cannot be enabled automatically: %', SQLERRM;
  END;
END;
$$;

-- Register backend job (every minute) if pg_cron is enabled.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'Skipping cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$SELECT jobid FROM cron.job WHERE jobname IN ('survey_start_backend_scheduler', 'survey_fanout')$sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'survey_start_backend_scheduler',
      '* * * * *',
      'SELECT public.process_survey_start_notifications_backend();'
    )
  $sql$;
END;
$$;

COMMIT;
