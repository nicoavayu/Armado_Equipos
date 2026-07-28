BEGIN;

-- ============================================================================
-- MIGRATION: Push sender automatic scheduler (pg_cron + pg_net)
-- Date: 2026-03-12
-- Purpose:
--   1) Execute push-sender Edge Function automatically every minute.
--   2) Avoid execution overlap / request storms.
--   3) Expose minimal operational observability for push queue consumption.
--
-- Required Vault secrets (set outside migrations):
--   - push_sender_function_url           (e.g. https://<project-ref>.supabase.co/functions/v1/push-sender)
--   - push_sender_service_role_jwt       (service_role JWT key)
--   - push_sender_internal_secret        (same value as PUSH_SENDER_SECRET in Edge Function env)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Scheduler state + run log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_sender_scheduler_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_dispatch_requested_at timestamptz,
  last_request_id bigint,
  last_status text NOT NULL DEFAULT 'never',
  last_reason text,
  inflight_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.push_sender_scheduler_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.push_sender_scheduler_runs (
  id bigserial PRIMARY KEY,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  trigger_source text NOT NULL DEFAULT 'cron',
  status text NOT NULL,
  reason text,
  request_id bigint,
  queue_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (status IN ('invoked', 'skipped_no_work', 'skipped_overlap', 'misconfigured', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_push_sender_scheduler_runs_triggered_at
  ON public.push_sender_scheduler_runs(triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_sender_scheduler_runs_status
  ON public.push_sender_scheduler_runs(status, triggered_at DESC);

REVOKE ALL ON TABLE public.push_sender_scheduler_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_sender_scheduler_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_sender_scheduler_state TO service_role;
GRANT ALL ON TABLE public.push_sender_scheduler_runs TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Tick function that dispatches push-sender with anti-overlap guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_push_sender_scheduler_tick(
  p_trigger_source text DEFAULT 'cron',
  p_batch_limit integer DEFAULT 120,
  p_inflight_ttl_seconds integer DEFAULT 90,
  p_processing_fresh_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_trigger_source text := COALESCE(NULLIF(trim(COALESCE(p_trigger_source, '')), ''), 'cron');
  v_batch_limit integer := GREATEST(COALESCE(p_batch_limit, 120), 1);
  v_inflight_ttl_seconds integer := GREATEST(COALESCE(p_inflight_ttl_seconds, 90), 30);
  v_processing_fresh interval := make_interval(secs => GREATEST(COALESCE(p_processing_fresh_seconds, 120), 30));

  v_queued_count integer := 0;
  v_processing_count integer := 0;
  v_retryable_failed_count integer := 0;
  v_ready_to_process_count integer := 0;
  v_fresh_processing_count integer := 0;
  v_stuck_processing_count integer := 0;

  v_function_url text;
  v_service_role_jwt text;
  v_sender_secret text;
  v_request_id bigint;

  v_status text := 'error';
  v_reason text;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'misconfigured', 'reason', 'notification_delivery_log_missing');
  END IF;

  INSERT INTO public.push_sender_scheduler_state (id)
  VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  PERFORM 1
  FROM public.push_sender_scheduler_state
  WHERE id = 1
  FOR UPDATE;

  SELECT
    count(*) FILTER (WHERE channel = 'push' AND status = 'queued')::integer,
    count(*) FILTER (WHERE channel = 'push' AND status = 'processing')::integer,
    count(*) FILTER (WHERE channel = 'push' AND status = 'retryable_failed')::integer,
    count(*) FILTER (
      WHERE channel = 'push'
        AND status IN ('queued', 'retryable_failed')
        AND COALESCE(next_retry_at, created_at) <= v_now
    )::integer,
    count(*) FILTER (
      WHERE channel = 'push'
        AND status = 'processing'
        AND COALESCE(processing_started_at, created_at) > (v_now - v_processing_fresh)
    )::integer,
    count(*) FILTER (
      WHERE channel = 'push'
        AND status = 'processing'
        AND COALESCE(processing_started_at, created_at) <= (v_now - interval '20 minutes')
    )::integer
  INTO
    v_queued_count,
    v_processing_count,
    v_retryable_failed_count,
    v_ready_to_process_count,
    v_fresh_processing_count,
    v_stuck_processing_count
  FROM public.notification_delivery_log;

  IF EXISTS (
    SELECT 1
    FROM public.push_sender_scheduler_state s
    WHERE s.id = 1
      AND s.inflight_until IS NOT NULL
      AND s.inflight_until > v_now
  ) THEN
    v_status := 'skipped_overlap';
    v_reason := 'scheduler_inflight_window_open';
  ELSIF v_fresh_processing_count > 0 THEN
    v_status := 'skipped_overlap';
    v_reason := 'fresh_processing_rows_detected';
  ELSIF v_ready_to_process_count = 0 THEN
    v_status := 'skipped_no_work';
    v_reason := 'no_ready_push_rows';
  END IF;

  IF v_status IN ('skipped_overlap', 'skipped_no_work') THEN
    UPDATE public.push_sender_scheduler_state
    SET
      last_status = v_status,
      last_reason = v_reason,
      updated_at = v_now,
      inflight_until = NULL
    WHERE id = 1;

    INSERT INTO public.push_sender_scheduler_runs (
      triggered_at,
      trigger_source,
      status,
      reason,
      request_id,
      queue_snapshot
    ) VALUES (
      v_now,
      v_trigger_source,
      v_status,
      v_reason,
      NULL,
      jsonb_build_object(
        'queued', v_queued_count,
        'processing', v_processing_count,
        'retryable_failed', v_retryable_failed_count,
        'ready_to_process', v_ready_to_process_count,
        'stuck_processing', v_stuck_processing_count
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', v_status,
      'reason', v_reason,
      'queued', v_queued_count,
      'processing', v_processing_count,
      'retryable_failed', v_retryable_failed_count,
      'ready_to_process', v_ready_to_process_count,
      'stuck_processing', v_stuck_processing_count
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    v_status := 'misconfigured';
    v_reason := 'pg_net_extension_missing';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vault') THEN
    v_status := 'misconfigured';
    v_reason := 'vault_extension_missing';
  ELSE
    SELECT decrypted_secret INTO v_function_url
    FROM vault.decrypted_secrets
    WHERE name = 'push_sender_function_url'
    LIMIT 1;

    SELECT decrypted_secret INTO v_service_role_jwt
    FROM vault.decrypted_secrets
    WHERE name = 'push_sender_service_role_jwt'
    LIMIT 1;

    SELECT decrypted_secret INTO v_sender_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_sender_internal_secret'
    LIMIT 1;

    IF NULLIF(trim(COALESCE(v_function_url, '')), '') IS NULL
      OR NULLIF(trim(COALESCE(v_service_role_jwt, '')), '') IS NULL
      OR NULLIF(trim(COALESCE(v_sender_secret, '')), '') IS NULL
    THEN
      v_status := 'misconfigured';
      v_reason := 'missing_vault_secrets';
    END IF;
  END IF;

  IF v_status = 'misconfigured' THEN
    UPDATE public.push_sender_scheduler_state
    SET
      last_status = v_status,
      last_reason = v_reason,
      updated_at = v_now,
      inflight_until = NULL
    WHERE id = 1;

    INSERT INTO public.push_sender_scheduler_runs (
      triggered_at,
      trigger_source,
      status,
      reason,
      request_id,
      queue_snapshot
    ) VALUES (
      v_now,
      v_trigger_source,
      v_status,
      v_reason,
      NULL,
      jsonb_build_object(
        'queued', v_queued_count,
        'processing', v_processing_count,
        'retryable_failed', v_retryable_failed_count,
        'ready_to_process', v_ready_to_process_count,
        'stuck_processing', v_stuck_processing_count
      )
    );

    RETURN jsonb_build_object(
      'success', false,
      'status', v_status,
      'reason', v_reason,
      'queued', v_queued_count,
      'processing', v_processing_count,
      'retryable_failed', v_retryable_failed_count,
      'ready_to_process', v_ready_to_process_count,
      'stuck_processing', v_stuck_processing_count
    );
  END IF;

  SELECT net.http_post(
    url := trim(v_function_url),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim(v_service_role_jwt),
      'apikey', trim(v_service_role_jwt),
      'x-push-sender-secret', trim(v_sender_secret)
    ),
    body := jsonb_build_object(
      'worker_id', 'cron_push_sender',
      'limit', v_batch_limit
    )
  ) INTO v_request_id;

  v_status := 'invoked';
  v_reason := 'http_dispatched';

  UPDATE public.push_sender_scheduler_state
  SET
    last_dispatch_requested_at = v_now,
    last_request_id = v_request_id,
    last_status = v_status,
    last_reason = v_reason,
    inflight_until = v_now + make_interval(secs => v_inflight_ttl_seconds),
    updated_at = v_now
  WHERE id = 1;

  INSERT INTO public.push_sender_scheduler_runs (
    triggered_at,
    trigger_source,
    status,
    reason,
    request_id,
    queue_snapshot
  ) VALUES (
    v_now,
    v_trigger_source,
    v_status,
    v_reason,
    v_request_id,
    jsonb_build_object(
      'queued', v_queued_count,
      'processing', v_processing_count,
      'retryable_failed', v_retryable_failed_count,
      'ready_to_process', v_ready_to_process_count,
      'stuck_processing', v_stuck_processing_count,
      'batch_limit', v_batch_limit
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'request_id', v_request_id,
    'queued', v_queued_count,
    'processing', v_processing_count,
    'retryable_failed', v_retryable_failed_count,
    'ready_to_process', v_ready_to_process_count,
    'stuck_processing', v_stuck_processing_count,
    'batch_limit', v_batch_limit
  );
EXCEPTION
  WHEN OTHERS THEN
    v_status := 'error';
    v_reason := 'scheduler_tick_failed';

    UPDATE public.push_sender_scheduler_state
    SET
      last_status = v_status,
      last_reason = v_reason,
      updated_at = now(),
      inflight_until = NULL
    WHERE id = 1;

    INSERT INTO public.push_sender_scheduler_runs (
      triggered_at,
      trigger_source,
      status,
      reason,
      request_id,
      queue_snapshot
    ) VALUES (
      now(),
      v_trigger_source,
      v_status,
      v_reason,
      NULL,
      jsonb_build_object(
        'queued', COALESCE(v_queued_count, 0),
        'processing', COALESCE(v_processing_count, 0),
        'retryable_failed', COALESCE(v_retryable_failed_count, 0),
        'ready_to_process', COALESCE(v_ready_to_process_count, 0),
        'stuck_processing', COALESCE(v_stuck_processing_count, 0)
      )
    );

    RETURN jsonb_build_object('success', false, 'status', v_status, 'reason', v_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.run_push_sender_scheduler_tick(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_push_sender_scheduler_tick(text, integer, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Observability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.push_queue_processing_health
WITH (security_invoker = on)
AS
SELECT
  count(*) FILTER (WHERE channel = 'push' AND status = 'processing') AS processing_count,
  count(*) FILTER (
    WHERE channel = 'push'
      AND status = 'processing'
      AND COALESCE(processing_started_at, created_at) <= now() - interval '20 minutes'
  ) AS stuck_processing_count,
  min(COALESCE(processing_started_at, created_at)) FILTER (WHERE channel = 'push' AND status = 'processing')
    AS oldest_processing_started_at
FROM public.notification_delivery_log;

CREATE OR REPLACE VIEW public.push_sender_scheduler_health
WITH (security_invoker = on)
AS
SELECT
  s.last_dispatch_requested_at,
  s.last_request_id,
  s.last_status,
  s.last_reason,
  s.inflight_until,
  (s.inflight_until IS NOT NULL AND s.inflight_until > now()) AS scheduler_inflight,
  q.queued_count,
  q.processing_count,
  q.retryable_failed_count,
  q.sent_count,
  q.failed_count,
  q.ready_to_process_count,
  h.stuck_processing_count,
  h.oldest_processing_started_at
FROM public.push_sender_scheduler_state s
LEFT JOIN public.push_queue_status_summary q ON true
LEFT JOIN public.push_queue_processing_health h ON true
WHERE s.id = 1;

GRANT SELECT ON public.push_queue_processing_health TO service_role;
GRANT SELECT ON public.push_sender_scheduler_health TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Enable extensions when available + register cron job (every minute)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_net not available or cannot be enabled automatically: %', SQLERRM;
  END;

  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vault';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'vault not available or cannot be enabled automatically: %', SQLERRM;
  END;

  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available or cannot be enabled automatically: %', SQLERRM;
  END;
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
    RAISE NOTICE 'Skipping push sender cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$SELECT jobid FROM cron.job WHERE jobname IN ('push_sender_dispatch_scheduler', 'push_sender_scheduler')$sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'push_sender_dispatch_scheduler',
      '* * * * *',
      'SELECT public.run_push_sender_scheduler_tick();'
    )
  $sql$;
END
$$;

COMMIT;
