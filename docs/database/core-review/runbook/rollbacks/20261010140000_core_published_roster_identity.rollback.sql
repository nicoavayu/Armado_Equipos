-- Rollback of 20261010140000 (published roster identity). Run as postgres, in one transaction,
-- before the rollback of 139000. Data: none lost (app_private.match_link_access is kept; it only
-- records which accounts opened a valid invite link). Effect, back to 20261010139000:
--   * any signed-in account reads the roster (usuario_id, score) of matches published looking
--     for players, from the table, realtime and the "Quiero jugar" views, and anyone with the
--     link code from public_get_match_by_code;
--   * any account can again insert itself into any match roster, edit every column of its own
--     roster row (substitute flag, match, score) and create join requests already approved or
--     duplicated.
drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (
    partido_id is null
    or usuario_id = (select auth.uid())
    or app_private.match_involves_user(partido_id)
    or app_private.match_is_publicly_open(partido_id)
  );

drop policy if exists jugadores_insert_self_or_admin on public.jugadores;
create policy jugadores_insert_self_or_admin on public.jugadores
  for insert to authenticated
  with check ((usuario_id = (select auth.uid())) or app_private.is_match_admin(partido_id));

drop trigger if exists trg_jugadores_self_update_guard on public.jugadores;
drop function if exists app_private.tg_jugadores_self_update_guard();
drop trigger if exists trg_match_join_request_insert_guard on public.match_join_requests;
drop function if exists app_private.tg_match_join_request_insert_guard();
drop function if exists app_private.match_accepts_requests(bigint);
drop function if exists app_private.may_self_join_match(bigint, uuid);

create or replace view public.partidos_abiertos_operativos as
SELECT p.id,
    p.created_at,
    p.updated_at,
    app_private.match_access_code(p.id) AS codigo,
    p.match_ref,
    p.nombre,
    p.fecha,
    p.hora,
    partido_kickoff_at(p.fecha, p.hora) AS kickoff_at,
    p.sede,
    COALESCE(NULLIF(TRIM(BOTH FROM p.sede_direccion_normalizada), ''::text), NULLIF(TRIM(BOTH FROM p.sede), ''::text)) AS sede_direccion_normalizada,
    COALESCE(NULLIF(TRIM(BOTH FROM p.sede_place_id), ''::text), NULLIF(TRIM(BOTH FROM COALESCE((p."sedeMaps" ->> 'place_id'::text), (p."sedeMaps" ->> 'placeId'::text))), ''::text)) AS sede_place_id,
    p.sede_latitud,
    p.sede_longitud,
    p."sedeMaps",
    p.creado_por,
    p.modalidad,
    p.cupo_jugadores,
    COALESCE(p.falta_jugadores, false) AS falta_jugadores,
    p.tipo_partido,
    p.estado,
    normalize_partido_estado(p.estado) AS estado_normalizado,
    COALESCE(player_rows.jugadores, '[]'::jsonb) AS jugadores,
    COALESCE(player_rows.jugadores_count, 0) AS jugadores_count
   FROM (partidos p
     LEFT JOIN LATERAL ( SELECT jsonb_agg(to_jsonb(j.*) ORDER BY j.id) AS jugadores,
            (count(*))::integer AS jugadores_count
           FROM jugadores j
          WHERE (j.partido_id = p.id)) player_rows ON (true))
  WHERE partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora, p.falta_jugadores, now());

create or replace view public.partidos_abiertos_operativos_v2 as
SELECT p.id,
    p.created_at,
    p.updated_at,
    app_private.match_access_code(p.id) AS codigo,
    p.match_ref,
    p.nombre,
    p.fecha,
    p.hora,
    partido_kickoff_at(p.fecha, p.hora) AS kickoff_at,
    p.sede,
    COALESCE(NULLIF(TRIM(BOTH FROM p.sede_direccion_normalizada), ''::text), NULLIF(TRIM(BOTH FROM p.sede), ''::text)) AS sede_direccion_normalizada,
    COALESCE(NULLIF(TRIM(BOTH FROM p.sede_place_id), ''::text), NULLIF(TRIM(BOTH FROM COALESCE((p."sedeMaps" ->> 'place_id'::text), (p."sedeMaps" ->> 'placeId'::text))), ''::text)) AS sede_place_id,
    p.sede_latitud,
    p.sede_longitud,
    p."sedeMaps",
    p.creado_por,
    p.modalidad,
    p.cupo_jugadores,
    COALESCE(p.falta_jugadores, false) AS falta_jugadores,
    p.tipo_partido,
    p.estado,
    normalize_partido_estado(p.estado) AS estado_normalizado,
    COALESCE(player_rows.jugadores, '[]'::jsonb) AS jugadores,
    COALESCE(player_rows.jugadores_count, 0) AS jugadores_count,
    COALESCE(p.busca_arquero, false) AS busca_arquero
   FROM (partidos p
     LEFT JOIN LATERAL ( SELECT jsonb_agg(to_jsonb(j.*) ORDER BY j.id) AS jugadores,
            (count(*))::integer AS jugadores_count
           FROM jugadores j
          WHERE (j.partido_id = p.id)) player_rows ON (true))
  WHERE partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora, (COALESCE(p.falta_jugadores, false) OR COALESCE(p.busca_arquero, false)), now());

alter view public.partidos_abiertos_operativos set (security_invoker = false);
alter view public.partidos_abiertos_operativos_v2 set (security_invoker = false);

create or replace function public.public_get_match_by_code(p_codigo text, p_partido_id bigint default null::bigint)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'partido', to_jsonb(match_row),
    'jugadores', coalesce((
      select jsonb_agg(to_jsonb(roster_player) order by roster_player.id)
      from public.jugadores roster_player
      where roster_player.partido_id = match_row.id
    ), '[]'::jsonb)
  )
  from public.partidos match_row
  where nullif(btrim(coalesce(p_codigo, '')), '') is not null
    and upper(btrim(match_row.codigo)) = upper(btrim(p_codigo))
    and (p_partido_id is null or match_row.id = p_partido_id)
    and match_row.deleted_at is null
    and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
  order by match_row.id desc
  limit 1
$function$;

drop function if exists public.get_public_match_roster(bigint);
drop function if exists app_private.roster_entry(public.jugadores, boolean);

CREATE OR REPLACE FUNCTION public.validate_guest_match_invite(p_partido_id bigint, p_codigo text, p_token text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match_code text;
  v_token text := trim(COALESCE(p_token, ''));
BEGIN
  SELECT trim(COALESCE(p.codigo, ''))
  INTO v_match_code
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  IF trim(COALESCE(p_codigo, '')) = '' OR trim(COALESCE(p_codigo, '')) <> v_match_code THEN
    RETURN QUERY
      SELECT false, 'invalid_code'::text;
    RETURN;
  END IF;

  IF v_token = '' THEN
    RETURN QUERY
      SELECT false, 'invalid_invite'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.guest_match_invites g
    WHERE g.partido_id = p_partido_id
      AND g.token = v_token
      AND g.revoked_at IS NULL
      AND g.expires_at > now()
      AND g.uses_count < g.max_uses
  ) THEN
    RETURN QUERY
      SELECT false, 'invalid_invite'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT true, NULL::text;
END;
$function$;

delete from supabase_migrations.schema_migrations where version = '20261010140000';
