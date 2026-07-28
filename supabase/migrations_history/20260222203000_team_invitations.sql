BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  invited_by_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz NULL,
  CONSTRAINT team_invitations_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  CONSTRAINT team_invitations_distinct_users_check CHECK (invited_user_id <> invited_by_user_id),
  CONSTRAINT team_invitations_unique_team_user UNIQUE (team_id, invited_user_id)
);

ALTER TABLE public.team_invitations
  DROP CONSTRAINT IF EXISTS team_invitations_status_check;

ALTER TABLE public.team_invitations
  ADD CONSTRAINT team_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked'));

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permissions_role text NOT NULL DEFAULT 'member';

ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_permissions_role_check;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_permissions_role_check
  CHECK (permissions_role IN ('owner', 'admin', 'member'));

CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_user_uidx
  ON public.team_members(team_id, user_id)
  WHERE user_id IS NOT NULL;

UPDATE public.team_members tm
SET user_id = j.usuario_id
FROM public.jugadores j
WHERE j.id = tm.jugador_id
  AND tm.user_id IS NULL
  AND j.usuario_id IS NOT NULL;

UPDATE public.team_members tm
SET permissions_role = 'owner'
FROM public.teams t
WHERE t.id = tm.team_id
  AND tm.user_id = t.owner_user_id;

CREATE INDEX IF NOT EXISTS team_invitations_team_status_idx
  ON public.team_invitations(team_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS team_invitations_invited_user_status_idx
  ON public.team_invitations(invited_user_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_team_invitations_set_updated_at ON public.team_invitations;
CREATE TRIGGER trg_team_invitations_set_updated_at
BEFORE UPDATE ON public.team_invitations
FOR EACH ROW
EXECUTE FUNCTION public.set_teams_module_updated_at();

CREATE OR REPLACE FUNCTION public.team_user_is_member(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.team_user_is_owner(p_team_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.team_id = p_team_id
        AND tm.user_id = p_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND j.usuario_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.team_user_is_admin_or_owner(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.team_user_is_owner(p_team_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      WHERE tm.team_id = p_team_id
        AND tm.user_id = p_user_id
        AND tm.permissions_role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND j.usuario_id = p_user_id
        AND tm.permissions_role IN ('owner', 'admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.team_user_is_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_user_is_admin_or_owner(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_team_member_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_team_owner uuid;
  v_resolved_user_id uuid;
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

  IF TG_OP = 'INSERT' AND NEW.permissions_role IN ('owner', 'admin') THEN
    IF COALESCE(v_role, '') <> 'service_role' AND (v_uid IS NULL OR v_uid <> v_team_owner) THEN
      RAISE EXCEPTION 'Solo el owner puede asignar roles administrativos';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.permissions_role IS DISTINCT FROM OLD.permissions_role THEN
    IF COALESCE(v_role, '') <> 'service_role' AND (v_uid IS NULL OR v_uid <> v_team_owner) THEN
      RAISE EXCEPTION 'Solo el owner puede cambiar roles administrativos';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_members_enforce_permissions ON public.team_members;
CREATE TRIGGER trg_team_members_enforce_permissions
BEFORE INSERT OR UPDATE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_team_member_permissions();

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_invitations_select_related_users ON public.team_invitations;
CREATE POLICY team_invitations_select_related_users
ON public.team_invitations
FOR SELECT
TO authenticated
USING (
  invited_user_id = auth.uid()
  OR invited_by_user_id = auth.uid()
  OR public.team_user_is_admin_or_owner(team_id, auth.uid())
);

GRANT SELECT ON public.team_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invitations TO service_role;

DROP POLICY IF EXISTS teams_select_owner_and_open_feed ON public.teams;
CREATE POLICY teams_select_owner_and_open_feed
ON public.teams
FOR SELECT
TO authenticated
USING (
  owner_user_id = auth.uid()
  OR public.team_user_is_member(teams.id, auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.challenges c
    WHERE c.status = 'open'
      AND (c.challenger_team_id = teams.id OR c.accepted_team_id = teams.id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.challenges c
    WHERE (c.challenger_team_id = teams.id OR c.accepted_team_id = teams.id)
      AND (c.created_by_user_id = auth.uid() OR c.accepted_by_user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS teams_update_owner_only ON public.teams;
DROP POLICY IF EXISTS teams_update_owner_or_admin ON public.teams;
CREATE POLICY teams_update_owner_or_admin
ON public.teams
FOR UPDATE
TO authenticated
USING (public.team_user_is_admin_or_owner(teams.id, auth.uid()))
WITH CHECK (public.team_user_is_admin_or_owner(teams.id, auth.uid()));

DROP POLICY IF EXISTS team_members_select_owner_only ON public.team_members;
DROP POLICY IF EXISTS team_members_select_member_or_owner ON public.team_members;
CREATE POLICY team_members_select_member_or_owner
ON public.team_members
FOR SELECT
TO authenticated
USING (public.team_user_is_member(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_insert_owner_only ON public.team_members;
DROP POLICY IF EXISTS team_members_insert_owner_or_admin ON public.team_members;
CREATE POLICY team_members_insert_owner_or_admin
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (public.team_user_is_admin_or_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_update_owner_only ON public.team_members;
DROP POLICY IF EXISTS team_members_update_owner_or_admin ON public.team_members;
CREATE POLICY team_members_update_owner_or_admin
ON public.team_members
FOR UPDATE
TO authenticated
USING (public.team_user_is_admin_or_owner(team_id, auth.uid()))
WITH CHECK (public.team_user_is_admin_or_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_delete_owner_only ON public.team_members;
DROP POLICY IF EXISTS team_members_delete_owner_or_admin ON public.team_members;
CREATE POLICY team_members_delete_owner_or_admin
ON public.team_members
FOR DELETE
TO authenticated
USING (public.team_user_is_admin_or_owner(team_id, auth.uid()));

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
      COALESCE(v_inviter_name, 'Un jugador') || ' te invito al equipo ' || COALESCE(v_team.name, 'Equipo'),
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

CREATE OR REPLACE FUNCTION public.rpc_accept_team_invitation(
  p_invitation_id uuid
)
RETURNS public.team_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invitation public.team_invitations%ROWTYPE;
  v_jugador_id public.jugadores.id%TYPE;
  v_player_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_invitation
  FROM public.team_invitations ti
  WHERE ti.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitacion no encontrada';
  END IF;

  IF v_invitation.invited_user_id <> v_uid THEN
    RAISE EXCEPTION 'No podes aceptar una invitacion ajena';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'La invitacion ya fue respondida';
  END IF;

  SELECT j.id
  INTO v_jugador_id
  FROM public.jugadores j
  WHERE j.usuario_id = v_uid
  ORDER BY j.id DESC
  LIMIT 1;

  IF v_jugador_id IS NULL THEN
    SELECT NULLIF(TRIM(u.nombre), '')
    INTO v_player_name
    FROM public.usuarios u
    WHERE u.id = v_uid;

    IF v_player_name IS NULL THEN
      SELECT split_part(COALESCE(au.email, 'Jugador'), '@', 1)
      INTO v_player_name
      FROM auth.users au
      WHERE au.id = v_uid;
    END IF;

    INSERT INTO public.jugadores (
      nombre,
      usuario_id
    ) VALUES (
      COALESCE(v_player_name, 'Jugador'),
      v_uid
    )
    RETURNING id INTO v_jugador_id;
  END IF;

  INSERT INTO public.team_members (
    team_id,
    jugador_id,
    user_id,
    permissions_role,
    role,
    is_captain
  ) VALUES (
    v_invitation.team_id,
    v_jugador_id,
    v_uid,
    'member',
    'player',
    false
  )
  ON CONFLICT (team_id, jugador_id)
  DO UPDATE
  SET
    user_id = COALESCE(team_members.user_id, EXCLUDED.user_id),
    permissions_role = CASE
      WHEN team_members.permissions_role IN ('owner', 'admin') THEN team_members.permissions_role
      ELSE 'member'
    END;

  UPDATE public.team_invitations ti
  SET
    status = 'accepted',
    responded_at = now(),
    updated_at = now()
  WHERE ti.id = v_invitation.id
  RETURNING * INTO v_invitation;

  UPDATE public.notifications n
  SET
    read = true,
    data = jsonb_set(COALESCE(n.data, '{}'::jsonb), '{status}', '"accepted"'::jsonb, true)
  WHERE n.user_id = v_uid
    AND n.type = 'team_invite'
    AND COALESCE(n.data->>'invitation_id', '') = v_invitation.id::text;

  RETURN v_invitation;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_reject_team_invitation(
  p_invitation_id uuid
)
RETURNS public.team_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invitation public.team_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_invitation
  FROM public.team_invitations ti
  WHERE ti.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitacion no encontrada';
  END IF;

  IF v_invitation.invited_user_id <> v_uid THEN
    RAISE EXCEPTION 'No podes rechazar una invitacion ajena';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'La invitacion ya fue respondida';
  END IF;

  UPDATE public.team_invitations ti
  SET
    status = 'rejected',
    responded_at = now(),
    updated_at = now()
  WHERE ti.id = v_invitation.id
  RETURNING * INTO v_invitation;

  UPDATE public.notifications n
  SET
    read = true,
    data = jsonb_set(COALESCE(n.data, '{}'::jsonb), '{status}', '"rejected"'::jsonb, true)
  WHERE n.user_id = v_uid
    AND n.type = 'team_invite'
    AND COALESCE(n.data->>'invitation_id', '') = v_invitation.id::text;

  RETURN v_invitation;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_revoke_team_invitation(
  p_invitation_id uuid
)
RETURNS public.team_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invitation public.team_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_invitation
  FROM public.team_invitations ti
  WHERE ti.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitacion no encontrada';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Solo se pueden revocar invitaciones pendientes';
  END IF;

  IF NOT public.team_user_is_admin_or_owner(v_invitation.team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/admin puede revocar invitaciones';
  END IF;

  UPDATE public.team_invitations ti
  SET
    status = 'revoked',
    responded_at = now(),
    updated_at = now()
  WHERE ti.id = v_invitation.id
  RETURNING * INTO v_invitation;

  RETURN v_invitation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_send_team_invitation(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_accept_team_invitation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reject_team_invitation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_team_invitation(uuid) TO authenticated, service_role;

COMMIT;
