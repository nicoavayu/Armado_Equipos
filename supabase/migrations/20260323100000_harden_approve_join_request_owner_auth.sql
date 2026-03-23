BEGIN;

CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_match_id bigint;
  v_user_id uuid;
  v_status text;
  v_nombre text;
  v_avatar_url text;
  v_exists boolean;
  v_match_admin_id uuid;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    r.match_id,
    r.user_id,
    r.status,
    p.creado_por
  INTO
    v_match_id,
    v_user_id,
    v_status,
    v_match_admin_id
  FROM public.match_join_requests r
  JOIN public.partidos p
    ON p.id = r.match_id
  WHERE r.id = p_request_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;

  IF v_match_admin_id IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.partido_id = v_match_id
      AND j.usuario_id = v_user_id
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'El jugador ya está en el partido';
  END IF;

  IF v_status <> 'approved' THEN
    UPDATE public.match_join_requests
    SET status = 'approved',
        decided_at = now(),
        decided_by = v_actor_user_id
    WHERE id = p_request_id;
  END IF;

  SELECT
    COALESCE(u.nombre, p.nombre, 'Jugador'),
    COALESCE(u.avatar_url, p.avatar_url)
  INTO v_nombre, v_avatar_url
  FROM public.usuarios u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user_id;

  INSERT INTO public.jugadores (
    partido_id,
    usuario_id,
    nombre,
    avatar_url,
    score,
    is_goalkeeper
  ) VALUES (
    v_match_id,
    v_user_id,
    v_nombre,
    v_avatar_url,
    5,
    false
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', v_match_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_join_request(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_join_request(bigint) TO authenticated;

COMMIT;
