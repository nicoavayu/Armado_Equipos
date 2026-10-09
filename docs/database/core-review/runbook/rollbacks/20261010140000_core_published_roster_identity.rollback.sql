-- Rollback of 20261010140000 (published roster identity). Run as postgres, in one transaction,
-- after the rollback of 141000 (and 142000) and before the rollback of 139000. Data: none lost (app_private.match_link_access is kept; it only
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
drop function if exists app_private.match_accepts_requests(bigint, uuid);
drop function if exists app_private.match_accepts_requests(bigint);
drop function if exists app_private.may_self_join_match(bigint, uuid);

-- The views build their roster aggregates as before (rewritten from their current definition,
-- like the migration did; Core Production's partidos_view embeds a roster too).
do $rollback_views$
declare
  v_view text;
  v_def text;
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    if v_def ~ 'roster_entry_json' then
      execute format('create or replace view public.%I as %s', v_view,
        regexp_replace(v_def,
          'app_private\.roster_entry_json\((.+?), j\.usuario_id, app_private\.match_involves_user\(p\.id, app_private\.request_user_id\(\)\)\)',
          '\1', 'g'));
      execute format('alter view public.%I set (security_invoker = false)', v_view);
    end if;
  end loop;
end
$rollback_views$;

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
drop function if exists app_private.roster_entry_json(jsonb, uuid, boolean);

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
