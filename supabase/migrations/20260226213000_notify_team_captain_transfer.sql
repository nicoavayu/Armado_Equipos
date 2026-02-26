BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_transfer_team_captaincy(
  p_team_id uuid,
  p_new_captain_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_member public.team_members%ROWTYPE;
  v_is_authorized boolean := false;
  v_new_member_has_account boolean := false;
  v_new_captain_user_id uuid;
  v_team_name text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_team_id IS NULL OR p_new_captain_member_id IS NULL THEN
    RAISE EXCEPTION 'Parametros invalidos';
  END IF;

  SELECT *
  INTO v_new_member
  FROM public.team_members tm
  WHERE tm.id = p_new_captain_member_id
    AND tm.team_id = p_team_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jugador no encontrado en este equipo';
  END IF;

  SELECT (
    v_new_member.user_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.jugadores j
      WHERE j.id = v_new_member.jugador_id
        AND j.usuario_id IS NOT NULL
    )
  )
  INTO v_new_member_has_account;

  IF NOT v_new_member_has_account THEN
    RAISE EXCEPTION 'Solo jugadores registrados pueden ser capitan';
  END IF;

  SELECT (
    public.team_user_is_admin_or_owner(p_team_id, v_uid)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND tm.is_captain = true
        AND (tm.user_id = v_uid OR j.usuario_id = v_uid)
    )
  )
  INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Solo el capitan actual o admin puede transferir la capitania';
  END IF;

  SELECT t.name
  INTO v_team_name
  FROM public.teams t
  WHERE t.id = p_team_id
  LIMIT 1;

  SELECT COALESCE(v_new_member.user_id, j.usuario_id)
  INTO v_new_captain_user_id
  FROM public.jugadores j
  WHERE j.id = v_new_member.jugador_id
  LIMIT 1;

  IF v_new_captain_user_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el usuario del nuevo capitan';
  END IF;

  SELECT NULLIF(TRIM(u.nombre), '')
  INTO v_actor_name
  FROM public.usuarios u
  WHERE u.id = v_uid
  LIMIT 1;

  IF v_actor_name IS NULL THEN
    SELECT NULLIF(split_part(COALESCE(au.email, ''), '@', 1), '')
    INTO v_actor_name
    FROM auth.users au
    WHERE au.id = v_uid
    LIMIT 1;
  END IF;

  v_actor_name := COALESCE(v_actor_name, 'Un capitan');

  UPDATE public.team_members tm
  SET is_captain = false
  WHERE tm.team_id = p_team_id
    AND tm.is_captain = true
    AND tm.id <> p_new_captain_member_id;

  UPDATE public.team_members tm
  SET is_captain = true
  WHERE tm.id = p_new_captain_member_id
    AND tm.team_id = p_team_id;

  BEGIN
    IF v_new_captain_user_id <> v_uid THEN
      INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        data,
        read,
        created_at
      )
      VALUES (
        v_new_captain_user_id,
        'team_captain_transfer',
        'Ahora sos capitan de "' || COALESCE(v_team_name, 'Equipo') || '"',
        v_actor_name || ' te transfirio la capitania del equipo "' || COALESCE(v_team_name, 'Equipo') || '"',
        jsonb_build_object(
          'team_id', p_team_id,
          'team_name', COALESCE(v_team_name, 'Equipo'),
          'transferred_by_user_id', v_uid,
          'transferred_by_name', v_actor_name
        ),
        false,
        now()
      );
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN p_new_captain_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_transfer_team_captaincy(uuid, uuid) TO authenticated, service_role;

COMMIT;
