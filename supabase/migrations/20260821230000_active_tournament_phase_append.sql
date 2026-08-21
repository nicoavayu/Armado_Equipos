-- Arma2 Torneos: append de una fase Playoffs sobre el fixture oficial.
--
-- Una fase posterior pertenece a la misma edición, categoría y versión oficial.
-- La operación agrega filas nuevas; nunca clona, reemplaza ni invalida fases,
-- jornadas, partidos, resultados o actas ya publicados.

-- El generador knockout ya es la autoridad para llaves, byes, series y fuentes.
-- Su contrato interno se amplía para que una RPC aditiva pueda usarlo sobre la
-- versión publicada. La función sigue sin EXECUTE para roles del browser.
create or replace function public.build_tournament_knockout(
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_sources jsonb,
  p_double_leg boolean,
  p_third_place boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_source_count integer;
  v_bracket_size integer := 1;
  v_slots jsonb;
  v_round_size integer;
  v_round_number integer := 0;
  v_tie integer;
  v_leg integer;
  v_round_id uuid;
  v_match_id uuid;
  v_match_number integer;
  v_duration integer;
  v_home_source jsonb;
  v_away_source jsonb;
  v_previous_sources jsonb := '[]'::jsonb;
  v_current_sources jsonb;
  v_advancement_source jsonb;
  v_loser_source jsonb;
  v_semifinal_loser_sources jsonb := '[]'::jsonb;
  v_last_match_id uuid;
  v_tie_key text;
  v_index integer;
  v_legs integer;
begin
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id
    and version.status in ('draft', 'published');
  if v_version.id is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_KNOCKOUT';
  end if;
  v_source_count := jsonb_array_length(p_sources);
  if v_source_count < 2 or v_source_count > 64 then
    raise exception using errcode = '23514', message = 'TORNEOS_NOT_ENOUGH_PARTICIPANTS';
  end if;
  while v_bracket_size < v_source_count loop
    v_bracket_size := v_bracket_size * 2;
  end loop;
  v_slots := '[]'::jsonb;
  for v_index in 0..v_bracket_size - 1 loop
    v_slots := v_slots || jsonb_build_array(jsonb_build_object('type', 'bye'));
  end loop;
  for v_index in 0..v_source_count - 1 loop
    v_slots := jsonb_set(
      v_slots,
      array[case
        when v_index < (v_bracket_size / 2)
          then (v_index * 2)::text
        else ((v_index - (v_bracket_size / 2)) * 2 + 1)::text
      end],
      p_sources->v_index
    );
  end loop;
  select modality.suggested_duration_minutes into v_duration
  from public.tournaments tournament
  join public.tournament_sport_modalities modality
    on modality.code = tournament.sport_modality
  where tournament.id = v_version.tournament_id;
  select coalesce(max(match_row.match_number), 0) into v_match_number
  from public.tournament_matches match_row
  where match_row.fixture_version_id = p_fixture_version_id;
  v_round_size := v_bracket_size;
  while v_round_size >= 2 loop
    v_round_number := v_round_number + 1;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, p_phase_id, v_round_number,
      case v_round_size
        when 2 then 'Final'
        when 4 then 'Semifinal'
        when 8 then 'Cuartos de final'
        when 16 then 'Octavos de final'
        when 32 then 'Dieciseisavos de final'
        else 'Ronda de ' || v_round_size
      end,
      'draft', v_round_number - 1
    ) returning id into v_round_id;
    v_current_sources := '[]'::jsonb;
    for v_tie in 1..(v_round_size / 2) loop
      if v_round_number = 1 then
        v_home_source := v_slots->((v_tie - 1) * 2);
        v_away_source := v_slots->((v_tie - 1) * 2 + 1);
      else
        v_home_source := v_previous_sources->((v_tie - 1) * 2);
        v_away_source := v_previous_sources->((v_tie - 1) * 2 + 1);
      end if;
      if v_home_source->>'type' = 'bye' and v_away_source->>'type' = 'bye' then
        v_current_sources := v_current_sources
          || jsonb_build_array(jsonb_build_object('type', 'bye'));
        continue;
      elsif v_home_source->>'type' = 'bye' then
        v_current_sources := v_current_sources || jsonb_build_array(v_away_source);
        continue;
      elsif v_away_source->>'type' = 'bye' then
        v_current_sources := v_current_sources || jsonb_build_array(v_home_source);
        continue;
      end if;
      v_tie_key := v_version.id::text || ':' || v_round_number || ':' || v_tie;
      v_legs := case when p_double_leg and v_round_size > 2 then 2 else 1 end;
      for v_leg in 1..v_legs loop
        v_match_number := v_match_number + 1;
        insert into public.tournament_matches (
          organization_id, season_id, tournament_id, category_id,
          participant_set_id, fixture_version_id, phase_id, round_id,
          match_number, leg_number, tie_key, home_participant_id,
          away_participant_id, status, duration_minutes, created_by
        ) values (
          v_version.organization_id, v_version.season_id, v_version.tournament_id,
          v_version.category_id, v_version.participant_set_id, v_version.id,
          p_phase_id, v_round_id, v_match_number, v_leg,
          case when v_legs = 2 then v_tie_key else null end,
          case when v_leg = 1 and v_home_source->>'type' = 'participant'
            then (v_home_source->>'participantId')::uuid
            when v_leg = 2 and v_away_source->>'type' = 'participant'
            then (v_away_source->>'participantId')::uuid else null end,
          case when v_leg = 1 and v_away_source->>'type' = 'participant'
            then (v_away_source->>'participantId')::uuid
            when v_leg = 2 and v_home_source->>'type' = 'participant'
            then (v_home_source->>'participantId')::uuid else null end,
          'unscheduled', v_duration, v_version.created_by
        ) returning id into v_match_id;
        perform public.insert_tournament_match_source(
          v_match_id, 'home', case when v_leg = 2 then v_away_source else v_home_source end
        );
        perform public.insert_tournament_match_source(
          v_match_id, 'away', case when v_leg = 2 then v_home_source else v_away_source end
        );
        v_last_match_id := v_match_id;
      end loop;
      if v_legs = 2 then
        v_advancement_source := jsonb_build_object(
          'type', 'winner_of_tie', 'tieKey', v_tie_key
        );
        v_loser_source := jsonb_build_object(
          'type', 'loser_of_tie', 'tieKey', v_tie_key
        );
      else
        v_advancement_source := jsonb_build_object(
          'type', 'winner_of_match', 'matchId', v_last_match_id
        );
        v_loser_source := jsonb_build_object(
          'type', 'loser_of_match', 'matchId', v_last_match_id
        );
      end if;
      v_current_sources := v_current_sources || jsonb_build_array(v_advancement_source);
      if v_round_size = 4 then
        v_semifinal_loser_sources := v_semifinal_loser_sources
          || jsonb_build_array(v_loser_source);
      end if;
    end loop;
    v_previous_sources := v_current_sources;
    v_round_size := v_round_size / 2;
  end loop;
  if p_third_place and jsonb_array_length(v_semifinal_loser_sources) = 2 then
    v_round_number := v_round_number + 1;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, p_phase_id, v_round_number, 'Tercer puesto', 'draft', v_round_number - 1
    ) returning id into v_round_id;
    v_match_number := v_match_number + 1;
    insert into public.tournament_matches (
      organization_id, season_id, tournament_id, category_id,
      participant_set_id, fixture_version_id, phase_id, round_id,
      match_number, status, duration_minutes, created_by
    ) values (
      v_version.organization_id, v_version.season_id, v_version.tournament_id,
      v_version.category_id, v_version.participant_set_id, v_version.id,
      p_phase_id, v_round_id, v_match_number, 'unscheduled', v_duration, v_version.created_by
    ) returning id into v_match_id;
    perform public.insert_tournament_match_source(
      v_match_id, 'home', v_semifinal_loser_sources->0
    );
    perform public.insert_tournament_match_source(
      v_match_id, 'away', v_semifinal_loser_sources->1
    );
  end if;
end;
$$;

revoke all on function public.build_tournament_knockout(uuid, uuid, jsonb, boolean, boolean)
  from public, anon, authenticated;

-- Un draft de fixture no puede seguir mutando una vez iniciada la competencia.
-- Puede archivarse desde su RPC, pero no acumular fases que después no puedan
-- publicarse. El append soportado escribe exclusivamente en la versión publicada.
create or replace function public.protect_active_tournament_fixture_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture_version_id uuid;
  v_fixture_status text;
  v_tournament_status text;
begin
  v_fixture_version_id := case
    when tg_op = 'DELETE' then old.fixture_version_id
    else new.fixture_version_id
  end;

  select fixture.status, tournament.status
  into v_fixture_status, v_tournament_status
  from public.tournament_fixture_versions fixture
  join public.tournaments tournament on tournament.id = fixture.tournament_id
  where fixture.id = v_fixture_version_id;

  if v_fixture_status = 'draft'
    and v_tournament_status not in ('registration', 'scheduled')
  then
    raise exception using errcode = '55000',
      message = 'TORNEOS_FIXTURE_DRAFT_READ_ONLY';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists tournament_phases_active_draft_guard on public.tournament_phases;
create trigger tournament_phases_active_draft_guard
before insert or update or delete on public.tournament_phases
for each row execute function public.protect_active_tournament_fixture_draft();

drop trigger if exists tournament_rounds_active_draft_guard on public.tournament_rounds;
create trigger tournament_rounds_active_draft_guard
before insert or update or delete on public.tournament_rounds
for each row execute function public.protect_active_tournament_fixture_draft();

drop trigger if exists tournament_matches_active_draft_guard on public.tournament_matches;
create trigger tournament_matches_active_draft_guard
before insert or update or delete on public.tournament_matches
for each row execute function public.protect_active_tournament_fixture_draft();

drop trigger if exists tournament_match_sources_active_draft_guard on public.tournament_match_sources;
create trigger tournament_match_sources_active_draft_guard
before insert or update or delete on public.tournament_match_sources
for each row execute function public.protect_active_tournament_fixture_draft();

revoke all on function public.protect_active_tournament_fixture_draft()
  from public, anon, authenticated;

create or replace function public.append_tournament_playoff_phase(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_source_phase_id uuid,
  p_qualifier_count integer,
  p_double_leg boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_source_phase public.tournament_phases%rowtype;
  v_phase public.tournament_phases%rowtype;
  v_sources jsonb := '[]'::jsonb;
  v_index integer;
  v_sequence integer;
  v_participant_count integer;
  v_previous_phase_count integer;
  v_previous_round_count integer;
  v_previous_match_count integer;
  v_round_count integer;
  v_match_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  if p_qualifier_count not in (2, 4, 8, 16) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_QUALIFIERS';
  end if;

  if not public.has_tournament_organization_capability(
    p_organization_id, 'fixture.publish'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournaments tournament
    where tournament.id = p_tournament_id
      and tournament.organization_id = p_organization_id
      and tournament.status in ('completed', 'archived')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_COMPETITION_READ_ONLY';
  end if;

  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'fixture.publish', array['registration', 'scheduled', 'active']::text[]
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:fixture:' || p_tournament_id::text || ':' || p_category_id::text, 0
  ));

  select fixture.* into v_version
  from public.tournament_fixture_versions fixture
  where fixture.organization_id = p_organization_id
    and fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  for update;
  if v_version.id is null then
    raise exception using errcode = '23514', message = 'TORNEOS_PUBLISHED_FIXTURE_REQUIRED';
  end if;

  select phase.* into v_phase
  from public.tournament_phases phase
  where phase.fixture_version_id = v_version.id
    and phase.configuration->>'appendOperationKey' = p_idempotency_key::text;
  if v_phase.id is not null then
    return jsonb_build_object(
      'tournamentId', p_tournament_id,
      'fixtureVersionId', v_version.id,
      'sourcePhaseId', v_phase.configuration->>'sourcePhaseId',
      'phaseId', v_phase.id,
      'status', 'published',
      'roundCount', (select count(*) from public.tournament_rounds where phase_id = v_phase.id),
      'matchCount', (select count(*) from public.tournament_matches where phase_id = v_phase.id)
    );
  end if;

  select phase.* into v_source_phase
  from public.tournament_phases phase
  where phase.id = p_source_phase_id
    and phase.organization_id = p_organization_id
    and phase.tournament_id = p_tournament_id
    and phase.category_id = p_category_id
    and phase.fixture_version_id = v_version.id
    and phase.phase_type = 'league'
    and phase.status <> 'archived'
  for share;
  if v_source_phase.id is null then
    raise exception using errcode = '23514', message = 'TORNEOS_PLAYOFF_SOURCE_INVALID';
  end if;

  if exists (
    select 1 from public.tournament_phases phase
    where phase.fixture_version_id = v_version.id
      and phase.phase_type in (
        'round_of_32', 'round_of_16', 'quarterfinal',
        'semifinal', 'third_place', 'final', 'custom_knockout'
      )
      and phase.status <> 'archived'
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_PLAYOFF_PHASE_EXISTS';
  end if;

  select count(*) into v_participant_count
  from public.tournament_competition_participants participant
  where participant.participant_set_id = v_version.participant_set_id
    and participant.status = 'active';
  if p_qualifier_count > v_participant_count then
    raise exception using errcode = '23514', message = 'TORNEOS_INVALID_QUALIFIERS';
  end if;

  select count(*) into v_previous_phase_count
  from public.tournament_phases where fixture_version_id = v_version.id;
  select count(*) into v_previous_round_count
  from public.tournament_rounds where fixture_version_id = v_version.id;
  select count(*) into v_previous_match_count
  from public.tournament_matches where fixture_version_id = v_version.id;
  select coalesce(max(phase.sequence_number), 0) + 1 into v_sequence
  from public.tournament_phases phase
  where phase.fixture_version_id = v_version.id;

  -- El builder distribuye la primera mitad en slots locales y la segunda en
  -- slots visitantes. Invertir esta última conserva el seeding 1-vs-N,
  -- 2-vs-(N-1), etc., sin hardcodear cruces ni materializar participantes.
  for v_index in 1..(p_qualifier_count / 2) loop
    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'type', 'league_position',
      'phaseId', v_source_phase.id,
      'rankNumber', v_index
    ));
  end loop;
  for v_index in reverse p_qualifier_count..(p_qualifier_count / 2 + 1) loop
    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'type', 'league_position',
      'phaseId', v_source_phase.id,
      'rankNumber', v_index
    ));
  end loop;

  insert into public.tournament_phases (
    organization_id, tournament_id, category_id, fixture_version_id,
    name, phase_type, sequence_number, status, configuration
  ) values (
    p_organization_id, p_tournament_id, p_category_id, v_version.id,
    'Playoffs', 'custom_knockout', v_sequence, 'generated',
    jsonb_build_object(
      'sourcePhaseId', v_source_phase.id,
      'qualifiers', p_qualifier_count,
      'seeding', 'league_ranking',
      'knockoutLegs', case when p_double_leg then 'double' else 'single' end,
      'appendOperationKey', p_idempotency_key
    )
  ) returning * into v_phase;

  perform public.build_tournament_knockout(
    v_version.id, v_phase.id, v_sources, coalesce(p_double_leg, false), false
  );

  select count(*) into v_round_count
  from public.tournament_rounds where phase_id = v_phase.id;
  select count(*) into v_match_count
  from public.tournament_matches where phase_id = v_phase.id;

  perform public.append_tournament_audit(
    p_organization_id, 'fixture.phase_appended', 'phase', v_phase.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'fixtureVersionId', v_version.id,
      'sourcePhaseId', v_source_phase.id,
      'qualifierCount', p_qualifier_count,
      'doubleLeg', coalesce(p_double_leg, false),
      'previousPhaseCount', v_previous_phase_count,
      'previousRoundCount', v_previous_round_count,
      'previousMatchCount', v_previous_match_count,
      'appendedRoundCount', v_round_count,
      'appendedMatchCount', v_match_count
    )
  );

  return jsonb_build_object(
    'tournamentId', p_tournament_id,
    'fixtureVersionId', v_version.id,
    'sourcePhaseId', v_source_phase.id,
    'phaseId', v_phase.id,
    'status', 'published',
    'roundCount', v_round_count,
    'matchCount', v_match_count
  );
end;
$$;

comment on function public.append_tournament_playoff_phase(
  uuid, uuid, uuid, uuid, integer, boolean, uuid
) is
  'Agrega Playoffs a la versión oficial sin reemplazar fases, partidos ni resultados previos y sin crear otra edición o licencia.';

revoke all on function public.append_tournament_playoff_phase(
  uuid, uuid, uuid, uuid, integer, boolean, uuid
) from public, anon;
grant execute on function public.append_tournament_playoff_phase(
  uuid, uuid, uuid, uuid, integer, boolean, uuid
) to authenticated, service_role;
