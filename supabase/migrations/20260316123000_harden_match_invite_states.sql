BEGIN;

DROP FUNCTION IF EXISTS public.send_match_invite(uuid, bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.send_match_invite(
  p_user_id uuid,
  p_partido_id bigint,
  p_title text,
  p_message text,
  p_invite_mode text DEFAULT 'direct'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text := 'Alguien';
  v_match_admin_id uuid;
  v_match_code text;
  v_match_name text;
  v_actor_in_match boolean := false;
  v_target_in_match boolean := false;
  v_invitations_open boolean := false;
  v_recipient_accepts boolean := true;
  v_invite_mode text := lower(trim(coalesce(p_invite_mode, 'direct')));
  v_link text;
  v_existing_invite_id public.notifications.id%TYPE;
  v_existing_invite_data jsonb := '{}'::jsonb;
  v_existing_invite_status text;
  v_existing_invite_ts timestamptz;
  v_latest_kick_ts timestamptz;
  v_resolved_title text;
  v_resolved_message text;
  v_notification_data jsonb;
  v_had_history boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_user_id IS NULL OR p_partido_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_arguments';
  END IF;

  IF v_invite_mode NOT IN ('direct', 'request_join') THEN
    RAISE EXCEPTION 'invalid_invite_mode';
  END IF;

  SELECT
    p.creado_por,
    p.codigo,
    p.nombre,
    COALESCE(
      (NULLIF(to_jsonb(p) ->> 'invitations_open', ''))::boolean,
      (NULLIF(to_jsonb(p) ->> 'falta_jugadores', ''))::boolean,
      (NULLIF(to_jsonb(p) ->> 'faltan_jugadores', ''))::boolean,
      false
    )
  INTO v_match_admin_id, v_match_code, v_match_name, v_invitations_open
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'cannot_invite_self';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id = v_actor_id
  )
  INTO v_actor_in_match;

  IF v_actor_id <> v_match_admin_id THEN
    IF NOT v_actor_in_match THEN
      RAISE EXCEPTION 'actor_not_in_match';
    END IF;

    IF NOT v_invitations_open THEN
      RAISE EXCEPTION 'invitations_closed';
    END IF;

    IF v_invite_mode <> 'request_join' THEN
      RAISE EXCEPTION 'guest_direct_invite_forbidden';
    END IF;
  END IF;

  SELECT COALESCE(u.nombre, 'Alguien')
  INTO v_actor_name
  FROM public.usuarios u
  WHERE u.id = v_actor_id;

  SELECT COALESCE(u.acepta_invitaciones, true)
  INTO v_recipient_accepts
  FROM public.usuarios u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipient_not_found';
  END IF;

  IF NOT v_recipient_accepts THEN
    RETURN jsonb_build_object('status', 'recipient_unavailable');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id = p_user_id
  )
  INTO v_target_in_match;

  IF v_target_in_match THEN
    RETURN jsonb_build_object('status', 'already_in_match');
  END IF;

  SELECT
    n.id,
    COALESCE(n.data, '{}'::jsonb),
    COALESCE(NULLIF(lower(trim(n.data ->> 'status')), ''), 'pending'),
    COALESCE(n.send_at, n.created_at, now())
  INTO
    v_existing_invite_id,
    v_existing_invite_data,
    v_existing_invite_status,
    v_existing_invite_ts
  FROM public.notifications n
  WHERE n.user_id = p_user_id
    AND n.type = 'match_invite'
    AND (
      n.partido_id = p_partido_id
      OR n.data ->> 'match_id' = p_partido_id::text
      OR n.data ->> 'matchId' = p_partido_id::text
      OR n.data ->> 'partido_id' = p_partido_id::text
      OR n.data ->> 'partidoId' = p_partido_id::text
    )
  ORDER BY COALESCE(n.send_at, n.created_at, now()) DESC, n.id DESC
  LIMIT 1;

  SELECT COALESCE(n.send_at, n.created_at, now())
  INTO v_latest_kick_ts
  FROM public.notifications n
  WHERE n.user_id = p_user_id
    AND n.type = 'match_kicked'
    AND (
      n.partido_id = p_partido_id
      OR n.data ->> 'match_id' = p_partido_id::text
      OR n.data ->> 'matchId' = p_partido_id::text
      OR n.data ->> 'partido_id' = p_partido_id::text
      OR n.data ->> 'partidoId' = p_partido_id::text
    )
  ORDER BY COALESCE(n.send_at, n.created_at, now()) DESC, n.id DESC
  LIMIT 1;

  v_had_history := v_existing_invite_id IS NOT NULL OR v_latest_kick_ts IS NOT NULL;

  IF v_existing_invite_id IS NOT NULL
    AND v_existing_invite_status = 'pending'
    AND (v_latest_kick_ts IS NULL OR v_existing_invite_ts > v_latest_kick_ts) THEN
    RETURN jsonb_build_object('status', 'already_pending');
  END IF;

  v_link := CASE
    WHEN v_invite_mode = 'request_join' THEN format('/partido-publico/%s', p_partido_id)
    WHEN coalesce(v_match_code, '') <> '' THEN format('/partido/%s/invitacion?codigo=%s', p_partido_id, v_match_code)
    ELSE format('/partido/%s/invitacion', p_partido_id)
  END;

  v_resolved_title := coalesce(
    p_title,
    CASE
      WHEN v_invite_mode = 'request_join' THEN 'Partido sugerido'
      ELSE 'Invitación a partido'
    END
  );

  v_resolved_message := coalesce(
    p_message,
    CASE
      WHEN v_invite_mode = 'request_join' THEN format('%s te sugirió un partido para que solicites unirte.', v_actor_name)
      ELSE format('%s te invitó a jugar.', v_actor_name)
    END
  );

  v_notification_data := jsonb_build_object(
    'action', CASE WHEN v_invite_mode = 'request_join' THEN 'request_join' ELSE 'open_match' END,
    'match_id', p_partido_id,
    'matchId', p_partido_id,
    'partido_id', p_partido_id,
    'codigo', v_match_code,
    'code', v_match_code,
    'matchCode', v_match_code,
    'invite_mode', v_invite_mode,
    'inviter_id', v_actor_id,
    'inviter_name', v_actor_name,
    'matchName', coalesce(v_match_name, ''),
    'status', 'pending',
    'link', v_link
  );

  IF v_existing_invite_id IS NOT NULL THEN
    UPDATE public.notifications
    SET
      partido_id = p_partido_id,
      title = v_resolved_title,
      message = v_resolved_message,
      read = false,
      status = 'pending',
      send_at = now(),
      data = coalesce(v_existing_invite_data, '{}'::jsonb) || v_notification_data
    WHERE id = v_existing_invite_id;

    RETURN jsonb_build_object('status', 'reinvited');
  END IF;

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
    'match_invite',
    v_resolved_title,
    v_resolved_message,
    false,
    'pending',
    v_notification_data,
    now()
  )
  ON CONFLICT (user_id, (data ->> 'match_id'), type)
  DO UPDATE SET
    partido_id = EXCLUDED.partido_id,
    read = false,
    status = 'pending',
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    send_at = now(),
    data = COALESCE(notifications.data, '{}'::jsonb) || EXCLUDED.data;

  RETURN jsonb_build_object(
    'status',
    CASE WHEN v_had_history THEN 'reinvited' ELSE 'sent' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) TO authenticated;

COMMIT;
