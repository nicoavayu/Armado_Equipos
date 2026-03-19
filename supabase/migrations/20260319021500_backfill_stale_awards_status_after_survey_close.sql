-- Normalize stale awards_status values for closed/finalized matches.
-- Conservative rules:
-- 1) pending -> not_eligible when there are fewer than 3 distinct voters,
--    no persisted player_awards, and no award payload in survey_results.
-- 2) pending -> ready when survey is closed/finalized and award data is already persisted.
--
-- This migration updates public.partidos as canonical fallback because some environments
-- still lack survey_results.awards_status. If that column exists, it is mirrored too.

do $$
declare
  v_min_voters integer := 3;
  v_has_sr_awards_status boolean := false;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'survey_results'
      and column_name = 'awards_status'
  ) into v_has_sr_awards_status;

  create temporary table _awards_status_candidates on commit drop as
  with votes as (
    select
      partido_id,
      count(distinct votante_id) filter (where votante_id is not null) as distinct_voters
    from public.post_match_surveys
    group by partido_id
  ),
  awards as (
    select
      partido_id,
      count(*) as player_awards_count
    from public.player_awards
    group by partido_id
  ),
  sr as (
    select
      partido_id,
      results_ready,
      (
        mvp is not null
        or golden_glove is not null
        or coalesce(array_length(red_cards, 1), 0) > 0
        or nullif(awards->'mvp'->>'player_id', '') is not null
        or nullif(awards->'best_gk'->>'player_id', '') is not null
        or nullif(awards->'red_card'->>'player_id', '') is not null
      ) as has_award_data
    from public.survey_results
  )
  select
    p.id as partido_id,
    case
      when coalesce(v.distinct_voters, 0) < v_min_voters
        and coalesce(a.player_awards_count, 0) = 0
        and coalesce(sr.has_award_data, false) = false
      then 'not_eligible'
      when coalesce(sr.results_ready, false) = true
        and (
          coalesce(sr.has_award_data, false) = true
          or coalesce(a.player_awards_count, 0) > 0
        )
      then 'ready'
      else null
    end as target_status
  from public.partidos p
  left join votes v on v.partido_id = p.id
  left join awards a on a.partido_id = p.id
  left join sr on sr.partido_id = p.id
  where p.estado = 'finalizado'
    and p.survey_status = 'closed'
    and p.awards_status = 'pending';

  delete from _awards_status_candidates
  where target_status is null;

  update public.partidos p
  set
    awards_status = c.target_status,
    awards_resolved_at = coalesce(p.awards_resolved_at, now()),
    updated_at = now()
  from _awards_status_candidates c
  where p.id = c.partido_id
    and p.awards_status is distinct from c.target_status;

  if v_has_sr_awards_status then
    execute $sql$
      update public.survey_results sr
      set awards_status = c.target_status
      from _awards_status_candidates c
      where sr.partido_id = c.partido_id
        and sr.awards_status is distinct from c.target_status
    $sql$;
  end if;
end $$;
