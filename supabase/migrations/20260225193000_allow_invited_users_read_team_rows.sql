-- Allow invited users to resolve team name/crest while invitation is pending.
-- This keeps team cards in "Mis equipos" from falling back to "Equipo".

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
  OR EXISTS (
    SELECT 1
    FROM public.team_invitations ti
    WHERE ti.team_id = teams.id
      AND ti.invited_user_id = auth.uid()
      AND ti.status = 'pending'
  )
);
