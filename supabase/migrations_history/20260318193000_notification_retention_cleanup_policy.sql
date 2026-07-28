BEGIN;

-- ============================================================================
-- Notifications/Data Retention Policy
-- - UI visibility remains short-lived (handled in frontend)
-- - DB retention:
--   * public.notifications -> 14 days
--   * public.notification_delivery_log -> 7 days
-- - Conservative exclusions:
--   * pending/active states are preserved
--   * unresolved friend requests / invites are preserved
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notifications_retention_created_at
  ON public.notifications (created_at);

DO $$
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_retention_created_status
      ON public.notification_delivery_log (created_at, status);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.notification_is_retention_exempt(
  p_user_id uuid,
  p_type text,
  p_read boolean,
  p_status text,
  p_data jsonb,
  p_partido_id bigint,
  p_created_at timestamptz,
  p_send_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(p_type, '')));
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_data jsonb := COALESCE(p_data, '{}'::jsonb);
  v_data_status text := lower(trim(COALESCE(v_data ->> 'status', '')));

  v_request_id_text text;
  v_request_id uuid;
  v_sender_id_text text;
  v_sender_id uuid;

  v_invitation_id_text text;
  v_invitation_id uuid;
BEGIN
  -- Future-scheduled notifications should never be purged early.
  IF p_send_at IS NOT NULL AND p_send_at > now() THEN
    RETURN true;
  END IF;

  -- Generic open/pending lifecycle markers.
  IF v_status = ANY (ARRAY[
    'pending', 'open', 'active', 'queued', 'processing', 'retryable_failed', 'in_progress'
  ]) THEN
    RETURN true;
  END IF;

  IF v_data_status = ANY (ARRAY[
    'pending', 'open', 'active', 'queued', 'processing', 'retryable_failed', 'in_progress'
  ]) THEN
    RETURN true;
  END IF;

  -- Conservative fallback: preserve unread actionable notifications.
  IF COALESCE(p_read, false) = false
     AND v_type = ANY (ARRAY[
       'friend_request',
       'match_invite',
       'team_invite',
       'match_join_request',
       'call_to_vote',
       'survey_start',
       'post_match_survey',
       'survey_reminder',
       'survey_reminder_12h',
       'challenge_squad_open'
     ]) THEN
    RETURN true;
  END IF;

  -- Explicit friend-request pending preservation.
  IF v_type = 'friend_request' AND to_regclass('public.amigos') IS NOT NULL THEN
    v_request_id_text := NULLIF(trim(COALESCE(v_data ->> 'requestId', v_data ->> 'request_id', '')), '');
    IF v_request_id_text IS NOT NULL THEN
      BEGIN
        v_request_id := v_request_id_text::uuid;
        IF EXISTS (
          SELECT 1
          FROM public.amigos a
          WHERE a.id = v_request_id
            AND a.friend_id = p_user_id
            AND lower(COALESCE(a.status, 'pending')) = 'pending'
        ) THEN
          RETURN true;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    v_sender_id_text := NULLIF(trim(COALESCE(v_data ->> 'senderId', v_data ->> 'sender_id', '')), '');
    IF v_sender_id_text IS NOT NULL THEN
      BEGIN
        v_sender_id := v_sender_id_text::uuid;
        IF EXISTS (
          SELECT 1
          FROM public.amigos a
          WHERE a.user_id = v_sender_id
            AND a.friend_id = p_user_id
            AND lower(COALESCE(a.status, 'pending')) = 'pending'
        ) THEN
          RETURN true;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;
  END IF;

  -- Explicit team-invite pending preservation.
  IF v_type = 'team_invite' AND to_regclass('public.team_invitations') IS NOT NULL THEN
    v_invitation_id_text := NULLIF(trim(COALESCE(v_data ->> 'invitation_id', v_data ->> 'invitationId', '')), '');
    IF v_invitation_id_text IS NOT NULL THEN
      BEGIN
        v_invitation_id := v_invitation_id_text::uuid;
        IF EXISTS (
          SELECT 1
          FROM public.team_invitations ti
          WHERE ti.id = v_invitation_id
            AND ti.invited_user_id = p_user_id
            AND lower(COALESCE(ti.status, 'pending')) = 'pending'
        ) THEN
          RETURN true;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;
  END IF;

  -- Explicit match-invite pending preservation.
  IF v_type = 'match_invite'
     AND (
       v_status = 'pending'
       OR v_data_status = 'pending'
       OR lower(trim(COALESCE(v_data ->> 'invite_mode', ''))) IN ('direct', 'request_join')
     ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_old_notifications(
  p_retention_days integer DEFAULT 14,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_days integer := GREATEST(COALESCE(p_retention_days, 14), 1);
  v_limit integer := GREATEST(COALESCE(p_limit, 5000), 1);
  v_cutoff timestamptz := now() - make_interval(days => v_retention_days);

  v_candidates integer := 0;
  v_exempt integer := 0;
  v_deleted integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      n.id,
      n.user_id,
      n.type,
      n.read,
      n.status,
      n.data,
      n.partido_id,
      n.created_at,
      n.send_at
    FROM public.notifications n
    WHERE n.created_at < v_cutoff
    ORDER BY n.created_at ASC
    LIMIT v_limit
  )
  SELECT count(*)::integer INTO v_candidates
  FROM candidates;

  WITH candidates AS (
    SELECT
      n.id,
      n.user_id,
      n.type,
      n.read,
      n.status,
      n.data,
      n.partido_id,
      n.created_at,
      n.send_at
    FROM public.notifications n
    WHERE n.created_at < v_cutoff
    ORDER BY n.created_at ASC
    LIMIT v_limit
  ),
  exempt AS (
    SELECT c.id
    FROM candidates c
    WHERE public.notification_is_retention_exempt(
      c.user_id,
      c.type,
      c.read,
      c.status,
      c.data,
      c.partido_id,
      c.created_at,
      c.send_at
    )
  )
  SELECT count(*)::integer INTO v_exempt
  FROM exempt;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'retention_days', v_retention_days,
      'cutoff', v_cutoff,
      'candidates', v_candidates,
      'exempt', v_exempt,
      'deleted', 0
    );
  END IF;

  WITH candidates AS (
    SELECT
      n.id,
      n.user_id,
      n.type,
      n.read,
      n.status,
      n.data,
      n.partido_id,
      n.created_at,
      n.send_at
    FROM public.notifications n
    WHERE n.created_at < v_cutoff
    ORDER BY n.created_at ASC
    LIMIT v_limit
  ),
  exempt AS (
    SELECT c.id
    FROM candidates c
    WHERE public.notification_is_retention_exempt(
      c.user_id,
      c.type,
      c.read,
      c.status,
      c.data,
      c.partido_id,
      c.created_at,
      c.send_at
    )
  ),
  deleted AS (
    DELETE FROM public.notifications n
    USING candidates c
    WHERE n.id = c.id
      AND NOT EXISTS (
        SELECT 1
        FROM exempt e
        WHERE e.id = c.id
      )
    RETURNING n.id
  )
  SELECT count(*)::integer INTO v_deleted
  FROM deleted;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'retention_days', v_retention_days,
    'cutoff', v_cutoff,
    'candidates', v_candidates,
    'exempt', v_exempt,
    'deleted', v_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_old_notification_delivery_logs(
  p_retention_days integer DEFAULT 7,
  p_limit integer DEFAULT 10000,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_days integer := GREATEST(COALESCE(p_retention_days, 7), 1);
  v_limit integer := GREATEST(COALESCE(p_limit, 10000), 1);
  v_cutoff timestamptz := now() - make_interval(days => v_retention_days);

  v_candidates integer := 0;
  v_deleted integer := 0;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'notification_delivery_log_missing'
    );
  END IF;

  WITH candidates AS (
    SELECT l.id
    FROM public.notification_delivery_log l
    WHERE l.created_at < v_cutoff
      AND lower(COALESCE(l.status, '')) IN ('sent', 'failed', 'skipped')
    ORDER BY l.created_at ASC
    LIMIT v_limit
  )
  SELECT count(*)::integer INTO v_candidates
  FROM candidates;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'retention_days', v_retention_days,
      'cutoff', v_cutoff,
      'candidates', v_candidates,
      'deleted', 0
    );
  END IF;

  WITH candidates AS (
    SELECT l.id
    FROM public.notification_delivery_log l
    WHERE l.created_at < v_cutoff
      AND lower(COALESCE(l.status, '')) IN ('sent', 'failed', 'skipped')
    ORDER BY l.created_at ASC
    LIMIT v_limit
  ),
  deleted AS (
    DELETE FROM public.notification_delivery_log l
    USING candidates c
    WHERE l.id = c.id
    RETURNING l.id
  )
  SELECT count(*)::integer INTO v_deleted
  FROM deleted;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'retention_days', v_retention_days,
    'cutoff', v_cutoff,
    'candidates', v_candidates,
    'deleted', v_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_notifications_retention_cleanup(
  p_notifications_retention_days integer DEFAULT 14,
  p_delivery_log_retention_days integer DEFAULT 7,
  p_notifications_limit integer DEFAULT 5000,
  p_delivery_log_limit integer DEFAULT 10000,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notifications jsonb;
  v_delivery_logs jsonb;
BEGIN
  v_notifications := public.purge_old_notifications(
    p_notifications_retention_days,
    p_notifications_limit,
    p_dry_run
  );

  v_delivery_logs := public.purge_old_notification_delivery_logs(
    p_delivery_log_retention_days,
    p_delivery_log_limit,
    p_dry_run
  );

  RETURN jsonb_build_object(
    'success', true,
    'executed_at', now(),
    'dry_run', p_dry_run,
    'notifications', v_notifications,
    'notification_delivery_log', v_delivery_logs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notification_is_retention_exempt(uuid, text, boolean, text, jsonb, bigint, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_is_retention_exempt(uuid, text, boolean, text, jsonb, bigint, timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.purge_old_notifications(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.purge_old_notification_delivery_logs(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_notification_delivery_logs(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.run_notifications_retention_cleanup(integer, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_notifications_retention_cleanup(integer, integer, integer, integer, boolean) TO service_role;

-- Try enabling pg_cron when available. Do not fail migration if extension is unavailable.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available or cannot be enabled automatically: %', SQLERRM;
  END;
END
$$;

-- Register daily retention cleanup when pg_cron is available.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'Skipping notifications retention cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$
      SELECT jobid
      FROM cron.job
      WHERE jobname IN ('notifications_retention_cleanup_scheduler', 'notifications_retention_cleanup')
    $sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'notifications_retention_cleanup_scheduler',
      '17 3 * * *',
      'SELECT public.run_notifications_retention_cleanup();'
    )
  $sql$;
END
$$;

COMMIT;
