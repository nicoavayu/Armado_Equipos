-- ============================================================================
-- Team match detail edits by match members + format support
-- Date: 2026-02-23
-- Purpose:
--   - Allow any member of either team in a match to edit scheduling details
--   - Add optional format update in rpc_update_team_match_details
--   - Keep challenge format immutable after creation
--   - Re-publish roster RPC to ensure both-team roster visibility by match scope
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text, smallint);
DROP FUNCTION IF EXISTS public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text);
CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_location text,
  p_cancha_cost numeric,
  p_mode text,
  p_format smallint DEFAULT NULL
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_next_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF NOT (
    public.team_user_is_member(v_match.team_a_id, v_uid)
    OR public.team_user_is_member(v_match.team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Solo miembros de los equipos pueden editar este partido';
  END IF;

  IF v_match.status IN ('played', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar un partido %', v_match.status;
  END IF;

  IF p_cancha_cost IS NOT NULL AND p_cancha_cost < 0 THEN
    RAISE EXCEPTION 'El costo de cancha no puede ser negativo';
  END IF;

  IF p_format IS NOT NULL AND p_format NOT IN (5, 6, 7, 8, 9, 11) THEN
    RAISE EXCEPTION 'Formato invalido. Valores permitidos: 5,6,7,8,9,11';
  END IF;

  IF v_match.challenge_id IS NOT NULL AND p_format IS NOT NULL AND p_format <> v_match.format THEN
    RAISE EXCEPTION 'En desafios el formato queda fijado por el equipo creador';
  END IF;

  v_next_status := CASE
    WHEN p_scheduled_at IS NOT NULL
      AND NULLIF(btrim(COALESCE(p_location, '')), '') IS NOT NULL THEN 'confirmed'
    ELSE 'pending'
  END;

  UPDATE public.team_matches tm
  SET
    scheduled_at = p_scheduled_at,
    location = NULLIF(btrim(COALESCE(p_location, '')), ''),
    location_name = NULLIF(btrim(COALESCE(p_location, '')), ''),
    cancha_cost = p_cancha_cost,
    mode = NULLIF(btrim(COALESCE(p_mode, '')), ''),
    format = COALESCE(p_format, tm.format),
    status = v_next_status,
    updated_at = now()
  WHERE tm.id = p_match_id
  RETURNING * INTO v_match;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text, smallint) TO authenticated, service_role;

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
