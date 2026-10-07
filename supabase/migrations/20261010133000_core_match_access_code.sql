-- Core: a match's access code is for the people who already have access to it.
--
-- partidos.codigo opens the match's public voting and its invitation page. Any signed-in
-- account could list every code (SELECT on partidos and on its views is open to
-- authenticated, and the "Quiero jugar" RPC returned it). Rule
-- (docs/database/core-review/partidos-access-code-proposal.md):
--   the code is visible to the match admin and the players in its roster; every other
--   account still discovers published matches (everything but the code), and whoever got
--   the code in a link (WhatsApp) keeps using it: the server validates it, never hands it out.
-- Phase A (this migration, safe for installed apps, which never read other matches' codes
-- from these views or from discovery):
--   * app_private.match_access_code(match): the code for its admin or a roster player,
--     NULL for anyone else (and for anonymous visitors);
--   * partidos_view, partidos_abiertos_operativos(_v2) return that instead of the column
--     (members see the code, everybody else NULL) — and get_open_matches_for_quiero_jugar_v2
--     reads _v2, so discovery no longer carries codes;
--   * get_match_access_codes(ids): the codes of the caller's own matches, for the client
--     (share, vote, invite).
-- Phase B (docs/database/core-review/phase-b-partidos-access-code.sql, by hand, together
-- with the usuarios phase B): revoke the column on the table itself.
-- Links keep working: resolve_match_by_code, public_get_match_by_code, get_partido_by_invite,
-- validate_guest_match_invite and the public voting RPCs take the code as input.

create or replace function app_private.match_access_code(p_partido_id bigint)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select match_row.codigo
  from public.partidos match_row
  where match_row.id = p_partido_id
    and auth.uid() is not null
    and (
      coalesce(match_row.creado_por, match_row.admin_id) = auth.uid()
      or match_row.admin_id = auth.uid()
      or exists (
        select 1 from public.jugadores roster_player
        where roster_player.partido_id = match_row.id and roster_player.usuario_id = auth.uid()
      )
    )
$function$;

-- The views run as the caller (security_invoker), so the caller needs to execute it; it
-- lives in app_private (not exposed by the API) and only answers members.
revoke all on function app_private.match_access_code(bigint) from public;
grant execute on function app_private.match_access_code(bigint) to anon, authenticated, service_role;

create or replace function public.get_match_access_codes(p_partido_ids bigint[])
returns table (partido_id bigint, codigo text)
language sql
stable
security definer
set search_path to ''
as $function$
  select requested.id, app_private.match_access_code(requested.id)
  from (select distinct unnest((coalesce(p_partido_ids, '{}'::bigint[]))[1:200]) as id) requested
  where app_private.match_access_code(requested.id) is not null
$function$;

revoke all on function public.get_match_access_codes(bigint[]) from public, anon;
grant execute on function public.get_match_access_codes(bigint[]) to authenticated, service_role;

create or replace view public.partidos_view
with (security_invoker = on) as
 select p.id,
    p.uuid,
    p.match_ref,
    app_private.match_access_code(p.id) as codigo,
    p.nombre,
    p.fecha,
    p.hora,
    p.sede,
    p."sedeMaps",
    p.modalidad,
    p.tipo_partido,
    p.cupo_jugadores,
    p.falta_jugadores,
    p.precio_cancha,
    p.creado_por,
    p.admin_id,
    p.equipos_json,
    p.equipos_generados,
    p.teams_confirmed,
    p.awards_status,
    p.awards_resolved_at,
    p.estado,
    p.deleted_at,
    p.created_at,
    p.updated_at
   from public.partidos p
  where p.deleted_at is null;

create or replace view public.partidos_abiertos_operativos
with (security_invoker = on) as
 select p.id,
    p.created_at,
    p.updated_at,
    app_private.match_access_code(p.id) as codigo,
    p.match_ref,
    p.nombre,
    p.fecha,
    p.hora,
    public.partido_kickoff_at(p.fecha, p.hora) as kickoff_at,
    p.sede,
    coalesce(nullif(trim(both from p.sede_direccion_normalizada), ''::text), nullif(trim(both from p.sede), ''::text)) as sede_direccion_normalizada,
    coalesce(nullif(trim(both from p.sede_place_id), ''::text), nullif(trim(both from coalesce(p."sedeMaps" ->> 'place_id'::text, p."sedeMaps" ->> 'placeId'::text)), ''::text)) as sede_place_id,
    p.sede_latitud,
    p.sede_longitud,
    p."sedeMaps",
    p.creado_por,
    p.modalidad,
    p.cupo_jugadores,
    coalesce(p.falta_jugadores, false) as falta_jugadores,
    p.tipo_partido,
    p.estado,
    public.normalize_partido_estado(p.estado) as estado_normalizado,
    coalesce(player_rows.jugadores, '[]'::jsonb) as jugadores,
    coalesce(player_rows.jugadores_count, 0) as jugadores_count
   from public.partidos p
     left join lateral ( select jsonb_agg(to_jsonb(j.*) order by j.id) as jugadores,
            count(*)::integer as jugadores_count
           from public.jugadores j
          where j.partido_id = p.id) player_rows on true
  where public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora, p.falta_jugadores, now());

create or replace view public.partidos_abiertos_operativos_v2
with (security_invoker = on) as
 select p.id,
    p.created_at,
    p.updated_at,
    app_private.match_access_code(p.id) as codigo,
    p.match_ref,
    p.nombre,
    p.fecha,
    p.hora,
    public.partido_kickoff_at(p.fecha, p.hora) as kickoff_at,
    p.sede,
    coalesce(nullif(trim(both from p.sede_direccion_normalizada), ''::text), nullif(trim(both from p.sede), ''::text)) as sede_direccion_normalizada,
    coalesce(nullif(trim(both from p.sede_place_id), ''::text), nullif(trim(both from coalesce(p."sedeMaps" ->> 'place_id'::text, p."sedeMaps" ->> 'placeId'::text)), ''::text)) as sede_place_id,
    p.sede_latitud,
    p.sede_longitud,
    p."sedeMaps",
    p.creado_por,
    p.modalidad,
    p.cupo_jugadores,
    coalesce(p.falta_jugadores, false) as falta_jugadores,
    p.tipo_partido,
    p.estado,
    public.normalize_partido_estado(p.estado) as estado_normalizado,
    coalesce(player_rows.jugadores, '[]'::jsonb) as jugadores,
    coalesce(player_rows.jugadores_count, 0) as jugadores_count,
    coalesce(p.busca_arquero, false) as busca_arquero
   from public.partidos p
     left join lateral ( select jsonb_agg(to_jsonb(j.*) order by j.id) as jugadores,
            count(*)::integer as jugadores_count
           from public.jugadores j
          where j.partido_id = p.id) player_rows on true
  where public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora, coalesce(p.falta_jugadores, false) or coalesce(p.busca_arquero, false), now());

do $match_access_code_check$
begin
  if has_function_privilege('anon', 'public.get_match_access_codes(bigint[])', 'execute') then
    raise exception 'get_match_access_codes must not be executable by anon';
  end if;
  if exists (
    select 1 from pg_class view_row
    where view_row.oid in ('public.partidos_view'::regclass, 'public.partidos_abiertos_operativos'::regclass,
                           'public.partidos_abiertos_operativos_v2'::regclass)
      and not coalesce(view_row.reloptions @> array['security_invoker=on'], false)
  ) then
    raise exception 'match views must stay security_invoker';
  end if;
end
$match_access_code_check$;
