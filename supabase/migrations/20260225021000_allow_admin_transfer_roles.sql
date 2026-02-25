-- Allow team admins (not only owners) to manage admin/member role assignments.
-- Owner role remains reserved to the real team owner (owner_user_id).

CREATE OR REPLACE FUNCTION public.enforce_team_member_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_team_owner uuid;
  v_resolved_user_id uuid;
  v_can_manage_roles boolean := false;
BEGIN
  SELECT t.owner_user_id
  INTO v_team_owner
  FROM public.teams t
  WHERE t.id = NEW.team_id;

  IF v_team_owner IS NULL THEN
    RAISE EXCEPTION 'Equipo no encontrado para team_member';
  END IF;

  IF NEW.user_id IS NULL THEN
    SELECT j.usuario_id INTO NEW.user_id
    FROM public.jugadores j
    WHERE j.id = NEW.jugador_id;
  END IF;

  v_resolved_user_id := NEW.user_id;

  IF NEW.permissions_role IS NULL THEN
    NEW.permissions_role := 'member';
  END IF;

  IF NEW.permissions_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'permissions_role invalido';
  END IF;

  IF NEW.permissions_role = 'owner' AND v_resolved_user_id IS DISTINCT FROM v_team_owner THEN
    RAISE EXCEPTION 'Solo el owner real del equipo puede tener permissions_role owner';
  END IF;

  v_can_manage_roles := COALESCE(v_role, '') = 'service_role'
    OR (
      v_uid IS NOT NULL
      AND public.team_user_is_admin_or_owner(NEW.team_id, v_uid)
    );

  IF TG_OP = 'INSERT' AND NEW.permissions_role IN ('owner', 'admin') THEN
    IF NOT v_can_manage_roles THEN
      RAISE EXCEPTION 'Solo admin puede asignar roles administrativos';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.permissions_role IS DISTINCT FROM OLD.permissions_role THEN
    IF NOT v_can_manage_roles THEN
      RAISE EXCEPTION 'Solo admin puede cambiar roles administrativos';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
