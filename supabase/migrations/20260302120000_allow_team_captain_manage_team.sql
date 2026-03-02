BEGIN;

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
        AND (
          tm.permissions_role IN ('owner', 'admin')
          OR COALESCE((to_jsonb(tm)->>'is_captain')::boolean, false) = true
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND j.usuario_id = p_user_id
        AND (
          tm.permissions_role IN ('owner', 'admin')
          OR COALESCE((to_jsonb(tm)->>'is_captain')::boolean, false) = true
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.team_user_is_admin_or_owner(uuid, uuid) TO authenticated, service_role;

COMMIT;
