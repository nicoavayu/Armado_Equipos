-- Rollback of 20261010119000 (production alignment). Run as postgres, in one transaction, LAST
-- (after every other rollback). Puts back exactly what the alignment changed, from
-- app_private.production_alignment_log: the policies it dropped (as they were), minus the
-- ones it created, the helpers it created and partidos.admin_id if it added it. On a database
-- where the alignment changed nothing (the repository schema), this does nothing.
-- Data: partidos.admin_id is dropped only if the alignment added it (it is never set there).
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
    execute format('drop function if exists %s', r.object_name);
  end loop;
  if exists (select 1 from app_private.production_alignment_log where kind = 'added_column' and table_name = 'partidos' and object_name = 'admin_id') then
    alter table public.partidos drop column if exists admin_id;
  end if;
  if exists (select 1 from app_private.production_alignment_log where kind = 'granted_schema_usage' and object_name = 'app_private') then
    revoke usage on schema app_private from anon, authenticated, service_role;
  end if;
end
$rollback$;
drop function if exists app_private.alignment_save_function_acl(regprocedure);
drop function if exists app_private.alignment_restore_function_acl(regprocedure);
drop table if exists app_private.production_alignment_log;
delete from supabase_migrations.schema_migrations where version = '20261010119000';
