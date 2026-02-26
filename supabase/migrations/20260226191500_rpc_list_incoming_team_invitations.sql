BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_list_incoming_team_invitations(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  team_id uuid,
  invited_user_id uuid,
  invited_by_user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  responded_at timestamptz,
  team_name text,
  team_crest_url text,
  invited_by_name text,
  invited_by_avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_user_id IS NULL THEN
    p_user_id := v_uid;
  END IF;

  IF p_user_id <> v_uid THEN
    RAISE EXCEPTION 'No podes consultar invitaciones de otro usuario';
  END IF;

  RETURN QUERY
  SELECT
    ti.id,
    ti.team_id,
    ti.invited_user_id,
    ti.invited_by_user_id,
    ti.status,
    ti.created_at,
    ti.updated_at,
    ti.responded_at,
    t.name AS team_name,
    t.crest_url AS team_crest_url,
    COALESCE(
      NULLIF(TRIM(u.nombre), ''),
      NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''),
      'Un capitan'
    ) AS invited_by_name,
    u.avatar_url AS invited_by_avatar_url
  FROM public.team_invitations ti
  LEFT JOIN public.teams t ON t.id = ti.team_id
  LEFT JOIN public.usuarios u ON u.id = ti.invited_by_user_id
  LEFT JOIN auth.users au ON au.id = ti.invited_by_user_id
  WHERE ti.invited_user_id = p_user_id
    AND ti.status = 'pending'
  ORDER BY ti.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_incoming_team_invitations(uuid) TO authenticated, service_role;

COMMIT;
