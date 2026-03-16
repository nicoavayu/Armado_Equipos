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

update public.player_awards pa
set jugador_id = j.usuario_id::text
from public.jugadores j
where j.partido_id = pa.partido_id
  and j.usuario_id is not null
  and (
    j.uuid::text = pa.jugador_id
    or j.id::text = pa.jugador_id
  )
  and pa.jugador_id is distinct from j.usuario_id::text;

update public.survey_results sr
set
  mvp = public._tmp_normalize_registered_player_ref(sr.partido_id, sr.mvp),
  golden_glove = public._tmp_normalize_registered_player_ref(sr.partido_id, sr.golden_glove),
  red_cards = (
    select coalesce(array_agg(distinct normalized.ref), array[]::text[])
    from (
      select public._tmp_normalize_registered_player_ref(sr.partido_id, raw.ref) as ref
      from unnest(coalesce(sr.red_cards, array[]::text[])) as raw(ref)
      where nullif(btrim(raw.ref), '') is not null
    ) normalized
    where nullif(btrim(normalized.ref), '') is not null
  )
where sr.mvp is not null
   or sr.golden_glove is not null
   or coalesce(array_length(sr.red_cards, 1), 0) > 0;

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

update public.survey_results sr
set snapshot_participantes = (
  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(item.value) <> 'object' then item.value
      else jsonb_set(
        item.value,
        '{ref}',
        to_jsonb(
          coalesce(
            public._tmp_normalize_registered_player_ref(
              sr.partido_id,
              coalesce(
                item.value ->> 'usuario_id',
                item.value ->> 'ref',
                item.value ->> 'uuid',
                item.value ->> 'id'
              )
            ),
            coalesce(
              item.value ->> 'ref',
              item.value ->> 'uuid',
              item.value ->> 'usuario_id',
              item.value ->> 'id'
            )
          )
        ),
        true
      )
    end
    order by item.ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(sr.snapshot_participantes, '[]'::jsonb))
    with ordinality as item(value, ordinality)
)
where sr.snapshot_participantes is not null;

update public.survey_results sr
set snapshot_resultados_encuesta = (
  with base as (
    select coalesce(sr.snapshot_resultados_encuesta, '{}'::jsonb) as value
  ),
  normalized_mvp as (
    select case
      when jsonb_typeof(base.value -> 'mvp') = 'string' then jsonb_set(
        base.value,
        '{mvp}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, base.value ->> 'mvp')),
        true
      )
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
      when jsonb_typeof(normalized_mvp.value -> 'golden_glove') = 'string' then jsonb_set(
        normalized_mvp.value,
        '{golden_glove}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_mvp.value ->> 'golden_glove')),
        true
      )
      when jsonb_typeof(normalized_mvp.value -> 'golden_glove') = 'object' then jsonb_set(
        normalized_mvp.value,
        '{golden_glove,player_id}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_mvp.value #>> '{golden_glove,player_id}')),
        true
      )
      else normalized_mvp.value
    end as value
    from normalized_mvp
  ),
  normalized_dirty as (
    select case
      when jsonb_typeof(normalized_gk.value -> 'mas_sucio') = 'string' then jsonb_set(
        normalized_gk.value,
        '{mas_sucio}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_gk.value ->> 'mas_sucio')),
        true
      )
      when jsonb_typeof(normalized_gk.value -> 'mas_sucio') = 'object' then jsonb_set(
        normalized_gk.value,
        '{mas_sucio,player_id}',
        to_jsonb(public._tmp_normalize_registered_player_ref(sr.partido_id, normalized_gk.value #>> '{mas_sucio,player_id}')),
        true
      )
      else normalized_gk.value
    end as value
    from normalized_gk
  ),
  normalized_red_cards as (
    select jsonb_set(
      normalized_dirty.value,
      '{red_cards}',
      to_jsonb(
        coalesce(
          (
            select array_agg(distinct normalized_ref)
            from (
              select public._tmp_normalize_registered_player_ref(sr.partido_id, raw_ref) as normalized_ref
              from jsonb_array_elements_text(coalesce(normalized_dirty.value -> 'red_cards', '[]'::jsonb)) as raw(raw_ref)
              where nullif(btrim(raw.raw_ref), '') is not null
            ) normalized_refs
            where nullif(btrim(normalized_refs.normalized_ref), '') is not null
          ),
          array[]::text[]
        )
      ),
      true
    ) as value
    from normalized_dirty
  ),
  normalized_absences as (
    select jsonb_set(
      normalized_red_cards.value,
      '{ausentes}',
      to_jsonb(
        coalesce(
          (
            select array_agg(distinct normalized_ref)
            from (
              select public._tmp_normalize_registered_player_ref(sr.partido_id, raw_ref) as normalized_ref
              from jsonb_array_elements_text(coalesce(normalized_red_cards.value -> 'ausentes', '[]'::jsonb)) as raw(raw_ref)
              where nullif(btrim(raw.raw_ref), '') is not null
            ) normalized_refs
            where nullif(btrim(normalized_refs.normalized_ref), '') is not null
          ),
          array[]::text[]
        )
      ),
      true
    ) as value
    from normalized_red_cards
  )
  select normalized_absences.value
  from normalized_absences
)
where sr.snapshot_resultados_encuesta is not null;

with award_counts as (
  select
    u.id as user_id,
    coalesce(sum(case when lower(coalesce(pa.award_type, '')) = 'mvp' then 1 else 0 end), 0) as mvps,
    coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('best_gk', 'guante_dorado', 'guante dorado', 'goalkeeper', 'golden_glove', 'golden glove', 'best_goalkeeper', 'best goalkeeper', 'mejor_arquero', 'mejor arquero') then 1 else 0 end), 0) as guantes_dorados,
    coalesce(sum(case when lower(coalesce(pa.award_type, '')) in ('red_card', 'red card', 'red_cards', 'tarjeta_roja', 'tarjeta roja', 'tarjetas_rojas', 'tarjetas rojas', 'negative_fair_play', 'dirty_player', 'dirty player', 'player_dirty', 'mas_sucio', 'mas sucio', 'sucio') then 1 else 0 end), 0) as tarjetas_rojas
  from public.usuarios u
  left join public.player_awards pa
    on pa.jugador_id = u.id::text
  group by u.id
)
update public.usuarios u
set
  mvps = award_counts.mvps,
  guantes_dorados = award_counts.guantes_dorados,
  tarjetas_rojas = award_counts.tarjetas_rojas
from award_counts
where u.id = award_counts.user_id;

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
