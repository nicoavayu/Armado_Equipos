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

DO $$
DECLARE
  v_fn text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_remote_push_from_notification()'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'enqueue_remote_push_from_notification() not found';
  END IF;

  v_fn := replace(
    v_fn,
    E'  IF v_partido_id IS NOT NULL\n     AND COALESCE(v_is_active, false)\n     AND v_last_seen_partido_id = v_partido_id\n  THEN',
    E'  IF v_partido_id IS NOT NULL\n     AND COALESCE(v_is_active, false)\n     AND v_last_seen_partido_id = v_partido_id\n     AND v_channel NOT IN (''VOTE_REQUEST'', ''CANCELLATION'')\n  THEN'
  );

  EXECUTE v_fn;
END $$;

CREATE OR REPLACE FUNCTION public.claim_targeted_push_delivery_batch(
  p_log_ids uuid[],
  p_limit integer DEFAULT 100,
  p_worker_id text DEFAULT 'push-sender',
  p_max_attempts integer DEFAULT 5,
  p_processing_timeout_minutes integer DEFAULT 20
)
RETURNS SETOF public.notification_delivery_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := GREATEST(COALESCE(p_limit, 100), 1);
  v_max_attempts int := GREATEST(COALESCE(p_max_attempts, 5), 1);
  v_processing_timeout interval := make_interval(mins => GREATEST(COALESCE(p_processing_timeout_minutes, 20), 1));
  v_worker text := COALESCE(NULLIF(trim(COALESCE(p_worker_id, '')), ''), 'push-sender');
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(array_length(p_log_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH requested_ids AS (
    SELECT DISTINCT unnest(p_log_ids) AS id
  ),
  candidates AS (
    SELECT l.id
    FROM public.notification_delivery_log l
    INNER JOIN requested_ids r
      ON r.id = l.id
    WHERE l.channel = 'push'
      AND l.attempt_count < v_max_attempts
      AND (
        (
          l.status IN ('queued', 'retryable_failed')
          AND COALESCE(l.next_retry_at, l.created_at) <= now()
        )
        OR (
          l.status = 'processing'
          AND COALESCE(l.processing_started_at, l.created_at) <= now() - v_processing_timeout
        )
      )
    ORDER BY l.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notification_delivery_log l
    SET
      status = 'processing',
      processing_started_at = now(),
      processing_by = v_worker,
      last_attempt_at = now(),
      attempt_count = l.attempt_count + 1,
      error_code = NULL,
      error_text = NULL
    FROM candidates c
    WHERE l.id = c.id
    RETURNING l.*
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_targeted_push_delivery_batch(uuid[], integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_targeted_push_delivery_batch(uuid[], integer, text, integer, integer) TO service_role;

COMMIT;
