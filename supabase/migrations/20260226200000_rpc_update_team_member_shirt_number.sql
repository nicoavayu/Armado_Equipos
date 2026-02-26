BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_update_team_member_shirt_number(
  p_member_id uuid,
  p_shirt_number smallint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'Miembro invalido';
  END IF;

  IF p_shirt_number IS NOT NULL AND (p_shirt_number < 1 OR p_shirt_number > 99) THEN
    RAISE EXCEPTION 'El numero debe estar entre 1 y 99';
  END IF;

  SELECT tm.id
  INTO v_member_id
  FROM public.team_members tm
  LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
  WHERE tm.id = p_member_id
    AND (
      public.team_user_is_admin_or_owner(tm.team_id, v_uid)
      OR tm.user_id = v_uid
      OR j.usuario_id = v_uid
    )
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'No tenes permisos para actualizar este jugador';
  END IF;

  UPDATE public.team_members
  SET shirt_number = p_shirt_number
  WHERE id = v_member_id;

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_team_member_shirt_number(uuid, smallint) TO authenticated, service_role;

COMMIT;
