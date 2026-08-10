-- Public, anonymous and read-only tournament pages.
--
-- Trust boundary:
--   * direct table access remains closed;
--   * authenticated publication management is capability checked server-side;
--   * anon receives one explicit sporting projection with no user identifiers,
--     contact data, administrative metadata, private storage paths or rosters;
--   * publication is opt-in and every public read revalidates the lifecycle.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tournament_public_pages (
  tournament_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  public_slug text NOT NULL,
  status text NOT NULL DEFAULT 'unpublished',
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL,
  unpublished_by uuid,
  unpublished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_public_pages_tournament_scope_fkey
    FOREIGN KEY (organization_id, tournament_id)
    REFERENCES public.tournaments (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT tournament_public_pages_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT tournament_public_pages_unpublished_by_fkey
    FOREIGN KEY (unpublished_by) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT tournament_public_pages_slug_check CHECK (
    public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$'
    AND char_length(public_slug) BETWEEN 3 AND 96
  ),
  CONSTRAINT tournament_public_pages_status_check CHECK (
    status IN ('published', 'unpublished')
  ),
  CONSTRAINT tournament_public_pages_lifecycle_check CHECK (
    (
      status = 'published'
      AND unpublished_by IS NULL
      AND unpublished_at IS NULL
    )
    OR
    (
      status = 'unpublished'
      AND unpublished_by IS NOT NULL
      AND unpublished_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_public_pages_slug_unique
  ON public.tournament_public_pages (public_slug);
CREATE INDEX IF NOT EXISTS tournament_public_pages_published_scope_idx
  ON public.tournament_public_pages (organization_id, tournament_id)
  WHERE status = 'published';

COMMENT ON TABLE public.tournament_public_pages IS
  'Opt-in publication state and stable public slug. Data remains private except through explicit public RPC projections.';

ALTER TABLE public.tournament_public_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_public_pages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tournament_public_pages TO service_role;

CREATE OR REPLACE FUNCTION public.get_tournament_public_page_settings(
  p_organization_id uuid,
  p_tournament_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_page public.tournament_public_pages%ROWTYPE;
  v_eligible boolean := false;
  v_reason text := 'tournament_unavailable';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF NOT public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.read'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  SELECT
    organization.status = 'active'
      AND season.status <> 'archived'
      AND tournament.status IN ('registration', 'scheduled', 'active', 'completed'),
    CASE
      WHEN organization.status <> 'active' THEN 'organization_inactive'
      WHEN season.status = 'archived' THEN 'season_archived'
      WHEN tournament.status NOT IN ('registration', 'scheduled', 'active', 'completed')
        THEN 'tournament_not_publishable'
      ELSE NULL
    END
  INTO v_eligible, v_reason
  FROM public.tournaments tournament
  JOIN public.tournament_organizations organization
    ON organization.id = tournament.organization_id
  JOIN public.tournament_seasons season
    ON season.id = tournament.season_id
   AND season.organization_id = tournament.organization_id
  WHERE tournament.id = p_tournament_id
    AND tournament.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;

  SELECT page.*
  INTO v_page
  FROM public.tournament_public_pages page
  WHERE page.tournament_id = p_tournament_id
    AND page.organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'published', COALESCE(v_page.status = 'published', false),
    'publicSlug', v_page.public_slug,
    'publicPath', CASE
      WHEN v_page.public_slug IS NULL THEN NULL
      ELSE '/torneos/publico/' || v_page.public_slug
    END,
    'publishedAt', v_page.published_at,
    'eligible', v_eligible,
    'unavailableReason', CASE WHEN v_eligible THEN NULL ELSE v_reason END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tournament_public_page_published(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_published boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament public.tournaments%ROWTYPE;
  v_organization public.tournament_organizations%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_page public.tournament_public_pages%ROWTYPE;
  v_candidate text;
  v_prefix text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF p_published IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_PUBLIC_PAGE_INVALID_STATE';
  END IF;
  IF NOT public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.update'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PUBLIC_PAGE_FORBIDDEN';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tournament_id::text, 20260810)
  );

  SELECT tournament.*
  INTO v_tournament
  FROM public.tournaments tournament
  WHERE tournament.id = p_tournament_id
    AND tournament.organization_id = p_organization_id
  FOR UPDATE;
  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_PUBLIC_PAGE_FORBIDDEN';
  END IF;

  SELECT organization.* INTO v_organization
  FROM public.tournament_organizations organization
  WHERE organization.id = p_organization_id;
  SELECT season.* INTO v_season
  FROM public.tournament_seasons season
  WHERE season.id = v_tournament.season_id
    AND season.organization_id = p_organization_id;

  IF p_published AND (
    v_organization.status <> 'active'
    OR v_season.status = 'archived'
    OR v_tournament.status NOT IN ('registration', 'scheduled', 'active', 'completed')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TORNEOS_PUBLIC_PAGE_NOT_PUBLISHABLE';
  END IF;

  SELECT page.*
  INTO v_page
  FROM public.tournament_public_pages page
  WHERE page.tournament_id = p_tournament_id
    AND page.organization_id = p_organization_id
  FOR UPDATE;

  IF p_published THEN
    IF v_page.tournament_id IS NULL THEN
      v_prefix := regexp_replace(
        left(v_organization.slug || '-' || v_tournament.slug, 82),
        '-+$',
        ''
      );
      LOOP
        v_candidate := v_prefix || '-' || left(
          replace(gen_random_uuid()::text, '-', ''),
          10
        );
        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM public.tournament_public_pages candidate
          WHERE candidate.public_slug = v_candidate
        );
      END LOOP;

      INSERT INTO public.tournament_public_pages (
        tournament_id,
        organization_id,
        public_slug,
        status,
        published_by,
        published_at
      ) VALUES (
        p_tournament_id,
        p_organization_id,
        v_candidate,
        'published',
        v_actor,
        now()
      )
      RETURNING * INTO v_page;
    ELSE
      UPDATE public.tournament_public_pages
      SET status = 'published',
          published_by = v_actor,
          published_at = now(),
          unpublished_by = NULL,
          unpublished_at = NULL,
          updated_at = now()
      WHERE tournament_id = p_tournament_id
      RETURNING * INTO v_page;
    END IF;
  ELSIF v_page.tournament_id IS NOT NULL THEN
    UPDATE public.tournament_public_pages
    SET status = 'unpublished',
        unpublished_by = v_actor,
        unpublished_at = now(),
        updated_at = now()
    WHERE tournament_id = p_tournament_id
    RETURNING * INTO v_page;
  END IF;

  IF v_page.tournament_id IS NOT NULL THEN
    PERFORM public.append_tournament_audit(
      p_organization_id,
      CASE WHEN p_published THEN 'public_page.published' ELSE 'public_page.unpublished' END,
      'tournament_public_page',
      p_tournament_id,
      NULL,
      p_tournament_id,
      jsonb_build_object('published', p_published)
    );
  END IF;

  RETURN public.get_tournament_public_page_settings(
    p_organization_id,
    p_tournament_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_tournament_page(
  p_public_slug text,
  p_category_slug text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_page public.tournament_public_pages%ROWTYPE;
  v_organization public.tournament_organizations%ROWTYPE;
  v_season public.tournament_seasons%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_category public.tournament_categories%ROWTYPE;
  v_fixture public.tournament_fixture_versions%ROWTYPE;
  v_categories jsonb := '[]'::jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_competition jsonb := '[]'::jsonb;
BEGIN
  IF p_public_slug IS NULL
    OR char_length(p_public_slug) NOT BETWEEN 3 AND 96
    OR p_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$'
    OR (
      p_category_slug IS NOT NULL
      AND (
        char_length(p_category_slug) NOT BETWEEN 2 AND 48
        OR p_category_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$'
      )
    )
  THEN
    RETURN NULL;
  END IF;

  SELECT page.*
  INTO v_page
  FROM public.tournament_public_pages page
  WHERE page.public_slug = p_public_slug
    AND page.status = 'published';
  IF v_page.tournament_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tournament.*
  INTO v_tournament
  FROM public.tournaments tournament
  WHERE tournament.id = v_page.tournament_id
    AND tournament.organization_id = v_page.organization_id
    AND tournament.status IN ('registration', 'scheduled', 'active', 'completed');
  IF v_tournament.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT organization.*
  INTO v_organization
  FROM public.tournament_organizations organization
  WHERE organization.id = v_page.organization_id
    AND organization.status = 'active';
  SELECT season.*
  INTO v_season
  FROM public.tournament_seasons season
  WHERE season.id = v_tournament.season_id
    AND season.organization_id = v_page.organization_id
    AND season.status <> 'archived';
  IF v_organization.id IS NULL OR v_season.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT category.*
  INTO v_category
  FROM public.tournament_categories category
  WHERE category.tournament_id = v_tournament.id
    AND category.organization_id = v_page.organization_id
    AND category.status = 'active'
    AND (p_category_slug IS NULL OR category.slug = p_category_slug)
  ORDER BY category.sort_order, category.name
  LIMIT 1;
  IF p_category_slug IS NOT NULL AND v_category.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', category.name,
    'slug', category.slug,
    'description', category.description,
    'hasPublishedFixture', EXISTS (
      SELECT 1
      FROM public.tournament_fixture_versions fixture
      WHERE fixture.tournament_id = v_tournament.id
        AND fixture.category_id = category.id
        AND fixture.status = 'published'
        AND fixture.invalidated_at IS NULL
    )
  ) ORDER BY category.sort_order, category.name), '[]'::jsonb)
  INTO v_categories
  FROM public.tournament_categories category
  WHERE category.tournament_id = v_tournament.id
    AND category.organization_id = v_page.organization_id
    AND category.status = 'active';

  IF v_category.id IS NOT NULL THEN
    SELECT fixture.*
    INTO v_fixture
    FROM public.tournament_fixture_versions fixture
    WHERE fixture.tournament_id = v_tournament.id
      AND fixture.category_id = v_category.id
      AND fixture.status = 'published'
      AND fixture.invalidated_at IS NULL
    ORDER BY fixture.published_at DESC, fixture.version_number DESC
    LIMIT 1;
  END IF;

  IF v_fixture.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'matchNumber', feed.match_number,
      'status', CASE WHEN feed.operation_id IS NOT NULL THEN 'official' ELSE feed.status END,
      'scheduledAt', feed.scheduled_at,
      'durationMinutes', feed.duration_minutes,
      'round', jsonb_build_object(
        'number', feed.round_number,
        'name', feed.round_name
      ),
      'phaseName', feed.phase_name,
      'groupName', feed.group_name,
      'venue', CASE WHEN feed.venue_name IS NULL THEN NULL ELSE jsonb_build_object(
        'name', feed.venue_name,
        'courtName', feed.court_name
      ) END,
      'home', jsonb_build_object(
        'name', feed.home_name,
        'shortName', feed.home_short_name,
        'shieldPath', feed.home_shield_path,
        'primaryColor', feed.home_primary_color,
        'secondaryColor', feed.home_secondary_color
      ),
      'away', jsonb_build_object(
        'name', feed.away_name,
        'shortName', feed.away_short_name,
        'shieldPath', feed.away_shield_path,
        'primaryColor', feed.away_primary_color,
        'secondaryColor', feed.away_secondary_color
      ),
      'result', CASE WHEN feed.operation_id IS NULL THEN NULL ELSE jsonb_build_object(
        'home', feed.home_score,
        'away', feed.away_score,
        'homePenalties', feed.home_penalties,
        'awayPenalties', feed.away_penalties,
        'outcomeType', feed.outcome_type,
        'officialAt', feed.official_at
      ) END
    ) ORDER BY feed.round_number, feed.match_number), '[]'::jsonb)
    INTO v_matches
    FROM (
      SELECT
        match_row.match_number,
        match_row.status,
        match_row.scheduled_at,
        match_row.duration_minutes,
        round_row.round_number,
        round_row.name AS round_name,
        phase.name AS phase_name,
        group_row.name AS group_name,
        venue.name AS venue_name,
        court.name AS court_name,
        home.snapshot_name AS home_name,
        home.snapshot_short_name AS home_short_name,
        home.snapshot_shield_path AS home_shield_path,
        home.snapshot_primary_color AS home_primary_color,
        home.snapshot_secondary_color AS home_secondary_color,
        away.snapshot_name AS away_name,
        away.snapshot_short_name AS away_short_name,
        away.snapshot_shield_path AS away_shield_path,
        away.snapshot_primary_color AS away_primary_color,
        away.snapshot_secondary_color AS away_secondary_color,
        operation.id AS operation_id,
        operation.official_at,
        outcome.outcome_type,
        score.home_score,
        score.away_score,
        score.home_penalties,
        score.away_penalties
      FROM public.tournament_matches match_row
      JOIN public.tournament_rounds round_row ON round_row.id = match_row.round_id
      JOIN public.tournament_phases phase ON phase.id = match_row.phase_id
      LEFT JOIN public.tournament_groups group_row ON group_row.id = match_row.group_id
      LEFT JOIN public.tournament_venues venue ON venue.id = match_row.venue_id
      LEFT JOIN public.tournament_courts court ON court.id = match_row.court_id
      LEFT JOIN public.tournament_competition_participants home
        ON home.id = match_row.home_participant_id
      LEFT JOIN public.tournament_competition_participants away
        ON away.id = match_row.away_participant_id
      LEFT JOIN LATERAL (
        SELECT official.id, official.official_at
        FROM public.tournament_match_operations official
        WHERE official.match_id = match_row.id
          AND official.status = 'official'
        ORDER BY official.operation_version DESC
        LIMIT 1
      ) operation ON true
      LEFT JOIN public.tournament_match_outcomes outcome
        ON outcome.match_operation_id = operation.id
      LEFT JOIN public.tournament_match_scores score
        ON score.match_operation_id = operation.id
      WHERE match_row.fixture_version_id = v_fixture.id
        AND match_row.status <> 'draft'
    ) feed;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', participant.snapshot_name,
      'shortName', participant.snapshot_short_name,
      'shieldPath', participant.snapshot_shield_path,
      'primaryColor', participant.snapshot_primary_color,
      'secondaryColor', participant.snapshot_secondary_color,
      'status', participant.status
    ) ORDER BY participant.snapshot_name), '[]'::jsonb)
    INTO v_teams
    FROM public.tournament_competition_participants participant
    WHERE participant.participant_set_id = v_fixture.participant_set_id
      AND participant.status IN ('active', 'withdrawn');

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'scopeKey', 'phase-' || phase.sequence_number::text || COALESCE(
        '-group-' || lower(group_row.code),
        ''
      ),
      'label', phase.name || COALESCE(' · ' || group_row.name, ''),
      'phaseName', phase.name,
      'groupName', group_row.name,
      'publishedAt', revision.published_at,
      'standings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'position', standing.position,
          'teamName', participant.snapshot_name,
          'shortName', participant.snapshot_short_name,
          'shieldPath', participant.snapshot_shield_path,
          'played', standing.played,
          'won', standing.won,
          'drawn', standing.drawn,
          'lost', standing.lost,
          'goalsFor', standing.goals_for,
          'goalsAgainst', standing.goals_against,
          'goalDifference', standing.goal_difference,
          'points', standing.points
        ) ORDER BY standing.position, participant.snapshot_name)
        FROM public.tournament_team_standings standing
        JOIN public.tournament_competition_participants participant
          ON participant.id = standing.participant_id
        WHERE standing.revision_id = revision.id
      ), '[]'::jsonb),
      'players', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', player.display_name,
          'teamName', participant.snapshot_name,
          'goals', statistic.goals,
          'assists', statistic.assists,
          'appearances', statistic.appearances,
          'yellowCards', statistic.yellow_cards,
          'redCards', statistic.red_cards + statistic.second_yellows
        ) ORDER BY statistic.goals DESC, statistic.assists DESC, player.display_name)
        FROM public.tournament_player_statistics statistic
        JOIN public.tournament_roster_players player
          ON player.id = statistic.roster_player_id
        JOIN public.tournament_competition_participants participant
          ON participant.participant_set_id = v_fixture.participant_set_id
         AND participant.team_entry_id = statistic.team_entry_id
        WHERE statistic.revision_id = revision.id
      ), '[]'::jsonb),
      'discipline', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', player.display_name,
          'teamName', participant.snapshot_name,
          'yellowCards', ledger.yellow_cards,
          'redCards', ledger.direct_reds + ledger.second_yellows,
          'suspensions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'totalMatches', suspension.total_matches,
              'servedMatches', suspension.served_matches,
              'remainingMatches', greatest(
                suspension.total_matches - suspension.served_matches,
                0
              ),
              'status', suspension.status
            ) ORDER BY suspension.created_at)
            FROM public.tournament_player_suspensions suspension
            WHERE suspension.revision_id = revision.id
              AND suspension.roster_player_id = ledger.roster_player_id
              AND suspension.status IN ('active', 'reduced', 'served')
          ), '[]'::jsonb)
        ) ORDER BY ledger.fair_play_points DESC, player.display_name)
        FROM public.tournament_discipline_ledgers ledger
        JOIN public.tournament_roster_players player
          ON player.id = ledger.roster_player_id
        JOIN public.tournament_competition_participants participant
          ON participant.participant_set_id = v_fixture.participant_set_id
         AND participant.team_entry_id = ledger.team_entry_id
        WHERE ledger.revision_id = revision.id
      ), '[]'::jsonb)
    ) ORDER BY phase.sequence_number, group_row.sort_order NULLS FIRST), '[]'::jsonb)
    INTO v_competition
    FROM public.tournament_standings_revisions revision
    JOIN public.tournament_phases phase
      ON phase.id = revision.phase_id
     AND phase.fixture_version_id = v_fixture.id
     AND phase.status <> 'archived'
    LEFT JOIN public.tournament_groups group_row
      ON group_row.id = revision.group_id
     AND group_row.status = 'published'
    WHERE revision.fixture_version_id = v_fixture.id
      AND revision.status = 'published';
  END IF;

  RETURN jsonb_build_object(
    'publicSlug', v_page.public_slug,
    'organization', jsonb_build_object('name', v_organization.name),
    'season', jsonb_build_object('name', v_season.name),
    'tournament', jsonb_build_object(
      'name', v_tournament.name,
      'description', v_tournament.description,
      'status', v_tournament.status,
      'sportModality', v_tournament.sport_modality,
      'competitionFormat', v_tournament.competition_format,
      'genderCategory', v_tournament.gender_category,
      'startDate', v_tournament.start_date,
      'endDate', v_tournament.end_date
    ),
    'categories', v_categories,
    'selectedCategory', CASE WHEN v_category.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', v_category.name,
      'slug', v_category.slug,
      'description', v_category.description
    ) END,
    'hasPublishedFixture', v_fixture.id IS NOT NULL,
    'matches', v_matches,
    'teams', v_teams,
    'competition', v_competition
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_tournament_page(text, text) IS
  'Anonymous public-safe sporting projection. Returns NULL unless publication and lifecycle checks pass.';

REVOKE ALL ON FUNCTION public.get_tournament_public_page_settings(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tournament_public_page_published(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_tournament_page(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_tournament_public_page_settings(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_public_page_published(uuid, uuid, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_page(text, text)
  TO anon, authenticated, service_role;

COMMIT;
