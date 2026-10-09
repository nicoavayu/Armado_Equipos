-- Rollback of 20261010137000 (match code never public). Run as postgres, in one transaction.
-- Data: none touched. Effect: back to 20261010136000 — any signed-in account reads from the
-- table every match published looking for players, with its code (the link-voting credential).
-- partidos_view is put back exactly as it was before 137000 (saved by the migration). Anon keeps EXECUTE on the three pure helpers (no data behind them).
drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using (
    coalesce(creado_por, admin_id) = (select auth.uid())
    or (
      deleted_at is null
      and (
        admin_id = (select auth.uid())
        or public.partido_is_operationally_open(
          estado, deleted_at, survey_status, result_status, finished_at, fecha, hora,
          coalesce(falta_jugadores, false) or coalesce(busca_arquero, false),
          now()
        )
        or app_private.match_involves_user(id)
      )
    )
  );
drop policy if exists partidos_select_public_reader on public.partidos;
drop policy if exists jugadores_select_public_reader on public.jugadores;

-- The views go back to postgres and run as the caller again (their grants move with them).
alter view public.partidos_view owner to postgres;
alter view public.partidos_abiertos_operativos owner to postgres;
alter view public.partidos_abiertos_operativos_v2 owner to postgres;
alter view public.partidos_view set (security_invoker = on);
alter view public.partidos_abiertos_operativos set (security_invoker = on);
alter view public.partidos_abiertos_operativos_v2 set (security_invoker = on);

-- partidos_view exactly as it was before 137000 (it may have gained columns).
do $restore_partidos_view$
declare
  v_saved jsonb;
  r record;
begin
  if to_regclass('app_private.production_alignment_log') is null then
    return;
  end if;
  select definition into v_saved from app_private.production_alignment_log
  where kind = 'view_before' and object_name = 'public.partidos_view' order by id desc limit 1;
  if v_saved is null then
    return;
  end if;
  if pg_get_viewdef('public.partidos_view'::regclass) is distinct from v_saved ->> 'definition' then
    drop view public.partidos_view;
    execute format('create view public.partidos_view as %s', v_saved ->> 'definition');
    execute format('alter view public.partidos_view owner to %I', v_saved ->> 'owner');
    if jsonb_typeof(v_saved -> 'options') = 'array' then
      execute format('alter view public.partidos_view set (%s)',
        (select string_agg(o, ', ') from jsonb_array_elements_text(v_saved -> 'options') o));
    end if;
    for r in select grantee, string_agg(privilege_type, ', ') as privileges
             from aclexplode((v_saved ->> 'acl')::aclitem[])
             where grantee <> (select oid from pg_roles where rolname = v_saved ->> 'owner')
             group by grantee loop
      execute format('grant %s on public.partidos_view to %s', r.privileges,
        case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
    end loop;
  end if;
  delete from app_private.production_alignment_log where kind = 'view_before' and object_name = 'public.partidos_view';
end
$restore_partidos_view$;

revoke execute on function app_private.match_involves_user(bigint, uuid) from anon, core_match_public_reader;
revoke execute on function app_private.match_is_publicly_open(bigint) from anon, core_match_public_reader;
revoke execute on function app_private.match_access_code(bigint) from core_match_public_reader;
revoke execute on function public.partido_is_operationally_open(text, timestamp with time zone, text, text, timestamp with time zone, date, text, boolean, timestamp with time zone) from core_match_public_reader;
revoke execute on function public.normalize_partido_estado(text) from core_match_public_reader;
revoke execute on function public.partido_kickoff_at(date, text) from core_match_public_reader;
revoke select on table public.partidos, public.jugadores from core_match_public_reader;
revoke usage on schema public, app_private from core_match_public_reader;
drop function if exists app_private.request_user_id();
drop role if exists core_match_public_reader;
delete from supabase_migrations.schema_migrations where version = '20261010137000';
