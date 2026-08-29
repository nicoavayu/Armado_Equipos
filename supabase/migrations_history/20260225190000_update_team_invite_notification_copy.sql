CREATE OR REPLACE FUNCTION public.rpc_send_team_invitation(
  p_team_id uuid,
  p_invited_user_id uuid
)
RETURNS public.team_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team public.teams%ROWTYPE;
  v_invitation public.team_invitations%ROWTYPE;
  v_inviter_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_team_id IS NULL OR p_invited_user_id IS NULL THEN
    RAISE EXCEPTION 'Faltan datos para enviar la invitacion';
  END IF;

  IF p_invited_user_id = v_uid THEN
    RAISE EXCEPTION 'No podes invitarte a vos mismo';
  END IF;

  SELECT *
  INTO v_team
  FROM public.teams t
  WHERE t.id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Equipo no encontrado';
  END IF;

  IF NOT public.team_user_is_admin_or_owner(p_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/admin puede invitar jugadores';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = p_invited_user_id
  ) THEN
    RAISE EXCEPTION 'Usuario invitado no encontrado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.jugadores j ON j.id = tm.jugador_id
    WHERE tm.team_id = p_team_id
      AND j.usuario_id = p_invited_user_id
  ) THEN
    RAISE EXCEPTION 'Ese usuario ya forma parte del equipo';
  END IF;

  SELECT *
  INTO v_invitation
  FROM public.team_invitations ti
  WHERE ti.team_id = p_team_id
    AND ti.invited_user_id = p_invited_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_invitation.status = 'accepted' THEN
      RAISE EXCEPTION 'Ese usuario ya forma parte del equipo';
    END IF;

    UPDATE public.team_invitations ti
    SET
      invited_by_user_id = v_uid,
      status = 'pending',
      created_at = now(),
      updated_at = now(),
      responded_at = NULL
    WHERE ti.id = v_invitation.id
    RETURNING * INTO v_invitation;
  ELSE
    INSERT INTO public.team_invitations (
      team_id,
      invited_user_id,
      invited_by_user_id,
      status
    ) VALUES (
      p_team_id,
      p_invited_user_id,
      v_uid,
      'pending'
    )
    RETURNING * INTO v_invitation;
  END IF;

  BEGIN
    SELECT NULLIF(TRIM(u.nombre), '')
    INTO v_inviter_name
    FROM public.usuarios u
    WHERE u.id = v_uid;

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
      p_invited_user_id,
      'team_invite',
      'Invitacion de equipo',
      COALESCE(v_inviter_name, 'Un jugador') || ' te invito a unirte a "' || COALESCE(v_team.name, 'Equipo') || '"',
      jsonb_build_object(
        'team_id', v_team.id,
        'team_name', v_team.name,
        'invitation_id', v_invitation.id,
        'status', 'pending'
      ),
      false,
      now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN v_invitation;
END;
$$;
