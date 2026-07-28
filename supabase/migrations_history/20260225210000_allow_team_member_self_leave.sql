-- Allow authenticated members to leave a team by deleting their own membership row.
-- Admin/owner delete capability remains unchanged.

DROP POLICY IF EXISTS team_members_delete_owner_or_admin ON public.team_members;
DROP POLICY IF EXISTS team_members_delete_owner_only ON public.team_members;

CREATE POLICY team_members_delete_owner_or_admin
ON public.team_members
FOR DELETE
TO authenticated
USING (
  public.team_user_is_admin_or_owner(team_id, auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.id = team_members.jugador_id
      AND j.usuario_id = auth.uid()
  )
);
