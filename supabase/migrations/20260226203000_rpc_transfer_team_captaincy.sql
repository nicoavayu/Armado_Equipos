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

  UPDATE public.team_members tm
  SET is_captain = false
  WHERE tm.team_id = p_team_id
    AND tm.is_captain = true
    AND tm.id <> p_new_captain_member_id;

  UPDATE public.team_members tm
  SET is_captain = true
  WHERE tm.id = p_new_captain_member_id
    AND tm.team_id = p_team_id;

  RETURN p_new_captain_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_transfer_team_captaincy(uuid, uuid) TO authenticated, service_role;

COMMIT;
