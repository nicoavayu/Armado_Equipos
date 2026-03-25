BEGIN;

CREATE OR REPLACE FUNCTION public.leave_owned_match_with_transfer(
  p_partido_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_current_admin_id uuid;
  v_match_name text;
  v_owner_name text;
  v_new_admin_id uuid;
  v_new_admin_name text;
  v_removed_count integer := 0;
  v_new_admin_notify_result jsonb := '{}'::jsonb;
  v_rest_notify_result jsonb := '{}'::jsonb;
BEGIN
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.creado_por, COALESCE(NULLIF(trim(COALESCE(p.nombre, '')), ''), 'PARTIDO')
  INTO v_current_admin_id, v_match_name
  FROM public.partidos p
  WHERE p.id = p_partido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  IF v_current_admin_id IS DISTINCT FROM v_owner_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_match_admin');
  END IF;

  IF to_regclass('public.device_tokens') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'mode', 'cancel_required',
      'reason', 'device_tokens_unavailable'
    );
  END IF;

  SELECT COALESCE(NULLIF(trim(COALESCE(u.nombre, '')), ''), 'El admin')
  INTO v_owner_name
  FROM public.usuarios u
  WHERE u.id = v_owner_id;

  v_owner_name := COALESCE(v_owner_name, 'El admin');

  SELECT candidate.usuario_id, candidate.nombre
  INTO v_new_admin_id, v_new_admin_name
  FROM (
    SELECT
      j.usuario_id,
      COALESCE(
        NULLIF(trim(COALESCE(j.nombre, '')), ''),
        NULLIF(trim(COALESCE(u.nombre, '')), ''),
        'Un jugador'
      ) AS nombre,
      MAX(dt.last_seen_at) AS last_seen_at,
      MIN(j.id) AS first_player_row_id
    FROM public.jugadores j
    LEFT JOIN public.usuarios u
      ON u.id = j.usuario_id
    INNER JOIN public.device_tokens dt
      ON dt.user_id = j.usuario_id
     AND dt.is_active = true
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
      AND j.usuario_id <> v_owner_id
    GROUP BY
      j.usuario_id,
      COALESCE(
        NULLIF(trim(COALESCE(j.nombre, '')), ''),
        NULLIF(trim(COALESCE(u.nombre, '')), ''),
        'Un jugador'
      )
  ) AS candidate
  ORDER BY candidate.last_seen_at DESC NULLS LAST, candidate.first_player_row_id ASC
  LIMIT 1;

  IF v_new_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'mode', 'cancel_required',
      'reason', 'no_logged_in_replacement'
    );
  END IF;

  UPDATE public.partidos
  SET creado_por = v_new_admin_id
  WHERE id = p_partido_id;

  DELETE FROM public.jugadores
  WHERE partido_id = p_partido_id
    AND usuario_id = v_owner_id;

  GET DIAGNOSTICS v_removed_count = ROW_COUNT;

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
    v_new_admin_id,
    p_partido_id,
    'admin_transfer',
    'Ahora administras el partido',
    format('Ahora administrás el partido "%s".', v_match_name),
    jsonb_build_object(
      'match_id', p_partido_id,
      'matchId', p_partido_id,
      'match_name', v_match_name,
      'new_admin_id', v_new_admin_id,
      'new_admin_name', v_new_admin_name,
      'previous_admin_id', v_owner_id,
      'previous_admin_name', v_owner_name,
      'link', format('/admin/%s', p_partido_id)
    ),
    false,
    now(),
    now()
  )
  ON CONFLICT DO NOTHING;

  v_new_admin_notify_result := public.enqueue_partido_notification(
    p_partido_id,
    'match_update',
    'Ahora administras el partido',
    format('Ahora administrás el partido "%s".', v_match_name),
    jsonb_build_object(
      'match_id', p_partido_id,
      'matchId', p_partido_id,
      'match_name', v_match_name,
      'player_name', v_owner_name,
      'player_user_id', v_owner_id,
      'left_via', 'admin_transfer',
      'new_admin_id', v_new_admin_id,
      'new_admin_name', v_new_admin_name,
      'link', format('/admin/%s', p_partido_id)
    )
  );

  v_rest_notify_result := public.enqueue_match_participant_notification(
    p_partido_id,
    'match_update',
    'El admin dejó el partido',
    format('%s abandonó el partido. %s ahora administra el partido.', v_owner_name, v_new_admin_name),
    jsonb_build_object(
      'match_id', p_partido_id,
      'matchId', p_partido_id,
      'match_name', v_match_name,
      'player_name', v_owner_name,
      'player_user_id', v_owner_id,
      'left_via', 'admin_transfer',
      'new_admin_id', v_new_admin_id,
      'new_admin_name', v_new_admin_name,
      'link', format('/admin/%s', p_partido_id)
    ),
    v_new_admin_id,
    false
  );

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'transferred',
    'match_id', p_partido_id,
    'match_name', v_match_name,
    'new_admin_user_id', v_new_admin_id,
    'new_admin_name', v_new_admin_name,
    'removed_player', v_removed_count > 0,
    'new_admin_notify_result', COALESCE(v_new_admin_notify_result, '{}'::jsonb),
    'rest_notify_result', COALESCE(v_rest_notify_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_owned_match_with_transfer(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_owned_match_with_transfer(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_owned_match_with_transfer(bigint) TO service_role;

COMMIT;
