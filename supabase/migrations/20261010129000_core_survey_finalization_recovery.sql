-- Core: closing a survey, its results and its awards no longer depend on the screen that
-- saved the last answer.
--
-- Finalization (closing the survey, results, awards and their notifications) runs in the
-- client (finalizeIfComplete; check_survey_timeouts is disabled on purpose). The survey
-- screen runs it after saving, but if the last voter closes the app right away, or that run
-- fails, the survey stays open — and nobody is notified, because the notification is part of
-- the same run.
-- Who can close: the closure RPC (finalize_match_survey_closure) is not executable by
-- `authenticated` since the canonical RLS contract, so the client falls back to updating
-- partidos, which RLS allows only to the match admin (app_private.is_match_admin =
-- coalesce(creado_por, admin_id)). A player's app cannot close a survey: today a survey only
-- closes when its organizer's app runs finalizeIfComplete on that survey or its results.
-- This adds the durable part: the database says which surveys are due, and the organizer's
-- app finishes them from any screen with the same idempotent finalizeIfComplete:
--   * list_my_pending_survey_finalizations(limit): matches the caller administers whose
--     survey is still open but due (deadline passed, or every expected voter answered), or
--     already closed with results or awards not completed (recent ones only).
--     The deadline comes from survey_closes_at or, when nobody stored it, from kickoff
--     (+1 h opening, +24 h window), like the app derives it.

create or replace function public.list_my_pending_survey_finalizations(p_limit integer default 5)
returns table (partido_id bigint, reason text)
language sql
stable
security definer
set search_path to ''
as $function$
  with my_matches as (
    -- The matches whose lifecycle this account can close (same rule as is_match_admin).
    select match_row.id
    from public.partidos match_row
    where coalesce(match_row.creado_por, match_row.admin_id) = auth.uid()
  ),
  timed as (
    -- The survey window as the app derives it (surveyWindow.js): it opens 1 h after kickoff
    -- (Buenos Aires wall-clock) and closes 24 h later. Only an organizer's app can store it
    -- in partidos, so a stored survey_closes_at wins and kickoff is the fallback.
    select
      match_row.*,
      case
        when replace(btrim(coalesce(match_row.hora, '')), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}'
          then (match_row.fecha::timestamp
            + substring(replace(btrim(match_row.hora), '.', ':') from '^[0-9]{1,2}:[0-9]{2}')::time)
            at time zone 'America/Argentina/Buenos_Aires'
      end as kickoff_at
    from public.partidos match_row
    join my_matches on my_matches.id = match_row.id
    where auth.uid() is not null
      and match_row.deleted_at is null
  ),
  candidates as (
    select
      timed.id,
      case
        when coalesce(lower(timed.survey_status), 'open') = 'open' then 'closure_due'
        else 'results_or_awards_due'
      end as reason,
      coalesce(timed.survey_closes_at, timed.kickoff_at + interval '25 hours') as due_at
    from timed
    where (
        -- Open survey that is due: deadline passed, or every expected voter answered.
        coalesce(lower(timed.survey_status), 'open') = 'open'
        and coalesce(timed.survey_opened_at, timed.kickoff_at + interval '1 hour') <= now()
        and coalesce(timed.survey_closes_at, timed.kickoff_at + interval '25 hours') >= now() - interval '30 days'
        and (
          coalesce(timed.survey_closes_at, timed.kickoff_at + interval '25 hours') <= now()
          or (
            select count(distinct voter.usuario_id)
            from public.post_match_surveys survey
            join public.jugadores voter on voter.id = survey.votante_id
            where survey.partido_id = timed.id
              and voter.usuario_id is not null
          ) >= greatest(
            coalesce(nullif(timed.survey_expected_voters, 0), (
              select count(distinct roster_player.usuario_id)
              from public.jugadores roster_player
              where roster_player.partido_id = timed.id
                and roster_player.usuario_id is not null
                and coalesce(roster_player.is_substitute, false) = false
            )),
            1
          )
        )
      )
      or (
        -- Closed survey whose results or awards were not completed (the app's own
        -- deriveClosedSurveyRecoveryState rule), recent ones only.
        lower(coalesce(timed.survey_status, '')) = 'closed'
        and coalesce(timed.finished_at, timed.survey_closes_at, timed.kickoff_at, timed.updated_at)
          >= now() - interval '14 days'
        and not exists (
          select 1
          from public.survey_results results_row
          where results_row.partido_id = timed.id
            and results_row.results_ready is true
            and lower(coalesce(timed.awards_status, 'pending')) in ('ready', 'not_eligible')
        )
      )
  )
  select candidates.id, candidates.reason
  from candidates
  order by candidates.due_at nulls last, candidates.id
  limit least(greatest(coalesce(p_limit, 5), 1), 20)
$function$;

revoke all on function public.list_my_pending_survey_finalizations(integer) from public, anon;
grant execute on function public.list_my_pending_survey_finalizations(integer) to authenticated, service_role;

do $survey_finalization_recovery_check$
begin
  if has_function_privilege('anon', 'public.list_my_pending_survey_finalizations(integer)', 'execute') then
    raise exception 'list_my_pending_survey_finalizations must not be executable by anon';
  end if;
end
$survey_finalization_recovery_check$;
