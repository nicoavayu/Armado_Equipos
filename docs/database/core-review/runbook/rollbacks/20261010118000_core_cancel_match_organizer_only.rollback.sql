-- Rollback of 20261010118000 (only the organizer cancels a match through the API). Run as
-- postgres, in one transaction. Data: none. Effect: back to Production as it was — anyone,
-- anon included, can cancel and soft-delete any match again.
-- Puts back the original body (byte for byte, saved by the migration; same oid) and the
-- function's exact ACL. If 20261010146000 is applied, roll it back first.
do $rollback$
declare
  v_fn constant regprocedure := 'public.cancel_partido_with_notification(bigint,text)'::regprocedure;
  v_saved record;
  r record;
begin
  if to_regclass('app_private.core_function_before') is null then
    return;
  end if;
  select * into v_saved from app_private.core_function_before where function_name = v_fn::text;
  if not found then
    return;
  end if;
  execute format(
    'create or replace function public.cancel_partido_with_notification(p_partido_id bigint, p_reason text default %L::text) '
    'returns jsonb language plpgsql security definer as %s',
    'Partido cancelado', quote_literal(v_saved.prosrc));
  -- Same entries in the same order as before: revoke every current grantee (the owner too),
  -- then grant again in the saved order.
  for r in select distinct a.grantee from pg_proc p, aclexplode(p.proacl) a where p.oid = v_fn loop
    execute format('revoke all on function %s from %s', v_fn, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
  for r in select a.grantee from aclexplode(v_saved.acl::aclitem[]) with ordinality a(grantor, grantee, privilege_type, is_grantable, ord)
           where a.privilege_type = 'EXECUTE' order by a.ord loop
    execute format('grant execute on function %s to %s', v_fn, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
  if md5((select prosrc from pg_proc where oid = v_fn)) <> md5(v_saved.prosrc) then
    raise exception 'cancel_partido_with_notification body not restored';
  end if;
  delete from app_private.core_function_before where function_name = v_fn::text;
  if not exists (select 1 from app_private.core_function_before) then
    drop table app_private.core_function_before;
  end if;
end
$rollback$;
delete from supabase_migrations.schema_migrations where version = '20261010118000';
