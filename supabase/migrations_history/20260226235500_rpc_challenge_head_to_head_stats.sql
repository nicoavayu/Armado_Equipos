BEGIN;

DROP FUNCTION IF EXISTS public.rpc_get_challenge_head_to_head_stats(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_get_challenge_head_to_head_stats(
  p_team_a_id uuid,
  p_team_b_id uuid
)
RETURNS TABLE (
  "totalMatchesScheduled" bigint,
  "lastMatchScheduledAt" timestamptz,
  "lastWinnerTeamId" uuid,
  "winsTeamA" bigint,
  "winsTeamB" bigint
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

  IF p_team_a_id IS NULL OR p_team_b_id IS NULL THEN
    RAISE EXCEPTION 'Equipos invalidos';
  END IF;

  IF p_team_a_id = p_team_b_id THEN
    RETURN QUERY
    SELECT
      0::bigint,
      NULL::timestamptz,
      NULL::uuid,
      0::bigint,
      0::bigint;
    RETURN;
  END IF;

  IF NOT (
    public.team_user_is_member(p_team_a_id, v_uid)
    OR public.team_user_is_member(p_team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  WITH scoped_matches AS (
    SELECT
      tm.id,
      tm.team_a_id,
      tm.team_b_id,
      tm.scheduled_at,
      tm.played_at,
      tm.created_at,
      tm.updated_at,
      tm.status,
      tm.score_a,
      tm.score_b
    FROM public.team_matches tm
    WHERE
      (lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)
      AND (
        (tm.team_a_id = p_team_a_id AND tm.team_b_id = p_team_b_id)
        OR (tm.team_a_id = p_team_b_id AND tm.team_b_id = p_team_a_id)
      )
  ),
  scheduled_stats AS (
    SELECT
      COUNT(*)::bigint AS total_matches_scheduled,
      MAX(COALESCE(sm.scheduled_at, sm.created_at)) AS last_match_scheduled_at
    FROM scoped_matches sm
  ),
  validated_results AS (
    SELECT
      sm.id,
      sm.team_a_id,
      sm.team_b_id,
      sm.created_at,
      COALESCE(sm.played_at, sm.scheduled_at, sm.updated_at, sm.created_at) AS result_at,
      CASE
        WHEN sm.score_a IS NULL OR sm.score_b IS NULL THEN NULL::uuid
        WHEN sm.score_a > sm.score_b THEN sm.team_a_id
        WHEN sm.score_b > sm.score_a THEN sm.team_b_id
        ELSE NULL::uuid
      END AS winner_team_id
    FROM scoped_matches sm
    WHERE COALESCE(lower(sm.status), '') = 'played'
  ),
  winner_rollup AS (
    SELECT
      COALESCE(SUM(CASE WHEN vr.winner_team_id = p_team_a_id THEN 1 ELSE 0 END), 0)::bigint AS wins_team_a,
      COALESCE(SUM(CASE WHEN vr.winner_team_id = p_team_b_id THEN 1 ELSE 0 END), 0)::bigint AS wins_team_b
    FROM validated_results vr
  ),
  last_winner AS (
    SELECT vr.winner_team_id AS last_winner_team_id
    FROM validated_results vr
    ORDER BY vr.result_at DESC NULLS LAST, vr.created_at DESC NULLS LAST, vr.id DESC
    LIMIT 1
  )
  SELECT
    ss.total_matches_scheduled AS "totalMatchesScheduled",
    ss.last_match_scheduled_at AS "lastMatchScheduledAt",
    lw.last_winner_team_id AS "lastWinnerTeamId",
    wr.wins_team_a AS "winsTeamA",
    wr.wins_team_b AS "winsTeamB"
  FROM scheduled_stats ss
  CROSS JOIN winner_rollup wr
  LEFT JOIN last_winner lw ON TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_challenge_head_to_head_stats(uuid, uuid) TO authenticated, service_role;

COMMIT;
