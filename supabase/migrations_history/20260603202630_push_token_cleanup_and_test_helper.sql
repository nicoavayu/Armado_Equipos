BEGIN;

-- Deactivate Android FCM tokens that the provider has already reported as
-- permanently missing. FCM HTTP v1 reports expired/unregistered tokens as
-- UNREGISTERED with HTTP 404; older sender code stored the outer NOT_FOUND
-- status and left those rows active.
UPDATE public.device_tokens
SET
  is_active = false,
  updated_at = now(),
  invalidated_reason = COALESCE(invalidated_reason, 'provider_invalid_token')
WHERE is_active = true
  AND provider = 'fcm'
  AND last_error_at IS NOT NULL
  AND upper(COALESCE(last_error_code, '')) IN ('NOT_FOUND', 'UNREGISTERED');

CREATE OR REPLACE FUNCTION public.create_push_test_notification(
  p_type text DEFAULT 'friend_request',
  p_partido_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_type text := lower(trim(COALESCE(p_type, '')));
  v_notification_id bigint;
  v_delivery_log_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_title text;
  v_message text;
  v_link text;
  v_data jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF v_type NOT IN ('friend_request', 'post_match_survey', 'survey_start') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'unsupported_test_type',
      'allowed_types', jsonb_build_array('friend_request', 'post_match_survey', 'survey_start')
    );
  END IF;

  IF v_type = 'friend_request' THEN
    v_title := 'Prueba de push';
    v_message := 'Esto es una prueba de push de Arma2.';
    v_link := '/amigos?tab=discover';
    v_data := jsonb_build_object(
      'source', 'manual_push_test',
      'senderId', v_user_id,
      'sender_id', v_user_id,
      'requestId', v_request_id,
      'request_id', v_request_id,
      'link', v_link,
      'route', v_link
    );
  ELSE
    v_title := 'Prueba de encuesta';
    v_message := 'Push de prueba para encuesta post-partido.';
    v_link := CASE
      WHEN p_partido_id IS NOT NULL THEN '/encuesta/' || p_partido_id::text
      ELSE '/notifications'
    END;
    v_data := jsonb_build_object(
      'source', 'manual_push_test',
      'partido_id', p_partido_id,
      'match_id', p_partido_id,
      'link', v_link,
      'route', v_link
    );
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    partido_id,
    data,
    read,
    created_at
  )
  VALUES (
    v_user_id,
    v_type,
    v_title,
    v_message,
    p_partido_id,
    v_data,
    false,
    now()
  )
  RETURNING id INTO v_notification_id;

  SELECT l.id
  INTO v_delivery_log_id
  FROM public.notification_delivery_log l
  WHERE l.channel = 'push'
    AND l.payload_json ->> 'notification_id' = v_notification_id::text
  ORDER BY l.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'notification_id', v_notification_id,
    'delivery_log_id', v_delivery_log_id,
    'type', v_type,
    'queued', v_delivery_log_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_push_test_notification(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_push_test_notification(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_push_test_notification(text, bigint) TO service_role;

COMMIT;
