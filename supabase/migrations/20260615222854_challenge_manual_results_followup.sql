-- Follow-up for challenge manual results.
-- 20260615120000 is already applied in Remote; keep it immutable and replace
-- only the RPC behavior here.

BEGIN;

-- The already-applied 20260615120000 backfill used COALESCE(score, 0). For
-- played challenge rows without a reporter and without a complete scoreline,
-- clear that inferred manual result so history does not count fabricated draws.
UPDATE public.team_matches tm
SET
  result_status = NULL,
  result_reported_at = NULL,
  result_updated_at = now(),
  updated_at = now()
WHERE (lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)
  AND lower(COALESCE(tm.status, '')) = 'played'
  AND tm.result_status IS NOT NULL
  AND tm.result_reported_by_team_id IS NULL
  AND (tm.score_a IS NULL OR tm.score_b IS NULL);

CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(
  p_challenge_id uuid,
  p_result_status text
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_reporter_team_id uuid;
  v_can_report_for_challenger boolean := false;
  v_can_report_for_accepted boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_result_status IS NULL OR p_result_status NOT IN ('team_a_win', 'team_b_win', 'draw') THEN
    RAISE EXCEPTION 'Resultado invalido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado en desafios confirmados';
  END IF;

  IF v_challenge.status = 'accepted'
     AND (v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()) THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado cuando el desafio ya se jugo';
  END IF;

  v_can_report_for_challenger := public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.challenger_team_id, v_uid);
  v_can_report_for_accepted := public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.accepted_team_id, v_uid);

  IF NOT (v_can_report_for_challenger OR v_can_report_for_accepted) THEN
    RAISE EXCEPTION 'Solo owner/capitan/admin involucrado puede responder el resultado';
  END IF;

  IF v_can_report_for_challenger AND v_can_report_for_accepted THEN
    RAISE EXCEPTION 'No se pudo identificar un unico equipo para responder el resultado';
  END IF;

  -- Determine which side reported the result (metadata only; nullable).
  IF v_can_report_for_challenger THEN
    v_reporter_team_id := v_challenge.challenger_team_id;
  ELSIF v_can_report_for_accepted THEN
    v_reporter_team_id := v_challenge.accepted_team_id;
  ELSE
    v_reporter_team_id := NULL;
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = p_challenge_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = p_result_status,
      result_reported_by_team_id = COALESCE(v_reporter_team_id, tm.result_reported_by_team_id),
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSE
    INSERT INTO public.team_matches (
      origin_type,
      challenge_id,
      team_a_id,
      team_b_id,
      played_at,
      scheduled_at,
      format,
      mode,
      location,
      location_name,
      status,
      result_status,
      result_reported_by_team_id,
      result_reported_at,
      result_updated_at,
      updated_at
    ) VALUES (
      'challenge',
      v_challenge.id,
      v_challenge.challenger_team_id,
      v_challenge.accepted_team_id,
      now(),
      COALESCE(v_challenge.scheduled_at, now()),
      v_challenge.format,
      v_challenge.mode,
      COALESCE(v_challenge.location, v_challenge.location_name),
      COALESCE(v_challenge.location, v_challenge.location_name),
      'played',
      p_result_status,
      v_reporter_team_id,
      now(),
      now(),
      now()
    )
    RETURNING * INTO v_match;
  END IF;

  UPDATE public.challenges c
  SET
    status = 'completed',
    updated_at = now()
  WHERE c.id = p_challenge_id
    AND c.status <> 'completed';

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_report_challenge_result(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_challenge_head_to_head_stats(
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_exclude_match_id uuid DEFAULT NULL
)
RETURNS TABLE (
  "totalEncounters" bigint,
  "totalMatchesPlayed" bigint,
  "lastEncounterAt" timestamptz,
  "lastResultAt" timestamptz,
  "lastWinnerTeamId" uuid,
  "lastResultStatus" text,
  "winsTeamA" bigint,
  "winsTeamB" bigint,
  "draws" bigint
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
    SELECT 0::bigint, 0::bigint, NULL::timestamptz, NULL::timestamptz,
           NULL::uuid, NULL::text, 0::bigint, 0::bigint, 0::bigint;
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
      tm.status,
      tm.score_a,
      tm.score_b,
      tm.result_status,
      COALESCE(tm.scheduled_at, tm.played_at, tm.created_at) AS encounter_at,
      COALESCE(tm.result_reported_at, tm.played_at, tm.updated_at, tm.created_at) AS result_at,
      tm.created_at
    FROM public.team_matches tm
    WHERE
      (lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)
      AND (p_exclude_match_id IS NULL OR tm.id <> p_exclude_match_id)
      AND (
        (tm.team_a_id = p_team_a_id AND tm.team_b_id = p_team_b_id)
        OR (tm.team_a_id = p_team_b_id AND tm.team_b_id = p_team_a_id)
      )
  ),
  encounters AS (
    SELECT *
    FROM scoped_matches sm
    WHERE lower(COALESCE(sm.status, '')) <> 'cancelled'
  ),
  played AS (
    SELECT
      e.id,
      e.result_at,
      e.created_at,
      CASE
        WHEN e.result_status = 'team_a_win' THEN e.team_a_id
        WHEN e.result_status = 'team_b_win' THEN e.team_b_id
        WHEN e.result_status = 'draw' THEN NULL::uuid
        WHEN e.score_a > e.score_b THEN e.team_a_id
        WHEN e.score_b > e.score_a THEN e.team_b_id
        ELSE NULL::uuid
      END AS winner_team_id,
      CASE
        WHEN e.result_status = 'draw' THEN true
        WHEN e.result_status IS NULL AND e.score_a = e.score_b THEN true
        ELSE false
      END AS is_draw
    FROM encounters e
    WHERE lower(COALESCE(e.status, '')) = 'played'
      AND (
        e.result_status IN ('team_a_win', 'team_b_win', 'draw')
        OR (e.result_status IS NULL AND e.score_a IS NOT NULL AND e.score_b IS NOT NULL)
      )
  ),
  last_result AS (
    SELECT p.winner_team_id, p.is_draw, p.result_at
    FROM played p
    ORDER BY p.result_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id DESC
    LIMIT 1
  )
  SELECT
    (SELECT COUNT(*) FROM encounters)::bigint AS "totalEncounters",
    (SELECT COUNT(*) FROM played)::bigint AS "totalMatchesPlayed",
    (SELECT MAX(e.encounter_at) FROM encounters e) AS "lastEncounterAt",
    (SELECT lr.result_at FROM last_result lr) AS "lastResultAt",
    (SELECT lr.winner_team_id FROM last_result lr) AS "lastWinnerTeamId",
    (SELECT CASE
        WHEN lr.is_draw THEN 'draw'
        WHEN lr.winner_team_id = p_team_a_id THEN 'team_a_win'
        WHEN lr.winner_team_id = p_team_b_id THEN 'team_b_win'
        ELSE NULL
      END FROM last_result lr) AS "lastResultStatus",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.winner_team_id = p_team_a_id), 0)::bigint AS "winsTeamA",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.winner_team_id = p_team_b_id), 0)::bigint AS "winsTeamB",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.is_draw), 0)::bigint AS "draws";
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_challenge_head_to_head_stats(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_team_history_by_rival(p_team_id uuid)
RETURNS TABLE (
  rival_id uuid,
  rival_name text,
  rival_format smallint,
  rival_base_zone text,
  rival_skill_level text,
  rival_crest_url text,
  rival_color_primary text,
  rival_color_secondary text,
  rival_color_accent text,
  played bigint,
  won bigint,
  draw bigint,
  lost bigint,
  last_played_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_matches AS (
    SELECT
      COALESCE(tm.result_reported_at, tm.played_at, tm.created_at) AS played_at,
      CASE
        WHEN tm.team_a_id = p_team_id THEN tm.team_b_id
        ELSE tm.team_a_id
      END AS rival_id,
      CASE
        WHEN tm.result_status = 'draw' THEN 'draw'
        WHEN tm.result_status = 'team_a_win' THEN (CASE WHEN tm.team_a_id = p_team_id THEN 'won' ELSE 'lost' END)
        WHEN tm.result_status = 'team_b_win' THEN (CASE WHEN tm.team_b_id = p_team_id THEN 'won' ELSE 'lost' END)
        WHEN tm.score_a = tm.score_b THEN 'draw'
        WHEN (CASE WHEN tm.team_a_id = p_team_id THEN tm.score_a ELSE tm.score_b END)
           > (CASE WHEN tm.team_a_id = p_team_id THEN tm.score_b ELSE tm.score_a END)
          THEN 'won'
        ELSE 'lost'
      END AS outcome
    FROM public.team_matches tm
    WHERE lower(COALESCE(tm.status, '')) = 'played'
      AND (tm.team_a_id = p_team_id OR tm.team_b_id = p_team_id)
      AND (
        tm.result_status IN ('team_a_win', 'team_b_win', 'draw')
        OR (tm.result_status IS NULL AND tm.score_a IS NOT NULL AND tm.score_b IS NOT NULL)
      )
  )
  SELECT
    sm.rival_id,
    t.name AS rival_name,
    t.format AS rival_format,
    t.base_zone AS rival_base_zone,
    t.skill_level AS rival_skill_level,
    t.crest_url AS rival_crest_url,
    t.color_primary AS rival_color_primary,
    t.color_secondary AS rival_color_secondary,
    t.color_accent AS rival_color_accent,
    COUNT(*)::bigint AS played,
    SUM(CASE WHEN sm.outcome = 'won' THEN 1 ELSE 0 END)::bigint AS won,
    SUM(CASE WHEN sm.outcome = 'draw' THEN 1 ELSE 0 END)::bigint AS draw,
    SUM(CASE WHEN sm.outcome = 'lost' THEN 1 ELSE 0 END)::bigint AS lost,
    MAX(sm.played_at) AS last_played_at
  FROM scoped_matches sm
  JOIN public.teams t ON t.id = sm.rival_id
  GROUP BY
    sm.rival_id,
    t.name,
    t.format,
    t.base_zone,
    t.skill_level,
    t.crest_url,
    t.color_primary,
    t.color_secondary,
    t.color_accent
  ORDER BY MAX(sm.played_at) DESC NULLS LAST, t.name ASC;
$$;

REVOKE ALL ON FUNCTION public.rpc_team_history_by_rival(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_team_history_by_rival(uuid) TO authenticated, service_role;

COMMIT;
