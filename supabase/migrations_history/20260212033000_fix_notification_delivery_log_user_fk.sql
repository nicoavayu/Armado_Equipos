-- ============================================================================
-- HOTFIX: Notification delivery user FK + resilient recipient handling
-- Date: 2026-02-12
-- Purpose:
--   1) Align notification_delivery_log.user_id with auth.users (auth source of truth)
--   2) Prevent enqueue_partido_notification from failing hard on stale usuario_id rows
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    -- Normalize old rows that cannot satisfy FK -> auth.users before recreating the constraint.
    UPDATE public.notification_delivery_log l
    SET
      user_id = NULL,
      status = CASE WHEN l.status = 'queued' THEN 'skipped' ELSE l.status END,
      error_text = COALESCE(
        l.error_text,
        'User missing in auth.users; normalized by 20260212_fix_notification_delivery_log_user_fk'
      )
    WHERE l.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users au
        WHERE au.id = l.user_id
      );

    ALTER TABLE public.notification_delivery_log
      DROP CONSTRAINT IF EXISTS notification_delivery_log_user_id_fkey;

    ALTER TABLE public.notification_delivery_log
      ADD CONSTRAINT notification_delivery_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

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
    WHEN 'match_cancelled', 'match_deleted', 'match_kicked', 'survey_start', 'survey_results_ready', 'awards_ready' THEN
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
          p_payload,
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

COMMIT;
