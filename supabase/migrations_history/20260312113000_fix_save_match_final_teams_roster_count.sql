BEGIN;

-- Fix roster validation in save_match_final_teams:
-- compare submitted final teams against roster player count (not identifier alias count).
CREATE OR REPLACE FUNCTION public.save_match_final_teams(
  p_partido_id bigint,
  p_final_team_a jsonb,
  p_final_team_b jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_creator boolean := false;
  v_is_player boolean := false;
  v_match record;
  v_team_a text[] := ARRAY[]::text[];
  v_team_b text[] := ARRAY[]::text[];
  v_roster_count int := 0;
  v_final_count int := 0;
  v_invalid_count int := 0;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_match_id');
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.partidos p
    WHERE p.id = p_partido_id
      AND p.creado_por = v_user_id
  ) INTO v_is_creator;

  SELECT EXISTS (
    SELECT 1 FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id = v_user_id
  ) INTO v_is_player;

  IF NOT v_is_creator AND NOT v_is_player THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT
    p.id,
    COALESCE(p.teams_confirmed, false) AS teams_confirmed,
    COALESCE(p.teams_locked, false) AS teams_locked,
    p.survey_team_a,
    p.survey_team_b,
    p.teams_source,
    p.teams_locked_by_user_id,
    p.teams_locked_at
  INTO v_match
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  IF jsonb_typeof(COALESCE(p_final_team_a, 'null'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_final_team_b, 'null'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_payload');
  END IF;

  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_team_a
  FROM jsonb_array_elements_text(p_final_team_a) value;

  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_team_b
  FROM jsonb_array_elements_text(p_final_team_b) value;

  IF COALESCE(array_length(v_team_a, 1), 0) = 0 OR COALESCE(array_length(v_team_b, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'empty_team');
  END IF;

  IF (SELECT COUNT(*) FROM unnest(v_team_a) x) <> (SELECT COUNT(DISTINCT lower(trim(x))) FROM unnest(v_team_a) x)
     OR (SELECT COUNT(*) FROM unnest(v_team_b) x) <> (SELECT COUNT(DISTINCT lower(trim(x))) FROM unnest(v_team_b) x) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'duplicate_player');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_team_a) a
    JOIN unnest(v_team_b) b ON lower(trim(a)) = lower(trim(b))
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'player_in_both_teams');
  END IF;

  WITH roster_players AS (
    SELECT DISTINCT lower(trim(COALESCE(j.uuid::text, j.usuario_id::text, j.id::text))) AS player_ref
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND trim(COALESCE(j.uuid::text, j.usuario_id::text, j.id::text)) <> ''
  ), roster_refs AS (
    SELECT DISTINCT lower(trim(ref)) AS ref
    FROM (
      SELECT j.uuid::text AS ref
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.uuid IS NOT NULL
      UNION ALL
      SELECT j.usuario_id::text AS ref
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id IS NOT NULL
      UNION ALL
      SELECT j.id::text AS ref
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
    ) refs
    WHERE trim(ref) <> ''
  ), final_refs AS (
    SELECT DISTINCT lower(trim(ref)) AS ref
    FROM (
      SELECT unnest(v_team_a) AS ref
      UNION ALL
      SELECT unnest(v_team_b) AS ref
    ) f
    WHERE trim(ref) <> ''
  )
  SELECT
    (SELECT COUNT(*) FROM roster_players),
    (SELECT COUNT(*) FROM final_refs),
    (
      SELECT COUNT(*)
      FROM final_refs f
      WHERE NOT EXISTS (
        SELECT 1
        FROM roster_refs r
        WHERE r.ref = f.ref
      )
    )
  INTO v_roster_count, v_final_count, v_invalid_count;

  IF v_roster_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'empty_roster');
  END IF;

  IF v_final_count <> v_roster_count THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inconsistent_roster_count');
  END IF;

  IF v_invalid_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inconsistent_roster_members');
  END IF;

  -- Confirmed teams path: keep source as admin, allow storing final teams for backwards compatibility.
  IF v_match.teams_confirmed THEN
    UPDATE public.partidos p
    SET
      final_team_a = to_jsonb(v_team_a),
      final_team_b = to_jsonb(v_team_b),
      final_teams_updated_at = now(),
      final_teams_updated_by = v_user_id,
      teams_source = 'admin'
    WHERE p.id = p_partido_id;

    RETURN jsonb_build_object(
      'success', true,
      'reason', 'confirmed_teams',
      'locked_by_other', false,
      'teams_source', 'admin',
      'team_a', to_jsonb(v_team_a),
      'team_b', to_jsonb(v_team_b),
      'teams_locked', true,
      'teams_locked_by_user_id', NULL,
      'teams_locked_at', NULL
    );
  END IF;

  -- Survey-defined teams path: latest save wins.
  UPDATE public.partidos p
  SET
    survey_team_a = to_jsonb(v_team_a),
    survey_team_b = to_jsonb(v_team_b),
    final_team_a = to_jsonb(v_team_a),
    final_team_b = to_jsonb(v_team_b),
    final_teams_updated_at = now(),
    final_teams_updated_by = v_user_id,
    teams_locked = true,
    teams_locked_by_user_id = v_user_id,
    teams_locked_at = now(),
    teams_source = 'survey'
  WHERE p.id = p_partido_id;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'updated',
    'locked_by_other', false,
    'teams_source', 'survey',
    'team_a', to_jsonb(v_team_a),
    'team_b', to_jsonb(v_team_b),
    'teams_locked', true,
    'teams_locked_by_user_id', v_user_id,
    'teams_locked_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_match_final_teams(bigint, jsonb, jsonb) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.save_match_final_teams(bigint, jsonb, jsonb) TO service_role;
  END IF;
END;
$$;

COMMIT;
