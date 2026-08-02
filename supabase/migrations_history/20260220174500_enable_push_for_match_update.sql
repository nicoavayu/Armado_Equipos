-- In-app fanout helper for match participant updates.
-- Goal:
--   - Notify all logged users in a match (and optionally admin) in-app.
--   - Keep push policy independent (no forced push fanout here).

BEGIN;

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

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recipients_count', v_count,
    'recipients', COALESCE(v_recipients, ARRAY[]::uuid[])
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) TO authenticated;

COMMIT;
