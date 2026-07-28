-- ============================================================================
-- Challenge detail hard permissions + team match chat integration
-- Date: 2026-02-24
-- Purpose:
--   - Restrict challenge match info edits to challenge creator only
--   - Keep UI/API using rpc_update_team_match_details with creator validation
--   - Support match chat for team_matches in mensajes_partido via team_match_id
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Hard permission: only challenge creator can edit challenge match info
-- ---------------------------------------------------------------------------
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
  v_creator_id uuid;
  v_next_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  -- Only challenge matches are editable from this flow.
  IF lower(COALESCE(v_match.origin_type, '')) <> 'challenge' OR v_match.challenge_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT c.created_by_user_id
  INTO v_creator_id
  FROM public.challenges c
  WHERE c.id = v_match.challenge_id;

  IF v_creator_id IS NULL OR v_creator_id <> v_uid THEN
    RAISE EXCEPTION 'No autorizado';
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

-- ---------------------------------------------------------------------------
-- 2) Team match roster RPC (both teams visible to any involved user)
-- ---------------------------------------------------------------------------
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
    RAISE EXCEPTION 'No autorizado';
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
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    tm.team_id::text,
    tm.id::text,
    tm.jugador_id::text,
    COALESCE(NULLIF(to_jsonb(tm)->>'user_id', '')::uuid, j.usuario_id) AS user_id,
    COALESCE(NULLIF(to_jsonb(tm)->>'permissions_role', ''), 'member') AS permissions_role,
    COALESCE(NULLIF(to_jsonb(tm)->>'role', ''), 'player') AS role,
    COALESCE((to_jsonb(tm)->>'is_captain')::boolean, false) AS is_captain,
    NULLIF(to_jsonb(tm)->>'shirt_number', '')::smallint AS shirt_number,
    NULLIF(to_jsonb(tm)->>'photo_url', '') AS photo_url,
    tm.created_at,
    j.usuario_id,
    j.nombre,
    j.avatar_url,
    j.score::numeric
  FROM public.team_members tm
  LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
  WHERE tm.team_id IN (v_team_a_id, v_team_b_id)
  ORDER BY tm.team_id, COALESCE((to_jsonb(tm)->>'is_captain')::boolean, false) DESC, tm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_team_match_members(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Match chat in mensajes_partido for team matches
-- ---------------------------------------------------------------------------
ALTER TABLE public.mensajes_partido
  ADD COLUMN IF NOT EXISTS team_match_id uuid NULL REFERENCES public.team_matches(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mensajes_partido'
      AND column_name = 'partido_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.mensajes_partido
      ALTER COLUMN partido_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mensajes_partido_team_match_timestamp_idx
  ON public.mensajes_partido(team_match_id, "timestamp" ASC, id ASC)
  WHERE team_match_id IS NOT NULL;

ALTER TABLE public.mensajes_partido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mensajes_partido_select_authenticated_with_team_scope ON public.mensajes_partido;
CREATE POLICY mensajes_partido_select_authenticated_with_team_scope
ON public.mensajes_partido
FOR SELECT
TO authenticated
USING (
  (
    team_match_id IS NULL
  )
  OR (
    team_match_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.team_matches tm
      WHERE tm.id = mensajes_partido.team_match_id
        AND (
          public.team_user_is_member(tm.team_a_id, auth.uid())
          OR public.team_user_is_member(tm.team_b_id, auth.uid())
        )
    )
  )
);

DROP FUNCTION IF EXISTS public.send_team_match_chat_message(uuid, text, text);
CREATE OR REPLACE FUNCTION public.send_team_match_chat_message(
  p_team_match_id uuid,
  p_autor text,
  p_mensaje text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_autor text := COALESCE(NULLIF(trim(p_autor), ''), 'Usuario');
  v_mensaje text := trim(COALESCE(p_mensaje, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_match_id IS NULL THEN
    RAISE EXCEPTION 'Partido inválido' USING ERRCODE = 'P0001';
  END IF;

  IF v_mensaje = '' THEN
    RAISE EXCEPTION 'Mensaje vacío' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_team_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.team_user_is_member(v_match.team_a_id, v_uid)
    OR public.team_user_is_member(v_match.team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Sin permiso para enviar mensajes en este partido' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mensajes_partido'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, autor, mensaje, user_id) VALUES ($1, $2, $3, $4, $5)'
      USING NULL, p_team_match_id, v_autor, v_mensaje, v_uid;
  ELSE
    EXECUTE
      'INSERT INTO public.mensajes_partido (partido_id, team_match_id, autor, mensaje) VALUES ($1, $2, $3, $4)'
      USING NULL, p_team_match_id, v_autor, v_mensaje;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_team_match_chat_message(uuid, text, text) TO authenticated, service_role;

COMMIT;
