-- Arma2 Torneos · Estudio Social
--
-- Typed, versioned snapshots for graphic pieces. The renderer is deterministic
-- and lives in the browser; what this migration provides is the only data it is
-- allowed to draw.
--
-- Three rules are enforced here rather than trusted to the client:
--
--   * PUBLISHED ONLY. A snapshot is assembled from a published fixture version
--     and a published standings revision. A draft table, an unvalidated result,
--     a private note, rival availability or anything in `tournament_audit_log`
--     is structurally unreachable — the queries never join to them.
--   * NO RECOMPUTATION. Standings, scorers and discipline come from
--     `get_published_tournament_standings` and
--     `get_published_tournament_statistics`, the existing official projections.
--     There is no second implementation of a tiebreak anywhere.
--   * NO AUTOMATIC EDITORIAL JUDGEMENT. Best eleven, MVP and champion return
--     CANDIDATES plus, where one exists, the officially decided outcome. The
--     database never ranks players into an ideal team and never picks a figure
--     of the match.
--
-- Every snapshot carries the revision it was built from, so a piece exported
-- today can be traced to the exact official state it depicts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------------
-- Owner and admin get the full studio. A collaborator sees it read-only unless
-- an owner/admin grants them export explicitly — the sporting permission model
-- is not touched, and no role gains anything outside the studio.

CREATE TABLE IF NOT EXISTS "public"."tournament_social_permissions" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "can_export" boolean DEFAULT false NOT NULL,
    "granted_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tournament_social_permissions_pkey"
      PRIMARY KEY ("organization_id", "user_id"),
    CONSTRAINT "tournament_social_permissions_organization_fk"
      FOREIGN KEY ("organization_id")
      REFERENCES "public"."tournament_organizations"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."tournament_social_permissions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."tournament_social_permissions" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."tournament_social_permissions" FROM "anon";
REVOKE ALL ON TABLE "public"."tournament_social_permissions" FROM "authenticated";

COMMENT ON TABLE "public"."tournament_social_permissions" IS
  'Explicit Estudio Social export grant for collaborators. Owner/admin never need a row.';

CREATE OR REPLACE FUNCTION "public"."tournament_social_role_capabilities"("p_role" "text")
  RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_role
    when 'owner' then array[
      'social.read','social.create','social.export',
      'social.manual_selection','social.editorial_text','social.brand_toggle',
      'social.manage_permissions'
    ]::text[]
    when 'admin' then array[
      'social.read','social.create','social.export',
      'social.manual_selection','social.editorial_text','social.brand_toggle',
      'social.manage_permissions'
    ]::text[]
    -- A collaborator can always look. Creating and exporting needs a grant.
    when 'collaborator' then array['social.read']::text[]
    else array[]::text[]
  end;
$$;

CREATE OR REPLACE FUNCTION "public"."current_user_tournament_social_capabilities"(
  "p_organization_id" "uuid"
) RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce((
    select public.tournament_social_role_capabilities(membership.role)
      || case
        when membership.role = 'collaborator' and coalesce(grant_row.can_export, false)
        then array['social.create','social.export','social.editorial_text']::text[]
        else array[]::text[]
      end
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    left join public.tournament_social_permissions grant_row
      on grant_row.organization_id = membership.organization_id
     and grant_row.user_id = membership.user_id
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      -- Suspended and removed members hold nothing, whatever their grant says.
      and membership.status = 'active'
      and organization.status = 'active'
  ), array[]::text[]);
$$;

CREATE OR REPLACE FUNCTION "public"."has_tournament_social_capability"(
  "p_organization_id" "uuid", "p_capability" "text"
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null and p_capability = any(
    public.current_user_tournament_social_capabilities(p_organization_id)
  );
$$;

CREATE OR REPLACE FUNCTION "public"."set_tournament_social_permission"(
  "p_organization_id" "uuid", "p_user_id" "uuid", "p_can_export" boolean
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_role text;
begin
  if not public.has_tournament_social_capability(
    p_organization_id, 'social.manage_permissions'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_FORBIDDEN';
  end if;
  select membership.role into v_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
    and membership.status = 'active';
  if v_role is distinct from 'collaborator' then
    -- Owners and admins already hold everything; nobody else is a member.
    raise exception using errcode = '22023', message = 'TORNEOS_SOCIAL_GRANT_INVALID';
  end if;
  insert into public.tournament_social_permissions (
    organization_id, user_id, can_export, granted_by
  ) values (
    p_organization_id, p_user_id, coalesce(p_can_export, false), auth.uid()
  ) on conflict (organization_id, user_id) do update set
    can_export = excluded.can_export,
    granted_by = excluded.granted_by,
    updated_at = now();
  perform public.append_tournament_audit(
    p_organization_id,
    case when coalesce(p_can_export, false)
      then 'social.export.granted' else 'social.export.revoked' end,
    'organization_member', p_user_id, null, null, '{}'::jsonb
  );
  return jsonb_build_object(
    'organizationId', p_organization_id, 'userId', p_user_id,
    'canExport', coalesce(p_can_export, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Scope resolution
-- ---------------------------------------------------------------------------
-- One helper, so every piece resolves its competition scope the same way and
-- an unpublished fixture can never become the source of a graphic.

CREATE OR REPLACE FUNCTION "public"."tournament_social_published_scope"(
  "p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid",
  "p_phase_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'fixtureVersionId', fixture.id,
    'phaseId', phase.id,
    'phaseName', phase.name,
    'organizationName', organization.name,
    'tournamentName', tournament.name,
    'categoryName', category.name
  )
  from public.tournament_fixture_versions fixture
  join public.tournament_phases phase
    on phase.fixture_version_id = fixture.id
   and phase.id = p_phase_id
   and phase.status <> 'archived'
  join public.tournaments tournament on tournament.id = fixture.tournament_id
  join public.tournament_categories category on category.id = fixture.category_id
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
  where fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.organization_id = p_organization_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  limit 1;
$$;

-- Match projection shared by fixture, results, semifinals, final and summary.
-- Only official scores are ever exposed: an operation that is not `official`
-- contributes a match with no result, never a provisional one.
CREATE OR REPLACE FUNCTION "public"."tournament_social_match_rows"(
  "p_fixture_version_id" "uuid", "p_phase_id" "uuid", "p_round_id" "uuid",
  "p_only_played" boolean
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(jsonb_agg(row_payload order by sort_key), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', match.id,
        'matchNumber', match.match_number,
        'legNumber', match.leg_number,
        'status', match.status,
        'scheduledAt', match.scheduled_at,
        'roundId', match.round_id,
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
        'result', case when operation.id is null then null else jsonb_build_object(
          'homeScore', score.home_score,
          'awayScore', score.away_score,
          'homePenalties', score.home_penalties,
          'awayPenalties', score.away_penalties,
          'outcomeType', outcome.outcome_type,
          'officialAt', operation.official_at
        ) end
      ) as row_payload,
      (round.round_number, match.match_number) as sort_key
    from public.tournament_matches match
    join public.tournament_rounds round on round.id = match.round_id
    left join public.tournament_competition_participants home
      on home.id = match.home_participant_id
    left join public.tournament_competition_participants away
      on away.id = match.away_participant_id
    left join public.tournament_venues venue on venue.id = match.venue_id
    left join public.tournament_match_operations operation
      on operation.match_id = match.id
     and operation.status = 'official'
    left join public.tournament_match_scores score
      on score.match_operation_id = operation.id
    left join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = operation.id
    where match.fixture_version_id = p_fixture_version_id
      and match.phase_id = p_phase_id
      and match.status <> 'cancelled'
      and (p_round_id is null or match.round_id = p_round_id)
      and (not p_only_played or operation.id is not null)
      and home.id is not null
      and away.id is not null
  ) rows;
$$;

-- ---------------------------------------------------------------------------
-- 3. Snapshots
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."get_tournament_social_snapshot"(
  "p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid",
  "p_phase_id" "uuid", "p_piece" "text", "p_round_id" "uuid" DEFAULT NULL::"uuid",
  "p_group_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_scope jsonb;
  v_official jsonb;
  v_standings jsonb;
  v_statistics jsonb;
  v_round record;
  v_pieces text[] := array[
    'next_fixture','round_results','standings','scorers','discipline',
    'best_eleven','mvp','round_summary','semifinals','final','champion'
  ];
begin
  if not public.has_tournament_social_capability(p_organization_id, 'social.read') then
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_FORBIDDEN';
  end if;
  if p_piece is null or not (p_piece = any(v_pieces)) then
    raise exception using errcode = '22023', message = 'TORNEOS_SOCIAL_PIECE_INVALID';
  end if;
  v_scope := public.tournament_social_published_scope(
    p_organization_id, p_tournament_id, p_category_id, p_phase_id
  );
  if v_scope is null then
    -- No published fixture for this scope: there is nothing official to draw.
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE';
  end if;
  if p_round_id is not null then
    select round.id, round.name, round.round_number, round.starts_at
    into v_round
    from public.tournament_rounds round
    where round.id = p_round_id
      and round.fixture_version_id = (v_scope->>'fixtureVersionId')::uuid
      and round.phase_id = p_phase_id;
    if v_round.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE';
    end if;
  end if;

  if p_piece in ('standings','round_summary','champion') then
    v_standings := public.get_published_tournament_standings(
      p_tournament_id, p_category_id, p_phase_id, p_group_id
    );
  end if;
  if p_piece in ('scorers','discipline','best_eleven','mvp','round_summary') then
    v_statistics := public.get_published_tournament_statistics(
      p_tournament_id, p_category_id, p_phase_id, p_group_id
    );
  end if;

  v_official := case p_piece
    when 'next_fixture' then jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, false
      )
    )
    when 'round_results' then jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, true
      )
    )
    when 'semifinals' then jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, false
      )
    )
    when 'final' then jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, false
      )
    )
    when 'standings' then jsonb_build_object(
      'revision', v_standings->'revision',
      'rows', coalesce(v_standings->'standings', '[]'::jsonb)
    )
    when 'scorers' then jsonb_build_object(
      'revisionId', v_statistics->'revisionId',
      'players', coalesce((
        select jsonb_agg(player)
        from jsonb_array_elements(coalesce(v_statistics->'players','[]'::jsonb)) player
        where (player->>'goals')::integer > 0
      ), '[]'::jsonb)
    )
    when 'discipline' then jsonb_build_object(
      'revisionId', v_statistics->'revisionId',
      'players', coalesce((
        select jsonb_agg(player)
        from jsonb_array_elements(coalesce(v_statistics->'discipline','[]'::jsonb)) player
        where (player->>'fairPlayPoints')::integer > 0
      ), '[]'::jsonb)
    )
    when 'round_summary' then jsonb_build_object(
      'matches', public.tournament_social_match_rows(
        (v_scope->>'fixtureVersionId')::uuid, p_phase_id, p_round_id, true
      ),
      'leaders', coalesce((
        select jsonb_agg(player)
        from jsonb_array_elements(coalesce(v_statistics->'players','[]'::jsonb)) player
        where (player->>'goals')::integer > 0
        limit 5
      ), '[]'::jsonb),
      'topOfTable', coalesce(v_standings->'standings'->0, 'null'::jsonb)
    )
    -- Human curation required. The database hands over the eligible people and
    -- stops: it does not rank an ideal eleven and it does not elect a figure.
    when 'best_eleven' then jsonb_build_object(
      'requiresHumanSelection', true,
      'candidates', coalesce(v_statistics->'players', '[]'::jsonb)
    )
    when 'mvp' then jsonb_build_object(
      'requiresHumanSelection', true,
      'candidates', coalesce(v_statistics->'players', '[]'::jsonb)
    )
    when 'champion' then jsonb_build_object(
      'requiresHumanSelection', true,
      -- Only an actually decided competition yields an official champion.
      'officialChampion', (
        select jsonb_build_object(
          'participantId', standing->>'participantId',
          'teamName', standing->>'teamName',
          'shortName', standing->>'shortName',
          'shieldPath', standing->>'shieldPath'
        )
        from jsonb_array_elements(coalesce(v_standings->'standings','[]'::jsonb)) standing
        where (standing->>'position')::integer = 1
          and exists (
            select 1 from public.tournaments tournament
            where tournament.id = p_tournament_id
              and tournament.status = 'completed'
          )
        limit 1
      ),
      'candidates', coalesce(v_standings->'standings', '[]'::jsonb)
    )
  end;

  return jsonb_build_object(
    'schemaVersion', 1,
    'piece', p_piece,
    'generatedAt', now(),
    'source', jsonb_build_object(
      'organizationId', p_organization_id,
      'tournamentId', p_tournament_id,
      'categoryId', p_category_id,
      'phaseId', p_phase_id,
      'groupId', p_group_id,
      'roundId', p_round_id,
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
      'roundName', v_round.name,
      'roundNumber', v_round.round_number
    ),
    'official', coalesce(v_official, '{}'::jsonb),
    'capabilities', to_jsonb(
      public.current_user_tournament_social_capabilities(p_organization_id)
    )
  );
end;
$$;

-- Everything the studio needs to offer a scope selector, in one read.
CREATE OR REPLACE FUNCTION "public"."get_tournament_social_studio_context"(
  "p_organization_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_capabilities text[];
begin
  v_capabilities := public.current_user_tournament_social_capabilities(p_organization_id);
  if not ('social.read' = any(v_capabilities)) then
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_FORBIDDEN';
  end if;
  return jsonb_build_object(
    'capabilities', to_jsonb(v_capabilities),
    'brand', jsonb_build_object(
      'organizationName', (
        select name from public.tournament_organizations
        where id = p_organization_id
      ),
      'canHideArma2Logo', 'social.brand_toggle' = any(v_capabilities)
    ),
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'categories', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'phases', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', phase.id,
                'name', phase.name,
                'kind', phase.phase_type,
                'fixtureVersionId', fixture.id,
                'rounds', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'id', round.id, 'name', round.name,
                    'number', round.round_number, 'startsAt', round.starts_at
                  ) order by round.round_number), '[]'::jsonb)
                  from public.tournament_rounds round
                  where round.phase_id = phase.id
                    and round.fixture_version_id = fixture.id
                )
              ) order by phase.sequence_number), '[]'::jsonb)
              from public.tournament_phases phase
              where phase.fixture_version_id = fixture.id
                and phase.status <> 'archived'
            )
          ) order by category.sort_order, category.name), '[]'::jsonb)
          from public.tournament_categories category
          join public.tournament_fixture_versions fixture
            on fixture.category_id = category.id
           and fixture.status = 'published'
           and fixture.invalidated_at is null
          where category.tournament_id = tournament.id
            and category.status = 'active'
        )
      ) order by tournament.updated_at desc)
      from public.tournaments tournament
      where tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- The studio is an authenticated organiser surface, so its two getters and the
-- permission mutator are the only client-callable contracts. Helpers stay
-- internal.

REVOKE ALL ON FUNCTION "public"."tournament_social_role_capabilities"("p_role" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."current_user_tournament_social_capabilities"("p_organization_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."has_tournament_social_capability"("p_organization_id" "uuid", "p_capability" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_social_published_scope"("p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid", "p_phase_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_social_match_rows"("p_fixture_version_id" "uuid", "p_phase_id" "uuid", "p_round_id" "uuid", "p_only_played" boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_tournament_social_snapshot"("p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid", "p_phase_id" "uuid", "p_piece" "text", "p_round_id" "uuid", "p_group_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_tournament_social_studio_context"("p_organization_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_tournament_social_permission"("p_organization_id" "uuid", "p_user_id" "uuid", "p_can_export" boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."tournament_social_role_capabilities"("p_role" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."current_user_tournament_social_capabilities"("p_organization_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_tournament_social_capability"("p_organization_id" "uuid", "p_capability" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_social_published_scope"("p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid", "p_phase_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_social_match_rows"("p_fixture_version_id" "uuid", "p_phase_id" "uuid", "p_round_id" "uuid", "p_only_played" boolean) TO "service_role";

GRANT ALL ON FUNCTION "public"."get_tournament_social_snapshot"("p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid", "p_phase_id" "uuid", "p_piece" "text", "p_round_id" "uuid", "p_group_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_tournament_social_snapshot"("p_organization_id" "uuid", "p_tournament_id" "uuid", "p_category_id" "uuid", "p_phase_id" "uuid", "p_piece" "text", "p_round_id" "uuid", "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tournament_social_studio_context"("p_organization_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_tournament_social_studio_context"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tournament_social_permission"("p_organization_id" "uuid", "p_user_id" "uuid", "p_can_export" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_tournament_social_permission"("p_organization_id" "uuid", "p_user_id" "uuid", "p_can_export" boolean) TO "authenticated";

COMMIT;
