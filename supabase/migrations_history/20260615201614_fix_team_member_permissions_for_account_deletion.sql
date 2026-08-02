-- ============================================================================
-- Fix team_members permission trigger for account deletion
-- Date: 2026-06-15
--
-- The previous trigger treated teams.owner_user_id IS NULL as "team not found".
-- Account deletion intentionally orphans teams by setting owner_user_id to NULL,
-- then detaches team_members.user_id. On orphaned teams, that UPDATE raised
-- "Equipo no encontrado para team_member" and blocked delete-account.
--
-- This version checks team existence separately from ownership and lets the
-- delete-account / FK SET NULL path keep NEW.user_id as NULL instead of
-- backfilling it from jugador_id. Normal insert/update role validations remain.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_team_member_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_team_owner uuid;
  v_team_exists boolean := false;
  v_resolved_user_id uuid;
  v_can_manage_roles boolean := false;
BEGIN
  SELECT true, t.owner_user_id
  INTO v_team_exists, v_team_owner
  FROM public.teams t
  WHERE t.id = NEW.team_id;

  IF NOT COALESCE(v_team_exists, false) THEN
    RAISE EXCEPTION 'Equipo no encontrado para team_member';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.user_id IS NOT NULL
    AND NEW.user_id IS NULL
    AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
    AND NEW.jugador_id IS NOT DISTINCT FROM OLD.jugador_id
    AND NEW.permissions_role IS NOT DISTINCT FROM OLD.permissions_role THEN
    RETURN NEW;
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

  IF NEW.permissions_role = 'owner'
    AND (
      v_resolved_user_id IS DISTINCT FROM v_team_owner
      OR (
        v_team_owner IS NULL
        AND NOT (
          TG_OP = 'UPDATE'
          AND OLD.permissions_role = 'owner'
          AND NEW.permissions_role = OLD.permissions_role
          AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
        )
      )
    ) THEN
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

COMMIT;
