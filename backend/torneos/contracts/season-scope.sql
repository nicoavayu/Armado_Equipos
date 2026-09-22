-- Phase 2B: season seat model helper for internal "_as" authorization helpers that receive
-- the actor explicitly. Same rule as public.has_tournament_season_access: owners always
-- pass; admins/collaborators need an assignment to that season. Owner-only execution.
CREATE FUNCTION private.has_tournament_season_access_as(p_organization_id uuid, p_season_id uuid, p_actor_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT p_actor_user_id IS NOT NULL AND EXISTS (
  SELECT 1
  FROM public.tournament_organization_members membership
  JOIN public.tournament_organizations organization ON organization.id = membership.organization_id
  WHERE membership.organization_id = p_organization_id
   AND membership.user_id = p_actor_user_id
   AND membership.status = 'active'
   AND organization.status = 'active'
   AND (
    membership.role = 'owner'
    OR EXISTS (
     SELECT 1 FROM public.tournament_season_member_assignments assignment
     WHERE assignment.organization_id = p_organization_id
      AND assignment.season_id = p_season_id
      AND assignment.membership_id = membership.id
    )
   )
 );
$$;
REVOKE ALL ON FUNCTION private.has_tournament_season_access_as(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role, torneos_core_adapter;
