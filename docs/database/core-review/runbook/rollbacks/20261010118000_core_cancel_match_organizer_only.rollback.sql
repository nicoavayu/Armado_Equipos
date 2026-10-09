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
  execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  for r in select * from aclexplode(v_saved.acl::aclitem[]) where privilege_type = 'EXECUTE' loop
    if r.grantee = 0 then
      execute format('grant execute on function %s to public', v_fn);
    elsif pg_get_userbyid(r.grantee) in ('anon', 'authenticated', 'service_role') then
      execute format('grant execute on function %s to %I', v_fn, pg_get_userbyid(r.grantee));
    end if;
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
