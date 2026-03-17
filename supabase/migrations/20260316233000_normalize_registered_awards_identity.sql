begin;

create or replace function public._tmp_normalize_registered_player_ref(
  p_partido_id bigint,
  p_ref text
)
returns text
language sql
stable
as $$
  with normalized as (
    select nullif(btrim(p_ref), '') as ref
  )
  select coalesce(match_row.usuario_id::text, match_row.uuid::text, normalized.ref)
  from normalized
  left join lateral (
    select j.usuario_id, j.uuid, j.id
    from public.jugadores j
    where j.partido_id = p_partido_id
      and (
        j.usuario_id::text = normalized.ref
        or j.uuid::text = normalized.ref
        or j.id::text = normalized.ref
      )
    order by case
      when j.usuario_id::text = normalized.ref then 0
      when j.uuid::text = normalized.ref then 1
      when j.id::text = normalized.ref then 2
      else 3
    end
    limit 1
  ) match_row on true
$$;

do $$
declare
  jugador_id_type text;
begin
  select t.typname
  into jugador_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'player_awards'
    and a.attname = 'jugador_id'
    and not a.attisdropped;

  if jugador_id_type = 'uuid' then
    execute $sql$
      update public.player_awards pa
      set jugador_id = j.usuario_id
      from public.jugadores j
      where j.partido_id = pa.partido_id
        and j.usuario_id is not null
        and (
          j.uuid = pa.jugador_id
          or j.id::text = pa.jugador_id::text
        )
        and pa.jugador_id is distinct from j.usuario_id
    $sql$;
  else
    execute $sql$
      update public.player_awards pa
      set jugador_id = j.usuario_id::text
      from public.jugadores j
      where j.partido_id = pa.partido_id
        and j.usuario_id is not null
        and (
          j.uuid::text = pa.jugador_id::text
          or j.id::text = pa.jugador_id::text
        )
        and pa.jugador_id::text is distinct from j.usuario_id::text
    $sql$;
  end if;
end $$;

do $$
declare
  survey_mvp_type text;
  survey_gk_type text;
  survey_red_cards_type text;
  mvp_assignment_sql text;
  gk_assignment_sql text;
  red_cards_assignment_sql text;
begin
  select
    max(case when a.attname = 'mvp' then t.typname end),
    max(case when a.attname = 'golden_glove' then t.typname end),
    max(case when a.attname = 'red_cards' then t.typname end)
  into survey_mvp_type, survey_gk_type, survey_red_cards_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'survey_results'
    and a.attname in ('mvp', 'golden_glove', 'red_cards')
    and not a.attisdropped;

  mvp_assignment_sql := case
    when survey_mvp_type = 'uuid' then
      'nullif(public._tmp_normalize_registered_player_ref(sr.partido_id, sr.mvp::text), '''')::uuid'
    else
      'public._tmp_normalize_registered_player_ref(sr.partido_id, sr.mvp::text)'
  end;

  gk_assignment_sql := case
    when survey_gk_type = 'uuid' then
      'nullif(public._tmp_normalize_registered_player_ref(sr.partido_id, sr.golden_glove::text), '''')::uuid'
    else
      'public._tmp_normalize_registered_player_ref(sr.partido_id, sr.golden_glove::text)'
  end;

  red_cards_assignment_sql := case
    when survey_red_cards_type = '_uuid' then
      '(select coalesce(array_agg(distinct nullif(btrim(normalized.ref), '''')::uuid), array[]::uuid[]) from (select public._tmp_normalize_registered_player_ref(sr.partido_id, raw.ref::text) as ref from unnest(coalesce(sr.red_cards, array[]::uuid[])) as raw(ref) where raw.ref is not null) normalized where nullif(btrim(normalized.ref), '''') is not null)'
    else
      '(select coalesce(array_agg(distinct normalized.ref), array[]::text[]) from (select public._tmp_normalize_registered_player_ref(sr.partido_id, raw.ref) as ref from unnest(coalesce(sr.red_cards, array[]::text[])) as raw(ref) where nullif(btrim(raw.ref), '''') is not null) normalized where nullif(btrim(normalized.ref), '''') is not null)'
  end;

  execute format($sql$
    update public.survey_results sr
    set
      mvp = %s,
      golden_glove = %s,
      red_cards = %s
    where sr.mvp is not null
       or sr.golden_glove is not null
       or coalesce(array_length(sr.red_cards, 1), 0) > 0
  $sql$, mvp_assignment_sql, gk_assignment_sql, red_cards_assignment_sql);
end $$;

update public.survey_results sr
set awards = (
  with base as (
    select coalesce(sr.awards, '{}'::jsonb) as value
  ),
  normalized_mvp as (
    select case
      when jsonb_typeof(base.value -> 'mvp') = 'object' then jsonb_set(
        base.value,
        '{mvp,player_id}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, base.value #>> '{mvp,player_id}')),
        true
      )
      else base.value
    end as value
    from base
  ),
  normalized_gk as (
    select case
      when jsonb_typeof(normalized_mvp.value -> 'best_gk') = 'object' then jsonb_set(
        normalized_mvp.value,
        '{best_gk,player_id}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_mvp.value #>> '{best_gk,player_id}')),
        true
      )
      else normalized_mvp.value
    end as value
    from normalized_mvp
  ),
  normalized_red as (
    select case
      when jsonb_typeof(normalized_gk.value -> 'red_card') = 'object' then jsonb_set(
        normalized_gk.value,
        '{red_card,player_id}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_gk.value #>> '{red_card,player_id}')),
        true
      )
      else normalized_gk.value
    end as value
    from normalized_gk
  )
  select normalized_red.value
  from normalized_red
)
where sr.awards is not null;

-- Snapshot payloads remain untouched here because survey_results history snapshots
-- are immutable once set (enforced by trg_lock_match_history_snapshots). They keep
-- enough identity aliases (`ref`, `uuid`, `usuario_id`, `id`) for historical UIs.

do $$
declare
  jugador_id_type text;
begin
  select t.typname
  into jugador_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'player_awards'
    and a.attname = 'jugador_id'
    and not a.attisdropped;

  if jugador_id_type = 'uuid' then
    execute $sql$
      with award_counts as (
        select
          u.id as user_id,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) = 'mvp' then 1 else 0 end), 0) as mvps,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('best_gk', 'guante_dorado', 'guante dorado', 'goalkeeper', 'golden_glove', 'golden glove', 'best_goalkeeper', 'best goalkeeper', 'mejor_arquero', 'mejor arquero') then 1 else 0 end), 0) as guantes_dorados,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('red_card', 'red card', 'red_cards', 'tarjeta_roja', 'tarjeta roja', 'tarjetas_rojas', 'tarjetas rojas', 'negative_fair_play', 'dirty_player', 'dirty player', 'player_dirty', 'mas_sucio', 'mas sucio', 'sucio') then 1 else 0 end), 0) as tarjetas_rojas
        from public.usuarios u
        left join public.player_awards pa
          on pa.jugador_id = u.id
        group by u.id
      )
      update public.usuarios u
      set
        mvps = award_counts.mvps,
        guantes_dorados = award_counts.guantes_dorados,
        tarjetas_rojas = award_counts.tarjetas_rojas
      from award_counts
      where u.id = award_counts.user_id
    $sql$;
  else
    execute $sql$
      with award_counts as (
        select
          u.id as user_id,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) = 'mvp' then 1 else 0 end), 0) as mvps,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('best_gk', 'guante_dorado', 'guante dorado', 'goalkeeper', 'golden_glove', 'golden glove', 'best_goalkeeper', 'best goalkeeper', 'mejor_arquero', 'mejor arquero') then 1 else 0 end), 0) as guantes_dorados,
          coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('red_card', 'red card', 'red_cards', 'tarjeta_roja', 'tarjeta roja', 'tarjetas_rojas', 'tarjetas rojas', 'negative_fair_play', 'dirty_player', 'dirty player', 'player_dirty', 'mas_sucio', 'mas sucio', 'sucio') then 1 else 0 end), 0) as tarjetas_rojas
        from public.usuarios u
        left join public.player_awards pa
          on pa.jugador_id::text = u.id::text
        group by u.id
      )
      update public.usuarios u
      set
        mvps = award_counts.mvps,
        guantes_dorados = award_counts.guantes_dorados,
        tarjetas_rojas = award_counts.tarjetas_rojas
      from award_counts
      where u.id = award_counts.user_id
    $sql$;
  end if;
end $$;

with real_match_counts as (
  select
    j.usuario_id as user_id,
    count(distinct j.partido_id) as total
  from public.jugadores j
  join public.partidos p
    on p.id = j.partido_id
  where j.usuario_id is not null
    and lower(coalesce(p.estado, '')) not in ('cancelado', 'cancelled', 'deleted')
    and lower(coalesce(p.result_status, '')) <> 'not_played'
    and (
      lower(coalesce(p.estado, '')) in ('finalizado', 'finished', 'completed')
      or lower(coalesce(p.result_status, '')) in ('finished', 'draw')
      or (
        lower(coalesce(p.survey_status, '')) = 'closed'
        and p.finished_at is not null
      )
    )
  group by j.usuario_id
),
manual_match_counts as (
  select
    pm.usuario_id as user_id,
    count(*) as total
  from public.partidos_manuales pm
  where pm.usuario_id is not null
  group by pm.usuario_id
),
played_match_counts as (
  select
    u.id as user_id,
    coalesce(real_match_counts.total, 0) + coalesce(manual_match_counts.total, 0) as partidos_jugados
  from public.usuarios u
  left join real_match_counts
    on real_match_counts.user_id = u.id
  left join manual_match_counts
    on manual_match_counts.user_id = u.id
)
update public.usuarios u
set partidos_jugados = played_match_counts.partidos_jugados
from played_match_counts
where u.id = played_match_counts.user_id;

with absence_counts as (
  select
    ra.user_id,
    count(*) filter (where ra.type = 'no_show_penalty') as partidos_abandonados
  from public.rating_adjustments ra
  group by ra.user_id
)
update public.usuarios u
set partidos_abandonados = coalesce(absence_counts.partidos_abandonados, 0)
from absence_counts
where u.id = absence_counts.user_id;

update public.usuarios u
set partidos_abandonados = 0
where not exists (
  select 1
  from public.rating_adjustments ra
  where ra.user_id = u.id
    and ra.type = 'no_show_penalty'
);

drop function if exists public._tmp_normalize_registered_player_ref(bigint, text);

commit;
