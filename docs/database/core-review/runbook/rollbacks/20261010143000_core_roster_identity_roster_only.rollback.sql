-- Rollback of 20261010143000 (roster identity only for organizer and roster). Run as postgres,
-- in one transaction, FIRST (before the rollback of 142000). Data: none. Effect: back to
-- 140000 — any involved account (also a pending requester or a notified one) gets full roster
-- entries, and outsiders and anon get each registered player's account id (uuid) and
-- responsabilidad_score again.
do $roster_views$
declare
  v_view text;
  v_def text;
  v_opts text;
  v_old constant text := 'app_private.match_roster_identity_visible(p.id, app_private.request_user_id())) ORDER BY j.id)';
  v_new constant text := 'app_private.match_involves_user(p.id, app_private.request_user_id())) ORDER BY j.id)';
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    if to_regclass(format('public.%I', v_view)) is null then
      continue;
    end if;
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    if position(v_old in v_def) = 0 then
      continue;
    end if;
    select array_to_string(c.reloptions, ', ') into v_opts from pg_class c where c.oid = format('public.%I', v_view)::regclass;
    execute format('create or replace view public.%I as %s', v_view, replace(v_def, v_old, v_new));
    if v_opts is not null then
      execute format('alter view public.%I set (%s)', v_view, v_opts);
    end if;
  end loop;
end
$roster_views$;

drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (
    partido_id is null
    or usuario_id = (select auth.uid())
    or app_private.match_involves_user(partido_id)
  );

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
      select jsonb_agg(
        app_private.roster_entry(roster_player, app_private.match_involves_user(match_row.id, auth.uid()))
        order by roster_player.id
      )
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

create or replace function public.get_public_match_roster(p_partido_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select jsonb_agg(app_private.roster_entry(roster_player, v.involved) order by roster_player.id)
    from public.jugadores roster_player
    where roster_player.partido_id = p_partido_id
  ), '[]'::jsonb)
  from (select app_private.match_involves_user(p_partido_id, auth.uid()) as involved) v
  where auth.uid() is not null
    and (v.involved or app_private.match_is_publicly_open(p_partido_id))
$function$;

create or replace function app_private.roster_entry(p_player public.jugadores, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select
    case
      when coalesce(p_full, false) or p_player.usuario_id = app_private.request_user_id()
        then to_jsonb(p_player)
      else to_jsonb(p_player) - array['usuario_id', 'score']
    end
    || jsonb_build_object(
      'has_account', p_player.usuario_id is not null,
      'is_me', p_player.usuario_id is not null and p_player.usuario_id = app_private.request_user_id()
    )
$function$;

create or replace function app_private.roster_entry_json(p_entry jsonb, p_owner uuid, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select
    case
      when coalesce(p_full, false) or p_owner = app_private.request_user_id() then p_entry
      else p_entry - array['usuario_id', 'score']
    end
    || jsonb_build_object(
      'has_account', p_owner is not null,
      'is_me', p_owner is not null and p_owner = app_private.request_user_id()
    )
$function$;

drop function if exists app_private.match_roster_identity_visible(bigint, uuid);
drop function if exists app_private.match_ref_roster_identity_visible(uuid, uuid);
delete from supabase_migrations.schema_migrations where version = '20261010143000';
