BEGIN;

CREATE OR REPLACE FUNCTION public.send_match_kicked_notification(
  p_user_id uuid,
  p_partido_id bigint,
  p_match_name text DEFAULT NULL,
  p_kicked_by uuid DEFAULT NULL,
  p_kicked_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kicked_at timestamptz := COALESCE(p_kicked_at, now());
  v_notification_data jsonb;
  v_match_name text := COALESCE(NULLIF(trim(p_match_name), ''), 'PARTIDO');
BEGIN
  IF p_user_id IS NULL OR p_partido_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_required_arguments');
  END IF;

  v_notification_data := jsonb_build_object(
    'match_id', p_partido_id,
    'matchId', p_partido_id,
    'partido_id', p_partido_id,
    'matchName', COALESCE(p_match_name, ''),
    'kickedBy', p_kicked_by,
    'status', 'kicked',
    'kicked_at', v_kicked_at
  );

  INSERT INTO public.notifications (
    user_id,
    partido_id,
    type,
    title,
    message,
    read,
    status,
    data,
    send_at
  ) VALUES (
    p_user_id,
    p_partido_id,
    'match_kicked',
    'Expulsado del partido',
    format('Has sido expulsado del partido "%s"', v_match_name),
    false,
    'kicked',
    v_notification_data,
    v_kicked_at
  )
  ON CONFLICT (user_id, (data ->> 'match_id'), type)
  DO UPDATE SET
    partido_id = EXCLUDED.partido_id,
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    read = false,
    status = 'kicked',
    send_at = EXCLUDED.send_at,
    data = COALESCE(notifications.data, '{}'::jsonb) || EXCLUDED.data;

  RETURN jsonb_build_object('success', true, 'status', 'upserted');
END;
$$;

ALTER FUNCTION public.send_match_kicked_notification(uuid, bigint, text, uuid, timestamptz) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.send_match_kicked_notification(uuid, bigint, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_match_kicked_notification(uuid, bigint, text, uuid, timestamptz) TO authenticated;

COMMIT;
