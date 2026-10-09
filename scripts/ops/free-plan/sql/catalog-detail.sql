-- Per-object form of manifest.sql's function and table ACL digests (same object sets, same fields), one JSON row. Read only; used by
-- restore-check to explain a catalog difference on the restored copy.
with dumped as (
  select c.oid, n.nspname as schema, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg_temp%'
    and (not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
         or exists (select 1 from pg_extension e where c.oid = any(e.extconfig)))
), own_fns as (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, md5(p.prosrc) as body,
         (select string_agg(a::text, ',' order by a::text) from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a) as acl,
         pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
)
select json_build_object(
  'functions', (select json_object_agg(sig, body || ':' || acl || ':' || owner || ':' || definer::text) from own_fns),
  'table_acl', (select json_object_agg(schema || '.' || name, (select string_agg(a::text, ',' order by a::text) from unnest(coalesce(c.relacl, acldefault('r', c.relowner))) a) || ':' || c.relrowsecurity::text) from dumped d join pg_class c on c.oid = d.oid)
)::text;
