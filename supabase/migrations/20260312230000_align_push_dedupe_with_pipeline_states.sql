BEGIN;

-- ============================================================================
-- MIGRATION: Align push dedupe/cooldown with new delivery pipeline states
-- Date: 2026-03-12
-- Purpose:
--   Ensure enqueue anti-spam logic accounts for in-flight states
--   (queued, processing, retryable_failed) in addition to sent.
-- ============================================================================

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
  v_now timestamptz := now();
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
  -- Counts queued/processing/sent as active/recent and retryable_failed while
  -- still inside retry window (or still recent in the same 5-minute bucket).
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
      AND (
        (
          l.status IN ('queued', 'processing', 'sent')
          AND l.created_at >= v_now - interval '5 minutes'
        )
        OR (
          l.status = 'retryable_failed'
          AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '5 minutes'
        )
      )
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
  -- Prevents duplicate enqueue while previous push is queued/processing/sent,
  -- and also while retryable_failed is still in recent retry window.
  IF v_channel NOT IN ('CANCELLATION', 'REMINDER')
     AND v_partido_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.notification_delivery_log l
       WHERE l.channel = 'push'
         AND l.user_id = NEW.user_id
         AND l.partido_id = v_partido_id
         AND COALESCE(l.payload_json ->> 'event_channel', '') = v_channel
         AND (
           (
             l.status IN ('queued', 'processing', 'sent')
             AND l.created_at >= v_now - interval '30 minutes'
           )
           OR (
             l.status = 'retryable_failed'
             AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '30 minutes'
           )
         )
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
  -- Includes queued/processing/sent and retryable_failed inside survey retry horizon.
  IF v_channel = 'SURVEY' AND v_partido_id IS NOT NULL THEN
    SELECT count(*)
    INTO v_existing_count
    FROM public.notification_delivery_log l
    WHERE l.channel = 'push'
      AND l.user_id = NEW.user_id
      AND l.partido_id = v_partido_id
      AND COALESCE(l.payload_json ->> 'event_channel', '') = 'SURVEY'
      AND (
        l.status IN ('queued', 'processing', 'sent')
        OR (
          l.status = 'retryable_failed'
          AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '24 hours'
        )
      );

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

COMMIT;
