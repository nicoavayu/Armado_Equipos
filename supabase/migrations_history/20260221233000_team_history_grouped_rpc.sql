-- Equipos & Desafios: historial por rival agregado en DB (evita loop cliente)

create or replace function public.rpc_team_history_by_rival(p_team_id uuid)
returns table (
  rival_id uuid,
  rival_name text,
  rival_format smallint,
  rival_base_zone text,
  rival_skill_level text,
  rival_crest_url text,
  rival_color_primary text,
  rival_color_secondary text,
  rival_color_accent text,
  played bigint,
  won bigint,
  draw bigint,
  lost bigint,
  last_played_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with scoped_matches as (
    select
      tm.played_at,
      case
        when tm.team_a_id = p_team_id then tm.team_b_id
        else tm.team_a_id
      end as rival_id,
      case
        when tm.team_a_id = p_team_id then coalesce(tm.score_a, 0)
        else coalesce(tm.score_b, 0)
      end as score_for,
      case
        when tm.team_a_id = p_team_id then coalesce(tm.score_b, 0)
        else coalesce(tm.score_a, 0)
      end as score_against
    from public.team_matches tm
    where tm.status = 'played'
      and (tm.team_a_id = p_team_id or tm.team_b_id = p_team_id)
  )
  select
    sm.rival_id,
    t.name as rival_name,
    t.format as rival_format,
    t.base_zone as rival_base_zone,
    t.skill_level as rival_skill_level,
    t.crest_url as rival_crest_url,
    t.color_primary as rival_color_primary,
    t.color_secondary as rival_color_secondary,
    t.color_accent as rival_color_accent,
    count(*)::bigint as played,
    sum(case when sm.score_for > sm.score_against then 1 else 0 end)::bigint as won,
    sum(case when sm.score_for = sm.score_against then 1 else 0 end)::bigint as draw,
    sum(case when sm.score_for < sm.score_against then 1 else 0 end)::bigint as lost,
    max(sm.played_at) as last_played_at
  from scoped_matches sm
  join public.teams t on t.id = sm.rival_id
  group by
    sm.rival_id,
    t.name,
    t.format,
    t.base_zone,
    t.skill_level,
    t.crest_url,
    t.color_primary,
    t.color_secondary,
    t.color_accent
  order by max(sm.played_at) desc;
$$;

revoke all on function public.rpc_team_history_by_rival(uuid) from public;
grant execute on function public.rpc_team_history_by_rival(uuid) to authenticated;
grant execute on function public.rpc_team_history_by_rival(uuid) to service_role;
