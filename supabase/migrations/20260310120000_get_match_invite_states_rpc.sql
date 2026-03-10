BEGIN;

CREATE OR REPLACE FUNCTION public.get_match_invite_states(
  p_partido_id bigint,
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  invite_status text,
  read boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_is_allowed boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_partido_id IS NULL THEN
    RAISE EXCEPTION 'invalid_match_id';
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.partidos p
      WHERE p.id = p_partido_id
        AND p.creado_por = v_actor_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id = v_actor_id
    )
  )
  INTO v_is_allowed;

  IF NOT COALESCE(v_is_allowed, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH scoped_invites AS (
    SELECT
      n.user_id,
      COALESCE(NULLIF(LOWER(TRIM(n.data->>'status')), ''), 'pending') AS invite_status,
      COALESCE(n.read, false) AS read,
      COALESCE(n.send_at, n.created_at, now()) AS updated_at,
      ROW_NUMBER() OVER (
        PARTITION BY n.user_id
        ORDER BY COALESCE(n.send_at, n.created_at) DESC, n.id DESC
      ) AS rn
    FROM public.notifications n
    WHERE n.type = 'match_invite'
      AND (
        n.partido_id = p_partido_id
        OR n.match_ref = p_partido_id
        OR n.data->>'match_id' = p_partido_id::text
        OR n.data->>'matchId' = p_partido_id::text
        OR n.data->>'partido_id' = p_partido_id::text
        OR n.data->>'partidoId' = p_partido_id::text
      )
      AND (
        p_user_ids IS NULL
        OR COALESCE(cardinality(p_user_ids), 0) = 0
        OR n.user_id = ANY(p_user_ids)
      )
  )
  SELECT
    scoped_invites.user_id,
    scoped_invites.invite_status,
    scoped_invites.read,
    scoped_invites.updated_at
  FROM scoped_invites
  WHERE scoped_invites.rn = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_invite_states(bigint, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_invite_states(bigint, uuid[]) TO authenticated;

COMMIT;
