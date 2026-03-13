BEGIN;

-- ============================================================================
-- REAL MOBILE PUSH PIPELINE (tokens + sender queue primitives + observability)
-- Date: 2026-03-12
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Canonical dependency bootstrap (notification_delivery_log)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION
      'Missing dependency auth.users. push pipeline migration requires Supabase Auth schema.';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.notification_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  partido_id bigint,
  user_id uuid,
  notification_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'queued',
  error_text text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz
);

ALTER TABLE public.notification_delivery_log
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS partido_id bigint,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS notification_type text,
  ADD COLUMN IF NOT EXISTS payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS error_text text,
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

UPDATE public.notification_delivery_log
SET
  created_at = COALESCE(created_at, now()),
  notification_type = COALESCE(NULLIF(trim(notification_type), ''), 'unknown'),
  payload_json = COALESCE(payload_json, '{}'::jsonb),
  channel = CASE lower(trim(COALESCE(channel, '')))
    WHEN 'push' THEN 'push'
    ELSE 'in_app'
  END,
  status = CASE lower(trim(COALESCE(status, '')))
    WHEN 'queued' THEN 'queued'
    WHEN 'processing' THEN 'processing'
    WHEN 'sent' THEN 'sent'
    WHEN 'failed' THEN 'failed'
    WHEN 'retryable_failed' THEN 'retryable_failed'
    WHEN 'skipped' THEN 'skipped'
    ELSE 'failed'
  END,
  correlation_id = COALESCE(correlation_id, gen_random_uuid()),
  attempt_count = COALESCE(attempt_count, 0)
WHERE true;

ALTER TABLE public.notification_delivery_log
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN notification_type SET NOT NULL,
  ALTER COLUMN payload_json SET NOT NULL,
  ALTER COLUMN channel SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN correlation_id SET NOT NULL,
  ALTER COLUMN attempt_count SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_delivery_log_channel_check'
      AND conrelid = 'public.notification_delivery_log'::regclass
  ) THEN
    ALTER TABLE public.notification_delivery_log
      ADD CONSTRAINT notification_delivery_log_channel_check
      CHECK (channel IN ('in_app', 'push'));
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.partidos') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'notification_delivery_log_partido_id_fkey'
         AND conrelid = 'public.notification_delivery_log'::regclass
     )
  THEN
    ALTER TABLE public.notification_delivery_log
      ADD CONSTRAINT notification_delivery_log_partido_id_fkey
      FOREIGN KEY (partido_id)
      REFERENCES public.partidos(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_delivery_log_user_id_fkey'
      AND conrelid = 'public.notification_delivery_log'::regclass
  ) THEN
    ALTER TABLE public.notification_delivery_log
      ADD CONSTRAINT notification_delivery_log_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_delivery_log_unique_per_correlation
  ON public.notification_delivery_log(user_id, partido_id, notification_type, correlation_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_partido
  ON public.notification_delivery_log(partido_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_user
  ON public.notification_delivery_log(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_status
  ON public.notification_delivery_log(status);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_type
  ON public.notification_delivery_log(notification_type);

ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_delivery_log_select_own ON public.notification_delivery_log;
DROP POLICY IF EXISTS "Users can view own delivery logs" ON public.notification_delivery_log;
CREATE POLICY notification_delivery_log_select_own
ON public.notification_delivery_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.notification_delivery_log FROM anon;
GRANT SELECT ON TABLE public.notification_delivery_log TO authenticated;
GRANT ALL ON TABLE public.notification_delivery_log TO service_role;

DO $$
DECLARE
  v_missing_columns text;
  v_mismatched_columns text;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RAISE EXCEPTION
      'Missing dependency public.notification_delivery_log. This table must exist before push pipeline migration.';
  END IF;

  SELECT string_agg(required.col, ', ')
  INTO v_missing_columns
  FROM (
    VALUES
      ('id'),
      ('created_at'),
      ('partido_id'),
      ('user_id'),
      ('notification_type'),
      ('payload_json'),
      ('channel'),
      ('status'),
      ('error_text'),
      ('correlation_id'),
      ('attempt_count'),
      ('sent_at')
  ) AS required(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'notification_delivery_log'
   AND c.column_name = required.col
  WHERE c.column_name IS NULL;

  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'public.notification_delivery_log is missing required columns: %', v_missing_columns;
  END IF;

  SELECT string_agg(format('%s(expected=%s, actual=%s)', req.col, req.expected_type, COALESCE(c.data_type, 'missing')), ', ')
  INTO v_mismatched_columns
  FROM (
    VALUES
      ('id', 'uuid'),
      ('created_at', 'timestamp with time zone'),
      ('partido_id', 'bigint'),
      ('user_id', 'uuid'),
      ('notification_type', 'text'),
      ('payload_json', 'jsonb'),
      ('channel', 'text'),
      ('status', 'text'),
      ('error_text', 'text'),
      ('correlation_id', 'uuid'),
      ('attempt_count', 'integer'),
      ('sent_at', 'timestamp with time zone')
  ) AS req(col, expected_type)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'notification_delivery_log'
   AND c.column_name = req.col
  WHERE c.column_name IS NULL
     OR lower(c.data_type) <> req.expected_type;

  IF v_mismatched_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'public.notification_delivery_log has incompatible column types: %', v_mismatched_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.notification_delivery_log'::regclass
      AND con.contype = 'p'
      AND att.attname = 'id'
  ) THEN
    RAISE EXCEPTION
      'public.notification_delivery_log must have primary key on column id.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1) Canonical device token registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'unknown',
  provider text NOT NULL DEFAULT 'fcm',
  token text NOT NULL,
  app_version text,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  invalidated_reason text,
  last_error_code text,
  last_error_at timestamptz
);

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'fcm',
  ADD COLUMN IF NOT EXISTS token text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invalidated_reason text,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

UPDATE public.device_tokens
SET
  platform = COALESCE(NULLIF(trim(platform), ''), 'unknown'),
  provider = COALESCE(NULLIF(trim(provider), ''), 'fcm'),
  token = CASE WHEN token IS NULL THEN NULL ELSE trim(token) END,
  updated_at = COALESCE(updated_at, now()),
  created_at = COALESCE(created_at, now()),
  last_seen_at = COALESCE(last_seen_at, now()),
  is_active = COALESCE(is_active, true)
WHERE true;

DELETE FROM public.device_tokens
WHERE token IS NULL OR trim(token) = '';

ALTER TABLE public.device_tokens
  ALTER COLUMN token SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'device_tokens_platform_check'
      AND conrelid = 'public.device_tokens'::regclass
  ) THEN
    ALTER TABLE public.device_tokens
      ADD CONSTRAINT device_tokens_platform_check
      CHECK (platform IN ('ios', 'android', 'web', 'unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'device_tokens_provider_check'
      AND conrelid = 'public.device_tokens'::regclass
  ) THEN
    ALTER TABLE public.device_tokens
      ADD CONSTRAINT device_tokens_provider_check
      CHECK (provider IN ('fcm', 'apns', 'unknown'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_token_unique
  ON public.device_tokens(token);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active
  ON public.device_tokens(user_id, is_active, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_tokens_device_lookup
  ON public.device_tokens(device_id, platform)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_tokens_active_provider
  ON public.device_tokens(provider, platform)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_active_user_device_platform
  ON public.device_tokens(user_id, device_id, platform)
  WHERE is_active = true AND device_id IS NOT NULL;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_select_own ON public.device_tokens;
CREATE POLICY device_tokens_select_own
ON public.device_tokens
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS device_tokens_service_role_all ON public.device_tokens;
CREATE POLICY device_tokens_service_role_all
ON public.device_tokens
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON TABLE public.device_tokens FROM anon, authenticated;
GRANT SELECT ON TABLE public.device_tokens TO authenticated;
GRANT ALL ON TABLE public.device_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Helper normalizers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_push_platform(p_platform text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(COALESCE($1, '')))
    WHEN 'ios' THEN 'ios'
    WHEN 'android' THEN 'android'
    WHEN 'web' THEN 'web'
    ELSE 'unknown'
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_push_provider(
  p_provider text,
  p_platform text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(COALESCE($1, '')))
    WHEN 'fcm' THEN 'fcm'
    WHEN 'apns' THEN 'apns'
    WHEN 'unknown' THEN 'unknown'
    ELSE CASE public.normalize_push_platform($2)
      WHEN 'ios' THEN 'apns'
      WHEN 'android' THEN 'fcm'
      WHEN 'web' THEN 'unknown'
      ELSE 'unknown'
    END
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Canonical RPCs for tokens (no direct frontend writes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_token text,
  p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token text := trim(COALESCE(p_token, ''));
  v_platform text := public.normalize_push_platform(p_platform);
  v_provider text := public.normalize_push_provider(p_provider, v_platform);
  v_device_id text := NULLIF(trim(COALESCE(p_device_id, '')), '');
  v_app_version text := NULLIF(trim(COALESCE(p_app_version, '')), '');
  v_row public.device_tokens%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF length(v_token) < 20 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_token');
  END IF;

  INSERT INTO public.device_tokens (
    user_id,
    platform,
    provider,
    token,
    app_version,
    device_id,
    created_at,
    updated_at,
    last_seen_at,
    is_active,
    invalidated_reason,
    last_error_code,
    last_error_at
  ) VALUES (
    v_user_id,
    v_platform,
    v_provider,
    v_token,
    v_app_version,
    v_device_id,
    now(),
    now(),
    now(),
    true,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    provider = EXCLUDED.provider,
    app_version = COALESCE(EXCLUDED.app_version, public.device_tokens.app_version),
    device_id = COALESCE(EXCLUDED.device_id, public.device_tokens.device_id),
    is_active = true,
    updated_at = now(),
    last_seen_at = now(),
    invalidated_reason = NULL,
    last_error_code = NULL,
    last_error_at = NULL
  RETURNING * INTO v_row;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.device_tokens
    SET
      is_active = false,
      updated_at = now(),
      invalidated_reason = COALESCE(invalidated_reason, 'token_rotated')
    WHERE user_id = v_user_id
      AND id <> v_row.id
      AND is_active = true
      AND device_id = v_device_id
      AND platform = v_platform;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'token_id', v_row.id,
    'user_id', v_user_id,
    'platform', v_row.platform,
    'provider', v_row.provider,
    'is_active', v_row.is_active,
    'last_seen_at', v_row.last_seen_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_device_token(
  p_old_token text,
  p_new_token text,
  p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_old_token text := trim(COALESCE(p_old_token, ''));
  v_new_token text := trim(COALESCE(p_new_token, ''));
  v_deactivated_count int := 0;
  v_register_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF length(v_new_token) < 20 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_new_token');
  END IF;

  IF v_old_token <> '' AND v_old_token <> v_new_token THEN
    UPDATE public.device_tokens
    SET
      is_active = false,
      updated_at = now(),
      last_seen_at = now(),
      invalidated_reason = 'token_refreshed'
    WHERE user_id = v_user_id
      AND token = v_old_token
      AND is_active = true;

    GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;
  END IF;

  v_register_result := public.register_device_token(
    v_new_token,
    p_platform,
    p_app_version,
    p_device_id,
    p_provider
  );

  RETURN COALESCE(v_register_result, '{}'::jsonb)
    || jsonb_build_object(
      'old_token', NULLIF(v_old_token, ''),
      'old_token_deactivated_count', v_deactivated_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_device_token(
  p_token text DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_reason text DEFAULT 'user_logout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token text := NULLIF(trim(COALESCE(p_token, '')), '');
  v_device_id text := NULLIF(trim(COALESCE(p_device_id, '')), '');
  v_platform text := CASE
    WHEN NULLIF(trim(COALESCE(p_platform, '')), '') IS NULL THEN NULL
    ELSE public.normalize_push_platform(p_platform)
  END;
  v_reason text := COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'manual_deactivation');
  v_updated_count int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  UPDATE public.device_tokens
  SET
    is_active = false,
    updated_at = now(),
    last_seen_at = now(),
    invalidated_reason = v_reason
  WHERE user_id = v_user_id
    AND is_active = true
    AND (v_token IS NULL OR token = v_token)
    AND (v_device_id IS NULL OR device_id = v_device_id)
    AND (v_platform IS NULL OR platform = v_platform);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'deactivated_count', v_updated_count,
    'reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_invalid_device_tokens(
  p_limit integer DEFAULT 500,
  p_stale_days integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := GREATEST(COALESCE(p_limit, 500), 1);
  v_stale_days int := GREATEST(COALESCE(p_stale_days, 120), 1);
  v_deactivated_count int := 0;
BEGIN
  WITH candidates AS (
    SELECT dt.id
    FROM public.device_tokens dt
    WHERE dt.is_active = true
      AND (
        (dt.last_error_code IS NOT NULL AND dt.last_error_at IS NOT NULL)
        OR dt.last_seen_at <= (now() - make_interval(days => v_stale_days))
      )
    ORDER BY COALESCE(dt.last_error_at, dt.last_seen_at) ASC
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.device_tokens dt
    SET
      is_active = false,
      updated_at = now(),
      invalidated_reason = COALESCE(
        dt.invalidated_reason,
        CASE
          WHEN dt.last_error_code IS NOT NULL THEN 'provider_invalidated'
          ELSE 'stale_token'
        END
      )
    FROM candidates c
    WHERE dt.id = c.id
    RETURNING dt.id
  )
  SELECT count(*) INTO v_deactivated_count FROM updated;

  RETURN jsonb_build_object(
    'success', true,
    'deactivated_count', v_deactivated_count,
    'stale_days', v_stale_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_device_token(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_device_token(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_device_token(text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.deactivate_device_token(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_device_token(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_device_token(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_invalid_device_tokens(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_invalid_device_tokens(integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Extend delivery log schema for real push dispatching
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.notification_delivery_log
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_by text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_response_json jsonb;

DO $$
DECLARE
  v_con record;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN;
  END IF;

  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.notification_delivery_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%queued%'
      AND pg_get_constraintdef(oid) ILIKE '%failed%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_delivery_log DROP CONSTRAINT %I', v_con.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notification_delivery_log'::regclass
      AND conname = 'notification_delivery_log_status_check'
  ) THEN
    ALTER TABLE public.notification_delivery_log
      ADD CONSTRAINT notification_delivery_log_status_check
      CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'retryable_failed', 'skipped'));
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_push_dispatch
      ON public.notification_delivery_log (status, COALESCE(next_retry_at, created_at), created_at)
      WHERE channel = 'push'
        AND status IN ('queued', 'processing', 'retryable_failed');

    CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_push_user_lookup
      ON public.notification_delivery_log (user_id, created_at DESC)
      WHERE channel = 'push';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5) Sender queue RPCs (claim + finalize)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_push_delivery_batch(
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

  RETURN QUERY
  WITH candidates AS (
    SELECT l.id
    FROM public.notification_delivery_log l
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

CREATE OR REPLACE FUNCTION public.finalize_push_delivery_attempt(
  p_log_id uuid,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_error_text text DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_response_json jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_updated_count int := 0;
BEGIN
  IF p_log_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_status NOT IN ('sent', 'failed', 'retryable_failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid push final status: %', v_status;
  END IF;

  UPDATE public.notification_delivery_log
  SET
    status = v_status,
    error_code = CASE
      WHEN v_status = 'sent' THEN NULL
      ELSE NULLIF(trim(COALESCE(p_error_code, '')), '')
    END,
    error_text = CASE
      WHEN v_status = 'sent' THEN NULL
      ELSE NULLIF(trim(COALESCE(p_error_text, '')), '')
    END,
    sent_at = CASE WHEN v_status = 'sent' THEN now() ELSE sent_at END,
    next_retry_at = CASE
      WHEN v_status = 'retryable_failed' THEN COALESCE(p_next_retry_at, now() + interval '5 minutes')
      ELSE NULL
    END,
    processing_started_at = NULL,
    processing_by = NULL,
    provider_message_id = COALESCE(NULLIF(trim(COALESCE(p_provider_message_id, '')), ''), provider_message_id),
    provider_response_json = COALESCE(p_provider_response_json, provider_response_json)
  WHERE id = p_log_id
    AND channel = 'push';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN COALESCE(v_updated_count, 0) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery_batch(integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_batch(integer, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_push_delivery_attempt(uuid, text, text, text, timestamptz, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_push_delivery_attempt(uuid, text, text, text, timestamptz, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Minimal observability views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.push_queue_status_summary
WITH (security_invoker = on)
AS
SELECT
  count(*) FILTER (WHERE channel = 'push' AND status = 'queued') AS queued_count,
  count(*) FILTER (WHERE channel = 'push' AND status = 'processing') AS processing_count,
  count(*) FILTER (WHERE channel = 'push' AND status = 'retryable_failed') AS retryable_failed_count,
  count(*) FILTER (WHERE channel = 'push' AND status = 'sent') AS sent_count,
  count(*) FILTER (WHERE channel = 'push' AND status = 'failed') AS failed_count,
  count(*) FILTER (WHERE channel = 'push' AND status = 'skipped') AS skipped_count,
  count(*) FILTER (
    WHERE channel = 'push'
      AND status IN ('queued', 'retryable_failed')
      AND COALESCE(next_retry_at, created_at) <= now()
  ) AS ready_to_process_count
FROM public.notification_delivery_log;

CREATE OR REPLACE VIEW public.push_queue_event_summary
WITH (security_invoker = on)
AS
SELECT
  COALESCE(notification_type, 'unknown') AS notification_type,
  count(*) FILTER (WHERE status = 'queued') AS queued_count,
  count(*) FILTER (WHERE status = 'processing') AS processing_count,
  count(*) FILTER (WHERE status = 'retryable_failed') AS retryable_failed_count,
  count(*) FILTER (WHERE status = 'sent') AS sent_count,
  count(*) FILTER (WHERE status = 'failed') AS failed_count,
  count(*) FILTER (WHERE status = 'skipped') AS skipped_count,
  max(created_at) AS last_enqueued_at,
  max(sent_at) AS last_sent_at
FROM public.notification_delivery_log
WHERE channel = 'push'
GROUP BY COALESCE(notification_type, 'unknown');

GRANT SELECT ON public.push_queue_status_summary TO authenticated;
GRANT SELECT ON public.push_queue_status_summary TO service_role;
GRANT SELECT ON public.push_queue_event_summary TO authenticated;
GRANT SELECT ON public.push_queue_event_summary TO service_role;

COMMIT;
