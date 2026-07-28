BEGIN;

-- Ensure participant fanout refreshes match_update notifications instead of silently
-- dropping them because of the unique (user_id, data->>'match_id', type) index.
CREATE OR REPLACE FUNCTION public.enqueue_match_participant_notification(
  p_partido_id bigint,
  p_type text,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_exclude_user_id uuid DEFAULT NULL,
  p_include_admin boolean DEFAULT true
) RETURNS jsonb AS $$
DECLARE
  v_admin_id uuid;
  v_recipient_id uuid;
  v_recipients uuid[];
  v_count int := 0;
  v_mutated_rows int := 0;
BEGIN
  SELECT creado_por
  INTO v_admin_id
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  SELECT ARRAY_AGG(DISTINCT j.usuario_id)
  INTO v_recipients
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id
    AND j.usuario_id IS NOT NULL;

  IF p_include_admin AND v_admin_id IS NOT NULL THEN
    v_recipients := array_append(v_recipients, v_admin_id);
  END IF;

  v_recipients := ARRAY(
    SELECT DISTINCT uid
    FROM unnest(COALESCE(v_recipients, ARRAY[]::uuid[])) AS uid
    WHERE uid IS NOT NULL
      AND (p_exclude_user_id IS NULL OR uid <> p_exclude_user_id)
  );

  FOREACH v_recipient_id IN ARRAY v_recipients
  LOOP
    IF EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = v_recipient_id
    ) THEN
      v_mutated_rows := 0;

      IF p_type = 'match_update' THEN
        INSERT INTO public.notifications (
          user_id,
          partido_id,
          type,
          title,
          message,
          data,
          read,
          created_at,
          send_at
        ) VALUES (
          v_recipient_id,
          p_partido_id,
          p_type,
          COALESCE(p_title, 'Notificación de partido'),
          COALESCE(p_message, 'Tenés una nueva notificación'),
          COALESCE(p_payload, '{}'::jsonb),
          false,
          now(),
          now()
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;

        IF v_mutated_rows = 0 THEN
          UPDATE public.notifications
          SET
            partido_id = p_partido_id,
            title = COALESCE(p_title, 'Notificación de partido'),
            message = COALESCE(p_message, 'Tenés una nueva notificación'),
            data = COALESCE(p_payload, '{}'::jsonb),
            read = false,
            created_at = now(),
            send_at = now()
          WHERE user_id = v_recipient_id
            AND type = p_type
            AND (
              partido_id = p_partido_id
              OR COALESCE(
                data ->> 'match_id',
                data ->> 'matchId',
                data ->> 'partido_id',
                data ->> 'partidoId'
              ) = p_partido_id::text
            );

          GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
        END IF;
      ELSE
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
          COALESCE(p_message, 'Tenés una nueva notificación'),
          COALESCE(p_payload, '{}'::jsonb),
          false
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
      END IF;

      IF v_mutated_rows > 0 THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recipients_count', v_count,
    'recipients', COALESCE(v_recipients, ARRAY[]::uuid[])
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep existing behavior and add explicit service_role execution for edge functions.
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
  v_mutated_rows int := 0;
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
      v_mutated_rows := 0;

      BEGIN
        IF p_type = 'match_update' THEN
          INSERT INTO public.notifications (
            user_id,
            partido_id,
            type,
            title,
            message,
            data,
            read,
            created_at,
            send_at
          ) VALUES (
            v_recipient_id,
            p_partido_id,
            p_type,
            COALESCE(p_title, 'Notificación de partido'),
            COALESCE(p_message, 'Tienes una nueva notificación'),
            COALESCE(p_payload, '{}'::jsonb),
            false,
            now(),
            now()
          )
          ON CONFLICT DO NOTHING;

          GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;

          IF v_mutated_rows = 0 THEN
            UPDATE public.notifications
            SET
              partido_id = p_partido_id,
              title = COALESCE(p_title, 'Notificación de partido'),
              message = COALESCE(p_message, 'Tienes una nueva notificación'),
              data = COALESCE(p_payload, '{}'::jsonb),
              read = false,
              created_at = now(),
              send_at = now()
            WHERE user_id = v_recipient_id
              AND type = p_type
              AND (
                partido_id = p_partido_id
                OR COALESCE(
                  data ->> 'match_id',
                  data ->> 'matchId',
                  data ->> 'partido_id',
                  data ->> 'partidoId'
                ) = p_partido_id::text
              );

            GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
          END IF;
        ELSE
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
            COALESCE(p_payload, '{}'::jsonb),
            false
          )
          ON CONFLICT DO NOTHING;

          GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
        END IF;
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

      IF v_mutated_rows > 0 THEN
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
      END IF;
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

GRANT EXECUTE ON FUNCTION public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification(bigint, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification(bigint, text, text, text, jsonb) TO service_role;

COMMIT;
