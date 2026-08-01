-- Tournament context getters are projections. Persisting an explicit selection
-- remains the responsibility of set_tournament_workspace_preference() and
-- set_active_tournament_context().

BEGIN;

CREATE OR REPLACE FUNCTION "public"."get_tournament_workspace_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_preference public.user_workspace_preferences%rowtype;
  v_effective_workspace_type text;
  v_effective_organization_id uuid;
  v_organizations jsonb;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  select preference.*
  into v_preference
  from public.user_workspace_preferences preference
  where preference.user_id = v_user_id;

  if v_preference.user_id is null
    or (
      v_preference.workspace_type = 'tournament_organization'
      and not public.has_tournament_organization_capability(
        v_preference.active_organization_id,
        'workspace.access'
      )
    )
  then
    v_effective_workspace_type := 'personal';
    v_effective_organization_id := null;
  else
    v_effective_workspace_type := v_preference.workspace_type;
    v_effective_organization_id := v_preference.active_organization_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'slug', organization.slug,
        'logoPath', organization.logo_path,
        'status', organization.status,
        'createdAt', organization.created_at,
        'role', membership.role,
        'membershipStatus', membership.status,
        'joinedAt', membership.joined_at,
        'capabilities', to_jsonb(
          public.tournament_role_capabilities(membership.role)
        )
      )
      order by lower(organization.name), organization.id
    ),
    '[]'::jsonb
  )
  into v_organizations
  from public.tournament_organization_members membership
  join public.tournament_organizations organization
    on organization.id = membership.organization_id
  where membership.user_id = v_user_id
    and membership.status = 'active'
    and organization.status = 'active';

  return jsonb_build_object(
    'preference', jsonb_build_object(
      'workspaceType', v_effective_workspace_type,
      'activeOrganizationId', v_effective_organization_id,
      'updatedAt', v_preference.updated_at
    ),
    'organizations', v_organizations
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_tournament_competition_context"("p_organization_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_preference public.user_tournament_context_preferences%rowtype;
  v_effective_season_id uuid;
  v_effective_tournament_id uuid;
  v_seasons jsonb;
  v_tournaments jsonb;
  v_modalities jsonb;
  v_formats jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.read'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select preference.* into v_preference
  from public.user_tournament_context_preferences preference
  where preference.user_id = v_user_id
    and preference.organization_id = p_organization_id;

  if v_preference.user_id is not null
    and (
      v_preference.active_season_id is null
      or exists (
        select 1 from public.tournament_seasons season
        where season.id = v_preference.active_season_id
          and season.organization_id = p_organization_id
          and season.status <> 'archived'
      )
    )
    and (
      v_preference.active_tournament_id is null
      or exists (
        select 1 from public.tournaments tournament
        where tournament.id = v_preference.active_tournament_id
          and tournament.organization_id = p_organization_id
          and tournament.season_id = v_preference.active_season_id
          and tournament.status <> 'archived'
      )
    )
  then
    v_effective_season_id := v_preference.active_season_id;
    v_effective_tournament_id := v_preference.active_tournament_id;
  else
    select tournament.season_id, tournament.id
    into v_effective_season_id, v_effective_tournament_id
    from public.tournaments tournament
    join public.tournament_seasons season on season.id = tournament.season_id
    where tournament.organization_id = p_organization_id
      and tournament.status <> 'archived'
      and season.status <> 'archived'
    order by tournament.updated_at desc, tournament.id
    limit 1;

    if v_effective_season_id is null then
      select season.id
      into v_effective_season_id
      from public.tournament_seasons season
      where season.organization_id = p_organization_id
        and season.status <> 'archived'
      order by season.updated_at desc, season.id
      limit 1;
      v_effective_tournament_id := null;
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', modality.code,
      'name', modality.name,
      'teamSize', modality.team_size,
      'recommendedSubstitutes', modality.recommended_substitutes,
      'teamOfRoundSize', modality.team_of_round_size,
      'suggestedDurationMinutes', modality.suggested_duration_minutes,
      'requiresGoalkeeper', modality.requires_goalkeeper
    ) order by modality.team_size
  ), '[]'::jsonb)
  into v_modalities
  from public.tournament_sport_modalities modality;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', format.code,
      'name', format.name,
      'description', format.description
    ) order by case format.code
      when 'league' then 1
      when 'knockout' then 2
      when 'groups' then 3
      when 'groups_and_playoffs' then 4
      else 5
    end
  ), '[]'::jsonb)
  into v_formats
  from public.tournament_competition_formats format;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', season.id,
      'organizationId', season.organization_id,
      'name', season.name,
      'slug', season.slug,
      'status', season.status,
      'startDate', season.start_date,
      'endDate', season.end_date,
      'createdAt', season.created_at,
      'updatedAt', season.updated_at
    ) order by season.updated_at desc, season.id
  ), '[]'::jsonb)
  into v_seasons
  from public.tournament_seasons season
  where season.organization_id = p_organization_id
    and season.status <> 'archived';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', tournament.id,
      'organizationId', tournament.organization_id,
      'seasonId', tournament.season_id,
      'name', tournament.name,
      'slug', tournament.slug,
      'description', tournament.description,
      'status', tournament.status,
      'sportModality', tournament.sport_modality,
      'competitionFormat', tournament.competition_format,
      'genderCategory', tournament.gender_category,
      'teamSize', tournament.team_size,
      'substitutesLimit', tournament.substitutes_limit,
      'startDate', tournament.start_date,
      'endDate', tournament.end_date,
      'registrationOpensAt', tournament.registration_opens_at,
      'registrationClosesAt', tournament.registration_closes_at,
      'formatSettings', tournament.format_settings,
      'createdAt', tournament.created_at,
      'updatedAt', tournament.updated_at,
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', category.id,
          'name', category.name,
          'slug', category.slug,
          'description', category.description,
          'status', category.status,
          'sortOrder', category.sort_order,
          'minAge', category.min_age,
          'maxAge', category.max_age,
          'genderCategory', category.gender_category,
          'sportModality', category.sport_modality,
          'teamSize', category.team_size
        ) order by category.sort_order, category.created_at)
        from public.tournament_categories category
        where category.tournament_id = tournament.id
          and category.organization_id = p_organization_id
          and category.status = 'active'
      ), '[]'::jsonb),
      'scoring', (
        select jsonb_build_object(
          'pointsWin', scoring.points_win,
          'pointsDraw', scoring.points_draw,
          'pointsLoss', scoring.points_loss,
          'pointsWalkoverWin', scoring.points_walkover_win,
          'pointsWalkoverLoss', scoring.points_walkover_loss,
          'allowManualPointsAdjustment', scoring.allow_manual_points_adjustment,
          'allowAdministrativeResult', scoring.allow_administrative_result
        )
        from public.tournament_scoring_rules scoring
        where scoring.tournament_id = tournament.id
          and scoring.organization_id = p_organization_id
      ),
      'tiebreaks', coalesce((
        select jsonb_agg(tiebreak.criterion order by tiebreak.sort_order)
        from public.tournament_tiebreak_rules tiebreak
        where tiebreak.tournament_id = tournament.id
          and tiebreak.organization_id = p_organization_id
      ), '[]'::jsonb),
      'discipline', (
        select jsonb_build_object(
          'yellowsForSuspension', discipline.yellows_for_suspension,
          'suspensionMatches', discipline.suspension_matches,
          'directRedSuggestedMatches', discipline.direct_red_suggested_matches,
          'doubleYellowCountsAsRed', discipline.double_yellow_counts_as_red,
          'resetYellowsEachStage', discipline.reset_yellows_each_stage,
          'fairPlayEnabled', discipline.fair_play_enabled,
          'yellowFairPlayPoints', discipline.yellow_fair_play_points,
          'redFairPlayPoints', discipline.red_fair_play_points
        )
        from public.tournament_discipline_rules discipline
        where discipline.tournament_id = tournament.id
          and discipline.organization_id = p_organization_id
      ),
      'checklist', public.tournament_registration_checklist(
        p_organization_id,
        tournament.id
      )
    ) order by tournament.updated_at desc, tournament.id
  ), '[]'::jsonb)
  into v_tournaments
  from public.tournaments tournament
  join public.tournament_seasons season
    on season.id = tournament.season_id
    and season.organization_id = tournament.organization_id
  where tournament.organization_id = p_organization_id
    and tournament.status <> 'archived'
    and season.status <> 'archived';

  return jsonb_build_object(
    'preference', jsonb_build_object(
      'organizationId', p_organization_id,
      'activeSeasonId', v_effective_season_id,
      'activeTournamentId', v_effective_tournament_id,
      'updatedAt', v_preference.updated_at
    ),
    'seasons', v_seasons,
    'tournaments', v_tournaments,
    'modalities', v_modalities,
    'formats', v_formats
  );
end;
$$;

COMMIT;
