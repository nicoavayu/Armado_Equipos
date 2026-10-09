-- Core schema catalog — READ-ONLY, structure only (no row data, no secrets). One JSON line.
-- ACLs are normalized (a default ACL is written out with acldefault, items sorted), so equivalent
-- ACLs compare equal.
-- Run on Production and on a rehearsal database, then compare them with catalog-diff.mjs to
-- find every place where Production drifts from the repository schema before applying #193.
-- psql -X -A -t -q -v ON_ERROR_STOP=1 -f catalog.sql > catalog-<where>.json   (as postgres)
begin read only;
with
nsp as (
  select oid, nspname from pg_namespace where nspname in ('public', 'app_private', 'supabase_migrations')
),
cols as (
  select n.nspname || '.' || c.relname || '.' || a.attname as k,
         json_build_object('type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid)) as v
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p', 'v', 'm')
  join nsp n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
),
rels as (
  select n.nspname || '.' || c.relname as k,
         json_build_object('kind', c.relkind, 'owner', pg_get_userbyid(c.relowner), 'options', c.reloptions,
           'rls', c.relrowsecurity, 'acl', (select string_agg(item::text, ',' order by item::text) from unnest(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) item),
           'view_md5', case when c.relkind in ('v', 'm') then md5(pg_get_viewdef(c.oid)) end) as v
  from pg_class c join nsp n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S')
),
cons as (
  select n.nspname || '.' || c.relname || '.' || k.conname as k,
         json_build_object('type', k.contype, 'def', pg_get_constraintdef(k.oid)) as v
  from pg_constraint k join pg_class c on c.oid = k.conrelid join nsp n on n.oid = c.relnamespace
),
idx as (
  select n.nspname || '.' || i.relname as k, json_build_object('def', pg_get_indexdef(i.oid)) as v
  from pg_index x join pg_class i on i.oid = x.indexrelid join nsp n on n.oid = i.relnamespace
),
pols as (
  select p.schemaname || '.' || p.tablename || '.' || p.policyname as k,
         json_build_object('cmd', p.cmd, 'roles', p.roles::text, 'using', p.qual, 'check', p.with_check) as v
  from pg_policies p where p.schemaname in ('public', 'app_private')
),
trgs as (
  select n.nspname || '.' || c.relname || '.' || t.tgname as k,
         json_build_object('def', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled) as v
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join nsp n on n.oid = c.relnamespace
  where not t.tgisinternal
),
funcs as (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
         json_build_object('returns', pg_get_function_result(p.oid), 'secdef', p.prosecdef, 'owner', pg_get_userbyid(p.proowner),
           'lang', l.lanname, 'volatility', p.provolatile, 'config', p.proconfig, 'acl', (select string_agg(item::text, ',' order by item::text) from unnest(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) item),
           'body_md5', md5(p.prosrc)) as v
  from pg_proc p join nsp n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
),
roles as (
  select r.rolname as k, json_build_object('login', r.rolcanlogin, 'super', r.rolsuper, 'createrole', r.rolcreaterole,
           'bypassrls', r.rolbypassrls) as v
  from pg_roles r
  where r.rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin', 'core_match_public_reader')
),
exts as (
  select e.extname as k, json_build_object('version', e.extversion, 'schema', e.extnamespace::regnamespace::text) as v from pg_extension e
),
pubs as (
  select p.pubname || '.' || t.schemaname || '.' || t.tablename as k, json_build_object('published', true) as v
  from pg_publication p join pg_publication_tables t on t.pubname = p.pubname
),
schema_acl as (
  select n.nspname as k, json_build_object('owner', pg_get_userbyid(s.nspowner), 'acl', (select string_agg(item::text, ',' order by item::text) from unnest(coalesce(s.nspacl, acldefault('n'::"char", s.nspowner))) item)) as v
  from nsp n join pg_namespace s on s.oid = n.oid
)
select json_build_object(
  'server_version', current_setting('server_version'),
  'columns', (select json_object_agg(k, v order by k) from cols),
  'relations', (select json_object_agg(k, v order by k) from rels),
  'constraints', (select json_object_agg(k, v order by k) from cons),
  'indexes', (select json_object_agg(k, v order by k) from idx),
  'policies', (select json_object_agg(k, v order by k) from pols),
  'triggers', (select json_object_agg(k, v order by k) from trgs),
  'functions', (select json_object_agg(k, v order by k) from funcs),
  'roles', (select json_object_agg(k, v order by k) from roles),
  'extensions', (select json_object_agg(k, v order by k) from exts),
  'publications', (select json_object_agg(k, v order by k) from pubs),
  'schemas', (select json_object_agg(k, v order by k) from schema_acl),
  'ledger', (select json_agg(version order by version) from supabase_migrations.schema_migrations)
)::text;
rollback;
