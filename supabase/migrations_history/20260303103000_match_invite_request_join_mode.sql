BEGIN;

DROP FUNCTION IF EXISTS public.send_match_invite(uuid, bigint, text, text);

CREATE OR REPLACE FUNCTION public.send_match_invite(
  p_user_id uuid,
  p_partido_id bigint,
  p_title text,
  p_message text,
  p_invite_mode text DEFAULT 'direct'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text := 'Alguien';
  v_match_admin_id uuid;
  v_match_code text;
  v_actor_in_match boolean := false;
  v_invitations_open boolean := false;
  v_invite_mode text := lower(trim(coalesce(p_invite_mode, 'direct')));
  v_link text;
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
    COALESCE(
      (NULLIF(to_jsonb(p) ->> 'invitations_open', ''))::boolean,
      (NULLIF(to_jsonb(p) ->> 'falta_jugadores', ''))::boolean,
      (NULLIF(to_jsonb(p) ->> 'faltan_jugadores', ''))::boolean,
      false
    )
  INTO v_match_admin_id, v_match_code, v_invitations_open
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
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

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'cannot_invite_self';
  END IF;

  SELECT COALESCE(u.nombre, 'Alguien')
  INTO v_actor_name
  FROM public.usuarios u
  WHERE u.id = v_actor_id;

  v_link := CASE
    WHEN v_invite_mode = 'request_join' THEN format('/partido-publico/%s', p_partido_id)
    WHEN coalesce(v_match_code, '') <> '' THEN format('/partido/%s/invitacion?codigo=%s', p_partido_id, v_match_code)
    ELSE format('/partido/%s/invitacion', p_partido_id)
  END;

  INSERT INTO public.notifications (
    user_id,
    partido_id,
    type,
    title,
    message,
    read,
    data,
    send_at
  ) VALUES (
    p_user_id,
    p_partido_id,
    'match_invite',
    coalesce(p_title, CASE WHEN v_invite_mode = 'request_join' THEN 'Partido sugerido' ELSE 'Invitación a partido' END),
    coalesce(p_message, CASE WHEN v_invite_mode = 'request_join' THEN format('%s te sugirió un partido para que solicites unirte.', v_actor_name) ELSE format('%s te invitó a jugar.', v_actor_name) END),
    false,
    jsonb_build_object(
      'action', CASE WHEN v_invite_mode = 'request_join' THEN 'request_join' ELSE 'open_match' END,
      'match_id', p_partido_id,
      'matchId', p_partido_id,
      'partido_id', p_partido_id,
      'invite_mode', v_invite_mode,
      'inviter_id', v_actor_id,
      'inviter_name', v_actor_name,
      'status', 'pending',
      'link', v_link
    ),
    now()
  )
  ON CONFLICT (user_id, (data ->> 'match_id'), type)
  DO UPDATE SET
    read = false,
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    send_at = now(),
    data = EXCLUDED.data;
END;
$$;

REVOKE ALL ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) TO authenticated;

COMMIT;
