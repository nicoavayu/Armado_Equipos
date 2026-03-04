BEGIN;

-- Align challenge updates with team admin permissions used across the app.
-- This allows owner/admin/captain users to update challenges for involved teams.
DROP POLICY IF EXISTS challenges_update_owner_or_captain_involved ON public.challenges;
CREATE POLICY challenges_update_owner_or_captain_involved
ON public.challenges
FOR UPDATE
TO authenticated
USING (
  public.team_user_is_admin_or_owner(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_admin_or_owner(accepted_team_id, auth.uid())
  )
)
WITH CHECK (
  public.team_user_is_admin_or_owner(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_admin_or_owner(accepted_team_id, auth.uid())
  )
);

COMMIT;
