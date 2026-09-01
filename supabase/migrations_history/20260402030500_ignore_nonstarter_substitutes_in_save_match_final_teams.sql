BEGIN;

-- Ignore extra substitutes outside the effective match roster when locking
-- survey-defined final teams. Friendly surveys should validate against the
-- roster that actually played (confirmed/persisted teams, then starters),
-- not against every raw jugadores row on the match.
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
  v_seed_refs text[] := ARRAY[]::text[];
  v_allowed_player_ids bigint[] := ARRAY[]::bigint[];
  v_allowed_refs text[] := ARRAY[]::text[];
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

  -- 1) Effective confirmed roster from participants / confirmed teams.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
    INTO v_seed_refs
    FROM (
      SELECT lower(trim(candidate_value)) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(ptc.participants, 'null'::jsonb)) = 'array'
            THEN ptc.participants
          ELSE '[]'::jsonb
        END
      ) participant
      CROSS JOIN LATERAL (
        VALUES
          (
            COALESCE(
              participant ->> 'user_id',
              participant -> 'jugador' ->> 'usuario_id',
              participant ->> 'usuario_id'
            )
          ),
          (participant -> 'jugador' ->> 'uuid'),
          (participant -> 'jugador' ->> 'id'),
          (participant -> 'jugador' ->> 'nombre')
      ) candidate(candidate_value)
      WHERE ptc.partido_id = p_partido_id
        AND trim(COALESCE(candidate_value, '')) <> ''

      UNION

      SELECT lower(trim(uid::text)) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL unnest(COALESCE(ptc.team_a, ARRAY[]::uuid[])) uid
      WHERE ptc.partido_id = p_partido_id

      UNION

      SELECT lower(trim(uid::text)) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL unnest(COALESCE(ptc.team_b, ARRAY[]::uuid[])) uid
      WHERE ptc.partido_id = p_partido_id

      UNION

      SELECT lower(trim(candidate_value)) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(ptc.teams_json, 'null'::jsonb)) = 'array'
            THEN ptc.teams_json
          ELSE '[]'::jsonb
        END
      ) team_entry
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(team_entry -> 'players', 'null'::jsonb)) = 'array'
            THEN team_entry -> 'players'
          ELSE '[]'::jsonb
        END
      ) player_entry
      CROSS JOIN LATERAL (
        VALUES
          (
            CASE
              WHEN jsonb_typeof(player_entry) = 'string' THEN trim(both '"' from player_entry::text)
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'usuario_id'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'uuid'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'id'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'nombre'
              ELSE NULL
            END
          )
      ) candidate(candidate_value)
      WHERE ptc.partido_id = p_partido_id
        AND trim(COALESCE(candidate_value, '')) <> ''
    ) confirmed_refs;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      v_seed_refs := ARRAY[]::text[];
  END;

  IF COALESCE(array_length(v_seed_refs, 1), 0) > 0 THEN
    WITH matched_players AS (
      SELECT DISTINCT j.id
      FROM public.jugadores j
      CROSS JOIN LATERAL (
        VALUES
          (lower(trim(COALESCE(j.uuid::text, '')))),
          (lower(trim(COALESCE(j.usuario_id::text, '')))),
          (lower(trim(j.id::text))),
          (lower(trim(COALESCE(j.nombre, ''))))
      ) candidate(ref)
      WHERE j.partido_id = p_partido_id
        AND trim(candidate.ref) <> ''
        AND candidate.ref = ANY(v_seed_refs)
    )
    SELECT
      COALESCE(array_agg(id), ARRAY[]::bigint[]),
      COUNT(*)
    INTO v_allowed_player_ids, v_roster_count
    FROM matched_players;
  END IF;

  -- 2) Canonical persisted teams payload on the match.
  IF v_roster_count = 0 THEN
    BEGIN
      SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
      INTO v_seed_refs
      FROM (
        SELECT lower(trim(candidate_value)) AS ref
        FROM public.partidos p
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(p.equipos_json, 'null'::jsonb)) = 'array'
              THEN p.equipos_json
            ELSE '[]'::jsonb
          END
        ) team_entry
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(team_entry -> 'players', 'null'::jsonb)) = 'array'
              THEN team_entry -> 'players'
            ELSE '[]'::jsonb
          END
        ) player_entry
        CROSS JOIN LATERAL (
          VALUES
            (
              CASE
                WHEN jsonb_typeof(player_entry) = 'string' THEN trim(both '"' from player_entry::text)
                ELSE NULL
              END
            ),
            (
              CASE
                WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'usuario_id'
                ELSE NULL
              END
            ),
            (
              CASE
                WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'uuid'
                ELSE NULL
              END
            ),
            (
              CASE
                WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'id'
                ELSE NULL
              END
            ),
            (
              CASE
                WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'nombre'
                ELSE NULL
              END
            )
        ) candidate(candidate_value)
        WHERE p.id = p_partido_id
          AND trim(COALESCE(candidate_value, '')) <> ''
      ) equipos_json_refs;
    EXCEPTION
      WHEN undefined_column THEN
        v_seed_refs := ARRAY[]::text[];
    END;

    IF COALESCE(array_length(v_seed_refs, 1), 0) = 0 THEN
      BEGIN
        SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
        INTO v_seed_refs
        FROM (
          SELECT lower(trim(candidate_value)) AS ref
          FROM public.partidos p
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(COALESCE(p.equipos::jsonb, 'null'::jsonb)) = 'array'
                THEN p.equipos::jsonb
              ELSE '[]'::jsonb
            END
          ) team_entry
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(COALESCE(team_entry -> 'players', 'null'::jsonb)) = 'array'
                THEN team_entry -> 'players'
              ELSE '[]'::jsonb
            END
          ) player_entry
          CROSS JOIN LATERAL (
            VALUES
              (
                CASE
                  WHEN jsonb_typeof(player_entry) = 'string' THEN trim(both '"' from player_entry::text)
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'usuario_id'
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'uuid'
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'id'
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN jsonb_typeof(player_entry) = 'object' THEN player_entry ->> 'nombre'
                  ELSE NULL
                END
              )
          ) candidate(candidate_value)
          WHERE p.id = p_partido_id
            AND trim(COALESCE(candidate_value, '')) <> ''
        ) equipos_refs;
      EXCEPTION
        WHEN undefined_column OR invalid_text_representation THEN
          v_seed_refs := ARRAY[]::text[];
      END;
    END IF;

    IF COALESCE(array_length(v_seed_refs, 1), 0) > 0 THEN
      WITH matched_players AS (
        SELECT DISTINCT j.id
        FROM public.jugadores j
        CROSS JOIN LATERAL (
          VALUES
            (lower(trim(COALESCE(j.uuid::text, '')))),
            (lower(trim(COALESCE(j.usuario_id::text, '')))),
            (lower(trim(j.id::text))),
            (lower(trim(COALESCE(j.nombre, ''))))
        ) candidate(ref)
        WHERE j.partido_id = p_partido_id
          AND trim(candidate.ref) <> ''
          AND candidate.ref = ANY(v_seed_refs)
      )
      SELECT
        COALESCE(array_agg(id), ARRAY[]::bigint[]),
        COUNT(*)
      INTO v_allowed_player_ids, v_roster_count
      FROM matched_players;
    END IF;
  END IF;

  -- 3) Persisted survey/final teams (for editable rewrites after first save).
  IF v_roster_count = 0 THEN
    SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
    INTO v_seed_refs
    FROM (
      SELECT lower(trim(ref_value)) AS ref
      FROM public.partidos p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p.survey_team_a, 'null'::jsonb)) = 'array'
            AND jsonb_array_length(p.survey_team_a) > 0
            THEN p.survey_team_a
          WHEN jsonb_typeof(COALESCE(p.final_team_a, 'null'::jsonb)) = 'array'
            THEN p.final_team_a
          ELSE '[]'::jsonb
        END
      ) team_a_refs(ref_value)
      WHERE p.id = p_partido_id

      UNION

      SELECT lower(trim(ref_value)) AS ref
      FROM public.partidos p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p.survey_team_b, 'null'::jsonb)) = 'array'
            AND jsonb_array_length(p.survey_team_b) > 0
            THEN p.survey_team_b
          WHEN jsonb_typeof(COALESCE(p.final_team_b, 'null'::jsonb)) = 'array'
            THEN p.final_team_b
          ELSE '[]'::jsonb
        END
      ) team_b_refs(ref_value)
      WHERE p.id = p_partido_id
    ) persisted_refs;

    IF COALESCE(array_length(v_seed_refs, 1), 0) > 0 THEN
      WITH matched_players AS (
        SELECT DISTINCT j.id
        FROM public.jugadores j
        CROSS JOIN LATERAL (
          VALUES
            (lower(trim(COALESCE(j.uuid::text, '')))),
            (lower(trim(COALESCE(j.usuario_id::text, '')))),
            (lower(trim(j.id::text))),
            (lower(trim(COALESCE(j.nombre, ''))))
        ) candidate(ref)
        WHERE j.partido_id = p_partido_id
          AND trim(candidate.ref) <> ''
          AND candidate.ref = ANY(v_seed_refs)
      )
      SELECT
        COALESCE(array_agg(id), ARRAY[]::bigint[]),
        COUNT(*)
      INTO v_allowed_player_ids, v_roster_count
      FROM matched_players;
    END IF;
  END IF;

  -- 4) Friendly fallback: starters only. Ignore substitutes unless the
  -- effective roster already includes them via a confirmed/persisted team list.
  IF v_roster_count = 0 THEN
    SELECT
      COALESCE(array_agg(j.id), ARRAY[]::bigint[]),
      COUNT(*)
    INTO v_allowed_player_ids, v_roster_count
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND COALESCE(j.is_substitute, false) = false
      AND trim(COALESCE(j.uuid::text, j.usuario_id::text, j.id::text)) <> '';
  END IF;

  -- 5) Last-resort fallback: any persisted roster row.
  IF v_roster_count = 0 THEN
    SELECT
      COALESCE(array_agg(j.id), ARRAY[]::bigint[]),
      COUNT(*)
    INTO v_allowed_player_ids, v_roster_count
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND trim(COALESCE(j.uuid::text, j.usuario_id::text, j.id::text)) <> '';
  END IF;

  IF v_roster_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'empty_roster');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
  INTO v_allowed_refs
  FROM (
    SELECT lower(trim(ref)) AS ref
    FROM (
      SELECT j.uuid::text AS ref
      FROM public.jugadores j
      WHERE j.id = ANY(v_allowed_player_ids)
        AND j.uuid IS NOT NULL

      UNION ALL

      SELECT j.usuario_id::text AS ref
      FROM public.jugadores j
      WHERE j.id = ANY(v_allowed_player_ids)
        AND j.usuario_id IS NOT NULL

      UNION ALL

      SELECT j.id::text AS ref
      FROM public.jugadores j
      WHERE j.id = ANY(v_allowed_player_ids)

      UNION ALL

      SELECT j.nombre AS ref
      FROM public.jugadores j
      WHERE j.id = ANY(v_allowed_player_ids)
        AND trim(COALESCE(j.nombre, '')) <> ''
    ) allowed_refs
    WHERE trim(ref) <> ''
  ) normalized_allowed_refs;

  WITH final_refs AS (
    SELECT DISTINCT lower(trim(ref)) AS ref
    FROM (
      SELECT unnest(v_team_a) AS ref
      UNION ALL
      SELECT unnest(v_team_b) AS ref
    ) f
    WHERE trim(ref) <> ''
  )
  SELECT
    (SELECT COUNT(*) FROM final_refs),
    (
      SELECT COUNT(*)
      FROM final_refs f
      WHERE NOT (f.ref = ANY(v_allowed_refs))
    )
  INTO v_final_count, v_invalid_count;

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
