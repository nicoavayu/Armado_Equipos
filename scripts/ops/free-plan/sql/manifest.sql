-- Backup manifest (READ ONLY). Run in the same REPEATABLE READ snapshot that pg_dump exports, and again on the
-- restored copy: equal JSON = the backup holds exactly the rows, functions, grants, policies and triggers the source
-- had at that instant. One SELECT, one JSON row.
-- Tables: every table pg_dump writes data for (not an extension member, or an extension configuration table such as
-- cron.job / cron.job_run_details), with its row count and an order-independent hash of its rows.
with dumped as (
  select c.oid, n.nspname as schema, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg_temp%'
    and (
      not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      or exists (select 1 from pg_extension e where c.oid = any(e.extconfig))
    )
), counted as (
  select d.schema, d.name,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', d.schema, d.name), false, true, '')))[1]::text::bigint as rows
  from dumped d
), tables as (
  -- Row hashes up to 300,000 rows; above that the exact count only, so a large log table (Core's cron history before the
  -- compaction) never makes a big sort spill to the 1 GB Free disk. Same rule on the source and on the restored copy.
  select schema, name, rows,
         case when rows <= 300000 then (xpath('/row/h/text()', query_to_xml(format(
            'select coalesce(md5(string_agg(h, '''' order by h)), '''') as h from (select md5(t::text) as h from %I.%I t) x',
            schema, name), false, true, '')))[1]::text else 'count-only' end as hash
  from counted
), own_fns as (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         md5(p.prosrc) as body,
         -- effective privileges: NULL means the owner's default; item order does not matter
         (select string_agg(a::text, ',' order by a::text) from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a) as acl, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
)
select json_build_object(
  'tables', (select json_object_agg(schema || '.' || name, json_build_object('rows', rows, 'hash', hash) order by schema, name) from tables),
  'functions', (select json_build_object('count', count(*), 'digest', md5(string_agg(sig || ':' || body || ':' || acl || ':' || owner || ':' || definer::text, ',' order by sig))) from own_fns),
  'policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '+') || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by schemaname, tablename, policyname), '')))
               from pg_policies),
  'triggers', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid), ',' order by c.relname, t.tgname), '')))
               from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal),
  'table_acl', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schema || '.' || name || ':' || (select string_agg(a::text, ',' order by a::text) from unnest(coalesce(c.relacl, acldefault('r', c.relowner))) a) || ':' || c.relrowsecurity::text, ',' order by schema, name), '')))
                from dumped d join pg_class c on c.oid = d.oid),
  'server_version', current_setting('server_version')
)::jsonb::text as manifest
