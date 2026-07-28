-- Migration: Persist editable final teams from post-match survey result step
-- Date: 2026-02-18
-- Purpose:
--   1) Store final teams selected in survey flow (without mutating confirmed snapshot)
--   2) Expose a validated RPC to save final teams atomically
--   3) Sync survey_results.snapshot_equipos so history/stats use final teams as source of truth

BEGIN;

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS final_team_a jsonb,
  ADD COLUMN IF NOT EXISTS final_team_b jsonb,
  ADD COLUMN IF NOT EXISTS final_teams_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_teams_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

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
  v_team_a text[] := ARRAY[]::text[];
  v_team_b text[] := ARRAY[]::text[];
  v_confirmed_a text[] := ARRAY[]::text[];
  v_confirmed_b text[] := ARRAY[]::text[];
  v_confirmed_count int := 0;
  v_final_count int := 0;
  v_invalid_count int := 0;
  v_snapshot jsonb;
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

  -- No duplicates inside the same team.
  IF (SELECT COUNT(*) FROM unnest(v_team_a) x) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_team_a) x)
     OR (SELECT COUNT(*) FROM unnest(v_team_b) x) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_team_b) x) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'duplicate_player');
  END IF;

  -- No overlaps between teams.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_team_a) a
    JOIN unnest(v_team_b) b ON a = b
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'player_in_both_teams');
  END IF;

  SELECT
    COALESCE(array_agg(x::text), ARRAY[]::text[])
  INTO v_confirmed_a
  FROM (
    SELECT unnest(COALESCE(ptc.team_a, ARRAY[]::uuid[])) AS x
    FROM public.partido_team_confirmations ptc
    WHERE ptc.partido_id = p_partido_id
  ) t1;

  SELECT
    COALESCE(array_agg(y::text), ARRAY[]::text[])
  INTO v_confirmed_b
  FROM (
    SELECT unnest(COALESCE(ptc.team_b, ARRAY[]::uuid[])) AS y
    FROM public.partido_team_confirmations ptc
    WHERE ptc.partido_id = p_partido_id
  ) t2;

  IF COALESCE(array_length(v_confirmed_a, 1), 0) = 0 OR COALESCE(array_length(v_confirmed_b, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_confirmed_teams');
  END IF;

  SELECT COUNT(DISTINCT ref)
  INTO v_confirmed_count
  FROM (
    SELECT unnest(v_confirmed_a) AS ref
    UNION ALL
    SELECT unnest(v_confirmed_b) AS ref
  ) s;

  SELECT COUNT(DISTINCT ref)
  INTO v_final_count
  FROM (
    SELECT unnest(v_team_a) AS ref
    UNION ALL
    SELECT unnest(v_team_b) AS ref
  ) s;

  IF v_confirmed_count <> v_final_count THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inconsistent_roster_count');
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_count
  FROM (
    SELECT DISTINCT ref FROM (
      SELECT unnest(v_team_a) AS ref
      UNION ALL
      SELECT unnest(v_team_b) AS ref
    ) s
  ) final_refs
  WHERE NOT EXISTS (
    SELECT 1
    FROM (
      SELECT unnest(v_confirmed_a) AS ref
      UNION ALL
      SELECT unnest(v_confirmed_b) AS ref
    ) confirmed_refs
    WHERE confirmed_refs.ref = final_refs.ref
  );

  IF v_invalid_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inconsistent_roster_members');
  END IF;

  UPDATE public.partidos p
  SET
    final_team_a = to_jsonb(v_team_a),
    final_team_b = to_jsonb(v_team_b),
    final_teams_updated_at = now(),
    final_teams_updated_by = v_user_id
  WHERE p.id = p_partido_id;

  v_snapshot := jsonb_build_object(
    'team_a', to_jsonb(v_team_a),
    'team_b', to_jsonb(v_team_b),
    'teams_json', NULL,
    'confirmed_at', now(),
    'source', 'final_teams_adjusted',
    'updated_at', now(),
    'updated_by', v_user_id
  );

  INSERT INTO public.survey_results (partido_id, snapshot_equipos)
  VALUES (p_partido_id, v_snapshot)
  ON CONFLICT (partido_id) DO UPDATE
  SET snapshot_equipos = v_snapshot;

  RETURN jsonb_build_object(
    'success', true,
    'partido_id', p_partido_id,
    'team_a_count', COALESCE(array_length(v_team_a, 1), 0),
    'team_b_count', COALESCE(array_length(v_team_b, 1), 0)
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
