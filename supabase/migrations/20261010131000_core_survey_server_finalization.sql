-- Core: post-match surveys close, compute results and awards, and notify from the server.
--
-- Until now the whole pipeline (closing the survey, results, awards, "survey finished" and
-- "award won" notices, no-show ranking and the history snapshot) ran only in the app
-- (finalizeIfComplete). It ran when the last voter saved, or when the organizer's app
-- opened (20261010129000). If nobody opened the app, the survey stayed open.
--
-- This adds the same pipeline as a backend job, like the other survey schedulers
-- (pg_cron, already in use; nothing new to pay for):
--   * public.process_survey_finalizations_backend(limit): every 5 minutes, finishes the
--     surveys that are due and the closed ones whose results, awards or snapshot are
--     incomplete. Not executable by anon or authenticated accounts.
--   * app_private.finalize_survey_backend(match): one match. Same rules as today:
--       - when: public.finalize_match_survey_closure decides (deadline = kickoff + 1 h +
--         24 h, or the stored window; or every eligible voter answered; eligibility =
--         public.resolve_partido_survey_notification_recipients);
--       - results: majority status (finished > draw > not_played > pending on ties),
--         winner by majority (A on ties), MVP by votes with the winning team as tie-break,
--         best goalkeeper by votes (lowest id on ties), red cards from 25 % of voters,
--         most voted scoreline (app's computeResultsAverages);
--       - awards: at least 3 voters; most voted MVP / goalkeeper / dirtiest player; only
--         registered players get player_awards and counters (app's computeAndPersistAwards);
--       - notices: through public.create_notification (server-generated text, its own
--         dedupe), acting as the match organizer — the account whose app does it today;
--       - no-show ranking: public.process_match_no_show_ranking, as the organizer;
--       - history snapshot: participants (roster photo, else public profile photo) and
--         results, written once (immutable afterwards).
--     Every step is idempotent: the closure only moves an open survey, player_awards has
--     UNIQUE(partido_id, award_type) and counters move only with a new award row,
--     notifications are deduped per user, match and type, snapshots are write-once.
--     Matches backed by a team challenge keep their surveys disabled (skipped).
--   * One deliberate difference: with fewer than 3 voters the app could end with
--     awards_status = 'error' (and retry forever) when someone voted an MVP; the code's own
--     rule says that case is not eligible, so the server records 'not_eligible'.
--   * app_private.survey_finalization_runs: last outcome per match (attempts, error) for
--     operators; a match that fails 20 times stops being retried until someone looks.

create table if not exists app_private.survey_finalization_runs (
  partido_id bigint primary key,
  attempts integer not null default 0,
  last_run_at timestamptz,
  last_outcome text,
  last_error text,
  completed_at timestamptz
);

revoke all on table app_private.survey_finalization_runs from public, anon, authenticated;

create or replace function app_private.survey_normalize_result_status(p_value text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when lower(btrim(coalesce(p_value, ''))) in ('finished', 'played', 'jugo', 'jugado', 'se_jugo') then 'finished'
    when lower(btrim(coalesce(p_value, ''))) in ('draw', 'empate', 'drawn', 'tie') then 'draw'
    when lower(btrim(coalesce(p_value, ''))) in ('not_played', 'cancelled', 'canceled', 'cancelado', 'no_jugado', 'notplayed') then 'not_played'
    when lower(btrim(coalesce(p_value, ''))) in ('pending', 'pendiente') then 'pending'
  end
$function$;

create or replace function app_private.survey_normalize_winner(p_value text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when lower(btrim(coalesce(p_value, ''))) in ('a', 'equipo_a', 'team_a', 'gano_a', 'winner_a') then 'A'
    when lower(btrim(coalesce(p_value, ''))) in ('b', 'equipo_b', 'team_b', 'gano_b', 'winner_b') then 'B'
  end
$function$;

-- A survey or team ref (roster id, roster uuid, account id) → roster row id of the match
-- (app: toNumericIdFromRef / resolvePlayerIdFromStableRef).
create or replace function app_private.survey_ref_to_player_id(p_partido_id bigint, p_ref text)
returns bigint
language sql
stable
set search_path to ''
as $function$
  select case
    when btrim(coalesce(p_ref, '')) ~ '^[0-9]+$' then btrim(p_ref)::bigint
    else (
      select roster_player.id
      from public.jugadores roster_player
      where roster_player.partido_id = p_partido_id
        and lower(btrim(p_ref)) in (
          lower(roster_player.uuid::text),
          lower(coalesce(roster_player.usuario_id::text, '')),
          roster_player.id::text
        )
      order by roster_player.id
      limit 1
    )
  end
$function$;

-- Roster row id → stable ref (account id, else roster uuid, else id) — app: resolveStablePlayerRef.
create or replace function app_private.survey_player_ref(p_partido_id bigint, p_player_id bigint)
returns text
language sql
stable
set search_path to ''
as $function$
  select coalesce(
    (
      select coalesce(roster_player.usuario_id::text, roster_player.uuid::text, roster_player.id::text)
      from public.jugadores roster_player
      where roster_player.partido_id = p_partido_id and roster_player.id = p_player_id
    ),
    p_player_id::text
  )
$function$;

-- Results of a match from its answers (app: computeResultsAverages). Pure: writes nothing.
create or replace function app_private.compute_survey_results(p_partido_id bigint)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_total_voters integer := 0;
  v_result_status text := 'pending';
  v_winner text;
  v_count_a integer := 0;
  v_count_b integer := 0;
  v_team_a bigint[] := array[]::bigint[];
  v_team_b bigint[] := array[]::bigint[];
  v_mvp_candidates bigint[];
  v_mvp bigint;
  v_gk bigint;
  v_threshold integer;
  v_red bigint[] := array[]::bigint[];
  v_scoreline text;
  v_match record;
  v_team_a_refs jsonb := '[]'::jsonb;
  v_team_b_refs jsonb := '[]'::jsonb;
begin
  select count(distinct survey.votante_id) into v_total_voters
  from public.post_match_surveys survey
  where survey.partido_id = p_partido_id;

  if v_total_voters > 0 then
    with statuses as (
      select coalesce(
        app_private.survey_normalize_result_status(survey.resultado),
        case
          when app_private.survey_normalize_winner(survey.ganador) is not null then 'finished'
          when lower(btrim(coalesce(survey.ganador, ''))) in ('draw', 'empate') then 'draw'
          when lower(btrim(coalesce(survey.ganador, ''))) in ('not_played', 'no_jugado', 'cancelled') then 'not_played'
          when survey.se_jugo = false then 'not_played'
          else 'pending'
        end
      ) as status,
      app_private.survey_normalize_winner(survey.ganador) as winner
      from public.post_match_surveys survey
      where survey.partido_id = p_partido_id
    ),
    ranked as (
      select candidate.status, candidate.priority,
        (select count(*) from statuses where statuses.status = candidate.status) as votes
      from (values ('finished', 1), ('draw', 2), ('not_played', 3), ('pending', 4)) candidate(status, priority)
    )
    select ranked.status into v_result_status
    from ranked
    order by ranked.votes desc, ranked.priority
    limit 1;

    if v_result_status = 'finished' then
      select
        count(*) filter (where app_private.survey_normalize_winner(survey.ganador) = 'A'),
        count(*) filter (where app_private.survey_normalize_winner(survey.ganador) = 'B')
      into v_count_a, v_count_b
      from public.post_match_surveys survey
      where survey.partido_id = p_partido_id
        and coalesce(
          app_private.survey_normalize_result_status(survey.resultado),
          case when app_private.survey_normalize_winner(survey.ganador) is not null then 'finished' end
        ) = 'finished';
      if v_count_a > 0 or v_count_b > 0 then
        v_winner := case when v_count_a >= v_count_b then 'A' else 'B' end;
      end if;
    end if;
  end if;

  -- Teams for the MVP tie-break (app: resolveEffectiveTeamIdSets).
  select match_row.teams_confirmed, match_row.survey_team_a, match_row.survey_team_b,
    match_row.final_team_a, match_row.final_team_b
  into v_match
  from public.partidos match_row
  where match_row.id = p_partido_id;

  if jsonb_typeof(v_match.survey_team_a) = 'array' and jsonb_array_length(v_match.survey_team_a) > 0
     and jsonb_typeof(v_match.survey_team_b) = 'array' and jsonb_array_length(v_match.survey_team_b) > 0 then
    v_team_a_refs := v_match.survey_team_a;
    v_team_b_refs := v_match.survey_team_b;
  elsif jsonb_typeof(v_match.final_team_a) = 'array' and jsonb_array_length(v_match.final_team_a) > 0
     and jsonb_typeof(v_match.final_team_b) = 'array' and jsonb_array_length(v_match.final_team_b) > 0 then
    v_team_a_refs := v_match.final_team_a;
    v_team_b_refs := v_match.final_team_b;
  elsif v_match.teams_confirmed is true then
    -- partido_team_confirmations.team_a/team_b are uuid[].
    select coalesce(to_jsonb(confirmation.team_a), '[]'::jsonb), coalesce(to_jsonb(confirmation.team_b), '[]'::jsonb)
    into v_team_a_refs, v_team_b_refs
    from public.partido_team_confirmations confirmation
    where confirmation.partido_id = p_partido_id;
  end if;

  select coalesce(array_agg(distinct resolved.id), array[]::bigint[]) into v_team_a
  from (
    select app_private.survey_ref_to_player_id(p_partido_id, ref.value) as id
    from jsonb_array_elements_text(coalesce(v_team_a_refs, '[]'::jsonb)) ref(value)
  ) resolved where resolved.id is not null;
  select coalesce(array_agg(distinct resolved.id), array[]::bigint[]) into v_team_b
  from (
    select app_private.survey_ref_to_player_id(p_partido_id, ref.value) as id
    from jsonb_array_elements_text(coalesce(v_team_b_refs, '[]'::jsonb)) ref(value)
  ) resolved where resolved.id is not null;

  if v_result_status <> 'not_played' then
    -- Answers that say the match was not played do not vote players.
    with played as (
      select survey.*
      from public.post_match_surveys survey
      where survey.partido_id = p_partido_id
        and survey.se_jugo is distinct from false
        and app_private.survey_normalize_result_status(survey.resultado) is distinct from 'not_played'
    ),
    mvp_votes as (
      select played.mejor_jugador_eq_a as id, count(*) as votes
      from played where played.mejor_jugador_eq_a is not null group by 1
    )
    select coalesce(array_agg(mvp_votes.id order by mvp_votes.id), array[]::bigint[]) into v_mvp_candidates
    from mvp_votes
    where mvp_votes.votes = (select max(votes) from mvp_votes);

    if coalesce(array_length(v_mvp_candidates, 1), 0) = 1 then
      v_mvp := v_mvp_candidates[1];
    elsif coalesce(array_length(v_mvp_candidates, 1), 0) > 1 then
      if v_result_status = 'finished' and v_winner is not null then
        select candidate into v_mvp
        from unnest(v_mvp_candidates) candidate
        where candidate = any (case when v_winner = 'A' then v_team_a else v_team_b end)
        order by candidate
        limit 1;
      end if;
      v_mvp := coalesce(v_mvp, v_mvp_candidates[1]);
    end if;

    with played as (
      select survey.*
      from public.post_match_surveys survey
      where survey.partido_id = p_partido_id
        and survey.se_jugo is distinct from false
        and app_private.survey_normalize_result_status(survey.resultado) is distinct from 'not_played'
    ),
    gk_votes as (
      select played.mejor_jugador_eq_b as id, count(*) as votes
      from played where played.mejor_jugador_eq_b is not null group by 1
    )
    select gk_votes.id into v_gk
    from gk_votes
    order by gk_votes.votes desc, gk_votes.id
    limit 1;

    v_threshold := case when v_total_voters > 0 then ceil(v_total_voters * 0.25)::integer end;
    if v_threshold is not null then
      with played as (
        select survey.*
        from public.post_match_surveys survey
        where survey.partido_id = p_partido_id
          and survey.se_jugo is distinct from false
          and app_private.survey_normalize_result_status(survey.resultado) is distinct from 'not_played'
      )
      select coalesce(array_agg(violent.id order by violent.id), array[]::bigint[]) into v_red
      from (
        select marked.id, count(*) as votes
        from played, unnest(played.jugadores_violentos) marked(id)
        where marked.id is not null
        group by marked.id
      ) violent
      where violent.votes >= v_threshold;
    end if;
  end if;

  select scoreline_votes.scoreline into v_scoreline
  from (
    select btrim(survey.resultado) as scoreline, count(*) as votes, min(survey.id) as first_id
    from public.post_match_surveys survey
    where survey.partido_id = p_partido_id
      and btrim(coalesce(survey.resultado, '')) ~ '^[0-9]+\s*-\s*[0-9]+$'
    group by btrim(survey.resultado)
  ) scoreline_votes
  order by scoreline_votes.votes desc, scoreline_votes.first_id
  limit 1;

  return jsonb_build_object(
    'result_status', v_result_status,
    'winner_team', v_winner,
    'mvp_player_id', v_mvp,
    'mvp', case when v_mvp is not null then app_private.survey_player_ref(p_partido_id, v_mvp) end,
    'gk_player_id', v_gk,
    'golden_glove', case when v_gk is not null then app_private.survey_player_ref(p_partido_id, v_gk) end,
    'red_card_player_ids', to_jsonb(v_red),
    'red_cards', (
      select coalesce(jsonb_agg(app_private.survey_player_ref(p_partido_id, red.id) order by red.id), '[]'::jsonb)
      from unnest(v_red) red(id)
    ),
    'scoreline', v_scoreline,
    'total_voters', v_total_voters
  );
end;
$function$;

-- Awards of a match (app: computeAndPersistAwards, without writing).
create or replace function app_private.compute_survey_awards(p_partido_id bigint, p_mvp_override_player_id bigint default null)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_voters integer;
  v_mvp_id bigint;
  v_mvp_votes integer;
  v_gk_id bigint;
  v_gk_votes integer;
  v_red_id bigint;
  v_red_votes integer;
  v_total_mvp integer;
  v_total_gk integer;
  v_total_red integer;
  v_max_mvp integer;
  v_override_votes integer;
  v_mvp_den integer;
  v_awards jsonb;
begin
  select count(distinct survey.votante_id) into v_voters
  from public.post_match_surveys survey
  where survey.partido_id = p_partido_id;

  if coalesce(v_voters, 0) < 3 then
    return jsonb_build_object('eligible', false, 'reason', 'insufficient_voters', 'voters', coalesce(v_voters, 0));
  end if;

  -- Every answer counts here, as in the app (results above skip "not played" answers).
  select coalesce(sum(votes), 0)::integer, coalesce(max(votes), 0)::integer into v_total_mvp, v_max_mvp
  from (
    select count(*) as votes from public.post_match_surveys survey
    where survey.partido_id = p_partido_id and coalesce(survey.mejor_jugador_eq_a, 0) <> 0
    group by survey.mejor_jugador_eq_a
  ) mvp_votes;
  select coalesce(sum(votes), 0)::integer into v_total_gk
  from (
    select count(*) as votes from public.post_match_surveys survey
    where survey.partido_id = p_partido_id and coalesce(survey.mejor_jugador_eq_b, 0) <> 0
    group by survey.mejor_jugador_eq_b
  ) gk_votes;
  select count(*)::integer into v_total_red
  from public.post_match_surveys survey, unnest(survey.jugadores_violentos) marked(id)
  where survey.partido_id = p_partido_id and coalesce(marked.id, 0) <> 0;

  -- Most voted; ties go to the lowest roster id.
  select survey.mejor_jugador_eq_a, count(*)::integer into v_mvp_id, v_mvp_votes
  from public.post_match_surveys survey
  where survey.partido_id = p_partido_id and coalesce(survey.mejor_jugador_eq_a, 0) <> 0
  group by survey.mejor_jugador_eq_a
  order by count(*) desc, survey.mejor_jugador_eq_a
  limit 1;
  select survey.mejor_jugador_eq_b, count(*)::integer into v_gk_id, v_gk_votes
  from public.post_match_surveys survey
  where survey.partido_id = p_partido_id and coalesce(survey.mejor_jugador_eq_b, 0) <> 0
  group by survey.mejor_jugador_eq_b
  order by count(*) desc, survey.mejor_jugador_eq_b
  limit 1;
  select marked.id, count(*)::integer into v_red_id, v_red_votes
  from public.post_match_surveys survey, unnest(survey.jugadores_violentos) marked(id)
  where survey.partido_id = p_partido_id and coalesce(marked.id, 0) <> 0
  group by marked.id
  order by count(*) desc, marked.id
  limit 1;

  v_mvp_den := greatest(v_total_mvp, 1);
  -- The results' MVP (with the winning-team tie-break) is the awarded one.
  if p_mvp_override_player_id is not null and p_mvp_override_player_id > 0 then
    select count(*)::integer into v_override_votes
    from public.post_match_surveys survey
    where survey.partido_id = p_partido_id and survey.mejor_jugador_eq_a = p_mvp_override_player_id;
    v_mvp_id := p_mvp_override_player_id;
    v_mvp_votes := case when v_override_votes > 0 then v_override_votes else v_max_mvp end;
    v_mvp_den := case when v_total_mvp > 0 then v_total_mvp else greatest(v_mvp_votes, 1) end;
  end if;

  v_awards := jsonb_build_object(
    'mvp', case when v_mvp_id is not null then jsonb_build_object(
      'player_id', app_private.survey_player_ref(p_partido_id, v_mvp_id),
      'votes', v_mvp_votes,
      'pct', round((v_mvp_votes * 100)::numeric / v_mvp_den),
      'total', v_mvp_den) end,
    'best_gk', case when v_gk_id is not null then jsonb_build_object(
      'player_id', app_private.survey_player_ref(p_partido_id, v_gk_id),
      'votes', v_gk_votes,
      'pct', round((v_gk_votes * 100)::numeric / greatest(v_total_gk, 1)),
      'total', greatest(v_total_gk, 1)) end,
    'red_card', case when v_red_id is not null then jsonb_build_object(
      'player_id', app_private.survey_player_ref(p_partido_id, v_red_id),
      'votes', v_red_votes,
      'pct', round((v_red_votes * 100)::numeric / greatest(v_total_red, 1)),
      'total', greatest(v_total_red, 1)) end,
    'totals', jsonb_build_object('mvp', v_total_mvp, 'gk', v_total_gk, 'red', v_total_red)
  );

  if v_mvp_id is null and v_gk_id is null and v_red_id is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_valid_awards_generated', 'voters', v_voters, 'awards', v_awards);
  end if;

  return jsonb_build_object(
    'eligible', true,
    'voters', v_voters,
    'awards', v_awards,
    'player_ids', jsonb_build_object('mvp', v_mvp_id, 'best_gk', v_gk_id, 'red_card', v_red_id)
  );
end;
$function$;

create or replace function app_private.finalize_survey_backend(p_partido_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_match record;
  v_actor uuid;
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_closure jsonb;
  v_results jsonb;
  v_awards jsonb;
  v_award_type text;
  v_player_id bigint;
  v_user uuid;
  v_inserted bigint;
  v_counter text;
  v_awards_status text;
  v_expected_awards integer := 0;
  v_persisted_awards integer := 0;
  v_recipients uuid[];
  v_existing record;
  v_participants jsonb;
  v_equipos jsonb;
  v_confirmation record;
  v_all_voted boolean := false;
  v_steps jsonb := '{}'::jsonb;
  v_survey_open boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('survey_finalize_backend'), p_partido_id::integer) then
    return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'busy');
  end if;

  select match_row.id, match_row.nombre, match_row.creado_por, match_row.admin_id, match_row.survey_status,
    match_row.awards_status, match_row.teams_confirmed, match_row.teams_source,
    match_row.survey_team_a, match_row.survey_team_b, match_row.final_team_a, match_row.final_team_b,
    match_row.teams_locked_at, match_row.teams_locked_by_user_id,
    match_row.final_teams_updated_at, match_row.final_teams_updated_by, match_row.deleted_at
  into v_match
  from public.partidos match_row
  where match_row.id = p_partido_id;

  if not found or v_match.deleted_at is not null then
    return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'skipped', 'reason', 'match_not_found');
  end if;
  if exists (select 1 from public.team_matches tm where tm.partido_id = p_partido_id) then
    return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'skipped', 'reason', 'surveys_disabled_for_challenges');
  end if;

  v_actor := coalesce(v_match.creado_por, v_match.admin_id);
  if v_actor is null then
    return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'skipped', 'reason', 'no_organizer');
  end if;

  -- Act as the organizer (the account whose app runs this pipeline today) for the existing
  -- server functions that check who is asking. Only for this transaction.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  v_results := app_private.compute_survey_results(p_partido_id);
  v_survey_open := coalesce(nullif(lower(btrim(v_match.survey_status)), ''), 'open') = 'open';

  -- 1) Closure, by the canonical rule (deadline or every eligible voter answered).
  if v_survey_open then
    v_closure := public.finalize_match_survey_closure(
      p_partido_id,
      null,
      null,
      0,
      v_results ->> 'result_status',
      v_results ->> 'winner_team',
      case when v_results ->> 'result_status' = 'pending' then null else now() end
    );
    if coalesce((v_closure ->> 'success')::boolean, false) is not true
       or coalesce(lower((select survey_status from public.partidos where id = p_partido_id)), 'open') <> 'closed' then
      perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
      perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
      return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'not_ready', 'closure', v_closure);
    end if;
    v_all_voted := coalesce((v_closure ->> 'all_eligible_voted')::boolean, false)
      and not coalesce((v_closure ->> 'deadline_reached')::boolean, false);
    v_steps := v_steps || jsonb_build_object('closed_by_this_call', coalesce((v_closure ->> 'closed_by_this_call')::boolean, false));
  end if;

  -- 2) Participants snapshot (write-once).
  if not exists (
    select 1 from public.survey_results sr where sr.partido_id = p_partido_id and sr.snapshot_participantes_listo
  ) then
    select confirmation.participants, confirmation.team_a, confirmation.team_b, confirmation.teams_json, confirmation.confirmed_at
    into v_confirmation
    from public.partido_team_confirmations confirmation
    where confirmation.partido_id = p_partido_id;

    if jsonb_typeof(v_confirmation.participants) = 'array' and jsonb_array_length(v_confirmation.participants) > 0 then
      v_participants := v_confirmation.participants;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', roster_player.id,
          'ref', coalesce(roster_player.usuario_id::text, roster_player.uuid::text, roster_player.id::text),
          'uuid', roster_player.uuid,
          'usuario_id', roster_player.usuario_id,
          'nombre', coalesce(nullif(roster_player.nombre, ''), 'Jugador'),
          'avatar_url', coalesce(nullif(roster_player.avatar_url, ''), profile_row.avatar_url),
          'score', roster_player.score,
          'is_goalkeeper', coalesce(roster_player.is_goalkeeper, false)
        ) order by roster_player.id), '[]'::jsonb)
      into v_participants
      from public.jugadores roster_player
      left join public.usuarios profile_row on profile_row.id = roster_player.usuario_id
      where roster_player.partido_id = p_partido_id;
    end if;

    if jsonb_typeof(v_match.survey_team_a) = 'array' and jsonb_array_length(v_match.survey_team_a) > 0
       and jsonb_typeof(v_match.survey_team_b) = 'array' and jsonb_array_length(v_match.survey_team_b) > 0 then
      v_equipos := jsonb_build_object('team_a', v_match.survey_team_a, 'team_b', v_match.survey_team_b,
        'teams_json', null, 'confirmed_at', coalesce(v_match.teams_locked_at, v_match.final_teams_updated_at),
        'source', coalesce(v_match.teams_source, 'partidos.survey_teams'),
        'updated_by', coalesce(v_match.teams_locked_by_user_id, v_match.final_teams_updated_by));
    elsif jsonb_typeof(v_match.final_team_a) = 'array' and jsonb_array_length(v_match.final_team_a) > 0
       and jsonb_typeof(v_match.final_team_b) = 'array' and jsonb_array_length(v_match.final_team_b) > 0 then
      v_equipos := jsonb_build_object('team_a', v_match.final_team_a, 'team_b', v_match.final_team_b,
        'teams_json', null, 'confirmed_at', v_match.final_teams_updated_at,
        'source', coalesce(v_match.teams_source, 'partidos.final_teams'),
        'updated_by', v_match.final_teams_updated_by);
    elsif v_confirmation.team_a is not null or v_confirmation.team_b is not null then
      v_equipos := jsonb_build_object(
        'team_a', coalesce(to_jsonb(v_confirmation.team_a), '[]'::jsonb),
        'team_b', coalesce(to_jsonb(v_confirmation.team_b), '[]'::jsonb),
        'teams_json', v_confirmation.teams_json, 'confirmed_at', v_confirmation.confirmed_at,
        'source', case when v_match.teams_confirmed is true then 'admin' else 'partido_team_confirmations' end);
    end if;

    insert into public.survey_results as sr (partido_id, snapshot_participantes_listo, snapshot_participantes, snapshot_equipos, snapshot_participantes_at)
    values (p_partido_id, true, v_participants, v_equipos, now())
    on conflict (partido_id) do update
    set snapshot_participantes_listo = true,
        snapshot_participantes = excluded.snapshot_participantes,
        snapshot_equipos = excluded.snapshot_equipos,
        snapshot_participantes_at = excluded.snapshot_participantes_at
    where sr.snapshot_participantes_listo is not true;
  end if;

  -- 3) Results (recomputed like the app; the first finish time is kept).
  insert into public.survey_results as sr (partido_id, mvp, golden_glove, red_cards, winner_team, scoreline, result_status, finished_at, results_ready)
  values (
    p_partido_id,
    (v_results ->> 'mvp')::uuid,
    (v_results ->> 'golden_glove')::uuid,
    array(select jsonb_array_elements_text(v_results -> 'red_cards')::uuid),
    v_results ->> 'winner_team',
    v_results ->> 'scoreline',
    v_results ->> 'result_status',
    case when v_results ->> 'result_status' = 'pending' then null
      else coalesce((select finished_at from public.partidos where id = p_partido_id), now()) end,
    true
  )
  on conflict (partido_id) do update
  set mvp = excluded.mvp,
      golden_glove = excluded.golden_glove,
      red_cards = excluded.red_cards,
      winner_team = excluded.winner_team,
      scoreline = excluded.scoreline,
      result_status = excluded.result_status,
      finished_at = coalesce(sr.finished_at, excluded.finished_at),
      results_ready = true;

  -- 4) No-show penalties and ranking (needs a closed survey with results).
  begin
    perform public.process_match_no_show_ranking(p_partido_id, true);
    v_steps := v_steps || jsonb_build_object('no_show', 'ok');
  exception when others then
    v_steps := v_steps || jsonb_build_object('no_show', sqlerrm);
  end;

  -- 5) Awards.
  if v_results ->> 'result_status' = 'not_played' then
    v_awards := jsonb_build_object('eligible', false, 'reason', 'not_played');
  else
    v_awards := app_private.compute_survey_awards(
      p_partido_id,
      app_private.survey_ref_to_player_id(p_partido_id, v_results ->> 'mvp')
    );
  end if;

  if coalesce((v_awards ->> 'eligible')::boolean, false) then
    foreach v_award_type in array array['mvp', 'best_gk', 'red_card'] loop
      v_player_id := nullif(v_awards -> 'player_ids' ->> v_award_type, '')::bigint;
      continue when v_player_id is null;
      select roster_player.usuario_id into v_user
      from public.jugadores roster_player
      where roster_player.partido_id = p_partido_id and roster_player.id = v_player_id;
      continue when v_user is null;  -- guests get no award row
      v_expected_awards := v_expected_awards + 1;
      v_inserted := null;
      insert into public.player_awards (partido_id, jugador_id, award_type, created_at)
      values (p_partido_id, v_user, v_award_type, now())
      on conflict (partido_id, award_type) do nothing
      returning id into v_inserted;
      v_persisted_awards := v_persisted_awards + 1;
      if v_inserted is not null then
        v_counter := case v_award_type when 'mvp' then 'mvps' when 'best_gk' then 'guantes_dorados' else 'tarjetas_rojas' end;
        execute format('update public.usuarios set %I = coalesce(%I, 0) + 1 where id = $1', v_counter, v_counter)
        using v_user;
      end if;
    end loop;

    update public.survey_results
    set awards = v_awards -> 'awards', results_ready = true, updated_at = now()
    where partido_id = p_partido_id;
    v_awards_status := case when v_persisted_awards >= v_expected_awards then 'ready' else 'error' end;
  else
    -- Not eligible (not played, fewer than 3 voters, no votes): no award artifacts.
    update public.survey_results
    set mvp = null, golden_glove = null, red_cards = array[]::uuid[], awards = '{}'::jsonb, updated_at = now()
    where partido_id = p_partido_id;
    v_awards_status := 'not_eligible';
  end if;

  update public.partidos
  set awards_status = v_awards_status, awards_resolved_at = now()
  where id = p_partido_id
    and awards_status is distinct from v_awards_status;
  v_steps := v_steps || jsonb_build_object('awards_status', v_awards_status, 'awards_reason', v_awards ->> 'reason');

  -- 6) Notices, through the server-side generator (text, permissions, dedupe).
  if v_awards_status = 'ready' then
    for v_award_type, v_user in
      select award.type, roster_player.usuario_id
      from (values ('mvp'), ('best_gk'), ('red_card')) award(type)
      join public.jugadores roster_player
        on roster_player.partido_id = p_partido_id
       and roster_player.id = nullif(v_awards -> 'player_ids' ->> award.type, '')::bigint
      where roster_player.usuario_id is not null
    loop
      begin
        perform public.create_notification('award_won', v_user,
          jsonb_build_object('match_id', p_partido_id, 'award_type', v_award_type));
      exception when others then
        v_steps := v_steps || jsonb_build_object('award_won_' || v_award_type, sqlerrm);
      end;
    end loop;
  end if;

  v_recipients := coalesce(public.resolve_partido_survey_notification_recipients(p_partido_id), array[]::uuid[]);
  if coalesce(array_length(v_recipients, 1), 0) = 0 then
    select coalesce(array_agg(distinct roster_player.usuario_id), array[]::uuid[]) into v_recipients
    from public.jugadores roster_player
    where roster_player.partido_id = p_partido_id and roster_player.usuario_id is not null;
  end if;
  for v_user in
    select recipient from unnest(v_recipients) recipient
    where not exists (
      select 1 from public.notifications notice
      where notice.user_id = recipient
        and notice.type = 'survey_finished'
        and (notice.partido_id = p_partido_id or notice.data ->> 'match_id' = p_partido_id::text)
    )
  loop
    begin
      perform public.create_notification('survey_finished', v_user, jsonb_build_object('match_id', p_partido_id));
    exception when others then
      v_steps := v_steps || jsonb_build_object('survey_finished_' || v_user, sqlerrm);
    end;
  end loop;

  -- 7) Results snapshot for the history (write-once; the pipeline's last step).
  select sr.* into v_existing from public.survey_results sr where sr.partido_id = p_partido_id;
  if v_existing.resultados_encuesta_listos is not true then
    update public.survey_results
    set resultados_encuesta_listos = true,
        snapshot_resultados_encuesta = jsonb_build_object(
          'version', 1,
          'mvp', coalesce(to_jsonb(v_existing.mvp::text), v_existing.awards -> 'mvp'),
          'mas_sucio', coalesce(
            v_existing.awards -> 'red_card',
            (select to_jsonb(app_private.survey_player_ref(p_partido_id, marked.id))
             from public.post_match_surveys survey, unnest(survey.jugadores_violentos) marked(id)
             where survey.partido_id = p_partido_id order by marked.id limit 1)
          ),
          'ausentes', (
            select coalesce(jsonb_agg(app_private.survey_player_ref(p_partido_id, absent.id) order by absent.id), '[]'::jsonb)
            from (select distinct marked.id from public.post_match_surveys survey, unnest(survey.jugadores_ausentes) marked(id)
                  where survey.partido_id = p_partido_id) absent
          ),
          'red_cards', (
            select coalesce(jsonb_agg(ref order by ref), '[]'::jsonb)
            from (
              select app_private.survey_player_ref(p_partido_id, marked.id) as ref
              from public.post_match_surveys survey, unnest(survey.jugadores_violentos) marked(id)
              where survey.partido_id = p_partido_id
              union
              select red.ref::text from unnest(coalesce(v_existing.red_cards, array[]::uuid[])) red(ref)
            ) refs
          ),
          'golden_glove', coalesce(to_jsonb(v_existing.golden_glove::text), v_existing.awards -> 'best_gk'),
          'winner_team', v_existing.winner_team,
          'scoreline', v_existing.scoreline,
          'result_status', v_existing.result_status,
          'finished_at', v_existing.finished_at,
          'total_surveys', (select count(*) from public.post_match_surveys survey where survey.partido_id = p_partido_id),
          'encuesta_cerrada_at', now(),
          'closed_reason', case when v_all_voted then 'all_voted' else 'deadline' end,
          'generated_at', now(),
          'source', 'backend'
        ),
        encuesta_cerrada_at = now(),
        snapshot_resultados_at = now()
    where partido_id = p_partido_id;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  return jsonb_build_object('partido_id', p_partido_id, 'outcome', 'completed', 'steps', v_steps);
end;
$function$;

create or replace function public.process_survey_finalizations_backend(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_candidate record;
  v_result jsonb;
  v_summary jsonb := jsonb_build_object('completed', 0, 'not_ready', 0, 'skipped', 0, 'failed', 0);
  v_outcome text;
  v_key text;
begin
  for v_candidate in
    with timed as (
      select
        match_row.id,
        match_row.survey_status,
        match_row.survey_closes_at,
        match_row.finished_at,
        match_row.updated_at,
        match_row.awards_status,
        case
          when replace(btrim(coalesce(match_row.hora, '')), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}'
            then (match_row.fecha::timestamp
              + substring(replace(btrim(match_row.hora), '.', ':') from '^[0-9]{1,2}:[0-9]{2}')::time)
              at time zone 'America/Argentina/Buenos_Aires'
        end as kickoff_at
      from public.partidos match_row
      where match_row.deleted_at is null
        and not exists (select 1 from public.team_matches tm where tm.partido_id = match_row.id)
    )
    select timed.id, coalesce(timed.survey_closes_at, timed.kickoff_at + interval '25 hours') as due_at
    from timed
    left join app_private.survey_finalization_runs run on run.partido_id = timed.id
    where coalesce(run.attempts, 0) < 20
      and (
        (
          -- open and its window already opened (the closure function decides if it is due)
          coalesce(nullif(lower(btrim(timed.survey_status)), ''), 'open') = 'open'
          and coalesce(timed.kickoff_at + interval '1 hour', timed.survey_closes_at - interval '24 hours') <= now()
          and coalesce(timed.survey_closes_at, timed.kickoff_at + interval '25 hours') >= now() - interval '30 days'
        )
        or (
          -- closed recently but results, awards or the history snapshot are incomplete
          lower(coalesce(timed.survey_status, '')) = 'closed'
          and coalesce(timed.finished_at, timed.survey_closes_at, timed.kickoff_at, timed.updated_at) >= now() - interval '14 days'
          and (
            lower(coalesce(timed.awards_status, 'pending')) not in ('ready', 'not_eligible')
            or not exists (
              select 1 from public.survey_results sr
              where sr.partido_id = timed.id and sr.results_ready is true and sr.resultados_encuesta_listos is true
            )
          )
        )
      )
    order by 2 nulls last, timed.id
    limit least(greatest(coalesce(p_limit, 25), 1), 200)
  loop
    begin
      v_result := app_private.finalize_survey_backend(v_candidate.id);
      v_outcome := coalesce(v_result ->> 'outcome', 'failed');
      insert into app_private.survey_finalization_runs as run (partido_id, attempts, last_run_at, last_outcome, last_error, completed_at)
      values (v_candidate.id, 0, now(), v_outcome, null, case when v_outcome = 'completed' then now() end)
      on conflict (partido_id) do update
      set attempts = 0, last_run_at = now(), last_outcome = excluded.last_outcome, last_error = null,
          completed_at = coalesce(excluded.completed_at, run.completed_at);
    exception when others then
      v_outcome := 'failed';
      insert into app_private.survey_finalization_runs as run (partido_id, attempts, last_run_at, last_outcome, last_error)
      values (v_candidate.id, 1, now(), 'failed', left(sqlerrm, 500))
      on conflict (partido_id) do update
      set attempts = run.attempts + 1, last_run_at = now(), last_outcome = 'failed', last_error = excluded.last_error;
    end;
    v_key := case when v_outcome in ('completed', 'not_ready', 'skipped') then v_outcome
      when v_outcome = 'busy' then 'skipped' else 'failed' end;
    v_summary := jsonb_set(v_summary, array[v_key], to_jsonb((v_summary ->> v_key)::integer + 1));
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_summary;
end;
$function$;

revoke all on function app_private.finalize_survey_backend(bigint) from public, anon, authenticated;
revoke all on function app_private.compute_survey_results(bigint) from public, anon, authenticated;
revoke all on function app_private.compute_survey_awards(bigint, bigint) from public, anon, authenticated;
revoke all on function public.process_survey_finalizations_backend(integer) from public, anon, authenticated;
grant execute on function public.process_survey_finalizations_backend(integer) to service_role;

do $survey_finalization_schedule$
declare
  v_job record;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not installed: schedule public.process_survey_finalizations_backend() by hand';
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'survey_finalization_backend_scheduler' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'survey_finalization_backend_scheduler',
    '*/5 * * * *',
    'select public.process_survey_finalizations_backend(25);'
  );
end
$survey_finalization_schedule$;

do $survey_finalization_check$
begin
  if has_function_privilege('authenticated', 'public.process_survey_finalizations_backend(integer)', 'execute')
     or has_function_privilege('anon', 'public.process_survey_finalizations_backend(integer)', 'execute') then
    raise exception 'process_survey_finalizations_backend must not be executable by accounts';
  end if;
end
$survey_finalization_check$;
