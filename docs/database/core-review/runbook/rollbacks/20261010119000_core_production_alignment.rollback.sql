-- Rollback of 20261010119000 (production alignment). Run as postgres, in one transaction, LAST
-- (after every other rollback). Puts back exactly what the alignment changed, from
-- app_private.production_alignment_log: the policies it dropped (as they were), minus the
-- ones it created, the helpers it created and partidos.admin_id if it added it. On a database
-- where the alignment changed nothing (the repository schema), this does nothing.
-- Data: partidos.admin_id is dropped only if the alignment added it (it is never set there).
-- What the alignment created (the helpers, partidos.admin_id) is dropped only when no function
-- of public/app_private still names it. If 20261010120000…132000 are still applied (their
-- rollback is optional, PROMOTION.md §5), their functions use them (e.g.
-- list_my_pending_survey_finalizations reads partidos.admin_id): they are KEPT (nullable column,
-- never set; helpers granted as before), recorded as kept_* in production_alignment_log, and
-- the log and its ACL helpers stay (the rollbacks of 120000…132000 still need them). Rolling back
-- 120000…132000 and then running this file again gives the exact original catalog.
-- Effect on Core Production: back to its open policies (anon reads every match and roster,
-- any account inserts any roster row, the voting tables are open).
do $rollback$
declare
  r record;
  v_roles text;
begin
  if to_regclass('app_private.production_alignment_log') is null then
    return;
  end if;
  delete from app_private.production_alignment_log where kind in ('kept_function', 'kept_column');
  for r in select * from app_private.production_alignment_log where kind = 'created_policy' order by id desc loop
    execute format('drop policy if exists %I on public.%I', r.object_name, r.table_name);
  end loop;
  for r in select * from app_private.production_alignment_log where kind = 'dropped_policy' order by id loop
    select string_agg(case when role_name = 'public' then 'public' else quote_ident(role_name) end, ', ')
      into v_roles
      from jsonb_array_elements_text(r.definition -> 'roles') role_name;
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      r.object_name, r.table_name, r.definition ->> 'permissive', r.definition ->> 'cmd', v_roles,
      case when r.definition ->> 'using' is not null then ' using (' || (r.definition ->> 'using') || ')' else '' end,
      case when r.definition ->> 'check' is not null then ' with check (' || (r.definition ->> 'check') || ')' else '' end);
  end loop;
  for r in select * from app_private.production_alignment_log where kind = 'created_function' order by id desc loop
    if exists (
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
        and p.oid <> to_regprocedure(r.object_name)
        and p.prosrc ~ ('\m' || split_part(split_part(r.object_name, '(', 1), '.', 2) || '\M')
    ) then
      insert into app_private.production_alignment_log (kind, object_name) values ('kept_function', r.object_name);
    else
      execute format('drop function if exists %s', r.object_name);
    end if;
  end loop;
  if exists (select 1 from app_private.production_alignment_log where kind = 'added_column' and table_name = 'partidos' and object_name = 'admin_id') then
    if exists (
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosrc ~ '\madmin_id\M'
    ) then
      insert into app_private.production_alignment_log (kind, table_name, object_name) values ('kept_column', 'partidos', 'admin_id');
    else
      alter table public.partidos drop column if exists admin_id;
    end if;
  end if;
  if exists (select 1 from app_private.production_alignment_log where kind = 'granted_schema_usage' and object_name = 'app_private')
     and not exists (select 1 from app_private.production_alignment_log where kind in ('kept_function', 'kept_column')) then
    revoke usage on schema app_private from anon, authenticated, service_role;
  end if;
end
$rollback$;
do $keep_log$
begin
  if to_regclass('app_private.production_alignment_log') is null then
    return;
  end if;
  if exists (select 1 from app_private.production_alignment_log where kind in ('kept_function', 'kept_column')) then
    raise notice 'kept (still used by 20261010120000…132000): %',
      (select string_agg(coalesce(table_name || '.', '') || object_name, ', ') from app_private.production_alignment_log
       where kind in ('kept_function', 'kept_column'));
    delete from app_private.production_alignment_log where kind in ('dropped_policy', 'created_policy', 'untouched_policies_digest');
  else
    drop function if exists app_private.alignment_save_function_acl(regprocedure);
    drop function if exists app_private.alignment_restore_function_acl(regprocedure);
    drop table app_private.production_alignment_log;
  end if;
end
$keep_log$;
delete from supabase_migrations.schema_migrations where version = '20261010119000';
