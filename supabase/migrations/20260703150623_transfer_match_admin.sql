BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_match_admin(
  p_partido_id bigint,
  p_new_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_current_admin_id uuid;
  v_match_name text;
  v_new_admin_name text;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF p_partido_id IS NULL OR p_new_admin_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'target_not_eligible');
  END IF;

  SELECT
    p.creado_por,
    COALESCE(NULLIF(trim(COALESCE(p.nombre, '')), ''), 'PARTIDO')
  INTO
    v_current_admin_id,
    v_match_name
  FROM public.partidos p
  WHERE p.id = p_partido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  IF v_current_admin_id IS DISTINCT FROM v_actor_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_match_admin');
  END IF;

  IF p_new_admin_user_id = v_current_admin_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_match_admin');
  END IF;

  SELECT COALESCE(
    NULLIF(trim(COALESCE(j.nombre, '')), ''),
    NULLIF(trim(COALESCE(u.nombre, '')), ''),
    'El jugador'
  )
  INTO v_new_admin_name
  FROM public.jugadores j
  LEFT JOIN public.usuarios u
    ON u.id = j.usuario_id
  WHERE j.partido_id = p_partido_id
    AND j.usuario_id = p_new_admin_user_id
  ORDER BY j.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'target_not_eligible');
  END IF;

  UPDATE public.partidos
  SET creado_por = p_new_admin_user_id
  WHERE id = p_partido_id;

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
    p_new_admin_user_id,
    p_partido_id,
    'admin_transfer',
    'Ahora administras el partido',
    format('Ahora administrás el partido "%s".', v_match_name),
    jsonb_build_object(
      'match_id', p_partido_id,
      'matchId', p_partido_id,
      'match_name', v_match_name,
      'new_admin_id', p_new_admin_user_id,
      'new_admin_name', v_new_admin_name,
      'previous_admin_id', v_actor_id,
      'link', format('/admin/%s', p_partido_id)
    ),
    false,
    now(),
    now()
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_partido_id,
    'previous_admin_user_id', v_actor_id,
    'new_admin_user_id', p_new_admin_user_id,
    'new_admin_name', v_new_admin_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_match_admin(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_match_admin(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_match_admin(bigint, uuid) TO service_role;

COMMIT;
