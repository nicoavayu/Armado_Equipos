-- ============================================================================
-- Team match rosters RPC (both teams visible to involved members)
-- Date: 2026-02-23
-- Purpose:
--   - Allow any member of either team in a match to fetch both rosters
--   - Keep team_members RLS strict while exposing only match-scoped data
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_list_team_match_members(uuid);
CREATE OR REPLACE FUNCTION public.rpc_list_team_match_members(
  p_match_id uuid
)
RETURNS TABLE (
  team_id text,
  member_id text,
  jugador_id text,
  user_id uuid,
  permissions_role text,
  role text,
  is_captain boolean,
  shirt_number smallint,
  photo_url text,
  created_at timestamptz,
  jugador_usuario_id uuid,
  jugador_nombre text,
  jugador_avatar_url text,
  jugador_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team_a_id uuid;
  v_team_b_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT tm.team_a_id, tm.team_b_id
  INTO v_team_a_id, v_team_b_id
  FROM public.team_matches tm
  WHERE tm.id = p_match_id;

  IF v_team_a_id IS NULL OR v_team_b_id IS NULL THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF NOT (
    public.team_user_is_member(v_team_a_id, v_uid)
    OR public.team_user_is_member(v_team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'No tenes acceso a este partido';
  END IF;

  RETURN QUERY
  SELECT
    tm.team_id::text,
    tm.id::text,
    tm.jugador_id::text,
    COALESCE(tm.user_id, j.usuario_id) AS user_id,
    COALESCE(tm.permissions_role, 'member') AS permissions_role,
    tm.role,
    tm.is_captain,
    tm.shirt_number,
    tm.photo_url,
    tm.created_at,
    j.usuario_id,
    j.nombre,
    j.avatar_url,
    j.score::numeric
  FROM public.team_members tm
  LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
  WHERE tm.team_id IN (v_team_a_id, v_team_b_id)
  ORDER BY tm.team_id, tm.is_captain DESC, tm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_team_match_members(uuid) TO authenticated, service_role;

COMMIT;
