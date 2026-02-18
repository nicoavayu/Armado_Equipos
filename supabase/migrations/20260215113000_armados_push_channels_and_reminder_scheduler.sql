-- ============================================================================
-- MIGRATION: Armados notification channels, push filter, and 1h reminders
-- Date: 2026-02-15
-- Purpose:
--   1) Define logical notification channels and remote-push allowlist
--   2) Enforce anti-spam rules before queueing remote push deliveries
--   3) Add backend reminder scheduler (1h before match, idempotent)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Minimal schema additions for push preferences / activity suppression
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_partido_id bigint,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NOT NULL
    AND to_regclass('public.partidos') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'usuarios_last_seen_partido_id_fkey'
    )
  THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_last_seen_partido_id_fkey
      FOREIGN KEY (last_seen_partido_id)
      REFERENCES public.partidos(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.partidos
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_partidos_reminder_sent_at
  ON public.partidos(reminder_sent_at);

DO $$
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_push_lookup
      ON public.notification_delivery_log (
        user_id,
        partido_id,
        (payload_json ->> 'event_channel'),
        created_at DESC
      )
      WHERE channel = 'push';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1) Channel mapping helpers
-- ---------------------------------------------------------------------------
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
    WHEN 'survey_start' THEN RETURN 'SURVEY';
    WHEN 'post_match_survey' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder' THEN RETURN 'SURVEY';
    WHEN 'match_join_approved' THEN RETURN 'ACCEPTED';
    WHEN 'match_join_request' THEN RETURN 'JOIN_REQUEST';
    WHEN 'call_to_vote' THEN RETURN 'VOTE_REQUEST';
    WHEN 'match_reminder_1h' THEN RETURN 'REMINDER';
    WHEN 'awards_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_results_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_finished' THEN RETURN 'ACTIVITY';
    WHEN 'friend_request' THEN RETURN 'INFO';
    WHEN 'friend_accepted' THEN RETURN 'INFO';
    WHEN 'friend_rejected' THEN RETURN 'INFO';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_channel_allows_push(p_channel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(upper($1), '') = ANY (
    ARRAY['INVITATION', 'CANCELLATION', 'SURVEY', 'ACCEPTED', 'JOIN_REQUEST', 'VOTE_REQUEST', 'REMINDER']
  );
$$;

CREATE OR REPLACE FUNCTION public.notification_resolve_partido_id(
  p_partido_id bigint,
  p_data jsonb
)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_candidate text;
BEGIN
  IF p_partido_id IS NOT NULL THEN
    RETURN p_partido_id;
  END IF;

  v_candidate := COALESCE(
    p_data ->> 'partido_id',
    p_data ->> 'match_id',
    p_data ->> 'matchId',
    p_data ->> 'match_ref'
  );

  IF v_candidate IS NOT NULL AND v_candidate ~ '^[0-9]+$' THEN
    RETURN v_candidate::bigint;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Push decision filter (INSERT/UPDATE on notifications -> queue push log)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_remote_push_from_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
  v_partido_id bigint;
  v_correlation_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_push_enabled boolean := true;
  v_is_active boolean := false;
  v_last_seen_partido_id bigint := NULL;
  v_admin_id uuid := NULL;
  v_existing_group_id uuid;
  v_existing_group_count int := 1;
  v_existing_count int := 0;
  v_skip_reason text;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL OR COALESCE(NEW.read, false) = true THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.read, false) = COALESCE(NEW.read, false)
     AND OLD.title IS NOT DISTINCT FROM NEW.title
     AND OLD.message IS NOT DISTINCT FROM NEW.message
     AND OLD.data IS NOT DISTINCT FROM NEW.data
  THEN
    RETURN NEW;
  END IF;

  v_channel := public.notification_event_channel(NEW.type);
  v_partido_id := public.notification_resolve_partido_id(NEW.partido_id, NEW.data);

  IF NOT public.notification_channel_allows_push(v_channel) THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'in_app_only_channel'
    );

    RETURN NEW;
  END IF;

  IF to_regclass('public.usuarios') IS NOT NULL THEN
    BEGIN
      SELECT
        COALESCE(u.push_enabled, true),
        COALESCE(u.is_active, false),
        u.last_seen_partido_id
      INTO
        v_push_enabled,
        v_is_active,
        v_last_seen_partido_id
      FROM public.usuarios u
      WHERE u.id = NEW.user_id;
    EXCEPTION
      WHEN undefined_column THEN
        v_push_enabled := true;
        v_is_active := false;
        v_last_seen_partido_id := NULL;
    END;
  END IF;

  IF COALESCE(v_push_enabled, true) = false THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'push_disabled'
    );

    RETURN NEW;
  END IF;

  IF v_channel IN ('JOIN_REQUEST', 'VOTE_REQUEST') AND v_partido_id IS NOT NULL THEN
    SELECT p.creado_por
    INTO v_admin_id
    FROM public.partidos p
    WHERE p.id = v_partido_id;

    IF v_admin_id IS NOT NULL AND v_admin_id <> NEW.user_id THEN
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id
        ),
        v_correlation_id,
        'push',
        'skipped',
        'not_match_admin'
      );

      RETURN NEW;
    END IF;
  END IF;

  IF v_partido_id IS NOT NULL
     AND COALESCE(v_is_active, false)
     AND v_last_seen_partido_id = v_partido_id
  THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'user_active_on_match'
    );

    RETURN NEW;
  END IF;

  -- JOIN_REQUEST/VOTE_REQUEST aggregation window: 5 minutes.
  IF v_channel IN ('JOIN_REQUEST', 'VOTE_REQUEST') AND v_partido_id IS NOT NULL THEN
    SELECT
      l.id,
      COALESCE(NULLIF((l.payload_json ->> 'group_count')::int, 0), 1)
    INTO
      v_existing_group_id,
      v_existing_group_count
    FROM public.notification_delivery_log l
    WHERE l.channel = 'push'
      AND l.user_id = NEW.user_id
      AND l.partido_id = v_partido_id
      AND COALESCE(l.payload_json ->> 'event_channel', '') = v_channel
      AND l.status IN ('queued', 'sent')
      AND l.created_at >= now() - interval '5 minutes'
    ORDER BY l.created_at DESC
    LIMIT 1;

    IF v_existing_group_id IS NOT NULL THEN
      v_existing_group_count := GREATEST(v_existing_group_count + 1, 2);

      UPDATE public.notification_delivery_log
      SET payload_json = COALESCE(payload_json, '{}'::jsonb) || jsonb_build_object(
        'event_channel', v_channel,
        'grouped', true,
        'group_count', v_existing_group_count,
        'title', CASE
          WHEN v_channel = 'JOIN_REQUEST' THEN 'Nuevas solicitudes para unirse'
          ELSE 'Nuevos pedidos para votar'
        END,
        'message', CASE
          WHEN v_channel = 'JOIN_REQUEST'
            THEN format('Tenés %s solicitudes para revisar en este partido.', v_existing_group_count)
          ELSE format('Tenés %s pedidos para votar en este partido.', v_existing_group_count)
        END,
        'last_notification_id', NEW.id,
        'last_created_at', NEW.created_at
      )
      WHERE id = v_existing_group_id;

      v_skip_reason := format('grouped_with_%s', v_existing_group_id::text);
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id,
          'grouped_into', v_existing_group_id
        ),
        v_correlation_id,
        'push',
        'skipped',
        v_skip_reason
      );

      RETURN NEW;
    END IF;
  END IF;

  -- Cooldown 30m by (user_id, partido_id, channel), except CANCELLATION and REMINDER.
  IF v_channel NOT IN ('CANCELLATION', 'REMINDER')
     AND v_partido_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.notification_delivery_log l
       WHERE l.channel = 'push'
         AND l.user_id = NEW.user_id
         AND l.partido_id = v_partido_id
         AND COALESCE(l.payload_json ->> 'event_channel', '') = v_channel
         AND l.status IN ('queued', 'sent')
         AND l.created_at >= now() - interval '30 minutes'
     )
  THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'cooldown_30m'
    );

    RETURN NEW;
  END IF;

  -- Survey policy: max 2 pushes per (user, match): first push + optional final reminder.
  IF v_channel = 'SURVEY' AND v_partido_id IS NOT NULL THEN
    SELECT count(*)
    INTO v_existing_count
    FROM public.notification_delivery_log l
    WHERE l.channel = 'push'
      AND l.user_id = NEW.user_id
      AND l.partido_id = v_partido_id
      AND COALESCE(l.payload_json ->> 'event_channel', '') = 'SURVEY'
      AND l.status IN ('queued', 'sent');

    IF v_existing_count >= 2 THEN
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id
        ),
        v_correlation_id,
        'push',
        'skipped',
        'survey_push_limit_reached'
      );

      RETURN NEW;
    END IF;
  END IF;

  v_payload := COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object(
    'event_channel', v_channel,
    'notification_id', NEW.id,
    'notification_type', NEW.type,
    'title', NEW.title,
    'message', NEW.message,
    'partido_id', v_partido_id,
    'source', CASE WHEN TG_OP = 'UPDATE' THEN 'notifications_update' ELSE 'notifications_insert' END
  );

  INSERT INTO public.notification_delivery_log (
    partido_id,
    user_id,
    notification_type,
    payload_json,
    correlation_id,
    channel,
    status
  ) VALUES (
    v_partido_id,
    NEW.user_id,
    NEW.type,
    v_payload,
    v_correlation_id,
    'push',
    'queued'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_queue_remote_push ON public.notifications;
CREATE TRIGGER trg_notifications_queue_remote_push
AFTER INSERT OR UPDATE
ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_remote_push_from_notification();

-- ---------------------------------------------------------------------------
-- 3) Keep dispatcher compatible with reminder notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_partido_notification(
  p_partido_id bigint,
  p_type text,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb AS $$
DECLARE
  v_correlation_id uuid := gen_random_uuid();
  v_recipient_id uuid;
  v_recipients uuid[];
  v_count int := 0;
  v_admin_id uuid;
BEGIN
  SELECT creado_por INTO v_admin_id
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  CASE p_type
    WHEN 'match_cancelled', 'match_deleted', 'match_kicked', 'survey_start', 'survey_results_ready', 'awards_ready', 'post_match_survey', 'survey_reminder', 'match_reminder_1h' THEN
      SELECT ARRAY_AGG(DISTINCT usuario_id)
      INTO v_recipients
      FROM public.jugadores
      WHERE partido_id = p_partido_id
        AND usuario_id IS NOT NULL;

      IF v_admin_id IS NOT NULL THEN
        v_recipients := array_append(v_recipients, v_admin_id);
      END IF;
    ELSE
      v_recipients := ARRAY[v_admin_id];
  END CASE;

  v_recipients := ARRAY(
    SELECT DISTINCT uid
    FROM unnest(COALESCE(v_recipients, ARRAY[]::uuid[])) AS uid
    WHERE uid IS NOT NULL
  );

  FOREACH v_recipient_id IN ARRAY v_recipients
  LOOP
    IF EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = v_recipient_id
    ) THEN
      BEGIN
        INSERT INTO public.notifications (
          user_id,
          partido_id,
          type,
          title,
          message,
          data,
          read
        ) VALUES (
          v_recipient_id,
          p_partido_id,
          p_type,
          COALESCE(p_title, 'Notificación de partido'),
          COALESCE(p_message, 'Tienes una nueva notificación'),
          p_payload,
          false
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION
        WHEN foreign_key_violation THEN
          IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
            INSERT INTO public.notification_delivery_log (
              partido_id,
              user_id,
              notification_type,
              payload_json,
              correlation_id,
              channel,
              status,
              error_text
            ) VALUES (
              p_partido_id,
              NULL,
              p_type,
              COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('skipped_user_id', v_recipient_id::text),
              v_correlation_id,
              'in_app',
              'skipped',
              COALESCE(SQLERRM, format('Skipped recipient %s due FK violation on notifications', v_recipient_id))
            ) ON CONFLICT DO NOTHING;
          END IF;
          CONTINUE;
      END;

      IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
        INSERT INTO public.notification_delivery_log (
          partido_id,
          user_id,
          notification_type,
          payload_json,
          correlation_id,
          channel,
          status
        ) VALUES (
          p_partido_id,
          v_recipient_id,
          p_type,
          COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
            'event_channel', public.notification_event_channel(p_type)
          ),
          v_correlation_id,
          'in_app',
          'queued'
        ) ON CONFLICT DO NOTHING;
      END IF;

      v_count := v_count + 1;
    ELSE
      IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
        INSERT INTO public.notification_delivery_log (
          partido_id,
          user_id,
          notification_type,
          payload_json,
          correlation_id,
          channel,
          status,
          error_text
        ) VALUES (
          p_partido_id,
          NULL,
          p_type,
          COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('skipped_user_id', v_recipient_id::text),
          v_correlation_id,
          'in_app',
          'skipped',
          format('Skipped recipient %s because user does not exist in auth.users', v_recipient_id)
        ) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'correlation_id', v_correlation_id,
    'recipients_count', v_count,
    'recipients', COALESCE(v_recipients, ARRAY[]::uuid[])
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Ensure call_to_vote includes admin recipient (for VOTE_REQUEST policy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
  v_admin_id uuid;
BEGIN
  SELECT codigo, creado_por
  INTO v_match_code, v_admin_id
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
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
    UNION
    SELECT v_admin_id
    WHERE v_admin_id IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.send_call_to_vote(bigint, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Presence helper RPC (used by clients to suppress push while active)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_notification_presence(
  p_is_active boolean DEFAULT true,
  p_last_seen_partido_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  UPDATE public.usuarios
  SET
    is_active = COALESCE(p_is_active, false),
    last_seen_partido_id = CASE
      WHEN COALESCE(p_is_active, false) THEN p_last_seen_partido_id
      ELSE NULL
    END,
    last_seen_at = now()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_row_not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'is_active', COALESCE(p_is_active, false),
    'last_seen_partido_id', CASE
      WHEN COALESCE(p_is_active, false) THEN p_last_seen_partido_id
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_notification_presence(boolean, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Reminder backend job: 1h before match, idempotent by partido flag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_match_reminder_notifications_backend(
  p_window_minutes integer DEFAULT 5,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window interval := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 5), 1));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;
  v_from timestamp := v_now_local + interval '60 minutes' - v_window;
  v_to timestamp := v_now_local + interval '60 minutes' + v_window;
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
        CASE
          WHEN replace(trim(p.hora), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
            p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
          ELSE NULL::timestamp
        END AS starts_at_local
      FROM public.partidos p
      WHERE p.fecha IS NOT NULL
        AND p.hora IS NOT NULL
        AND COALESCE(p.reminder_sent_at, NULL) IS NULL
        AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo')
    )
    SELECT c.id, c.nombre, c.fecha, c.hora, c.starts_at_local
    FROM candidates c
    WHERE c.starts_at_local IS NOT NULL
      AND c.starts_at_local >= v_from
      AND c.starts_at_local <= v_to
    ORDER BY c.starts_at_local ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    v_scanned := v_scanned + 1;

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        'match_reminder_1h',
        'Recordatorio de partido',
        'Tu partido empieza en aproximadamente 1 hora.',
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.nombre,
          'match_date', v_match.fecha,
          'match_time', v_match.hora,
          'link', '/partido-publico/' || v_match.id,
          'reminder_type', '1h_before',
          'source', 'match_reminder_scheduler'
        )
      );

      UPDATE public.partidos
      SET reminder_sent_at = now()
      WHERE id = v_match.id
        AND reminder_sent_at IS NULL;

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
    'window_from', v_from,
    'window_to', v_to,
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_match_reminder_notifications_backend(integer, integer) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.process_match_reminder_notifications_backend(integer, integer) TO service_role;
  END IF;
END
$$;

-- Try enabling pg_cron if available.
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

-- Register reminder job (every 5 minutes) when pg_cron is available.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'Skipping reminder cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$
      SELECT jobid
      FROM cron.job
      WHERE jobname IN ('match_reminder_1h_scheduler')
    $sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'match_reminder_1h_scheduler',
      '*/5 * * * *',
      'SELECT public.process_match_reminder_notifications_backend();'
    )
  $sql$;
END
$$;

COMMIT;
