-- Social snapshots that are scoped to a phase rather than a round (standings,
-- scorers, discipline and curated pieces) pass p_round_id = null. The original
-- function left a record variable unassigned and then dereferenced it while
-- building `competition`, which PostgreSQL rejects with SQLSTATE 55000.
--
-- Keep the published-data and authorization contracts unchanged; only model
-- the optional round metadata as nullable scalars.

BEGIN;

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
  v_round_name text;
  v_round_number integer;
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
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_SCOPE_UNAVAILABLE';
  end if;
  if p_round_id is not null then
    select round.name, round.round_number
    into v_round_name, v_round_number
    from public.tournament_rounds round
    where round.id = p_round_id
      and round.fixture_version_id = (v_scope->>'fixtureVersionId')::uuid
      and round.phase_id = p_phase_id;
    if not found then
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
      'roundName', v_round_name,
      'roundNumber', v_round_number
    ),
    'official', coalesce(v_official, '{}'::jsonb),
    'capabilities', to_jsonb(
      public.current_user_tournament_social_capabilities(p_organization_id)
    )
  );
end;
$$;

COMMIT;
