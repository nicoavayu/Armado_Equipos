-- Social Studio data contract V2.
--
-- `best_eleven` remains the canonical persisted key for compatibility, while
-- its V2 payload carries the effective modality/team size and roster/team
-- identity required to render an Equipo de la fecha without assuming eleven.
-- `next_fixture` becomes future-aware and is no longer the manually selected
-- round. Player portraits intentionally remain null: the existing portrait
-- resolver only authorizes the authenticated_roster audience, not social
-- export, and durable storage details must never enter a snapshot.

BEGIN;

CREATE OR REPLACE FUNCTION public.tournament_social_player_candidates(
  p_fixture_version_id uuid,
  p_players jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(
    statistic.payload || jsonb_build_object(
      'rosterPlayerId', player.id,
      'teamEntryId', participant.team_entry_id,
      'name', player.display_name,
      'position', player.primary_position,
      'isGoalkeeper', player.is_goalkeeper,
      'team', jsonb_build_object(
        'teamEntryId', participant.team_entry_id,
        'name', participant.snapshot_name,
        'shortName', participant.snapshot_short_name,
        'shieldPath', participant.snapshot_shield_path
      ),
      'portraitRef', null
    ) ORDER BY statistic.ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_players, '[]'::jsonb))
    WITH ORDINALITY AS statistic(payload, ordinality)
  JOIN public.tournament_fixture_versions fixture
    ON fixture.id = p_fixture_version_id
  JOIN public.tournament_roster_players player
    ON player.id = (statistic.payload->>'rosterPlayerId')::uuid
   AND player.team_entry_id = (statistic.payload->>'teamEntryId')::uuid
   AND player.organization_id = fixture.organization_id
  JOIN public.tournament_competition_participants participant
    ON participant.participant_set_id = fixture.participant_set_id
   AND participant.team_entry_id = player.team_entry_id
   AND participant.organization_id = fixture.organization_id
   AND participant.tournament_id = fixture.tournament_id
   AND participant.category_id = fixture.category_id;
$$;

CREATE OR REPLACE FUNCTION public.tournament_social_next_fixture(
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_group_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round_id uuid;
  v_round_name text;
  v_round_number integer;
  v_matches jsonb;
BEGIN
  SELECT match_row.round_id, round.name, round.round_number
  INTO v_round_id, v_round_name, v_round_number
  FROM public.tournament_matches match_row
  JOIN public.tournament_rounds round ON round.id = match_row.round_id
  WHERE match_row.fixture_version_id = p_fixture_version_id
    AND match_row.phase_id = p_phase_id
    AND (p_group_id IS NULL OR match_row.group_id = p_group_id)
    AND match_row.status IN ('scheduled', 'ready')
    AND match_row.scheduled_at >= now()
    AND match_row.home_participant_id IS NOT NULL
    AND match_row.away_participant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_match_operations operation
      WHERE operation.match_id = match_row.id AND operation.status = 'official'
    )
  ORDER BY match_row.scheduled_at, round.round_number, match_row.match_number
  LIMIT 1;

  IF v_round_id IS NULL THEN
    RETURN jsonb_build_object(
      'semantics', 'next_scheduled_unplayed_round',
      'roundId', null, 'roundName', null, 'roundNumber', null,
      'matches', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(jsonb_agg(row_payload ORDER BY scheduled_at, match_number), '[]'::jsonb)
  INTO v_matches
  FROM (
    SELECT
      match_row.scheduled_at,
      match_row.match_number,
      jsonb_build_object(
        'id', match_row.id,
        'matchNumber', match_row.match_number,
        'legNumber', match_row.leg_number,
        'status', match_row.status,
        'scheduledAt', match_row.scheduled_at,
        'timezone', venue.timezone,
        'roundId', match_row.round_id,
        'roundName', round.name,
        'roundNumber', round.round_number,
        'venueName', venue.name,
        'home', jsonb_build_object(
          'participantId', home.id,
          'name', home.snapshot_name,
          'shortName', home.snapshot_short_name,
          'shieldPath', home.snapshot_shield_path,
          'primaryColor', home.snapshot_primary_color
        ),
        'away', jsonb_build_object(
          'participantId', away.id,
          'name', away.snapshot_name,
          'shortName', away.snapshot_short_name,
          'shieldPath', away.snapshot_shield_path,
          'primaryColor', away.snapshot_primary_color
        ),
        'result', null
      ) AS row_payload
    FROM public.tournament_matches match_row
    JOIN public.tournament_rounds round ON round.id = match_row.round_id
    JOIN public.tournament_competition_participants home
      ON home.id = match_row.home_participant_id
    JOIN public.tournament_competition_participants away
      ON away.id = match_row.away_participant_id
    JOIN public.tournament_venues venue ON venue.id = match_row.venue_id
    WHERE match_row.fixture_version_id = p_fixture_version_id
      AND match_row.phase_id = p_phase_id
      AND match_row.round_id = v_round_id
      AND (p_group_id IS NULL OR match_row.group_id = p_group_id)
      AND match_row.status IN ('scheduled', 'ready')
      AND match_row.scheduled_at >= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.tournament_match_operations operation
        WHERE operation.match_id = match_row.id AND operation.status = 'official'
      )
  ) upcoming;

  RETURN jsonb_build_object(
    'semantics', 'next_scheduled_unplayed_round',
    'roundId', v_round_id,
    'roundName', v_round_name,
    'roundNumber', v_round_number,
    'matches', v_matches
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_social_snapshot(
  p_organization_id uuid, p_tournament_id uuid, p_category_id uuid,
  p_phase_id uuid, p_piece text, p_round_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scope jsonb;
  v_official jsonb;
  v_standings jsonb;
  v_statistics jsonb;
  v_player_candidates jsonb;
  v_next_fixture jsonb;
  v_round_name text;
  v_round_number integer;
  v_effective_round_id uuid;
  v_sport_modality text;
  v_team_size smallint;
  v_pieces text[] := ARRAY[
    'next_fixture','round_results','standings','scorers','discipline',
    'best_eleven','mvp','round_summary','semifinals','final','champion'
  ];
BEGIN
  IF NOT public.has_tournament_social_capability(p_organization_id, 'social.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_SOCIAL_FORBIDDEN';
  END IF;
  IF p_piece IS NULL OR NOT (p_piece = ANY(v_pieces)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_SOCIAL_PIECE_INVALID';
  END IF;

  v_scope := public.tournament_social_published_scope(
    p_organization_id, p_tournament_id, p_category_id, p_phase_id
  );
  IF v_scope IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE';
  END IF;

  SELECT coalesce(category.sport_modality, tournament.sport_modality),
    coalesce(category.team_size, tournament.team_size)
  INTO v_sport_modality, v_team_size
  FROM public.tournaments tournament
  JOIN public.tournament_categories category
    ON category.id = p_category_id
   AND category.tournament_id = tournament.id
   AND category.organization_id = tournament.organization_id
  WHERE tournament.id = p_tournament_id
    AND tournament.organization_id = p_organization_id;

  IF v_sport_modality IS NULL OR v_team_size IS NULL
    OR v_team_size <> ALL(ARRAY[5,6,7,8,9,11]::smallint[])
    OR NOT EXISTS (
      SELECT 1 FROM public.tournament_sport_modalities modality
      WHERE modality.code = v_sport_modality AND modality.team_size = v_team_size
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_SOCIAL_TEAM_FORMAT_INVALID';
  END IF;

  IF p_piece = 'next_fixture' THEN
    v_next_fixture := public.tournament_social_next_fixture(
      (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_group_id
    );
    v_effective_round_id := (v_next_fixture->>'roundId')::uuid;
    v_round_name := v_next_fixture->>'roundName';
    v_round_number := (v_next_fixture->>'roundNumber')::integer;
  ELSE
    v_effective_round_id := p_round_id;
    IF p_round_id IS NOT NULL THEN
      SELECT round.name, round.round_number
      INTO v_round_name, v_round_number
      FROM public.tournament_rounds round
      WHERE round.id = p_round_id
        AND round.fixture_version_id = (v_scope->>'fixtureVersionId')::uuid
        AND round.phase_id = p_phase_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE';
      END IF;
    END IF;
  END IF;

  IF p_piece IN ('standings','round_summary','champion') THEN
    v_standings := public.get_published_tournament_standings(
      p_tournament_id, p_category_id, p_phase_id, p_group_id
    );
  END IF;
  IF p_piece IN ('scorers','discipline','best_eleven','mvp','round_summary') THEN
    v_statistics := public.get_published_tournament_statistics(
      p_tournament_id, p_category_id, p_phase_id, p_group_id
    );
  END IF;
  IF p_piece IN ('best_eleven','mvp') THEN
    v_player_candidates := public.tournament_social_player_candidates(
      (v_scope->>'fixtureVersionId')::uuid,
      coalesce(v_statistics->'players', '[]'::jsonb)
    );
  END IF;

  v_official := CASE p_piece
    WHEN 'next_fixture' THEN jsonb_build_object(
      'semantics', v_next_fixture->>'semantics',
      'matches', coalesce(v_next_fixture->'matches', '[]'::jsonb)
    )
    WHEN 'round_results' THEN jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, true
      )
    )
    WHEN 'semifinals' THEN jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, false
      )
    )
    WHEN 'final' THEN jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, false
      )
    )
    WHEN 'standings' THEN jsonb_build_object(
      'revision', v_standings->'revision',
      'rows', coalesce(v_standings->'standings', '[]'::jsonb)
    )
    WHEN 'scorers' THEN jsonb_build_object(
      'revisionId', v_statistics->'revisionId',
      'players', coalesce((
        SELECT jsonb_agg(player)
        FROM jsonb_array_elements(coalesce(v_statistics->'players','[]'::jsonb)) player
        WHERE (player->>'goals')::integer > 0
      ), '[]'::jsonb)
    )
    WHEN 'discipline' THEN jsonb_build_object(
      'revisionId', v_statistics->'revisionId',
      'players', coalesce((
        SELECT jsonb_agg(player)
        FROM jsonb_array_elements(coalesce(v_statistics->'discipline','[]'::jsonb)) player
        WHERE (player->>'fairPlayPoints')::integer > 0
      ), '[]'::jsonb)
    )
    WHEN 'round_summary' THEN jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, true
      ),
      'leaders', coalesce((
        SELECT jsonb_agg(player)
        FROM jsonb_array_elements(coalesce(v_statistics->'players','[]'::jsonb)) player
        WHERE (player->>'goals')::integer > 0
        LIMIT 5
      ), '[]'::jsonb),
      'topOfTable', coalesce(v_standings->'standings'->0, 'null'::jsonb)
    )
    WHEN 'best_eleven' THEN jsonb_build_object(
      'requiresHumanSelection', true,
      'sportModality', v_sport_modality,
      'teamSize', v_team_size,
      'candidates', v_player_candidates
    )
    WHEN 'mvp' THEN jsonb_build_object(
      'requiresHumanSelection', true,
      'candidates', v_player_candidates
    )
    WHEN 'champion' THEN jsonb_build_object(
      'requiresHumanSelection', true,
      'officialChampion', (
        SELECT jsonb_build_object(
          'participantId', standing->>'participantId',
          'teamName', standing->>'teamName',
          'shortName', standing->>'shortName',
          'shieldPath', standing->>'shieldPath'
        )
        FROM jsonb_array_elements(coalesce(v_standings->'standings','[]'::jsonb)) standing
        WHERE (standing->>'position')::integer = 1
          AND EXISTS (
            SELECT 1 FROM public.tournaments tournament
            WHERE tournament.id = p_tournament_id AND tournament.status = 'completed'
          )
        LIMIT 1
      ),
      'candidates', coalesce(v_standings->'standings', '[]'::jsonb)
    )
  END;

  RETURN jsonb_build_object(
    'schemaVersion', 2,
    'piece', p_piece,
    'generatedAt', now(),
    'source', jsonb_build_object(
      'organizationId', p_organization_id,
      'tournamentId', p_tournament_id,
      'categoryId', p_category_id,
      'phaseId', p_phase_id,
      'groupId', p_group_id,
      'roundId', v_effective_round_id,
      'fixtureVersionId', v_scope->>'fixtureVersionId',
      'standingsRevisionId', coalesce(
        v_standings->'revision'->>'id', v_statistics->>'revisionId'
      ),
      'standingsRevisionNumber', v_standings->'revision'->>'number'
    ),
    'competition', jsonb_build_object(
      'organizationName', v_scope->>'organizationName',
      'tournamentName', v_scope->>'tournamentName',
      'categoryName', v_scope->>'categoryName',
      'phaseName', v_scope->>'phaseName',
      'roundName', v_round_name,
      'roundNumber', v_round_number,
      'sportModality', v_sport_modality,
      'teamSize', v_team_size
    ),
    'official', coalesce(v_official, '{}'::jsonb),
    'capabilities', to_jsonb(
      public.current_user_tournament_social_capabilities(p_organization_id)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_social_player_candidates(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_social_next_fixture(uuid,uuid,uuid) FROM PUBLIC;

COMMIT;
